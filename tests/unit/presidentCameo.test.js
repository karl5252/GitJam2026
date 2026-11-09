import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ART} from '../../src/scenes/SpriteArt.js';
import {CAMEO, PRESIDENT_FRAMES, PresidentCameo, doorOf, keepOut, retreatRoute} from '../../src/scenes/presidentCameo.js';

/** TASK 033.2: El Presidente's Day 0 cameo, a presentation-only controller. */

const CENTRE = {x: 640, y: 360};
const HQ = {x: 608, y: 328, width: 96, height: 96}; // a 3x3 footprint over the centre
const inside = ({x, y}, r, m = 0) => x > r.x - m && x < r.x + r.width + m && y > r.y - m && y < r.y + r.height + m;
const day0 = (hq = null) => ({phase: 'deployment', centre: CENTRE, hq});

function run(cameo, ms, world, step = 16) {
    const seen = [];
    for (let t = 0; t < ms; t += step) {
        cameo.update(step, world);
        seen.push(cameo.view());
    }
    return seen;
}

test('his own sheet: units/elcolonel.png, 45x40 frames like the worker\'s; idle 0-1, walk 4-5, salute 8-11', () => {
    assert.deepEqual(ART.elcolonel, {path: 'units/elcolonel.png', frameWidth: 45, frameHeight: 40, scale: 0.5, offsetX: 0, originY: 0.95});
    const png = readFileSync(new URL('../../public/assets/sprites/units/elcolonel.png', import.meta.url));
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [180, 160], '4 x 4 frames of 45 x 40');
    assert.deepEqual(PRESIDENT_FRAMES, {idle: [0, 1], walk: [4, 5], salute: [8, 9, 10, 11]});
});

test('Day 0: he appears at the clearing\'s centre and wanders, pausing, never further than his radius', () => {
    const cameo = new PresidentCameo();
    assert.equal(cameo.view().visible, false, 'nobody before Day 0');
    const seen = run(cameo, 60000, day0());
    assert.equal(seen[0].state, 'wander');
    assert.equal(seen[0].visible, true);
    const kinds = new Set(seen.map((v) => v.activity));
    assert.ok(kinds.has('idle') && kinds.has('walk') && kinds.has('salute'), [...kinds].join());
    const frames = new Set(seen.map((v) => v.frame));
    for (const f of [0, 1, 4, 5, 8, 9, 10, 11]) assert.ok(frames.has(f), `frame ${f} shows`);
    assert.ok(seen.every((v) => Math.hypot(v.x - CENTRE.x, v.y - CENTRE.y) <= CAMEO.radius + 0.5), 'within his radius');
    assert.ok(seen.some((v) => v.x !== CENTRE.x || v.y !== CENTRE.y), 'he moves');
});

test('HQ built on top of him: he steps out of the door and saluting, then keeps off its footprint', () => {
    const cameo = new PresidentCameo();
    cameo.update(16, day0());
    assert.ok(inside(cameo.view(), HQ), 'he stands where HQ goes');
    cameo.update(16, day0(HQ));
    const out = cameo.view();
    assert.equal(inside(out, keepOut(HQ)), false, 'clear of HQ, head and all');
    assert.equal(out.activity, 'salute');
    const seen = run(cameo, 90000, day0(HQ));
    assert.ok(seen.every((v) => !inside(v, keepOut(HQ))), 'never on HQ, head and all');
    assert.ok(seen.every((v) => !inside({x: v.x, y: v.y - CAMEO.body}, HQ)), 'his head never over the footprint');
    const door = doorOf(HQ);
    assert.ok(seen.every((v) => Math.hypot(v.x - door.x, v.y - (door.y + CAMEO.body + CAMEO.radius / 2)) <= CAMEO.radius + 0.5), 'near HQ');
});

test('nothing moves on zero time: a held world holds him too', () => {
    const cameo = new PresidentCameo();
    run(cameo, 5000, day0());
    const before = cameo.view();
    for (let i = 0; i < 200; i++) cameo.update(0, day0());
    assert.deepEqual(cameo.view(), before);
});

test('Dusk: he turns to HQ at once, runs round it to the door, far faster than he walks, with dust, and is gone', () => {
    const cameo = new PresidentCameo();
    cameo.update(16, day0());
    cameo.update(16, day0(HQ)); // out of the door
    run(cameo, 4000, day0(HQ));
    const before = cameo.view();
    cameo.update(16, {phase: 'dusk', centre: CENTRE, hq: HQ});
    const turned = cameo.view();
    assert.equal(turned.state, 'retreat', 'the first Dusk frame');
    assert.equal(turned.flip, doorOf(HQ).x < before.x, 'facing HQ');
    assert.deepEqual(turned.route.at(-1), doorOf(HQ));
    const seen = run(cameo, 5000, {phase: 'dusk', centre: CENTRE, hq: HQ});
    const gone = seen.findIndex((v) => v.state === 'gone');
    assert.ok(gone > 0, 'gone within Dusk');
    assert.ok(seen.slice(0, gone).every((v) => !inside(v, HQ, 0)), 'never across the footprint');
    assert.ok(seen.slice(0, gone).some((v) => v.dust.length > 0), 'dust');
    assert.equal(seen[gone].visible, false);
    assert.ok(seen.at(-1).dust.length === 0 && cameo.finished, 'the dust settles');
});

test('the retreat route goes round HQ from any side and ends at its door', () => {
    for (const from of [{x: 650, y: 300}, {x: 560, y: 360}, {x: 760, y: 340}, {x: 650, y: 480}, {x: 600, y: 300}]) {
        const route = retreatRoute(from, HQ);
        assert.deepEqual(route.at(-1), doorOf(HQ));
        let at = from;
        for (const point of route.slice(0, -1)) {
            for (let i = 0; i <= 20; i++) {
                const p = {x: at.x + (point.x - at.x) * i / 20, y: at.y + (point.y - at.y) * i / 20};
                assert.equal(inside(p, HQ), false, `from ${JSON.stringify(from)} through ${JSON.stringify(p)}`);
            }
            at = point;
        }
    }
});

test('Night, or Dusk ending first, hides him at once; he never comes back that run', () => {
    const cameo = new PresidentCameo();
    run(cameo, 2000, day0(HQ));
    cameo.update(16, {phase: 'dusk', centre: CENTRE, hq: HQ});
    assert.equal(cameo.view().state, 'retreat');
    cameo.update(16, {phase: 'other', centre: CENTRE, hq: HQ}); // END DAY's Dusk ran out mid-run
    assert.deepEqual([cameo.view().state, cameo.view().visible, cameo.view().dust.length], ['gone', false, 0]);
    assert.equal(cameo.finished, true);
    run(cameo, 2000, day0(HQ));
    assert.equal(cameo.view().visible, false);
});

test('no Day 0 (the LEGACY cycle, or a run already past it): he never appears', () => {
    const cameo = new PresidentCameo();
    run(cameo, 2000, {phase: 'other', centre: CENTRE, hq: null});
    run(cameo, 2000, {phase: 'dusk', centre: CENTRE, hq: HQ});
    assert.equal(cameo.view().visible, false);
});

test('deterministic and his own: the same frames give the same walk, and Math.random is never asked', () => {
    const real = Math.random;
    Math.random = () => {
        throw new Error('Math.random asked');
    };
    try {
        const a = run(new PresidentCameo(), 20000, day0(HQ), 17);
        const b = run(new PresidentCameo(), 20000, day0(HQ), 17);
        assert.deepEqual(a, b);
    } finally {
        Math.random = real;
    }
});
