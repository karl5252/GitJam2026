import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
    HELI, HELI_ANIMS, HELI_SHEET, HeliVisit, blendPose, cameraTarget, flightPose, offscreenPoint, pickupPoint, rotorFrame,
} from '../../src/scenes/presidentialHeli.js';
import {Suspension, SuspendReason} from '../../src/scenes/suspension.js';
import {WorldCamera} from '../../src/scenes/WorldCamera.js';

/** TASK 035: the Day 1 Presidential helicopter, a presentation-only controller. */

const HQ = {x: 608, y: 328, width: 96, height: 96};
const VIEW = {x: 400, y: 200, width: 600, height: 340}; // the world rectangle the camera holds
const inside = ({x, y}, r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;

/** The whole sprite at its scale, from its skids. */
function spriteBox({x, y}) {
    const w = HELI_SHEET.frameWidth * HELI_SHEET.scale;
    const h = HELI_SHEET.frameHeight * HELI_SHEET.scale;
    return {x: x - w / 2, y: y - h * HELI_SHEET.originY, width: w, height: h};
}
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Run a visit to the end in fixed frames, recording each view. */
function fly(visit, frameMs = 16) {
    const views = [];
    for (let i = 0; i < 2000 && visit.active; i++) {
        visit.update(frameMs);
        views.push(visit.view());
    }
    return views;
}

test('the sheet is what heli.png really is: 8 frames of 45 x 55 in one row', () => {
    const png = readFileSync(new URL('../../public/assets/sprites/units/heli.png', import.meta.url));
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    assert.deepEqual([width, height], [360, 55]);
    assert.equal(width / HELI_SHEET.frameWidth, HELI_SHEET.frameCount);
    assert.equal(height, HELI_SHEET.frameHeight);
    assert.equal(HELI_SHEET.path, 'assets/sprites/units/heli.png');
    assert.ok(Number.isInteger(HELI_SHEET.scale), 'whole-number scale keeps the pixels square');
});

test('animation states: idle 0, startup 0-1, flying 2-7, all frames that exist', () => {
    assert.deepEqual([...HELI_ANIMS.idle.frames], [0]);
    assert.deepEqual([...HELI_ANIMS.startup.frames], [0, 1]);
    assert.deepEqual([...HELI_ANIMS.flying.frames], [2, 3, 4, 5, 6, 7]);
    for (const {frames} of Object.values(HELI_ANIMS)) {
        for (const f of frames) assert.ok(f >= 0 && f < HELI_SHEET.frameCount, `frame ${f} exists`);
    }
    const ms = HELI_ANIMS.flying.frameMs;
    assert.deepEqual([0, 1, 2, 5, 6, 7].map((i) => rotorFrame('flying', i * ms)), [2, 3, 4, 7, 2, 3], 'loops');
    assert.deepEqual([0, 1, 2].map((i) => rotorFrame('startup', i * HELI_ANIMS.startup.frameMs)), [0, 1, 0]);
    assert.equal(rotorFrame('idle', 123456), 0);
});

test('waiting does nothing; start happens once; off and skipped never fly', () => {
    const visit = new HeliVisit();
    assert.equal(visit.state, 'waiting');
    visit.update(500);
    assert.equal(visit.view().visible, false);
    assert.equal(visit.start(HQ, VIEW), true);
    assert.equal(visit.start(HQ, VIEW), false, 'only once');
    fly(visit);
    assert.equal(visit.state, 'done');
    assert.equal(visit.start(HQ, VIEW), false, 'never again this run');

    const off = new HeliVisit({enabled: false});
    assert.equal(off.state, 'off');
    assert.equal(off.start(HQ, VIEW), false);
    const skipped = new HeliVisit();
    skipped.skip();
    assert.equal(skipped.state, 'skipped');
    assert.equal(skipped.start(HQ, VIEW), false);
});

test('the flight: in from beyond the view, slowing to hover over the roof, a pickup, and away beyond the view', () => {
    const visit = new HeliVisit();
    visit.start(HQ, VIEW);
    const views = fly(visit);
    const states = [...new Set(views.map((v) => v.state))];
    assert.deepEqual(states, ['camera-in', 'approach', 'hover', 'depart', 'camera-out', 'done']);

    const flying = views.filter((v) => v.visible);
    assert.ok(flying.every((v) => v.anim === 'flying' && HELI_ANIMS.flying.frames.includes(v.frame)), 'the rotor never stops while airborne');
    assert.ok(!overlaps(spriteBox(flying[0]), VIEW), 'it enters from outside the view');
    assert.ok(!overlaps(spriteBox(flying.at(-1)), VIEW), 'and leaves it entirely');
    assert.ok(views.filter((v) => v.state === 'camera-in' || v.state === 'camera-out').every((v) => !v.visible), 'never seen while the camera moves');

    const pickup = pickupPoint(HQ);
    const hover = views.filter((v) => v.state === 'hover');
    assert.ok(hover.length > 0);
    assert.ok(hover.every((v) => v.ground.x === pickup.x && v.ground.y === pickup.y), 'hovers over HQ');
    assert.ok(inside(pickup, HQ), 'the pickup is over HQ’s footprint');
    assert.ok(hover.every((v) => v.altitude <= HELI.hoverAltitude && v.altitude >= HELI.hoverAltitude - HELI.dip));
    assert.equal(views.at(-1).collected, true);
    assert.equal(views.find((v) => v.state === 'approach').collected, false, 'not before the hover');

    // It slows into the hover: the last approach step is far shorter than the first.
    const approach = views.filter((v) => v.state === 'approach');
    const step = (a, b) => Math.hypot(b.ground.x - a.ground.x, b.ground.y - a.ground.y);
    assert.ok(step(approach.at(-2), approach.at(-1)) < step(approach[0], approach[1]) / 10);

    // Nose first both ways: the sheet faces left, and it flies leftwards, so never flipped.
    assert.ok(flying.every((v) => v.flip === false));
    const total = HELI.cameraMs * 2 + HELI.approachMs + HELI.hoverMs + HELI.departMs;
    assert.ok(total <= 9000, 'short');
});

test('camera: blends onto HQ and back to exactly where it was', () => {
    const visit = new HeliVisit();
    visit.start(HQ, VIEW);
    const views = fly(visit);
    const blends = views.map((v) => v.cameraBlend);
    assert.ok(blends.some((b) => b > 0 && b < 1));
    assert.equal(Math.max(...blends), 1);
    assert.equal(views.at(-1).cameraBlend, 0);
    const saved = {zoom: 1.1, x: 900, y: 500};
    const target = cameraTarget(saved, pickupPoint(HQ));
    assert.equal(target.zoom, HELI.cameraZoom.min, 'closer in only if need be');
    assert.equal(cameraTarget({...saved, zoom: 3.2}, HQ).zoom, HELI.cameraZoom.max);
    assert.deepEqual(blendPose(saved, target, 0), saved);
    assert.deepEqual(blendPose(saved, target, 1), target);
});

test('held: the flight stands still while something else holds it, the rotor does not', () => {
    const visit = new HeliVisit();
    visit.start(HQ, VIEW);
    while (visit.state !== 'hover') visit.update(16);
    const before = visit.view();
    const frames = new Set();
    for (let i = 0; i < 40; i++) {
        visit.update(0, 16); // the flight held, the rotor fed
        frames.add(visit.view().frame);
        assert.deepEqual([visit.view().state, visit.view().progress, visit.view().ground], [before.state, before.progress, before.ground]);
    }
    assert.ok(frames.size > 1, 'the rotor keeps turning');
});

test('deterministic, and never asks for random numbers', () => {
    const random = Math.random;
    Math.random = () => {
        throw new Error('Math.random must not be used');
    };
    try {
        const a = new HeliVisit();
        const b = new HeliVisit();
        a.start(HQ, VIEW);
        b.start(HQ, VIEW);
        assert.deepEqual(fly(a, 17), fly(b, 17));
    } finally {
        Math.random = random;
    }
});

test('timeScale (TEST_MODE) flies the same route faster; a long frame moves it no further than maxStepMs', () => {
    const fast = new HeliVisit({timeScale: 4});
    fast.start(HQ, VIEW);
    const slow = new HeliVisit();
    slow.start(HQ, VIEW);
    assert.ok(fly(fast).length < fly(slow).length / 3);
    assert.deepEqual(fast.view().route, slow.view().route);
    const jump = new HeliVisit();
    jump.start(HQ, VIEW);
    jump.update(60000);
    assert.equal(jump.state, 'camera-in', 'a tab coming back does not skip the cinematic');
});

test('offscreenPoint is beyond the view along its direction', () => {
    const p = offscreenPoint(pickupPoint(HQ), HELI.from, VIEW);
    assert.ok(!inside(p, VIEW));
    const leg = flightPose('approach', 0, {start: p, pickup: pickupPoint(HQ), end: p});
    assert.equal(leg.altitude, HELI.cruiseAltitude);
});

test('suspension knows the cinematic reason; it holds the world like any other', () => {
    assert.equal(SuspendReason.CINEMATIC, 'cinematic');
    const held = new Suspension();
    held.set(SuspendReason.CINEMATIC, true);
    held.set(SuspendReason.MANUAL, true);
    held.set(SuspendReason.CINEMATIC, false);
    assert.deepEqual(held.reasons(), ['manual'], 'releasing the cinematic never releases another reason');
});

test('WorldCamera: pose() then setPose() puts the view back exactly; framing keeps a pose in the world', () => {
    const camera = {setViewport() {}, setZoom() {}, centerOn() {}};
    const world = {x: 0, y: 0, width: 1600, height: 1100};
    const wc = new WorldCamera(camera, {viewport: {x: 0, y: 0, width: 1280, height: 720}, dayZoom: null}, world);
    wc.zoomIn({x: 300, y: 200});
    wc.panBy(37, -11);
    const saved = wc.pose();
    wc.setPose({zoom: 2, x: 5, y: 5});
    assert.notDeepEqual(wc.pose(), saved);
    wc.setPose(saved);
    assert.deepEqual(wc.pose(), saved);
    const {view, rect} = wc.framing({zoom: 2, x: 0, y: 0});
    assert.deepEqual([view.x, view.y], [320, 180], 'clamped into the world');
    assert.deepEqual(rect, {x: 0, y: 0, width: 640, height: 360});
});
