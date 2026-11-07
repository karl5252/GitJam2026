import test from 'node:test';
import assert from 'node:assert/strict';
import {ART} from '../../src/scenes/SpriteArt.js';
import {WALL_FRAME, wallAppearance} from '../../src/scenes/WallTiles.js';

test('walls fit the whole 32px tile, gates use their compact 32px frames', () => {
    assert.deepEqual([ART.wall.frameWidth, ART.wall.frameHeight], [32, 32]);
    assert.equal(ART.wall.scale, 1);
    assert.equal(ART.wall.originY, 0.5);
    assert.deepEqual([ART.gate.frameWidth, ART.gate.frameHeight], [32, 32]);
    assert.equal(ART.gate.scale, 1);
    assert.equal(ART.gate.originY, 0.5);
});

test('the 2-column wall sheet retains damage frames at indices 18 and 19', () => {
    const neighbors = new Set(['9,10', '11,10']);
    assert.deepEqual(wallAppearance({col: 10, row: 10, hp: 100}, neighbors), {frame: WALL_FRAME.horizontal, angle: 0});
    assert.equal(wallAppearance({col: 10, row: 10, hp: 66}, neighbors).frame, 18);
    assert.equal(wallAppearance({col: 10, row: 10, hp: 33}, neighbors).frame, 19);
});
