import test from 'node:test';
import assert from 'node:assert/strict';
import {clampView, fitView, fitZoom, inViewport, panBy, screenToWorld, worldToScreen, zoomAt} from '../../src/scenes/cameraView.js';
import {isPortraitBlocked} from '../../src/scenes/orientationGuard.js';

/**
 * The desktop world is 800x544 at 240,88, which is exactly its viewport, so the
 * fitted view must map every point to itself. That is what keeps desktop unchanged.
 */

const DESKTOP = {x: 240, y: 88, width: 800, height: 544};
const TOUCH = {x: 100, y: 62, width: 1080, height: 658};
const WORLD = {x: 240, y: 88, width: 800, height: 544};
const MAX = 3.2;

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
const samePoint = (a, b) => {
    close(a.x, b.x);
    close(a.y, b.y);
};

test('on desktop the fitted view is the plain screen: a world point keeps its pixel', () => {
    const view = fitView(DESKTOP, WORLD);
    assert.deepEqual(view, {zoom: 1, x: 640, y: 360});
    for (const point of [{x: 256, y: 104}, {x: 1023, y: 615}, {x: 640, y: 360}]) {
        assert.deepEqual(worldToScreen(view, DESKTOP, point), point);
        assert.deepEqual(screenToWorld(view, DESKTOP, point), point);
    }
});

test('on touch the fitted view fills the viewport, with the whole world inside it', () => {
    const view = fitView(TOUCH, WORLD);
    close(view.zoom, 658 / 544);
    for (const corner of [{x: WORLD.x, y: WORLD.y}, {x: WORLD.x + WORLD.width, y: WORLD.y + WORLD.height}]) {
        const screen = worldToScreen(view, TOUCH, corner);
        assert.ok(screen.x >= TOUCH.x - 1e-9 && screen.x <= TOUCH.x + TOUCH.width + 1e-9);
        assert.ok(screen.y >= TOUCH.y - 1e-9 && screen.y <= TOUCH.y + TOUCH.height + 1e-9);
    }
});

test('conversion is a round trip at any zoom and pan', () => {
    for (const viewport of [DESKTOP, TOUCH]) {
        for (const zoom of [1, 1.3, 2, 3.2]) {
            const view = clampView({zoom, x: 500, y: 300}, viewport, WORLD);
            for (const point of [{x: 300, y: 120}, {x: 701.5, y: 455.25}]) {
                samePoint(screenToWorld(view, viewport, worldToScreen(view, viewport, point)), point);
            }
        }
    }
});

test('zooming holds the point under the finger, away from the edges', () => {
    const start = {zoom: 2, x: 640, y: 360};
    const anchor = {x: 700, y: 400};
    const held = screenToWorld(start, DESKTOP, anchor);
    const zoomed = zoomAt(start, DESKTOP, WORLD, 1.25, anchor, MAX);
    assert.equal(zoomed.zoom, 2.5);
    samePoint(screenToWorld(zoomed, DESKTOP, anchor), held);
});

test('zoom stops at the fitted view and at the maximum', () => {
    const view = fitView(DESKTOP, WORLD);
    assert.equal(zoomAt(view, DESKTOP, WORLD, 0.5, {x: 640, y: 360}, MAX).zoom, 1);
    assert.equal(zoomAt({...view, zoom: 3}, DESKTOP, WORLD, 2, {x: 640, y: 360}, MAX).zoom, MAX);
});

test('zooming back out returns to the centre: the world is never lost off screen', () => {
    let view = zoomAt(fitView(DESKTOP, WORLD), DESKTOP, WORLD, 3, {x: 260, y: 100}, MAX);
    assert.notEqual(view.x, 640);
    view = zoomAt(view, DESKTOP, WORLD, 1 / 3, {x: 260, y: 100}, MAX);
    assert.deepEqual([view.x, view.y], [640, 360]);
});

test('a pan moves the world with the finger, and stops at its edges', () => {
    const view = {zoom: 2, x: 640, y: 360};
    assert.deepEqual(panBy(view, DESKTOP, WORLD, 100, -40), {zoom: 2, x: 590, y: 380});
    const far = panBy(view, DESKTOP, WORLD, 100_000, 100_000);
    assert.deepEqual([far.x, far.y], [WORLD.x + DESKTOP.width / 4, WORLD.y + DESKTOP.height / 4]);
    assert.deepEqual(panBy(fitView(DESKTOP, WORLD), DESKTOP, WORLD, 300, 300), fitView(DESKTOP, WORLD), 'nothing to pan at the fit');
});

test('a point is in the viewport from its top-left edge up to, not including, the far one', () => {
    assert.equal(inViewport(DESKTOP, {x: 240, y: 88}), true);
    assert.equal(inViewport(DESKTOP, {x: 1039.5, y: 631.5}), true);
    assert.equal(inViewport(DESKTOP, {x: 1040, y: 300}), false);
    assert.equal(inViewport(DESKTOP, {x: 239.5, y: 300}), false);
});

test('fit uses the tighter axis', () => {
    assert.equal(fitZoom({width: 1000, height: 100}, {width: 100, height: 100}), 1);
    assert.equal(fitZoom({width: 100, height: 1000}, {width: 100, height: 100}), 1);
});

test('only a touch device held upright is stopped', () => {
    assert.equal(isPortraitBlocked({coarsePointer: true, width: 390, height: 844}), true);
    assert.equal(isPortraitBlocked({coarsePointer: true, width: 844, height: 390}), false);
    assert.equal(isPortraitBlocked({coarsePointer: false, width: 400, height: 900}), false, 'a narrow desktop window plays on');
    assert.equal(isPortraitBlocked({coarsePointer: true, width: 500, height: 500}), false, 'a square is not portrait');
});
