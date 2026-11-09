import {test, expect} from '@playwright/test';
import {clickAction, clickWorld} from '../helpers/canvas.js';
import {cellCenter, hqFlow, qaSim, stepExactly} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * TASK 026 through real presses, on the map a new game gets, in the real ACTIVE
 * cycle. Deposit-1 of the default world seed lies north of the clearing, beyond
 * the frame mutants spawn on: its 2x2 core is at 30,5 and its south dock at 31,7.
 * HQ's workers clear a corridor and the core with two work flags, a road goes up
 * column 31, the Mine is built, its truck delivers ore to HQ, and then a mutant
 * walks out of the frame to attack it.
 *
 * waveBudget=1 is one mutant a Night. ?seed=639 is the wave RNG (not the world): its
 * Night 2 to 5 spawns are all on the frame's top edge, where a working Mine is the
 * nearest attraction, and the Autocannon by HQ deals with anything that comes for
 * the base. The ore is out of its range.
 */

const mouse = {pressWorld: clickWorld, pressAction: clickAction};
const flow = hqFlow(mouse);

const CORE = {col: 30, row: 5};
const DOCK = {col: 31, row: 7};
const CORRIDOR_FLAG = {col: 31, row: 11};
const CORE_FLAG = DOCK;
const corridor = [8, 9, 10, 11, 12, 13].map((row) => ({col: 31, row}));
const footprint = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dc, dr]) => ({col: CORE.col + dc, row: CORE.row + dr}));
const road = [
    ...[26, 27, 28, 29, 30, 31].map((col) => ({col, row: 15})), // from the HQ ring's east side
    ...[14, 13, 12, 11, 10, 9, 8, 7].map((row) => ({col: 31, row})), // up to the dock
];
const glyph = (s, {col, row}) => s.terrain.rows[row][col];

async function selectHq(page, s) {
    await qaSim(page, 'resume'); // a paused Day refuses every order
    await mouse.pressAction(page, 'camera-fit');
    await mouse.pressWorld(page, cellCenter(s.grid, s.terrain.center), s);
    await expect.poll(async () => (await sample(page)).selectedBuilding).toMatch(/^hq-/);
}

async function setWorkFlag(page, cell) {
    const s = await sample(page);
    await selectHq(page, s);
    await mouse.pressAction(page, 'set-flag');
    await mouse.pressWorld(page, cellCenter(s.grid, cell), s);
    await expect.poll(async () => (await sample(page)).workers.flag).toEqual(cell);
}

/** Step until every tile is cleared, sending the workers out again each Day. */
async function clearTiles(page, cells) {
    for (let i = 0; i < 400; i++) {
        let s = await sample(page);
        if (cells.every((cell) => glyph(s, cell) === ',')) return;
        if (s.shiftCycle.shift === 'day' && !s.workers.sent) {
            await selectHq(page, s);
            await mouse.pressAction(page, 'reset-flag'); // SEND WORKERS to the flag already down
            await expect.poll(async () => (await sample(page)).workers.sent).toBe(true);
        }
        await qaSim(page, 'pause');
        s = await sample(page);
        await stepExactly(page, 240);
    }
    throw new Error('the workers never cleared the tiles');
}

/** Run through Dusk and Night to the next running Day. */
async function toRunningDay(page) {
    await qaSim(page, 'pause');
    for (let i = 0; i < 100 && (await sample(page)).shiftCycle.shift !== 'day'; i++) await stepExactly(page, 240);
    await qaSim(page, 'resume');
}

test.describe('mines: desktop', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('clear a hidden deposit, build a Mine on it, truck ore to HQ by road, and see a mutant come for it', async ({page}) => {
        test.setTimeout(120000);
        let s = await flow.start(page, 'waveBudget=1&seed=639', {map: null, cycle: null});
        const {center} = s.terrain;

        // Fog hides the deposits, and the jungle covers them.
        const [deposit, south] = s.deposits;
        expect({core: deposit.core, dock: deposit.dock}).toEqual({core: CORE, dock: DOCK});
        for (const tile of [...deposit.tiles, ...south.tiles]) {
            expect(s.fog.rows[tile.row][tile.col]).toBe('#');
            expect(glyph(s, tile)).toBe('#');
        }
        expect(s.terrainView.oreRevealed).toBe(0);
        expect(s.menuState.mine).toBe('locked'); // offered on the jungle map, after HQ

        await flow.buildHq(page, s, center);
        s = await sample(page);
        expect(s.menuState.mine).toBe('available');
        expect(s.menuLabels.mine).toBe('Mine 2x2\n500c · 1 AP');
        await flow.place(page, s, 'powerPlant', {col: center.col - 4, row: center.row});
        await flow.place(page, s, 'autocannon', {col: center.col, row: center.row - 3});
        await page.evaluate(() => window.__qa.economy.addCredits(2000)); // ore and roads are dear
        await mouse.pressAction(page, 'end-day'); // Day 0, Dusk, Night 1
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('dusk');
        await toRunningDay(page);

        // Two flags: the corridor, then the seam core and its dock.
        await setWorkFlag(page, CORRIDOR_FLAG);
        await clearTiles(page, corridor);
        s = await sample(page);
        if (s.shiftCycle.shift !== 'day') await toRunningDay(page);
        await setWorkFlag(page, CORE_FLAG);
        await clearTiles(page, [...footprint, DOCK]);
        s = await sample(page);

        // Clearing showed the ore: every cleared deposit tile has been painted, and the far deposit is still hidden.
        const clearedOre = deposit.tiles.filter((tile) => glyph(s, tile) === ',').length;
        expect(clearedOre).toBeGreaterThanOrEqual(4);
        expect(s.terrainView.oreRevealed).toBe(clearedOre);
        for (const tile of south.tiles) expect(s.fog.rows[tile.row][tile.col]).toBe('#');

        // The road, then the Mine, on a running Day.
        if (s.shiftCycle.shift !== 'day') await toRunningDay(page);
        await qaSim(page, 'resume');
        await mouse.pressAction(page, 'camera-fit');
        await mouse.pressAction(page, 'build-road');
        for (const cell of road) {
            const count = (await sample(page)).roads.tiles.length;
            await mouse.pressWorld(page, cellCenter(s.grid, cell), s);
            await expect.poll(async () => (await sample(page)).roads.tiles.length).toBe(count + 1);
        }
        await mouse.pressAction(page, 'cancel-placement');
        if ((await sample(page)).shiftCycle.shift !== 'day') await toRunningDay(page);
        await flow.place(page, s, 'mine', CORE);
        s = await sample(page);
        const mine = s.buildings.find(({type}) => type === 'mine');
        expect(mine).toMatchObject({col: CORE.col, row: CORE.row, width: 2, height: 2});
        expect(s.dockViews).toContainEqual({...DOCK, kind: 'mine'});

        // The art's doorway stands over the south dock, its sill on the footprint's bottom edge.
        const art = s.buildingArtViews.find(({id}) => id === mine.id);
        expect(art.doorway.x).toBe(cellCenter(s.grid, DOCK).x);
        expect(art.doorway.y).toBe(s.grid.originY + (CORE.row + 2) * s.grid.tileSize);

        // A load, driven to HQ on the road, pays 60 Credits.
        await qaSim(page, 'pause');
        const loads = s.logistics.totals.loads;
        let outbound = false;
        for (let i = 0; i < 60; i++) {
            await stepExactly(page, 60);
            const now = await sample(page);
            outbound ||= now.logistics.trucks.some(({factoryId, state}) => factoryId === mine.id && state === 'outbound');
            if (now.logistics.totals.loads > loads) break;
        }
        s = await sample(page);
        expect(outbound).toBe(true);
        expect(s.logistics.totals.loads).toBe(loads + 1);
        expect(s.logistics.totals.credits).toBe(60);

        // At Night a mutant leaves the frame for the working Mine and hits it.
        for (let i = 0; i < 100 && (await sample(page)).shiftCycle.shift !== 'night'; i++) await stepExactly(page, 240);
        let targeted = false;
        let hp = null;
        for (let i = 0; i < 60; i++) {
            await stepExactly(page, 60);
            const now = await sample(page);
            targeted ||= now.mutants.some(({targetId}) => targetId === mine.id);
            hp = now.buildings.find(({id}) => id === mine.id)?.hp ?? 0;
            if (hp < 250) break;
        }
        expect(targeted).toBe(true);
        expect(hp).toBeLessThan(250);
        expect((await sample(page)).hpBarViews.some(({id}) => id === mine.id)).toBe(true);
    });
});
