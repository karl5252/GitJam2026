import test from 'node:test';
import assert from 'node:assert/strict';
import {ART} from '../../src/scenes/SpriteArt.js';
import {BuildingArtLayer} from '../../src/scenes/BuildingArtLayer.js';
import {BuildingDamageLayer, buildingFxKey, preloadBuildingDamageFx} from '../../src/scenes/BuildingDamageLayer.js';

function fakeScene() {
    const objects = [];
    const loads = [];
    const view = (key, frame = 0) => {
        const obj = {
            texture: {key}, frame: {name: String(frame)}, x: 0, y: 0, displayWidth: 16, displayHeight: 16, originY: 0.5,
            depth: 0, alpha: 1, destroyed: false,
            setOrigin(_x, y) { this.originY = y; return this; },
            setScale(scale) { const k = Object.keys(ART).find((a) => `papi-art-${a}` === this.texture.key); const a = ART[k]; this.displayWidth = (a?.frameWidth ?? 16) * scale; this.displayHeight = (a?.frameHeight ?? 16) * scale; return this; },
            setDepth(depth) { this.depth = depth; return this; },
            setPosition(x, y) { this.x = x; this.y = y; return this; },
            setFrame(frame) { this.frame = {name: String(frame)}; return this; },
            setTexture(key, frame) { this.texture = {key}; this.frame = {name: String(frame)}; return this; },
            setAlpha(alpha) { this.alpha = alpha; return this; },
            destroy() { this.destroyed = true; },
        };
        objects.push(obj);
        return obj;
    };
    return {
        objects, loads,
        textures: {exists: () => true},
        load: {spritesheet: (...args) => loads.push(args)},
        add: {sprite: (_x, _y, key, frame) => view(key, frame), rectangle: (_x, _y, _w, _h) => view('bulb')},
    };
}
const grid = {footprintRect: ({col, row, width, height}) => ({x: col * 32, y: row * 32, width: width * 32, height: height * 32})};
const building = (type, hp, extra = {}) => ({id: `${type}-1`, type, col: 3, row: 4, width: 3, height: 3, hp, enabled: true, ...extra});

test('refitting Barracks changes the texture while HP changes the frame, without replacing the gameplay building', () => {
    const scene = fakeScene();
    const art = new BuildingArtLayer(scene, grid);
    const rifle = building('barracks', 300, {role: 'rifle'});
    assert.equal(art.add(rifle), true);
    assert.deepEqual(art.views().map(({id, kind, frame}) => ({id, kind, frame})), [{id: rifle.id, kind: 'barracks', frame: 0}]);
    art.sync([{...rifle, role: 'rocket', hp: 180}], 'night');
    assert.deepEqual(art.views().map(({kind, frame}) => ({kind, frame})), [{kind: 'barracksRocket', frame: 1}]);
    art.syncDamage([{...rifle, role: 'rocket', hp: 45}], 'night');
    assert.equal(art.views()[0].frame, 2);
    art.syncDamage([{...rifle, role: 'rocket', hp: 300}], 'night');
    assert.equal(art.views()[0].frame, 0, 'repair heals the sprite');
    art.sync([{...rifle, hp: 300, role: 'rifle'}], 'day');
    assert.equal(art.views()[0].kind, 'barracks', 'refit back to rifle');
});

test('damaged factory runs yellow sparks, gains fire on critical, and releases all effects on repair', () => {
    const scene = fakeScene();
    const effects = new BuildingDamageLayer(scene, grid);
    const factory = building('factory', 300);
    effects.sync([factory], new Set(), 10);
    assert.deepEqual(effects.views(), []);
    effects.sync([{...factory, hp: 150}], new Set(), 10);
    assert.deepEqual(effects.views()[0].effects.map((e) => e.kind), ['weldingSparks']);
    const firstFrame = effects.views()[0].effects[0].frame;
    effects.sync([{...factory, hp: 150}], new Set(), 10);
    assert.equal(effects.views()[0].effects[0].frame, firstFrame, 'paused simulation freezes FX');
    effects.sync([{...factory, hp: 70}], new Set(), 100);
    assert.deepEqual(effects.views()[0].effects.map((e) => e.kind), ['weldingSparks', 'fire']);
    effects.sync([factory], new Set(), 120);
    assert.deepEqual(effects.views(), [], 'repair removes looping FX immediately');
    assert.ok(scene.objects.filter((o) => o.texture.key.startsWith('papi-building-fx-')).every((o) => o.destroyed));
});

test('loudspeaker status lamp follows ON, power and damage; nothing survives destruction', () => {
    const scene = fakeScene();
    const effects = new BuildingDamageLayer(scene, grid);
    const tower = building('loudspeaker', 100, {width: 1, height: 1});
    effects.sync([tower], new Set([tower.id]), 1);
    assert.equal(effects.views()[0].lamp, true);
    effects.sync([tower], new Set(), 1);
    assert.equal(effects.views().length, 0, 'blackout');
    effects.sync([{...tower, enabled: false}], new Set([tower.id]), 1);
    assert.equal(effects.views().length, 0, 'OFF');
    effects.sync([{...tower, hp: 40}], new Set([tower.id]), 1);
    assert.equal(effects.views()[0].lamp, false, 'broken bulb');
    assert.deepEqual(effects.views()[0].effects.map((e) => e.kind), ['weldingSparks']);
    effects.remove(tower.id);
    assert.equal(effects.views().length, 0);
    assert.ok(scene.objects.every((o) => o.destroyed));
});

test('loader asks for three 8-frame effects with native sizes', () => {
    const scene = fakeScene();
    preloadBuildingDamageFx(scene);
    assert.deepEqual(scene.loads.map(([key, path, {frameWidth, frameHeight}]) => ({key, path, frameWidth, frameHeight})), [
        {key: buildingFxKey('weldingSparks'), path: 'assets/sprites/effects/welding-sparks.png', frameWidth: 16, frameHeight: 16},
        {key: buildingFxKey('electricSparks'), path: 'assets/sprites/effects/electric-sparks.png', frameWidth: 16, frameHeight: 18},
        {key: buildingFxKey('fire'), path: 'assets/sprites/effects/fire.png', frameWidth: 16, frameHeight: 16},
    ]);
});
