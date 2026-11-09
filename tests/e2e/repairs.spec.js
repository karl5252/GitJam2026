import {test, expect} from '@playwright/test';
import {byAction, clickAction, clickWorld, tapAction, tapWorld} from '../helpers/canvas.js';
import {cellCenter, hqFlow, qaSim, stepExactly} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * TASK 025.4C through real presses in the real ACTIVE cycle (cycle: null): Night 1
 * damages HQ (a fixed wave of 4), and on the next Day the player orders a repair from
 * the building's own buttons.
 */

const mouse = {pressWorld: clickWorld, pressAction: clickAction};
const touch = {pressWorld: tapWorld, pressAction: tapAction};

async function damagedHq(page, flow) {
    const state = await hqFlow(flow).start(page, 'waveBudget=4', {map: null, cycle: null});
    await hqFlow(flow).buildHq(page, state, state.terrain.center);
    await flow.pressAction(page, 'end-day');
    await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('dusk');
    await qaSim(page, 'pause');
    let s = await sample(page);
    await stepExactly(page, s.shiftCycle.remainingDuskTicks + 1);
    s = await sample(page);
    await stepExactly(page, s.shiftCycle.remainingNightTicks);
    await expect.poll(async () => (await sample(page)).shiftCycle).toMatchObject({day: 2, shift: 'day'});
    s = await sample(page);
    const hq = s.buildings.find(({type}) => type === 'hq');
    expect(hq.hp).toBeLessThan(600);
    return {state: s, hq};
}

const MIN_TOUCH = 44; // CSS px, as every other touch control

/**
 * TASK 032: both icon buttons are squares in the selection palette. On desktop they
 * share one slot, REPAIR left and DESTROY right, 56 logical px each; on touch each
 * has its own slot, 88 px, REPAIR above DESTROY. Never overlapping.
 */
function expectPair({repairBox, demolishBox}, touchLayout) {
    const size = touchLayout ? 88 : 56;
    expect([repairBox.width, repairBox.height, demolishBox.width, demolishBox.height]).toEqual([size, size, size, size]);
    const [along, across] = touchLayout ? ['y', 'x'] : ['x', 'y'];
    expect(repairBox[across]).toBe(demolishBox[across]);
    expect(demolishBox[along] - repairBox[along]).toBeGreaterThanOrEqual(size + 4);
    expect(demolishBox[along] - repairBox[along]).toBeLessThanOrEqual(size + 16);
}

/** On a phone, each shown button's real rendered hit box is at least 44x44 CSS px, and none overlap. */
async function expectTouchTargets(page, actions) {
    const boxes = await Promise.all(actions.map((action) => byAction(page, action).boundingBox()));
    boxes.forEach((box, i) => {
        expect(box.width, `${actions[i]} width`).toBeGreaterThanOrEqual(MIN_TOUCH);
        expect(box.height, `${actions[i]} height`).toBeGreaterThanOrEqual(MIN_TOUCH);
        for (let j = i + 1; j < boxes.length; j++) {
            const [a, b] = [box, boxes[j]];
            const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
            expect(overlap, `${actions[i]} and ${actions[j]}`).toBe(false);
        }
    });
}

function suite(flow, touchLayout) {
    test('REPAIR sends a worker who mends HQ at 1 Credit per HP with the repair frames; STOP REPAIR ends it', async ({page}) => {
        const {state, hq} = await damagedHq(page, flow);
        await flow.pressWorld(page, cellCenter(state.grid, state.terrain.center), state);
        await expect.poll(async () => (await sample(page)).selectedBuilding).toBe(hq.id);
        await expect.poll(async () => (await sample(page)).buildingControlsView.repairLabel).toBe('REPAIR');
        const view = (await sample(page)).buildingControlsView;
        expect(view.repairVisible).toBe(true);
        expect(view.demolishVisible).toBe(false); // HQ cannot be destroyed
        expectPair(view, touchLayout);
        await expect(byAction(page, 'repair')).toHaveAttribute('aria-label', 'REPAIR');
        if (touchLayout) {
            await expect(byAction(page, 'show-report')).toHaveCount(1); // REPORT stays where it was
            await expectTouchTargets(page, ['repair', 'show-report', 'set-flag', 'camera-zoom-in', 'camera-fit', 'camera-zoom-out', 'end-day']);
        } else {
            // The tooltip names it and prices full HP: HQ costs 1 Credit per HP.
            const box = await byAction(page, 'repair').boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await expect.poll(async () => (await sample(page)).buildingControlsView.tooltip).toBe(`REPAIR · ${600 - hq.hp}c`);
        }

        const credits = (await sample(page)).resources.credits;
        await flow.pressAction(page, 'repair');
        await expect.poll(async () => (await sample(page)).buildingControlsView.repairLabel).toBe('STOP REPAIR');
        await expect(byAction(page, 'repair')).toHaveAttribute('data-ordered', 'true');
        await expect(byAction(page, 'repair')).toHaveAttribute('aria-label', 'STOP REPAIR');

        await qaSim(page, 'pause');
        const seen = new Set();
        for (let i = 0; i < 8; i++) {
            await stepExactly(page, 60);
            for (const {repairing, frame} of (await sample(page)).workerViews.workers) if (repairing) seen.add(frame);
        }
        let s = await sample(page);
        const restored = s.buildings.find(({id}) => id === hq.id).hp - hq.hp;
        expect(restored).toBeGreaterThan(0);
        expect(credits - s.resources.credits).toBe(restored); // HQ: 1 Credit per HP
        expect(s.workers.repairs.spent).toBe(restored);
        expect([...seen].every((frame) => frame === 10 || frame === 11)).toBe(true);
        expect(seen.size).toBeGreaterThan(0);

        await qaSim(page, 'resume');
        await flow.pressAction(page, 'repair');
        await expect.poll(async () => (await sample(page)).workers.repairs.orders).toEqual([]);
        s = await sample(page);
        expect(s.buildingControlsView.repairLabel).toBe('REPAIR');
        expect(s.workers.workers.every(({repair}) => repair === null)).toBe(true);
        if (touchLayout) await expect(byAction(page, 'show-report')).toHaveCount(1);
    });

    test('DESTROY is the Killdozer square beside REPAIR, and a real building still needs two presses', async ({page}) => {
        const state = await hqFlow(flow).start(page, 'mutants=off', {map: null, cycle: null});
        const {center} = state.terrain;
        await hqFlow(flow).buildHq(page, state, center);
        const cell = {col: center.col + 3, row: center.row - 3};
        await hqFlow(flow).place(page, state, 'autocannon', cell);
        const cannon = (await sample(page)).buildings.find(({type}) => type === 'autocannon');
        await flow.pressWorld(page, cellCenter(state.grid, cell), state);
        await expect.poll(async () => (await sample(page)).selectedBuilding).toBe(cannon.id);
        let view = (await sample(page)).buildingControlsView;
        expect(view).toMatchObject({demolishVisible: true, demolishLabel: 'Demolish', repairVisible: false}); // full HP: no REPAIR
        expectPair(view, touchLayout);
        if (touchLayout) await expectTouchTargets(page, ['demolish', 'toggle-power', 'camera-fit', 'end-day']);
        await expect(byAction(page, 'demolish')).toHaveAttribute('aria-label', 'DESTROY');

        await flow.pressAction(page, 'demolish');
        await expect(byAction(page, 'demolish')).toHaveAttribute('data-armed', 'true');
        view = (await sample(page)).buildingControlsView;
        expect(view).toMatchObject({demolishLabel: 'CONFIRM', tooltip: 'CONFIRM DESTROY'}); // the confirmation stays visible
        expect((await sample(page)).buildings.some(({id}) => id === cannon.id)).toBe(true);
        await flow.pressAction(page, 'demolish');
        await expect.poll(async () => (await sample(page)).buildings.some(({id}) => id === cannon.id)).toBe(false);
    });
}

test.describe('repairs: desktop', () => {
    test.use({viewport: {width: 1280, height: 720}});
    suite(mouse, false);
});

for (const [label, viewport] of [['844x390', {width: 844, height: 390}], ['740x360', {width: 740, height: 360}]]) {
    test.describe(`repairs: touch ${label}`, () => {
        test.use({viewport, hasTouch: true, isMobile: true});
        suite(touch, true);
    });
}
