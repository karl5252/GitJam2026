import {readFileSync} from 'node:fs';
import {test, expect} from '@playwright/test';
import {byAction, clickAction, clickWorld, tapAction, tapWorld, worldToScreen} from '../helpers/canvas.js';
import {cellCenter, hqFlow, stepExactly} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * HUDScene, the world camera and touch, through real input. Mouse presses go through
 * Playwright's mouse and fingers through a real CDP touch stream, because a pinch
 * needs two at once.
 */

const FORTRESS = JSON.parse(readFileSync(new URL('../fixtures/layouts/golden-fortress-brute-defense-v3.json', import.meta.url), 'utf8'));
const HQ = {col: 12, row: 8};
const MIN_TOUCH = 44;
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const mouse = {pressWorld: clickWorld, pressAction: clickAction};
const touch = {pressWorld: tapWorld, pressAction: tapAction};

/** A real multi-touch stream. Each frame is a list of finger positions in page pixels. */
async function fingers(page, frames) {
    const client = await page.context().newCDPSession(page);
    const points = (list) => list.map(([x, y], id) => ({x, y, id}));
    for (const [i, frame] of frames.entries()) {
        const type = i === 0 ? 'touchStart' : 'touchMove';
        await client.send('Input.dispatchTouchEvent', {type, touchPoints: points(frame)});
        await page.waitForTimeout(30);
    }
    await client.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await page.waitForTimeout(60);
}

async function loadFortress(page, query = 'mutants=off') {
    const {start} = hqFlow(mouse);
    const state = await start(page, query);
    const result = await page.evaluate((s) => window.__qa.layout.load(s), FORTRESS);
    expect(result.ok).toBe(true);
    return state;
}

const gameState = (s) => ({buildings: s.buildings, resources: s.resources, tick: s.simulation.tick, rng: s.simulation.rng, stepsExecuted: s.simulation.stepsExecuted});

test.describe('hud: lifecycle', () => {
    test('a HUD press never reaches the world: the menu, END DAY and camera buttons select nothing', async ({page}) => {
        const {start, buildHq} = hqFlow(mouse);
        const state = await start(page, 'mutants=off');
        await buildHq(page, state, HQ);
        await clickWorld(page, cellCenter(state.grid, HQ), state);
        await expect.poll(async () => (await sample(page)).selectedBuilding).not.toBeNull();
        const selected = (await sample(page)).selectedBuilding;
        for (const action of ['camera-zoom-in', 'camera-zoom-out', 'camera-fit']) {
            await clickAction(page, action);
            expect((await sample(page)).selectedBuilding, action).toBe(selected);
        }
    });

    test('each real restart brings up exactly one HUD: no subscription is left behind', async ({page}) => {
        test.setTimeout(45_000);
        const {start, buildHq, stepToDefeat} = hqFlow(mouse);
        const listeners = () => page.evaluate(() => window.__qa.busListeners());
        const run = async (state) => {
            await buildHq(page, state, HQ);
            await stepToDefeat(page, 2);
            await expect(byAction(page, 'restart')).toBeVisible();
            await clickAction(page, 'restart');
            await expect.poll(async () => (await sample(page).catch(() => null))?.ui?.startVisible).toBe(true);
        };
        const state = await start(page, 'waveBudget=40&waveLastTick=1200');
        const before = await listeners();
        expect(Object.values(before).every((count) => count === 1), JSON.stringify(before)).toBe(true);
        await run(state);
        for (let i = 0; i < 2; i++) {
            await clickAction(page, 'start');
            await expect.poll(async () => (await sample(page)).phase).toBe('started');
            await run(await sample(page));
        }
        expect(await listeners()).toEqual(before);
        await clickAction(page, 'start');
        await expect.poll(async () => (await sample(page)).shiftView?.text).toBe('Day 1 · Day Shift');

        // The keyboard still reaches the world after all those restarts.
        await clickAction(page, 'build-hq');
        await expect.poll(async () => (await sample(page)).placement.selectedType).toBe('hq');
        await page.keyboard.press('Escape');
        await expect.poll(async () => (await sample(page)).placement.selectedType).toBeNull();
        await clickAction(page, 'camera-zoom-in');
        const {x} = (await sample(page)).camera;
        await page.keyboard.press('ArrowRight');
        await expect.poll(async () => (await sample(page)).camera.x).toBeGreaterThan(x);
    });
});

test.describe('camera: desktop', () => {
    test('zoom, pan and FIT move the world and nothing else', async ({page}) => {
        const {start, buildHq} = hqFlow(mouse);
        const state = await start(page, 'mutants=off');
        await buildHq(page, state, HQ);
        const buttons = async () => Promise.all(['end-day', 'build-wall', 'camera-fit'].map((action) => byAction(page, action).boundingBox()));
        const before = await buttons();
        const game = gameState(await sample(page));

        await clickAction(page, 'camera-zoom-in');
        await clickAction(page, 'camera-zoom-in');
        const zoomed = (await sample(page)).camera;
        expect(zoomed.zoom).toBeCloseTo(1.5625);
        await page.keyboard.press('ArrowLeft');
        await expect.poll(async () => (await sample(page)).camera.x).toBeLessThan(zoomed.x);

        expect(await buttons()).toEqual(before);
        expect(gameState(await sample(page))).toEqual(game);
        await clickAction(page, 'camera-fit');
        await expect.poll(async () => (await sample(page)).camera).toMatchObject({zoom: 1, x: 640, y: 360});
    });

    test('the mouse wheel zooms at the pointer, and a right drag pans', async ({page}) => {
        const {start, buildHq} = hqFlow(mouse);
        const state = await start(page, 'mutants=off');
        await buildHq(page, state, HQ);
        const at = await worldToScreen(page, cellCenter(state.grid, {col: 6, row: 4}), state);
        await page.mouse.move(at.x, at.y);
        await page.mouse.wheel(0, -100);
        await expect.poll(async () => (await sample(page)).camera.zoom).toBeGreaterThan(1);
        const held = await worldToScreen(page, cellCenter(state.grid, {col: 6, row: 4}), state);
        expect(Math.abs(held.x - at.x)).toBeLessThan(1);

        const {x} = (await sample(page)).camera;
        await page.mouse.down({button: 'right'});
        await page.mouse.move(at.x - 60, at.y);
        await page.mouse.up({button: 'right'});
        await expect.poll(async () => (await sample(page)).camera.x).toBeGreaterThan(x);
        expect((await sample(page)).buildings).toHaveLength(1);
    });

    test('tiles are picked exactly after any zoom and pan', async ({page}) => {
        const {start, buildHq, place} = hqFlow(mouse);
        const state = await start(page, 'mutants=off');
        await buildHq(page, state, HQ);
        await clickAction(page, 'camera-zoom-in');
        await clickAction(page, 'camera-zoom-in');
        await clickAction(page, 'camera-zoom-in');
        await page.keyboard.press('ArrowUp');
        await place(page, state, 'wall', {col: 9, row: 6});
        expect((await sample(page)).buildings.at(-1)).toMatchObject({type: 'wall', col: 9, row: 6});
        await clickWorld(page, cellCenter(state.grid, {col: 10, row: 5}), state);
        await expect.poll(async () => (await sample(page)).selectedCell).toEqual({col: 10, row: 5});
    });

    test('a press outside the world viewport is no tile, however far the camera is zoomed', async ({page}) => {
        const {start, buildHq} = hqFlow(mouse);
        const state = await start(page, 'mutants=off');
        await buildHq(page, state, HQ);
        await clickAction(page, 'camera-zoom-in');
        await clickWorld(page, cellCenter(state.grid, {col: 12, row: 8}), state);
        await expect.poll(async () => (await sample(page)).selectedCell).not.toBeNull();
        const box = await page.locator('canvas').boundingBox();
        await page.mouse.click(box.x + box.width * 0.87, box.y + box.height * 0.3); // the right band
        await expect.poll(async () => (await sample(page)).selectedCell).toBeNull();
        expect((await sample(page)).buildings).toHaveLength(1);
    });

    test('Night opens at FIT, and does not fight a player who zooms after that', async ({page}) => {
        const {start, buildHq, nightTo} = hqFlow(mouse);
        const state = await start(page, 'mutants=off');
        await buildHq(page, state, HQ);
        await clickAction(page, 'camera-zoom-in');
        await nightTo(page, 5);
        expect((await sample(page)).camera.zoom).toBe(1);
        await clickAction(page, 'camera-zoom-in');
        await stepExactly(page, 60);
        await page.waitForTimeout(100);
        expect((await sample(page)).camera.zoom).toBeCloseTo(1.25);
    });
});

test.describe('fortress: the player-authored version 3 layout', () => {
    test('both Siege Cannons and both Rocket Barracks stay selectable when zoomed, with roles and flags intact', async ({page}) => {
        const state = await loadFortress(page);
        await clickAction(page, 'camera-zoom-in');
        await clickAction(page, 'camera-zoom-in');
        const {buildings} = await sample(page);
        for (const building of buildings.filter((b) => b.type === 'siegeCannon' || b.type === 'barracks')) {
            await clickAction(page, 'camera-fit');
            await clickAction(page, 'camera-zoom-in');
            await clickWorld(page, cellCenter(state.grid, {col: building.col + 1, row: building.row + 1}), state);
            await expect.poll(async () => (await sample(page)).selectedBuilding).toBe(building.id);
        }
        expect(await page.evaluate(() => window.__qa.layout.export())).toEqual(FORTRESS);
    });

    test('a flag moved at zoom lands on the exact tile, and the camera leaves the layout alone', async ({page}) => {
        const state = await loadFortress(page);
        const {id} = (await sample(page)).buildings.find((b) => b.type === 'barracks');
        await clickWorld(page, cellCenter(state.grid, {col: 15, row: 7}), state);
        await expect.poll(async () => (await sample(page)).selectedBuilding).toBe(id);
        await clickAction(page, 'camera-zoom-in');
        await clickAction(page, 'set-flag');
        await expect.poll(async () => (await sample(page)).flagMode).toBe(id);
        await clickWorld(page, cellCenter(state.grid, {col: 8, row: 12}), state);
        await expect.poll(async () => (await sample(page)).buildings.find((b) => b.id === id).flag).toEqual({col: 8, row: 12});
        await clickAction(page, 'reset-flag');
        await expect.poll(async () => (await sample(page)).buildings.find((b) => b.id === id).flag).toBeNull();
        const moved = structuredClone(FORTRESS);
        moved.buildings.find((b) => b.type === 'barracks').flag = null;
        expect(await page.evaluate(() => window.__qa.layout.export())).toEqual(moved);
    });

    for (const night of [30, 35, 40]) {
        test(`Night ${night}: zooming through a real fight changes no outcome`, async ({page}) => {
            const run = async (zoomAround) => {
                await loadFortress(page, 'seed=98');
                await page.evaluate((n) => window.__qa.sim.setDay(n), night);
                const {nightTo} = hqFlow(mouse);
                await nightTo(page, 20);
                if (zoomAround) {
                    await clickAction(page, 'camera-zoom-in');
                    await page.keyboard.press('ArrowRight');
                }
                await stepExactly(page, 900 - (await sample(page)).shiftCycle.elapsedNightTicks);
                if (zoomAround) await clickAction(page, 'camera-fit');
                const s = await sample(page);
                return {wave: s.wave, mutants: s.mutants, buildings: s.buildings, rng: s.simulation.rng, soldiers: s.infantry.soldiers};
            };
            const plain = await run(false);
            expect(plain.wave.brutes).toBe(night >= 40 ? 3 : night >= 35 ? 2 : 1);
            expect(await run(true)).toEqual(plain);
        });
    }
});

test.describe('touch', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});

    test('the layout is the touch one, and opens at a practical zoom', async ({page}) => {
        const {start, buildHq} = hqFlow(touch);
        const state = await start(page, 'mutants=off');
        expect((await sample(page)).ui.layout).toBe('touch');
        await buildHq(page, state, HQ);
        const {camera} = await sample(page);
        expect(camera.zoom).toBe(2);
    });

    test('every building can be reached from the drawer, at a comfortable size', async ({page}) => {
        const {start, buildHq} = hqFlow(touch);
        const state = await start(page, 'mutants=off');
        await buildHq(page, state, HQ);
        await tapAction(page, 'open-build');
        await expect.poll(async () => (await sample(page)).ui.drawerOpen).toBe(true);
        const actions = ['hq', 'outpost', 'factory', 'powerPlant', 'autocannon', 'siegeCannon', 'barracks', 'wall', 'gateVertical', 'gateHorizontal', 'road'].map((id) => `build-${id}`);
        const boxes = await Promise.all(actions.map((action) => byAction(page, action).boundingBox()));
        boxes.forEach((box, i) => {
            expect(box, actions[i]).not.toBeNull();
            expect(box.width).toBeGreaterThanOrEqual(MIN_TOUCH);
            expect(box.height).toBeGreaterThanOrEqual(MIN_TOUCH);
            for (let j = i + 1; j < boxes.length; j++) expect(overlaps(box, boxes[j]), `${actions[i]}, ${actions[j]}`).toBe(false);
        });
        await tapAction(page, 'build-siegeCannon');
        await expect.poll(async () => (await sample(page)).placement.selectedType).toBe('siegeCannon');
        expect((await sample(page)).ui.drawerOpen).toBe(false);
    });

    test('the selection actions sit beside the world, never over it', async ({page}) => {
        const {start} = hqFlow(touch);
        const state = await start(page, 'mutants=off');
        expect((await page.evaluate((s) => window.__qa.layout.load(s), FORTRESS)).ok).toBe(true);
        await tapAction(page, 'camera-fit');
        await tapWorld(page, cellCenter(state.grid, {col: 15, row: 7}), state);
        await expect.poll(async () => (await sample(page)).buildingControlsView.flagVisible).toBe(true);
        const {viewport} = (await sample(page)).camera;
        const canvas = await page.locator('canvas').boundingBox();
        const scale = canvas.width / 1280;
        const world = {x: canvas.x + viewport.x * scale, y: canvas.y + viewport.y * scale, width: viewport.width * scale, height: viewport.height * scale};
        for (const action of ['toggle-power', 'set-flag', 'reset-flag', 'refit', 'demolish', 'end-day', 'camera-fit']) {
            expect(overlaps(await byAction(page, action).boundingBox(), world), action).toBe(false);
        }
    });

    test('a tap on the drawer background closes it and touches nothing beneath', async ({page}) => {
        const {start, buildHq} = hqFlow(touch);
        const state = await start(page, 'mutants=off');
        await buildHq(page, state, HQ);
        await tapAction(page, 'open-build');
        await expect.poll(async () => (await sample(page)).ui.drawerOpen).toBe(true);
        const box = await page.locator('canvas').boundingBox();
        await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.84);
        await expect.poll(async () => (await sample(page)).ui.drawerOpen).toBe(false);
        expect((await sample(page)).selectedCell).toBeNull();
    });

    test('a pinch zooms and a two-finger drag pans, and neither builds a thing', async ({page}) => {
        const {start, buildHq} = hqFlow(touch);
        const state = await start(page, 'mutants=off');
        await buildHq(page, state, HQ);
        await tapAction(page, 'build-wall');
        await expect.poll(async () => (await sample(page)).placement.selectedType).toBe('wall');
        const box = await page.locator('canvas').boundingBox();
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        const {zoom} = (await sample(page)).camera;
        await fingers(page, [[[cx - 30, cy], [cx + 30, cy]], [[cx - 50, cy], [cx + 50, cy]], [[cx - 80, cy], [cx + 80, cy]]]);
        await expect.poll(async () => (await sample(page)).camera.zoom).toBeGreaterThan(zoom);
        const after = (await sample(page)).camera;
        await fingers(page, [[[cx - 40, cy], [cx + 40, cy]], [[cx - 80, cy], [cx, cy]], [[cx - 120, cy], [cx - 40, cy]]]);
        await expect.poll(async () => (await sample(page)).camera.x).not.toBe(after.x);
        const s = await sample(page);
        expect(s.buildings).toHaveLength(1);
        expect(s.resources.credits).toBe(1250);
        expect(s.placement.selectedType).toBe('wall');
    });

    test('a finger shows the footprint first, slides, and builds only on a separate tap', async ({page}) => {
        const {start, buildHq} = hqFlow(touch);
        const state = await start(page, 'mutants=off');
        await buildHq(page, state, HQ);
        await tapAction(page, 'camera-fit');
        await tapAction(page, 'build-outpost');
        await expect.poll(async () => (await sample(page)).placement.selectedType).toBe('outpost');
        const from = await worldToScreen(page, cellCenter(state.grid, {col: 3, row: 3}), state);
        const to = await worldToScreen(page, cellCenter(state.grid, {col: 5, row: 3}), state);
        const client = await page.context().newCDPSession(page);
        await client.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: from.x, y: from.y, id: 0}]});
        await expect.poll(async () => (await sample(page)).placement.preview?.footprint).toMatchObject({col: 3, row: 3});
        expect((await sample(page)).buildings).toHaveLength(1);
        await client.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: to.x, y: to.y, id: 0}]});
        await expect.poll(async () => (await sample(page)).placement.preview?.footprint).toMatchObject({col: 5, row: 3});
        expect((await sample(page)).buildings).toHaveLength(1);
        await client.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
        await page.waitForTimeout(100);
        expect((await sample(page)).buildings).toHaveLength(1);
        await page.touchscreen.tap(to.x, to.y);
        await expect.poll(async () => (await sample(page)).buildings.length).toBe(2);
        expect((await sample(page)).buildings.at(-1)).toMatchObject({type: 'outpost', col: 5, row: 3});
    });

    test('walls follow one finger, tile by tile', async ({page}) => {
        const {start, buildHq} = hqFlow(touch);
        const state = await start(page, 'mutants=off');
        await buildHq(page, state, HQ);
        await tapAction(page, 'camera-fit');
        await tapAction(page, 'build-wall');
        await expect.poll(async () => (await sample(page)).placement.selectedType).toBe('wall');
        const at = async (col) => {
            const {x, y} = await worldToScreen(page, cellCenter(state.grid, {col, row: 3}), state);
            return [x, y];
        };
        await fingers(page, [[await at(3)], [await at(4)], [await at(6)]]);
        await expect.poll(async () => (await sample(page)).ghost.segment.map(({col}) => col)).toEqual([3, 4, 5, 6]);
        expect((await sample(page)).buildings.filter((b) => b.type === 'wall')).toEqual([]);
        const [x, y] = await at(5);
        await page.touchscreen.tap(x, y);
        await expect.poll(async () => (await sample(page)).buildings.filter((b) => b.type === 'wall').map(({col}) => col)).toEqual([3, 4, 5, 6]);
    });

    test('a Rocket Barracks works from the action row, with a zoomed camera', async ({page}) => {
        const {start} = hqFlow(touch);
        const state = await start(page, 'mutants=off');
        const result = await page.evaluate((s) => window.__qa.layout.load(s), FORTRESS);
        expect(result.ok).toBe(true);
        await tapAction(page, 'camera-fit');
        const {id} = (await sample(page)).buildings.find((b) => b.type === 'barracks');
        await tapWorld(page, cellCenter(state.grid, {col: 15, row: 7}), state);
        await expect.poll(async () => (await sample(page)).selectedBuilding).toBe(id);
        const actions = ['toggle-power', 'set-flag', 'reset-flag', 'refit', 'demolish', 'end-day'];
        // DESTROY and REPAIR are the agreed 48x48 logical icon squares (TASK 025.4C UI hotfix);
        // every other control keeps the 44 CSS px rule.
        const iconCanvas = await page.locator('canvas').boundingBox();
        const iconMin = 48 * Math.min(iconCanvas.width / 1280, iconCanvas.height / 720) - 0.5;
        const minFor = (action) => (action === 'demolish' || action === 'repair' ? iconMin : MIN_TOUCH);
        const boxes = await Promise.all(actions.map((action) => byAction(page, action).boundingBox()));
        boxes.forEach((box, i) => {
            expect(box.width, actions[i]).toBeGreaterThanOrEqual(minFor(actions[i]));
            expect(box.height, actions[i]).toBeGreaterThanOrEqual(minFor(actions[i]));
            for (let j = i + 1; j < boxes.length; j++) expect(overlaps(box, boxes[j]), `${actions[i]}, ${actions[j]}`).toBe(false);
        });
        await tapAction(page, 'set-flag');
        await expect.poll(async () => (await sample(page)).flagMode).toBe(id);
        await tapWorld(page, cellCenter(state.grid, {col: 8, row: 12}), state);
        await expect.poll(async () => (await sample(page)).buildings.find((b) => b.id === id).flag).toEqual({col: 8, row: 12});
        await tapAction(page, 'reset-flag');
        await expect.poll(async () => (await sample(page)).buildings.find((b) => b.id === id).flag).toBeNull();
    });

    test('the LOW_POWER question works on a tap: the second tap on that tile builds', async ({page}) => {
        const {start, buildHq, place} = hqFlow(touch);
        const state = await start(page, 'mutants=off');
        await buildHq(page, state, HQ);
        await tapAction(page, 'camera-fit');
        await place(page, state, 'siegeCannon', {col: 3, row: 8});
        await tapAction(page, 'build-outpost');
        await expect.poll(async () => (await sample(page)).placement.selectedType).toBe('outpost');
        await tapWorld(page, cellCenter(state.grid, {col: 8, row: 3}), state);
        await expect.poll(async () => (await sample(page)).powerWarning).toMatchObject({type: 'outpost'});
        await tapWorld(page, cellCenter(state.grid, {col: 8, row: 3}), state);
        await expect.poll(async () => (await sample(page)).buildings.length).toBe(3);
    });
});

test.describe('touch at the smallest target', () => {
    test.use({viewport: {width: 740, height: 360}, hasTouch: true, isMobile: true});

    test('every control is still 44 CSS pixels', async ({page}) => {
        const {start, buildHq} = hqFlow(touch);
        const state = await start(page, 'mutants=off');
        await buildHq(page, state, HQ);
        const check = async (actions) => {
            for (const action of actions) {
                const box = await byAction(page, action).boundingBox();
                expect(box.width, action).toBeGreaterThanOrEqual(MIN_TOUCH);
                expect(box.height, action).toBeGreaterThanOrEqual(MIN_TOUCH);
            }
        };
        await check(['open-build', 'end-day', 'camera-zoom-in', 'camera-fit', 'camera-zoom-out']);
        await tapAction(page, 'open-build');
        await expect.poll(async () => (await sample(page)).ui.drawerOpen).toBe(true);
        await check(['build-siegeCannon', 'build-wall', 'build-road']);
    });
});

test.describe('orientation', () => {
    test.use({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});
    const landscape = {width: 844, height: 390};
    const portrait = {width: 390, height: 844};

    test('portrait start shows the screen, and turning the phone enters the game', async ({page}) => {
        await page.goto('/?testMode&map=open&mutants=off');
        const screen = page.locator('#orientation-guard');
        await expect(screen).toBeVisible();
        await expect(screen).toContainText('ROTATE YOUR DEVICE');
        await expect(screen).toContainText('PAPI INDUSTRIES REQUIRES LANDSCAPE ORIENTATION.');
        await expect(screen).toContainText('THE MINISTRY OF ORIENTATION THANKS YOU.');
        await page.setViewportSize(landscape);
        await expect(screen).toBeHidden();
        await expect(byAction(page, 'start')).toBeVisible();
        await tapAction(page, 'start');
        await expect(page.locator('body')).toHaveAttribute('data-phase', 'started');
    });

    async function runningNight(page, query = 'waveBudget=10') {
        await page.setViewportSize(landscape);
        const {start, buildHq, place} = hqFlow(touch);
        const state = await start(page, query);
        await buildHq(page, state, HQ);
        await place(page, state, 'powerPlant', {col: 20, row: 3});
        await tapAction(page, 'end-day');
        await expect.poll(async () => (await sample(page)).shiftCycle.elapsedNightTicks).toBeGreaterThan(30);
        return state;
    }

    test('turning mid-Night suspends the run and loses nothing, and turning back resumes it at its speed', async ({page}) => {
        await runningNight(page);
        await tapAction(page, 'speed-4');
        await expect.poll(async () => (await sample(page)).simulation.speed).toBe(4);
        await page.setViewportSize(portrait);
        await expect(page.locator('#orientation-guard')).toBeVisible();
        await page.waitForTimeout(100);
        const held = await sample(page);
        expect(held.orientation.blocked).toBe(true);
        await page.waitForTimeout(400);
        const later = await sample(page);
        expect(later.simulation.tick).toBe(held.simulation.tick);
        expect(later.mutants).toEqual(held.mutants);
        expect(later.simulation).toMatchObject({speed: 4, paused: false});

        await page.setViewportSize(landscape);
        await expect(page.locator('#orientation-guard')).toBeHidden();
        await expect.poll(async () => (await sample(page)).simulation.tick).toBeGreaterThan(held.simulation.tick);
        expect((await sample(page)).simulation.speed).toBe(4);
    });

    test('a run that was paused stays paused when it comes back', async ({page}) => {
        await runningNight(page);
        await page.evaluate(() => window.__qa.sim.pause());
        const {simulation} = await sample(page);
        await page.setViewportSize(portrait);
        await expect(page.locator('#orientation-guard')).toBeVisible();
        await page.setViewportSize(landscape);
        await expect(page.locator('#orientation-guard')).toBeHidden();
        await page.waitForTimeout(300);
        expect((await sample(page)).simulation).toMatchObject({paused: true, tick: simulation.tick});
    });

    test('nothing in the world can be pressed while it is turned', async ({page}) => {
        const state = await runningNight(page, 'mutants=off');
        await page.setViewportSize(portrait);
        await expect(page.locator('#orientation-guard')).toBeVisible();
        await page.touchscreen.tap(195, 420);
        await page.waitForTimeout(100);
        const s = await sample(page);
        expect(s.selectedCell).toBeNull();
        expect(s.buildings).toHaveLength(state.buildings?.length ? state.buildings.length + 2 : 2);
    });
});

test('a desktop window can be any shape, and is never told to turn', async ({page}) => {
    await page.setViewportSize({width: 500, height: 900});
    const {start} = hqFlow(mouse);
    await start(page, 'mutants=off');
    await expect(page.locator('#orientation-guard')).toBeHidden();
    expect((await sample(page)).orientation.blocked).toBe(false);
});
