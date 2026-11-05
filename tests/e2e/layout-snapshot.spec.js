import {readFileSync} from 'node:fs';
import {test, expect} from '@playwright/test';
import {body, clickAction, clickWorld, tapAction, tapWorld} from '../helpers/canvas.js';
import {hqFlow, qaSim, stepExactly} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * Layout snapshots through the real game: load a fixture into a fresh Day, then
 * check what is actually rendered and that the base plays.
 */

const FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/layouts/fortress22-road-legal.json', import.meta.url), 'utf8'));

const load = (page, snapshot, options) => page.evaluate(([s, o]) => window.__qa.layout.load(s, o), [snapshot, options]);
const exported = (page) => page.evaluate(() => window.__qa.layout.export());

function snapshotSuite(input) {
    const {pressAction} = input;
    const {start, nightTo, finishNight} = hqFlow(input);

    test('a fixture loads with real rendered positions, Power and UI', async ({page}) => {
        const state = await start(page);
        const before = (await sample(page)).resources;
        expect(await load(page, FIXTURE)).toEqual({ok: true, buildings: 15, roads: 17});

        const s = await sample(page);
        expect(s.buildings.map(({type, col, row}) => ({type, col, row}))).toEqual(
            FIXTURE.buildings.map(({type, col, row}) => ({type, col, row})),
        );
        expect(s.buildingViews).toHaveLength(15);
        for (const building of s.buildings) {
            const view = s.buildingViews.find((v) => v.id === building.id);
            expect(view).toMatchObject({
                x: state.grid.originX + building.col * state.grid.tileSize,
                y: state.grid.originY + building.row * state.grid.tileSize,
                width: building.width * state.grid.tileSize,
                height: building.height * state.grid.tileSize,
            });
        }
        expect(s.roadViews).toHaveLength(17);
        expect(s.roads.connected).toBe(17);
        expect(s.power).toMatchObject({generation: 320, demand: 260, status: 'normal'});
        expect(s.powerView.text).toBe('Power 320 / 260\nNORMAL');
        expect(s.resources).toEqual(before);
        expect(s.hudView.text).toBe(`Credits: ${before.credits}   AP: ${before.ap}`);
        expect(s.menuState.hq).toBe('built');
        expect(s.ui.endDayEnabled).toBe(true);
    });

    test('export after a load matches the fixture exactly', async ({page}) => {
        await start(page);
        await load(page, FIXTURE);
        expect(await exported(page)).toEqual(FIXTURE);
    });

    test('a loaded base plays a real Night and settles as normal', async ({page}) => {
        await start(page);
        await load(page, FIXTURE);
        await nightTo(page, 1);
        await finishNight(page);
        const s = await sample(page);
        expect(s.settlement).toMatchObject({day: 1, gross: 300, upkeep: 0, power: {generation: 320, demand: 260, status: 'normal'}});
        expect(s.shiftCycle.day).toBe(2);
    });

    test('an invalid snapshot changes nothing', async ({page}) => {
        await start(page);
        const broken = structuredClone(FIXTURE);
        broken.buildings[3].col = 40;
        expect(await load(page, broken)).toMatchObject({ok: false, reason: 'out-of-bounds'});
        const s = await sample(page);
        expect(s.buildings).toEqual([]);
        expect(s.buildingViews).toEqual([]);
        expect(s.roads.tiles).toEqual([]);
        expect(s.roadViews).toEqual([]);
        expect(s.menuState.hq).toBe('available');
    });

    test('loading is refused during Night, and on a game already in progress', async ({page}) => {
        await start(page);
        await load(page, FIXTURE);
        expect(await load(page, FIXTURE)).toMatchObject({ok: false, reason: 'not-fresh'});
        await nightTo(page, 1);
        expect(await load(page, FIXTURE)).toMatchObject({ok: false, reason: 'not-day'});
        expect((await sample(page)).buildings).toHaveLength(15);
    });

    test('a failed live load cannot stay playable: the run restarts', async ({page}) => {
        await start(page);
        expect(await load(page, FIXTURE, {faultAfter: 4})).toMatchObject({ok: false, reason: 'apply-failed', applied: true});
        await expect(body(page)).toHaveAttribute('data-phase', 'ready');
        await page.waitForFunction(() => typeof window.__qa?.getState === 'function');
        const s = await sample(page);
        expect(s.buildings).toEqual([]);
        expect(s.roads).toBeNull();
        expect(s.resources).toBeNull();

        await pressAction(page, 'start');
        await expect(body(page)).toHaveAttribute('data-phase', 'started');
        expect((await sample(page)).resources.credits).toBe(1250);
        expect(await load(page, FIXTURE)).toMatchObject({ok: true});
    });

    test('before Start there is nothing to export or load into', async ({page}) => {
        await page.goto('/?testMode');
        await expect(body(page)).toHaveAttribute('data-scene', 'game');
        await page.waitForFunction(() => typeof window.__qa?.layout?.load === 'function');
        expect(await exported(page)).toBeNull();
        expect(await load(page, FIXTURE)).toMatchObject({ok: false, reason: 'not-started'});
    });

    test('combat from a loaded base repeats exactly for the same seed', async ({page}) => {
        const night = async () => {
            await nightTo(page, 1);
            await stepExactly(page, 1500);
            await qaSim(page, 'pause');
            const {mutants, autocannons, simulation} = await sample(page);
            return {mutants, autocannons, rng: simulation.rng};
        };
        await start(page, 'seed=98&waveBudget=20');
        await load(page, FIXTURE);
        const first = await night();
        expect(first.mutants.length).toBeGreaterThan(0);
        await page.reload();
        await expect(body(page)).toHaveAttribute('data-scene', 'game');
        await page.waitForFunction(() => typeof window.__qa?.layout?.load === 'function');
        await pressAction(page, 'start');
        await expect(body(page)).toHaveAttribute('data-phase', 'started');
        await load(page, FIXTURE);
        expect(await night()).toEqual(first);
    });
}

test.describe('desktop mouse', () => {
    test.use({viewport: {width: 1280, height: 720}});
    snapshotSuite({pressWorld: clickWorld, pressAction: clickAction});
});

test.describe('mobile landscape touch', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});
    snapshotSuite({pressWorld: tapWorld, pressAction: tapAction});
});
