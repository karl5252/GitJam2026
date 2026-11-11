import {test, expect} from '@playwright/test';
import {byAction, clickAction, clickWorld} from '../helpers/canvas.js';
import {cellCenter, hqFlow, qaSim, stepExactly} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * TASK 025.4B through real presses, on the map a new game gets, in the real ACTIVE
 * cycle (cycle: null): set a work flag, the workers walk out and chop, the jungle
 * clears, Pollution rises, and a wall goes up on the cleared ground. Then the run is
 * lost and restarted, and the new run's jungle is whole again.
 *
 * waveBudget=4 is a fixed wave on every Night: the lone HQ survives Night 1 and falls
 * in Night 2, which is the only way to reach RESTART.
 */

const mouse = {pressWorld: clickWorld, pressAction: clickAction};
const flow = hqFlow(mouse);

/** The jungle tile beside the clearing, west of HQ on its row. */
function edgeOfJungle({terrain}) {
    const {center, rows} = terrain;
    let col = center.col;
    while (rows[center.row][col] !== '#') col--;
    return {col, row: center.row};
}

const glyph = ({terrain}, {col, row}) => terrain.rows[row][col];

async function toNextDay(page) {
    await qaSim(page, 'pause');
    let s = await sample(page);
    if (s.shiftCycle.shift === 'dusk') await stepExactly(page, s.shiftCycle.remainingDuskTicks + 1);
    s = await sample(page);
    await stepExactly(page, s.shiftCycle.remainingNightTicks);
}

test.describe('jungle clearing: desktop', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('flag, walk out, chop, cleared ground, Pollution, a wall on it; a restart brings the jungle back', async ({page}) => {
        let state = await flow.start(page, 'waveBudget=4', {map: null, cycle: null});
        await flow.buildHq(page, state, state.terrain.center);
        await mouse.pressAction(page, 'end-day'); // Day 0 -> Dusk -> Night 1
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('dusk');
        await toNextDay(page);
        await expect.poll(async () => (await sample(page)).shiftCycle).toMatchObject({day: 2, shift: 'day'});

        // The flag: through HQ's buttons, on jungle beside the clearing.
        state = await sample(page);
        const flag = edgeOfJungle(state);
        expect(glyph(state, flag)).toBe('#');
        await mouse.pressWorld(page, cellCenter(state.grid, state.terrain.center), state);
        await expect.poll(async () => (await sample(page)).selectedBuilding).toMatch(/^hq-/);
        await mouse.pressAction(page, 'set-flag');
        await mouse.pressAction(page, 'camera-fit');
        await mouse.pressWorld(page, cellCenter(state.grid, flag), state);
        await expect.poll(async () => (await sample(page)).workers.flag).toEqual(flag);
        const pollution = (await sample(page)).pollution.value;

        // Walk out, then chop: frames, a marked tile and a bar.
        await qaSim(page, 'pause');
        await stepExactly(page, 700);
        let s = await sample(page);
        expect(s.workers.workers.some(({working}) => working)).toBe(true);
        expect(s.workerViews.jobs.length).toBeGreaterThan(0);
        const chopping = s.workerViews.workers.find(({chopping}) => chopping);
        expect([8, 9]).toContain(chopping.frame); // chop only: 10-11 are the repair frames

        // The flag tile clears, once, and pollutes, once per tile.
        await stepExactly(page, 600);
        s = await sample(page);
        expect(glyph(s, flag)).toBe(',');
        expect(s.workers.clearing.cleared).toBeGreaterThan(0);
        expect(s.pollution.value - pollution).toBe(s.workers.clearing.cleared);
        expect(s.pollutionView.text).toContain(`Pollution ${s.pollution.value}`);
        expect(s.terrainView.repainted).toBe(s.workers.clearing.cleared);
        // TASK 039: every plant standing over a cleared tile fell with it, and only those.
        expect(s.terrainView.plants).toBeGreaterThan(1000);
        expect(s.terrainView.plantsStanding).toBeLessThan(s.terrainView.plants);
        const plants = s.terrainView.plants;

        // Call them home, and build on the new ground.
        await qaSim(page, 'resume');
        await mouse.pressWorld(page, cellCenter(s.grid, s.terrain.center), s);
        await expect.poll(async () => (await sample(page)).buildingControlsView.resetLabel).toBe('RECALL\nWORKERS');
        await mouse.pressAction(page, 'reset-flag');
        await expect.poll(async () => (await sample(page)).workers.sent).toBe(false);
        await qaSim(page, 'pause');
        await stepExactly(page, 400);
        await qaSim(page, 'resume');
        await flow.place(page, s, 'wall', flag);
        s = await sample(page);
        expect(s.buildings.some(({type, col, row}) => type === 'wall' && col === flag.col && row === flag.row)).toBe(true);

        // Night 2 takes HQ; RESTART is a new run on the jungle as generated.
        await mouse.pressAction(page, 'end-day');
        await expect.poll(async () => (await sample(page)).shiftCycle.shift, {timeout: 5000}).toBe('dusk');
        await qaSim(page, 'pause');
        await page.evaluate(() => {
            for (let i = 0; i < 40 && window.__qa.getState().shiftCycle.shift !== 'defeated'; i++) window.__qa.sim.stepTicks(240);
        });
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('defeated');
        await expect(byAction(page, 'restart')).toHaveCount(1);
        await mouse.pressAction(page, 'restart');
        await mouse.pressAction(page, 'start');
        await expect.poll(async () => (await sample(page)).terrain).not.toBeNull();
        s = await sample(page);
        expect(glyph(s, flag)).toBe('#');
        expect(s.terrain.rows.join('')).not.toContain(',');
        expect(s.terrainView.repainted).toBe(0);
        expect(s.terrainView).toMatchObject({plants, plantsStanding: plants}); // the same jungle, whole again
    });
});
