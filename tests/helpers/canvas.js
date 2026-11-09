// tests/helpers/canvas.js
import {expect, test} from '@playwright/test';
import {inViewport, worldToScreen as project} from '../../src/scenes/cameraView.js';
import {attachBootDiagnostics, watchBoot} from './bootDiagnostics.js';

/**
 * Click a canvas element via its DOM proxy (see src/testShadow/TestProxy.js
 * addProxy()).
 *
 * The proxy has pointer-events: none, so locator.click() can never satisfy
 * Playwright's hit test — the canvas is what's under the point, not the
 * proxy. We read the proxy's box and dispatch a raw mouse click there
 * instead, which lands on the canvas and drives Phaser's real pointerdown
 * handler. This is the whole reason click-passthrough exists: the test
 * exercises the real input path, never a shortcut that calls a gameplay
 * method directly.
 */
export async function clickCanvasElement(locator, page) {
    await locator.waitFor({state: 'visible'});

    const box = await locator.boundingBox();
    if (!box) {
        throw new Error(`Canvas proxy is not measurable: ${await locator.evaluate(n => n.outerHTML)}`);
    }

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Select a proxy by its stable action id (see addProxy's `action` param). */
export const byAction = (page, action) => page.locator(`[data-action="${action}"]`);

/** TASK 032: the build menu is a drawer on desktop too, so a player opens it with BUILD first. */
export async function clickAction(page, action) {
    const locator = byAction(page, action);
    if (action.startsWith('build-') && await locator.count() > 0 && !(await locator.isVisible())) await clickAction(page, 'open-build');
    return clickCanvasElement(locator, page);
}

const touchLayout = (page) => page.evaluate(() => window.__qa.getState().ui.layout === 'touch');

/** Touch-tap a canvas element via its DOM proxy (requires hasTouch). Same passthrough idea as clickCanvasElement. */
export async function tapAction(page, action) {
    const locator = byAction(page, action);
    // On touch the build menu is a drawer, so a player opens it first.
    if (action.startsWith('build-') && await locator.count() > 0 && !(await locator.isVisible())) await tapAction(page, 'open-build');
    await locator.waitFor({state: 'visible'});
    const box = await locator.boundingBox();
    if (!box) throw new Error(`Canvas proxy is not measurable: ${action}`);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

/** On touch the build menu is a drawer. Open it, as a player would, before measuring what is in it. */
export async function showBuildMenu(page) {
    const open = byAction(page, 'open-build');
    if (await open.count() === 0) return;
    if (await page.evaluate(() => window.__qa.getState().ui.drawerOpen)) return;
    if (await touchLayout(page)) await tapAction(page, 'open-build');
    else await clickAction(page, 'open-build');
    await expect.poll(() => page.evaluate(() => window.__qa.getState().ui.drawerOpen)).toBe(true);
}

/** Close the drawer again with BUILD, as a player would, if it is open. */
export async function closeBuildMenu(page) {
    if (!await page.evaluate(() => window.__qa.getState().ui.drawerOpen)) return;
    if (await touchLayout(page)) await tapAction(page, 'open-build');
    else await clickAction(page, 'open-build');
    await expect.poll(() => page.evaluate(() => window.__qa.getState().ui.drawerOpen)).toBe(false);
}

/**
 * Map a point in the game's logical (world) space to page coordinates, using
 * the canvas's on-screen box. Test-side only: it lets specs aim real pointer
 * events at canvas positions that have no DOM proxy (e.g. grid cells). The
 * game itself never does this — it reads pointer.worldX/worldY.
 *
 * @param {{width: number, height: number}} gameSize - logical size, e.g. from sample(page)
 */
export async function worldToScreen(page, point, gameSize) {
    const box = await page.locator('canvas').boundingBox();
    if (!box) throw new Error('Canvas is not measurable');
    const {x, y} = await logicalPoint(page, point);
    return {
        x: box.x + (x / gameSize.width) * box.width,
        y: box.y + (y / gameSize.height) * box.height,
    };
}

const cameraOf = (page) => page.evaluate(() => window.__qa?.getState().camera ?? null);

/** Where a world point is on the 1280x720 canvas, through the real camera. */
async function logicalPoint(page, point) {
    const camera = await cameraOf(page);
    return camera ? project(camera, camera.viewport, point) : point;
}

/** Real mouse click at a world-space point on the canvas. */
export async function clickWorld(page, point, gameSize) {
    const s = await worldToScreen(page, point, gameSize);
    await page.mouse.click(s.x, s.y);
}

const ghostOf = (page) => page.evaluate(() => window.__qa?.getState().ghost ?? null);
const placing = (page) => page.evaluate(() => {
    const s = window.__qa?.getState();
    return Boolean(s?.placement?.selectedType || s?.roadMode);
});

/** One real touch tap at a world-space point, and nothing more (requires hasTouch). */
export async function tapOnce(page, point, gameSize) {
    const camera = await cameraOf(page);
    // A player who cannot see a tile zooms out to it, with the real button.
    if (camera && !inViewport(camera.viewport, await logicalPoint(page, point))) await tapAction(page, 'camera-fit');
    const s = await worldToScreen(page, point, gameSize);
    await page.touchscreen.tap(s.x, s.y);
}

async function ghostSettled(page, revision) {
    await expect.poll(async () => (await ghostOf(page))?.revision, {timeout: 2000, intervals: [16, 32, 64, 100]}).not.toBe(revision);
    return ghostOf(page);
}

const tileAt = ({grid}, {x, y}) => ({
    col: Math.floor((x - grid.originX) / grid.tileSize),
    row: Math.floor((y - grid.originY) / grid.tileSize),
});

/**
 * Act on a tile, as a player would. Building on touch is two taps: one puts the ghost
 * on the tile and one confirms it. A LOW_POWER warning stays up for the caller to
 * answer. tapOnce is the single tap, for tests of the ghost itself.
 */
export async function tapWorld(page, point, gameSize) {
    if (!(await placing(page))) {
        await tapOnce(page, point, gameSize);
        return;
    }
    const ghost = await ghostOf(page);
    const tile = gameSize.grid ? tileAt(gameSize, point) : null;
    const {footprint: f, cell} = ghost;
    const inside = f && tile && tile.col >= f.col && tile.col < f.col + f.width && tile.row >= f.row && tile.row < f.row + f.height;
    if (inside && (tile.col !== cell.col || tile.row !== cell.row)) {
        // A tap here would confirm the ghost where it is, so move it away first.
        const clear = f.col + f.width + 1 < gameSize.grid.cols ? f.col + f.width + 1 : f.col - 2;
        const {originX, originY, tileSize} = gameSize.grid;
        await tapOnce(page, {x: originX + (clear + 0.5) * tileSize, y: originY + (cell.row + 0.5) * tileSize}, gameSize);
        await ghostSettled(page, ghost.revision);
    }
    const before = await ghostOf(page);
    await tapOnce(page, point, gameSize);
    const after = await ghostSettled(page, before.revision);
    if (after.last !== 'moved') return;
    if (await page.evaluate(() => window.__qa.getState().powerWarning)) return;
    await tapOnce(page, point, gameSize);
    await ghostSettled(page, after.revision);
}

/** The scene-state mirror lives directly on <body data-*> — see markScene()/setBodyState(). */
export const body = (page) => page.locator('body');

/**
 * Navigate with ?testMode and wait for the target scene to be up, using
 * the same data-scene readiness signal markScene() writes. No asset-
 * loading stage to gate on here since this kit ships no external assets —
 * a real game with a preloader would add a first wait on a progress
 * attribute before this, same idea as waiting for data-scene here.
 *
 * @param {boolean} [opts.waitForQA] - also wait for window.__qa.getState
 *   to exist (QASurface.js). Only pass this for scenes that install one —
 *   the tic-tac-toe demo doesn't, since nothing there needs it.
 * @param {boolean} [opts.mutants] - false adds ?mutants=off, an empty spawn
 *   schedule for suites about power, economy and pollution. Combat tests
 *   must keep the default so they run the real schedule.
 * @param {boolean} [opts.hq] - the default is the real HQ-first flow, which new
 *   tests should use. false adds ?hq=off, a compatibility mode for legacy
 *   suites written before HQ existed. Do not use it for new tests.
 * @param {string} [opts.query] - extra query parameters, e.g. 'waveBudget=20'
 * @param {boolean} [opts.audio] - TASK 030: load and play sound. Off by default in tests (TEST_MODE's ?audio=off).
 * @param {boolean} [opts.news] - TASK 029: show La Voz at dawn. Off by default in tests (TEST_MODE's ?news=off), so
 *   older suites that step through a dawn and press the map keep working; a shipped game always shows it.
 * @param {string|null} [opts.cycle] - 'legacy' (the default) keeps the untimed Day that
 *   older suites were written for. null plays the real active Day, Dusk and Night;
 *   evidence about the active cycle must come from tests that pass null.
 * @param {string|null} [opts.map] - suites run on the original open map unless they
 *   ask for another. null adds nothing, which is the map a real new game gets.
 */
export async function boot(page, {path = '/', scene, waitForQA = false, mutants = true, hq = true, query = '', map = 'open', cycle = 'legacy', news = false, audio = false} = {}) {
    const watch = watchBoot(page);
    try {
        await page.goto(`${path}?testMode${cycle ? `&cycle=${cycle}` : ''}${map ? `&map=${map}` : ''}${mutants ? '' : '&mutants=off'}${hq ? '' : '&hq=off'}${news ? '' : '&news=off'}${audio ? '' : '&audio=off'}${query ? `&${query}` : ''}`);
        if (scene) {
            await expect(body(page)).toHaveAttribute('data-scene', scene, {timeout: 10_000});
        }
        if (waitForQA) {
            await page.waitForFunction(() => typeof window.__qa?.getState === 'function');
        }
    } catch (error) {
        await attachBootDiagnostics({page, watch, error, testInfo: test.info()});
        throw error;
    } finally {
        watch.stop();
    }
}
