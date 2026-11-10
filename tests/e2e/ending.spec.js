import {test, expect} from '@playwright/test';
import {body, boot, clickAction, clickWorld, tapAction, tapWorld} from '../helpers/canvas.js';
import {hqFlow} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * TASK 036: THE PRESIDENTIAL VISIT. The Day 100 ending on a real new game: the run is taken
 * to HUD Day 100 through the real calendar rule (__qa.ending.trigger, never 100 Nights), the
 * ceremony plays in its own scene, El Presidente is eaten, and the menu and La Voz change
 * for good. __qa.ending.seek jumps the ceremony's timeline to a cue, so nothing waits a
 * minute of speech. SHOTS=<dir> saves pictures.
 */

const mouse = {pressWorld: clickWorld, pressAction: clickAction};
const touch = {pressWorld: tapWorld, pressAction: tapAction};
const shots = process.env.SHOTS ?? null;
const shoot = async (page, name) => {
    if (shots) await page.screenshot({path: `${shots}/${name}.png`});
};
const cellOf = (grid, {x, y}) => ({col: Math.floor((x - grid.originX) / grid.tileSize), row: Math.floor((y - grid.originY) / grid.tileSize)});
const NEW_GAME = {map: null, cycle: null, mutants: false};
const ending = async (page) => (await sample(page)).ending;
const seek = (page, ms) => page.evaluate((m) => window.__qa.ending.seek(m), ms);
const SPEECH_START = 6600; // ENDING_TIMING.speechStartMs (TASK 036.1: the helicopter lands first)
const at = (speechS) => SPEECH_START + speechS * 1000;
const ORIGINAL = {portrait: 'papi-office-portrait', bustFrame: 0, globeFrame: 0, colonel: true};
const AFTER = {portrait: 'papi-office-mutantPortrait', bustFrame: 1, globeFrame: 1, colonel: false};

/** A new game to its first timed Day (HUD Day 1): HQ where El Presidente stands, Night 1 stepped through. */
async function firstDay(page, input, query = '', options = {}) {
    const state = await hqFlow(input).start(page, query, {...NEW_GAME, ...options});
    await expect.poll(async () => (await sample(page)).president?.visible).toBe(true);
    await hqFlow(input).buildHq(page, state, cellOf(state.grid, (await sample(page)).president));
    await input.pressAction(page, 'end-day');
    const s = await page.evaluate(() => {
        window.__qa.sim.pause();
        const qa = () => window.__qa.getState();
        for (let i = 0; i < 40 && !(qa().shiftCycle.shift === 'day' && qa().shiftCycle.day === 2); i++) window.__qa.sim.stepTicks(240);
        return qa();
    });
    expect(s.shiftCycle).toMatchObject({shift: 'day', day: 2});
    return state;
}

/** HUD Day 100 through the real rule; the next frame starts the ending. */
async function day100(page) {
    const before = await sample(page);
    expect(before.ending, 'never before Day 100').toBe(null);
    const day = await page.evaluate(() => window.__qa.ending.trigger());
    expect(day, 'calendar day 101 is the HUD\'s Day 100').toBe(101);
    await expect.poll(async () => (await ending(page))?.phase).toBeTruthy();
    return before;
}

test.describe('THE PRESIDENTIAL VISIT: desktop', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('menu as it was; Day 100: the grounds, the helicopter, the President and two guards out of HQ, the crowd, the speech, the Brute, the menu changed for good', async ({page}) => {
        test.setTimeout(90000);
        await boot(page, {scene: 'game', waitForQA: true, ...NEW_GAME});
        let s = await sample(page);
        expect(s.officeMenuView, 'the office as it always was').toMatchObject(ORIGINAL);
        expect(s.profile.presidentialEndingSeen).toBe(false);
        await shoot(page, 'ending-0-menu-before');

        await clickAction(page, 'start');
        await expect(body(page)).toHaveAttribute('data-phase', 'started');
        const state = await sample(page);
        await expect.poll(async () => (await sample(page)).president?.visible).toBe(true);
        await hqFlow(mouse).buildHq(page, state, cellOf(state.grid, (await sample(page)).president));
        await clickAction(page, 'end-day');
        await page.evaluate(() => {
            window.__qa.sim.pause();
            const qa = () => window.__qa.getState();
            for (let i = 0; i < 40 && !(qa().shiftCycle.shift === 'day' && qa().shiftCycle.day === 2); i++) window.__qa.sim.stepTicks(240);
        });
        await day100(page);
        const before = await sample(page); // the ending holds the world from its first frame
        expect(before.ending.tick).toBe(before.simulation.tick);

        // The grounds and the helicopter.
        let e = await seek(page, 2600);
        expect(e.phase).toBe('arrival');
        expect(e.hq).toMatchObject({drawn: true, texture: 'papi-art-hq'});
        expect(e.felled, 'the jungle in view is felled').toBeGreaterThan(400);
        // TASK 036.1: it comes in spinning, lands low on the roof and stops its engine (frame 0).
        e = await seek(page, 1200);
        expect(e.heli).toMatchObject({visible: true, leg: 'approach', anim: 'flying'});
        expect([2, 3, 4, 5, 6, 7]).toContain(e.heli.drawn.frame);
        e = await seek(page, 2600);
        expect(e.heli).toMatchObject({visible: true, leg: 'landed', anim: 'idle', altitude: 13, frame: 0});
        expect(e.heli.drawn).toMatchObject({visible: true, texture: 'papi-heli', frame: 0});
        expect(e.president.visible, 'nobody leaves the helicopter').toBe(false);
        expect(e.crowd).toMatchObject({workers: 14, ecologists: 10, drawn: 24, states: ['gathered']});
        s = await sample(page);
        expect(s.suspension.reasons).toEqual(['cinematic']);
        expect(s.ui.titleVisible).toBe(false);
        await page.waitForTimeout(150);
        expect((await ending(page)).heli.drawn.frame, 'frame 0 held').toBe(0);
        await shoot(page, 'ending-1-helicopter-landed');

        // Out of HQ's door: the President, then La Guardia Royal; the engine still off.
        e = await seek(page, 3100);
        expect(e.phase).toBe('emergence');
        expect(e.president.visible).toBe(true);
        expect(e.president.y, 'from the door, below HQ').toBeGreaterThan(e.hq.y + e.hq.height - 10);
        expect(e.heli.drawn.frame).toBe(0);
        await page.waitForTimeout(150);
        await shoot(page, 'ending-1b-landed-frame0-president-out');
        e = await seek(page, 4500);
        expect(e.heli.leg, 'lifting off').toBe('takeoff');
        expect([2, 3, 4, 5, 6, 7]).toContain(e.heli.drawn.frame);
        e = await seek(page, 6000);
        expect(e.heli.leg).toBe('depart');
        expect([e.guards, e.guardsShown, e.guardTexture]).toEqual([2, 2, 'papi-laGuardia']);
        expect(e.guardStates).toEqual(['attention', 'attention']);
        await shoot(page, 'ending-2-formation');
        e = await seek(page, at(1));
        expect(e.heli.visible, 'gone before the speech').toBe(false);
        expect(e.guardStates).toEqual(['holding-salute', 'holding-salute']);
        expect(e.guardFrames).toEqual([11, 11]);
        await page.waitForTimeout(150);
        await shoot(page, 'ending-2b-guardia-salute');

        e = await seek(page, at(39));
        expect([e.phase, e.cue]).toEqual(['speech', 'PRESIDENTIAL_TRIUMPH']);
        expect(e.crowd.states).toContain('cheering');
        expect(e.subtitle, 'no recording here (audio off): the words show').toBe('ME! EL COLONEL PAPI!');
        expect(e.brute.visible).toBe(false);
        await page.waitForTimeout(150);
        await shoot(page, 'ending-3-speech');

        e = await seek(page, at(47));
        expect([e.cue, e.brute.state, e.brute.drawn]).toEqual(['BRUTE_REVEAL', 'revealed', true]);
        e = await seek(page, at(50));
        expect([e.cue, e.brute.state]).toEqual(['BRUTE_APPROACH', 'approaching']);
        expect(e.crowd.states).toContain('stepping-back');
        expect(e.president.visible, 'still welcoming it').toBe(true);
        await page.waitForTimeout(150);
        await shoot(page, 'ending-4-brute-approach');
        e = await seek(page, at(52));
        expect([e.cue, e.brute.state, e.brute.frame]).toEqual(['BRUTE_LUNGE', 'lunging', 14]);

        e = await seek(page, at(54.6));
        expect(e.cue).toBe('PRESIDENT_CONSUMED');
        expect([e.president.visible, e.president.drawn]).toEqual([false, false]);
        expect(e.brute.drawn).toBe(true);
        expect(e.crowd.states).toEqual(['scattering']);
        await page.waitForTimeout(150);
        await shoot(page, 'ending-5-consumed');
        e = await seek(page, at(56));
        expect([e.cue, e.brute.state]).toEqual(['CHEWING', 'chewing']);
        expect((await sample(page)).profile.presidentialEndingSeen, 'not before the end').toBe(false);

        // The simulation never moved.
        s = await sample(page);
        expect(s.simulation.tick).toBe(before.simulation.tick);
        expect(s.simulation.rng).toEqual(before.simulation.rng);
        expect(s.buildings).toEqual(before.buildings);
        expect(s.resources).toEqual(before.resources);

        // The end: black, then the menu, changed.
        e = await seek(page, at(57.42) + 200);
        expect(e.phase).toBe('fade');
        await expect(body(page)).toHaveAttribute('data-phase', 'ready', {timeout: 10000});
        s = await sample(page);
        expect(s.ending).toBe(null);
        expect(s.profile.presidentialEndingSeen).toBe(true);
        expect(s.officeMenuView).toMatchObject(AFTER);
        expect(s.ui.titleVisible).toBe(true);
        expect(s.gameOverView?.visible ?? false, 'no Game Over').toBe(false);
        await page.waitForTimeout(300);
        await shoot(page, 'ending-6-menu-after');

        // It lasts: a reload keeps it; resetting the flag brings the old office back.
        await boot(page, {scene: 'game', waitForQA: true, ...NEW_GAME});
        expect((await sample(page)).officeMenuView).toMatchObject(AFTER);
        await page.evaluate(() => window.__qa.ending.setSeen(false));
        await boot(page, {scene: 'game', waitForQA: true, ...NEW_GAME});
        expect((await sample(page)).officeMenuView).toMatchObject(ORIGINAL);
    });

    test('played through on its own clock (no audio): it finishes, ends the run and opens the menu; the flag is only set at the end', async ({page}) => {
        test.setTimeout(60000);
        await firstDay(page, mouse, 'endingSpeed=20');
        await day100(page);
        await expect.poll(async () => (await ending(page))?.speechMs ?? 0, {timeout: 10000, intervals: [50]}).toBeGreaterThan(30000);
        expect((await sample(page)).profile.presidentialEndingSeen).toBe(false);
        await expect(body(page)).toHaveAttribute('data-phase', 'ready', {timeout: 15000});
        const s = await sample(page);
        expect(s.profile.presidentialEndingSeen).toBe(true);
        expect(s.suspension.reasons).toEqual([]);
        expect(s.officeMenuView).toMatchObject(AFTER);
    });

    test('with sound: papi_final plays as the presidential voice and leads the timeline', async ({page}) => {
        test.setTimeout(60000);
        await firstDay(page, mouse, '', {audio: true});
        await day100(page);
        await seek(page, SPEECH_START - 200); // just before the speech: it starts on its own
        await expect.poll(async () => (await ending(page)).audio, {timeout: 5000}).toBe('playing');
        await expect.poll(async () => (await sample(page)).audio.presidentLine).toBe('papi.final');
        const a = await ending(page);
        await page.waitForTimeout(1000);
        const b = await ending(page);
        expect(b.speechMs).toBeGreaterThan(a.speechMs + 500);
        expect(b.subtitle, 'heard, so no subtitles').toBe(null);
        expect((await sample(page)).audio.playingMusic, 'no music under it').toBe(0);
    });

    test('after the ending: La Voz prints the other photograph, centred in the old frame; a new run plays normally and the Day 1 helicopter still comes', async ({page}) => {
        test.setTimeout(60000);
        await boot(page, {scene: 'game', waitForQA: true});
        await page.evaluate(() => window.__qa.ending.setSeen(true));
        await firstDay(page, mouse, '', {news: true, heli: true});
        await expect.poll(async () => (await sample(page)).newspaper?.open).toBe(true);
        let s = await sample(page);
        expect(s.newspaperView.photo).toMatchObject({asset: 'el-papi-2', key: 'papi-news-el-papi-2', loaded: true});
        expect([s.newspaperView.photo.width, s.newspaperView.photo.height]).toEqual([64 * s.newspaperView.photo.scale, 96 * s.newspaperView.photo.scale]);
        expect(s.newspaperView.headline, 'the paper itself is unchanged').toBeTruthy();
        await shoot(page, 'ending-7-newspaper');
        await clickAction(page, 'close-newspaper');
        await expect.poll(async () => (await sample(page)).heli?.state, {timeout: 15000}).toBe('done');
        s = await sample(page);
        expect(s.ending).toBe(null);
        expect(s.shiftCycle.day).toBe(2);
        expect(s.president.state, 'the Day 0 cameo ran as ever').toBe('gone');
    });
});

test.describe('THE PRESIDENTIAL VISIT: touch 844x390', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});

    test('on a phone: the ceremony fits, plays through, and the menu changes', async ({page}) => {
        test.setTimeout(60000);
        await firstDay(page, touch, 'endingSpeed=20');
        await day100(page);
        let e = await seek(page, at(50));
        expect(e.crowd.drawn).toBe(24);
        expect(e.guardsShown).toBe(2);
        await page.waitForTimeout(150);
        await shoot(page, 'ending-touch-approach');
        await expect(body(page)).toHaveAttribute('data-phase', 'ready', {timeout: 15000});
        const s = await sample(page);
        expect(s.profile.presidentialEndingSeen).toBe(true);
        expect(s.officeMenuView).toMatchObject({...AFTER, bustFrame: null, globeFrame: null}); // no bust or globe in the phone's office
        await shoot(page, 'ending-touch-menu-after');
    });
});
