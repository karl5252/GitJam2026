import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ART} from '../../src/scenes/SpriteArt.js';

const asset = (path) => new URL(`../../public/assets/sprites/${path}`, import.meta.url);

/** Width and height from a PNG's IHDR chunk. */
const pngSize = (path) => {
    const header = readFileSync(asset(path));
    return [header.readUInt32BE(16), header.readUInt32BE(20)];
};

test('walls load walls_v3: 16 frames of 64x64 in one row, drawn at 0.5 so a frame fills its 32 px tile, centred', () => {
    const {path, frameWidth, frameHeight, spacing = 0, margin = 0, scale, offsetX, offsetY = 0, originY} = ART.wall;
    assert.equal(path, 'buildings/walls_v3.png');
    assert.deepEqual([frameWidth, frameHeight, spacing, margin], [64, 64, 0, 0]);
    assert.deepEqual(pngSize(path), [16 * 64, 64]);
    assert.equal(frameWidth * scale, 32, 'one tile');
    assert.deepEqual([offsetX, offsetY, originY], [0, 0, 0.5]);
});

test('the Aseprite metadata agrees with the spritesheet: frame i is at x = 64 i', () => {
    const {frames} = JSON.parse(readFileSync(asset('buildings/walls_v3.json'), 'utf8'));
    const names = Object.keys(frames);
    assert.equal(names.length, 16);
    names.forEach((name, i) => {
        assert.equal(name, `walls_v3 ${i}.aseprite`);
        assert.deepEqual(frames[name].frame, {x: 64 * i, y: 0, w: 64, h: 64});
        assert.equal(frames[name].trimmed, false);
    });
});

test('each gate orientation has its own sheet: 8 cells of 32x48, 5 px apart, unscaled, standing on its bottom edge', () => {
    for (const kind of ['gateHorizontal', 'gateVertical']) {
        const {path, frameWidth, frameHeight, spacing, scale, originY} = ART[kind];
        assert.deepEqual([frameWidth, frameHeight, spacing, scale, originY], [32, 48, 5, 1, 1], kind);
        assert.deepEqual(pngSize(path), [8 * frameWidth + 7 * spacing, frameHeight], `${kind}: the sheet really holds 8 such cells`);
    }
    assert.equal(ART.gate, undefined, 'the old shared sheet is no longer used');
});
