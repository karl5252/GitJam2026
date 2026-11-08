import {test, expect} from '@playwright/test';
import {clickAction, clickWorld, tapAction, tapWorld} from '../helpers/canvas.js';
import {cellCenter, hqFlow, qaSim, stepExactly} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * TASK 025.4A: the real ACTIVE cycle, as a new game plays it (cycle: null). Nothing
 * here runs the LEGACY untimed Day, so these are the browser evidence that Day 0,
 * Dusk, Night, dawn and the timed Days work, through real presses.
 */

const HQ = {col: 12, row: 8};
const TINT = 0.18;
const DIM = 0.45; // a paused Day's gameplay buttons
const INVALID = 0xe53935; // a red placement preview

const mouse = {pressWorld: clickWorld, pressAction: clickAction};
const touch = {pressWorld: tapWorld, pressAction: tapAction};

async function activeGame(page, flow) {
    const state = await hqFlow(flow).start(page, 'mutants=off', {cycle: null});
    await hqFlow(flow).buildHq(page, state, HQ);
    return state;
}

/** Day 0's END DAY, then Dusk and Night 1 stepped through, to the first timed Day. */
async function firstTimedDay(page, flow) {
    await flow.pressAction(page, 'end-day');
    await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('dusk');
    await qaSim(page, 'pause');
    let s = await sample(page);
    await stepExactly(page, s.shiftCycle.remainingDuskTicks + 1);
    s = await sample(page);
    await stepExactly(page, s.shiftCycle.remainingNightTicks);
    await expect.poll(async () => (await sample(page)).shiftCycle).toMatchObject({day: 2, shift: 'day', deployment: false});
}

function suite(flow) {
    test('Day 0 is untimed: no countdown, no Day controls, and nothing moves until END DAY', async ({page}) => {
        await activeGame(page, flow);
        const s = await sample(page);
        expect(s.shiftCycle).toMatchObject({day: 1, shift: 'day', deployment: true, elapsedDayTicks: 0, remainingDayTicks: 0});
        expect(s.shiftView.text).toBe('Day 0 · Initial Deployment');
        expect(s.dayTimeView.visible).toBe(false);
        expect(s.speedView.visible).toBe(false);
        await page.waitForTimeout(400);
        const later = await sample(page);
        expect(later.simulation.tick).toBe(s.simulation.tick);
        expect(later.resources).toEqual(s.resources);
    });

    test('a timed Day runs by itself at 1x; PAUSE stops it, the speed button steps 1x, 2x, 4x, and the next Day is back at 1x', async ({page}) => {
        await activeGame(page, flow);
        await firstTimedDay(page, flow);
        let s = await sample(page);
        expect(s.shiftView.text).toMatch(/^Day 1 · Day Shift · \d+\.\d s left$/);
        expect(s.dayTimeView).toEqual({visible: true, pause: 'PAUSE', speed: '1×'});
        expect(s.simulation.paused).toBe(false);
        await expect.poll(async () => (await sample(page)).shiftCycle.elapsedDayTicks).toBeGreaterThan(10);

        await flow.pressAction(page, 'day-pause');
        await expect.poll(async () => (await sample(page)).dayTimeView.pause).toBe('PLAY');
        const held = (await sample(page)).shiftCycle.elapsedDayTicks;
        await page.waitForTimeout(300);
        s = await sample(page);
        expect(s.shiftCycle.elapsedDayTicks).toBe(held);
        expect(s.shiftView.text).toContain('(paused)');

        for (const speed of [2, 4, 1, 2, 4]) {
            await flow.pressAction(page, 'day-speed');
            await expect.poll(async () => (await sample(page)).simulation.speed).toBe(speed);
        }
        await flow.pressAction(page, 'day-pause');
        await expect.poll(async () => (await sample(page)).shiftCycle.elapsedDayTicks).toBeGreaterThan(held);

        // END DAY from a timed Day fast-forwards; at 4x into the Night, the next Day still starts at 1x.
        await flow.pressAction(page, 'end-day');
        await expect.poll(async () => (await sample(page)).shiftCycle.shift, {timeout: 5000}).toBe('dusk');
        await qaSim(page, 'pause');
        s = await sample(page);
        await stepExactly(page, s.shiftCycle.remainingDuskTicks + 1);
        await stepExactly(page, (await sample(page)).shiftCycle.remainingNightTicks);
        s = await sample(page);
        expect(s.shiftCycle).toMatchObject({day: 3, shift: 'day'});
        expect([s.simulation.speed, s.simulation.paused]).toEqual([1, false]);
        expect(s.dayTimeView).toEqual({visible: true, pause: 'PAUSE', speed: '1×'});
    });

    test('Day 0 END DAY goes through a real Dusk into Night 1; the world turns blue and dawn clears it', async ({page}) => {
        await activeGame(page, flow);
        expect((await sample(page)).nightTint).toMatchObject({visible: false, alpha: 0});
        await flow.pressAction(page, 'end-day');
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('dusk');
        let s = await sample(page);
        expect(s.dayTimeView.visible).toBe(false, 'nobody can pause a Dusk');
        expect(s.speedView.visible).toBe(true, 'Dusk and Night keep the Night speed buttons');
        expect(s.shiftView.text).toMatch(/^Day 0 · Dusk/);
        await qaSim(page, 'pause');
        s = await sample(page);
        expect(s.nightTint.alpha).toBeCloseTo(TINT * s.shiftCycle.elapsedDuskTicks / 300, 5);
        expect(s.nightTint.depth).toBeLessThan(2.5); // under the fog, so fogged ground is not darkened twice

        await stepExactly(page, s.shiftCycle.remainingDuskTicks + 1);
        s = await sample(page);
        expect(s.shiftCycle).toMatchObject({day: 1, shift: 'night', elapsedNightTicks: 1});
        expect(s.nightTint).toMatchObject({visible: true, alpha: TINT, color: 0x18365c});
        expect(s.shiftView.text).toMatch(/^Night 1 · Night Shift/);

        await stepExactly(page, s.shiftCycle.remainingNightTicks);
        await qaSim(page, 'pause'); // a new Day starts running by itself; hold it to measure the fade
        s = await sample(page);
        expect(s.shiftCycle).toMatchObject({day: 2, shift: 'day'});
        expect(s.settlement.day).toBe(1);
        const dawn = s.shiftCycle.elapsedDayTicks;
        expect(dawn).toBeLessThan(60);
        await stepExactly(page, 60 - dawn);
        expect((await sample(page)).nightTint.alpha).toBeCloseTo(TINT / 2, 5);
        await stepExactly(page, 60);
        expect((await sample(page)).nightTint).toMatchObject({visible: false, alpha: 0});
    });

    test('a paused Day lets the player look and select but changes nothing; PLAY gives the controls back', async ({page}) => {
        const state = await activeGame(page, flow);
        const plantCell = {col: 19, row: 4};
        await hqFlow(flow).place(page, state, 'powerPlant', plantCell); // Day 0: building works with the clock stopped
        if (flow === mouse) { // Day 0 keeps its normal look; the drawer hides the menu on touch
            const look = (await sample(page)).actionAlphaView;
            expect(look.menu.road).toBe(1);
            expect(look.menu.wall).toBe(1);
        }
        await firstTimedDay(page, flow);
        await flow.pressAction(page, 'day-pause');
        await expect.poll(async () => (await sample(page)).simulation.paused).toBe(true);
        const before = await sample(page);

        // Selecting and looking still work.
        await flow.pressWorld(page, cellCenter(state.grid, plantCell), state);
        await expect.poll(async () => (await sample(page)).selectedBuilding).toMatch(/^powerPlant-/);
        await flow.pressAction(page, 'camera-fit');

        // Gameplay buttons are dimmed but readable; PLAY and END DAY are not.
        let look = (await sample(page)).actionAlphaView;
        expect(look.toggle).toBe(DIM);
        expect([look.endDay, look.dayPause]).toEqual([1, 1]);
        expect((await sample(page)).buildingControlsView).toMatchObject({paused: true});
        if (flow === mouse) {
            expect(Object.values(look.menu).every((alpha) => alpha === DIM)).toBe(true);
            expect(look.menu.road).toBe(DIM);
        }

        // A power toggle is refused, with a reason.
        await flow.pressAction(page, 'toggle-power');
        await expect.poll(async () => (await sample(page)).placementHint).toBe('Paused: press PLAY to act');
        expect((await sample(page)).buildings.find((b) => b.type === 'powerPlant').enabled).toBe(true);

        // So is building: the preview shows, and shows red.
        await flow.pressAction(page, 'build-wall');
        await flow.pressWorld(page, cellCenter(state.grid, {col: 3, row: 3}), state);
        await expect.poll(async () => (await sample(page)).placementHint).toBe('Paused: press PLAY to act');
        const preview = await sample(page);
        if (flow === mouse) {
            expect(preview.placement.preview).toMatchObject({ok: false, reason: 'game-paused'});
            expect(preview.previewView).toMatchObject({visible: true, strokeColor: INVALID});
        } else {
            expect(preview.ghost).toMatchObject({active: true, ok: false}); // the touch proposal, red
        }
        await flow.pressAction(page, 'cancel-placement');
        let s = await sample(page);
        expect(s.buildings).toEqual(before.buildings);
        expect(s.resources).toEqual(before.resources);

        await flow.pressAction(page, 'day-pause'); // PLAY
        await expect.poll(async () => (await sample(page)).simulation.paused).toBe(false);
        look = (await sample(page)).actionAlphaView;
        if (flow === mouse) expect(look.menu.wall).toBe(1);
        expect(look.dayPause).toBe(1);
        await flow.pressWorld(page, cellCenter(state.grid, plantCell), state);
        await expect.poll(async () => (await sample(page)).selectedBuilding).toMatch(/^powerPlant-/);
        await flow.pressAction(page, 'toggle-power');
        await expect.poll(async () => (await sample(page)).buildings.find((b) => b.type === 'powerPlant').enabled).toBe(false);
        expect((await sample(page)).actionAlphaView.toggle).toBe(1, 'restored at once');
    });

    test('HQ: a flag costs 1 AP; RECALL keeps it, and SEND WORKERS sends them back to it for free', async ({page}) => {
        const state = await activeGame(page, flow);
        await firstTimedDay(page, flow);
        await flow.pressAction(page, 'day-pause'); // nothing runs out from under the presses
        await expect.poll(async () => (await sample(page)).simulation.paused).toBe(true);
        await flow.pressAction(page, 'day-pause'); // placing needs a running Day, so run it again
        await flow.pressWorld(page, cellCenter(state.grid, HQ), state);
        await expect.poll(async () => (await sample(page)).selectedBuilding).toMatch(/^hq-/);
        const ap = (await sample(page)).resources.ap;
        await flow.pressAction(page, 'set-flag');
        await expect.poll(async () => (await sample(page)).flagMode).toMatch(/^hq-/);
        await flow.pressWorld(page, cellCenter(state.grid, {col: 4, row: 4}), state);
        await expect.poll(async () => (await sample(page)).workers.flag).toEqual({col: 4, row: 4});
        expect((await sample(page)).resources.ap).toBe(ap - 1);

        await flow.pressWorld(page, cellCenter(state.grid, HQ), state);
        await expect.poll(async () => (await sample(page)).buildingControlsView.resetLabel).toBe('RECALL\nWORKERS');
        await flow.pressAction(page, 'reset-flag');
        await expect.poll(async () => (await sample(page)).workers.sent).toBe(false);
        let s = await sample(page);
        expect(s.workers.flag).toEqual({col: 4, row: 4});
        expect(s.buildingControlsView.resetLabel).toBe('SEND\nWORKERS');
        await flow.pressAction(page, 'reset-flag');
        await expect.poll(async () => (await sample(page)).workers.sent).toBe(true);
        s = await sample(page);
        expect(s.resources.ap).toBe(ap - 1, 'recall and redispatch were free');
        expect(s.buildingControlsView.resetLabel).toBe('RECALL\nWORKERS');
    });
}

test.describe('active cycle: desktop mouse', () => {
    test.use({viewport: {width: 1280, height: 720}});
    suite(mouse);
});

test.describe('active cycle: mobile landscape touch', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});
    suite(touch);
});
