// tests/helpers/canvas.js
import {expect} from '@playwright/test';

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

export const clickAction = (page, action) => clickCanvasElement(byAction(page, action), page);

/** Touch-tap a canvas element via its DOM proxy (requires hasTouch). Same passthrough idea as clickCanvasElement. */
export async function tapAction(page, action) {
    const locator = byAction(page, action);
    await locator.waitFor({state: 'visible'});
    const box = await locator.boundingBox();
    if (!box) throw new Error(`Canvas proxy is not measurable: ${action}`);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * Map a point in the game's logical (world) space to page coordinates, using
 * the canvas's on-screen box. Test-side only: it lets specs aim real pointer
 * events at canvas positions that have no DOM proxy (e.g. grid cells). The
 * game itself never does this — it reads pointer.worldX/worldY.
 *
 * @param {{width: number, height: number}} gameSize - logical size, e.g. from sample(page)
 */
export async function worldToScreen(page, {x, y}, gameSize) {
    const box = await page.locator('canvas').boundingBox();
    if (!box) throw new Error('Canvas is not measurable');
    return {
        x: box.x + (x / gameSize.width) * box.width,
        y: box.y + (y / gameSize.height) * box.height,
    };
}

/** Real mouse click at a world-space point on the canvas. */
export async function clickWorld(page, point, gameSize) {
    const s = await worldToScreen(page, point, gameSize);
    await page.mouse.click(s.x, s.y);
}

/** Real touch tap at a world-space point on the canvas (requires hasTouch). */
export async function tapWorld(page, point, gameSize) {
    const s = await worldToScreen(page, point, gameSize);
    await page.touchscreen.tap(s.x, s.y);
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
 */
export async function boot(page, {path = '/', scene, waitForQA = false} = {}) {
    await page.goto(`${path}?testMode`);
    if (scene) {
        await expect(body(page)).toHaveAttribute('data-scene', scene, {timeout: 10_000});
    }
    if (waitForQA) {
        await page.waitForFunction(() => typeof window.__qa?.getState === 'function');
    }
}
