import {test, expect} from '@playwright/test';
import {boot, body, byAction, clickAction, clickWorld, tapAction, tapWorld} from '../helpers/canvas.js';
import {sample} from '../helpers/qa.js';

/**
 * Day -> Night -> Day through real END DAY presses. Nights are completed
 * with deterministic QA stepping (window.__qa.sim.stepTicks, TEST_MODE
 * only), which runs the same fixed-step callback as real frames — so the
 * shift transitions under test are the real ones. Nobody waits 60 s.
 */

const qaSim = (page, method, arg) => page.evaluate(([m, a]) => window.__qa.sim[m](a), [method, arg]);

const cellCenter = (grid, col, row) => ({
    x: grid.originX + (col + 0.5) * grid.tileSize,
    y: grid.originY + (row + 0.5) * grid.tileSize,
});

/** Step exactly `total` ticks in 240-tick chunks; returns ticks executed. */
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

function shiftSuite({pressWorld, pressAction}) {
    async function start(page) {
        await boot(page, {scene: 'game', waitForQA: true});
        await pressAction(page, 'start');
        await expect(body(page)).toHaveAttribute('data-phase', 'started');
        return sample(page);
    }

    async function endDay(page) {
        await pressAction(page, 'end-day');
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('night');
    }

    async function expectDayUi(page, day) {
        const s = await sample(page);
        expect(s.shiftCycle).toEqual({day, shift: 'day', elapsedNightTicks: 0, remainingNightTicks: 0});
        expect(s.shiftView).toEqual({visible: true, text: `Day ${day} · Day Shift`});
        expect(s.ui).toMatchObject({endDayVisible: true, buildMenuVisible: true});
        await expect(byAction(page, 'end-day')).toHaveCount(1);
        await expect(byAction(page, 'build-outpost')).toHaveCount(1);
        await expect(byAction(page, 'build-factory')).toHaveCount(1);
        return s;
    }

    test('Start enters Day 1; Day Shift never ticks, even via QA controls', async ({page}) => {
        await start(page);
        await expectDayUi(page, 1);

        await page.waitForTimeout(500);
        expect(await qaSim(page, 'stepTicks', 60)).toBe(0);
        await qaSim(page, 'resume');
        await page.waitForTimeout(300);
        expect((await sample(page)).simulation).toMatchObject({tick: 0, stepsExecuted: 0, paused: true});
    });

    test('END DAY starts Night: menu hidden, clock runs, countdown follows remaining ticks', async ({page}) => {
        await start(page);
        await endDay(page);

        const s = await sample(page);
        expect(s.ui).toMatchObject({endDayVisible: false, buildMenuVisible: false, cancelVisible: false});
        for (const action of ['end-day', 'build-outpost', 'build-factory', 'cancel-placement']) {
            await expect(byAction(page, action)).toHaveCount(0);
        }
        await expect.poll(async () => (await sample(page)).simulation.tick).toBeGreaterThan(10);

        await qaSim(page, 'pause');
        const paused = await sample(page);
        const {elapsedNightTicks, remainingNightTicks} = paused.shiftCycle;
        expect(elapsedNightTicks + remainingNightTicks).toBe(3600);
        expect(elapsedNightTicks).toBe(paused.simulation.tick);
        expect(paused.shiftView.text).toBe(`Day 1 · Night Shift · ${(remainingNightTicks / 60).toFixed(1)} s left (paused)`);
    });

    test('Night Shift rejects construction: placement mode is cancelled and grid presses place nothing', async ({page}) => {
        const state = await start(page);
        await pressAction(page, 'build-outpost');
        await expect.poll(async () => (await sample(page)).placement.selectedType).toBe('outpost');

        await endDay(page);
        expect((await sample(page)).placement.selectedType).toBeNull();
        const before = await sample(page);

        await pressWorld(page, cellCenter(state.grid, 5, 5), state);
        await pressWorld(page, cellCenter(state.grid, 12, 8), state);
        const after = await sample(page);
        expect(after.buildings).toEqual([]);
        expect(after.grid.occupants).toEqual([]);
        expect(after.resources).toEqual(before.resources);
        expect(after.hudView).toEqual(before.hudView);
        expect(after.placement.selectedType).toBeNull();
    });

    test('Night ends exactly at tick 3600 -> Day 2: AP restored, Credits and buildings kept', async ({page}) => {
        const state = await start(page);
        await pressAction(page, 'build-factory');
        await pressWorld(page, cellCenter(state.grid, 10, 8), state);
        await expect.poll(async () => (await sample(page)).buildings.length).toBe(1);
        const day1 = await sample(page);
        expect(day1.resources).toEqual({credits: 600, ap: 4});

        await endDay(page);
        await qaSim(page, 'pause');
        const t0 = (await sample(page)).simulation.tick; // real frames may have ticked before the pause
        expect(await stepExactly(page, 3599 - t0)).toBe(3599 - t0);

        let s = await sample(page);
        expect(s.shiftCycle).toEqual({day: 1, shift: 'night', elapsedNightTicks: 3599, remainingNightTicks: 1});
        expect(s.simulation.tick).toBe(3599);

        expect(await qaSim(page, 'stepTicks', 1)).toBe(1);
        s = await expectDayUi(page, 2);
        expect(s.simulation).toMatchObject({tick: 3600, stepsExecuted: 3600, paused: true});
        expect(s.resources).toEqual({credits: 600, ap: 5});
        expect(s.hudView.text).toBe('Credits: 600   AP: 5');
        expect(s.buildings).toEqual(day1.buildings);
        expect(s.grid).toEqual(day1.grid);
        expect(s.buildingViews).toEqual(day1.buildingViews);

        await page.waitForTimeout(300);
        expect((await sample(page)).simulation.tick).toBe(3600); // Day 2 does not tick
    });

    test('two full cycles: Day 3, monotonic global ticks, construction works again', async ({page}) => {
        const state = await start(page);
        const ticks = [];
        for (let night = 1; night <= 2; night++) {
            await endDay(page);
            await qaSim(page, 'pause');
            const before = (await sample(page)).simulation.tick;
            await stepExactly(page, 3600);
            const s = await sample(page);
            expect(s.shiftCycle.day).toBe(night + 1);
            expect(s.shiftCycle.shift).toBe('day');
            expect(s.simulation.tick).toBeGreaterThan(before);
            ticks.push(s.simulation.tick);
        }
        expect(ticks).toEqual([3600, 7200]);
        await expectDayUi(page, 3);

        await pressAction(page, 'build-outpost');
        await pressWorld(page, cellCenter(state.grid, 4, 4), state);
        await expect.poll(async () => (await sample(page)).buildings.length).toBe(1);
        expect((await sample(page)).resources).toEqual({credits: 900, ap: 4});
    });
}

test.describe('desktop mouse', () => {
    test.use({viewport: {width: 1280, height: 720}});
    shiftSuite({pressWorld: clickWorld, pressAction: clickAction});
});

test.describe('mobile landscape touch', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});
    shiftSuite({pressWorld: tapWorld, pressAction: tapAction});
});
