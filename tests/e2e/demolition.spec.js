import {test, expect} from '@playwright/test';
import {byAction, clickAction, clickWorld, tapAction, tapWorld} from '../helpers/canvas.js';
import {cellCenter, hqFlow} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * Demolition through real input on the real HQ-first flow. HQ centred on 12,8 has
 * its ring on 10-14, 6-10. The Factory at pointer 3,8 ships from 5,8 along the
 * west road; the Barracks at pointer 16,8 has its exit on the ring.
 */

const HQ = {col: 12, row: 8};
const PLANT = {col: 20, row: 3};
const FACTORY = {col: 3, row: 8};
const CANNON = {col: 3, row: 3};
const OUTPOST = {col: 4, row: 3};
const BARRACKS = {col: 16, row: 8};
const WEST_ROAD = [[9, 8], [8, 8], [7, 8], [6, 8], [5, 8]];
const MIN_TOUCH = 44;

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function suite(input) {
    const {pressWorld, pressAction} = input;
    const {start, buildHq, place, select, nightTo, finishNight} = hqFlow(input);

    const idOf = async (page, type) => (await sample(page)).buildings.find((b) => b.type === type).id;

    async function base(page) {
        const state = await start(page, 'mutants=off');
        await page.evaluate(() => window.__qa.economy.setCredits(10_000));
        await buildHq(page, state, HQ);
        await pressAction(page, 'build-road');
        for (const [col, row] of WEST_ROAD) await pressWorld(page, cellCenter(state.grid, {col, row}), state);
        await pressAction(page, 'cancel-placement');
        await place(page, state, 'powerPlant', PLANT);
        await place(page, state, 'factory', FACTORY);
        return state;
    }

    /** The first press changes the button and nothing else. */
    async function arm(page, id) {
        const before = await sample(page);
        await pressAction(page, 'demolish');
        await expect(byAction(page, 'demolish')).toHaveAttribute('data-armed', 'true');
        const s = await sample(page);
        expect(s.buildingControlsView).toMatchObject({demolishLabel: 'CONFIRM', demolishArmed: id});
        expect(s.buildings).toEqual(before.buildings);
        expect(s.resources).toEqual(before.resources);
    }

    const expectDisarmed = async (page) => {
        await expect.poll(async () => (await sample(page)).buildingControlsView.demolishArmed).toBeNull();
        expect((await sample(page)).buildingControlsView.demolishLabel).toBe('Demolish');
    };

    async function demolish(page, state, cell, type) {
        const id = await idOf(page, type);
        await select(page, state, cell, id);
        await expect(byAction(page, 'demolish')).toHaveAttribute('data-target', id);
        const {resources} = await sample(page);
        await arm(page, id);
        await pressAction(page, 'demolish');
        await expect.poll(async () => (await sample(page)).buildings.some((b) => b.id === id)).toBe(false);
        const s = await sample(page);
        expect(s.resources, 'no Credits, no AP').toEqual(resources);
        expect(s.selectedBuilding).toBeNull();
        expect(s.buildingViews.some((v) => v.id === id)).toBe(false);
        await expect(byAction(page, 'demolish')).toHaveCount(0);
        await expect(byAction(page, 'toggle-power')).toHaveCount(0);
        return s;
    }

    test('every ordinary building offers Demolish beside its power switch', async ({page}) => {
        const state = await base(page);
        await place(page, state, 'autocannon', CANNON);
        await place(page, state, 'outpost', OUTPOST);
        for (const [type, cell] of [['factory', FACTORY], ['powerPlant', PLANT], ['autocannon', CANNON], ['outpost', OUTPOST]]) {
            const id = await idOf(page, type);
            await select(page, state, cell, id);
            await expect(byAction(page, 'demolish')).toHaveAttribute('data-target', id);
            await expect(byAction(page, 'toggle-power')).toHaveAttribute('data-target', id);
            await expect(byAction(page, 'set-flag')).toHaveCount(0);
        }
    });

    for (const type of ['factory', 'powerPlant', 'autocannon', 'outpost', 'barracks']) {
        test(`${type} needs two presses to demolish`, async ({page}) => {
            const state = await base(page);
            const cell = {factory: FACTORY, powerPlant: PLANT, autocannon: CANNON, outpost: OUTPOST, barracks: BARRACKS}[type];
            if (!['factory', 'powerPlant'].includes(type)) await place(page, state, type, cell);
            await demolish(page, state, cell, type);
        });
    }

    test('a wall and a gate still go on one press', async ({page}) => {
        const state = await base(page);
        await place(page, state, 'wall', CANNON);
        await place(page, state, 'gateVertical', {col: 7, row: 8});
        for (const [type, cell] of [['wall', CANNON], ['gateVertical', {col: 7, row: 8}]]) {
            const id = await idOf(page, type);
            await select(page, state, cell, id);
            await pressAction(page, 'demolish');
            await expect.poll(async () => (await sample(page)).buildings.some((b) => b.id === id)).toBe(false);
        }
    });

    test('confirmation does not carry to another building', async ({page}) => {
        const state = await base(page);
        const factory = await idOf(page, 'factory');
        const plant = await idOf(page, 'powerPlant');
        await select(page, state, FACTORY, factory);
        await arm(page, factory);
        await select(page, state, PLANT, plant);
        await expectDisarmed(page);
        await arm(page, plant);
        const {buildings} = await sample(page);
        expect(buildings.map((b) => b.id)).toEqual(expect.arrayContaining([factory, plant]));
    });

    test('a press on the map cancels confirmation, even on the same building', async ({page}) => {
        const state = await base(page);
        const id = await idOf(page, 'factory');
        await select(page, state, FACTORY, id);
        await arm(page, id);
        await pressWorld(page, cellCenter(state.grid, FACTORY), state);
        await expectDisarmed(page);
        await arm(page, id);
        await pressWorld(page, cellCenter(state.grid, {col: 22, row: 14}), state);
        await expect.poll(async () => (await sample(page)).selectedBuilding).toBeNull();
        await expect(byAction(page, 'demolish')).toHaveCount(0);
        await select(page, state, FACTORY, id);
        await expectDisarmed(page);
    });

    test('other actions cancel confirmation: Switch, Flag, a build tool and Escape', async ({page}) => {
        test.setTimeout(30_000); // a long sequence of real presses, slow under three workers on touch
        const state = await base(page);
        await place(page, state, 'barracks', BARRACKS);
        const id = await idOf(page, 'barracks');
        await select(page, state, BARRACKS, id);

        await arm(page, id);
        await pressAction(page, 'toggle-power');
        await expectDisarmed(page);

        await arm(page, id);
        await pressAction(page, 'set-flag');
        await expect.poll(async () => (await sample(page)).flagMode).toBe(id);
        await pressAction(page, 'cancel-placement');
        await expect.poll(async () => (await sample(page)).selectedBuilding).toBe(id);
        await expectDisarmed(page);

        await arm(page, id);
        await page.keyboard.press('Escape');
        await expectDisarmed(page);

        await arm(page, id);
        await pressAction(page, 'build-wall');
        await expect.poll(async () => (await sample(page)).placement.selectedType).toBe('wall');
        await pressAction(page, 'cancel-placement');
        await select(page, state, BARRACKS, id);
        await expectDisarmed(page);
        expect((await sample(page)).buildings.some((b) => b.id === id)).toBe(true);
    });

    test('leaving Day cancels confirmation, and it does not come back at dawn', async ({page}) => {
        const state = await base(page);
        const id = await idOf(page, 'factory');
        await select(page, state, FACTORY, id);
        await arm(page, id);
        await nightTo(page, 1);
        await expect(byAction(page, 'demolish')).toHaveCount(0);
        await finishNight(page);
        await expect(byAction(page, 'demolish')).toHaveAttribute('data-armed', 'false');
        await expectDisarmed(page);
        expect((await sample(page)).buildings.some((b) => b.id === id)).toBe(true);
    });

    test('HQ offers neither Demolish nor a switch', async ({page}) => {
        const state = await base(page);
        await select(page, state, HQ, await idOf(page, 'hq'));
        await expect(byAction(page, 'demolish')).toHaveCount(0);
        await expect(byAction(page, 'toggle-power')).toHaveCount(0);
    });

    test('the switch still works after Demolish appears, and does not demolish', async ({page}) => {
        const state = await base(page);
        const id = await idOf(page, 'factory');
        await select(page, state, FACTORY, id);
        await pressAction(page, 'toggle-power');
        await expect.poll(async () => (await sample(page)).buildings.find((b) => b.id === id).enabled).toBe(false);
        await expect(byAction(page, 'demolish')).toHaveAttribute('data-target', id);
    });

    test('demolishing a Plant updates power at once', async ({page}) => {
        const state = await base(page);
        expect((await sample(page)).powerView.text).toBe('Power 120 / 40\nNORMAL');
        const s = await demolish(page, state, PLANT, 'powerPlant');
        expect(s.powerView.text).toBe('Power 20 / 40\nLOW POWER');
    });

    test('demolishing a Factory removes its truck, dock marker and road dependency', async ({page}) => {
        const state = await base(page);
        await expect.poll(async () => (await sample(page)).truckViews.trucks.length).toBe(1);
        expect((await sample(page)).dockViews.some((d) => d.kind === 'factory')).toBe(true);
        await demolish(page, state, FACTORY, 'factory');
        await expect.poll(async () => (await sample(page)).truckViews.trucks.length).toBe(0);
        const s = await sample(page);
        expect(s.dockViews.some((d) => d.kind === 'factory')).toBe(false);

        await pressAction(page, 'build-road');
        await pressWorld(page, cellCenter(state.grid, {col: 5, row: 8}), state);
        await expect.poll(async () => (await sample(page)).roads.tiles.some((t) => t.col === 5 && t.row === 8)).toBe(false);
    });

    test('demolishing an Autocannon removes its barrel', async ({page}) => {
        const state = await base(page);
        await place(page, state, 'autocannon', CANNON);
        await expect.poll(async () => (await sample(page)).barrelViews.length).toBe(1);
        await demolish(page, state, CANNON, 'autocannon');
        await expect.poll(async () => (await sample(page)).barrelViews.length).toBe(0);
    });

    test('Demolish is gone at Night, the switch and flag stay, and it returns at dawn', async ({page}) => {
        const state = await base(page);
        await place(page, state, 'barracks', BARRACKS);
        const id = await idOf(page, 'barracks');
        await select(page, state, BARRACKS, id);
        await nightTo(page, 1);
        await expect(byAction(page, 'demolish')).toHaveCount(0);
        await expect(byAction(page, 'toggle-power')).toHaveCount(1);
        await expect(byAction(page, 'set-flag')).toHaveCount(1);
        await finishNight(page);
        await expect(byAction(page, 'demolish')).toHaveAttribute('data-target', id);
    });
}

test.describe('demolition: desktop', () => {
    suite({pressWorld: clickWorld, pressAction: clickAction});
});

test.describe('demolition: mobile landscape', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});
    test.setTimeout(45_000); // each building takes two taps here, and these bases have several

    suite({pressWorld: tapWorld, pressAction: tapAction});

    test('a Factory and a Barracks keep comfortable controls that overlap nothing', async ({page}) => {
        const flow = hqFlow({pressWorld: tapWorld, pressAction: tapAction});
        const state = await flow.start(page, 'mutants=off');
        await flow.buildHq(page, state, HQ);
        await flow.place(page, state, 'powerPlant', PLANT);
        await flow.place(page, state, 'barracks', BARRACKS);
        const check = async (actions) => {
            const boxes = await Promise.all(actions.map((action) => byAction(page, action).boundingBox()));
            boxes.forEach((box, i) => {
                expect(box.width, `${actions[i]} width`).toBeGreaterThanOrEqual(MIN_TOUCH);
                expect(box.height, `${actions[i]} height`).toBeGreaterThanOrEqual(MIN_TOUCH);
                for (let j = i + 1; j < boxes.length; j++) {
                    expect(overlaps(box, boxes[j]), `${actions[i]} and ${actions[j]}`).toBe(false);
                }
            });
        };
        await flow.select(page, state, PLANT, (await sample(page)).buildings.find((b) => b.type === 'powerPlant').id);
        await check(['demolish', 'toggle-power', 'end-day']);
        await flow.select(page, state, BARRACKS, (await sample(page)).buildings.find((b) => b.type === 'barracks').id);
        await check(['set-flag', 'demolish', 'toggle-power', 'end-day']);

        const plain = await byAction(page, 'demolish').boundingBox();
        await tapAction(page, 'demolish');
        await expect(byAction(page, 'demolish')).toHaveAttribute('data-armed', 'true');
        expect(await byAction(page, 'demolish').boundingBox(), 'CONFIRM is the same target').toEqual(plain);
        await check(['set-flag', 'demolish', 'toggle-power', 'end-day']);
    });
});
