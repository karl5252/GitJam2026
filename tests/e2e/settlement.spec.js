import {test, expect} from '@playwright/test';
import {boot, body, clickAction, clickWorld, tapAction, tapWorld} from '../helpers/canvas.js';
import {sample} from '../helpers/qa.js';
import {STARTING_RESOURCES} from '../../src/core/economy.js';

const START = STARTING_RESOURCES.credits;
const LEFT = START - 1000;

/**
 * Nightly settlement through real input: buildings placed on the canvas,
 * a real END DAY press, and deterministic QA stepping (TEST_MODE only),
 * which runs the same fixed-step callback — and so the same settlement —
 * as real frames.
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

const STATUS_LABEL = {normal: 'NORMAL', 'low-power': 'LOW POWER', blackout: 'BLACKOUT'};
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `${n}` : '0');
const panelText = (r) => [
    `Night ${r.day} settlement`,
    `Income  ${signed(r.gross)}`,
    `Upkeep  ${signed(-r.upkeep)}`,
    `Net     ${signed(r.net)}`,
    `Credits ${r.creditsAfter}`,
    `Power   ${STATUS_LABEL[r.power.status]}`,
].join('\n');

function settlementSuite({pressWorld, pressAction}) {
    async function start(page) {
        // hq: false: it tests blackout settlement and exact power figures, so this stays isolated.
        await boot(page, {scene: 'game', waitForQA: true, hq: false, mutants: false});
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

    /** Power Plant + Factory + Outpost: costs 1000 Credits, 3 AP, and leaves `LEFT`. */
    async function poweredBase(page, state) {
        await place(page, state, 'powerPlant', 17, 8);
        await place(page, state, 'factory', 10, 8);
        await place(page, state, 'outpost', 3, 3);
        expect((await sample(page)).resources).toEqual({credits: LEFT, ap: 2});
    }

    /** Real END DAY press, then pause and step to `ticks` executed night ticks. */
    async function nightTo(page, ticks) {
        await pressAction(page, 'end-day');
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('night');
        await qaSim(page, 'pause');
        const elapsed = (await sample(page)).shiftCycle.elapsedNightTicks;
        await stepExactly(page, ticks - elapsed);
    }

    test('powered base: no settlement until tick 3600, then exactly one report', async ({page}) => {
        const state = await start(page);
        await poweredBase(page, state);

        await nightTo(page, 3599);
        let s = await sample(page);
        expect(s.shiftCycle).toMatchObject({shift: 'night', remainingNightTicks: 1});
        expect(s.settlement).toBeNull();
        expect(s.settlementView.visible).toBe(false);
        expect(s.resources).toEqual({credits: LEFT, ap: 2});

        expect(await qaSim(page, 'stepTicks', 1)).toBe(1);
        s = await sample(page);
        const expected = {
            day: 1, gross: 0, upkeep: 0, net: 0, creditsBefore: LEFT, creditsAfter: LEFT,
            counts: {hq: 0, outpost: 1, factory: 1, powerPlant: 1, autocannon: 0, siegeCannon: 0, barracks: 0, wall: 0, gateVertical: 0, gateHorizontal: 0, mine: 0},
            power: {generation: 100, demand: 50, status: 'normal'},
            pollution: {before: 0, emitted: 20, after: 20, threatLevel: 1},
        };
        expect(s.settlement).toEqual(expected);
        expect(s.resources).toEqual({credits: LEFT, ap: 5});
        expect(s.hudView.text).toBe(`Credits: ${LEFT}   AP: 5`);
        expect(s.settlementView).toEqual({visible: true, text: panelText(expected)});
        expect(s.shiftCycle).toMatchObject({day: 2, shift: 'day'});
        expect(s.buildings.length).toBe(3);

        // Day 2 does nothing more: no extra settlement over time or manual steps.
        await page.waitForTimeout(300);
        expect(await qaSim(page, 'stepTicks', 240)).toBe(0);
        expect((await sample(page)).resources.credits).toBe(LEFT);
        expect((await sample(page)).settlement).toEqual(expected);
    });

    test('unpowered Factory + Outpost (no plant): no income and no charge', async ({page}) => {
        const state = await start(page);
        await place(page, state, 'factory', 10, 8);
        await place(page, state, 'outpost', 3, 3);
        expect((await sample(page)).power).toMatchObject({generation: 0, demand: 50, status: 'blackout'});

        await nightTo(page, 3600);
        const s = await sample(page);
        expect(s.settlement).toEqual({
            day: 1, gross: 0, upkeep: 0, net: 0, creditsBefore: START - 500, creditsAfter: START - 500,
            counts: {hq: 0, outpost: 1, factory: 1, powerPlant: 0, autocannon: 0, siegeCannon: 0, barracks: 0, wall: 0, gateVertical: 0, gateHorizontal: 0, mine: 0},
            power: {generation: 0, demand: 50, status: 'blackout'},
            pollution: {before: 0, emitted: 0, after: 0, threatLevel: 1},
        });
        expect(s.hudView.text).toBe(`Credits: ${START - 500}   AP: 5`);
        expect(s.settlementView.text).toBe(panelText(s.settlement));
    });

    test('consecutive nights settle once each and Credits persist', async ({page}) => {
        const state = await start(page);
        await poweredBase(page, state);

        await nightTo(page, 3600);
        expect((await sample(page)).settlement).toMatchObject({day: 1, creditsBefore: LEFT, creditsAfter: LEFT});
        await nightTo(page, 3600);
        const s = await sample(page);
        expect(s.settlement).toMatchObject({day: 2, net: 0, creditsBefore: LEFT, creditsAfter: LEFT});
        expect(s.resources).toEqual({credits: LEFT, ap: 5});
        expect(s.hudView.text).toBe(`Credits: ${LEFT}   AP: 5`);
        expect(s.settlementView.text).toBe(panelText(s.settlement));
        expect(s.shiftCycle.day).toBe(3);
    });

    test('a night without buildings still reports a zero settlement', async ({page}) => {
        await start(page);
        await nightTo(page, 3600);
        const s = await sample(page);
        expect(s.settlement).toEqual({
            day: 1, gross: 0, upkeep: 0, net: 0, creditsBefore: START, creditsAfter: START,
            counts: {hq: 0, outpost: 0, factory: 0, powerPlant: 0, autocannon: 0, siegeCannon: 0, barracks: 0, wall: 0, gateVertical: 0, gateHorizontal: 0, mine: 0},
            power: {generation: 0, demand: 0, status: 'normal'},
            pollution: {before: 0, emitted: 0, after: 0, threatLevel: 1},
        });
        expect(s.settlementView).toEqual({visible: true, text: panelText(s.settlement)});
        expect(s.resources).toEqual({credits: START, ap: 5});
    });
}

test.describe('desktop mouse', () => {
    test.use({viewport: {width: 1280, height: 720}});
    settlementSuite({pressWorld: clickWorld, pressAction: clickAction});
});

test.describe('mobile landscape touch', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});
    settlementSuite({pressWorld: tapWorld, pressAction: tapAction});
});
