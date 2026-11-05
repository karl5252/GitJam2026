import {test, expect} from '@playwright/test';
import {boot, body, byAction, clickAction, clickWorld, tapAction, tapWorld} from '../helpers/canvas.js';
import {hqFlow} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * Pollution through real input: buildings placed on the canvas, the real END
 * DAY and power toggle buttons, and deterministic QA stepping (TEST_MODE
 * only), which runs the same fixed-step callback as real frames. QA
 * `pollution` is the domain state; `pollutionView` is the rendered HUD text.
 */

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

const hudText = (value, level) => `Pollution ${value}\nThreat Level ${level}`;

function pollutionSuite(input) {
    const {pressWorld, pressAction} = input;
    const {buildHq} = hqFlow(input);

    /** The real flow by default. {hq: false} is only for HQ-less states. */
    async function start(page, {hq = true} = {}) {
        await boot(page, {scene: 'game', waitForQA: true, hq, mutants: false});
        await pressAction(page, 'start');
        await expect(body(page)).toHaveAttribute('data-phase', 'started');
        if (hq) await buildHq(page, await sample(page), {col: 20, row: 3});
        return sample(page);
    }

    async function place(page, state, type, col, row) {
        const count = (await sample(page)).buildings.length;
        await pressAction(page, `build-${type}`);
        await pressWorld(page, cellCenter(state.grid, col, row), state);
        await expect.poll(async () => (await sample(page)).buildings.length).toBe(count + 1);
        await pressAction(page, 'cancel-placement');
    }

    /** Plant (centre 17,8) and Factory (10,8): 900 Credits, 20 pollution per night. */
    async function poweredBase(page, state) {
        await place(page, state, 'powerPlant', 17, 8);
        await place(page, state, 'factory', 10, 8);
    }

    async function select(page, state, col, row, expectedId) {
        await pressWorld(page, cellCenter(state.grid, col, row), state);
        await expect.poll(async () => (await sample(page)).selectedBuilding).toBe(expectedId);
    }

    async function toggle(page, expectedEnabled) {
        await pressAction(page, 'toggle-power');
        await expect(byAction(page, 'toggle-power')).toHaveAttribute('data-enabled', String(expectedEnabled));
    }

    /** Real END DAY press, then pause and step to `ticks` executed night ticks. */
    async function nightTo(page, ticks) {
        await pressAction(page, 'end-day');
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('night');
        await qaSim(page, 'pause');
        const elapsed = (await sample(page)).shiftCycle.elapsedNightTicks;
        await stepExactly(page, ticks - elapsed);
    }

    async function completeNight(page) {
        await nightTo(page, 3600);
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('day');
    }

    test('HUD and QA show starting pollution after Start', async ({page}) => {
        await start(page);
        const s = await sample(page);
        expect(s.pollution).toEqual({value: 0, threatLevel: 1, emissionsPerNight: 0});
        expect(s.pollutionView).toEqual({visible: true, text: hudText(0, 1)});
    });

    test('placing buildings changes projected emissions but not pollution', async ({page}) => {
        const state = await start(page);
        await place(page, state, 'outpost', 3, 3);
        expect((await sample(page)).pollution).toEqual({value: 0, threatLevel: 1, emissionsPerNight: 0});

        await place(page, state, 'powerPlant', 17, 8);
        const s = await sample(page);
        expect(s.pollution).toEqual({value: 0, threatLevel: 1, emissionsPerNight: 12});
        expect(s.pollutionView.text).toBe(hudText(0, 1));
    });

    test('nothing is emitted before tick 3600, then exactly once', async ({page}) => {
        const state = await start(page);
        await poweredBase(page, state);

        await nightTo(page, 3599);
        let s = await sample(page);
        expect(s.shiftCycle).toMatchObject({shift: 'night', remainingNightTicks: 1});
        expect(s.pollution.value).toBe(0);
        expect(s.pollutionView.text).toBe(hudText(0, 1));

        expect(await qaSim(page, 'stepTicks', 1)).toBe(1);
        s = await sample(page);
        expect(s.shiftCycle.shift).toBe('day');
        expect(s.pollution).toEqual({value: 20, threatLevel: 1, emissionsPerNight: 20});
        expect(s.settlement.pollution).toEqual({before: 0, emitted: 20, after: 20, threatLevel: 1});
        expect(s.pollutionView.text).toBe(hudText(20, 1));
    });

    test('pollution accumulates over nights and the HUD follows each threat level', async ({page}) => {
        const state = await start(page);
        await poweredBase(page, state);

        const expected = [[20, 1], [40, 2], [60, 3], [80, 3], [100, 4]];
        for (const [value, level] of expected) {
            await completeNight(page);
            const s = await sample(page);
            expect(s.pollution).toEqual({value, threatLevel: level, emissionsPerNight: 20});
            expect(s.pollutionView).toEqual({visible: true, text: hudText(value, level)});
            expect(s.settlement.pollution.after).toBe(value);
        }
    });

    test('pollution leaves Credits, AP and placement to settlement alone', async ({page}) => {
        const state = await start(page);
        await poweredBase(page, state);
        const before = await sample(page);

        await completeNight(page);
        const s = await sample(page);
        expect(s.resources).toEqual({credits: 100 + 150, ap: 5});
        expect(s.buildings).toEqual(before.buildings);
        expect(s.grid).toEqual(before.grid);
        expect(s.power.status).toBe('normal');
    });

    test('toggling buildings changes what the next night emits', async ({page}) => {
        // Stays HQ-less: it asserts blackout, which cannot happen while HQ generates.
        const state = await start(page, {hq: false});
        await poweredBase(page, state);
        const [plant, factory] = (await sample(page)).buildings;

        // Factory off: only the Plant emits.
        await select(page, state, 10, 8, factory.id);
        await toggle(page, false);
        expect((await sample(page)).pollution.emissionsPerNight).toBe(12);
        await completeNight(page);
        expect((await sample(page)).pollution.value).toBe(12);

        // Factory on, Plant off: blackout, so nothing emits.
        await select(page, state, 10, 8, factory.id);
        await toggle(page, true);
        await select(page, state, 17, 8, plant.id);
        await toggle(page, false);
        let s = await sample(page);
        expect(s.power.status).toBe('blackout');
        expect(s.pollution.emissionsPerNight).toBe(0);
        await completeNight(page);
        s = await sample(page);
        expect(s.pollution.value).toBe(12);
        expect(s.pollutionView.text).toBe(hudText(12, 1));

        // Plant back on: both emit again.
        await select(page, state, 17, 8, plant.id);
        await toggle(page, true);
        await completeNight(page);
        s = await sample(page);
        expect(s.pollution).toEqual({value: 32, threatLevel: 2, emissionsPerNight: 20});
        expect(s.pollutionView.text).toBe(hudText(32, 2));
    });

    test('a toggle during Night counts: emissions use the end-of-night state', async ({page}) => {
        const state = await start(page);
        await poweredBase(page, state);
        const factory = (await sample(page)).buildings.find((b) => b.type === 'factory');

        await nightTo(page, 1800);
        await select(page, state, 10, 8, factory.id);
        await toggle(page, false);
        await stepExactly(page, 1800);
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('day');
        expect((await sample(page)).settlement.pollution.emitted).toBe(12);
    });

    test('QA stepping and real frames emit the same amount', async ({page}) => {
        const state = await start(page);
        await place(page, state, 'powerPlant', 17, 8);

        // Real frames run most of the night, then QA stepping finishes it.
        await pressAction(page, 'end-day');
        await expect.poll(async () => (await sample(page)).simulation.stepsExecuted).toBeGreaterThan(30);
        await qaSim(page, 'pause');
        await stepExactly(page, (await sample(page)).shiftCycle.remainingNightTicks);
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('day');
        expect((await sample(page)).pollution.value).toBe(12);

        await completeNight(page);
        expect((await sample(page)).pollution.value).toBe(24);
    });
}

test.describe('desktop mouse', () => {
    test.use({viewport: {width: 1280, height: 720}});
    pollutionSuite({pressWorld: clickWorld, pressAction: clickAction});
});

test.describe('mobile landscape touch', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});
    pollutionSuite({pressWorld: tapWorld, pressAction: tapAction});
});
