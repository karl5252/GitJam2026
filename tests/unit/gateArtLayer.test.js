import test from 'node:test';
import assert from 'node:assert/strict';
import {GateLayer, gateDepth} from '../../src/scenes/GateLayer.js';
import {artKey} from '../../src/scenes/SpriteArt.js';

/** A stub Phaser scene: sprites keep what they are told, and are as big as a 32x48 sheet cell. */
function sceneHarness(hasTexture = true) {
    const sprites = [];
    const fallbackRects = [];
    const graphics = () => ({
        setDepth() { return this; },
        clear() { return this; },
        fillStyle() { return this; },
        fillRect(...args) { fallbackRects.push(args); return this; },
        fillTriangle() { return this; },
    });
    const scene = {
        textures: {exists: () => hasTexture},
        add: {
            graphics,
            sprite(x, y, key, frame) {
                const sprite = {
                    x, y, key, frame, angle: 0, destroyed: false, originX: 0.5, originY: 0.5, depth: 0,
                    displayWidth: 32, displayHeight: 48, visible: true, alpha: 1, tint: null,
                    setOrigin(ox, oy) { this.originX = ox; this.originY = oy; return this; },
                    setScale(scale) { this.displayWidth = 32 * scale; this.displayHeight = 48 * scale; return this; },
                    setDepth(depth) { this.depth = depth; return this; },
                    setPosition(nx, ny) { this.x = nx; this.y = ny; return this; },
                    setFrame(next) { this.frame = next; return this; },
                    setAngle(angle) { this.angle = angle; return this; },
                    setTint(tint) { this.tint = tint; return this; },
                    setAlpha(alpha) { this.alpha = alpha; return this; },
                    setVisible(visible) { this.visible = visible; return this; },
                    destroy() { this.destroyed = true; },
                };
                sprites.push(sprite);
                return sprite;
            },
        },
    };
    const grid = {
        tileSize: 32,
        cellCenter(col, row) { return {x: col * 32 + 16, y: row * 32 + 16}; },
    };
    return {scene, grid, sprites, fallbackRects};
}

function gate(id, orientation, state, timer, at = {col: 3, row: 5}) {
    return {id, ...at, orientation, state, timer};
}

// Tile 3,5 covers x 96..128, y 160..192: bottom-centre is 112,192.
const TILE = {left: 96, top: 160, size: 32};

test('a horizontal gate draws its own sheet, unrotated, through closed, opening, open and closing', () => {
    const {scene, grid, sprites} = sceneHarness();
    const layer = new GateLayer(scene, grid);
    layer.sync([gate('g1', 'horizontal', 'closed', 0)]);
    assert.equal(sprites.length, 1);
    assert.equal(sprites[0].key, artKey('gateHorizontal'));
    assert.deepEqual([sprites[0].frame, sprites[0].angle], [0, 0]);
    layer.sync([gate('g1', 'horizontal', 'opening', 75)]);
    assert.equal(sprites[0].frame, 4);
    layer.sync([gate('g1', 'horizontal', 'open', 0)]);
    assert.deepEqual([sprites[0].frame, sprites[0].angle], [7, 0]);
    layer.sync([gate('g1', 'horizontal', 'closing', 30)]);
    assert.equal(sprites[0].frame, 4, 'closing runs back down the same frames');
    layer.sync([]);
    assert.equal(sprites[0].destroyed, true);
    assert.deepEqual(layer.views(), []);
});

test('a vertical gate draws its own sheet, unrotated, through closed, opening, open and closing', () => {
    const {scene, grid, sprites} = sceneHarness();
    const layer = new GateLayer(scene, grid);
    layer.sync([gate('g2', 'vertical', 'closed', 0)]);
    assert.equal(sprites[0].key, artKey('gateVertical'));
    assert.deepEqual([sprites[0].frame, sprites[0].angle], [0, 0]);
    layer.sync([gate('g2', 'vertical', 'opening', 75)]);
    assert.equal(sprites[0].frame, 4);
    layer.sync([gate('g2', 'vertical', 'open', 0)]);
    assert.deepEqual([sprites[0].frame, sprites[0].angle], [7, 0]);
    layer.sync([gate('g2', 'vertical', 'closing', 30)]);
    assert.equal(sprites[0].frame, 4);
});

test('both stand bottom-centre on their one tile: a vertical gate rises 16 px above it, unscaled and unclipped', () => {
    const {scene, grid} = sceneHarness();
    const layer = new GateLayer(scene, grid);
    layer.sync([gate('h', 'horizontal', 'closed', 0), gate('v', 'vertical', 'closed', 0, {col: 3, row: 7})]);
    const [h, v] = layer.views();
    assert.deepEqual([h.x, h.y, h.originX, h.originY], [TILE.left + 16, TILE.top + TILE.size, 0.5, 1]);
    assert.deepEqual([h.width, h.height], [32, 48], 'the full cell, its art in the bottom 32 px');
    const bottom = 7 * 32 + 32;
    assert.deepEqual([v.x, v.y, v.originY, v.width, v.height], [112, bottom, 1, 32, 48]);
    assert.equal(v.y - v.height, bottom - 32 - 16, 'its top is 16 px above its tile');
});

test('depth comes from the row a gate stands on, so a gate further south draws over its neighbour to the north', () => {
    const {scene, grid} = sceneHarness();
    const layer = new GateLayer(scene, grid);
    layer.sync([gate('north', 'vertical', 'closed', 0, {col: 3, row: 4}), gate('south', 'vertical', 'closed', 0, {col: 3, row: 5})]);
    const [north, south] = layer.views();
    assert.deepEqual([north.depth, south.depth], [gateDepth(4), gateDepth(5)]);
    assert.ok(south.depth > north.depth);
    assert.ok(gateDepth(0) > 1.1 && gateDepth(31) < 2.5, 'over building art (1.1), under the fog (2.5)');
});

test('the placement ghost is the real sprite, closed, at full size and tinted, on the same one tile', () => {
    const {scene, grid} = sceneHarness();
    const layer = new GateLayer(scene, grid);
    layer.showPreview({col: 3, row: 5}, 'vertical', 0x4caf50);
    let {ghost, col, row} = layer.previewView();
    assert.deepEqual([col, row], [3, 5], 'still exactly one tile');
    assert.deepEqual({kind: ghost.kind, frame: ghost.frame, angle: ghost.angle, x: ghost.x, y: ghost.y, height: ghost.height, originY: ghost.originY},
        {kind: 'gateVertical', frame: 0, angle: 0, x: 112, y: 192, height: 48, originY: 1});
    layer.showPreview({col: 3, row: 5}, 'horizontal', 0xe53935);
    ({ghost} = layer.previewView());
    assert.equal(ghost.kind, 'gateHorizontal');
    layer.showPreview(null);
    assert.equal(layer.previewView().ghost, null);
});

test('with no art the procedural barrier still draws, and the preview still shows', () => {
    const fallback = sceneHarness(false);
    const layer = new GateLayer(fallback.scene, fallback.grid);
    layer.sync([gate('g2', 'vertical', 'closed', 0)]);
    assert.equal(fallback.sprites.length, 0);
    assert.ok(fallback.fallbackRects.length > 0);
    const before = fallback.fallbackRects.length;
    layer.showPreview({col: 3, row: 5}, 'vertical', 0x4caf50);
    assert.ok(fallback.fallbackRects.length > before);
    assert.equal(layer.previewView().ghost, null);
});
