import {readFileSync} from 'node:fs';
import {test, expect} from '@playwright/test';
import {boot, body, byAction, clickAction, clickWorld, tapAction, tapOnce, tapWorld, worldToScreen} from '../helpers/canvas.js';
import {cellCenter, hqFlow, stepExactly} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * The map a real new game gets, through real input. Every other suite runs on the
 * open map (see boot()), so this is the one that asks for no map at all.
 */

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/layouts/${name}.json`, import.meta.url), 'utf8'));
const JUNGLE_TILE = {col: 4, row: 4};
const mouse = {pressWorld: clickWorld, pressAction: clickAction};
const touch = {pressWorld: tapWorld, pressAction: tapAction};
const newGame = (page, flow, query = 'mutants=off') => hqFlow(flow).start(page, query, {map: null});

const tile = (state, {col, row}) => ({
    x: state.grid.originX + col * state.grid.tileSize,
    y: state.grid.originY + row * state.grid.tileSize,
});

/** A first base, through the real menu: HQ, the road to a Factory dock, a Factory and a Plant. */
async function openingBase(page, flow, state) {
    const {buildHq, place} = hqFlow(flow);
    const {center} = state.terrain;
    await buildHq(page, state, center);
    await flow.pressAction(page, 'build-road');
    await flow.pressWorld(page, cellCenter(state.grid, {col: center.col - 3, row: center.row}), state);
    await expect.poll(async () => (await sample(page)).roads.tiles.length).toBe(17);
    await flow.pressAction(page, 'cancel-placement');
    await place(page, state, 'powerPlant', {col: center.col + 4, row: center.row});
    await place(page, state, 'factory', {col: center.col - 5, row: center.row});
}

test.describe('jungle: a new game', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('asks for no map and gets the 48x32 jungle: empty, with HQ left to the player @smoke', async ({page}) => {
        const state = await newGame(page, mouse);
        expect(state.map).toMatchObject({id: 'jungle', cols: 48, rows: 32, seed: 731});
        expect(state.grid).toMatchObject({cols: 48, rows: 32, tileSize: 32});
        expect(state.terrain.rows.join('')).toContain('#');
        expect(state.buildings).toEqual([]);
        expect(state.roads.tiles).toEqual([]);
        expect(state.menuState.hq).toBe('available');
        expect(state.resources).toEqual({credits: 1250, ap: 5});

        await openingBase(page, mouse, state);
        const built = await sample(page);
        expect(built.buildings.map((b) => b.type)).toEqual(['hq', 'powerPlant', 'factory']);
        expect(built.power.status).toBe('normal');
    });

    test('the terrain is one image on the grid, and the same seed is the same map', async ({page}) => {
        const first = await newGame(page, mouse);
        expect(first.terrainView).toMatchObject({x: first.grid.originX, y: first.grid.originY, width: 48 * 32, height: 32 * 32});
        await boot(page, {scene: 'game', waitForQA: true, map: null, query: 'mutants=off'});
        await clickAction(page, 'start');
        await expect(body(page)).toHaveAttribute('data-phase', 'started');
        expect((await sample(page)).terrain).toEqual(first.terrain);
        // TASK 039: the same seed plants the same jungle, all of it standing.
        const {plants, plantsStanding} = (await sample(page)).terrainView;
        expect({plants, plantsStanding}).toEqual({plants: first.terrainView.plants, plantsStanding: first.terrainView.plants});
        expect(plants).toBeGreaterThan(1000);
    });

    test('?worldSeed changes the terrain and not the wave RNG; ?seed does the reverse', async ({page}) => {
        const base = await newGame(page, mouse);
        const other = await newGame(page, mouse, 'mutants=off&worldSeed=9');
        expect(other.map.seed).toBe(9);
        expect(other.terrain.rows).not.toEqual(base.terrain.rows);
        expect(other.simulation.rng).toEqual(base.simulation.rng);
        const reseeded = await newGame(page, mouse, 'mutants=off&seed=99');
        expect(reseeded.terrain).toEqual(base.terrain);
        expect(reseeded.simulation.rng.seed).toBe(99);
    });

    test('a press on jungle builds nothing and says why, and the clearing beside it builds', async ({page}) => {
        const state = await newGame(page, mouse);
        await clickAction(page, 'camera-fit');
        await clickAction(page, 'build-hq');
        await clickWorld(page, cellCenter(state.grid, JUNGLE_TILE), state);
        await expect.poll(async () => (await sample(page)).placement.lastResult?.reason).toBe('terrain-blocked');
        const refused = await sample(page);
        expect(refused.placementHint).toBe('Dense jungle: build in the clearing');
        expect(refused.buildings).toEqual([]);
        expect(refused.resources).toEqual(state.resources);
        expect(refused.previewView.fillColor).toBe(0xe53935);
        await clickWorld(page, cellCenter(state.grid, state.terrain.center), state);
        await expect.poll(async () => (await sample(page)).menuState.hq).toBe('built');
    });

    test('the road tool stops at the jungle', async ({page}) => {
        const state = await newGame(page, mouse);
        await hqFlow(mouse).buildHq(page, state, state.terrain.center);
        await clickAction(page, 'build-road');
        await clickAction(page, 'camera-fit');
        await clickWorld(page, cellCenter(state.grid, JUNGLE_TILE), state);
        await expect.poll(async () => (await sample(page)).placement.lastResult?.reason).toBe('terrain-blocked');
        expect((await sample(page)).roads.tiles).toHaveLength(16);
    });
});

test.describe('jungle: camera', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('FIT shows the whole larger world, and the view opens on the clearing at the old scale', async ({page}) => {
        await newGame(page, mouse);
        const opening = (await sample(page)).camera;
        expect(opening).toMatchObject({zoom: 1, x: 640, y: 360});
        await clickAction(page, 'camera-fit');
        await expect.poll(async () => {
            const {camera} = await sample(page);
            return camera.zoom === camera.fitZoom;
        }).toBe(true);
        const {camera, terrainView} = await sample(page);
        expect(camera.fitZoom).toBeCloseTo(800 / (48 * 32 + 32), 5);
        expect({x: camera.x, y: camera.y}).toEqual({x: terrainView.x + terrainView.width / 2, y: terrainView.y + terrainView.height / 2});
    });

    test('panning reaches every edge of the world and stops there, and a press still finds its tile', async ({page}) => {
        const state = await newGame(page, mouse);
        const {cols, rows} = state.grid;
        for (const key of ['ArrowRight', 'ArrowDown']) {
            for (let i = 0; i < 30; i++) await page.keyboard.press(key);
        }
        const {camera} = await sample(page);
        const right = state.grid.originX + cols * 32 + 16;
        const bottom = state.grid.originY + rows * 32 + 16;
        expect(camera.x + camera.viewport.width / 2 / camera.zoom).toBeCloseTo(right, 5);
        expect(camera.y + camera.viewport.height / 2 / camera.zoom).toBeCloseTo(bottom, 5);
        const corner = {col: cols - 1, row: rows - 1};
        await clickWorld(page, cellCenter(state.grid, corner), state);
        await expect.poll(async () => (await sample(page)).selectedCell).toEqual(corner);
    });

    for (const presses of [0, 1, 3]) {
        test(`the preview sits on its tile ${presses} zoom steps in`, async ({page}) => {
            const state = await newGame(page, mouse);
            for (let i = 0; i < presses; i++) await clickAction(page, 'camera-zoom-in');
            await clickAction(page, 'build-hq');
            const {center} = state.terrain;
            const at = await worldToScreen(page, cellCenter(state.grid, center), state);
            await page.mouse.move(at.x, at.y);
            await expect.poll(async () => (await sample(page)).previewView.visible).toBe(true);
            const anchor = {col: center.col - 1, row: center.row - 1};
            expect((await sample(page)).previewView).toMatchObject({...tile(state, anchor), width: 96, height: 96, fillColor: 0x4caf50});
            expect((await sample(page)).terrainView).toMatchObject({x: state.grid.originX, y: state.grid.originY});
        });
    }

    test('a HUD press over the map reaches only the HUD', async ({page}) => {
        const state = await newGame(page, mouse);
        await clickAction(page, 'build-hq');
        for (const action of ['camera-zoom-in', 'camera-zoom-out', 'camera-fit']) await clickAction(page, action);
        const after = await sample(page);
        expect(after.buildings).toEqual([]);
        expect(after.placement.lastResult).toBeNull();
        expect(after.resources).toEqual(state.resources);
    });

    test('Night opens on the fighting at the old scale, mutants come out of the jungle, and FIT still works', async ({page}) => {
        const state = await newGame(page, mouse, 'waveBudget=8');
        await hqFlow(mouse).buildHq(page, state, state.terrain.center);
        await clickAction(page, 'camera-fit');
        await hqFlow(mouse).nightTo(page, 620);
        const night = await sample(page);
        expect(night.camera).toMatchObject({zoom: 1, x: 640, y: 360});
        const [mutant] = night.mutants;
        expect(mutant).toBeTruthy();
        const {col, row, cols, rows} = night.map.spawnFrame;
        const frame = {left: tile(state, {col, row}).x, top: tile(state, {col, row}).y};
        const inside = mutant.x >= frame.left && mutant.x <= frame.left + cols * 32 && mutant.y >= frame.top && mutant.y <= frame.top + rows * 32;
        expect(inside).toBe(true);
        await clickAction(page, 'camera-fit');
        await expect.poll(async () => {
            const {camera} = await sample(page);
            return camera.zoom === camera.fitZoom;
        }).toBe(true);
        await stepExactly(page, (await sample(page)).shiftCycle.remainingNightTicks);
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('day');
    });
});

for (const [label, viewport] of [['844x390', {width: 844, height: 390}], ['740x360', {width: 740, height: 360}]]) {
    test.describe(`jungle: touch ${label}`, () => {
        test.use({viewport, hasTouch: true, isMobile: true});

        test('a whole opening goes down through the ghost and its confirming tap', async ({page}) => {
            // Four touch placements, each a drawer, a ghost and a confirming tap: about 11 s
            // alone, about 15.8 s beside the other workers of a normal run. This test only.
            test.setTimeout(25_000);
            const state = await newGame(page, touch);
            await openingBase(page, touch, state);
            expect((await sample(page)).buildings.map((b) => b.type)).toEqual(['hq', 'powerPlant', 'factory']);
        });

        test('the first ghost lands on open ground, one tap on jungle only moves it there, red, and confirming spends nothing', async ({page}) => {
            const state = await newGame(page, touch);
            await tapAction(page, 'build-hq');
            await expect.poll(async () => (await sample(page)).ghost.active).toBe(true);
            const first = (await sample(page)).ghost;
            expect(first.ok).toBe(true);
            expect(first.cell).toEqual(state.terrain.center);

            await tapAction(page, 'camera-fit');
            await tapOnce(page, cellCenter(state.grid, JUNGLE_TILE), state);
            await expect.poll(async () => (await sample(page)).ghost.cell).toEqual(JUNGLE_TILE);
            const red = await sample(page);
            expect(red.ghost.ok).toBe(false);
            expect(red.placementHint).toBe('Dense jungle: build in the clearing');
            expect(red.previewView).toMatchObject({...tile(state, {col: JUNGLE_TILE.col - 1, row: JUNGLE_TILE.row - 1}), width: 96, height: 96});

            await tapOnce(page, cellCenter(state.grid, JUNGLE_TILE), state);
            await expect.poll(async () => (await sample(page)).ghost.last).toBe('refused');
            const after = await sample(page);
            expect(after.buildings).toEqual([]);
            expect(after.resources).toEqual(state.resources);
        });

        test('a wall proposed on the jungle edge is red, and confirming it lays nothing', async ({page}) => {
            const state = await newGame(page, touch);
            await hqFlow(touch).buildHq(page, state, state.terrain.center);
            const {rows} = state.terrain;
            const {center} = state.terrain;
            const line = rows[center.row];
            let edge = center.col;
            while (line[edge] !== '#') edge++;
            await tapAction(page, 'build-wall');
            await tapAction(page, 'camera-fit');
            await tapOnce(page, cellCenter(state.grid, {col: edge, row: center.row}), state);
            await expect.poll(async () => (await sample(page)).ghost.segment.length).toBe(1);
            const {ghost} = await sample(page);
            expect(ghost.segment[0]).toMatchObject({ok: false, reason: 'terrain-blocked'});
            await tapOnce(page, cellCenter(state.grid, {col: edge, row: center.row}), state);
            await expect.poll(async () => (await sample(page)).ghost.last).toBe('refused');
            expect((await sample(page)).buildings).toHaveLength(1);
        });

        test('no hint shows until there is one: its box must not sit on the terrain', async ({page}) => {
            await newGame(page, touch);
            expect((await sample(page)).ui.hintVisible).toBe(false);
        });

        test('Night frames the fighting and every control still answers', async ({page}) => {
            const state = await newGame(page, touch);
            await hqFlow(touch).buildHq(page, state, state.terrain.center);
            await tapAction(page, 'end-day');
            await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('night');
            const {camera} = await sample(page);
            expect(camera.zoom).toBeCloseTo(658 / 544, 5);
            for (const action of ['camera-zoom-in', 'camera-zoom-out', 'camera-fit', 'speed-2']) await expect(byAction(page, action)).toBeVisible();
        });
    });
}

test.describe('open map', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('is still the bare 24x16 battlefield, and has no terrain', async ({page}) => {
        const state = await hqFlow(mouse).start(page, 'mutants=off');
        expect(state.map).toMatchObject({id: 'open', cols: 24, rows: 16, spawnFrame: null});
        expect(state.grid).toMatchObject({cols: 24, rows: 16, tileSize: 32, originX: 256, originY: 104});
        expect(state.terrain).toBeNull();
        expect(state.terrainView).toBeNull();
        expect(state.camera).toMatchObject({zoom: 1, x: 640, y: 360});
    });

    for (const name of ['golden-fortress-day33-v2', 'golden-fortress-brute-defense-v3']) {
        test(`${name} loads here exactly as stored, and is refused on the jungle`, async ({page}) => {
            const snapshot = fixture(name);
            await hqFlow(mouse).start(page, 'mutants=off');
            expect(await page.evaluate((s) => window.__qa.layout.load(s), snapshot)).toMatchObject({ok: true});
            expect(await page.evaluate(() => window.__qa.layout.export())).toEqual(snapshot);

            const jungle = await newGame(page, mouse);
            expect(await page.evaluate((s) => window.__qa.layout.load(s), snapshot)).toEqual({ok: false, reason: 'grid-mismatch'});
            expect((await sample(page)).buildings).toEqual([]);
            expect((await sample(page)).resources).toEqual(jungle.resources);
        });
    }
});
