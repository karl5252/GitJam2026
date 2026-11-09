import {test, expect} from '@playwright/test';
import {byAction, clickAction, clickWorld, tapAction} from '../helpers/canvas.js';
import {cellCenter, hqFlow, qaSim, stepExactly} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * TASK 030 with real audio ({audio: true}) in Chromium: locked until the first
 * gesture, music by state, accepted and refused commands, mute that persists, the
 * newspaper's duck, the SOUND button, and which format the browser fetches.
 */

const mouse = {pressWorld: clickWorld, pressAction: clickAction};
const audioOf = async (page) => (await sample(page)).audio;
const events = async (page) => (await audioOf(page)).recent.map(({event}) => event);

test.describe('audio: desktop', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('unlocks on the first press, plays the menu then the Day, and hears refusals as refusals', async ({page}) => {
        test.setTimeout(60000);
        const requests = [];
        page.on('request', (r) => {
            if (/\/sound\//.test(r.url())) requests.push(decodeURIComponent(r.url()));
        });
        const flow = hqFlow(mouse);
        await page.goto('/?testMode&cycle=legacy&map=open&news=off'); // audio on: no &audio=off
        await page.waitForFunction(() => window.__qa?.getState()?.scene === 'game');
        let audio = await audioOf(page);
        expect(audio.enabled).toBe(true);
        expect(audio.unlocked).toBe(false); // the browser keeps it locked until a gesture
        expect(audio.recent).toEqual([]);

        await page.mouse.click(400, 400); // a first gesture on the menu
        await expect.poll(async () => (await audioOf(page)).unlocked).toBe(true);
        await expect.poll(async () => (await audioOf(page)).music.tracks.menu?.playing ?? false, {timeout: 15000}).toBe(true);
        expect(requests.filter((u) => u.endsWith('.m4a'))).toEqual([]); // Chromium plays OGG: AAC is never fetched
        expect(requests.some((u) => u.endsWith('Spanish - Como Versace Loop.ogg'))).toBe(true);

        await clickAction(page, 'start');
        await expect.poll(async () => (await audioOf(page)).music.state).toBe('day');
        await expect.poll(async () => (await audioOf(page)).music.tracks.day?.playing ?? false, {timeout: 15000}).toBe(true);

        // A build before HQ is refused: deny, not accept.
        await clickAction(page, 'build-factory');
        await expect.poll(() => events(page)).toContain('ui.deny');
        expect(await events(page)).not.toContain('ui.accept');
        const s = await sample(page);
        await flow.buildHq(page, s, {col: 11, row: 7});
        await expect.poll(() => events(page)).toContain('ui.accept');

        // M mutes, and the setting survives a reload.
        await page.keyboard.press('m');
        await expect.poll(async () => (await audioOf(page)).muted).toBe(true);
        await page.reload();
        await page.waitForFunction(() => window.__qa?.getState()?.scene === 'game');
        expect((await audioOf(page)).muted).toBe(true);
        await expect(byAction(page, 'toggle-sound')).toHaveAttribute('aria-label', 'SOUND OFF');
        await clickAction(page, 'toggle-sound');
        await expect.poll(async () => (await audioOf(page)).muted).toBe(false);
        await expect(byAction(page, 'toggle-sound')).toHaveAttribute('aria-label', 'SOUND ON');
    });

    test('the newspaper ducks the Day\'s music and plays its paper sounds', async ({page}) => {
        test.setTimeout(60000);
        const flow = hqFlow(mouse);
        const s = await flow.start(page, '', {map: null, cycle: null, mutants: false, news: true, audio: true});
        await flow.buildHq(page, s, s.terrain.center);
        await clickAction(page, 'end-day');
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('dusk');
        await expect.poll(async () => (await audioOf(page)).music.state).toBe('dusk');
        await qaSim(page, 'pause');
        await stepExactly(page, 4000);
        await expect.poll(async () => (await sample(page)).ui.newspaperOpen).toBe(true);
        await expect.poll(async () => (await audioOf(page)).music.duck).toBeLessThan(0.5);
        expect(await events(page)).toContain('ui.open');
        await expect(byAction(page, 'toggle-sound')).toHaveCount(1); // SOUND beside CONTINUE
        await clickAction(page, 'close-newspaper');
        await expect.poll(async () => (await audioOf(page)).music.duck).toBe(1);
        expect(await events(page)).toContain('ui.close');
        expect((await audioOf(page)).music.state).toBe('day');
    });
});

/** In a normal session there is no QA: count the long sources the browser starts (232 s Como Versace, 285 s Océano). */
const START_LOG = () => {
    window.__starts = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
        window.__starts.push({duration: Math.round(this.buffer?.duration ?? -1), now: (args[0] ?? 0) <= this.context.currentTime + 0.05});
        return start.apply(this, args);
    };
};
const started = (page, seconds) => page.evaluate((d) => window.__starts.filter((s) => s.duration === d && s.now).length, seconds);

test.describe('audio: a normal session, no TEST_MODE', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('no page error; the first press starts the menu music, START the Day music, once each', async ({page}) => {
        test.setTimeout(60000);
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.addInitScript(START_LOG);
        await page.goto('/');
        await page.waitForTimeout(1500);
        expect(await page.evaluate(() => window.__starts.length)).toBe(0); // locked until a gesture
        await page.mouse.click(300, 400); // the first press, on the office
        await expect.poll(() => started(page, 232), {timeout: 15000}).toBe(1);
        await page.mouse.click(640, 668); // START
        await expect.poll(() => started(page, 285), {timeout: 15000}).toBe(1);
        await page.waitForTimeout(2000);
        expect(await started(page, 285)).toBe(1); // never restarted
        expect(await started(page, 232)).toBe(1);
        expect(errors).toEqual([]);
    });
});

test.describe('audio: a whole cycle with a moving truck', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('Day music, Dusk fading, Night silence, La Voz ducks it; engines stop behind the paper and come back once', async ({page}) => {
        test.setTimeout(120000);
        const flow = hqFlow(mouse);
        const s = await flow.start(page, '', {cycle: null, mutants: false, news: true, audio: true});
        await page.mouse.click(640, 360); // a gesture on the world is enough to unlock
        // HQ, a Plant, and a Factory west of HQ whose dock road joins the ring: one truck.
        await flow.buildHq(page, s, {col: 11, row: 7});
        await flow.place(page, s, 'powerPlant', {col: 16, row: 7});
        await clickAction(page, 'build-road');
        for (const cell of [{col: 8, row: 7}, {col: 7, row: 7}]) {
            const count = (await sample(page)).roads.tiles.length;
            await clickWorld(page, cellCenter(s.grid, cell), s);
            await expect.poll(async () => (await sample(page)).roads.tiles.length).toBe(count + 1);
        }
        await clickAction(page, 'cancel-placement');
        await flow.place(page, s, 'factory', {col: 5, row: 7});
        await expect.poll(async () => (await audioOf(page)).music.tracks.day?.playing ?? false, {timeout: 15000}).toBe(true);

        // Dusk: the music fades. (The Factory's first load needs 600 ticks, so its truck waits for the Day.)
        await clickAction(page, 'end-day');
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('dusk');
        await expect.poll(async () => (await audioOf(page)).music.state).toBe('dusk');

        // Night: silence. Stepped to dawn with the clock paused: the paused world is silent.
        await qaSim(page, 'pause');
        await expect.poll(async () => (await audioOf(page)).playingEngines).toBe(0);
        await stepExactly(page, 500);
        await expect.poll(async () => (await audioOf(page)).music.tracks.day?.playing ?? false).toBe(false);
        expect((await audioOf(page)).music.state).toBe('night');
        await stepExactly(page, 4000);
        await expect.poll(async () => (await sample(page)).ui.newspaperOpen).toBe(true);

        // La Voz: the Day's music, ducked; no engine behind it, however long it stays open.
        await expect.poll(async () => (await audioOf(page)).music.tracks.day?.playing ?? false, {timeout: 10000}).toBe(true);
        await expect.poll(async () => (await audioOf(page)).music.duck).toBeLessThan(0.5);
        await page.waitForTimeout(800);
        let audio = await audioOf(page);
        expect([audio.worldActive, audio.playingEngines, audio.playingMusic]).toEqual([false, 0, 1]);

        // Open and close it again and again: one engine at most, one music track, never more.
        for (let round = 0; round < 3; round++) {
            await clickAction(page, 'close-newspaper');
            await expect.poll(async () => (await audioOf(page)).worldActive).toBe(true);
            await expect.poll(async () => (await audioOf(page)).playingEngines, {timeout: 10000}).toBe(1);
            await clickAction(page, 'show-report');
            await expect.poll(async () => (await audioOf(page)).playingEngines).toBe(0);
            audio = await audioOf(page);
            expect(audio.playingMusic).toBe(1);
        }
        await clickAction(page, 'close-newspaper');
        await expect.poll(async () => (await audioOf(page)).playingEngines, {timeout: 10000}).toBe(1);

        // Paused by the player, La Voz reopened and closed: still silent until PLAY.
        await clickAction(page, 'day-pause');
        await expect.poll(async () => (await audioOf(page)).playingEngines).toBe(0);
        await clickAction(page, 'show-report');
        await clickAction(page, 'close-newspaper');
        await page.waitForTimeout(500);
        expect((await audioOf(page)).playingEngines).toBe(0);
        await clickAction(page, 'day-pause');
        await expect.poll(async () => (await audioOf(page)).playingEngines, {timeout: 10000}).toBe(1);
        expect((await audioOf(page)).playingMusic).toBe(1);
    });
});

test.describe('audio: touch 740x360', () => {
    test.use({viewport: {width: 740, height: 360}, hasTouch: true, isMobile: true});

    test('the menu\'s SOUND button is big enough to tap, and tapping it mutes', async ({page}) => {
        await page.goto('/?testMode&cycle=legacy&map=open&news=off');
        await page.waitForFunction(() => window.__qa?.getState()?.scene === 'game');
        const box = await byAction(page, 'toggle-sound').boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        const before = (await audioOf(page)).muted;
        await tapAction(page, 'toggle-sound');
        await expect.poll(async () => (await audioOf(page)).muted).toBe(!before);
    });
});

test.afterEach(async ({page}) => {
    await page.evaluate(() => localStorage.removeItem('papi_audio')).catch(() => {});
});
