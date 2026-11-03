import {test, expect} from '@playwright/test';
import {boot, body, clickAction, clickWorld, tapWorld} from '../helpers/canvas.js';
import {sample} from '../helpers/qa.js';

/**
 * Grid cells have no DOM proxies. These tests aim real mouse/touch events
 * at canvas coordinates computed from the grid's own QA snapshot, so the
 * game's pointer.worldX/worldY -> Grid.worldToCell path is exercised end to
 * end, including Scale.FIT canvas scaling.
 */

const EXPECTED_GRID = {cols: 24, rows: 16, tileSize: 32, originX: 256, originY: 104};

const cellCenter = (grid, col, row) => ({
    x: grid.originX + (col + 0.5) * grid.tileSize,
    y: grid.originY + (row + 0.5) * grid.tileSize,
});

async function startGame(page) {
    await boot(page, {scene: 'game', waitForQA: true});
    await clickAction(page, 'start');
    await expect(body(page)).toHaveAttribute('data-phase', 'started');
    return sample(page);
}

async function expectSelected(page, col, row) {
    await expect.poll(async () => (await sample(page)).selectedCell).toEqual({col, row});
    const {grid, highlight} = await sample(page);
    expect(highlight).toEqual({
        visible: true,
        x: grid.originX + col * grid.tileSize,
        y: grid.originY + row * grid.tileSize,
        width: grid.tileSize,
        height: grid.tileSize,
    });
}

async function expectCleared(page) {
    await expect.poll(async () => (await sample(page)).selectedCell).toBeNull();
    expect((await sample(page)).highlight.visible).toBe(false);
}

function selectionSuite(pointerAt) {
    test('no grid exists before Start; pointer input does nothing', async ({page}) => {
        await boot(page, {scene: 'game', waitForQA: true});
        const before = await sample(page);
        expect(before.grid).toBeNull();
        expect(before.selectedCell).toBeNull();
        expect(before.highlight).toBeNull();

        await pointerAt(page, cellCenter(EXPECTED_GRID, 5, 5), before);
        const after = await sample(page);
        expect(after.grid).toBeNull();
        expect(after.selectedCell).toBeNull();
    });

    test('Start creates a centred 24x16 grid of 32px cells', async ({page}) => {
        const state = await startGame(page);
        expect(state.grid).toEqual({...EXPECTED_GRID, occupants: []});
        expect(state.selectedCell).toBeNull();
        expect(state.highlight.visible).toBe(false);
    });

    test('pointer on a cell selects and highlights it (corners and interior)', async ({page}) => {
        const state = await startGame(page);
        for (const [col, row] of [[0, 0], [23, 0], [0, 15], [23, 15], [7, 9]]) {
            await pointerAt(page, cellCenter(state.grid, col, row), state);
            await expectSelected(page, col, row);
        }
    });

    test('pointer outside the grid clears the selection', async ({page}) => {
        const state = await startGame(page);
        const {grid} = state;
        const outside = [
            {x: grid.originX - 20, y: 360},                                   // left
            {x: grid.originX + grid.cols * grid.tileSize + 20, y: 360},       // right
            {x: 640, y: grid.originY - 20},                                   // above
            {x: 400, y: grid.originY + grid.rows * grid.tileSize + 20},       // below, beside Start
        ];
        for (const point of outside) {
            await pointerAt(page, cellCenter(grid, 3, 4), state);
            await expectSelected(page, 3, 4);
            await pointerAt(page, point, state);
            await expectCleared(page);
        }
    });
}

test.describe('desktop mouse', () => {
    test.use({viewport: {width: 1280, height: 720}});
    selectionSuite(clickWorld);
});

test.describe('mobile landscape touch', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});
    selectionSuite(tapWorld);
});
