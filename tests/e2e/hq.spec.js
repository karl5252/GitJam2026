import {test, expect} from '@playwright/test';
import {byAction, clickAction, clickWorld, tapAction, tapWorld} from '../helpers/canvas.js';
import {cellCenter, hqFlow, qaSim} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';
import {STARTING_RESOURCES} from '../../src/core/economy.js';

const START = STARTING_RESOURCES.credits;

/**
 * The real HQ-first flow, through real input: HQ placed from the build menu,
 * everything else locked until then, and END DAY blocked.
 */

const HQ = {col: 12, row: 8};
const LOCKED_TYPES = ['outpost', 'factory', 'powerPlant', 'autocannon'];

function hqSuite(input) {
    const {pressWorld, pressAction} = input;
    const {start, buildHq, place, select} = hqFlow(input);

    test('a new run offers only HQ; the rest and END DAY are visible but disabled', async ({page}) => {
        await start(page);
        const s = await sample(page);
        expect(s.buildings).toEqual([]);
        expect(s.menuState).toEqual({hq: 'available', outpost: 'locked', factory: 'locked', powerPlant: 'locked', autocannon: 'locked', wall: 'locked', gateVertical: 'locked', gateHorizontal: 'locked'});
        expect(s.menuLabels.hq).toBe('HQ 3x3\n0c · 0 AP');
        expect(s.ui).toMatchObject({endDayVisible: true, endDayEnabled: false, buildMenuVisible: true});
        for (const type of LOCKED_TYPES) await expect(byAction(page, `build-${type}`)).toHaveAttribute('data-state', 'locked');
        await expect(byAction(page, 'build-hq')).toHaveAttribute('data-state', 'available');
        await expect(byAction(page, 'end-day')).toHaveAttribute('data-enabled', 'false');
        expect(s.powerView.text).toBe('Power 0 / 0\nNORMAL');
    });

    test('pressing disabled buttons does nothing, and the grid places nothing', async ({page}) => {
        const state = await start(page);
        for (const type of LOCKED_TYPES) {
            await pressAction(page, `build-${type}`);
            expect((await sample(page)).placement.selectedType).toBeNull();
        }
        await pressWorld(page, cellCenter(state.grid, HQ), state);
        await pressAction(page, 'end-day');
        const s = await sample(page);
        expect(s.buildings).toEqual([]);
        expect(s.shiftCycle.shift).toBe('day');
        expect(s.simulation.tick).toBe(0);
    });

    test('pressing a disabled END DAY does not cancel HQ placement', async ({page}) => {
        await start(page);
        await pressAction(page, 'build-hq');
        await pressAction(page, 'end-day');
        const s = await sample(page);
        expect(s.placement.selectedType).toBe('hq');
        expect(s.shiftCycle.shift).toBe('day');
    });

    test('an invalid HQ position is rejected and placement stays open', async ({page}) => {
        const state = await start(page);
        await pressAction(page, 'build-hq');
        await pressWorld(page, cellCenter(state.grid, {col: 0, row: 0}), state); // footprint leaves the grid
        await expect.poll(async () => (await sample(page)).placement.lastResult?.reason).toBe('out-of-bounds');
        const s = await sample(page);
        expect(s.buildings).toEqual([]);
        expect(s.placement.selectedType).toBe('hq');
        expect(s.previewView.fillColor).toBe(0xe53935);
    });

    test('Cancel leaves HQ unbuilt and still available', async ({page}) => {
        await start(page);
        await pressAction(page, 'build-hq');
        await pressAction(page, 'cancel-placement');
        await expect.poll(async () => (await sample(page)).placement.selectedType).toBeNull();
        const s = await sample(page);
        expect(s.menuState.hq).toBe('available');
        expect(s.ui.endDayEnabled).toBe(false);
    });

    test('placing HQ is free, unlocks the menu, marks it BUILT and enables END DAY', {tag: '@smoke'}, async ({page}) => {
        const state = await start(page);
        await buildHq(page, state, HQ);
        const s = await sample(page);
        expect(s.buildings).toEqual([{id: 'hq-1', type: 'hq', col: 11, row: 7, width: 3, height: 3, enabled: true, hp: 600}]);
        expect(s.buildingViews).toHaveLength(1);
        expect(s.resources).toEqual({credits: START, ap: 5});
        expect(s.menuState).toEqual({hq: 'built', outpost: 'available', factory: 'available', powerPlant: 'available', autocannon: 'available', wall: 'available', gateVertical: 'available', gateHorizontal: 'available'});
        expect(s.menuLabels.hq).toBe('HQ 3x3\nBUILT');
        expect(s.placement.selectedType).toBeNull();
        expect(s.ui).toMatchObject({cancelVisible: false, endDayEnabled: true});
        expect(s.previewView.visible).toBe(false);
        expect(s.powerView.text).toBe('Power 20 / 0\nNORMAL');
        await expect(byAction(page, 'build-hq')).toHaveAttribute('data-state', 'built');
        await expect(byAction(page, 'end-day')).toHaveAttribute('data-enabled', 'true');
    });

    test('a built HQ cannot be selected for building again', async ({page}) => {
        const state = await start(page);
        await buildHq(page, state, HQ);
        await pressAction(page, 'build-hq');
        expect((await sample(page)).placement.selectedType).toBeNull();
        await pressWorld(page, cellCenter(state.grid, {col: 3, row: 3}), state);
        expect((await sample(page)).buildings).toHaveLength(1);
    });

    test('HQ can be placed as close to a corner as its road ring allows', async ({page}) => {
        const state = await start(page);
        await buildHq(page, state, {col: 2, row: 2});
        expect((await sample(page)).buildings[0]).toMatchObject({col: 1, row: 1});
    });

    test('selecting HQ offers no power toggle; other buildings still do', async ({page}) => {
        const state = await start(page);
        await buildHq(page, state, HQ);
        await place(page, state, 'outpost', {col: 3, row: 3});
        await select(page, state, HQ, 'hq-1');
        expect((await sample(page)).ui.toggleVisible).toBe(false);
        await expect(byAction(page, 'toggle-power')).toHaveCount(0);
        await select(page, state, {col: 3, row: 3}, 'outpost-2');
        await expect(byAction(page, 'toggle-power')).toHaveCount(1);
    });

    test('the build menu keeps Cancel clear of the other buttons', async ({page}) => {
        await start(page);
        await pressAction(page, 'build-hq');
        await expect(byAction(page, 'cancel-placement')).toHaveCount(1);
        const box = (action) => byAction(page, action).boundingBox();
        const boxes = [];
        for (const action of ['build-hq', ...LOCKED_TYPES.map((t) => `build-${t}`), 'cancel-placement', 'end-day']) boxes.push(await box(action));
        const overlaps = (p, q) => p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
        boxes.forEach((first, i) => {
            for (const second of boxes.slice(i + 1)) expect(overlaps(first, second)).toBe(false);
        });
    });

    test('Day and Night keep the unlocked menu state', async ({page}) => {
        const state = await start(page);
        await buildHq(page, state, HQ);
        await pressAction(page, 'end-day');
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('night');
        await qaSim(page, 'pause');
        await page.evaluate(() => { for (let i = 0; i < 15; i++) window.__qa.sim.stepTicks(240); });
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('day');
        const s = await sample(page);
        expect(s.menuState.hq).toBe('built');
        expect(s.menuLabels.hq).toBe('HQ 3x3\nBUILT');
        expect(s.ui.endDayEnabled).toBe(true);
        await expect(byAction(page, 'build-outpost')).toHaveAttribute('data-state', 'available');
    });
}

test.describe('desktop mouse', () => {
    test.use({viewport: {width: 1280, height: 720}});
    hqSuite({pressWorld: clickWorld, pressAction: clickAction});
});

test.describe('mobile landscape touch', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});
    hqSuite({pressWorld: tapWorld, pressAction: tapAction});
});
