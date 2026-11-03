import {test, expect} from '@playwright/test';
import {boot, body, byAction, clickAction, clickWorld, tapAction, tapWorld} from '../helpers/canvas.js';
import {sample} from '../helpers/qa.js';

/**
 * Global power through real canvas input: placing a Power Plant, selecting
 * existing buildings by clicking/tapping them, and switching them ON/OFF via
 * the real toggle button — in Day and in Night Shift. QA `power` is the
 * domain result (derived on demand); `buildingViews` / `powerView` are what
 * was actually rendered.
 */

const UNPOWERED_STROKE = 0xe53935;
const NORMAL_STROKE = 0x212121;
const DISABLED_ALPHA = 0.35;

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

const view = (s, id) => s.buildingViews.find((v) => v.id === id);
const flags = (s) => Object.fromEntries(s.power.buildings.map((b) => [b.id, [b.enabled, b.powered]]));

function powerSuite({pressWorld, pressAction}) {
    async function start(page) {
        await boot(page, {scene: 'game', waitForQA: true});
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

    /** Plant (centre 17,8), Factory (10,8), Outpost (3,3): 1000 Credits, 3 AP. */
    async function poweredBase(page, state) {
        await place(page, state, 'powerPlant', 17, 8);
        await place(page, state, 'factory', 10, 8);
        await place(page, state, 'outpost', 3, 3);
    }

    async function select(page, state, col, row, expectedId) {
        await pressWorld(page, cellCenter(state.grid, col, row), state);
        await expect.poll(async () => (await sample(page)).selectedBuilding).toBe(expectedId);
    }

    async function toggle(page, expectedEnabled) {
        await pressAction(page, 'toggle-power');
        await expect(byAction(page, 'toggle-power')).toHaveAttribute('data-enabled', String(expectedEnabled));
    }

    async function completeNight(page) {
        await pressAction(page, 'end-day');
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('night');
        await qaSim(page, 'pause');
        await stepExactly(page, 3600);
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('day');
    }

    test('Power Plant can be built and supplies the global pool', async ({page}) => {
        const state = await start(page);
        await expect(byAction(page, 'build-powerPlant')).toHaveCount(1);
        expect((await sample(page)).powerView.text).toBe('Power 0 / 0\nNORMAL');

        await place(page, state, 'powerPlant', 17, 8);
        const s = await sample(page);
        expect(s.buildings).toEqual([
            {id: 'powerPlant-1', type: 'powerPlant', col: 16, row: 7, width: 3, height: 3, enabled: true},
        ]);
        expect(s.resources).toEqual({credits: 500, ap: 4});
        expect(s.power).toMatchObject({generation: 100, demand: 0, status: 'normal'});
        expect(s.powerView.text).toBe('Power 100 / 0\nNORMAL');
    });

    test('clicking an existing building selects it without placing anything', async ({page}) => {
        const state = await start(page);
        await poweredBase(page, state);
        const before = await sample(page);
        expect(before.power).toMatchObject({generation: 100, demand: 50, status: 'normal'});
        expect(before.ui.toggleVisible).toBe(false);
        await expect(byAction(page, 'toggle-power')).toHaveCount(0);

        await select(page, state, 17, 8, 'powerPlant-1');
        const s = await sample(page);
        expect(s.buildings).toEqual(before.buildings);
        expect(s.resources).toEqual(before.resources);
        expect(s.grid).toEqual(before.grid);
        // Highlight covers the whole 3x3 footprint.
        expect(s.highlight).toMatchObject({visible: true, x: 256 + 16 * 32, y: 104 + 7 * 32, width: 96, height: 96});
        expect(s.ui.toggleVisible).toBe(true);
        await expect(byAction(page, 'toggle-power')).toHaveAttribute('data-target', 'powerPlant-1');

        // An empty cell clears the building selection and hides the toggle.
        await select(page, state, 22, 14, null);
        expect((await sample(page)).ui.toggleVisible).toBe(false);
        await expect(byAction(page, 'toggle-power')).toHaveCount(0);
    });

    test('Day toggle: plant OFF -> blackout (free), settles without income; ON again -> income returns', async ({page}) => {
        const state = await start(page);
        await poweredBase(page, state);
        await select(page, state, 17, 8, 'powerPlant-1');
        const before = await sample(page);

        await toggle(page, false);
        let s = await sample(page);
        expect(s.power).toMatchObject({generation: 0, demand: 50, status: 'blackout'});
        expect(flags(s)).toEqual({
            'powerPlant-1': [false, false], 'factory-2': [true, false], 'outpost-3': [true, false],
        });
        expect(s.powerView.text).toBe('Power 0 / 50\nBLACKOUT');
        // Rendered: plant dimmed, consumers outlined red.
        expect(view(s, 'powerPlant-1')).toMatchObject({alpha: DISABLED_ALPHA, strokeColor: NORMAL_STROKE});
        expect(view(s, 'factory-2')).toMatchObject({alpha: 1, strokeColor: UNPOWERED_STROKE});
        expect(view(s, 'outpost-3')).toMatchObject({alpha: 1, strokeColor: UNPOWERED_STROKE});
        // Free and grid-neutral.
        expect(s.resources).toEqual(before.resources);
        expect(s.grid).toEqual(before.grid);

        await completeNight(page);
        s = await sample(page);
        expect(s.settlement).toMatchObject({gross: 0, upkeep: 20, net: -20, creditsBefore: 0, creditsAfter: -20});
        expect(s.settlement.power).toEqual({generation: 0, demand: 50, status: 'blackout'});
        expect(s.buildings.find((b) => b.id === 'powerPlant-1').enabled).toBe(false); // persisted

        // Day 2: switch it back on.
        await select(page, state, 17, 8, 'powerPlant-1');
        await toggle(page, true);
        s = await sample(page);
        expect(s.power.status).toBe('normal');
        expect(view(s, 'factory-2')).toMatchObject({alpha: 1, strokeColor: NORMAL_STROKE});
        expect(view(s, 'powerPlant-1').alpha).toBe(1);

        await completeNight(page);
        expect((await sample(page)).settlement).toMatchObject({day: 2, gross: 150, net: 130, creditsBefore: -20, creditsAfter: 110});
    });

    test('Night toggle: switching works during Night Shift and affects power immediately', async ({page}) => {
        const state = await start(page);
        await poweredBase(page, state);
        await pressAction(page, 'end-day');
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('night');
        await qaSim(page, 'pause');
        const before = await sample(page);
        expect(before.ui.buildMenuVisible).toBe(false); // construction is still off at night

        // Select and switch the factory OFF during the night.
        await select(page, state, 10, 8, 'factory-2');
        expect((await sample(page)).ui.toggleVisible).toBe(true);
        await toggle(page, false);
        let s = await sample(page);
        expect(s.power).toMatchObject({generation: 100, demand: 10, status: 'normal'});
        expect(view(s, 'factory-2').alpha).toBe(DISABLED_ALPHA);

        // ...and the plant OFF: blackout for the remaining consumer, immediately.
        await select(page, state, 17, 8, 'powerPlant-1');
        await toggle(page, false);
        s = await sample(page);
        expect(s.power).toMatchObject({generation: 0, demand: 10, status: 'blackout'});
        expect(view(s, 'outpost-3').strokeColor).toBe(UNPOWERED_STROKE);
        expect(s.resources).toEqual(before.resources);
        expect(s.grid).toEqual(before.grid);
        expect(s.shiftCycle.shift).toBe('night');

        // Plant back ON at night, factory left OFF: settlement sees that state.
        await toggle(page, true);
        expect((await sample(page)).power.status).toBe('normal');
        const elapsed = (await sample(page)).shiftCycle.elapsedNightTicks;
        await stepExactly(page, 3600 - elapsed);
        s = await sample(page);
        expect(s.shiftCycle.shift).toBe('day');
        expect(s.settlement).toMatchObject({gross: 0, upkeep: 20, net: -20});
        expect(s.settlement.power).toEqual({generation: 100, demand: 10, status: 'normal'});
    });
}

test.describe('desktop mouse', () => {
    test.use({viewport: {width: 1280, height: 720}});
    powerSuite({pressWorld: clickWorld, pressAction: clickAction});
});

test.describe('mobile landscape touch', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});
    powerSuite({pressWorld: tapWorld, pressAction: tapAction});
});
