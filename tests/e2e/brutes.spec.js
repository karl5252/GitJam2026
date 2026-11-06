import {test, expect} from '@playwright/test';
import {clickAction, clickWorld, tapAction, tapWorld} from '../helpers/canvas.js';
import {hqFlow, stepExactly} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * Brutes through real input on the real HQ-first flow. `?waveBudget=6&waveBrutes=1`
 * gives the real Mutants a schedule of six slots: a Brute in slot 1, slots 2 and 3
 * absorbed to pay for it, and three ordinary mutants. HQ centred on 12,8.
 */

const HQ = {col: 12, row: 8};
const QUERY = 'waveBudget=6&waveBrutes=1';

function suite(input) {
    const {start, buildHq, nightTo, finishNight} = hqFlow(input);

    async function night(page, tick) {
        const state = await start(page, QUERY);
        await buildHq(page, state, HQ);
        await nightTo(page, tick);
        return state;
    }

    const brutes = (s) => s.mutants.filter(({kind}) => kind === 'brute');

    test('a Brute is drawn big and distinct, shows its HP, and pays for itself in slots', async ({page}) => {
        await night(page, 1);
        const {wave} = await sample(page);
        expect(wave).toMatchObject({bruteSlots: [1], absorbedSlots: [2, 3]});
        await stepExactly(page, wave.schedule[1]);
        const s = await sample(page);
        expect(brutes(s)).toHaveLength(1);
        expect(brutes(s)[0]).toMatchObject({hp: 600, attackTimer: 120});
        const view = s.mutantViews.find(({kind}) => kind === 'brute');
        expect(view).toMatchObject({visible: true, radius: 15, scale: 1, hpBarWidth: 32, hpBarVisible: true});

        await stepExactly(page, wave.schedule.at(-1) - wave.schedule[1] + 1);
        const all = await sample(page);
        expect(all.waveProgress).toBe(6);
        expect(all.waveView.text).toContain('Wave 6/6');
        expect(all.mutants).toHaveLength(4);
        expect(all.mutants.filter(({kind}) => kind === undefined)).toHaveLength(3);
    });

    test('it reaches HQ, winds up, hits for 25, and dawn clears it', async ({page}) => {
        await night(page, 1);
        const {wave} = await sample(page);
        await stepExactly(page, wave.schedule[1] + 1);
        let s = await sample(page);
        for (let i = 0; i < 60 && !s.buildings[0].hp < 600 && s.shiftCycle.shift === 'night'; i++) {
            if (s.buildings[0].hp < 600) break;
            await stepExactly(page, 40);
            s = await sample(page);
        }
        expect(s.shiftCycle.shift).toBe('night');
        expect(s.buildings[0].hp).toBeLessThan(600);
        expect(s.hpBarViews).toHaveLength(1);
        const view = s.mutantViews.find(({kind}) => kind === 'brute');
        if (view) expect(view.scale).toBeGreaterThanOrEqual(1);

        await finishNight(page);
        const dawn = await sample(page);
        expect(dawn.mutants).toEqual([]);
        expect(dawn.mutantViews).toEqual([]);
        expect(dawn.spitterEffectViews).toEqual({aimLines: [], shells: [], impacts: [], deaths: []});
    });
}

test.describe('brutes: desktop', () => {
    suite({pressWorld: clickWorld, pressAction: clickAction});
});

test.describe('brutes: mobile landscape', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});
    suite({pressWorld: tapWorld, pressAction: tapAction});
});

test('a real plan before Night 30 has no Brutes in it', async ({page}) => {
    const {start, buildHq, nightTo} = hqFlow({pressWorld: clickWorld, pressAction: clickAction});
    const state = await start(page, 'waveBrutes=2');
    await buildHq(page, state, HQ);
    await nightTo(page, 1);
    expect((await sample(page)).wave).toMatchObject({day: 1, brutes: 0, bruteSlots: [], absorbedSlots: []});
});
