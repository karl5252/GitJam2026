import {test, expect} from '@playwright/test';
import {body, byAction, clickAction, clickWorld, tapAction, tapWorld} from '../helpers/canvas.js';
import {hqFlow, qaSim, stepExactly} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * Night speed through real input on the real HQ-first flow. Buttons are pressed
 * through their proxies; QA only pauses and steps the real clock.
 */

const HQ = {col: 12, row: 8};
const PLANT = {col: 12, row: 4};
const SPEEDS = [1, 2, 4];
const MIN_TOUCH_CSS_PX = 44;

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const speedBoxes = (page) => Promise.all(SPEEDS.map((speed) => byAction(page, `speed-${speed}`).boundingBox()));

function speedSuite(input) {
    const {pressWorld, pressAction} = input;
    const {start, buildHq, place, select, nightTo, finishNight} = hqFlow(input);

    async function run(page, query = '') {
        const state = await start(page, query);
        await buildHq(page, state, HQ);
        return state;
    }

    async function expectSelected(page, selected) {
        for (const speed of SPEEDS) {
            await expect(byAction(page, `speed-${speed}`)).toHaveAttribute('data-selected', String(speed === selected));
        }
        const s = await sample(page);
        expect(s.speedView).toEqual({visible: true, selected, labels: ['1×', '2×', '4×']});
        expect(s.simulation.speed).toBe(selected);
    }

    test('the buttons exist only at Night, and the selected state follows each press', async ({page}) => {
        await run(page);
        expect((await sample(page)).speedView.visible).toBe(false);
        await expect(byAction(page, 'speed-1')).toHaveCount(0);

        await nightTo(page, 1);
        await expectSelected(page, 1);
        await pressAction(page, 'speed-4');
        await expectSelected(page, 4);
        await pressAction(page, 'speed-2');
        await expectSelected(page, 2);

        await finishNight(page);
        expect((await sample(page)).speedView.visible).toBe(false);
        await expect(byAction(page, 'speed-2')).toHaveCount(0);
    });

    test('touch targets are large enough and overlap nothing', async ({page}) => {
        const state = await run(page);
        await place(page, state, 'powerPlant', PLANT);
        const endDay = await byAction(page, 'end-day').boundingBox();

        await nightTo(page, 1);
        await select(page, state, PLANT, (await sample(page)).buildings[1].id);
        const toggle = await byAction(page, 'toggle-power').boundingBox();
        const canvas = await page.locator('canvas').boundingBox();
        const gridRight = canvas.x + canvas.width * ((state.grid.originX + state.grid.cols * state.grid.tileSize) / 1280);

        const boxes = await speedBoxes(page);
        for (const [i, box] of boxes.entries()) {
            expect(box.width).toBeGreaterThanOrEqual(MIN_TOUCH_CSS_PX);
            expect(box.height).toBeGreaterThanOrEqual(MIN_TOUCH_CSS_PX);
            expect(box.x).toBeGreaterThanOrEqual(gridRight);
            expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width);
            expect(box.y + box.height).toBeLessThanOrEqual(canvas.y + canvas.height);
            expect(overlaps(box, toggle), 'power toggle').toBe(false);
            expect(overlaps(box, endDay), 'END DAY, which appears in the same frame as dawn').toBe(false);
            for (const other of boxes.slice(i + 1)) expect(overlaps(box, other)).toBe(false);
        }
    });

    test('at 4x, pause freezes the Night and stepping stays exact', async ({page}) => {
        await run(page);
        await nightTo(page, 100);
        await pressAction(page, 'speed-4');
        const before = await sample(page);
        expect(before.shiftCycle.elapsedNightTicks).toBe(100);

        await page.waitForTimeout(300);
        expect((await sample(page)).simulation.tick).toBe(before.simulation.tick);

        expect(await stepExactly(page, 37)).toBe(37);
        const stepped = await sample(page);
        expect(stepped.simulation.tick).toBe(before.simulation.tick + 37);
        expect(stepped.simulation.stepsExecuted).toBe(before.simulation.stepsExecuted + 37);
        expect(stepped.shiftCycle.elapsedNightTicks).toBe(137);
        expect(stepped.simulation.paused).toBe(true);

        await qaSim(page, 'resume');
        await expect.poll(async () => (await sample(page)).shiftCycle.elapsedNightTicks, {timeout: 5000}).toBeGreaterThan(400);
    });

    test('a multi-tick frame crosses dawn once: 3600 ticks and one settlement', async ({page}) => {
        await run(page);
        await nightTo(page, 3590);
        await pressAction(page, 'speed-4');
        expect((await sample(page)).settlement).toBeNull();

        await qaSim(page, 'resume');
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('day');
        const dawn = await sample(page);
        expect(dawn.simulation.tick).toBe(3600);
        expect(dawn.simulation.stepsExecuted).toBe(3600);
        expect(dawn.shiftCycle.day).toBe(2);
        expect(dawn.settlement.day).toBe(1);
        expect(dawn.mutants).toEqual([]);

        await page.waitForTimeout(250);
        const later = await sample(page);
        expect(later.simulation.tick).toBe(3600);
        expect(later.settlement).toEqual(dawn.settlement);
    });

    test('the selected speed lasts into the next Night, and Day stays still', async ({page}) => {
        await run(page);
        await nightTo(page, 1);
        await pressAction(page, 'speed-4');
        await finishNight(page);

        const day = (await sample(page)).simulation.tick;
        await page.waitForTimeout(250);
        expect((await sample(page)).simulation.tick).toBe(day);

        await nightTo(page, 1);
        await expectSelected(page, 4);
    });

    test('a press leaves the selected building and the grid alone', async ({page}) => {
        const state = await run(page);
        await place(page, state, 'powerPlant', PLANT);
        await nightTo(page, 1);
        const plant = (await sample(page)).buildings[1].id;
        await select(page, state, PLANT, plant);

        await pressAction(page, 'speed-2');
        const s = await sample(page);
        expect(s.selectedBuilding).toBe(plant);
        expect(s.ui.toggleVisible).toBe(true);
        expect(s.buildings).toHaveLength(2);
    });

    test('a 4x defeat stops at once, hides the buttons, and restart returns to 1x', async ({page}) => {
        test.setTimeout(30_000);
        const state = await run(page, 'waveBudget=20');
        for (let night = 0; night < 3; night++) {
            await nightTo(page, 1);
            await pressAction(page, 'speed-4');
            const low = await page.evaluate(() => {
                const hp = () => window.__qa.getState().buildings[0]?.hp ?? 0;
                while (window.__qa.getState().shiftCycle.shift === 'night' && hp() > 15) window.__qa.sim.stepTicks(30);
                return window.__qa.getState().shiftCycle.shift === 'night';
            });
            if (low) break;
        }
        expect((await sample(page)).shiftCycle.shift).toBe('night');

        await qaSim(page, 'resume'); // real multi-tick frames deliver the final hits
        await expect.poll(async () => (await sample(page)).shiftCycle.shift, {timeout: 10_000}).toBe('defeated');
        const defeated = await sample(page);
        expect(defeated.settlement?.day ?? 0).toBeLessThan(defeated.defeat.day);
        expect(defeated.speedView.visible).toBe(false);
        await expect(byAction(page, 'speed-4')).toHaveCount(0);
        await page.waitForTimeout(250);
        expect((await sample(page)).simulation.tick).toBe(defeated.simulation.tick);

        await pressAction(page, 'restart');
        await expect(body(page)).toHaveAttribute('data-phase', 'ready');
        expect((await sample(page)).simulation.speed).toBe(1);
        await pressAction(page, 'start');
        await expect(body(page)).toHaveAttribute('data-phase', 'started');
        await buildHq(page, state, HQ);
        await nightTo(page, 1);
        await expectSelected(page, 1);
    });
}

test.describe('desktop mouse', () => {
    test.use({viewport: {width: 1280, height: 720}});
    speedSuite({pressWorld: clickWorld, pressAction: clickAction});
});

test.describe('mobile landscape touch', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});
    speedSuite({pressWorld: tapWorld, pressAction: tapAction});
});
