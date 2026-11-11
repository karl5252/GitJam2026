import {test, expect} from '@playwright/test';
import {body, boot, byAction, clickAction, clickWorld, tapAction, tapWorld} from '../helpers/canvas.js';
import {hqFlow, qaSim} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * TASKS 043-044: the campaign save in the browser's own localStorage, on the map a new
 * game gets, in the real ACTIVE cycle with La Voz on ({news: true}), through the office
 * menu's real CONTINUE, START and New Game question. Dawns are reached with QA steps,
 * which stop on the tick a Day starts, so every save is the game's own autosave.
 */

const mouse = {pressWorld: clickWorld, pressAction: clickAction};
const touch = {pressWorld: tapWorld, pressAction: tapAction};
const OPTIONS = {map: null, cycle: null, news: true, mutants: false};
const OTHER_KEYS = {papi_profile: '{"version":1,"presidentialEndingSeen":false}', papi_advice: '{"version":1,"enabled":false,"seen":["tip-a"]}', papi_audio: '{"version":2,"volumes":{"music":0.3}}'};

const stored = (page, key = 'papi_campaign') => page.evaluate((k) => localStorage.getItem(k), key);
const save = async (page) => JSON.parse(await stored(page));
const status = (page) => page.evaluate(() => window.__qa.campaign.status());
const menu = (page) => page.evaluate(() => window.__qa.campaign.menu());
const opened = async (page) => (await sample(page)).ui.newspaperOpen;
const putSave = (page, raw) => page.evaluate((s) => localStorage.setItem('papi_campaign', s), raw);

/** The simulation's own steps, stopping at the next dawn hold, where La Voz opens and the game saves. */
async function toNextDawn(page) {
    await page.evaluate(() => {
        const start = window.__qa.getState().shiftCycle.day;
        for (let i = 0; i < 400; i++) {
            const s = window.__qa.getState().shiftCycle;
            if ((s.day > start && s.shift === 'day') || s.shift === 'defeated') return;
            window.__qa.sim.stepTicks(240);
        }
    });
}

/** The office menu, as a page load shows it. */
const toMenu = (page, query = '', options = {}) => boot(page, {scene: 'game', waitForQA: true, query, ...OPTIONS, ...options});

/** From the menu, a game: START, and START NEW GAME if the menu asks. */
async function newGame(page, input = mouse) {
    await input.pressAction(page, 'start');
    if ((await menu(page))?.confirmOpen) await input.pressAction(page, 'confirm-new-game');
    await expect(body(page)).toHaveAttribute('data-phase', 'started');
    return sample(page);
}

/** HQ, END DAY, Dusk and Night 1, to the first dawn, from the menu. */
async function firstDawn(page, input = mouse) {
    const s = await newGame(page, input);
    await hqFlow(input).buildHq(page, s, s.terrain.center);
    await input.pressAction(page, 'end-day');
    await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('dusk');
    await qaSim(page, 'pause');
    await toNextDawn(page);
    await expect.poll(() => opened(page)).toBe(true);
    return sample(page);
}

/** CONTINUE, pressed on the menu. */
async function pressContinue(page, input = mouse) {
    await input.pressAction(page, 'continue');
    await expect(body(page)).toHaveAttribute('data-phase', 'started');
    return sample(page);
}

const campaignOf = (s) => ({
    day: s.shiftCycle.day, shift: s.shiftCycle.shift, resources: s.resources, buildings: s.buildings, roads: s.roads, terrain: s.terrain.rows,
    pollution: s.pollution.value,
});

test.describe('campaign save: desktop', () => {
    test.use({viewport: {width: 1280, height: 720}});
    test.setTimeout(120_000);

    test('no save: no CONTINUE, and START starts at once, without a question', async ({page}) => {
        await toMenu(page);
        expect(await menu(page)).toEqual({continueVisible: false, continueLabel: null, confirmOpen: false, notice: null});
        await expect(byAction(page, 'continue')).toBeHidden();
        await clickAction(page, 'start');
        await expect(body(page)).toHaveAttribute('data-phase', 'started');
    });

    test('the first dawn saves; the menu offers CONTINUE with its Day; it restores the campaign behind La Voz, paused, exactly', async ({page}) => {
        await toMenu(page);
        await page.evaluate((keys) => { for (const [k, v] of Object.entries(keys)) localStorage.setItem(k, v); }, OTHER_KEYS);
        const dawn = await firstDawn(page);
        const saved = await save(page);
        expect(saved).toMatchObject({version: 1, campaignId: (await status(page)).id, checkpoint: {day: dawn.shiftCycle.day}});
        const before = campaignOf(dawn);

        await toMenu(page);
        expect(await menu(page)).toEqual({continueVisible: true, continueLabel: `CONTINUE\nDAY ${dawn.shiftCycle.day - 1}`, confirmOpen: false, notice: null});
        const s = await pressContinue(page);
        expect(campaignOf(s)).toEqual(before);
        expect([s.ui.newspaperOpen, s.simulation.paused, s.shiftCycle.elapsedDayTicks]).toEqual([true, true, 0]);
        expect(s.newspaperView.figures).toEqual(dawn.newspaperView.figures);
        expect(await save(page)).toEqual(saved); // the restored dawn is not written again
        await clickAction(page, 'close-newspaper');
        await expect.poll(async () => (await sample(page)).shiftCycle.elapsedDayTicks).toBeGreaterThan(0);
        for (const [key, value] of Object.entries(OTHER_KEYS)) expect(await stored(page, key)).toBe(value);
    });

    test('a continued campaign plays on and saves each dawn; continuing it again and again creates nothing', async ({page}) => {
        await toMenu(page);
        await firstDawn(page);
        await toMenu(page);
        await pressContinue(page);
        const id = (await status(page)).id;
        for (let i = 0; i < 3; i++) {
            await clickAction(page, 'close-newspaper');
            await toNextDawn(page);
            await expect.poll(() => opened(page)).toBe(true);
            expect(await save(page)).toMatchObject({campaignId: id, checkpoint: {day: (await sample(page)).shiftCycle.day}});
        }
        const before = campaignOf(await sample(page));
        for (let i = 0; i < 2; i++) {
            await toMenu(page);
            expect((await menu(page)).continueLabel).toBe(`CONTINUE\nDAY ${before.day - 1}`);
            expect(campaignOf(await pressContinue(page))).toEqual(before);
        }
    });

    test('START over a saved campaign asks first: CANCEL keeps everything; START NEW GAME ends the old campaign at once', async ({page}) => {
        await toMenu(page);
        await firstDawn(page);
        const old = await stored(page);
        const oldId = JSON.parse(old).campaignId;
        await toMenu(page);

        await clickAction(page, 'start');
        expect((await menu(page)).confirmOpen).toBe(true);
        expect((await sample(page)).phase).toBe('ready');
        await clickAction(page, 'cancel-new-game');
        expect(await menu(page)).toMatchObject({confirmOpen: false, continueVisible: true});
        expect((await sample(page)).phase).toBe('ready');
        expect(await stored(page)).toBe(old);

        await clickAction(page, 'start');
        await clickAction(page, 'confirm-new-game');
        await expect(body(page)).toHaveAttribute('data-phase', 'started');
        expect(await stored(page)).toBeNull(); // not kept until the new game's first dawn
        expect(JSON.parse(await stored(page, 'papi_campaign_ended'))).toContain(oldId);
        expect((await sample(page)).shiftCycle).toMatchObject({day: 1, deployment: true}); // a fresh Day 0

        await toMenu(page);
        expect((await menu(page)).continueVisible).toBe(false);
        await putSave(page, old); // an old copy, as a stale tab could hold it
        await toMenu(page);
        expect((await menu(page)).continueVisible).toBe(false);
    });

    test('an older tab cannot bring back the campaign a New Game replaced: it is told it no longer saves', async ({context}) => {
        const older = await context.newPage();
        await toMenu(older);
        await firstDawn(older);
        const oldId = (await status(older)).id;

        const newer = await context.newPage();
        await toMenu(newer);
        await newGame(newer); // asks, and is confirmed
        expect(await stored(newer)).toBeNull();

        await clickAction(older, 'close-newspaper');
        await toNextDawn(older);
        await expect.poll(() => opened(older)).toBe(true);
        expect((await status(older)).last).toMatchObject({ok: false, reason: 'campaign-ended'});
        expect(await stored(older)).toBeNull();
        await clickAction(older, 'close-newspaper');
        expect((await sample(older)).placementHint).toBe('Not saved: another tab has replaced or moved on with this campaign');
        expect(JSON.parse(await stored(older, 'papi_campaign_ended'))).toContain(oldId);
    });

    test('HQ falls: the save goes, and the menu no longer offers CONTINUE', async ({page}) => {
        const query = 'waveBudget=4';
        await toMenu(page, query, {mutants: true});
        await page.evaluate((keys) => { for (const [k, v] of Object.entries(keys)) localStorage.setItem(k, v); }, OTHER_KEYS);
        await firstDawn(page);
        await clickAction(page, 'close-newspaper');
        await page.evaluate(() => {
            for (let i = 0; i < 120 && window.__qa.getState().shiftCycle.shift !== 'defeated'; i++) window.__qa.sim.stepTicks(240);
        });
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('defeated');
        expect(await stored(page)).toBeNull();
        await clickAction(page, 'restart');
        await expect(body(page)).toHaveAttribute('data-phase', 'ready');
        expect((await menu(page)).continueVisible).toBe(false);
        for (const [key, value] of Object.entries(OTHER_KEYS)) expect(await stored(page, key)).toBe(value);
    });

    test('Day 100: CONTINUE says THE VISIT; a browser closed during the ending replays it; finishing it removes CONTINUE and keeps the unlock', async ({page}) => {
        test.setTimeout(180_000);
        const query = 'endingSpeed=40';
        await toMenu(page, query);
        await firstDawn(page);
        await clickAction(page, 'close-newspaper');
        await page.evaluate(() => window.__qa.sim.setDay(100));
        await clickAction(page, 'end-day');
        await toNextDawn(page);
        await expect.poll(() => opened(page)).toBe(true);
        expect((await save(page)).checkpoint.day).toBe(101);

        await toMenu(page, query);
        expect((await menu(page)).continueLabel).toBe('CONTINUE\nTHE VISIT');
        await pressContinue(page);
        await clickAction(page, 'close-newspaper');
        await expect.poll(async () => (await sample(page)).ending?.day ?? null).toBe(101);

        await toMenu(page, query); // the browser closed mid-ending
        expect((await menu(page)).continueLabel).toBe('CONTINUE\nTHE VISIT');
        await pressContinue(page);
        await clickAction(page, 'close-newspaper');
        await expect.poll(async () => (await sample(page)).ending?.day ?? null).toBe(101);
        await expect.poll(async () => (await sample(page)).phase, {timeout: 30_000}).toBe('ready');
        expect(await stored(page)).toBeNull();
        expect((await menu(page)).continueVisible).toBe(false);
        expect((await sample(page)).profile).toEqual({presidentialEndingSeen: true});
    });

    test('unreadable, foreign and impossible saves: no CONTINUE where it cannot work, a clear notice, and the save is never deleted', async ({page}) => {
        await toMenu(page);
        await firstDawn(page);
        const good = await save(page);
        const cases = [
            ['{not json', 'The saved campaign could not be read.'],
            [JSON.stringify({...good, version: 99}), 'The saved campaign is from another version of the game.'],
            [JSON.stringify({...good, checkpoint: {...good.checkpoint, economy: null}}), 'The saved campaign could not be read.'],
        ];
        for (const [raw, notice] of cases) {
            await putSave(page, raw);
            await toMenu(page);
            expect(await menu(page)).toEqual({continueVisible: false, continueLabel: null, confirmOpen: false, notice});
            expect(await stored(page)).toBe(raw);
        }
        await putSave(page, JSON.stringify(good));
        await toMenu(page, 'worldSeed=9');
        expect(await menu(page)).toMatchObject({continueVisible: false, notice: 'The saved campaign belongs to another world.'});

        // Well-formed, but the world refuses it: the attempt is discarded, the menu says so, and the save stays.
        const impossible = structuredClone(good);
        Object.assign(impossible.checkpoint.placement.buildings[0], {col: 1, row: 1});
        await putSave(page, JSON.stringify(impossible));
        await toMenu(page);
        expect((await menu(page)).continueVisible).toBe(true);
        await clickAction(page, 'continue');
        await expect.poll(async () => (await menu(page))?.notice ?? null).toBe('The campaign could not be restored. Your save was kept.');
        expect((await sample(page)).phase).toBe('ready');
        expect((await sample(page)).buildings).toEqual([]);
        expect(JSON.parse(await stored(page))).toEqual(impossible);
    });

    test('a full or blocked localStorage: the game plays on and says, once, that the campaign was not saved', async ({page}) => {
        await page.addInitScript(() => {
            const original = Storage.prototype.setItem;
            Storage.prototype.setItem = function setItem(key, value) {
                if (key === 'papi_campaign') throw new DOMException('quota', 'QuotaExceededError');
                return original.call(this, key, value);
            };
        });
        await toMenu(page);
        const dawn = await firstDawn(page);
        expect((await status(page)).last).toEqual({day: dawn.shiftCycle.day, ok: false, reason: 'storage-failed'});
        expect(await stored(page)).toBeNull();
        await clickAction(page, 'close-newspaper');
        const s = await sample(page);
        expect([s.ui.hintVisible, s.placementHint]).toEqual([true, 'Campaign could not be saved. Progress may be lost when you leave']);
        await expect.poll(async () => (await sample(page)).shiftCycle.elapsedDayTicks).toBeGreaterThan(0);
    });
});

test.describe('campaign save: mobile landscape touch', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});
    test.setTimeout(120_000);

    test('CONTINUE and the New Game question by touch, laid out clear of the menu row and inside the screen', async ({page}) => {
        await toMenu(page);
        const dawn = await firstDawn(page, touch);
        await toMenu(page);
        expect((await menu(page)).continueLabel).toBe(`CONTINUE\nDAY ${dawn.shiftCycle.day - 1}`);

        const viewport = page.viewportSize();
        const boxes = {};
        for (const action of ['continue', 'start', 'toggle-sound', 'open-manual']) {
            if (await byAction(page, action).count() === 0) continue; // SOUND exists only with audio on
            boxes[action] = await byAction(page, action).boundingBox();
        }
        expect(Object.keys(boxes)).toEqual(expect.arrayContaining(['continue', 'start', 'open-manual']));
        const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        for (const [name, box] of Object.entries(boxes)) {
            expect(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, name).toBe(true);
            if (name !== 'continue') expect(overlap(boxes.continue, box), `continue vs ${name}`).toBe(false);
        }
        expect(boxes.continue.height).toBeGreaterThanOrEqual(44); // CSS px: a finger's target

        await tapAction(page, 'start');
        expect((await menu(page)).confirmOpen).toBe(true);
        for (const action of ['cancel-new-game', 'confirm-new-game']) {
            const box = await byAction(page, action).boundingBox();
            expect(box.height, action).toBeGreaterThanOrEqual(44);
            expect(box.x >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, action).toBe(true);
        }
        await tapAction(page, 'cancel-new-game');
        expect(await menu(page)).toMatchObject({confirmOpen: false, continueVisible: true});

        const s = await pressContinue(page, touch);
        expect(s.shiftCycle.day).toBe(dawn.shiftCycle.day);
        expect(s.ui.newspaperOpen).toBe(true);
    });
});
