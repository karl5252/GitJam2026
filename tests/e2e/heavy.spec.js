import {readFileSync} from 'node:fs';
import {test, expect} from '@playwright/test';
import {byAction, clickAction, clickWorld, tapAction, tapWorld, showBuildMenu} from '../helpers/canvas.js';
import {cellCenter, hqFlow, stepExactly} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * Siege Cannons, refits and the LOW_POWER question, through real input on the real
 * HQ-first flow. HQ centred on 12,8 supplies 20 power; a Plant at pointer 20,3 adds
 * 100. A Barracks at pointer 16,8 has its exit on the ring. A 2x2 goes down with its
 * top-left tile on the pointer.
 */

const HQ = {col: 12, row: 8};
const PLANT = {col: 20, row: 3};
const BARRACKS = {col: 16, row: 8};
const SIEGE = {col: 3, row: 8};
const MIN_TOUCH = 44;
const WARNING = 'LOW POWER: this stops every powered building. Press again to build';

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function suite(input) {
    const {pressWorld, pressAction} = input;
    const {start, buildHq, place, select, nightTo, finishNight} = hqFlow(input);
    const pressCell = (page, state, cell) => pressWorld(page, cellCenter(state.grid, cell), state);
    const ghostShowsAtOnce = pressWorld === tapWorld;

    /** Every Day control in view is big enough and touches nothing else. */
    async function checkControls(page, actions) {
        // DESTROY and REPAIR are the agreed 48x48 logical icon squares (TASK 025.4C UI hotfix);
        // every other control keeps the 44 CSS px rule.
        const canvas = await page.locator('canvas').boundingBox();
        const iconMin = 48 * Math.min(canvas.width / 1280, canvas.height / 720) - 0.5;
        const minFor = (action) => (action === 'demolish' || action === 'repair' ? iconMin : MIN_TOUCH);
        const boxes = await Promise.all(actions.map((action) => byAction(page, action).boundingBox()));
        boxes.forEach((box, i) => {
            expect(box, actions[i]).not.toBeNull();
            expect(box.width, `${actions[i]} width`).toBeGreaterThanOrEqual(minFor(actions[i]));
            expect(box.height, `${actions[i]} height`).toBeGreaterThanOrEqual(minFor(actions[i]));
            for (let j = i + 1; j < boxes.length; j++) {
                expect(overlaps(box, boxes[j]), `${actions[i]} and ${actions[j]}`).toBe(false);
            }
        });
    }

    test('all twelve menu slots keep their size, and clear END DAY', async ({page}) => {
        const state = await start(page, 'mutants=off');
        await buildHq(page, state, HQ);
        await showBuildMenu(page);
        await checkControls(page, [
            'build-hq', 'build-outpost', 'build-factory', 'build-powerPlant', 'build-autocannon', 'build-road', 'build-wall',
            'build-barracks', 'build-gateVertical', 'build-gateHorizontal', 'build-siegeCannon', 'end-day',
        ]);
        const {menuLabels} = await sample(page);
        expect(menuLabels.siegeCannon).toBe('Siege 2x2\n600c · 1 AP\nheavy · 20P');
        expect(menuLabels.autocannon).toBe('Autocannon 1x1\n250c · 1 AP');
    });

    test('a Siege Cannon is bought from the menu, is 2x2, and is available from Day 1', async ({page}) => {
        const state = await start(page, 'mutants=off');
        await expect(byAction(page, 'build-siegeCannon')).toHaveAttribute('data-state', 'locked');
        await buildHq(page, state, HQ);
        await expect(byAction(page, 'build-siegeCannon')).toHaveAttribute('data-state', 'available');
        await place(page, state, 'siegeCannon', SIEGE);
        const s = await sample(page);
        expect(s.buildings.at(-1)).toMatchObject({type: 'siegeCannon', col: 3, row: 8, width: 2, height: 2, hp: 250});
        expect(s.resources).toEqual({credits: 650, ap: 4});
        expect(s.power).toMatchObject({generation: 20, demand: 20, status: 'normal'});
        expect(s.siegeViews.guns).toHaveLength(1);
    });

    test('it fires a visible shell, marks the landing, and dawn clears it', async ({page}) => {
        const state = await start(page, 'waveBudget=1&waveBrutes=0');
        await buildHq(page, state, HQ);
        await place(page, state, 'siegeCannon', {col: 16, row: 12});
        await nightTo(page, 600);
        let s = await sample(page);
        for (let i = 0; i < 80 && s.siegeShells.length === 0; i++) {
            await stepExactly(page, 10);
            s = await sample(page);
        }
        expect(s.siegeShells).toHaveLength(1);
        expect(s.siegeViews.shells).toHaveLength(1);
        expect(s.siegeViews.shells[0].visible).toBe(true);
        expect(s.siegeViews.shells[0]).toMatchObject({markX: s.siegeShells[0].x, markY: s.siegeShells[0].y});
        expect(s.siegeCannons[0].cooldown).toBeGreaterThan(250);

        await stepExactly(page, 40);
        await finishNight(page);
        const dawn = await sample(page);
        expect(dawn.siegeShells).toEqual([]);
        expect(dawn.siegeViews.shells).toEqual([]);
        expect(dawn.siegeViews.impacts).toEqual([]);
    });

    test('a refit takes two presses and pays once; anything else cancels it', async ({page}) => {
        const state = await start(page, 'mutants=off');
        await buildHq(page, state, HQ);
        await place(page, state, 'powerPlant', PLANT);
        await place(page, state, 'barracks', BARRACKS);
        const {id} = (await sample(page)).buildings.at(-1);
        await select(page, state, BARRACKS, id);
        await page.evaluate(() => window.__qa.economy.setCredits(1000));
        const before = (await sample(page)).resources;
        expect((await sample(page)).buildingControlsView).toMatchObject({refitVisible: true, refitLabel: 'Refit: ROCKET\n200c · 1 AP', refitArmed: null});

        await pressAction(page, 'refit');
        await expect.poll(async () => (await sample(page)).buildingControlsView.refitArmed).toBe(id);
        expect((await sample(page)).buildingControlsView.refitLabel).toBe('CONFIRM\n200c · 1 AP');
        expect((await sample(page)).resources).toEqual(before);

        await pressAction(page, 'toggle-power'); // any other action disarms it
        await expect.poll(async () => (await sample(page)).buildingControlsView.refitArmed).toBeNull();
        await pressAction(page, 'toggle-power');
        await pressAction(page, 'refit');
        await expect.poll(async () => (await sample(page)).buildingControlsView.refitArmed).toBe(id);
        await pressAction(page, 'demolish'); // arming Demolish disarms it, and destroys nothing yet
        await expect.poll(async () => (await sample(page)).buildingControlsView.refitArmed).toBeNull();
        expect((await sample(page)).buildingControlsView.demolishArmed).toBe(id);
        await pressAction(page, 'refit');
        await expect.poll(async () => (await sample(page)).buildingControlsView.demolishArmed).toBeNull();
        expect((await sample(page)).buildings.some((b) => b.id === id)).toBe(true);

        await pressAction(page, 'refit');
        await expect.poll(async () => (await sample(page)).buildings.find((b) => b.id === id).role).toBe('rocket');
        const after = await sample(page);
        expect(after.resources).toEqual({credits: before.credits - 200, ap: before.ap - 1});
        expect(after.buildingControlsView).toMatchObject({refitLabel: 'Refit: RIFLE\n200c · 1 AP', refitArmed: null});
        await expect.poll(async () => (await sample(page)).infantryViews.roofs[id]).toBe('1R');
    });

    test('a refused refit says why and costs nothing', async ({page}) => {
        const state = await start(page, 'mutants=off');
        await buildHq(page, state, HQ);
        await place(page, state, 'powerPlant', PLANT);
        await place(page, state, 'barracks', BARRACKS);
        const {id} = (await sample(page)).buildings.at(-1);
        await select(page, state, BARRACKS, id);
        await page.evaluate(() => window.__qa.economy.setCredits(199));
        await pressAction(page, 'refit');
        await expect.poll(async () => (await sample(page)).buildingControlsView.refitArmed).toBe(id);
        await pressAction(page, 'refit');
        await expect.poll(async () => (await sample(page)).placementHint).toBe('A refit needs 200 Credits and 1 AP');
        const s = await sample(page);
        expect(s.resources.credits).toBe(199);
        expect(s.buildings.find((b) => b.id === id).role).toBeUndefined();
    });

    test('refit is a Day control, and a rocket squad of two musters at Night with its controls in place', async ({page}) => {
        const state = await start(page, 'mutants=off');
        await buildHq(page, state, HQ);
        await place(page, state, 'powerPlant', PLANT);
        await place(page, state, 'barracks', BARRACKS);
        const {id} = (await sample(page)).buildings.at(-1);
        await select(page, state, BARRACKS, id);
        await pressAction(page, 'set-flag');
        await expect.poll(async () => (await sample(page)).flagMode).toBe(id);
        await pressCell(page, state, {col: 20, row: 12});
        await expect.poll(async () => (await sample(page)).flagMode).toBeNull();
        await checkControls(page, ['set-flag', 'reset-flag', 'demolish', 'toggle-power', 'refit', 'end-day']);
        await pressAction(page, 'refit');
        await expect.poll(async () => (await sample(page)).buildingControlsView.refitArmed).toBe(id);
        await pressAction(page, 'refit');
        await expect.poll(async () => (await sample(page)).buildings.find((b) => b.id === id).role).toBe('rocket');

        await nightTo(page, 100);
        await expect(byAction(page, 'refit')).toHaveCount(0);
        await checkControls(page, ['set-flag', 'reset-flag', 'toggle-power', 'speed-1', 'speed-2', 'speed-4']);
        const s = await sample(page);
        expect(s.infantry.soldiers).toHaveLength(2);
        expect(s.infantry.soldiers.every(({role}) => role === 'rocket')).toBe(true);
        expect(s.infantryViews.pips[id]).toBe(2);
    });

    test('rockets are visible in flight and land', async ({page}) => {
        test.setTimeout(40_000);
        const state = await start(page, 'waveBudget=6&waveBrutes=1');
        await buildHq(page, state, HQ);
        await place(page, state, 'powerPlant', PLANT);
        await place(page, state, 'barracks', BARRACKS);
        const {id} = (await sample(page)).buildings.at(-1);
        await select(page, state, BARRACKS, id);
        await pressAction(page, 'refit');
        await expect.poll(async () => (await sample(page)).buildingControlsView.refitArmed).toBe(id);
        await pressAction(page, 'refit');
        await expect.poll(async () => (await sample(page)).buildings.find((b) => b.id === id).role).toBe('rocket');
        await nightTo(page, 600);
        let s = await sample(page);
        for (let i = 0; i < 400 && s.rockets.length === 0 && s.shiftCycle.shift === 'night'; i++) {
            await stepExactly(page, 6);
            s = await sample(page);
        }
        expect(s.rockets.length).toBeGreaterThan(0);
        expect(s.infantryViews.rockets).toHaveLength(s.rockets.length);
        await stepExactly(page, 30);
        await finishNight(page);
        const dawn = await sample(page);
        expect(dawn.rockets).toEqual([]);
        expect(dawn.infantryViews.rockets).toEqual([]);
    });

    test('a purchase that would cause LOW_POWER warns first, and the second press on that tile builds it', async ({page}) => {
        const state = await start(page, 'mutants=off');
        await buildHq(page, state, HQ);
        const before = (await sample(page)).resources;
        await pressAction(page, 'build-outpost');
        await pressCell(page, state, {col: 3, row: 3});
        await expect.poll(async () => (await sample(page)).buildings.length).toBe(2); // 10 of 20: no warning
        await pressCell(page, state, {col: 3, row: 4});
        await expect.poll(async () => (await sample(page)).buildings.length).toBe(3); // 20 of 20: still none
        expect((await sample(page)).powerWarning).toBeNull();

        await pressCell(page, state, {col: 3, row: 5});
        await expect.poll(async () => (await sample(page)).powerWarning).toEqual({type: 'outpost', col: 3, row: 5});
        let s = await sample(page);
        expect(s.placementHint).toBe(WARNING);
        expect(s.buildings).toHaveLength(3);
        expect(s.resources.credits).toBe(before.credits - 200);

        await pressCell(page, state, {col: 3, row: 5});
        await expect.poll(async () => (await sample(page)).buildings.length).toBe(4);
        s = await sample(page);
        expect(s.power.status).toBe('low-power');
        expect(s.powerWarning).toBeNull();
        expect(s.placementHint).toBe('');

        await pressCell(page, state, {col: 3, row: 6}); // already LOW_POWER: nothing to warn about
        await expect.poll(async () => (await sample(page)).buildings.length).toBe(5);
    });

    test('another tile, another building or leaving the mode takes the warning back', async ({page}) => {
        const state = await start(page, 'mutants=off');
        await buildHq(page, state, HQ);
        await place(page, state, 'siegeCannon', SIEGE); // 20 of 20
        const press = async (cell) => {
            await pressCell(page, state, cell);
            await expect.poll(async () => (await sample(page)).powerWarning).toEqual({type: 'outpost', ...cell});
        };

        await pressAction(page, 'build-outpost');
        await press({col: 8, row: 3});
        await press({col: 9, row: 3}); // another tile starts again
        expect((await sample(page)).buildings).toHaveLength(2);

        await pressAction(page, 'build-autocannon'); // another building
        if (ghostShowsAtOnce) {
            // Its ghost is already on the map, and it brings a warning of its own.
            await expect.poll(async () => (await sample(page)).powerWarning?.type).toBe('autocannon');
        } else {
            await expect.poll(async () => (await sample(page)).powerWarning).toBeNull();
            await expect.poll(async () => (await sample(page)).placementHint).toBe('');
        }

        await pressAction(page, 'build-outpost');
        await press({col: 8, row: 3});
        await pressAction(page, 'cancel-placement'); // leaving the mode
        await expect.poll(async () => (await sample(page)).powerWarning).toBeNull();
        await pressAction(page, 'build-outpost');
        await pressCell(page, state, {col: 8, row: 3}); // and it asks again
        await expect.poll(async () => (await sample(page)).powerWarning).toEqual({type: 'outpost', col: 8, row: 3});
        expect((await sample(page)).buildings).toHaveLength(2);
    });

    test('an invalid tile is refused as usual, with no warning', async ({page}) => {
        const state = await start(page, 'mutants=off');
        await buildHq(page, state, HQ);
        await place(page, state, 'siegeCannon', SIEGE);
        await pressAction(page, 'build-outpost');
        await pressCell(page, state, HQ);
        await expect.poll(async () => (await sample(page)).placement.lastResult?.ok).toBe(false);
        expect((await sample(page)).powerWarning).toBeNull();
    });
}

test.describe('heavy metal: desktop', () => {
    suite({pressWorld: clickWorld, pressAction: clickAction});
});

test.describe('heavy metal: mobile landscape', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});
    suite({pressWorld: tapWorld, pressAction: tapAction});
});

test('the player-authored version 3 fortress loads through the QA surface and exports the same', async ({page}) => {
    const layout = JSON.parse(readFileSync(new URL('../fixtures/layouts/golden-fortress-brute-defense-v3.json', import.meta.url), 'utf8'));
    const {start} = hqFlow({pressWorld: clickWorld, pressAction: clickAction});
    await start(page, 'mutants=off');
    const result = await page.evaluate((s) => window.__qa.layout.load(s), layout);
    expect(result).toEqual({ok: true, buildings: 75, roads: 33});
    expect(await page.evaluate(() => window.__qa.layout.export())).toEqual(layout);
    const s = await sample(page);
    expect(s.power).toMatchObject({generation: 420, demand: 380, status: 'normal'});
    await expect.poll(async () => (await sample(page)).siegeViews.guns.length).toBe(2);
    expect(Object.values((await sample(page)).infantryViews.roofs).sort()).toEqual(['1R', '2R']);
});

test('a layout load is never asked: a base past its power loads as it stands', async ({page}) => {
    const {start, buildHq, place} = hqFlow({pressWorld: clickWorld, pressAction: clickAction});
    const state = await start(page, 'mutants=off');
    await buildHq(page, state, HQ);
    await place(page, state, 'siegeCannon', SIEGE);
    await place(page, state, 'autocannon', {col: 9, row: 3}); // the helper gives it the second press
    const layout = await page.evaluate(() => window.__qa.layout.export());
    await page.reload();
    await page.waitForFunction(() => typeof window.__qa?.getState === 'function');
    await clickAction(page, 'start');
    await expect(page.locator('body')).toHaveAttribute('data-phase', 'started');
    const result = await page.evaluate((s) => window.__qa.layout.load(s), layout);
    expect(result.ok).toBe(true);
    const s = await sample(page);
    expect(s.power.status).toBe('low-power');
    expect(s.powerWarning).toBeNull();
});
