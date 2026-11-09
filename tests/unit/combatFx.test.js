/**
 * TASK 031: combat effects. The sheets against their TXT metadata and the files,
 * the presets, the event mapping, and the Phaser layer against a fake scene.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {
    BODY_CENTRE_ABOVE, EXPLOSIONS, FX_CAPS, FX_SHEETS, IMPACTS, MERGE_RADIUS, bodyCentreAbove, destructionFor, explosionLayers, fxRandom, impactSparks, layerFrame, planEffects,
} from '../../src/scenes/combatFx.js';
import {CombatFxLayer} from '../../src/scenes/CombatFxLayer.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('each sheet matches its TXT metadata and its PNG: one horizontal strip, frames in order', () => {
    for (const sheet of Object.values(FX_SHEETS)) {
        const png = readFileSync(path.join(ROOT, 'public/assets/sprites', sheet.path));
        assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [sheet.frameWidth * sheet.frames, sheet.frameHeight], sheet.path);
        const lines = readFileSync(path.join(ROOT, 'art-src/sprites', sheet.path.replace('.png', '.txt')), 'utf8').trim().split(/\r?\n/);
        assert.equal(lines.length, sheet.frames, sheet.path);
        lines.forEach((line, i) => {
            const [, name, x, y, w, h] = line.match(/frame(\d+)\.png = (\d+) (\d+) (\d+) (\d+)/);
            assert.deepEqual([Number(name), Number(x), Number(y), Number(w), Number(h)], [i, i * sheet.frameWidth, 0, sheet.frameWidth, sheet.frameHeight]);
        });
    }
    assert.deepEqual(Object.values(FX_SHEETS).map(({frameWidth, frameHeight, frames}) => [frames, frameWidth, frameHeight]),
        [[14, 96, 96], [14, 128, 96], [15, 192, 192], [10, 32, 32]]);
});

test('presets: SMALL one layer, MEDIUM two 40-60 ms apart, BIG all three sheets 40-80 ms apart, at the target sizes', () => {
    assert.equal(EXPLOSIONS.small.layers.length, 1);
    assert.ok(EXPLOSIONS.small.layers[0].width >= 24 && EXPLOSIONS.small.layers[0].width <= 36);
    const [m1, m2] = EXPLOSIONS.medium.layers;
    assert.equal(EXPLOSIONS.medium.layers.length, 2);
    assert.ok(m2.delay * 1000 / 60 >= 40 && m2.delay * 1000 / 60 <= 60);
    assert.ok(Math.max(m1.width, m2.width) >= 48 && Math.max(m1.width, m2.width) <= 72);
    const big = EXPLOSIONS.big.layers;
    assert.deepEqual(new Set(big.map((l) => l.sheet)), new Set(['yellowA', 'orangeC', 'stylizedC']), 'all three explosion sheets');
    for (let i = 1; i < big.length; i++) {
        const gap = (big[i].delay - big[i - 1].delay) * 1000 / 60;
        assert.ok(gap >= 40 && gap <= 80, `gap ${gap} ms`);
    }
    assert.ok(Math.max(...big.map((l) => l.width)) >= 96 && Math.max(...big.map((l) => l.width)) <= 128);
    assert.equal(EXPLOSIONS.small.shake, null);
    assert.ok(EXPLOSIONS.big.shake.intensity <= 0.003);
    for (const [type, spec] of Object.entries({rifle: IMPACTS.rifle, autocannon: IMPACTS.autocannon})) {
        assert.ok(spec.lifeMs >= 80 && spec.lifeMs <= 150, `${type} ${spec.lifeMs} ms`);
    }
    assert.ok(IMPACTS.rifle.sparks[1] <= 2 && IMPACTS.autocannon.sparks[0] >= 2 && IMPACTS.autocannon.sparks[1] <= 4);
    // The Autocannon's hit is the stronger one, and neither is anywhere near an explosion's size.
    for (const key of ['core', 'glow', 'reach', 'lifeMs']) assert.ok(IMPACTS.autocannon[key] > IMPACTS.rifle[key], key);
    assert.ok(IMPACTS.autocannon.glow + 2 * IMPACTS.autocannon.reach < EXPLOSIONS.small.layers[0].width);
});

const VIEW = {
    isSeen: ({x}) => x < 500,
    turretAt: (id) => ({cannon: {x: 10, y: 10}}[id] ?? null),
    buildingAt: (id) => ({
        hq: {type: 'hq', x: 100, y: 100, width: 3, height: 96},
        siege: {type: 'siegeCannon', x: 200, y: 200, width: 2, height: 64},
        outpost: {type: 'outpost', x: 300, y: 300, width: 1, height: 32},
        wall: {type: 'wall', x: 400, y: 400, width: 1, height: 32},
        hidden: {type: 'factory', x: 900, y: 900, width: 3, height: 96},
    }[id] ?? null),
};

test('Rifle and Autocannon hits are impacts at their real positions, never explosions; explosives explode', () => {
    const plan = planEffects({
        defense: {shots: [{turretId: 'cannon', x: 40, y: 50}]},
        squads: {shots: [{fromX: 1, fromY: 2, x: 60, y: 70}, {rocket: true, fromX: 3, fromY: 4, x: 80, y: 90}], impacts: [{x: 80, y: 90}]},
        siege: {impacts: [{x: 150, y: 160}]},
    }, VIEW);
    assert.deepEqual(plan.impacts, [
        {type: 'autocannon', x: 40, y: 50, fromX: 10, fromY: 10},
        {type: 'rifle', x: 60, y: 70, fromX: 1, fromY: 2},
    ]);
    assert.deepEqual(plan.explosions, [{size: 'big', x: 150, y: 160}, {size: 'medium', x: 80, y: 90}]);
    const bullets = planEffects({defense: {shots: Array.from({length: 30}, () => ({turretId: 'cannon', x: 40, y: 50}))}}, VIEW);
    assert.equal(bullets.explosions.length, 0, 'sustained fire never explodes');
});

test('a hit sparks on the visible body: lifted from the feet by the measured art of its kind', async () => {
    const {ART} = await import('../../src/scenes/SpriteArt.js');
    for (const [kind, rows] of [['runner', [21, 37]], ['spitter', [20, 37]], ['brute', [12, 37]]]) {
        const {frameHeight, originY, scale} = ART[kind];
        const expected = Math.round((frameHeight * originY - (rows[0] + rows[1] + 1) / 2) * scale); // anchor px minus body middle
        assert.equal(BODY_CENTRE_ABOVE[kind], expected, kind);
    }
    const view = {...VIEW, bodyAbove: (id) => bodyCentreAbove({m1: 'runner', m2: 'brute'}[id])};
    const plan = planEffects({
        defense: {shots: [{turretId: 'cannon', mutantId: 'm2', x: 40, y: 50}]},
        squads: {shots: [{mutantId: 'm1', fromX: 1, fromY: 2, x: 60, y: 70}]},
    }, view);
    assert.deepEqual(plan.impacts.map(({x, y}) => [x, y]), [[40, 50 - 12], [60, 70 - 7]]);
    assert.equal(bodyCentreAbove(undefined), BODY_CENTRE_ABOVE.runner, 'unknown: a runner');
});

test('destruction by footprint: 3 wide is BIG, 2 MEDIUM, 1 SMALL, walls and gates debris, from the lower half', () => {
    assert.deepEqual(destructionFor('wall', {width: 1}), {kind: 'debris'});
    assert.deepEqual(destructionFor('gateVertical', {width: 1}), {kind: 'debris'});
    const plan = planEffects({effects: {destroyed: ['hq', 'siege', 'outpost', 'wall', 'hidden']}}, VIEW);
    assert.deepEqual(plan.explosions, [
        {size: 'big', x: 100, y: 100 + 96 * 0.2},
        {size: 'medium', x: 200, y: 200 + 64 * 0.2},
        {size: 'small', x: 300, y: 300 + 32 * 0.2},
    ]);
    assert.deepEqual(plan.impacts.map(({type}) => type), ['debris'], 'and nothing for the Factory the fog hides');
});

test('one event never makes two large explosions: on one tick and spot the largest stays', () => {
    const plan = planEffects({
        siege: {impacts: [{x: 100, y: 100}]},
        squads: {impacts: [{x: 100 + MERGE_RADIUS - 1, y: 100}]},
        effects: {destroyed: ['hq']},
    }, VIEW);
    assert.deepEqual(plan.explosions.map((e) => e.size), ['big'], 'the HQ blast and the rocket fold into the shell\'s');
    const apart = planEffects({siege: {impacts: [{x: 100, y: 100}, {x: 100 + MERGE_RADIUS + 1, y: 100}]}}, VIEW);
    assert.equal(apart.explosions.length, 2);
});

test('the fog hides effects: nothing where the player cannot see', () => {
    const plan = planEffects({
        defense: {shots: [{turretId: 'cannon', x: 600, y: 0}]},
        squads: {shots: [{fromX: 0, fromY: 0, x: 700, y: 0}], impacts: [{x: 800, y: 0}]},
        siege: {impacts: [{x: 900, y: 0}]},
    }, VIEW);
    assert.deepEqual(plan, {impacts: [], explosions: [], splatters: []});
});

test('sparks scatter back towards the shooter; layers vary only cosmetically, from their own generator', () => {
    const random = fxRandom(1);
    const sparks = impactSparks('autocannon', {x: 100, y: 100, fromX: 0, fromY: 100}, random);
    assert.ok(sparks.length >= 2 && sparks.length <= 4);
    for (const s of sparks) assert.ok(s.dx < 0, 'thrown back towards the shooter');
    const layers = explosionLayers('big', {x: 50, y: 60}, fxRandom(2));
    for (const layer of layers) {
        assert.ok(Math.abs(layer.x - 50) <= 3 && Math.abs(layer.y - 60) <= 8);
    }
    assert.deepEqual(explosionLayers('big', {x: 50, y: 60}, fxRandom(2)), layers, 'the same seed, the same look');
});

test('a layer plays its frames at its rate, waits before its delay, and ends', () => {
    const layer = {sheet: 'yellowA', fps: 20};
    assert.equal(layerFrame(layer, -1), -1);
    assert.equal(layerFrame(layer, 0), 0);
    assert.equal(layerFrame(layer, 3), 1);
    assert.equal(layerFrame(layer, 41), 13);
    assert.equal(layerFrame(layer, 42), null);
});

// ---- The layer, against a fake Phaser scene -----------------------------------------

function fakeScene() {
    const objects = [];
    const made = (o) => {
        objects.push(o);
        return o;
    };
    const chain = (o) => new Proxy(o, {
        get(target, prop) {
            if (prop in target) return target[prop];
            return () => target.proxy;
        },
    });
    const sprite = () => {
        const s = {visible: false, destroyed: false, frame: {name: 0}, displayWidth: 0};
        s.proxy = chain(s);
        Object.assign(s, {
            setVisible(v) { s.visible = v; return s.proxy; },
            setFrame(f) { s.frame = {name: f}; return s.proxy; },
            destroy() { s.destroyed = true; },
        });
        return made(s.proxy);
    };
    const graphics = () => {
        const g = {calls: 0, destroyed: false};
        g.proxy = chain(g);
        Object.assign(g, {clear() { g.calls = 0; return g.proxy; }, fillRect() { g.calls++; return g.proxy; }, destroy() { g.destroyed = true; }});
        return made(g.proxy);
    };
    let shakes = 0;
    return {
        objects,
        shakes: () => shakes,
        add: {sprite, graphics},
        textures: {exists: () => true},
        time: {now: 0},
        cameras: {main: {worldView: {contains: () => true}, shake: () => { shakes++; }}},
    };
}

test('the layer: effects end by themselves, caps hold, sprites are pooled, clear() and destroy() leave nothing', () => {
    const scene = fakeScene();
    const fx = new CombatFxLayer(scene);
    fx.spawn({impacts: [{type: 'autocannon', x: 1, y: 1, fromX: 0, fromY: 0}], explosions: [{size: 'big', x: 10, y: 10}]}, 0);
    fx.sync(1, 16, true);
    assert.equal(fx.view().impacts.length, 1);
    const [big] = fx.view().explosions;
    assert.deepEqual(big.layers.map((l) => l.visible), [true, false, false], 'later layers wait for their delay');
    fx.sync(20, 200, true);
    assert.deepEqual(fx.view().explosions[0].layers.map((l) => l.visible), [true, true, true]);
    for (let i = 0; i < 5; i++) fx.sync(20, 50, true);
    assert.equal(fx.view().impacts.length, 0, 'the impact is long gone');
    fx.sync(200);
    assert.deepEqual(fx.view().explosions, [], 'every layer ended');
    assert.equal(fx.view().pooled, 3, 'and its sprites wait to be reused');
    const sprites = scene.objects.length;
    fx.spawn({impacts: [], explosions: [{size: 'big', x: 0, y: 0}]}, 300);
    fx.sync(320);
    assert.equal(scene.objects.length, sprites, 'reused, not made again');

    for (let i = 0; i < 100; i++) fx.spawn({impacts: [{type: 'rifle', x: i, y: 0, fromX: 0, fromY: 0}], explosions: [{size: 'small', x: i * 100, y: 0}]}, 400);
    assert.equal(fx.view().impacts.length, FX_CAPS.impacts);
    assert.equal(fx.view().explosions.length, FX_CAPS.explosions);
    fx.clear();
    assert.deepEqual([fx.view().impacts, fx.view().explosions], [[], []]);
    fx.destroy();
    assert.ok(scene.objects.every((o) => o.destroyed), 'nothing is left behind');
});

test('paused, nothing moves: explosions follow the tick, and impacts age only while the world runs', () => {
    const fx = new CombatFxLayer(fakeScene());
    fx.spawn({impacts: [{type: 'rifle', x: 0, y: 0, fromX: -10, fromY: 0}], explosions: [{size: 'medium', x: 0, y: 0}]}, 100);
    fx.sync(105, 16, true);
    const frozen = JSON.stringify(fx.view());
    for (let i = 0; i < 50; i++) fx.sync(105, 16, false); // frames go by; the world is paused
    assert.equal(JSON.stringify(fx.view()), frozen);
});

test('a spark lasts the same real time at 1x, 2x and 4x: speed cannot make it vanish', () => {
    for (const ticksPerFrame of [1, 2, 4]) {
        const fx = new CombatFxLayer(fakeScene());
        fx.spawn({impacts: [{type: 'autocannon', x: 0, y: 0, fromX: -10, fromY: 0}], explosions: []}, 0);
        let frames = 0;
        for (let tick = 0; fx.view().impacts.length > 0; tick += ticksPerFrame) {
            fx.sync(tick, 1000 / 60, true);
            frames++;
        }
        assert.equal(frames, Math.floor(IMPACTS.autocannon.lifeMs / (1000 / 60)) + 1, `${ticksPerFrame}x`);
    }
});

test('a big explosion shakes the camera briefly, never twice in quick succession; small and medium never', () => {
    const scene = fakeScene();
    const fx = new CombatFxLayer(scene);
    fx.spawn({impacts: [], explosions: [{size: 'small', x: 0, y: 0}, {size: 'medium', x: 100, y: 0}]}, 0);
    assert.equal(scene.shakes(), 0);
    fx.spawn({impacts: [], explosions: [{size: 'big', x: 0, y: 0}, {size: 'big', x: 300, y: 0}]}, 1);
    assert.equal(scene.shakes(), 1);
    scene.time.now = 1000;
    fx.spawn({impacts: [], explosions: [{size: 'big', x: 0, y: 0}]}, 2);
    assert.equal(scene.shakes(), 2);
});

test('effects only listen: a Night replays identically whether every tick is planned into effects or not', async () => {
    const {createWorld, digestOf, worldState} = await import('../soak/harness.js');
    const night = (withFx) => {
        const w = createWorld({schedule: [600, 700, 800, 900, 1000, 1100]});
        w.place('powerPlant', 3, 3);
        w.place('autocannon', 11, 7);
        w.place('siegeCannon', 13, 9);
        const fx = withFx ? new CombatFxLayer(fakeScene()) : null;
        w.cycle.endDay();
        for (let i = 0; i < 3600; i++) {
            w.cycle.stepTicks(1, (t) => {
                const r = w.tick(t);
                if (fx) {
                    fx.spawn(planEffects({defense: r.defense, siege: r.siege, squads: {shots: r.infantryShots}, effects: r.effects}, {
                        isSeen: () => true, turretAt: () => ({x: 0, y: 0}), buildingAt: () => ({type: 'outpost', x: 0, y: 0, width: 1, height: 32}),
                    }), t);
                    fx.sync(t);
                }
            });
        }
        return digestOf(JSON.stringify(worldState(w)));
    };
    assert.equal(night(true), night(false));
});

// ---- Spitter acid splatter --------------------------------------------------------------

test('a Spitter shell splashes acid where it actually lands, hit or miss; never as an explosion, never merged', () => {
    const plan = planEffects({
        effects: {impacts: [{x: 120, y: 130, buildingId: 'hq-1', soldierId: null}, {x: 140, y: 150, buildingId: null, soldierId: null}, {x: 700, y: 0}]},
        siege: {impacts: [{x: 120, y: 130}]}, // a big explosion on the very same spot
    }, VIEW);
    assert.deepEqual(plan.splatters, [{size: 'acid', x: 120, y: 130}, {size: 'acid', x: 140, y: 150}], 'the hidden one at x 700 is not shown');
    assert.deepEqual(plan.explosions, [{size: 'big', x: 120, y: 130}], 'the acid neither merges into it nor removes it');
    assert.deepEqual(planEffects({defense: {shots: [{turretId: 'cannon', x: 40, y: 50}]}}, VIEW).splatters, [], 'only Spitter shells splatter');
});

test('the splatter: one layer, native 32x32 on the landing point, anchored at its centre, 18 fps once, no shake', () => {
    assert.deepEqual(EXPLOSIONS.acid.layers.map(({sheet, fps, width}) => ({sheet, fps, width})), [{sheet: 'splatterViolet', fps: 18, width: 32}]);
    assert.equal(EXPLOSIONS.acid.shake, null);
    assert.equal(FX_SHEETS.splatterViolet.originY, 0.5);
    for (let seed = 1; seed < 20; seed++) {
        const [layer] = explosionLayers('acid', {x: 50, y: 60}, fxRandom(seed));
        assert.deepEqual([layer.x, layer.y, layer.scale], [50, 60, 1], 'exactly native, exactly there');
    }
    const [layer] = explosionLayers('acid', {x: 0, y: 0}, fxRandom(3));
    assert.equal(layerFrame(layer, 0), 0);
    assert.equal(layerFrame(layer, 33), 9, 'the last of its ten frames');
    assert.equal(layerFrame(layer, 34), null, 'then it is over: no loop');
});

test('the splatter plays through, ends by itself, returns its sprite to the pool, and clears at Game Over', () => {
    const scene = fakeScene();
    const fx = new CombatFxLayer(scene);
    fx.spawn({impacts: [], explosions: [], splatters: [{size: 'acid', x: 10, y: 20}]}, 0);
    fx.sync(1, 16, true);
    const [acid] = fx.view().explosions;
    assert.deepEqual({size: acid.size, sheet: acid.layers[0].sheet, visible: acid.layers[0].visible}, {size: 'acid', sheet: 'splatterViolet', visible: true});
    assert.equal(scene.shakes(), 0);
    fx.sync(40, 16, true);
    assert.deepEqual(fx.view().explosions, [], 'once through, then gone');
    assert.equal(fx.view().pooled, 1);
    assert.equal(fx.view().totals.explosions.acid, 1);
    fx.spawn({impacts: [], explosions: [], splatters: [{size: 'acid', x: 0, y: 0}]}, 50);
    fx.sync(51, 16, true);
    fx.clear();
    assert.deepEqual(fx.view().explosions, []);
    fx.destroy();
    assert.ok(scene.objects.every((o) => o.destroyed));
});

test('only the PNG sheets ship: their TXT metadata lives in art-src/, outside public/', () => {
    const shipped = readdirSync(path.join(ROOT, 'public/assets/sprites/effects')).sort();
    assert.deepEqual(shipped, Object.values(FX_SHEETS).map((s) => s.path.split('/').pop()).sort());
    for (const sheet of Object.values(FX_SHEETS)) assert.ok(existsSync(path.join(ROOT, 'art-src/sprites', sheet.path.replace('.png', '.txt'))));
});
