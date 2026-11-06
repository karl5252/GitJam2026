import {test, expect} from '@playwright/test';
import {clickAction, clickWorld, tapAction, tapWorld} from '../helpers/canvas.js';
import {cellCenter, hqFlow, stepExactly} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * Spitters through real input on the real HQ-first flow. `?waveBudget=1&
 * waveSpitters=1` gives the real Mutants one Spitter on tick 600, and the seed puts
 * it at the bottom of column 22. HQ centred on 12,8 has its ring on 10-14, 6-10, and
 * the Plant at pointer 20,3 is what it comes for: it stops about 11 tiles south of
 * that, far outside anything guarding the Plant.
 */

const HQ = {col: 12, row: 8};
const PLANT = {col: 20, row: 3};
const BARRACKS = {col: 16, row: 8};
const FORWARD_FLAG = {col: 21, row: 11};
const QUERY = 'waveBudget=1&waveSpitters=1';

function suite(input) {
    const {pressWorld, pressAction} = input;
    const {start, buildHq, place, select, nightTo, finishNight} = hqFlow(input);

    async function base(page, {barracks = false} = {}) {
        const state = await start(page, QUERY);
        await buildHq(page, state, HQ);
        await place(page, state, 'powerPlant', PLANT);
        if (barracks) await place(page, state, 'barracks', BARRACKS);
        return state;
    }

    /** Step a few ticks at a time until a sample passes. */
    async function stepUntil(page, condition, limit = 2000, stride = 5) {
        for (let ticks = 0; ticks < limit; ticks += stride) {
            const s = await sample(page);
            if (condition(s)) return s;
            await stepExactly(page, stride);
        }
        throw new Error(`not reached in ${limit} ticks`);
    }

    const plantHp = (s) => s.buildings.find((b) => b.type === 'powerPlant').hp;

    test('a Spitter looks different, telegraphs, fires a visible shell and hits', async ({page}) => {
        await base(page);
        await nightTo(page, 601);

        const fresh = await sample(page);
        expect(fresh.wave).toEqual({schedule: [600], spitterSlots: [0]});
        expect(fresh.mutants[0]).toMatchObject({kind: 'spitter', hp: 30, shots: 5});
        expect(fresh.mutantViews).toHaveLength(1);
        expect(fresh.mutantViews[0]).toMatchObject({kind: 'spitter', visible: true, size: 22, spent: false, inverted: false, aiming: false});
        expect(fresh.mutantViews[0].radius).toBeUndefined();

        await stepExactly(page, 300);
        const aiming = await stepUntil(page, (s) => s.mutants[0].aim !== null);
        expect(aiming.mutantViews[0].aiming).toBe(true);
        expect(aiming.spitterEffectViews.aimLines).toHaveLength(1);
        await stepExactly(page, 30);
        expect((await sample(page)).mutantViews[0].scale).toBeGreaterThan(aiming.mutantViews[0].scale);

        const flying = await stepUntil(page, (s) => s.shells.length === 1, 60, 1);
        expect(flying.spitterEffectViews.aimLines).toEqual([]);
        expect(flying.spitterEffectViews.shells).toHaveLength(1);
        expect(flying.spitterEffectViews.shells[0].visible).toBe(true);
        expect(plantHp(flying)).toBe(300);

        const landed = await stepUntil(page, (s) => s.shells.length === 0, 60, 1);
        expect(plantHp(landed)).toBe(290);
        expect(landed.spitterEffectViews.impacts).toHaveLength(1);
        expect(landed.hpBarViews).toHaveLength(1);
    });

    test('five shots, then it turns over and comes in; dawn clears everything', async ({page}) => {
        await base(page);
        await nightTo(page, 900);
        const spent = await stepUntil(page, (s) => s.mutants[0].shots === 0, 1200, 30);
        const before = spent.mutantViews[0];
        expect(before).toMatchObject({spent: true, inverted: true, aiming: false});
        expect(before.fillColor).not.toBe(0xc6ff00);
        const {y} = spent.mutants[0];
        await stepExactly(page, 120);
        const later = await sample(page);
        expect(later.mutants[0].y).toBeLessThan(y);
        expect(plantHp(later)).toBe(250);

        await finishNight(page);
        const dawn = await sample(page);
        expect(dawn.mutants).toEqual([]);
        expect(dawn.mutantViews).toEqual([]);
        expect(dawn.shells).toEqual([]);
        expect(dawn.spitterEffectViews).toEqual({aimLines: [], shells: [], impacts: [], deaths: []});
    });

    test('moving a flag forward at Night sends the squad out to kill it', async ({page}) => {
        const state = await base(page, {barracks: true});
        const {id} = (await sample(page)).buildings.find((b) => b.type === 'barracks');
        await nightTo(page, 900);
        await stepUntil(page, (s) => s.shells.length === 1);

        await select(page, state, BARRACKS, id);
        await pressAction(page, 'set-flag');
        await expect.poll(async () => (await sample(page)).flagMode).toBe(id);
        await pressWorld(page, cellCenter(state.grid, FORWARD_FLAG), state);
        await expect.poll(async () => (await sample(page)).flagMode).toBeNull();

        const dead = await stepUntil(page, (s) => s.mutants.length === 0, 1200, 20);
        expect(dead.infantry.night.kills).toBe(1);
        expect(dead.spitterEffectViews.deaths).toHaveLength(1);
        expect(plantHp(dead)).toBeGreaterThan(250);
    });
}

test.describe('spitters: desktop', () => {
    suite({pressWorld: clickWorld, pressAction: clickAction});
});

test.describe('spitters: mobile landscape', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});
    suite({pressWorld: tapWorld, pressAction: tapAction});
});

test('waveSpitters means nothing without a budget, and the real planner is unaffected', async ({page}) => {
    const {start, buildHq, nightTo} = hqFlow({pressWorld: clickWorld, pressAction: clickAction});
    const state = await start(page, 'waveSpitters=3');
    await buildHq(page, state, HQ);
    await nightTo(page, 1);
    expect((await sample(page)).wave).toMatchObject({day: 1, budget: 1, spitters: 0, spitterSlots: []});
});
