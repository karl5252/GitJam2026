import {test, expect} from '@playwright/test';
import {clickAction, clickWorld} from '../helpers/canvas.js';
import {cellCenter, hqFlow} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/** The TEST_MODE-only Credits controls, against the real HUD and the real purchase path. */

const flow = hqFlow({pressWorld: clickWorld, pressAction: clickAction});
const qa = (page, method, value) => page.evaluate(([m, v]) => window.__qa.economy[m](v), [method, value]);

test('setCredits and addCredits change the real balance and the HUD at once', async ({page}) => {
    await flow.start(page);
    expect(await qa(page, 'setCredits', 10000)).toBe(10000);
    await expect.poll(async () => (await sample(page)).hudView.text).toBe('Credits: 10000   AP: 5');
    expect(await qa(page, 'addCredits', 5000)).toBe(15000);
    const s = await sample(page);
    expect(s.resources).toEqual({credits: 15000, ap: 5});
    expect(s.hudView.text).toBe('Credits: 15000   AP: 5');
});

test('granted Credits buy things through the normal rules, and nothing else changes', async ({page}) => {
    const state = await flow.start(page);
    await flow.buildHq(page, state, {col: 12, row: 8});
    await qa(page, 'setCredits', 25);
    const before = await sample(page);

    await clickAction(page, 'build-wall');
    await clickWorld(page, cellCenter(state.grid, {col: 3, row: 3}), state);
    await clickWorld(page, cellCenter(state.grid, {col: 4, row: 3}), state);
    await expect.poll(async () => (await sample(page)).placement.lastResult).toMatchObject({ok: false, reason: 'insufficient-credits'});
    const after = await sample(page);
    expect(after.buildings.filter((b) => b.type === 'wall')).toHaveLength(1);
    expect(after.resources).toEqual({credits: 0, ap: before.resources.ap});
    expect(after.power.status).toBe(before.power.status);
    expect(after.simulation.tick).toBe(before.simulation.tick);
});

test('a negative balance shows in the HUD, and spending is refused while in debt', async ({page}) => {
    const state = await flow.start(page);
    await flow.buildHq(page, state, {col: 12, row: 8});
    expect(await qa(page, 'setCredits', -500)).toBe(-500);
    await expect.poll(async () => (await sample(page)).hudView.text).toBe('Credits: -500   AP: 5');

    await clickAction(page, 'build-wall');
    await clickWorld(page, cellCenter(state.grid, {col: 3, row: 3}), state);
    await expect.poll(async () => (await sample(page)).placement.lastResult).toMatchObject({ok: false, reason: 'insufficient-credits'});
    const s = await sample(page);
    expect(s.buildings.map((b) => b.type)).toEqual(['hq']);
    expect(s.resources).toEqual({credits: -500, ap: 5});
});

test('a delivery brings a debt back toward positive, in the balance and the HUD', async ({page}) => {
    const state = await flow.start(page, '?mutants=off');
    await flow.buildHq(page, state, {col: 12, row: 8});
    await clickAction(page, 'build-road');
    for (const [col, row] of [[9, 8], [8, 8], [7, 8], [6, 8], [5, 8]]) await clickWorld(page, cellCenter(state.grid, {col, row}), state);
    await clickAction(page, 'cancel-placement');
    await flow.place(page, state, 'powerPlant', {col: 20, row: 3});
    await flow.place(page, state, 'factory', {col: 3, row: 8});
    await qa(page, 'setCredits', -20);

    await flow.nightTo(page, 1000);
    await expect.poll(async () => (await sample(page)).hudView.text).toBe('Credits: 10   AP: 3');
    expect((await sample(page)).logistics.night.loads).toBe(1);
});

test('invalid amounts are refused and change nothing', async ({page}) => {
    await flow.start(page);
    const refused = await page.evaluate(() => [NaN, Infinity, -Infinity, 1.5, '100', null].map((value) => {
        try {
            window.__qa.economy.setCredits(value);
            return false;
        } catch (error) {
            return error instanceof RangeError;
        }
    }));
    expect(refused).toEqual(Array(6).fill(true));
    expect((await sample(page)).resources.credits).toBe(1250);
});

test('without testMode there is no QA surface at all', async ({page}) => {
    await page.goto('/');
    await page.waitForSelector('canvas');
    expect(await page.evaluate(() => typeof window.__qa)).toBe('undefined');
});
