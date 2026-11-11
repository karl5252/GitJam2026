import test from 'node:test';
import assert from 'node:assert/strict';
import {NORTH, EAST, SOUTH, WEST} from '../../src/scenes/WallTiles.js';
import {ROAD_CELL, ROAD_CELLS, ROAD_SCALE, normalizeRoadEdges, roadFrames, roadMask} from '../../src/scenes/RoadTiles.js';
import {decodePalettePng} from './pngDecode.js';

const sheet = decodePalettePng(new URL('../../public/assets/sprites/buildings/roads_v1.png', import.meta.url));

/** Mask frame as RoadTiles builds it: the source cell, mirrored if asked, edges normalized. */
function frame(mask) {
    const {cell, flipX = false, flipY = false} = ROAD_CELLS[mask];
    const out = new Uint8ClampedArray(ROAD_CELL * ROAD_CELL * 4);
    for (let y = 0; y < ROAD_CELL; y++) {
        for (let x = 0; x < ROAD_CELL; x++) {
            const sx = cell * ROAD_CELL + (flipX ? ROAD_CELL - 1 - x : x);
            const sy = flipY ? ROAD_CELL - 1 - y : y;
            const from = (sy * sheet.width + sx) * 4;
            out.set(sheet.data.subarray(from, from + 4), (y * ROAD_CELL + x) * 4);
        }
    }
    return normalizeRoadEdges(out, ROAD_CELL, mask);
}

const last = ROAD_CELL - 1;
const EDGES = {
    [NORTH]: (i) => [i, 0], [SOUTH]: (i) => [i, last], [WEST]: (i) => [0, i], [EAST]: (i) => [last, i],
};
/** Opaque positions along one edge line. */
function edge(data, side) {
    const opaque = [];
    for (let i = 0; i < ROAD_CELL; i++) {
        const [x, y] = EDGES[side](i);
        if (data[(y * ROAD_CELL + x) * 4 + 3]) opaque.push(i);
    }
    return opaque;
}

test('roads_v1.png is 16 cells of 64x64 in one row, drawn at 0.5 so a cell is one 32 px tile', () => {
    assert.deepEqual([sheet.width, sheet.height], [16 * 64, 64]);
    assert.equal(ROAD_CELL * ROAD_SCALE, 32);
});

test('every one of the 16 masks has a source cell, and the mapping is explicit, not the sheet order', () => {
    assert.equal(ROAD_CELLS.length, 16);
    for (const {cell} of ROAD_CELLS) assert.ok(cell >= 0 && cell < 16);
    assert.notDeepEqual(ROAD_CELLS.map(({cell}) => cell), [...Array(16).keys()]);
});

test('on the real art, each mask frame reaches exactly the edges it joins', () => {
    for (let mask = 0; mask < 16; mask++) {
        const data = frame(mask);
        for (const side of [NORTH, EAST, SOUTH, WEST]) {
            const opaque = edge(data, side).length;
            if (mask & side) assert.ok(opaque >= 20, `mask ${mask} side ${side}: joined, ${opaque} px`);
            else assert.ok(opaque <= 1, `mask ${mask} side ${side}: open, but ${opaque} px reach it`);
        }
    }
});

test('joined edges meet: a road leaving east enters its neighbour from the west over the same rows, and north over south', () => {
    const overlap = (a, b) => a.filter((i) => b.includes(i)).length;
    for (let a = 0; a < 16; a++) {
        for (let b = 0; b < 16; b++) {
            if ((a & EAST) && (b & WEST)) {
                const [out, into] = [edge(frame(a), EAST), edge(frame(b), WEST)];
                assert.ok(overlap(out, into) >= 0.8 * Math.min(out.length, into.length), `E of ${a} vs W of ${b}`);
            }
            if ((a & SOUTH) && (b & NORTH)) {
                const [out, into] = [edge(frame(a), SOUTH), edge(frame(b), NORTH)];
                assert.ok(overlap(out, into) >= 0.8 * Math.min(out.length, into.length), `S of ${a} vs N of ${b}`);
            }
        }
    }
});

test('normalizing only ever changes the outermost lines', () => {
    for (let mask = 0; mask < 16; mask++) {
        const {cell} = ROAD_CELLS[mask];
        if (ROAD_CELLS[mask].flipX || ROAD_CELLS[mask].flipY) continue;
        const data = frame(mask);
        for (let y = 1; y < last; y++) {
            for (let x = 1; x < last; x++) {
                const from = (y * sheet.width + cell * ROAD_CELL + x) * 4 + 3;
                assert.equal(data[(y * ROAD_CELL + x) * 4 + 3], sheet.data[from], `mask ${mask} (${x},${y})`);
            }
        }
    }
});

test('the mask is N1 E2 S4 W8 over road tiles, HQ ring and player roads alike, no diagonals', () => {
    const sides = [[NORTH, 0, -1], [EAST, 1, 0], [SOUTH, 0, 1], [WEST, -1, 0]];
    for (let mask = 0; mask < 16; mask++) {
        const keys = new Set(['5,5', '6,6', '4,4']); // diagonals never count
        for (const [bit, dc, dr] of sides) if (mask & bit) keys.add(`${5 + dc},${5 + dr}`);
        assert.equal(roadMask({col: 5, row: 5}, keys), mask);
    }
    // A 5x5 ring with one road leaving its west side: corners, straights and a T.
    const ring = [];
    for (let col = 0; col < 5; col++) ring.push({col, row: 0, kind: 'hq-ring'}, {col, row: 4, kind: 'hq-ring'});
    for (let row = 1; row < 4; row++) ring.push({col: 0, row, kind: 'hq-ring'}, {col: 4, row, kind: 'hq-ring'});
    const road = {col: -1, row: 2, kind: 'road'};
    const tiles = [...ring, road];
    const at = (col, row) => roadFrames(tiles)[tiles.findIndex((t) => t.col === col && t.row === row)];
    assert.equal(at(0, 0), EAST | SOUTH);
    assert.equal(at(4, 0), SOUTH | WEST);
    assert.equal(at(0, 4), NORTH | EAST);
    assert.equal(at(4, 4), NORTH | WEST);
    assert.equal(at(2, 0), EAST | WEST);
    assert.equal(at(4, 2), NORTH | SOUTH);
    assert.equal(at(0, 2), NORTH | SOUTH | WEST);
    assert.equal(at(-1, 2), EAST, 'a dead end');
});
