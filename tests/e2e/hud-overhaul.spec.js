import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {byAction, clickAction, clickWorld, tapAction, tapWorld} from '../helpers/canvas.js';
import {cellCenter, hqFlow, qaSim} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * TASK 032: the HUD's one structure on desktop and touch. The top status bar, the
 * left rail with BUILD and END DAY, the construction drawer, the selection palette,
 * the right rail, and the audio settings. SHOTS=<dir> also saves the screenshots.
 */

const mouse = {pressWorld: clickWorld, pressAction: clickAction};
const touch = {pressWorld: tapWorld, pressAction: tapAction};
const FORTRESS = JSON.parse(readFileSync(new URL('../fixtures/layouts/golden-fortress-day33-v2.json', import.meta.url), 'utf8'));
const shots = process.env.SHOTS ?? null;
const shoot = async (page, name) => {
    if (shots) await page.screenshot({path: `${shots}/${name}.png`});
};
const overlaps = (p, q) => p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
const BUILD_IDS = ['hq', 'factory', 'powerPlant', 'mine', 'autocannon', 'siegeCannon', 'barracks', 'wall', 'road', 'gateVertical', 'gateHorizontal', 'outpost', 'loudspeaker'];
const SHORT = {hq: 'HQ', powerPlant: 'POWER', factory: 'FACTORY', mine: 'MINE', autocannon: 'AUTO', siegeCannon: 'SIEGE', barracks: 'BARRACKS',
    outpost: 'OUTPOST', loudspeaker: 'SPEAKER', road: 'ROAD', wall: 'WALL', gateVertical: 'GATE |', gateHorizontal: 'GATE -'};
const CATEGORY = {hq: 'neutral', factory: 'industry', mine: 'industry', road: 'industry', powerPlant: 'power', loudspeaker: 'propaganda',
    autocannon: 'military', siegeCannon: 'military', barracks: 'military', wall: 'military', gateVertical: 'military', gateHorizontal: 'military', outpost: 'military'};

/** The world's screen rectangle, in page pixels. */
async function worldBox(page) {
    const {viewport} = (await sample(page)).camera;
    const canvas = await page.locator('canvas').boundingBox();
    const scale = canvas.width / 1280;
    return {x: canvas.x + viewport.x * scale, y: canvas.y + viewport.y * scale, width: viewport.width * scale, height: viewport.height * scale};
}

async function boxes(page, actions) {
    return Promise.all(actions.map(async (action) => ({action, box: await byAction(page, action).boundingBox()})));
}

function expectApart(list) {
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) expect(overlaps(list[i].box, list[j].box), `${list[i].action} / ${list[j].action}`).toBe(false);
    }
}

async function fortressBarracks(page, flow) {
    const s = await flow.start(page, 'mutants=off');
    expect((await page.evaluate((f) => window.__qa.layout.load(f), FORTRESS)).ok).toBe(true);
    const state = await sample(page);
    return {state, barracks: state.buildings.find((b) => b.type === 'barracks'), hq: state.buildings.find((b) => b.type === 'hq'), s};
}

test.describe('HUD overhaul: desktop', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('the drawer opens from BUILD with every building as framed art, live prices and short labels, and closes on a choice', async ({page}) => {
        const flow = hqFlow(mouse);
        const state = await flow.start(page, '', {map: null, cycle: null, mutants: false});
        await shoot(page, '01-desktop-day0');
        let s = await sample(page);
        expect(s.ui.drawerOpen).toBe(false);
        await expect(byAction(page, 'build-hq')).toBeHidden(); // nothing in the drawer shows until BUILD
        await clickAction(page, 'open-build');
        await expect.poll(async () => (await sample(page)).ui.drawerOpen).toBe(true);
        s = await sample(page);
        for (const id of BUILD_IDS) {
            const view = s.buildButtonViews[id];
            expect(view.label, id).toBe(SHORT[id]);
            expect(view.category, id).toBe(CATEGORY[id]);
            expect(view.art, `${id} shows its existing art`).toBe(id === 'road' ? 'road' : `papi-art-${id}`);
        }
        const shown = BUILD_IDS.filter((id) => s.buildButtonViews[id].visible);
        expect(shown).toEqual(expect.arrayContaining(['hq', 'factory', 'powerPlant', 'autocannon', 'road', 'wall', 'loudspeaker']));
        expect(s.buildButtonViews.factory.cost).toBe('400c 1AP');
        expect(s.buildButtonViews.wall.cost).toBe('25c');
        expect(s.buildButtonViews.road.cost).toBe('2c');
        expect(s.buildButtonViews.hq.cost).toBe('0c');
        expect(s.menuLabels.autocannon).toBe('Autocannon 1x1\n250c · 1 AP'); // the full name stays: the tooltip
        // Each a 96 px frame (3x), apart, and clear of both rails.
        const rail = await boxes(page, ['open-build', 'end-day', 'camera-fit', 'camera-zoom-in', 'camera-zoom-out']);
        const drawer = await boxes(page, shown.map((id) => `build-${id}`));
        for (const {action, box} of drawer) expect([Math.round(box.width), Math.round(box.height)], action).toEqual([96, 96]);
        expectApart([...rail, ...drawer]);
        // Hover: the tooltip names it in full.
        const factory = drawer.find((d) => d.action === 'build-factory').box;
        await page.mouse.move(factory.x + factory.width / 2, factory.y + factory.height / 2);
        await shoot(page, '02-desktop-drawer');
        await flow.buildHq(page, state, state.terrain.center);
        s = await sample(page);
        expect(s.ui.drawerOpen).toBe(false); // the choice closed it
        expect(s.buildButtonViews.hq.cost).toBe('BUILT');
        expect(s.menuLabels.hq).toBe('HQ 3x3\nBUILT');
    });

    test('a price the player cannot pay is hatched and red, not dimmed, and the domain still decides', async ({page}) => {
        const flow = hqFlow(mouse);
        const state = await flow.start(page, 'mutants=off');
        await flow.buildHq(page, state, {col: 4, row: 4});
        await page.evaluate(() => window.__qa.economy.setCredits(200));
        await clickAction(page, 'open-build');
        const s = await sample(page);
        expect(s.buildButtonViews.autocannon).toMatchObject({affordable: false, lacks: ['credits'], alpha: 1});
        expect(s.buildButtonViews.outpost).toMatchObject({affordable: true, alpha: 1});
        await expect(byAction(page, 'build-autocannon')).toHaveAttribute('data-affordable', 'false');
        await shoot(page, '03-desktop-insufficient');
        await clickAction(page, 'build-autocannon');
        await expect.poll(async () => (await sample(page)).placement.selectedType).toBe('autocannon');
        await expect.poll(async () => (await sample(page)).buildButtonViews.autocannon.selected).toBe(true);
        // The existing rule (CLAUDE.md, economy.spec): choosing it is allowed and previews red;
        // the game refuses the placement itself, with its hint, and nothing changes.
        const before = await sample(page);
        await clickWorld(page, cellCenter(state.grid, {col: 14, row: 6}), state);
        await expect.poll(async () => (await sample(page)).placement.lastResult?.reason).toBe('insufficient-credits');
        let after = await sample(page);
        expect(after.resources).toEqual(before.resources);
        expect(after.buildings).toEqual(before.buildings);
        expect(after.simulation.tick).toBe(before.simulation.tick);
        expect(after.previewView).toMatchObject({visible: true, fillColor: 0xe53935});
        await clickAction(page, 'cancel-placement');

        // AP: the same. Five Outposts spend every AP; a sixth is refused.
        await page.evaluate(() => window.__qa.economy.setCredits(1000));
        for (let i = 0; i < 5; i++) await flow.place(page, state, 'outpost', {col: 14 + i, row: 1});
        await clickAction(page, 'open-build');
        expect((await sample(page)).buildButtonViews.outpost).toMatchObject({affordable: false, lacks: ['ap']});
        const noAp = await sample(page);
        await clickAction(page, 'build-outpost');
        await clickWorld(page, cellCenter(state.grid, {col: 14, row: 10}), state);
        await expect.poll(async () => (await sample(page)).placement.lastResult?.reason).toBe('insufficient-ap');
        after = await sample(page);
        expect([after.resources, after.buildings.length]).toEqual([noAp.resources, noAp.buildings.length]);
    });

    test('an unavailable building (locked before HQ) never enters placement mode, and changes nothing', async ({page}) => {
        const flow = hqFlow(mouse);
        await flow.start(page, 'mutants=off');
        await clickAction(page, 'open-build');
        const before = await sample(page);
        expect(before.buildButtonViews.factory).toMatchObject({state: 'locked', alpha: 0.45});
        await clickAction(page, 'build-factory');
        const after = await sample(page);
        expect(after.placement.selectedType).toBeNull();
        expect(after.resources).toEqual(before.resources);
        expect(after.simulation.tick).toBe(before.simulation.tick);
    });

    test('the palette shows only what a Barracks accepts, with its name and HP, and never sits under the drawer', async ({page}) => {
        const flow = hqFlow(mouse);
        const {state, barracks, hq} = await fortressBarracks(page, flow);
        await flow.select(page, state, {col: barracks.col + 1, row: barracks.row + 1}, barracks.id);
        let s = await sample(page);
        expect(s.ui.paletteVisible).toBe(true);
        expect(s.paletteView.header).toMatch(/^BARRACKS\nHP 300\/300\n(ON|UNPOWERED)$/);
        expect(s.paletteView.toggle.label).toBe('SWITCH\nOFF');
        expect(s.buildingControlsView).toMatchObject({flagVisible: true, refitVisible: true, demolishVisible: true, repairVisible: false});
        const actions = ['toggle-power', 'set-flag', 'refit', 'demolish', 'open-build', 'end-day'];
        const list = await boxes(page, actions);
        expectApart(list);
        const world = await worldBox(page);
        for (const {action, box} of list) expect(overlaps(box, world), `${action} beside the world`).toBe(false);
        await shoot(page, '04-desktop-barracks-palette');

        // BUILD is still there, and opening the drawer puts the palette away; the selection stays.
        await clickAction(page, 'open-build');
        s = await sample(page);
        expect(s.ui).toMatchObject({drawerOpen: true, paletteVisible: false});
        expect(s.selectedBuilding).toBe(barracks.id);
        await expect(byAction(page, 'toggle-power')).toHaveCount(0);
        await clickAction(page, 'open-build');
        await expect.poll(async () => (await sample(page)).ui.paletteVisible).toBe(true);

        // HQ: workers and no power switch or DESTROY. Clearing the selection removes the palette.
        await flow.select(page, state, {col: hq.col + 1, row: hq.row + 1}, hq.id);
        s = await sample(page);
        expect(s.paletteView.header).toMatch(/^HQ\nHP 600\/600$/);
        expect(s.buildingControlsView).toMatchObject({flagVisible: true, demolishVisible: false});
        expect(s.ui.toggleVisible).toBe(false);
        await clickWorld(page, cellCenter(state.grid, {col: 0, row: 0}), state);
        await expect.poll(async () => (await sample(page)).ui.paletteVisible).toBe(false);
    });

    test('phases: Day 0, a paused Day and Night each read in the top bar, with their own rail and right rail', async ({page}) => {
        const flow = hqFlow(mouse);
        const state = await flow.start(page, '', {map: null, cycle: null, mutants: false});
        expect((await sample(page)).shiftView.text).toBe('Day 0 · Initial Deployment');
        await flow.buildHq(page, state, state.terrain.center);
        await clickAction(page, 'end-day');
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('dusk');
        await qaSim(page, 'pause');
        await page.evaluate(() => window.__qa.sim.stepTicks(240));
        await page.evaluate(() => window.__qa.sim.stepTicks(240));
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('night');
        let s = await sample(page);
        expect(s.ui).toMatchObject({buildMenuVisible: false, endDayVisible: false});
        expect(s.speedView.visible).toBe(true);
        expectApart(await boxes(page, ['speed-1', 'speed-2', 'speed-4', 'camera-fit', 'camera-zoom-in', 'camera-zoom-out']));
        await shoot(page, '05-desktop-night');
        await qaSim(page, 'stepTicks', 240);
        await page.evaluate(() => {
            for (let i = 0; i < 40 && window.__qa.getState().shiftCycle.shift === 'night'; i++) window.__qa.sim.stepTicks(240);
        });
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('day');
        await clickAction(page, 'day-pause');
        await expect.poll(async () => (await sample(page)).dayTimeView.pause).toBe('PLAY');
        s = await sample(page);
        expect(s.shiftView.text).toContain('(paused)');
        expect(s.ui).toMatchObject({buildMenuVisible: true, endDayVisible: true});
        expectApart(await boxes(page, ['day-pause', 'day-speed', 'camera-fit', 'camera-zoom-in', 'camera-zoom-out', 'open-build', 'end-day', 'show-report']));
        await shoot(page, '06-desktop-paused-day');
    });
});

test.describe('HUD overhaul: audio settings', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('AUDIO opens four sliders and MUTE on the real SoundManager; a drag sets a level, which is saved, and M still mutes', async ({page}) => {
        const flow = hqFlow(mouse);
        await flow.start(page, 'mutants=off', {audio: true});
        await clickAction(page, 'audio-settings');
        await expect.poll(async () => (await sample(page)).ui.audioOpen).toBe(true);
        for (const channel of ['master', 'music', 'sfx', 'voices']) await expect(byAction(page, `audio-volume-${channel}`)).toHaveCount(1);
        const track = await byAction(page, 'audio-volume-music').boundingBox();
        // Press at the left quarter, then drag to the middle: the level follows the pointer.
        await page.mouse.move(track.x + track.width * 0.25, track.y + track.height / 2);
        await page.mouse.down();
        await page.mouse.move(track.x + track.width * 0.5, track.y + track.height / 2, {steps: 4});
        await page.mouse.up();
        await expect.poll(async () => (await sample(page)).audioSettingsView.volumes.music).toBe(0.5);
        await expect(byAction(page, 'audio-volume-music')).toHaveAttribute('data-value', '50');
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('papi_audio')));
        expect(saved).toMatchObject({version: 2});
        expect(saved.volumes.music).toBe(0.5);
        await shoot(page, '07-desktop-audio');
        await clickAction(page, 'audio-mute');
        await expect.poll(async () => (await sample(page)).audioSettingsView.muted).toBe(true);
        await page.keyboard.press('m'); // the M key still works, and the panel follows it
        await expect.poll(async () => (await sample(page)).audioSettingsView.muted).toBe(false);
        await expect(byAction(page, 'audio-mute')).toHaveAttribute('data-muted', 'false');
        await clickAction(page, 'close-audio');
        await expect.poll(async () => (await sample(page)).ui.audioOpen).toBe(false);
        await expect(byAction(page, 'audio-mute')).toHaveCount(0);
    });
});

/** Touch: every control at least 44 CSS px, apart, and only the drawer over the world. */
for (const viewport of [{width: 844, height: 390}, {width: 684, height: 400}, {width: 740, height: 360}]) {
    test.describe(`HUD overhaul: touch ${viewport.width}x${viewport.height}`, () => {
        test.use({viewport, hasTouch: true, isMobile: true});
        const MIN = 44;
        const big = (list) => {
            for (const {action, box} of list) {
                expect(box, action).not.toBeNull();
                expect(box.width, `${action} width`).toBeGreaterThanOrEqual(MIN);
                expect(box.height, `${action} height`).toBeGreaterThanOrEqual(MIN);
                expect(box.y + box.height, `${action} on screen`).toBeLessThanOrEqual(viewport.height + 0.5);
                expect(box.x + box.width, `${action} on screen`).toBeLessThanOrEqual(viewport.width + 0.5);
            }
        };

        test('rails, drawer and palette are big enough, apart, and the palette stays off the world', async ({page}) => {
            test.setTimeout(45000);
            const flow = hqFlow(touch);
            const {state, barracks} = await fortressBarracks(page, flow);
            expect((await sample(page)).ui.layout).toBe('touch');
            await tapAction(page, 'camera-fit');
            const rails = await boxes(page, ['open-build', 'end-day', 'camera-zoom-in', 'camera-fit', 'camera-zoom-out']);
            big(rails);
            await tapAction(page, 'open-build');
            await expect.poll(async () => (await sample(page)).ui.drawerOpen).toBe(true);
            const ids = Object.entries((await sample(page)).buildButtonViews).filter(([, v]) => v.visible).map(([id]) => `build-${id}`);
            expect(ids.length).toBe(11); // the open map: no Mine or Loudspeaker to offer
            const drawer = await boxes(page, ids);
            big(drawer);
            expectApart([...rails, ...drawer]);
            if (viewport.width === 844) await shoot(page, '08-touch-844-drawer');
            await tapAction(page, 'open-build');

            await tapWorld(page, cellCenter(state.grid, {col: barracks.col + 1, row: barracks.row + 1}), state);
            await expect.poll(async () => (await sample(page)).selectedBuilding).toBe(barracks.id);
            const palette = await boxes(page, ['toggle-power', 'set-flag', 'refit', 'demolish']);
            big(palette);
            expectApart([...rails, ...palette]);
            const world = await worldBox(page);
            for (const {action, box} of palette) expect(overlaps(box, world), `${action} beside the world`).toBe(false);
            if (viewport.width === 844) await shoot(page, '09-touch-844-palette');
            if (viewport.width === 684) await shoot(page, '10-touch-684-palette');
        });

        if (viewport.width === 740) {
            test('Night on the smallest phone: speeds and the camera on the right rail', async ({page}) => {
                const flow = hqFlow(touch);
                const state = await flow.start(page, 'mutants=off');
                await flow.buildHq(page, state, {col: 6, row: 6});
                await tapAction(page, 'end-day');
                await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('night');
                const list = await boxes(page, ['speed-1', 'speed-2', 'speed-4', 'camera-zoom-in', 'camera-fit', 'camera-zoom-out']);
                big(list);
                expectApart(list);
                await shoot(page, '11-touch-740-night');
            });
        }
    });
}

test.describe('HUD overhaul: a normal session, no TEST_MODE', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('Start, BUILD, a building, AUDIO and its sliders all work without the QA harness', async ({page}) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
            if (message.type() === 'error') errors.push(message.text());
        });
        await page.goto('/');
        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible();
        await page.waitForTimeout(800);
        const box = await canvas.boundingBox();
        const at = (x, y) => page.mouse.click(box.x + x * box.width / 1280, box.y + y * box.height / 720);
        await at(640, 668); // START
        await page.waitForTimeout(600);
        await at(52, 136); // BUILD
        await page.waitForTimeout(200);
        await at(170, 168); // HQ, the drawer's first button
        await page.waitForTimeout(200);
        await at(640, 360); // build it in the clearing
        await page.waitForTimeout(300);
        await at(1160, 664); // AUDIO
        await page.waitForTimeout(200);
        await at(640, 300); // a slider row
        await page.waitForTimeout(200);
        await page.keyboard.press('m');
        await page.waitForTimeout(200);
        await page.keyboard.press('Escape'); // closes the panel
        expect(errors).toEqual([]);
    });

    test('with no QA at all, the Dusk countdown on screen stands still behind AUDIO and runs again after it', async ({page}) => {
        test.setTimeout(30000);
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto('/');
        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible();
        await page.waitForTimeout(800);
        const box = await canvas.boundingBox();
        const at = (x, y) => page.mouse.click(box.x + x * box.width / 1280, box.y + y * box.height / 720);
        // What the top bar's phase line shows, as pixels: the only evidence a player has.
        const clock = () => page.screenshot({clip: {x: box.x + 440 * box.width / 1280, y: box.y + 8 * box.height / 720, width: 400 * box.width / 1280, height: 36 * box.height / 720}});
        await at(640, 668); // START
        await page.waitForTimeout(600);
        await at(52, 136); // BUILD
        await at(170, 168); // HQ
        await at(640, 360); // in the clearing
        await page.waitForTimeout(300);
        await at(52, 664); // END DAY: Dusk counts down in real time
        await page.waitForTimeout(1200);
        const a1 = await clock();
        await page.waitForTimeout(1100);
        expect(a1.equals(await clock()), 'Dusk counts down').toBe(false);
        await at(1160, 664); // AUDIO
        await page.waitForTimeout(300);
        const held = await clock();
        await page.waitForTimeout(1300);
        expect(held.equals(await clock()), 'held behind AUDIO').toBe(true);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        const resumed = await clock();
        await page.waitForTimeout(1200);
        expect(resumed.equals(await clock()), 'running again').toBe(false);
        expect(errors).toEqual([]);
    });
});

// ---- TASK 032: BUILD and AUDIO hold the world --------------------------------------

const tick = async (page) => (await sample(page)).simulation.tick;
const reasons = async (page) => (await sample(page)).suspension.reasons;

/** A running timed Day in the ACTIVE cycle: HQ, then Day 0's END DAY, Dusk and Night stepped through. */
async function runningDay(page, input, options = {}) {
    const flow = hqFlow(input);
    const state = await flow.start(page, '', {cycle: null, mutants: false, ...options});
    await flow.buildHq(page, state, {col: 6, row: 6});
    await input.pressAction(page, 'end-day');
    await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('dusk');
    await qaSim(page, 'pause');
    await page.evaluate(() => {
        for (let i = 0; i < 40 && window.__qa.getState().shiftCycle.shift !== 'day'; i++) window.__qa.sim.stepTicks(240);
    });
    await expect.poll(async () => (await sample(page)).simulation.paused).toBe(false); // dawn resumes the clock
    return state;
}

/** Real time passes and the clock does not move. */
async function expectFrozen(page) {
    const before = await sample(page);
    await page.waitForTimeout(400);
    const after = await sample(page);
    expect(after.simulation.tick).toBe(before.simulation.tick);
    expect(after.shiftCycle).toEqual(before.shiftCycle);
    return after.simulation.tick;
}

async function expectRunning(page, from) {
    await expect.poll(() => tick(page)).toBeGreaterThan(from);
}

test.describe('HUD overhaul: BUILD and AUDIO hold the world (desktop)', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('BUILD freezes a running Day and lets it go on close, from the same tick, at the same speed; a manual PAUSE survives it', async ({page}) => {
        test.setTimeout(45000);
        await runningDay(page, mouse);
        await expectRunning(page, await tick(page));

        await clickAction(page, 'open-build');
        expect(await reasons(page)).toEqual(['build']);
        const held = await expectFrozen(page);
        await clickAction(page, 'open-build'); // close it
        expect(await reasons(page)).toEqual([]);
        expect(await tick(page)).toBeLessThanOrEqual(held + 24); // at most a frame or so: nothing made up
        await expectRunning(page, held);

        // 4x: held, and still 4x after.
        await clickAction(page, 'day-speed');
        await clickAction(page, 'day-speed');
        await expect.poll(async () => (await sample(page)).simulation.speed).toBe(4);
        await clickAction(page, 'open-build');
        const fast = await expectFrozen(page);
        expect((await sample(page)).simulation.speed).toBe(4);
        await clickAction(page, 'open-build');
        await expectRunning(page, fast);
        expect((await sample(page)).simulation.speed).toBe(4);

        // The player's own PAUSE is the clock's, and BUILD never touches it.
        await clickAction(page, 'day-pause');
        await expect.poll(async () => (await sample(page)).simulation.paused).toBe(true);
        await clickAction(page, 'open-build');
        await clickAction(page, 'open-build');
        expect(await reasons(page)).toEqual([]);
        await expectFrozen(page);
        expect((await sample(page)).dayTimeView.pause).toBe('PLAY');

        // Escape closes the drawer and releases it too, five times over, leaving nothing held.
        await clickAction(page, 'day-pause'); // PLAY
        for (let i = 0; i < 5; i++) {
            await clickAction(page, 'open-build');
            await page.keyboard.press('Escape');
            await expect.poll(async () => (await sample(page)).ui.drawerOpen).toBe(false);
        }
        expect(await reasons(page)).toEqual([]);
        await expectRunning(page, await tick(page));
    });

    test('choosing a building closes the drawer, releases the world and starts placement, and places nothing by itself', async ({page}) => {
        test.setTimeout(45000);
        await runningDay(page, mouse);
        const count = (await sample(page)).buildings.length;
        await clickAction(page, 'open-build');
        await expectFrozen(page);
        await clickAction(page, 'build-wall');
        let s = await sample(page);
        expect(s.placement.selectedType).toBe('wall');
        expect(s.ui.drawerOpen).toBe(false);
        expect(s.suspension.reasons).toEqual([]);
        await expectRunning(page, s.simulation.tick);
        await page.waitForTimeout(150);
        s = await sample(page);
        expect(s.buildings.length).toBe(count); // the choosing press placed nothing
    });

    test('AUDIO holds the world, silences its engines and keeps the music; closing it never resumes what PAUSE holds', async ({page}) => {
        test.setTimeout(60000);
        await runningDay(page, mouse, {audio: true});
        await expect.poll(async () => (await sample(page)).audio.playingMusic, {timeout: 15000}).toBeGreaterThan(0);
        const listeners = await page.evaluate(() => window.__qa.busListeners());
        for (let i = 0; i < 3; i++) {
            await clickAction(page, 'audio-settings');
            expect(await reasons(page)).toEqual(['audio']);
            await expectFrozen(page);
            const s = await sample(page);
            expect(s.audio.worldActive).toBe(false);
            expect(s.audio.playingEngines).toBe(0);
            expect(s.audio.playingMusic).toBe(1); // the music plays on, once, so its level can be heard
            await clickAction(page, 'close-audio');
            expect(await reasons(page)).toEqual([]);
            await expectRunning(page, s.simulation.tick);
        }
        expect(await page.evaluate(() => window.__qa.busListeners())).toEqual(listeners); // nothing piles up
        await expect.poll(async () => (await sample(page)).audio.worldActive).toBe(true);
        expect((await sample(page)).audio.playingMusic).toBe(1);

        // PAUSE, then AUDIO open and closed: still paused.
        await clickAction(page, 'day-pause');
        await clickAction(page, 'audio-settings');
        await clickAction(page, 'close-audio');
        await expectFrozen(page);
        expect((await sample(page)).simulation.paused).toBe(true);
    });

    test('Night at 4x: AUDIO freezes mutants, combat, the wave and the countdown, then resumes at 4x', async ({page}) => {
        test.setTimeout(45000);
        const flow = hqFlow(mouse);
        const state = await flow.start(page, '', {audio: true});
        await flow.buildHq(page, state, {col: 12, row: 8});
        await flow.place(page, state, 'powerPlant', {col: 4, row: 8});
        await flow.place(page, state, 'autocannon', {col: 16, row: 8});
        await clickAction(page, 'end-day');
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('night');
        await clickAction(page, 'speed-4');
        await expect.poll(async () => (await sample(page)).mutants.length, {timeout: 15000}).toBeGreaterThan(0);
        await clickAction(page, 'audio-settings');
        const before = await sample(page);
        await page.waitForTimeout(500);
        const after = await sample(page);
        expect(after.simulation.tick).toBe(before.simulation.tick);
        expect(after.mutants).toEqual(before.mutants);
        expect(after.autocannons).toEqual(before.autocannons);
        expect(after.waveProgress).toEqual(before.waveProgress);
        expect(after.shiftView.text).toBe(before.shiftView.text);
        await clickAction(page, 'close-audio');
        expect((await sample(page)).simulation.speed).toBe(4);
        await page.waitForTimeout(250);
        const later = await tick(page);
        expect(later).toBeGreaterThan(before.simulation.tick);
        expect(later - before.simulation.tick).toBeLessThanOrEqual(4 * 60 * 0.6 + 24); // real time only: nothing made up
    });
});

test.describe('HUD overhaul: BUILD and AUDIO hold the world (touch)', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});

    test('the drawer holds the world on a phone; a tap on a building places nothing; a tap on the AUDIO dimmer reaches nothing beneath', async ({page}) => {
        test.setTimeout(45000);
        await runningDay(page, touch, {audio: true});
        const count = (await sample(page)).buildings.length;
        await tapAction(page, 'open-build');
        expect(await reasons(page)).toEqual(['build']);
        await expectFrozen(page);
        await tapAction(page, 'build-outpost');
        let s = await sample(page);
        expect(s.placement.selectedType).toBe('outpost');
        expect(s.suspension.reasons).toEqual([]);
        await page.waitForTimeout(150);
        expect((await sample(page)).buildings.length).toBe(count);
        await tapAction(page, 'cancel-placement');

        await tapAction(page, 'audio-settings');
        expect(await reasons(page)).toEqual(['audio']);
        const held = await expectFrozen(page);
        // A tap on the dimmer over the world, beside the panel, closes it and reaches nothing beneath:
        // a world tap would at least select its tile.
        const canvas = await page.locator('canvas').boundingBox();
        const scale = canvas.width / 1280;
        await page.touchscreen.tap(canvas.x + 260 * scale, canvas.y + 400 * scale);
        await expect.poll(async () => (await sample(page)).ui.audioOpen).toBe(false);
        s = await sample(page);
        expect(s.selectedCell).toBeNull();
        expect(s.selectedBuilding).toBeNull();
        expect(s.suspension.reasons).toEqual([]);
        await expectRunning(page, held);
    });
});
