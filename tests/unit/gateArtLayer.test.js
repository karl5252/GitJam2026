import test from 'node:test';
import assert from 'node:assert/strict';
import {GateLayer} from '../../src/scenes/GateLayer.js';

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
                    x, y, key, frame, angle: 0, destroyed: false,
                    setOrigin() { return this; },
                    setScale() { return this; },
                    setDepth() { return this; },
                    setPosition(nx, ny) { this.x = nx; this.y = ny; return this; },
                    setFrame(next) { this.frame = next; return this; },
                    setAngle(angle) { this.angle = angle; return this; },
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

function gate(id, orientation, state, timer) {
    return {id, col: 3, row: 5, orientation, state, timer};
}

test('gate sprites follow the existing state and are destroyed when removed', () => {
    const {scene, grid, sprites} = sceneHarness();
    const layer = new GateLayer(scene, grid);
    layer.sync([gate('g1', 'horizontal', 'closed', 0)]);
    assert.equal(sprites.length, 1);
    assert.equal(sprites[0].frame, 0);
    assert.deepEqual([sprites[0].x, sprites[0].y], [112, 176]);
    layer.sync([gate('g1', 'horizontal', 'opening', 75)]);
    assert.equal(sprites.length, 1);
    assert.equal(sprites[0].frame, 8);
    layer.sync([gate('g1', 'horizontal', 'open', 0)]);
    assert.equal(sprites[0].frame, 15);
    layer.sync([]);
    assert.equal(sprites[0].destroyed, true);
    assert.deepEqual(layer.views(), []);
});

test('vertical gate rotates the full sequence and missing sprites fall back to graphics', () => {
    const one = sceneHarness();
    const layer = new GateLayer(one.scene, one.grid);
    layer.sync([gate('g2', 'vertical', 'opening', 75)]);
    assert.equal(one.sprites[0].frame, 8);
    assert.equal(one.sprites[0].angle, 90);

    const fallback = sceneHarness(false);
    const basicLayer = new GateLayer(fallback.scene, fallback.grid);
    basicLayer.sync([gate('g2', 'vertical', 'closed', 0)]);
    assert.equal(fallback.sprites.length, 0);
    assert.ok(fallback.fallbackRects.length > 0);
});
