import {test, expect} from '@playwright/test';
import {byAction, clickAction, clickWorld, tapAction, tapWorld} from '../helpers/canvas.js';
import {hqFlow, qaSim, stepExactly} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';
import {STARTING_RESOURCES} from '../../src/core/economy.js';

const START = STARTING_RESOURCES.credits;

/**
 * The systems together, on the real HQ-first flow with the real wave planner:
 * power, combat, settlement, pollution and waves. Legacy suites cover each
 * rule in depth with ?hq=off; these prove they still hold with HQ present.
 * The default seed's first mutant spawns at the bottom of column 22.
 */

const HQ = {col: 20, row: 8};
const CANNON = {col: 20, row: 11}; // between the first spawn and HQ
const PLANT = {col: 6, row: 3};
const FACTORY = {col: 20, row: 4}; // bottom edge touches the HQ ring

function integratedSuite(input) {
    const {pressAction} = input;
    const {start, buildHq, place, select, nightTo, finishNight, completeNight} = hqFlow(input);

    test('HQ alone powers one Autocannon, which kills the first mutant', {tag: '@smoke'}, async ({page}) => {
        const state = await start(page);
        await buildHq(page, state, HQ);
        await place(page, state, 'autocannon', CANNON);
        let s = await sample(page);
        expect(s.power).toMatchObject({generation: 20, demand: 20, status: 'normal'});
        expect(s.powerView.text).toBe('Power 20 / 20\nNORMAL');

        await nightTo(page, 900);
        s = await sample(page);
        expect(s.wave).toMatchObject({day: 1, threatLevel: 1, autocannons: 1, budget: 1, schedule: [600]});
        expect(s.mutants).toEqual([]);
        expect(s.waveView.text).toBe('Mutants 0 | Wave 1/1');
        expect(s.buildings.map((b) => b.hp)).toEqual([600, 150]);
    });

    test('HQ cannot run a Factory: LOW POWER stops a cannon until demand is cut', {tag: '@smoke'}, async ({page}) => {
        const state = await start(page);
        await buildHq(page, state, HQ);
        await place(page, state, 'autocannon', CANNON);
        await place(page, state, 'factory', FACTORY);
        let s = await sample(page);
        expect(s.power).toMatchObject({generation: 20, demand: 60, status: 'low-power'});
        expect(s.powerView.text).toBe('Power 20 / 60\nLOW POWER');

        await nightTo(page, 700);
        s = await sample(page);
        expect(s.mutants[0].hp).toBe(40); // in range, but the cannon has no power

        await select(page, state, FACTORY, 'factory-3');
        await pressAction(page, 'toggle-power');
        await expect(byAction(page, 'toggle-power')).toHaveAttribute('data-enabled', 'false');
        await qaSim(page, 'stepTicks', 60);
        s = await sample(page);
        expect(s.power).toMatchObject({generation: 20, demand: 20, status: 'normal'});
        expect(s.mutants[0].hp).toBeLessThan(40);
    });

    test('with a Plant, generation is 120, and settlement and pollution count HQ correctly', {tag: '@smoke'}, async ({page}) => {
        const state = await start(page);
        await buildHq(page, state, HQ);
        await place(page, state, 'powerPlant', PLANT);
        await place(page, state, 'factory', FACTORY);
        let s = await sample(page);
        expect(s.resources).toEqual({credits: START - 900, ap: 3});
        expect(s.powerView.text).toBe('Power 120 / 40\nNORMAL');

        await completeNight(page);
        s = await sample(page);
        expect(s.settlement).toMatchObject({
            gross: 150, upkeep: 0, net: 150,
            power: {generation: 120, demand: 40, status: 'normal'},
            pollution: {emitted: 20, after: 20},
        });
        expect(s.settlement.counts).toEqual({hq: 1, outpost: 0, factory: 1, powerPlant: 1, autocannon: 0});
        expect(s.resources).toEqual({credits: START - 900 + 150, ap: 5});
    });

    test('waves escalate on the real planner with HQ in play', async ({page}) => {
        const state = await start(page);
        await buildHq(page, state, HQ);
        await place(page, state, 'powerPlant', PLANT);
        await place(page, state, 'factory', FACTORY);
        await completeNight(page);
        await place(page, state, 'autocannon', CANNON);
        await completeNight(page);
        expect((await sample(page)).pollution).toMatchObject({value: 40, threatLevel: 2});

        await nightTo(page, 1);
        const s = await sample(page);
        expect(s.wave).toMatchObject({day: 3, threatLevel: 2, autocannons: 1, budget: 4, schedule: [600, 1766, 2466, 2700]});
        await finishNight(page);
        expect((await sample(page)).mutants).toEqual([]);
    });

    test('HQ takes damage across nights, and the HP bar follows it', async ({page}) => {
        const state = await start(page);
        await buildHq(page, state, {col: 21, row: 13}); // beside the first spawn, undefended
        await nightTo(page, 3599);
        let s = await sample(page);
        const {hp} = s.buildings[0];
        expect(hp).toBeLessThan(600);
        expect(hp).toBeGreaterThan(0);
        expect(s.hpBarViews).toEqual([expect.objectContaining({id: 'hq-1', visible: true, width: 92 * hp / 600})]);
        await finishNight(page);
        s = await sample(page);
        expect(s.buildings[0].hp).toBe(hp);
        expect(s.defeat).toBeNull();
    });

    test('losing the Plant does not end the run while HQ stands', async ({page}) => {
        const state = await start(page);
        await buildHq(page, state, {col: 6, row: 3}); // far from the early spawns
        await place(page, state, 'powerPlant', {col: 21, row: 13}); // beside the first spawn
        await nightTo(page, 3599);
        await finishNight(page);
        await nightTo(page, 1);
        await page.evaluate(() => {
            const alive = () => window.__qa.getState().buildings.some((b) => b.type === 'powerPlant');
            while (window.__qa.getState().shiftCycle.shift === 'night' && alive()) window.__qa.sim.stepTicks(1);
        });
        const s = await sample(page);
        expect(s.buildings.map((b) => b.type)).toEqual(['hq']);
        expect(s.shiftCycle.shift).toBe('night');
        expect(s.power).toMatchObject({generation: 20, demand: 0, status: 'normal'});
        expect(s.defeat).toBeNull();
        await stepExactly(page, s.shiftCycle.remainingNightTicks);
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('day');
    });
}

test.describe('desktop mouse', () => {
    test.use({viewport: {width: 1280, height: 720}});
    integratedSuite({pressWorld: clickWorld, pressAction: clickAction});
});

test.describe('mobile landscape touch', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});
    integratedSuite({pressWorld: tapWorld, pressAction: tapAction});
});
