import {test, expect} from '@playwright/test';
import {boot, body, clickAction, clickWorld, tapAction, tapWorld} from '../helpers/canvas.js';
import {hqFlow} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * Fixed-step clock through the real game loop. Real-time tick counts vary
 * with headless frame pacing, so these tests assert direction (advancing /
 * frozen); exact counts are asserted only via manual stepping and in unit
 * tests. window.__qa.sim is a TEST_MODE-only control that calls the real
 * SimulationClock methods.
 */

const sim = async (page) => (await sample(page)).simulation;
const qaSim = (page, method, arg) => page.evaluate(([m, a]) => window.__qa.sim[m](a), [method, arg]);

function expectConsistent(s) {
    expect(s.timeSeconds).toBe(s.tick / 60);
    expect(s.stepsExecuted).toBe(s.tick); // every tick ran the scene's step callback
}

function simulationSuite(input) {
    const {pressAction} = input;
    const {buildHq} = hqFlow(input);

    /** The real flow: END DAY needs HQ. The empty schedule keeps ticks free of combat. */
    async function start(page) {
        await boot(page, {scene: 'game', waitForQA: true, mutants: false});
        await pressAction(page, 'start');
        await expect(body(page)).toHaveAttribute('data-phase', 'started');
        await buildHq(page, await sample(page), {col: 12, row: 8});
    }

    /** Start, then press the real END DAY button: the clock only runs during Night Shift. */
    async function startNight(page) {
        await start(page);
        await pressAction(page, 'end-day');
        await expect.poll(async () => (await sample(page)).shiftCycle?.shift).toBe('night');
    }

    test('no ticks occur before Start, even when stepped manually', async ({page}) => {
        await boot(page, {scene: 'game', waitForQA: true});
        await page.waitForTimeout(600);
        expect(await qaSim(page, 'stepTicks', 5)).toBe(0);
        await qaSim(page, 'pause');
        expect(await sim(page)).toMatchObject({running: false, paused: false, tick: 0, timeSeconds: 0, stepsExecuted: 0});
    });

    test('simulation stays at tick 0 during Day Shift and advances once Night Shift begins', async ({page}) => {
        await start(page);
        await page.waitForTimeout(400);
        expect(await sim(page)).toMatchObject({running: true, paused: true, tick: 0, stepsExecuted: 0});

        await pressAction(page, 'end-day');
        await expect.poll(async () => (await sim(page)).tick).toBeGreaterThan(30);
        const s = await sim(page);
        expect(s).toMatchObject({running: true, paused: false});
        expectConsistent(s);
    });

    test('pause freezes the simulation; resume continues it', async ({page}) => {
        await startNight(page);
        await expect.poll(async () => (await sim(page)).tick).toBeGreaterThan(5);

        const paused = await qaSim(page, 'pause');
        expect(paused.paused).toBe(true);
        await page.waitForTimeout(500);
        const frozen = await sim(page);
        expect(frozen.tick).toBe(paused.tick);
        expect(frozen.paused).toBe(true);
        expectConsistent(frozen);

        await qaSim(page, 'resume');
        await expect.poll(async () => (await sim(page)).tick).toBeGreaterThan(paused.tick);
        expect((await sim(page)).paused).toBe(false);
    });

    test('stepTicks while paused advances exactly N ticks and stays paused', async ({page}) => {
        await startNight(page);
        const {tick: t0} = await qaSim(page, 'pause');

        expect(await qaSim(page, 'stepTicks', 25)).toBe(25);
        let s = await sim(page);
        expect(s.tick).toBe(t0 + 25);
        expect(s.paused).toBe(true);
        expectConsistent(s);

        expect(await qaSim(page, 'stepTicks', 240)).toBe(240);
        await page.waitForTimeout(300);
        s = await sim(page);
        expect(s.tick).toBe(t0 + 265);
        expect(s.paused).toBe(true);
        expectConsistent(s);
    });

    test('stepTicks rejects out-of-range counts', async ({page}) => {
        await startNight(page);
        await qaSim(page, 'pause');
        const before = await sim(page);
        for (const bad of [0, 241, 1.5]) {
            await expect(qaSim(page, 'stepTicks', bad)).rejects.toThrow(/count must be an integer/);
        }
        expect((await sim(page)).tick).toBe(before.tick);
    });

    test('ticking does not change placement or economy state', async ({page}) => {
        await startNight(page);
        const before = await sample(page);
        await qaSim(page, 'stepTicks', 240);
        const after = await sample(page);
        expect(after.resources).toEqual(before.resources);
        expect(after.grid).toEqual(before.grid);
        expect(after.buildings).toEqual(before.buildings);
        expect(after.simulation.rng).toEqual(before.simulation.rng); // the empty spawn schedule draws nothing
    });
}

test.describe('desktop', () => {
    test.use({viewport: {width: 1280, height: 720}});
    simulationSuite({pressWorld: clickWorld, pressAction: clickAction});

    test('?seed=N overrides the RNG seed in test mode', async ({page}) => {
        await page.goto('/?testMode&seed=99');
        await expect(body(page)).toHaveAttribute('data-scene', 'game');
        await page.waitForFunction(() => typeof window.__qa?.getState === 'function');
        expect((await sim(page)).rng).toEqual({seed: 99, state: 99});
    });

    test('an invalid ?seed falls back to the default seed', async ({page}) => {
        await page.goto('/?testMode&seed=-5');
        await expect(body(page)).toHaveAttribute('data-scene', 'game');
        await page.waitForFunction(() => typeof window.__qa?.getState === 'function');
        expect((await sim(page)).rng).toEqual({seed: 731, state: 731});
    });
});

test.describe('mobile landscape touch', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});
    simulationSuite({pressWorld: tapWorld, pressAction: tapAction});
});
