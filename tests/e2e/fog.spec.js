import {test, expect} from '@playwright/test';
import {byAction, clickAction, clickWorld, tapAction, tapOnce, tapWorld} from '../helpers/canvas.js';
import {cellCenter, hqFlow, qaSim, stepExactly} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/** Fog of War on the map a new game gets, through real input. */

const mouse = {pressWorld: clickWorld, pressAction: clickAction};
const touch = {pressWorld: tapWorld, pressAction: tapAction};
const newGame = (page, flow, query = 'mutants=off') => hqFlow(flow).start(page, query, {map: null});
const fogAt = ({fog}, {col, row}) => fog.rows[row][col];
const [UNEXPLORED, EXPLORED, VISIBLE] = ['#', '~', 'O'];

/** A tile of the clearing's top row, from which an Outpost looks well past HQ. */
const northEdge = ({terrain: {rows, center}}) => {
    let row = center.row;
    while (rows[row - 1][center.col] !== '#') row--;
    return {col: center.col, row};
};
const beyond = ({col, row}) => ({col, row: row - 10});

test.describe('fog: desktop', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('a run starts knowing only the clearing, and HQ makes it live', async ({page}) => {
        const state = await newGame(page, mouse);
        expect(state.fog.counts.visible).toBe(0);
        expect(fogAt(state, state.terrain.center)).toBe(EXPLORED);
        expect(fogAt(state, {col: 0, row: 0})).toBe(UNEXPLORED);
        await hqFlow(mouse).buildHq(page, state, state.terrain.center);
        const s = await sample(page);
        expect(fogAt(s, state.terrain.center)).toBe(VISIBLE);
        expect(s.fog.counts.visible).toBeGreaterThan(100);
        expect(fogAt(s, {col: 0, row: 0})).toBe(UNEXPLORED);
        expect(s.fogView).toMatchObject({x: s.grid.originX, y: s.grid.originY, width: 48 * 32, height: 32 * 32});
    });

    test('the open map has no fog at all', async ({page}) => {
        const state = await hqFlow(mouse).start(page, 'mutants=off');
        expect(state.fog).toBeNull();
        expect(state.fogView).toBeNull();
    });

    test('an Outpost reveals territory, and switching it off leaves it explored', async ({page}) => {
        const state = await newGame(page, mouse);
        const {buildHq, place, select} = hqFlow(mouse);
        await buildHq(page, state, state.terrain.center);
        const tile = northEdge(state);
        const far = beyond(tile);
        expect(fogAt(await sample(page), far)).toBe(UNEXPLORED);

        await place(page, state, 'outpost', tile);
        await expect.poll(async () => fogAt(await sample(page), far)).toBe(VISIBLE);
        const lit = await sample(page);
        expect(lit.power.status).toBe('normal');

        await select(page, state, tile, lit.buildings.find((b) => b.type === 'outpost').id);
        await clickAction(page, 'toggle-power');
        await expect.poll(async () => fogAt(await sample(page), far)).toBe(EXPLORED);
        await clickAction(page, 'toggle-power');
        await expect.poll(async () => fogAt(await sample(page), far)).toBe(VISIBLE);
    });

    test('the camera changes nothing: panning, zooming and FIT reveal no tile, and the fog stays on the grid', async ({page}) => {
        const state = await newGame(page, mouse);
        await hqFlow(mouse).buildHq(page, state, state.terrain.center);
        const before = await sample(page);
        await clickAction(page, 'camera-zoom-in');
        await clickAction(page, 'camera-zoom-in');
        for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');
        await clickAction(page, 'camera-fit');
        for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowDown');
        const after = await sample(page);
        expect(after.camera.zoom).not.toBe(before.camera.zoom);
        expect(after.fog).toEqual(before.fog);
        expect(after.fogView).toEqual(before.fogView);
    });

    test('a placement preview sits above the fog, even on a tile the fog hides', async ({page}) => {
        const state = await newGame(page, mouse);
        await hqFlow(mouse).buildHq(page, state, state.terrain.center);
        await clickAction(page, 'build-outpost');
        await clickAction(page, 'camera-fit');
        await clickWorld(page, cellCenter(state.grid, {col: 3, row: 3}), state);
        await expect.poll(async () => (await sample(page)).placement.lastResult?.reason).toBe('terrain-blocked');
        const s = await sample(page);
        expect(s.previewView.visible).toBe(true);
        expect(s.fogView.depth).toBeLessThan(3); // RING_PREVIEW_DEPTH and previewRect, the lowest of them
        expect(s.buildings).toHaveLength(1);
    });

    test('a mutant on a tile nobody is watching is not drawn or counted, though it exists', async ({page}) => {
        const state = await newGame(page, mouse, 'waveBudget=8');
        const {buildHq, nightTo} = hqFlow(mouse);
        await buildHq(page, state, state.terrain.center);
        await nightTo(page, 1200);
        const s = await sample(page);
        expect(s.mutants.length).toBeGreaterThan(1);
        const tileOf = ({x, y}) => ({col: Math.floor((x - s.grid.originX) / 32), row: Math.floor((y - s.grid.originY) / 32)});
        const seen = s.mutants.filter((mutant) => fogAt(s, tileOf(mutant)) === VISIBLE);
        expect(seen.length).toBeLessThan(s.mutants.length);
        for (const view of s.mutantViews) {
            expect(view.visible, view.id).toBe(seen.some(({id}) => id === view.id));
        }
        expect(s.waveView.text).toContain(`Mutants ${seen.length} |`);
    });

    test('a marching squad lights its way, and at dawn what it found stays explored', async ({page}) => {
        const state = await newGame(page, mouse);
        const {buildHq, place, select, nightTo, finishNight} = hqFlow(mouse);
        const {center: {col, row}} = state.terrain;
        await buildHq(page, state, state.terrain.center);
        await clickAction(page, 'build-road');
        await clickWorld(page, cellCenter(state.grid, {col: col + 3, row: row + 2}), state);
        await expect.poll(async () => (await sample(page)).roads.tiles.length).toBe(17);
        await clickAction(page, 'cancel-placement');
        await place(page, state, 'powerPlant', {col: col + 4, row: row - 2});
        await place(page, state, 'barracks', {col: col + 5, row: row + 2});

        const flag = {col: col + 3, row: row + 10};
        const far = {col: flag.col, row: flag.row + 3}; // beyond anything standing, near the post
        expect(fogAt(await sample(page), far)).toBe(UNEXPLORED);
        await select(page, state, {col: col + 5, row: row + 2}, (await sample(page)).buildings.find((b) => b.type === 'barracks').id);
        await clickAction(page, 'set-flag');
        await clickAction(page, 'camera-fit');
        await clickWorld(page, cellCenter(state.grid, flag), state);
        await expect.poll(async () => (await sample(page)).flagMode).toBeNull();

        await nightTo(page, 900);
        const marching = await sample(page);
        expect(marching.infantry.soldiers.length).toBeGreaterThan(0);
        expect(fogAt(marching, far)).toBe(VISIBLE);
        await finishNight(page);
        const dawn = await sample(page);
        expect(fogAt(dawn, far)).toBe(EXPLORED);
    });
});

for (const [label, viewport] of [['844x390', {width: 844, height: 390}], ['740x360', {width: 740, height: 360}]]) {
    test.describe(`fog: touch ${label}`, () => {
        test.use({viewport, hasTouch: true, isMobile: true});

        test('an Outpost goes down through the ghost and its confirming tap, and reveals territory', async ({page}) => {
            const state = await newGame(page, touch);
            await hqFlow(touch).buildHq(page, state, state.terrain.center);
            const tile = northEdge(state);
            await tapAction(page, 'build-outpost');
            await expect.poll(async () => (await sample(page)).ghost.active).toBe(true);
            await tapOnce(page, cellCenter(state.grid, tile), state);
            await expect.poll(async () => (await sample(page)).ghost.cell).toEqual(tile);
            expect((await sample(page)).previewView.visible).toBe(true);
            expect((await sample(page)).buildings).toHaveLength(1);
            await tapOnce(page, cellCenter(state.grid, tile), state);
            await expect.poll(async () => fogAt(await sample(page), beyond(tile))).toBe(VISIBLE);
        });

        test('the HUD stays pressable over the fog', async ({page}) => {
            const state = await newGame(page, touch);
            await hqFlow(touch).buildHq(page, state, state.terrain.center);
            await tapAction(page, 'camera-fit');
            await expect.poll(async () => {
                const {camera} = await sample(page);
                return camera.zoom === camera.fitZoom;
            }).toBe(true);
            await tapAction(page, 'open-build');
            await expect.poll(async () => (await sample(page)).ui.drawerOpen).toBe(true);
            await expect(byAction(page, 'build-outpost')).toBeVisible();
        });
    });
}

test('stepping the simulation by hand drives the fog exactly as frames do', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 720});
    const state = await newGame(page, mouse, 'mutants=off');
    await hqFlow(mouse).buildHq(page, state, state.terrain.center);
    const before = (await sample(page)).fog;
    await clickAction(page, 'end-day');
    await qaSim(page, 'pause');
    await stepExactly(page, 60);
    expect((await sample(page)).fog).toEqual(before); // nothing moved, so nothing was recalculated
});
