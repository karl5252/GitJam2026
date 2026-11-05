import {test, expect} from '@playwright/test';
import {body, byAction, clickAction, clickWorld, tapAction, tapWorld, worldToScreen} from '../helpers/canvas.js';
import {cellCenter, hqFlow, qaSim, stepExactly} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * Factories, docks and trucks through real input on the real HQ-first flow.
 * HQ centred on 12,8 has its ring on 10-14, 6-10 and its receiving dock on
 * 12,10. A Factory centred on 8,8 has its dock on 10,8, which is on the ring.
 * The route is four tiles, so the first load, made on tick 600, lands on 728.
 */

const HQ = {col: 12, row: 8};
const PLANT = {col: 20, row: 3};
const FACTORY = {col: 8, row: 8};
const FAR = {col: 3, row: 3};

const AMBER = 0xffb300;

function logisticsSuite(input) {
    const {pressWorld, pressAction} = input;
    const {start, buildHq, place, select, nightTo, finishNight} = hqFlow(input);

    async function base(page, query = 'mutants=off') {
        const state = await start(page, query);
        await buildHq(page, state, HQ);
        await place(page, state, 'powerPlant', PLANT);
        await place(page, state, 'factory', FACTORY);
        return state;
    }

    test('a Factory and HQ show their fixed docks', async ({page}) => {
        await base(page);
        const s = await sample(page);
        expect(s.dockViews).toEqual([{col: 12, row: 10, kind: 'hq'}, {col: 10, row: 8, kind: 'factory'}]);
        expect(s.truckViews.trucks).toHaveLength(1);
    });

    test('a press shows the dock a Factory needs, and rejects a missing one', async ({page}) => {
        const state = await start(page, 'mutants=off');
        await buildHq(page, state, HQ);
        await pressAction(page, 'build-factory');
        await pressWorld(page, cellCenter(state.grid, FAR), state);
        await expect.poll(async () => (await sample(page)).placementHint).toBe('Factory dock (right side) needs a connected road');
        const s = await sample(page);
        expect(s.placement.preview).toMatchObject({ok: false, reason: 'no-road-access', dock: {col: 5, row: 3}});
        expect(s.dockPreviewView).toMatchObject({
            visible: true, x: state.grid.originX + 5 * state.grid.tileSize, y: state.grid.originY + 3 * state.grid.tileSize,
        });
        expect(s.buildings).toHaveLength(1);

        await pressAction(page, 'cancel-placement');
        expect((await sample(page)).dockPreviewView.visible).toBe(false);
    });

    test('a truck loads, drives, delivers, and Credits rise at that moment', {tag: '@smoke'}, async ({page}) => {
        await base(page);
        await nightTo(page, 599);
        const before = (await sample(page)).resources.credits;
        expect((await sample(page)).logistics.trucks[0]).toMatchObject({state: 'idle', cargo: 0});

        await stepExactly(page, 1);
        let s = await sample(page);
        expect(s.logistics.trucks[0]).toMatchObject({state: 'outbound', cargo: 1});
        expect(s.truckViews.trucks[0].fillColor).toBe(AMBER);

        const start0 = s.truckViews.trucks[0];
        await stepExactly(page, 64);
        s = await sample(page);
        const view = s.truckViews.trucks[0];
        expect([view.x, view.y]).toEqual([s.logistics.trucks[0].x, s.logistics.trucks[0].y]);
        expect([view.x, view.y]).not.toEqual([start0.x, start0.y]);
        expect(s.resources.credits).toBe(before);

        await stepExactly(page, 63);
        expect((await sample(page)).resources.credits).toBe(before);
        await stepExactly(page, 1);
        s = await sample(page);
        expect(s.resources.credits).toBe(before + 30);
        expect(s.hudView.text).toContain(`Credits: ${before + 30}`);
        expect(s.logistics.trucks[0]).toMatchObject({state: 'returning', cargo: 0});
    });

    test('a full Night earns 150, and settlement adds nothing on top', async ({page}) => {
        await base(page);
        const before = (await sample(page)).resources.credits;
        await nightTo(page, 1);
        await finishNight(page);
        const s = await sample(page);
        expect(s.resources.credits).toBe(before + 150);
        expect(s.settlement).toMatchObject({gross: 0, net: 0});
        expect(s.logistics.lastNight).toEqual({loads: 5, credits: 150, cargoLost: 0});
        expect(s.settlementView.text).toContain('Income  +150');
        expect(s.settlementView.text).toContain('Net     +150');
    });

    test('a switched-off Factory produces nothing, and its truck stays parked', async ({page}) => {
        const state = await base(page);
        const factory = (await sample(page)).buildings[2];
        await select(page, state, FACTORY, factory.id);
        await pressAction(page, 'toggle-power');
        await expect(byAction(page, 'toggle-power')).toHaveAttribute('data-enabled', 'false');
        const before = (await sample(page)).resources.credits;

        await nightTo(page, 1);
        await finishNight(page);
        const s = await sample(page);
        expect(s.resources.credits).toBe(before);
        expect(s.logistics.factories[0]).toMatchObject({progress: 0, stored: 0});
        expect(s.logistics.lastNight.loads).toBe(0);
    });

    test('losing power mid-Night pauses production', async ({page}) => {
        const state = await base(page);
        const plant = (await sample(page)).buildings[1];
        await nightTo(page, 300);
        await select(page, state, PLANT, plant.id);
        await pressAction(page, 'toggle-power');
        await expect(byAction(page, 'toggle-power')).toHaveAttribute('data-enabled', 'false');
        await stepExactly(page, 200);
        expect((await sample(page)).logistics.factories[0].progress).toBe(300);
    });

    test('trucks park at dawn, and the next Night runs normally', async ({page}) => {
        await base(page);
        await nightTo(page, 1);
        await finishNight(page);
        let s = await sample(page);
        expect(s.logistics.trucks[0]).toMatchObject({state: 'idle', cargo: 0});
        const before = s.resources.credits;
        await nightTo(page, 1);
        await finishNight(page);
        s = await sample(page);
        expect(s.resources.credits).toBe(before + 150);
    });

    test('a restart clears Factories, trucks and views', async ({page}) => {
        await base(page, 'waveBudget=20');
        const flow = hqFlow(input);
        await flow.stepToDefeat(page, 6);
        await pressAction(page, 'restart');
        await expect(body(page)).toHaveAttribute('data-phase', 'ready');
        expect((await sample(page)).logistics).toBeNull();
        await pressAction(page, 'start');
        await expect(body(page)).toHaveAttribute('data-phase', 'started');
        const s = await sample(page);
        expect(s.logistics.trucks).toEqual([]);
        expect(s.truckViews).toEqual({trucks: [], stored: {}});
    });

    test('4x and QA stepping stay exact with trucks on the road', async ({page}) => {
        await base(page);
        await nightTo(page, 3590);
        await pressAction(page, 'speed-4');
        await qaSim(page, 'resume');
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('day');
        const s = await sample(page);
        expect(s.simulation.tick).toBe(3600);
        expect(s.logistics.lastNight.loads).toBe(5);
    });
}

test.describe('desktop mouse', () => {
    test.use({viewport: {width: 1280, height: 720}});
    logisticsSuite({pressWorld: clickWorld, pressAction: clickAction});

    test('hovering a Factory previews its dock tile', async ({page}) => {
        const {start, buildHq} = hqFlow({pressWorld: clickWorld, pressAction: clickAction});
        const state = await start(page, 'mutants=off');
        await buildHq(page, state, HQ);
        await clickAction(page, 'build-factory');
        const p = await worldToScreen(page, cellCenter(state.grid, FACTORY), state);
        await page.mouse.move(p.x, p.y);
        await expect.poll(async () => (await sample(page)).placement.preview?.ok).toBe(true);
        expect((await sample(page)).dockPreviewView).toMatchObject({
            visible: true, x: state.grid.originX + 10 * state.grid.tileSize, y: state.grid.originY + 8 * state.grid.tileSize,
        });
    });
});

test.describe('mobile landscape touch', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});
    logisticsSuite({pressWorld: tapWorld, pressAction: tapAction});
});
