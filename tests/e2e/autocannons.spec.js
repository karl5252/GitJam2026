import {test, expect} from '@playwright/test';
import {boot, body, byAction, clickAction, clickWorld, tapAction, tapWorld} from '../helpers/canvas.js';
import {sample} from '../helpers/qa.js';
import {STARTING_RESOURCES} from '../../src/core/economy.js';

const START = STARTING_RESOURCES.credits;

/**
 * Autocannons on the real spawn schedule, through real input: placed from the
 * build menu on the canvas, real END DAY and power toggle, and deterministic
 * QA stepping (TEST_MODE only). The default seed's first two mutants spawn at
 * world (976, 616) and (816, 616); layouts below rely on that.
 *
 * Layout: the Plant at the top of column 22 is the mutant's preferred target,
 * and the Autocannon at (20, 10) covers its path up the column.
 */

const SPAWN_TICK = 600;
const PLANT = {col: 21, row: 3};
const CANNON = {col: 20, row: 10};
const FACING_STEP = Math.PI / 4;

const cellCenter = (grid, col, row) => ({
    x: grid.originX + (col + 0.5) * grid.tileSize,
    y: grid.originY + (row + 0.5) * grid.tileSize,
});

const qaSim = (page, method, arg) => page.evaluate(([m, a]) => window.__qa.sim[m](a), [method, arg]);

async function stepExactly(page, total) {
    return page.evaluate((n) => {
        let done = 0;
        while (done < n) {
            const ran = window.__qa.sim.stepTicks(Math.min(240, n - done));
            if (ran === 0) break;
            done += ran;
        }
        return done;
    }, total);
}

/** Step one tick at a time until the mutant's hp changes or the night ends. */
async function stepUntilHit(page) {
    return page.evaluate(() => {
        const state = () => window.__qa.getState();
        while (state().shiftCycle.shift === 'night' && (state().mutants[0]?.hp ?? 40) === 40) {
            window.__qa.sim.stepTicks(1);
        }
    });
}

/** Step one tick at a time until `id` no longer exists; ends with the night. */
async function stepUntilGone(page, id) {
    return page.evaluate((target) => {
        const state = () => window.__qa.getState();
        while (state().shiftCycle.shift === 'night' && state().buildings.some((b) => b.id === target)) {
            window.__qa.sim.stepTicks(1);
        }
    }, id);
}

function autocannonSuite({pressWorld, pressAction}) {
    async function start(page) {
        // hq: false: unpowered setups rely on a lone cannon having no power, but HQ would power it.
        await boot(page, {scene: 'game', waitForQA: true, hq: false});
        await pressAction(page, 'start');
        await expect(body(page)).toHaveAttribute('data-phase', 'started');
        return sample(page);
    }

    async function place(page, state, type, {col, row}) {
        const count = (await sample(page)).buildings.length;
        await pressAction(page, `build-${type}`);
        await pressWorld(page, cellCenter(state.grid, col, row), state);
        await expect.poll(async () => (await sample(page)).buildings.length).toBe(count + 1);
        await pressAction(page, 'cancel-placement');
    }

    async function nightTo(page, ticks) {
        await pressAction(page, 'end-day');
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('night');
        await qaSim(page, 'pause');
        const elapsed = (await sample(page)).shiftCycle.elapsedNightTicks;
        await stepExactly(page, ticks - elapsed);
    }

    async function finishNight(page) {
        await stepExactly(page, (await sample(page)).shiftCycle.remainingNightTicks);
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('day');
    }

    async function select(page, state, cell, expectedId) {
        await pressWorld(page, cellCenter(state.grid, cell.col, cell.row), state);
        await expect.poll(async () => (await sample(page)).selectedBuilding).toBe(expectedId);
    }

    async function toggle(page, expectedEnabled) {
        await pressAction(page, 'toggle-power');
        await expect(byAction(page, 'toggle-power')).toHaveAttribute('data-enabled', String(expectedEnabled));
    }

    test('the Autocannon is built from the menu, and Cancel stays clear of END DAY', async ({page}) => {
        const state = await start(page);
        expect((await sample(page)).menuLabels.autocannon).toBe('Autocannon 1x1\n250c · 1 AP');

        await pressAction(page, 'build-autocannon');
        await expect(byAction(page, 'cancel-placement')).toHaveCount(1);
        const cancel = await byAction(page, 'cancel-placement').boundingBox();
        const endDay = await byAction(page, 'end-day').boundingBox();
        const lastBuild = await byAction(page, 'build-autocannon').boundingBox();
        const overlaps = (p, q) => p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
        expect(overlaps(cancel, endDay)).toBe(false);
        expect(overlaps(cancel, lastBuild)).toBe(false);

        await pressWorld(page, cellCenter(state.grid, CANNON.col, CANNON.row), state);
        await expect.poll(async () => (await sample(page)).buildings.length).toBe(1);
        await pressAction(page, 'cancel-placement'); // Cancel really responds at its new position
        await expect.poll(async () => (await sample(page)).placement.selectedType).toBeNull();

        const s = await sample(page);
        expect(s.buildings[0]).toMatchObject({type: 'autocannon', width: 1, height: 1, hp: 150, enabled: true});
        expect(s.resources).toEqual({credits: START - 250, ap: 4});
        expect(s.power).toMatchObject({generation: 0, demand: 20, status: 'blackout'});
        expect(s.autocannons).toEqual([{id: s.buildings[0].id, cooldown: 0, targetId: null}]);
        expect(s.barrelViews).toHaveLength(1);
        expect(s.barrelViews[0]).toMatchObject({visible: true, ...cellCenter(state.grid, CANNON.col, CANNON.row)});
    });

    test('a powered Autocannon kills the mutant before it reaches anything', async ({page}) => {
        const state = await start(page);
        await place(page, state, 'powerPlant', PLANT);
        await place(page, state, 'autocannon', CANNON);

        await nightTo(page, SPAWN_TICK);
        expect((await sample(page)).mutants).toHaveLength(1);

        await stepExactly(page, 300);
        const s = await sample(page);
        expect(s.mutants).toEqual([]);
        expect(s.mutantViews).toEqual([]);
        expect(s.autocannons[0].targetId).toBeNull();
        expect(s.buildings.map((b) => b.hp)).toEqual([300, 150]); // nothing was hit
        expect(s.hpBarViews).toEqual([]);
    });

    test('the barrel faces the target in 8 directions, and a tracer marks each shot', async ({page}) => {
        const state = await start(page);
        await place(page, state, 'powerPlant', PLANT);
        await place(page, state, 'autocannon', CANNON);
        await nightTo(page, SPAWN_TICK);

        await stepUntilHit(page);
        let s = await sample(page);
        const [mutant] = s.mutants;
        expect(mutant.hp).toBe(30);
        // Turrets act before mutants: it steps into range on tick 659 and is hit on 660.
        expect(s.shiftCycle.elapsedNightTicks).toBe(660);
        const cannon = s.autocannons[0];
        expect(cannon).toMatchObject({cooldown: 30, targetId: mutant.id});

        const center = cellCenter(state.grid, CANNON.col, CANNON.row);
        const barrel = s.barrelViews[0];
        const steps = barrel.rotation / FACING_STEP;
        expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-9);
        const exact = Math.atan2(mutant.y - center.y, mutant.x - center.x);
        expect(Math.abs(barrel.rotation - exact)).toBeLessThanOrEqual(FACING_STEP / 2 + 1e-9);

        expect(s.tracerViews).toHaveLength(1);
        expect(s.tracerViews[0]).toMatchObject({id: cannon.id, visible: true, ...center});
        expect(s.tracerViews[0].width).toBeGreaterThan(0);

        await qaSim(page, 'stepTicks', 10);
        s = await sample(page);
        expect(s.tracerViews[0].visible).toBe(false); // gone well before the next shot
    });

    test('without power it never fires, and the mutant damages it', async ({page}) => {
        const state = await start(page);
        await place(page, state, 'autocannon', CANNON);

        await nightTo(page, 2000);
        let s = await sample(page);
        expect(s.power.status).toBe('blackout');
        expect(s.mutants[0].hp).toBe(40);
        expect(s.autocannons[0]).toMatchObject({cooldown: 0, targetId: null});
        expect(s.tracerViews).toEqual([]);
        expect(s.buildings[0].hp).toBeLessThan(150);
        expect(s.buildings[0].hp).toBeGreaterThan(0);

        await finishNight(page);
        s = await sample(page);
        expect(s.mutants).toEqual([]);
    });

    test('switching it OFF at night stops fire, and ON resumes it', async ({page}) => {
        const state = await start(page);
        await place(page, state, 'powerPlant', PLANT);
        await place(page, state, 'autocannon', CANNON);
        const cannonId = (await sample(page)).buildings[1].id;

        await nightTo(page, SPAWN_TICK);
        await stepUntilHit(page);
        await select(page, state, CANNON, cannonId);
        await toggle(page, false);

        await qaSim(page, 'stepTicks', 120);
        let s = await sample(page);
        expect(s.mutants[0].hp).toBe(30);
        expect(s.autocannons[0]).toEqual({id: cannonId, cooldown: 30, targetId: null}); // paused, lock cleared
        expect(s.barrelViews[0].alpha).toBeCloseTo(0.35);

        await toggle(page, true);
        await qaSim(page, 'stepTicks', 29);
        expect((await sample(page)).mutants[0].hp).toBe(30);
        await qaSim(page, 'stepTicks', 1);
        s = await sample(page);
        expect(s.mutants[0].hp).toBe(20);
        expect(s.barrelViews[0].alpha).toBe(1);
    });

    test('losing the Plant silences a surviving Autocannon', async ({page}) => {
        const state = await start(page);
        await place(page, state, 'powerPlant', {col: 21, row: 13}); // beside the spawns
        await place(page, state, 'autocannon', {col: 12, row: 8}); // out of range of that fight

        await nightTo(page, SPAWN_TICK);
        await finishNight(page);
        expect((await sample(page)).buildings[0].hp).toBeLessThan(300);

        await nightTo(page, 1);
        await stepUntilGone(page, 'powerPlant-1');
        let s = await sample(page);
        expect(s.shiftCycle.shift).toBe('night');
        expect(s.power).toMatchObject({generation: 0, demand: 20, status: 'blackout'});
        expect(s.powerView.text).toBe('Power 0 / 20\nBLACKOUT');

        await stepExactly(page, (await sample(page)).shiftCycle.remainingNightTicks - 1);
        s = await sample(page);
        const [mutant] = s.mutants;
        const center = cellCenter(state.grid, 12, 8);
        expect(Math.hypot(mutant.x - center.x, mutant.y - center.y)).toBeLessThanOrEqual(160); // walked into range
        expect(mutant.hp).toBe(40);
        expect(s.autocannons[0].targetId).toBeNull();
    });

    test('a destroyed Autocannon loses its views, selection and turret state at once', async ({page}) => {
        const state = await start(page);
        await place(page, state, 'autocannon', CANNON); // unpowered, so the mutant reaches it
        const id = (await sample(page)).buildings[0].id;

        await nightTo(page, 1000);
        await select(page, state, CANNON, id);
        await expect(byAction(page, 'toggle-power')).toHaveCount(1);

        await stepUntilGone(page, id);
        let s = await sample(page);
        expect(s.shiftCycle.shift).toBe('night');
        expect(s.buildings).toEqual([]);
        expect(s.grid.occupants).toEqual([]);
        expect(s.autocannons).toEqual([]);
        expect(s.barrelViews).toEqual([]);
        expect(s.tracerViews).toEqual([]);
        expect(s.buildingViews).toEqual([]);
        expect(s.selectedBuilding).toBeNull();
        expect(s.ui.toggleVisible).toBe(false);
        await expect(byAction(page, 'toggle-power')).toHaveCount(0);

        await finishNight(page);
        await place(page, state, 'autocannon', CANNON);
        s = await sample(page);
        expect(s.autocannons).toEqual([{id: s.buildings[0].id, cooldown: 0, targetId: null}]);
        expect(s.buildings[0].id).not.toBe(id);
    });

    test('an Autocannon adds no income, upkeep or pollution', async ({page}) => {
        const state = await start(page);
        await place(page, state, 'powerPlant', PLANT);
        await place(page, state, 'autocannon', CANNON);

        await nightTo(page, 1);
        await finishNight(page);
        const s = await sample(page);
        expect(s.settlement).toMatchObject({gross: 0, upkeep: 0, net: 0, pollution: {emitted: 12}});
        expect(s.settlement.counts).toEqual({hq: 0, outpost: 0, factory: 0, powerPlant: 1, autocannon: 1, wall: 0, gateVertical: 0, gateHorizontal: 0});
        expect(s.resources).toEqual({credits: START - 750, ap: 5});
    });

    test('real frames and QA stepping reach the same state', async ({page}) => {
        async function run(framesFirst) {
            const state = await start(page);
            await place(page, state, 'powerPlant', PLANT);
            await place(page, state, 'autocannon', CANNON);
            await pressAction(page, 'end-day');
            await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('night');
            if (framesFirst) {
                await expect.poll(async () => (await sample(page)).shiftCycle.elapsedNightTicks).toBeGreaterThan(framesFirst);
            }
            await qaSim(page, 'pause');
            await stepExactly(page, 700 - (await sample(page)).shiftCycle.elapsedNightTicks);
            const {mutants, buildings, autocannons, simulation} = await sample(page);
            return {mutants, buildings, autocannons, tick: simulation.tick, rng: simulation.rng};
        }
        const stepped = await run(0);
        const viaFrames = await run(30);
        expect(viaFrames).toEqual(stepped);
        expect(stepped.tick).toBe(700);
        expect(stepped.mutants[0].hp).toBeLessThan(40);
    });
}

test.describe('desktop mouse', () => {
    test.use({viewport: {width: 1280, height: 720}});
    autocannonSuite({pressWorld: clickWorld, pressAction: clickAction});
});

test.describe('mobile landscape touch', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});
    autocannonSuite({pressWorld: tapWorld, pressAction: tapAction});
});
