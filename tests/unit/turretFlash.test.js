import test from 'node:test';
import assert from 'node:assert/strict';
import {AutocannonLayer} from '../../src/scenes/AutocannonLayer.js';
import {SiegeLayer} from '../../src/scenes/SiegeLayer.js';
import {ART, artKey} from '../../src/scenes/SpriteArt.js';
import {TURRET_FLASH, turretFlashFrame} from '../../src/scenes/TurretFlash.js';

const DIRECTIONS = [
    -Math.PI / 2, -Math.PI / 4, 0, Math.PI / 4,
    Math.PI / 2, 3 * Math.PI / 4, Math.PI, -3 * Math.PI / 4,
];

function mockView(kind) {
    return {
        kind, x: 0, y: 0, width: 0, height: 0, visible: true, alpha: 1, frame: 0, destroyed: false,
        setOrigin() { return this; },
        setDepth() { return this; },
        setPosition(x, y) { this.x = x; this.y = y; return this; },
        setSize(width, height) { this.width = width; this.height = height; return this; },
        setRotation(angle) { this.rotation = angle; return this; },
        setAlpha(alpha) { this.alpha = alpha; return this; },
        setScale(scale) { this.scale = scale; return this; },
        setFrame(frame) { this.frame = frame; return this; },
        setVisible(visible) { this.visible = visible; return this; },
        destroy() { this.destroyed = true; },
    };
}

function fixture(type, knownTextures = null) {
    const buildings = [{id: 'gun1', type, col: 2, row: 3, width: type === 'siegeCannon' ? 2 : 1, height: type === 'siegeCannon' ? 2 : 1, enabled: true}];
    const created = [];
    const factory = (kind) => (...args) => {
        const view = mockView(kind);
        if (kind === 'sprite') view.texture = args[2];
        if (kind === 'rectangle') view.setPosition(args[0], args[1]).setSize(args[2], args[3]);
        created.push(view);
        return view;
    };
    const scene = {
        placement: {buildings: () => buildings},
        textures: {exists: (key) => knownTextures === null || knownTextures.has(key)},
        add: {sprite: factory('sprite'), rectangle: factory('rectangle'), circle: factory('circle')},
    };
    const grid = {
        footprintRect: (building) => ({x: building.col * 32, y: building.row * 32, width: building.width * 32, height: building.height * 32}),
    };
    return {scene, grid, buildings, created, flash: () => created.find(({texture}) => texture === artKey(type + 'Flash'))};
}

test('both flash sheets have exactly 8x4 frames, independent of turret image dimensions', () => {
    for (const type of ['autocannonFlash', 'siegeCannonFlash']) {
        assert.deepEqual([ART[type].frameWidth, ART[type].frameHeight, ART[type].scale, ART[type].originY], [64, 64, 1, 0.5]);
    }
    assert.deepEqual([ART.autocannon.frameWidth, ART.autocannon.frameHeight], [32, 32]);
    assert.deepEqual([ART.siegeCannon.frameWidth, ART.siegeCannon.frameHeight, ART.siegeCannon.scale], [32, 35, 2]);
    assert.equal(TURRET_FLASH.autocannon.frameTicks, 3);
    assert.equal(TURRET_FLASH.siegeCannon.frameTicks, 6);
});

test('8 directional rows are used without rotation of pixel art', () => {
    for (const [row, angle] of DIRECTIONS.entries()) {
        assert.equal(turretFlashFrame(angle, 200, 200, TURRET_FLASH.autocannon), 4 * row);
        assert.equal(turretFlashFrame(angle, 200, 203, TURRET_FLASH.autocannon), 4 * row + 1);
        assert.equal(turretFlashFrame(angle, 200, 223, TURRET_FLASH.siegeCannon), 4 * row + 3);
    }
});

test('autocannon flash plays 4 frames in 12 ticks and never freezes on the last frame', () => {
    const f = (tick) => turretFlashFrame(0, 100, tick, TURRET_FLASH.autocannon);
    assert.deepEqual([99, 100, 102, 103, 105, 106, 108, 109, 111, 112, 113].map(f),
        [null, 8, 8, 9, 9, 10, 10, 11, 11, null, null]);
    assert.equal(turretFlashFrame(0, null, 100, TURRET_FLASH.autocannon), null);
});

test('siege flash runs for 24 ticks, not its 300-tick reload', () => {
    const f = (tick) => turretFlashFrame(-Math.PI / 2, 100, tick, TURRET_FLASH.siegeCannon);
    assert.deepEqual([100, 105, 106, 111, 112, 117, 118, 123, 124, 399].map(f),
        [0, 0, 1, 1, 2, 2, 3, 3, null, null]);
});

test('autocannon flash follows an actual shot, stops and destroys with its gun', () => {
    const f = fixture('autocannon');
    const layer = new AutocannonLayer(f.scene, f.grid);
    layer.recordShots([{turretId: 'gun1', x: 180, y: 112}], 100); // gun center 80,112 => east
    const flash = f.flash();
    assert.ok(flash);
    assert.deepEqual([flash.x, flash.y], [80, 112]);
    layer.sync({cannons: [{id: 'gun1', targetId: null}], mutants: [], buildings: f.buildings, tick: 100, isNight: true});
    assert.equal(flash.visible, true);
    assert.equal(flash.frame, 8);
    layer.sync({cannons: [{id: 'gun1', targetId: null}], mutants: [], buildings: f.buildings, tick: 111, isNight: true});
    assert.equal(flash.frame, 11);
    layer.sync({cannons: [{id: 'gun1', targetId: null}], mutants: [], buildings: f.buildings, tick: 112, isNight: true});
    assert.equal(flash.visible, false);
    layer.remove('gun1');
    assert.equal(flash.destroyed, true);
});

test('siege flash is replayed once per shot, not during cooldown, and removed on demolition', () => {
    const f = fixture('siegeCannon');
    const layer = new SiegeLayer(f.scene, f.grid);
    layer.recordFired([{gunId: 'gun1', x: 196, y: 128}], f.buildings, 100); // center 96,128 => east
    const flash = f.flash();
    assert.ok(flash);
    assert.deepEqual([flash.x, flash.y], [96, 128]);
    const sync = (tick) => layer.sync({guns: [{id: 'gun1', cooldown: 300 - (tick - 100)}], shells: [], buildings: f.buildings, reloadTicks: 300, tick, isNight: true});
    sync(100);
    assert.equal(flash.visible, true);
    assert.equal(flash.frame, 8);
    sync(123);
    assert.equal(flash.visible, true);
    assert.equal(flash.frame, 11);
    sync(124);
    assert.equal(flash.visible, false);
    sync(300); // 100 ticks of reload remain: the effect must still be absent
    assert.equal(flash.visible, false);
    layer.recordFired([{gunId: 'gun1', x: 96, y: 28}], f.buildings, 400); // next shot to north
    sync(400);
    assert.equal(flash.visible, true);
    assert.equal(flash.frame, 0);
    layer.sync({guns: [], shells: [], buildings: [], reloadTicks: 300, tick: 401, isNight: true});
    assert.equal(flash.destroyed, true);
});

test('night/day and a disabled turret cannot leave flash sprites visible', () => {
    const f = fixture('autocannon');
    const layer = new AutocannonLayer(f.scene, f.grid);
    layer.recordShots([{turretId: 'gun1', x: 180, y: 112}], 100);
    const state = (tick, isNight) => layer.sync({cannons: [{id: 'gun1', targetId: null}], mutants: [], buildings: f.buildings, tick, isNight});
    state(100, true);
    assert.equal(f.flash().visible, true);
    state(101, false);
    assert.equal(f.flash().visible, false);
    f.buildings[0].enabled = false;
    state(102, true);
    assert.equal(f.flash().visible, false);
});

test('missing flash texture degrades gracefully to existing graybox/tracer visuals', () => {
    const f = fixture('autocannon', new Set());
    const layer = new AutocannonLayer(f.scene, f.grid);
    layer.recordShots([{turretId: 'gun1', x: 180, y: 112}], 100);
    assert.equal(f.flash(), undefined);
    layer.sync({cannons: [{id: 'gun1', targetId: null}], mutants: [], buildings: f.buildings, tick: 100, isNight: true});
    assert.equal(layer.barrelViews().length, 1);
    assert.equal(layer.tracerViews().length, 1);
});
