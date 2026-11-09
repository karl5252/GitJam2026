import {test, expect} from '@playwright/test';
import {byAction, clickAction, clickWorld, tapAction, tapOnce, tapWorld} from '../helpers/canvas.js';
import {cellCenter, hqFlow, qaSim, stepExactly} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/** HQ's workers on the map a new game gets, through real input. */

const mouse = {pressWorld: clickWorld, pressAction: clickAction};
const touch = {pressWorld: tapWorld, pressAction: tapAction};
const newGame = (page, flow, query = 'mutants=off') => hqFlow(flow).start(page, query, {map: null});
const fogAt = ({fog}, {col, row}) => fog.rows[row][col];
const FAR = {col: 6, row: 6}; // deep jungle on the default seed, unexplored at the start

async function selectHq(page, flow, state) {
    await flow.pressWorld(page, cellCenter(state.grid, state.terrain.center), state);
    await expect.poll(async () => (await sample(page)).selectedBuilding).toMatch(/^hq-/);
}

async function setWorkFlag(page, flow, state, cell) {
    await flow.pressAction(page, 'set-flag');
    await expect.poll(async () => (await sample(page)).flagMode).toMatch(/^hq-/);
    await flow.pressAction(page, 'camera-fit');
    await flow.pressWorld(page, cellCenter(state.grid, cell), state);
    await expect.poll(async () => (await sample(page)).workers.flag).toEqual(cell);
}

async function baseWithHq(page, flow) {
    const state = await newGame(page, flow);
    await hqFlow(flow).buildHq(page, state, state.terrain.center);
    return state;
}

test.describe('workers: desktop', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('selecting HQ offers SEND WORKERS; a flag turns it to MOVE FLAG and offers RECALL WORKERS', async ({page}) => {
        const state = await baseWithHq(page, mouse);
        await selectHq(page, mouse, state);
        let view = (await sample(page)).buildingControlsView;
        expect(view).toMatchObject({flagVisible: true, flagLabel: 'SEND\nWORKERS', resetVisible: false, demolishVisible: false});

        await setWorkFlag(page, mouse, state, FAR);
        const s = await sample(page);
        expect(s.flagMode).toBeNull();
        expect(s.selectedBuilding).toMatch(/^hq-/); // back on HQ, as a Barracks is
        view = s.buildingControlsView;
        expect(view).toMatchObject({flagLabel: 'MOVE\nFLAG', resetVisible: true, resetLabel: 'RECALL\nWORKERS'});
        expect(s.workerViews.flag).toMatchObject(FAR);
    });

    test('a Barracks keeps its own flag labels', async ({page}) => {
        const state = await baseWithHq(page, mouse);
        const {col, row} = state.terrain.center;
        const {place, select} = hqFlow(mouse);
        await clickAction(page, 'build-road');
        await clickWorld(page, cellCenter(state.grid, {col: col + 3, row: row + 2}), state);
        await expect.poll(async () => (await sample(page)).roads.tiles.length).toBe(17);
        await clickAction(page, 'cancel-placement');
        await place(page, state, 'powerPlant', {col: col + 4, row: row - 2});
        await place(page, state, 'barracks', {col: col + 5, row: row + 2});
        await select(page, state, {col: col + 5, row: row + 2}, (await sample(page)).buildings.find((b) => b.type === 'barracks').id);
        expect((await sample(page)).buildingControlsView).toMatchObject({flagLabel: 'SET\nFLAG', resetVisible: false});
    });

    test('a flag in unexplored jungle is allowed, costs nothing and reveals nothing', async ({page}) => {
        const state = await baseWithHq(page, mouse);
        await selectHq(page, mouse, state);
        const before = await sample(page);
        expect(fogAt(before, FAR)).toBe('#');
        await setWorkFlag(page, mouse, state, FAR);
        const after = await sample(page);
        expect(after.fog).toEqual(before.fog);
        expect(after.resources).toEqual(before.resources);
    });

    test('a press on a building is refused with a reason, and the tool stays until a tile is taken or Cancel', async ({page}) => {
        const state = await baseWithHq(page, mouse);
        await selectHq(page, mouse, state);
        await clickAction(page, 'set-flag');
        await clickWorld(page, cellCenter(state.grid, state.terrain.center), state);
        await expect.poll(async () => (await sample(page)).placementHint).toBe('Work flags go on open ground, roads or jungle');
        expect((await sample(page)).flagMode).toMatch(/^hq-/);
        await clickAction(page, 'cancel-placement');
        await expect.poll(async () => (await sample(page)).flagMode).toBeNull();
        expect((await sample(page)).workers.flag).toBeNull();
    });

    for (const presses of [1, 3]) {
        test(`a flag lands on the tile pressed after ${presses} zoom steps and a pan`, async ({page}) => {
            const state = await baseWithHq(page, mouse);
            await selectHq(page, mouse, state);
            await clickAction(page, 'set-flag');
            for (let i = 0; i < presses; i++) await clickAction(page, 'camera-zoom-in');
            await page.keyboard.press('ArrowLeft');
            await page.keyboard.press('ArrowUp');
            const {center} = state.terrain;
            const tile = {col: center.col + 2, row: center.row + 1};
            await clickWorld(page, cellCenter(state.grid, tile), state);
            await expect.poll(async () => (await sample(page)).workers.flag).toEqual(tile);
            expect((await sample(page)).workers.flag).toEqual(tile);
        });
    }

    test('a HUD press in flag mode places nothing beneath it', async ({page}) => {
        const state = await baseWithHq(page, mouse);
        await selectHq(page, mouse, state);
        await clickAction(page, 'set-flag');
        for (const action of ['camera-zoom-in', 'camera-zoom-out', 'camera-fit']) await clickAction(page, action);
        const s = await sample(page);
        expect(s.workers.flag).toBeNull();
        expect(s.flagMode).toMatch(/^hq-/);
    });

    test('workers leave at Night, the fog follows them, and a recall brings them home', async ({page}) => {
        const state = await baseWithHq(page, mouse);
        const {nightTo} = hqFlow(mouse);
        await selectHq(page, mouse, state);
        await setWorkFlag(page, mouse, state, FAR);
        expect((await sample(page)).workers.workers).toEqual([]);

        await nightTo(page, 200);
        const leaving = await sample(page);
        expect(leaving.workers.workers).toHaveLength(3);
        expect(leaving.workerViews.workers).toHaveLength(3);

        await stepExactly(page, 1200);
        const there = await sample(page);
        for (const worker of there.workers.workers) expect({col: worker.col, row: worker.row}).toEqual(FAR);
        expect(fogAt(there, FAR)).toBe('O');
        expect(there.mutants).toEqual([]);

        await clickAction(page, 'reset-flag');
        await expect.poll(async () => (await sample(page)).workers.flag).toBeNull();
        await stepExactly(page, 1400);
        const home = await sample(page);
        expect(home.workers.workers).toEqual([]);
        expect(home.workers.inside).toBe(3);
        expect(fogAt(home, FAR)).toBe('~');
        expect(home.workerViews.deaths).toEqual([]); // going in is not dying
    });

    test('the camera changes nothing about where workers are or what they see', async ({page}) => {
        const state = await baseWithHq(page, mouse);
        await selectHq(page, mouse, state);
        await setWorkFlag(page, mouse, state, FAR);
        await hqFlow(mouse).nightTo(page, 500);
        const before = await sample(page);
        await clickAction(page, 'camera-zoom-in');
        await page.keyboard.press('ArrowLeft');
        await clickAction(page, 'camera-fit');
        const after = await sample(page);
        expect(after.fog).toEqual(before.fog);
        expect(after.workers).toEqual(before.workers);
    });

    test('a mutant kills workers, and the fog stops at a dead worker', async ({page}) => {
        const state = await newGame(page, mouse, 'waveBudget=40&waveLastTick=1200');
        await hqFlow(mouse).buildHq(page, state, state.terrain.center);
        await selectHq(page, mouse, state);
        const {col, row} = state.map.spawnFrame;
        const onFrame = {col: col + 4, row};
        await setWorkFlag(page, mouse, state, onFrame);
        await hqFlow(mouse).nightTo(page, 1);
        await page.evaluate(() => {
            for (let i = 0; i < 12 && window.__qa.getState().workers.lost === 0; i++) window.__qa.sim.stepTicks(240);
        });
        const s = await sample(page);
        expect(s.workers.lost).toBeGreaterThan(0);
        expect(s.workers.workers.length + s.workers.inside).toBe(3 - s.workers.lost);
    });
});

/** The base in a wall with one gate across its road: there is no other way out. */
function gatedLayout() {
    const hq = {type: 'hq', col: 11, row: 7, enabled: true};
    const ring = [];
    for (let row = 6; row <= 10; row++) {
        for (let col = 10; col <= 14; col++) {
            if (row === 6 || row === 10 || col === 10 || col === 14) ring.push({col, row, kind: 'hq-ring'});
        }
    }
    const roads = [5, 6, 7, 8, 9].map((col) => ({col, row: 8, kind: 'player'}));
    const walls = Array.from({length: 16}, (_, row) => row).filter((row) => row !== 8).map((row) => ({type: 'wall', col: 7, row, enabled: true}));
    return {
        format: 'papi-layout', version: 1, grid: {cols: 24, rows: 16},
        buildings: [hq, {type: 'gateVertical', col: 7, row: 8, enabled: true}, ...walls],
        roads: [...ring, ...roads],
    };
}

test.describe('workers: gates', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('workers open an existing gate, pass through it and it closes behind them', async ({page}) => {
        const {start, nightTo} = hqFlow(mouse);
        const state = await start(page, 'mutants=off');
        expect(await page.evaluate((s) => window.__qa.layout.load(s), gatedLayout())).toMatchObject({ok: true});
        await clickWorld(page, cellCenter(state.grid, {col: 12, row: 8}), state);
        await expect.poll(async () => (await sample(page)).selectedBuilding).toMatch(/^hq-/);
        await clickAction(page, 'set-flag');
        await clickWorld(page, cellCenter(state.grid, {col: 3, row: 8}), state);
        await expect.poll(async () => (await sample(page)).workers.flag).toEqual({col: 3, row: 8});

        await nightTo(page, 200);
        await expect.poll(async () => (await sample(page)).workers.workers.some(({held}) => held !== null)).toBe(true);
        let opened = false;
        for (let i = 0; i < 12; i++) {
            await stepExactly(page, 60);
            const s = await sample(page);
            opened ||= s.gates.some((gate) => gate.state === 'open');
        }
        expect(opened).toBe(true);
        const s = await sample(page);
        for (const worker of s.workers.workers) expect(worker.col).toBeLessThan(7);
        await stepExactly(page, 300);
        await expect.poll(async () => (await sample(page)).gates[0].state).toBe('closed');
    });
});

for (const [label, viewport] of [['844x390', {width: 844, height: 390}], ['740x360', {width: 740, height: 360}]]) {
    test.describe(`workers: touch ${label}`, () => {
        test.use({viewport, hasTouch: true, isMobile: true});

        test('HQ commands answer a finger, and a flag and recall work', async ({page}) => {
            const state = await baseWithHq(page, touch);
            await selectHq(page, touch, state);
            await expect(byAction(page, 'set-flag')).toBeVisible();
            await setWorkFlag(page, touch, state, FAR);
            await expect(byAction(page, 'reset-flag')).toBeVisible();
            await tapAction(page, 'reset-flag');
            await expect.poll(async () => (await sample(page)).workers.flag).toBeNull();
        });

        test('a building ghost still needs its two taps after a flag has been set', async ({page}) => {
            const state = await baseWithHq(page, touch);
            await selectHq(page, touch, state);
            await setWorkFlag(page, touch, state, FAR);
            await tapAction(page, 'build-wall');
            await expect.poll(async () => (await sample(page)).ghost.active).toBe(true);
            const {center} = state.terrain;
            const tile = {col: center.col + 3, row: center.row + 3};
            await tapOnce(page, cellCenter(state.grid, tile), state);
            await expect.poll(async () => (await sample(page)).ghost.segment.at(-1)).toMatchObject(tile);
            expect((await sample(page)).buildings).toHaveLength(1);
            await tapOnce(page, cellCenter(state.grid, tile), state);
            await expect.poll(async () => (await sample(page)).buildings.length).toBe(2);
            expect((await sample(page)).workers.flag).toEqual(FAR);
        });

        test('Night: the workers walk out', async ({page}) => {
            const state = await baseWithHq(page, touch);
            await selectHq(page, touch, state);
            await setWorkFlag(page, touch, state, FAR);
            await touch.pressAction(page, 'end-day');
            await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('night');
            await qaSim(page, 'pause');
            await stepExactly(page, 200);
            expect((await sample(page)).workers.workers).toHaveLength(3);
        });
    });
}
