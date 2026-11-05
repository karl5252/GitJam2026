import {test, expect} from '@playwright/test';
import {body, byAction, clickAction, clickWorld, tapAction, tapWorld} from '../helpers/canvas.js';
import {cellCenter, hqFlow, qaSim} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * Defeat and restart on the real HQ-first flow. waveBudget=20 is the existing
 * TEST_MODE schedule override, used so HQ falls within a few nights.
 */

const HQ = {col: 12, row: 8};
const FAST_DEFEAT = 'waveBudget=20';

const counts = (page) => page.evaluate(() => window.__qa.perf.counts());

function gameOverSuite(input) {
    const {pressWorld, pressAction} = input;
    const {start, buildHq, place, stepToDefeat, select} = hqFlow(input);

    async function defeatedRun(page) {
        const state = await start(page, FAST_DEFEAT);
        await buildHq(page, state, HQ);
        await stepToDefeat(page);
        return state;
    }

    test('losing HQ ends the run with the overlay and the completed shift count', async ({page}) => {
        await defeatedRun(page);
        const s = await sample(page);
        expect(s.phase).toBe('defeated');
        await expect(body(page)).toHaveAttribute('data-phase', 'defeated');
        await expect(body(page)).toHaveAttribute('data-modal', 'game-over');
        expect(s.shiftCycle.shift).toBe('defeated');
        expect(s.defeat.completedShifts).toBe(s.defeat.day - 1);
        expect(s.gameOverView).toEqual({
            visible: true,
            title: 'HEADQUARTERS DESTROYED',
            quote: '"Your replacement will arrive tomorrow."',
            stat: `Completed shifts: ${s.defeat.completedShifts}`,
        });
        expect(s.buildings).toEqual([]);
        expect(s.buildingViews).toEqual([]);
        expect(s.shiftView.text).toBe(`Day ${s.defeat.day} · Headquarters destroyed`);
    });

    test('Game Over hides the play UI and leaves the survivors frozen', async ({page}) => {
        await defeatedRun(page);
        const s = await sample(page);
        expect(s.ui).toMatchObject({buildMenuVisible: false, endDayVisible: false, cancelVisible: false, toggleVisible: false});
        expect(s.waveView.visible).toBe(false);
        expect(s.mutants.length).toBeGreaterThan(0);
        expect(s.mutantViews).toHaveLength(s.mutants.length);
        await expect(byAction(page, 'end-day')).toHaveCount(0);
        await expect(byAction(page, 'build-outpost')).toHaveCount(0);
        await expect(byAction(page, 'restart')).toHaveCount(1);

        await page.waitForTimeout(300); // real frames run, and must change nothing
        const later = await sample(page);
        expect(later.mutants).toEqual(s.mutants);
        expect(later.simulation.tick).toBe(s.simulation.tick);
    });

    test('nothing moves on after defeat: QA stepping, resume and grid input are inert', async ({page}) => {
        const state = await defeatedRun(page);
        const before = await sample(page);
        expect(await qaSim(page, 'stepTicks', 240)).toBe(0);
        await qaSim(page, 'resume');
        await pressWorld(page, cellCenter(state.grid, {col: 3, row: 3}), state);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        const after = await sample(page);
        for (const key of ['mutants', 'buildings', 'resources', 'pollution', 'settlement', 'shiftCycle', 'defeat', 'selectedCell']) {
            expect(after[key], key).toEqual(before[key]);
        }
        expect(after.simulation.tick).toBe(before.simulation.tick);
        expect(after.selectedBuilding).toBeNull();
    });

    test('a selected HQ clears cleanly when it falls', async ({page}) => {
        const state = await start(page, FAST_DEFEAT);
        await buildHq(page, state, HQ);
        await select(page, state, HQ, 'hq-1');
        await stepToDefeat(page);
        const s = await sample(page);
        expect(s.selectedBuilding).toBeNull();
        expect(s.highlight.visible).toBe(false);
    });

    test('restart returns to the title, and the next run starts clean', async ({page}) => {
        await defeatedRun(page);
        await pressAction(page, 'restart');
        await expect(body(page)).toHaveAttribute('data-phase', 'ready');
        await page.waitForFunction(() => window.__qa?.getState().phase === 'ready');
        let s = await sample(page);
        expect(s.ui).toMatchObject({titleVisible: true, startVisible: true});
        expect(s.gameOverView).toBeNull();
        expect(s.defeat).toBeNull();
        expect(s.mutants).toBeNull();
        expect(s.simulation).toMatchObject({running: false, tick: 0, stepsExecuted: 0, rng: {seed: 731, state: 731}});
        await expect(body(page)).not.toHaveAttribute('data-modal', 'game-over');
        await expect(byAction(page, 'restart')).toHaveCount(0);

        await pressAction(page, 'start');
        await expect(body(page)).toHaveAttribute('data-phase', 'started');
        s = await sample(page);
        expect(s.buildings).toEqual([]);
        expect(s.grid.occupants).toEqual([]);
        expect(s.resources).toEqual({credits: 1000, ap: 5});
        expect(s.pollution).toMatchObject({value: 0, threatLevel: 1});
        expect(s.shiftCycle).toMatchObject({day: 1, shift: 'day'});
        expect(s.settlement).toBeNull();
        expect(s.mutants).toEqual([]);
        expect(s.autocannons).toEqual([]);
        expect(s.selectedBuilding).toBeNull();
        expect(s.menuState).toEqual({hq: 'available', outpost: 'locked', factory: 'locked', powerPlant: 'locked', autocannon: 'locked'});
        expect(s.menuLabels.hq).toBe('HQ 3x3\n0c · 0 AP');
        expect(s.ui.endDayEnabled).toBe(false);
        expect(s.powerView.text).toBe('Power 0 / 0\nNORMAL');
    });

    test('a restarted run can build HQ again and plays normally', async ({page}) => {
        const state = await defeatedRun(page);
        await pressAction(page, 'restart');
        await page.waitForFunction(() => window.__qa?.getState().phase === 'ready');
        await pressAction(page, 'start');
        await expect(body(page)).toHaveAttribute('data-phase', 'started');
        await buildHq(page, state, {col: 6, row: 5});
        await place(page, state, 'autocannon', {col: 6, row: 8});
        const s = await sample(page);
        expect(s.buildings.map((b) => b.id)).toEqual(['hq-1', 'autocannon-2']);
        expect(s.barrelViews).toHaveLength(1);
    });

    test('pressing RESTART twice does not restart twice or break the title', async ({page}) => {
        await defeatedRun(page);
        const box = await byAction(page, 'restart').boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForFunction(() => window.__qa?.getState().phase === 'ready');
        await page.waitForTimeout(200);
        expect((await sample(page)).phase).toBe('ready');
        await expect(byAction(page, 'start')).toHaveCount(1);
    });

    test('repeated defeat and restart keeps objects and listeners flat', async ({page}) => {
        const titles = [];
        for (let run = 0; run < 3; run++) {
            if (run === 0) await defeatedRun(page);
            else {
                await pressAction(page, 'start');
                await expect(body(page)).toHaveAttribute('data-phase', 'started');
                const state = await sample(page);
                await buildHq(page, state, HQ);
                await stepToDefeat(page);
            }
            await pressAction(page, 'restart');
            await page.waitForFunction(() => window.__qa?.getState().phase === 'ready');
            await page.waitForTimeout(100);
            titles.push(await counts(page));
        }
        expect(titles[1]).toEqual(titles[0]);
        expect(titles[2]).toEqual(titles[0]);
    });
}

test.describe('desktop mouse', () => {
    test.use({viewport: {width: 1280, height: 720}});
    gameOverSuite({pressWorld: clickWorld, pressAction: clickAction});
});

test.describe('mobile landscape touch', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});
    gameOverSuite({pressWorld: tapWorld, pressAction: tapAction});
});
