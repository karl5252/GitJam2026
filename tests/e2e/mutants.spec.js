import {test, expect} from '@playwright/test';
import {boot, body, byAction, clickAction, clickWorld, tapAction, tapWorld} from '../helpers/canvas.js';
import {sample} from '../helpers/qa.js';

/**
 * Real enemy behaviour, on the real spawn schedule: buildings placed on the
 * canvas, real END DAY and selection input, and deterministic QA stepping
 * (TEST_MODE only) through the same fixed-step callback as real frames.
 *
 * The default seed's first mutant spawns at the bottom of column 22, at world
 * (976, 616). Layouts below rely on that, and the first test pins it.
 */

const FIRST_SPAWN = {x: 976, y: 616};
const SPAWN_TICK = 600;
const UNPOWERED_STROKE = 0xe53935;

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

/** Step in small chunks until `id` no longer exists; returns the night tick. */
async function stepUntilGone(page, id) {
    return page.evaluate((target) => {
        const state = () => window.__qa.getState();
        while (state().shiftCycle.shift === 'night' && state().buildings.some((b) => b.id === target)) {
            window.__qa.sim.stepTicks(1);
        }
        return state().shiftCycle.elapsedNightTicks;
    }, id);
}

function mutantSuite({pressWorld, pressAction}) {
    async function start(page) {
        // hq: false: exact layouts and empty-board cases, which cannot exist with HQ.
        await boot(page, {scene: 'game', waitForQA: true, hq: false});
        await pressAction(page, 'start');
        await expect(body(page)).toHaveAttribute('data-phase', 'started');
        return sample(page);
    }

    async function place(page, state, type, col, row) {
        const count = (await sample(page)).buildings.length;
        await pressAction(page, `build-${type}`);
        await pressWorld(page, cellCenter(state.grid, col, row), state);
        await expect.poll(async () => (await sample(page)).buildings.length).toBe(count + 1);
        await pressAction(page, 'cancel-placement');
    }

    /** Real END DAY press, then pause and step to `ticks` executed night ticks. */
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

    test('a mutant spawns at tick 600 on the border, and its view matches the domain', async ({page}) => {
        const state = await start(page);
        await place(page, state, 'outpost', 12, 8);

        await nightTo(page, SPAWN_TICK - 1);
        let s = await sample(page);
        expect(s.mutants).toEqual([]);
        expect(s.mutantViews).toEqual([]);
        expect(s.simulation.rng).toEqual({seed: 731, state: 731});

        await qaSim(page, 'stepTicks', 1);
        s = await sample(page);
        expect(s.mutants).toEqual([{
            id: 'mutant-1', ...FIRST_SPAWN, hp: 40, targetId: 'outpost-1', obstacleId: null, attackTimer: 60,
        }]);
        // The art is authored facing right, and the Outpost is to the left.
        expect(s.mutantViews).toEqual([{id: 'mutant-1', visible: true, ...FIRST_SPAWN, radius: 8, facing: 'left', flipX: true}]);
        expect(s.simulation.rng.state).not.toBe(731);

        await qaSim(page, 'stepTicks', 100);
        s = await sample(page);
        expect(s.mutants[0].x).toBeLessThan(FIRST_SPAWN.x); // moved toward the Outpost
        expect(s.mutantViews[0]).toMatchObject({x: s.mutants[0].x, y: s.mutants[0].y, facing: 'left', flipX: true});
    });

    test('a blocked border cell moves the spawn to the next free position', async ({page}) => {
        const state = await start(page);
        await place(page, state, 'outpost', 22, 15); // the default spawn's border cell

        await nightTo(page, SPAWN_TICK);
        const s = await sample(page);
        expect(s.mutants[0]).toMatchObject({x: FIRST_SPAWN.x - 32, y: FIRST_SPAWN.y});
    });

    test('an Outpost is destroyed: view gone, grid freed, cell reusable the next Day', async ({page}) => {
        const state = await start(page);
        await place(page, state, 'outpost', 12, 8);

        await nightTo(page, 1000);
        await stepUntilGone(page, 'outpost-1');
        let s = await sample(page);
        expect(s.shiftCycle.shift).toBe('night');
        expect(s.buildings).toEqual([]);
        expect(s.grid.occupants).toEqual([]);
        expect(s.buildingViews).toEqual([]);
        expect(s.hpBarViews).toEqual([]);

        await finishNight(page);
        s = await sample(page);
        expect(s.settlement.upkeep).toBe(0);
        expect(s.settlement.counts.outpost).toBe(0);

        await place(page, state, 'outpost', 12, 8);
        s = await sample(page);
        expect(s.buildings.map((b) => [b.id, b.hp])).toEqual([['outpost-2', 100]]);
        expect(s.grid.occupants.map((o) => o.id)).toEqual(['outpost-2']);
    });

    test('destroying the selected building clears the selection and the toggle', async ({page}) => {
        const state = await start(page);
        await place(page, state, 'outpost', 12, 8);

        await nightTo(page, 1000);
        await pressWorld(page, cellCenter(state.grid, 12, 8), state);
        await expect.poll(async () => (await sample(page)).selectedBuilding).toBe('outpost-1');
        await expect(byAction(page, 'toggle-power')).toHaveCount(1);

        await stepUntilGone(page, 'outpost-1');
        const s = await sample(page);
        expect(s.selectedBuilding).toBeNull();
        expect(s.selectedCell).toBeNull();
        expect(s.highlight.visible).toBe(false);
        expect(s.ui.toggleVisible).toBe(false);
        await expect(byAction(page, 'toggle-power')).toHaveCount(0);
    });

    test('a building in the way stops the mutant; it destroys it, then resumes its target', async ({page}) => {
        const state = await start(page);
        await place(page, state, 'powerPlant', 22, 3); // preferred, at the top of the column
        await place(page, state, 'outpost', 22, 9); // directly in the path

        await nightTo(page, 1500);
        let s = await sample(page);
        expect(s.mutants[0]).toMatchObject({targetId: 'powerPlant-1', obstacleId: 'outpost-2', x: FIRST_SPAWN.x});
        const stopped = {x: s.mutants[0].x, y: s.mutants[0].y};
        expect(stopped.y).toBe(state.grid.originY + 10 * 32 + 0.5); // just below the Outpost, not inside it
        const hp = s.buildings.find((b) => b.id === 'outpost-2').hp;
        expect(hp).toBeLessThan(100);

        await qaSim(page, 'stepTicks', 120);
        s = await sample(page);
        expect(s.mutants[0]).toMatchObject({...stopped, obstacleId: 'outpost-2'});
        expect(s.buildings.find((b) => b.id === 'outpost-2').hp).toBe(hp - 10);

        await stepUntilGone(page, 'outpost-2');
        await qaSim(page, 'stepTicks', 1);
        s = await sample(page);
        expect(s.mutants[0]).toMatchObject({targetId: 'powerPlant-1', obstacleId: null});
        expect(s.buildingViews.map((v) => v.id)).toEqual(['powerPlant-1']);

        await stepExactly(page, 400);
        s = await sample(page);
        expect(s.mutants[0].y).toBeLessThan(stopped.y); // walked on through the freed cell
        expect(s.buildings[0].hp).toBeLessThan(300);
    });

    test('damage persists across Day and later nights, and the HP bar follows it', async ({page}) => {
        const state = await start(page);
        await place(page, state, 'powerPlant', 12, 8);
        const barFor = (hp) => expect.objectContaining({id: 'powerPlant-1', visible: true, width: 92 * hp / 300, height: 4});
        expect((await sample(page)).hpBarViews).toEqual([]); // undamaged: no bar

        await nightTo(page, 3599);
        let s = await sample(page);
        const night1 = s.buildings[0].hp;
        expect(night1).toBeGreaterThan(0);
        expect(night1).toBeLessThan(300);
        expect(s.hpBarViews).toEqual([barFor(night1)]);

        await finishNight(page);
        s = await sample(page);
        expect(s.buildings[0].hp).toBe(night1);
        expect(s.hpBarViews).toEqual([barFor(night1)]);

        await nightTo(page, 3599);
        s = await sample(page);
        expect(s.buildings[0]?.hp ?? 0).toBeLessThan(night1);
    });

    test('losing the Plant changes power at once, then settlement and pollution', async ({page}) => {
        const state = await start(page);
        await place(page, state, 'powerPlant', 21, 13); // beside the first spawn
        await place(page, state, 'factory', 10, 3);

        await nightTo(page, SPAWN_TICK);
        await finishNight(page);
        expect((await sample(page)).buildings[0].hp).toBeLessThan(300);
        const pollution = (await sample(page)).pollution.value;

        await nightTo(page, 1);
        await stepUntilGone(page, 'powerPlant-1');
        let s = await sample(page);
        expect(s.shiftCycle.shift).toBe('night');
        expect(s.buildings.map((b) => b.id)).toEqual(['factory-2']);
        expect(s.power).toMatchObject({generation: 0, demand: 40, status: 'blackout'});
        expect(s.powerView.text).toBe('Power 0 / 40\nBLACKOUT');
        expect(s.buildingViews).toMatchObject([{id: 'factory-2', strokeColor: UNPOWERED_STROKE}]);

        await finishNight(page);
        s = await sample(page);
        expect(s.settlement).toMatchObject({
            gross: 0,
            power: {generation: 0, demand: 40, status: 'blackout'},
            pollution: {emitted: 0, before: pollution, after: pollution},
        });
        expect(s.settlement.counts.powerPlant).toBe(0);
    });

    test('surviving mutants are removed at dawn with no penalty', async ({page}) => {
        const state = await start(page);
        await place(page, state, 'powerPlant', 12, 8);

        await nightTo(page, 3599);
        let s = await sample(page);
        expect(s.mutants).toHaveLength(1);
        expect(s.mutantViews).toHaveLength(1);
        const {credits} = s.resources;

        await qaSim(page, 'stepTicks', 1);
        s = await sample(page);
        expect(s.shiftCycle).toMatchObject({day: 2, shift: 'day'});
        expect(s.mutants).toEqual([]);
        expect(s.mutantViews).toEqual([]);
        expect(s.resources).toEqual({credits, ap: 5});
    });

    test('with no buildings a mutant spawns, waits, and the night still ends', async ({page}) => {
        await start(page);
        await nightTo(page, SPAWN_TICK);
        const first = (await sample(page)).mutants[0];
        expect(first).toMatchObject({...FIRST_SPAWN, targetId: null});

        await qaSim(page, 'stepTicks', 200);
        expect((await sample(page)).mutants).toEqual([first]);

        await finishNight(page);
        const s = await sample(page);
        expect(s.mutants).toEqual([]);
        expect(s.shiftCycle).toMatchObject({day: 2, shift: 'day'});
        expect(s.ui.endDayVisible).toBe(true);
    });

    test('real frames and QA stepping reach the same state', async ({page}) => {
        test.setTimeout(60_000); // two full playthroughs in one test
        async function run(framesFirst) {
            const state = await start(page);
            await place(page, state, 'powerPlant', 12, 8);
            await place(page, state, 'outpost', 18, 10);
            await pressAction(page, 'end-day');
            await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('night');
            if (framesFirst) {
                await expect.poll(async () => (await sample(page)).shiftCycle.elapsedNightTicks).toBeGreaterThan(framesFirst);
            }
            await qaSim(page, 'pause');
            await stepExactly(page, 1500 - (await sample(page)).shiftCycle.elapsedNightTicks);
            const {mutants, buildings, grid, simulation} = await sample(page);
            return {mutants, buildings, grid, tick: simulation.tick, rng: simulation.rng};
        }
        const stepped = await run(0);
        const viaFrames = await run(60);
        expect(viaFrames).toEqual(stepped);
        expect(stepped.tick).toBe(1500);
        expect(stepped.mutants).toHaveLength(1);
    });

    test('?mutants=off gives an empty schedule in test mode', async ({page}) => {
        await boot(page, {scene: 'game', waitForQA: true, hq: false, mutants: false});
        await pressAction(page, 'start');
        await expect(body(page)).toHaveAttribute('data-phase', 'started');
        await nightTo(page, 1000);
        const s = await sample(page);
        expect(s.mutants).toEqual([]);
        expect(s.simulation.rng).toEqual({seed: 731, state: 731});
    });
}

test.describe('desktop mouse', () => {
    test.use({viewport: {width: 1280, height: 720}});
    mutantSuite({pressWorld: clickWorld, pressAction: clickAction});
});

test.describe('mobile landscape touch', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});
    mutantSuite({pressWorld: tapWorld, pressAction: tapAction});
});
