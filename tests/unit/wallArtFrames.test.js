import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ART} from '../../src/scenes/SpriteArt.js';
import {WALL_FRAME, wallAppearance} from '../../src/scenes/WallTiles.js';

test('walls fit the whole 32px tile', () => {
    assert.deepEqual([ART.wall.frameWidth, ART.wall.frameHeight], [32, 32]);
    assert.equal(ART.wall.scale, 1);
    assert.equal(ART.wall.originY, 0.5);
});

/** Width and height from a PNG's IHDR chunk. */
const pngSize = (path) => {
    const header = readFileSync(new URL(`../../public/assets/sprites/${path}`, import.meta.url));
    return [header.readUInt32BE(16), header.readUInt32BE(20)];
};

test('each gate orientation has its own sheet: 8 cells of 32x48, 5 px apart, unscaled, standing on its bottom edge', () => {
    for (const kind of ['gateHorizontal', 'gateVertical']) {
        const {path, frameWidth, frameHeight, spacing, scale, originY} = ART[kind];
        assert.deepEqual([frameWidth, frameHeight, spacing, scale, originY], [32, 48, 5, 1, 1], kind);
        assert.deepEqual(pngSize(path), [8 * frameWidth + 7 * spacing, frameHeight], `${kind}: the sheet really holds 8 such cells`);
    }
    assert.equal(ART.gate, undefined, 'the old shared sheet is no longer used');
});

test('the 2-column wall sheet retains damage frames at indices 18 and 19', () => {
    const neighbors = new Set(['9,10', '11,10']);
    assert.deepEqual(wallAppearance({col: 10, row: 10, hp: 100}, neighbors), {frame: WALL_FRAME.horizontal, angle: 0});
    assert.equal(wallAppearance({col: 10, row: 10, hp: 66}, neighbors).frame, 18);
    assert.equal(wallAppearance({col: 10, row: 10, hp: 33}, neighbors).frame, 19);
});
