import {test, expect} from '@playwright/test';
import {clickAction, clickWorld} from '../helpers/canvas.js';
import {hqFlow} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/** window.__qa.sim.setDay through the real game: the HUD, END DAY and the wave it brings. */

const flow = hqFlow({pressWorld: clickWorld, pressAction: clickAction});
const HQ = {col: 12, row: 8};
const setDay = (page, day) => page.evaluate((n) => window.__qa.sim.setDay(n), day);

test('the HUD follows, the base is untouched, and END DAY brings the selected Night', async ({page}) => {
    const state = await flow.start(page);
    await flow.buildHq(page, state, HQ);
    await flow.place(page, state, 'powerPlant', {col: 20, row: 3});
    const before = await sample(page);

    expect(await setDay(page, 30)).toBe(30);
    const after = await sample(page);
    expect(after.shiftCycle).toMatchObject({day: 30, shift: 'day'});
    expect(after.shiftView.text).toBe('Day 30 · Day Shift');
    expect(after.ui.endDayEnabled).toBe(true);
    expect(after.buildings).toEqual(before.buildings);
    expect(after.resources).toEqual(before.resources);
    expect(after.power).toEqual(before.power);
    expect(after.pollution).toEqual(before.pollution);
    expect(after.simulation.tick).toBe(before.simulation.tick);
    expect(after.mutants).toEqual([]);
    expect(after.settlement).toBeNull();

    await flow.nightTo(page, 1);
    const night = await sample(page);
    expect(night.wave).toMatchObject({day: 30, budget: 40, spitters: 6, brutes: 1, bruteSlots: [11], absorbedSlots: [12, 13]});
    expect(night.shiftView.text).toContain('Day 30 · Night Shift');
});

test('it is refused at Night and for bad input, and nothing changes', async ({page}) => {
    const state = await flow.start(page);
    await flow.buildHq(page, state, HQ);
    const refused = await page.evaluate(() => [0, -1, 1.5, NaN, Infinity, '30', null].map((value) => {
        try {
            window.__qa.sim.setDay(value);
            return false;
        } catch (error) {
            return error instanceof RangeError;
        }
    }));
    expect(refused).toEqual(Array(7).fill(true));
    expect((await sample(page)).shiftCycle.day).toBe(1);

    await flow.nightTo(page, 10);
    const message = await page.evaluate(() => {
        try {
            return window.__qa.sim.setDay(9);
        } catch (error) {
            return error.message;
        }
    });
    expect(message).toContain('Day Shift only');
    expect((await sample(page)).shiftCycle).toMatchObject({day: 1, shift: 'night'});
});

test('before Start there is no day to set', async ({page}) => {
    await page.goto('/?testMode');
    await page.waitForFunction(() => typeof window.__qa?.sim?.setDay === 'function');
    const message = await page.evaluate(() => {
        try {
            return window.__qa.sim.setDay(5);
        } catch (error) {
            return error.message;
        }
    });
    expect(message).toContain('after Start');
});
