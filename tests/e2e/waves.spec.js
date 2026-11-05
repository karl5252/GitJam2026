import {test, expect} from '@playwright/test';
import {boot, body, byAction, clickAction, clickWorld, tapAction, tapWorld} from '../helpers/canvas.js';
import {sample} from '../helpers/qa.js';

/**
 * Night waves on the real planner, through real input: buildings placed on the
 * canvas, real END DAY and power toggle, and deterministic QA stepping
 * (TEST_MODE only). `wave` is the frozen domain plan; `waveView` is the
 * rendered HUD text.
 */

const CANNONS = [{col: 2, row: 2}, {col: 4, row: 2}, {col: 6, row: 2}];

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

function waveSuite({pressWorld, pressAction}) {
    async function start(page, options = {}) {
        // hq: false: exact budgets and layouts; integrated waves are covered by hq-integrated.spec.js.
        await boot(page, {scene: 'game', waitForQA: true, hq: false, ...options});
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

    async function completeNight(page) {
        await nightTo(page, 1);
        await finishNight(page);
    }

    test('night 7 closes its spawn window at tick 2600, and the HUD follows', async ({page}) => {
        await start(page);
        for (let night = 1; night <= 6; night++) await completeNight(page);
        await nightTo(page, 2599);
        let s = await sample(page);
        expect(s.wave).toMatchObject({
            day: 7, threatLevel: 1, nightBudget: 4, accelerationBudget: 0, budget: 4,
            lastSpawnTick: 2600, schedule: [600, 1711, 2377, 2600],
        });
        expect(s.waveView.text).toBe('Mutants 3 | Wave 3/4');

        await stepExactly(page, 1);
        s = await sample(page);
        expect(s.mutants).toHaveLength(4);
        expect(s.waveView.text).toBe('Mutants 4 | Wave 4/4');
    });

    test('night 1 plans one mutant at tick 600, and the HUD shows Night only', async ({page}) => {
        const state = await start(page);
        await place(page, state, 'outpost', {col: 12, row: 8});
        let s = await sample(page);
        expect(s.wave).toBeNull();
        expect(s.waveView.visible).toBe(false);

        await nightTo(page, 599);
        s = await sample(page);
        expect(s.wave).toEqual({
            day: 1, threatLevel: 1, autocannons: 0, nightBudget: 1, pollutionBudget: 0, defenseResponse: 0,
            accelerationBudget: 0, lastSpawnTick: 2700,
            budget: 1, schedule: [600],
        });
        expect(s.waveProgress).toBe(0);
        expect(s.waveView).toEqual({visible: true, text: 'Mutants 0 | Wave 0/1'});

        await qaSim(page, 'stepTicks', 1);
        s = await sample(page);
        expect(s.mutants).toHaveLength(1);
        expect(s.waveView).toEqual({visible: true, text: 'Mutants 1 | Wave 1/1'});

        await finishNight(page);
        s = await sample(page);
        expect(s.wave).toBeNull();
        expect(s.waveProgress).toBeNull();
        expect(s.waveView.visible).toBe(false);
        expect(s.mutants).toEqual([]);
    });

    test('Defense Response: 2 cannons add nothing, the third adds one mutant', async ({page}) => {
        const state = await start(page);
        await place(page, state, 'autocannon', CANNONS[0]);
        await place(page, state, 'autocannon', CANNONS[1]);
        await nightTo(page, 1);
        let s = await sample(page);
        expect(s.wave).toMatchObject({autocannons: 2, defenseResponse: 0, budget: 1, schedule: [600]});

        await start(page);
        await place(page, state, 'autocannon', CANNONS[0]);
        await place(page, state, 'autocannon', CANNONS[1]);
        await place(page, state, 'autocannon', CANNONS[2]);
        await nightTo(page, 1);
        s = await sample(page);
        expect(s.wave).toMatchObject({autocannons: 3, defenseResponse: 1, budget: 2, schedule: [600, 2700]});
    });

    test('a disabled cannon counts, and switching one at night changes nothing', async ({page}) => {
        const state = await start(page);
        for (const cell of CANNONS) await place(page, state, 'autocannon', cell);
        const id = (await sample(page)).buildings[0].id;

        await pressWorld(page, cellCenter(state.grid, CANNONS[0].col, CANNONS[0].row), state);
        await expect.poll(async () => (await sample(page)).selectedBuilding).toBe(id);
        await pressAction(page, 'toggle-power');
        await expect(byAction(page, 'toggle-power')).toHaveAttribute('data-enabled', 'false');

        await nightTo(page, 100);
        const plan = (await sample(page)).wave;
        expect(plan).toMatchObject({autocannons: 3, budget: 2});

        await pressAction(page, 'toggle-power');
        await expect(byAction(page, 'toggle-power')).toHaveAttribute('data-enabled', 'true');
        await stepExactly(page, 2600);
        const s = await sample(page);
        expect(s.wave).toEqual(plan);
        expect(s.waveProgress).toBe(2);
        expect(s.mutants).toHaveLength(2);
    });

    test('dirty industry raises the next wave: Threat 2 on night 3 means 4 mutants on exact ticks', async ({page}) => {
        const state = await start(page);
        await place(page, state, 'powerPlant', {col: 2, row: 2}); // far from the first spawns
        await place(page, state, 'factory', {col: 6, row: 2});
        await completeNight(page);
        await completeNight(page);
        expect((await sample(page)).pollution).toMatchObject({value: 40, threatLevel: 2});

        await nightTo(page, 599);
        let s = await sample(page);
        expect(s.wave).toEqual({
            day: 3, threatLevel: 2, autocannons: 0, nightBudget: 2, pollutionBudget: 2, defenseResponse: 0,
            accelerationBudget: 0, budget: 4, lastSpawnTick: 2700, schedule: [600, 1766, 2466, 2700],
        });

        for (const [tick, count] of [[600, 1], [1765, 1], [1766, 2], [2465, 2], [2466, 3], [2700, 4]]) {
            await stepExactly(page, tick - (await sample(page)).shiftCycle.elapsedNightTicks);
            s = await sample(page);
            expect(s.mutants, `tick ${tick}`).toHaveLength(count);
            expect(s.mutantViews).toHaveLength(count);
            expect(s.waveView.text).toBe(`Mutants ${count} | Wave ${count}/4`);
        }
        expect(s.mutantViews.map(({x, y}) => [x, y])).toEqual(s.mutants.map(({x, y}) => [x, y]));

        await finishNight(page);
        s = await sample(page);
        expect(s.mutants).toEqual([]);
        expect(s.mutantViews).toEqual([]);
    });

    test('a cleaner base stays lower: 24 pollution on night 3 is Threat 1, 2 mutants, and the counter is not a kill count', async ({page}) => {
        const state = await start(page);
        await place(page, state, 'powerPlant', {col: 12, row: 8});
        await place(page, state, 'autocannon', {col: 12, row: 6});
        await completeNight(page);
        await completeNight(page);
        expect((await sample(page)).pollution).toMatchObject({value: 24, threatLevel: 1});

        await nightTo(page, 3599);
        const s = await sample(page);
        expect(s.wave).toMatchObject({day: 3, threatLevel: 1, autocannons: 1, budget: 2, schedule: [600, 2700]});
        expect(s.mutants).toEqual([]); // both killed
        expect(s.waveView.text).toBe('Mutants 0 | Wave 2/2'); // slots reached, not kills
    });

    test('real frames and QA stepping reach the same wave state', async ({page}) => {
        async function run(framesFirst) {
            const state = await start(page);
            for (const cell of CANNONS) await place(page, state, 'autocannon', cell);
            await pressAction(page, 'end-day');
            await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('night');
            if (framesFirst) {
                await expect.poll(async () => (await sample(page)).shiftCycle.elapsedNightTicks).toBeGreaterThan(framesFirst);
            }
            await qaSim(page, 'pause');
            await stepExactly(page, 2750 - (await sample(page)).shiftCycle.elapsedNightTicks);
            const {wave, mutants, buildings, simulation} = await sample(page);
            return {wave, mutants, buildings, tick: simulation.tick, rng: simulation.rng};
        }
        const stepped = await run(0);
        const viaFrames = await run(30);
        expect(viaFrames).toEqual(stepped);
        expect(stepped.mutants).toHaveLength(2);
    });

    test('?mutants=off keeps an empty plan for isolated suites', async ({page}) => {
        await start(page, {mutants: false});
        await nightTo(page, 1000);
        const s = await sample(page);
        expect(s.wave).toEqual({schedule: []});
        expect(s.mutants).toEqual([]);
        expect(s.waveView.text).toBe('Mutants 0 | Wave 0/0');
    });
}

test.describe('desktop mouse', () => {
    test.use({viewport: {width: 1280, height: 720}});
    waveSuite({pressWorld: clickWorld, pressAction: clickAction});
});

test.describe('mobile landscape touch', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});
    waveSuite({pressWorld: tapWorld, pressAction: tapAction});
});
