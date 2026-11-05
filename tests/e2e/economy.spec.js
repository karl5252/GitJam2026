import {test, expect} from '@playwright/test';
import {boot, body, clickAction, clickWorld, tapAction, tapWorld, worldToScreen} from '../helpers/canvas.js';
import {sample} from '../helpers/qa.js';

/**
 * Credits + AP through real canvas input. HUD assertions read the actual
 * Phaser Text (hudView) and compare it with the domain balances (resources).
 */

const INVALID_COLOR = 0xe53935;

const cellCenter = (grid, col, row) => ({
    x: grid.originX + (col + 0.5) * grid.tileSize,
    y: grid.originY + (row + 0.5) * grid.tileSize,
});

const hudText = ({credits, ap}) => `Credits: ${credits}   AP: ${ap}`;

async function start(page) {
    // hq: false: it asserts exact starting state and menu data, without HQ.
    await boot(page, {scene: 'game', waitForQA: true, hq: false});
    await clickAction(page, 'start');
    await expect(body(page)).toHaveAttribute('data-phase', 'started');
    return sample(page);
}

async function expectResources(page, resources) {
    await expect.poll(async () => (await sample(page)).resources).toEqual(resources);
    expect((await sample(page)).hudView).toEqual({visible: true, text: hudText(resources)});
}

function economySuite({pressWorld, pressAction}) {
    const pressCell = (page, state, col, row) => pressWorld(page, cellCenter(state.grid, col, row), state);

    async function choose(page, typeId) {
        await pressAction(page, `build-${typeId}`);
        await expect.poll(async () => (await sample(page)).placement.selectedType).toBe(typeId);
    }

    async function placeOk(page, state, col, row, expectedCount) {
        await pressCell(page, state, col, row);
        await expect.poll(async () => (await sample(page)).buildings.length).toBe(expectedCount);
        expect((await sample(page)).placement.lastResult).toEqual({ok: true});
    }

    async function expectRejected(page, state, col, row, reason) {
        const before = await sample(page);
        await pressCell(page, state, col, row);
        await expect.poll(async () => (await sample(page)).placement.lastResult?.reason).toBe(reason);
        const after = await sample(page);
        expect(after.buildings).toEqual(before.buildings);
        expect(after.grid).toEqual(before.grid);
        expect(after.resources).toEqual(before.resources);
        expect(after.hudView).toEqual(before.hudView);
        expect(after.placement.preview).toMatchObject({ok: false, reason});
        expect(after.previewView).toMatchObject({visible: true, fillColor: INVALID_COLOR});
    }

    test('HUD shows starting balances and buttons show costs', async ({page}) => {
        const state = await start(page);
        expect(state.resources).toEqual({credits: 1000, ap: 5});
        expect(state.hudView).toEqual({visible: true, text: 'Credits: 1000   AP: 5'});
        expect(state.menuLabels).toEqual({
            outpost: 'Outpost 1x1\n100c · 1 AP',
            factory: 'Factory 3x3\n400c · 1 AP',
            powerPlant: 'Power Plant 3x3\n500c · 1 AP',
            autocannon: 'Autocannon 1x1\n250c · 1 AP',
        });
    });

    test('HUD updates after each successful placement', async ({page}) => {
        const state = await start(page);
        await choose(page, 'outpost');
        await placeOk(page, state, 2, 2, 1);
        await expectResources(page, {credits: 900, ap: 4});

        await choose(page, 'factory');
        await placeOk(page, state, 10, 8, 2);
        await expectResources(page, {credits: 500, ap: 3});
    });

    test('overlap and out-of-bounds attempts do not deduct credits or AP', async ({page}) => {
        const state = await start(page);
        await choose(page, 'factory');
        await placeOk(page, state, 10, 8, 1);
        await expectResources(page, {credits: 600, ap: 4});

        await expectRejected(page, state, 11, 9, 'occupied');
        await expectRejected(page, state, 0, 5, 'out-of-bounds');
        await expectResources(page, {credits: 600, ap: 4});
    });

    test('unaffordable factory on free cells: invalid preview, rejected, nothing deducted', async ({page}) => {
        const state = await start(page);
        await choose(page, 'factory');
        await placeOk(page, state, 3, 3, 1);
        await placeOk(page, state, 8, 3, 2);
        await expectResources(page, {credits: 200, ap: 3});

        await expectRejected(page, state, 15, 10, 'insufficient-credits');
        const after = await sample(page);
        // The footprint's cells are genuinely free — only resources block it.
        const {col, row} = after.placement.preview.footprint;
        const occupied = after.grid.occupants.some((o) =>
            col < o.col + o.width && o.col < col + 3 && row < o.row + o.height && o.row < row + 3);
        expect(occupied).toBe(false);
        await expectResources(page, {credits: 200, ap: 3});
    });

    test('out of AP: sixth outpost is rejected with no changes', async ({page}) => {
        const state = await start(page);
        await choose(page, 'outpost');
        for (let i = 0; i < 5; i++) await placeOk(page, state, 1 + i * 2, 1, i + 1);
        await expectResources(page, {credits: 500, ap: 0});

        await expectRejected(page, state, 12, 8, 'insufficient-ap');
        await expectResources(page, {credits: 500, ap: 0});
    });
}

test.describe('desktop mouse', () => {
    test.use({viewport: {width: 1280, height: 720}});
    economySuite({pressWorld: clickWorld, pressAction: clickAction});

    test('hovering an unaffordable footprint shows an invalid preview without charging', async ({page}) => {
        const state = await start(page);
        await clickAction(page, 'build-factory');
        await clickWorld(page, cellCenter(state.grid, 3, 3), state);
        await clickWorld(page, cellCenter(state.grid, 8, 3), state);
        await expectResources(page, {credits: 200, ap: 3});

        const p = await worldToScreen(page, cellCenter(state.grid, 15, 10), state);
        await page.mouse.move(p.x, p.y);
        await expect.poll(async () => (await sample(page)).placement.preview?.reason).toBe('insufficient-credits');
        const s = await sample(page);
        expect(s.placement.preview.footprint).toEqual({col: 14, row: 9, width: 3, height: 3});
        expect(s.previewView).toMatchObject({visible: true, fillColor: INVALID_COLOR, strokeColor: INVALID_COLOR});
        expect(s.buildings.length).toBe(2);
        await expectResources(page, {credits: 200, ap: 3});
    });
});

test.describe('mobile landscape touch', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});
    economySuite({pressWorld: tapWorld, pressAction: tapAction});
});
