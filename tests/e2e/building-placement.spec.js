import {test, expect} from '@playwright/test';
import {boot, body, byAction, clickAction, clickWorld, tapAction, tapWorld, worldToScreen} from '../helpers/canvas.js';
import {sample} from '../helpers/qa.js';

/**
 * Building placement through real canvas input. Grid cells have no DOM
 * proxies: grid presses target canvas points derived from the grid's QA
 * snapshot. Menu buttons are real UI, pressed through their proxies.
 *
 * QA exposes both the domain validation result (placement.preview) and the
 * rendered preview (previewView). Tests check that the rendered colour
 * follows the domain result.
 */

const VALID_COLOR = 0x4caf50;
const INVALID_COLOR = 0xe53935;

const cellCenter = (grid, col, row) => ({
    x: grid.originX + (col + 0.5) * grid.tileSize,
    y: grid.originY + (row + 0.5) * grid.tileSize,
});

const footprintRect = (grid, {col, row, width, height}) => ({
    x: grid.originX + col * grid.tileSize,
    y: grid.originY + row * grid.tileSize,
    width: width * grid.tileSize,
    height: height * grid.tileSize,
});

const occupantsFrom = (buildings) => buildings.map(({id, col, row, width, height}) => ({id, col, row, width, height}));

function placementSuite({pressWorld, pressAction}) {
    async function start(page) {
        await boot(page, {scene: 'game', waitForQA: true});
        await clickAction(page, 'start');
        await expect(body(page)).toHaveAttribute('data-phase', 'started');
        return sample(page);
    }

    async function pressCell(page, state, col, row) {
        await pressWorld(page, cellCenter(state.grid, col, row), state);
    }

    async function choose(page, typeId) {
        await pressAction(page, `build-${typeId}`);
        await expect.poll(async () => (await sample(page)).placement.selectedType).toBe(typeId);
    }

    async function waitForBuildingCount(page, n) {
        await expect.poll(async () => (await sample(page)).buildings.length).toBe(n);
    }

    test('build menu appears after Start; Cancel only while placing', async ({page}) => {
        const state = await start(page);
        await expect(byAction(page, 'build-outpost')).toHaveCount(1);
        await expect(byAction(page, 'build-factory')).toHaveCount(1);
        await expect(byAction(page, 'cancel-placement')).toHaveCount(0);
        expect(state.ui.cancelVisible).toBe(false);
        expect(state.placement).toEqual({selectedType: null, preview: null, lastResult: null});

        await choose(page, 'factory');
        await expect(byAction(page, 'cancel-placement')).toHaveCount(1);
        await expect(byAction(page, 'build-factory')).toHaveAttribute('data-selected', 'true');
        await expect(byAction(page, 'build-outpost')).toHaveAttribute('data-selected', 'false');
        expect((await sample(page)).ui.cancelVisible).toBe(true);
    });

    test('pressing UI buttons never places a building', async ({page}) => {
        await start(page);
        await choose(page, 'factory');
        await choose(page, 'outpost');
        await choose(page, 'factory');
        await pressAction(page, 'cancel-placement');
        await expect.poll(async () => (await sample(page)).placement.selectedType).toBeNull();

        const state = await sample(page);
        expect(state.buildings).toEqual([]);
        expect(state.buildingViews).toEqual([]);
        expect(state.grid.occupants).toEqual([]);
    });

    test('valid placement creates graybox buildings, occupies cells and stays in placement mode', async ({page}) => {
        const state = await start(page);

        await choose(page, 'outpost');
        await pressCell(page, state, 2, 2);
        await waitForBuildingCount(page, 1);
        await pressCell(page, state, 4, 2);
        await waitForBuildingCount(page, 2);

        await choose(page, 'factory');
        await pressCell(page, state, 10, 8);
        await waitForBuildingCount(page, 3);

        const after = await sample(page);
        expect(after.placement.selectedType).toBe('factory');
        expect(after.buildings).toEqual([
            {id: 'outpost-1', type: 'outpost', col: 2, row: 2, width: 1, height: 1, enabled: true, hp: 100},
            {id: 'outpost-2', type: 'outpost', col: 4, row: 2, width: 1, height: 1, enabled: true, hp: 100},
            {id: 'factory-3', type: 'factory', col: 9, row: 7, width: 3, height: 3, enabled: true, hp: 300},
        ]);
        expect(after.grid.occupants).toEqual(occupantsFrom(after.buildings));
        expect(after.buildingViews).toEqual(after.buildings.map((b) => ({
            id: b.id, visible: true, ...footprintRect(after.grid, b), fillColor: expect.any(Number),
            strokeColor: expect.any(Number), alpha: 1,
        })));
        // Selection is disabled while placing.
        expect(after.selectedCell).toBeNull();
    });

    test('overlapping placement is rejected: red preview, no grid or building change', async ({page}) => {
        const state = await start(page);
        await choose(page, 'factory');
        await pressCell(page, state, 10, 8);
        await waitForBuildingCount(page, 1);
        const before = await sample(page);

        await pressCell(page, state, 11, 9); // overlaps factory-1
        await expect.poll(async () => (await sample(page)).placement.preview?.footprint)
            .toEqual({col: 10, row: 8, width: 3, height: 3});
        const after = await sample(page);

        expect(after.placement.preview).toEqual({
            footprint: {col: 10, row: 8, width: 3, height: 3}, ok: false, reason: 'occupied', blockers: ['factory-1'],
        });
        expect(after.previewView).toMatchObject({
            visible: true, fillColor: INVALID_COLOR, strokeColor: INVALID_COLOR,
            ...footprintRect(after.grid, after.placement.preview.footprint),
        });
        expect(after.buildings).toEqual(before.buildings);
        expect(after.grid).toEqual(before.grid);

        await choose(page, 'outpost');
        await pressCell(page, state, 10, 8);
        await expect.poll(async () => (await sample(page)).placement.preview?.reason).toBe('occupied');
        expect((await sample(page)).buildings).toEqual(before.buildings);
    });

    test('edge placement out of bounds is rejected with red preview', async ({page}) => {
        const state = await start(page);
        await choose(page, 'factory');

        for (const [col, row, expectedFootprint] of [
            [0, 5, {col: -1, row: 4, width: 3, height: 3}],
            [23, 15, {col: 22, row: 14, width: 3, height: 3}],
        ]) {
            await pressCell(page, state, col, row);
            await expect.poll(async () => (await sample(page)).placement.preview?.footprint).toEqual(expectedFootprint);
            const s = await sample(page);
            expect(s.placement.preview).toMatchObject({ok: false, reason: 'out-of-bounds'});
            expect(s.previewView).toMatchObject({visible: true, fillColor: INVALID_COLOR});
        }
        const after = await sample(page);
        expect(after.buildings).toEqual([]);
        expect(after.grid.occupants).toEqual([]);

        // Flush against the edge is valid.
        await pressCell(page, state, 22, 14);
        await waitForBuildingCount(page, 1);
        expect((await sample(page)).buildings[0]).toMatchObject({col: 21, row: 13});
    });

    test('Cancel button leaves placement mode; grid presses then select instead of placing', async ({page}) => {
        const state = await start(page);
        await choose(page, 'outpost');
        await pressAction(page, 'cancel-placement');

        await expect.poll(async () => (await sample(page)).placement.selectedType).toBeNull();
        await expect(byAction(page, 'cancel-placement')).toHaveCount(0);
        await expect(byAction(page, 'build-outpost')).toHaveAttribute('data-selected', 'false');
        const cancelled = await sample(page);
        expect(cancelled.ui.cancelVisible).toBe(false);
        expect(cancelled.previewView.visible).toBe(false);

        await pressCell(page, state, 6, 6);
        await expect.poll(async () => (await sample(page)).selectedCell).toEqual({col: 6, row: 6});
        expect((await sample(page)).buildings).toEqual([]);
    });

    test('Escape leaves placement mode', async ({page}) => {
        const state = await start(page);
        await choose(page, 'factory');
        await page.keyboard.press('Escape');

        await expect.poll(async () => (await sample(page)).placement.selectedType).toBeNull();
        await expect(byAction(page, 'cancel-placement')).toHaveCount(0);

        await pressCell(page, state, 12, 8);
        await expect.poll(async () => (await sample(page)).selectedCell).toEqual({col: 12, row: 8});
        expect((await sample(page)).buildings).toEqual([]);
    });
}

test.describe('desktop mouse', () => {
    test.use({viewport: {width: 1280, height: 720}});
    placementSuite({pressWorld: clickWorld, pressAction: clickAction});

    test('hover shows a green preview derived from a valid domain result; leaving the grid hides it', async ({page}) => {
        await boot(page, {scene: 'game', waitForQA: true});
        await clickAction(page, 'start');
        const state = await sample(page);
        await clickAction(page, 'build-factory');

        const p = await worldToScreen(page, cellCenter(state.grid, 6, 6), state);
        await page.mouse.move(p.x, p.y);
        await expect.poll(async () => (await sample(page)).placement.preview?.ok).toBe(true);
        const s = await sample(page);
        expect(s.placement.preview.footprint).toEqual({col: 5, row: 5, width: 3, height: 3});
        expect(s.previewView).toEqual({
            visible: true, ...footprintRect(s.grid, s.placement.preview.footprint),
            fillColor: VALID_COLOR, strokeColor: VALID_COLOR,
        });
        expect(s.buildings).toEqual([]); // hover never places

        const off = await worldToScreen(page, {x: 1150, y: 360}, state);
        await page.mouse.move(off.x, off.y);
        await expect.poll(async () => (await sample(page)).previewView.visible).toBe(false);
        expect((await sample(page)).placement.preview).toBeNull();
    });
});

test.describe('mobile landscape touch', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});
    placementSuite({pressWorld: tapWorld, pressAction: tapAction});
});
