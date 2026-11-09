import {test, expect} from '@playwright/test';
import {byAction, clickAction, clickWorld, tapAction, tapWorld} from '../helpers/canvas.js';
import {cellCenter, hqFlow, qaSim} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';
import {ADVICE} from '../../src/content/advice.js';

/**
 * TASK 033.3: Presidential Advice on a real new game (jungle map, ACTIVE cycle). Tips are
 * switched on explicitly here (boot's {tips: true}); every other suite runs with ?tips=off.
 * ?tipsCooldown shortens the gap between tips, because a test cannot wait 25 s for each.
 * SHOTS=<dir> saves pictures.
 */

const mouse = {pressWorld: clickWorld, pressAction: clickAction};
const touch = {pressWorld: tapWorld, pressAction: tapAction};
const shots = process.env.SHOTS ?? null;
const shoot = async (page, name) => {
    if (shots) await page.screenshot({path: `${shots}/${name}.png`});
};
const NEW_GAME = {map: null, cycle: null, mutants: false, tips: true};
const FAST = 'tipsCooldown=600';
const advice = async (page) => (await sample(page)).advice;
const tipId = async (page) => {
    const a = await advice(page);
    return a.visible ? a.tip.id : null;
};
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('papi_advice') ?? 'null'));

/** A new game with tips on, and the cell at the clearing's centre (where El Presidente stands). */
async function newGame(page, input = mouse, query = FAST, options = {}) {
    const state = await hqFlow(input).start(page, query, {...NEW_GAME, ...options});
    await expect.poll(async () => (await sample(page)).president?.anchor ?? null).not.toBe(null);
    const {anchor} = (await sample(page)).president;
    const centre = {col: Math.floor((anchor.x - state.grid.originX) / state.grid.tileSize), row: Math.floor((anchor.y - state.grid.originY) / state.grid.tileSize)};
    return {state, centre};
}

test.describe('Presidential Advice: desktop', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('first run: the HQ tip comes at once, fits its card, OK dismisses it without touching the world; then the defence tip, gone once a cannon stands', async ({page}) => {
        test.setTimeout(45000);
        const {state, centre} = await newGame(page);
        await expect.poll(() => tipId(page), {timeout: 4000}).toBe('build-hq');
        const view = (await sample(page)).adviceView;
        expect(view).toMatchObject({visible: true, tip: 'build-hq', title: 'A NATION NEEDS A HEADQUARTERS!', overflow: []});
        await shoot(page, 'advice-desktop-build-hq');
        const before = await sample(page);
        await clickAction(page, 'advice-dismiss');
        await expect.poll(() => tipId(page)).toBe(null);
        let s = await sample(page);
        expect(s.advice.seen).toContain('build-hq');
        expect((await saved(page)).seen).toContain('build-hq');
        expect([s.buildings, s.selectedCell, s.placement.selectedType]).toEqual([before.buildings, before.selectedCell, before.placement.selectedType]);
        await expect(byAction(page, 'advice-dismiss')).toHaveCount(0);

        await page.waitForTimeout(1500);
        expect(await tipId(page), 'nothing else applies before HQ').toBe(null);
        await hqFlow(mouse).buildHq(page, state, centre);
        await expect.poll(() => tipId(page), {timeout: 5000}).toBe('night-defence');
        await hqFlow(mouse).place(page, state, 'autocannon', {col: centre.col + 4, row: centre.row});
        await expect.poll(() => tipId(page), {message: 'stale once a cannon stands'}).toBe(null);
        s = await sample(page);
        expect(s.advice.seen).toEqual(expect.arrayContaining(['build-hq', 'night-defence']));
        expect(s.advice.seen).not.toContain('workers'); // never in Day 0
    });

    test('every tip fits the desktop card', async ({page}) => {
        await newGame(page);
        for (const {id} of ADVICE) {
            await page.evaluate((tip) => window.__qa.advice.preview(tip), id);
            await expect.poll(async () => (await sample(page)).adviceView?.tip).toBe(id);
            expect((await sample(page)).adviceView.overflow, id).toEqual([]);
        }
        await page.evaluate(() => window.__qa.advice.preview(null));
        expect((await advice(page)).seen, 'previews read nothing').toEqual([]);
    });

    test('BOOK opens the Little Yellow Book at the tip\'s page and counts it as read', async ({page}) => {
        await newGame(page);
        await expect.poll(() => tipId(page), {timeout: 4000}).toBe('build-hq');
        await clickAction(page, 'advice-more');
        await expect.poll(async () => (await sample(page)).ui.manualOpen).toBe(true);
        const s = await sample(page);
        expect(s.fieldManualView.heading).toBe('Headquarters first');
        expect(s.suspension.reasons).toEqual(['manual']);
        expect(s.advice.visible).toBe(false);
        expect(s.advice.seen).toContain('build-hq');
        await clickAction(page, 'close-manual');
        await page.waitForTimeout(2500);
        expect(await tipId(page), 'read: it does not come back').toBe(null);
    });

    test('BUILD and AUDIO hold a tip back without losing it; it returns when they close', async ({page}) => {
        test.setTimeout(30000);
        await newGame(page, mouse, FAST, {audio: true});
        await expect.poll(() => tipId(page), {timeout: 4000}).toBe('build-hq');
        await clickAction(page, 'open-build');
        let a = await advice(page);
        expect([a.visible, a.suppressed, a.pending]).toEqual([false, true, 'build-hq']);
        expect((await sample(page)).ui.adviceVisible).toBe(false);
        await page.waitForTimeout(1000);
        expect(await tipId(page)).toBe(null);
        await clickAction(page, 'open-build');
        await expect.poll(() => tipId(page)).toBe('build-hq');
        await clickAction(page, 'audio-settings');
        a = await advice(page);
        expect([a.visible, a.pending]).toEqual([false, 'build-hq']);
        await clickAction(page, 'close-audio');
        await expect.poll(() => tipId(page)).toBe('build-hq');
        expect((await sample(page)).suspension.reasons).toEqual([]);
    });

    test('La Voz holds advice back at dawn; the first active Day\'s worker tip comes after CONTINUE', async ({page}) => {
        test.setTimeout(45000);
        const {state, centre} = await newGame(page, mouse, FAST, {news: true});
        await expect.poll(() => tipId(page), {timeout: 4000}).toBe('build-hq');
        await clickAction(page, 'advice-dismiss');
        await hqFlow(mouse).buildHq(page, state, centre);
        await hqFlow(mouse).place(page, state, 'autocannon', {col: centre.col + 4, row: centre.row});
        await clickAction(page, 'end-day');
        await qaSim(page, 'pause');
        await page.evaluate(() => {
            for (let i = 0; i < 60 && !window.__qa.getState().newspaper.open; i++) window.__qa.sim.stepTicks(240);
        });
        expect((await sample(page)).newspaper.open).toBe(true);
        await page.waitForTimeout(1500);
        const a = await advice(page);
        expect([a.visible, a.suppressed]).toEqual([false, true]);
        await clickAction(page, 'close-newspaper');
        await expect.poll(() => tipId(page), {timeout: 5000}).toBe('workers');
        await shoot(page, 'advice-desktop-workers');
    });

    test('TIPS OFF in the book hides advice and is saved; ON brings it back; RESET TIPS shows seen tips again', async ({page}) => {
        test.setTimeout(45000);
        await newGame(page);
        await expect.poll(() => tipId(page), {timeout: 4000}).toBe('build-hq');
        await clickAction(page, 'open-manual');
        await expect(byAction(page, 'manual-tips')).toHaveAttribute('data-enabled', 'true');
        await clickAction(page, 'manual-tips');
        await expect(byAction(page, 'manual-tips')).toHaveAttribute('data-enabled', 'false');
        expect(await saved(page)).toMatchObject({version: 1, enabled: false});
        await clickAction(page, 'close-manual');
        await page.waitForTimeout(2500);
        expect(await tipId(page)).toBe(null);
        expect((await advice(page)).seen, 'switching off read nothing').toEqual([]);

        await clickAction(page, 'open-manual');
        await clickAction(page, 'manual-tips');
        await expect(byAction(page, 'manual-tips')).toHaveAttribute('data-enabled', 'true');
        await clickAction(page, 'close-manual');
        await expect.poll(() => tipId(page), {timeout: 5000}).toBe('build-hq');
        await clickAction(page, 'advice-dismiss');
        expect((await advice(page)).seen).toEqual(['build-hq']);

        await clickAction(page, 'open-manual');
        await clickAction(page, 'manual-tips-reset');
        await expect.poll(async () => (await advice(page)).seen).toEqual([]);
        expect((await saved(page)).seen).toEqual([]);
        await clickAction(page, 'close-manual');
        await expect.poll(() => tipId(page), {timeout: 5000}).toBe('build-hq');
    });

    test('a seen tip stays seen after the game is loaded again', async ({page}) => {
        await newGame(page);
        await expect.poll(() => tipId(page), {timeout: 4000}).toBe('build-hq');
        await clickAction(page, 'advice-dismiss');
        await newGame(page); // a fresh load: same browser, same storage
        await page.waitForTimeout(3000);
        expect(await tipId(page)).toBe(null);
        expect((await advice(page)).seen).toEqual(['build-hq']);
    });

    test('?tips=off (the test default): no tip shows and nothing saved changes', async ({page}) => {
        await hqFlow(mouse).start(page, '', {map: null, cycle: null, mutants: false});
        await page.waitForTimeout(2500);
        const a = await advice(page);
        expect([a.enabled, a.forcedOff, a.visible]).toEqual([false, true, false]);
        expect(await saved(page)).toBe(null);
    });

    test('advice changes nothing in the game: the same Night, tick for tick, with tips on and off', async ({page}) => {
        test.setTimeout(60000);
        const TICK = 1500; // Dusk, then well into Night 1
        const night = async (tips) => {
            const {state, centre} = await newGame(page, mouse, FAST, {mutants: true, tips, audio: tips}); // tips, sound and narration on, or all off
            await hqFlow(mouse).buildHq(page, state, centre);
            await hqFlow(mouse).place(page, state, 'autocannon', {col: centre.col + 4, row: centre.row});
            await clickAction(page, 'end-day');
            await qaSim(page, 'pause');
            await page.evaluate((to) => {
                for (let i = 0; i < 40; i++) {
                    const left = to - window.__qa.getState().simulation.tick;
                    if (left <= 0) break;
                    window.__qa.sim.stepTicks(Math.min(240, left));
                }
            }, TICK);
            const s = await sample(page);
            expect(s.simulation.tick).toBe(TICK);
            return {mutants: s.mutants, buildings: s.buildings, resources: s.resources, rng: s.simulation.rng, shift: s.shiftCycle, pollution: s.pollution};
        };
        const on = await night(true);
        const off = await night(false);
        expect(on.shift.shift).toBe('night');
        expect(on).toEqual(off);
    });
});

/**
 * TASK 033.4: El Presidente's voice, with the real recordings. Each tip, once displayed,
 * speaks its own line once, on VOICES at MASTER x VOICES, and its line stops when it goes.
 */
const spoken = (s, event) => s.audio.recent.filter((r) => r.event === event).length;
const near = (a, b) => Math.abs(a - b) < 1e-6;
const tipIdOf = (s) => (s.advice.visible ? s.advice.tip.id : null);

/** A new game with sound on; the HQ tip shows and El Presidente reads it. */
async function speaking(page, input, options = {}) {
    const game = await newGame(page, input, FAST, {audio: true, ...options});
    await expect.poll(() => tipId(page), {timeout: 4000}).toBe('build-hq');
    await expect.poll(async () => (await sample(page)).audio.presidentLine).toBe('advice.papi_hq');
    return game;
}

async function narrationCheck(page, input) {
    await speaking(page, input);
    let s = await sample(page);
    expect(s.audio.unlocked).toBe(true);
    expect(s.audio.narration).toEqual({narrated: ['build-hq'], speakingFor: 'build-hq'});
    expect(near(s.audio.presidentVolume, s.audio.volumes.master * s.audio.volumes.voices), `${s.audio.presidentVolume}`).toBe(true);
    expect(spoken(s, 'advice.papi_hq')).toBe(1);
    await input.pressAction(page, 'advice-dismiss');
    await expect.poll(async () => (await sample(page)).audio.presidentSpeaking, {message: 'OK silences him'}).toBe(false);
    s = await sample(page);
    expect([tipIdOf(s), s.advice.seen, spoken(s, 'advice.papi_hq')]).toEqual([null, ['build-hq'], 1]);
}

test.describe('Presidential Advice: the voice, desktop', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('a displayed tip speaks its own line once, at MASTER x VOICES, and OK silences it', async ({page}) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await narrationCheck(page, mouse);
        expect(errors).toEqual([]);
    });

    test('MASTER and VOICES from the saved settings set his level; M mutes and unmutes him; muted, a new tip says nothing and still works', async ({page}) => {
        await page.addInitScript(() => {
            if (!sessionStorage.getItem('seeded')) {
                localStorage.setItem('papi_audio', JSON.stringify({version: 2, volumes: {master: 0.5, voices: 0.6}, muted: false}));
                sessionStorage.setItem('seeded', '1');
            }
        });
        await speaking(page, mouse);
        expect(near((await sample(page)).audio.presidentVolume, 0.5 * 0.6)).toBe(true);
        await page.keyboard.press('m');
        await expect.poll(async () => (await sample(page)).audio.presidentVolume).toBe(0);
        await page.keyboard.press('m');
        await expect.poll(async () => near((await sample(page)).audio.presidentVolume ?? -1, 0.3)).toBe(true);

        await page.evaluate(() => {
            localStorage.setItem('papi_audio', JSON.stringify({version: 2, volumes: {}, muted: true}));
            localStorage.removeItem('papi_advice');
        });
        await newGame(page, mouse, FAST, {audio: true});
        await expect.poll(() => tipId(page), {timeout: 4000}).toBe('build-hq');
        await page.waitForTimeout(500);
        const s = await sample(page);
        expect([s.audio.muted, s.audio.presidentSpeaking, spoken(s, 'advice.papi_hq')]).toEqual([true, false, 0]);
        expect(s.audio.narration.narrated, 'its one chance passed silently').toEqual(['build-hq']);
    });

    test('one-shot: BUILD over a speaking tip silences it, and the line is not replayed when the tip returns', async ({page}) => {
        await speaking(page, mouse);
        await clickAction(page, 'open-build');
        await expect.poll(async () => (await sample(page)).audio.presidentSpeaking).toBe(false);
        await clickAction(page, 'open-build');
        await expect.poll(() => tipId(page)).toBe('build-hq');
        await page.waitForTimeout(800);
        const s = await sample(page);
        expect([s.audio.presidentSpeaking, spoken(s, 'advice.papi_hq')]).toEqual([false, 1]);
    });

    test('units never talk over him: none starts while he speaks, and none is talking when his next line starts', async ({page}) => {
        test.setTimeout(45000);
        const {state, centre} = await speaking(page, mouse);
        await hqFlow(mouse).buildHq(page, state, centre); // the HQ tip is done: its line stops
        const hq = (await sample(page)).buildings.find((b) => b.type === 'hq');
        const hqCell = {col: hq.col + 1, row: hq.row + 1};
        const away = {col: centre.col + 4, row: centre.row + 3};
        const selectHq = async () => {
            await clickWorld(page, cellCenter(state.grid, away), state);
            await clickWorld(page, cellCenter(state.grid, hqCell), state);
        };
        await selectHq(); // a worker may answer: El Presidente's next line cuts him off
        await expect.poll(async () => (await sample(page)).audio.presidentLine, {timeout: 5000}).toBe('advice.papi_defense');
        let s = await sample(page);
        expect(s.audio.voiceBusy, 'no unit talks while he speaks').toBe(false);
        const workers = spoken(s, 'worker.select') + spoken(s, 'worker.rare');
        await selectHq();
        await selectHq();
        s = await sample(page);
        expect(s.audio.presidentLine).toBe('advice.papi_defense');
        expect(spoken(s, 'worker.select') + spoken(s, 'worker.rare'), 'selecting HQ while he speaks says nothing').toBe(workers);
        expect(s.audio.voiceBusy).toBe(false);
    });

    test('a reload starts narration afresh, and a seen tip is neither shown nor spoken', async ({page}) => {
        await narrationCheck(page, mouse);
        await newGame(page, mouse, FAST, {audio: true});
        await page.waitForTimeout(2500);
        const s = await sample(page);
        expect(s.audio.narration).toEqual({narrated: [], speakingFor: null});
        expect([tipIdOf(s), s.audio.presidentSpeaking]).toEqual([null, false]);
    });
});

test.describe('Presidential Advice: touch 844x390', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});

    test('the ribbon: every tip fits at 24 px, OK and BOOK are big enough, and taps on it never reach the world', async ({page}) => {
        test.setTimeout(45000);
        await newGame(page, touch);
        await expect.poll(() => tipId(page), {timeout: 4000}).toBe('build-hq');
        expect((await sample(page)).ui.layout).toBe('touch');
        await shoot(page, 'advice-touch-build-hq');
        for (const action of ['advice-more', 'advice-dismiss']) {
            const box = await byAction(page, action).boundingBox();
            expect(box.width, action).toBeGreaterThanOrEqual(44);
            expect(box.height, action).toBeGreaterThanOrEqual(44);
        }
        for (const {id} of ADVICE) {
            await page.evaluate((tip) => window.__qa.advice.preview(tip), id);
            await expect.poll(async () => (await sample(page)).adviceView?.tip).toBe(id);
            const view = (await sample(page)).adviceView;
            expect(view.overflow, id).toEqual([]);
            expect(view.minFontPx).toBeGreaterThanOrEqual(24);
        }
        await page.evaluate(() => window.__qa.advice.preview(null));
        await expect.poll(() => tipId(page)).toBe('build-hq');

        // HQ chosen: its ghost waits on a tile. Taps on the ribbon move nothing and build nothing.
        await tapAction(page, 'build-hq');
        await expect.poll(async () => (await sample(page)).ghost?.active).toBe(true);
        await expect.poll(() => tipId(page)).toBe('build-hq'); // back after the drawer
        const ghost = (await sample(page)).ghost;
        const card = await byAction(page, 'advice-card').boundingBox();
        await page.touchscreen.tap(card.x + card.width * 0.3, card.y + card.height / 2);
        await tapAction(page, 'advice-dismiss');
        await expect.poll(() => tipId(page)).toBe(null);
        const s = await sample(page);
        expect([s.ghost.cell, s.ghost.revision]).toEqual([ghost.cell, ghost.revision]);
        expect(s.buildings).toEqual([]);
        await shoot(page, 'advice-touch-after');
    });

    test('the voice on a phone: the tip speaks its line once, and OK silences it', async ({page}) => {
        await narrationCheck(page, touch);
    });
});

