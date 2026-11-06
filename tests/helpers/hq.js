import {expect} from '@playwright/test';
import {boot, body} from './canvas.js';
import {sample} from './qa.js';

/**
 * Real HQ-first flow helpers, for tests that play the game as it ships. Each
 * takes the suite's press functions, so one test body covers mouse and touch.
 */

export const cellCenter = (grid, {col, row}) => ({
    x: grid.originX + (col + 0.5) * grid.tileSize,
    y: grid.originY + (row + 0.5) * grid.tileSize,
});

export const qaSim = (page, method, arg) => page.evaluate(([m, a]) => window.__qa.sim[m](a), [method, arg]);

export async function stepExactly(page, total) {
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

export function hqFlow({pressWorld, pressAction}) {
    async function start(page, query = '', options = {}) {
        await boot(page, {scene: 'game', waitForQA: true, query, ...options});
        await pressAction(page, 'start');
        await expect(body(page)).toHaveAttribute('data-phase', 'started');
        return sample(page);
    }

    /** Build HQ through the real menu; placement mode ends by itself. */
    async function buildHq(page, state, cell) {
        await pressAction(page, 'build-hq');
        await pressWorld(page, cellCenter(state.grid, cell), state);
        await expect.poll(async () => (await sample(page)).menuState.hq).toBe('built');
    }

    /** Real presses. One that would cause LOW_POWER asks first, so it gets the player's second press. */
    async function place(page, state, type, cell) {
        const count = (await sample(page)).buildings.length;
        const at = cellCenter(state.grid, cell);
        await pressAction(page, `build-${type}`);
        await pressWorld(page, at, state);
        await expect.poll(async () => {
            const s = await sample(page);
            return s.buildings.length > count || s.powerWarning !== null;
        }).toBe(true);
        if ((await sample(page)).powerWarning) await pressWorld(page, at, state);
        await expect.poll(async () => (await sample(page)).buildings.length).toBe(count + 1);
        await pressAction(page, 'cancel-placement');
    }

    async function select(page, state, cell, expectedId) {
        await pressWorld(page, cellCenter(state.grid, cell), state);
        await expect.poll(async () => (await sample(page)).selectedBuilding).toBe(expectedId);
    }

    /** Real END DAY press, then pause and step to \`ticks\` executed night ticks. */
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

    /** Step a bounded number of nights until HQ falls. */
    async function stepToDefeat(page, maxNights = 3) {
        for (let night = 0; night < maxNights; night++) {
            await nightTo(page, 1);
            await page.evaluate(() => {
                for (let i = 0; i < 20 && window.__qa.getState().shiftCycle.shift === 'night'; i++) window.__qa.sim.stepTicks(240);
            });
            if ((await sample(page)).shiftCycle.shift === 'defeated') return;
        }
        throw new Error(`HQ survived ${maxNights} nights`);
    }

    return {start, buildHq, place, select, nightTo, finishNight, completeNight, stepToDefeat};
}
