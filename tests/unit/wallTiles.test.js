import test from 'node:test';
import assert from 'node:assert/strict';
import {NORTH, EAST, SOUTH, WEST, wallFrame, wallFrames, wallLinks} from '../../src/scenes/WallTiles.js';

const wall = (id, col, row, hp = 100) => ({id, type: 'wall', col, row, width: 1, height: 1, hp});
const gate = (id, type, col, row) => ({id, type, col, row, width: 1, height: 1, hp: 150});
const frames = (buildings) => Object.fromEntries(wallFrames(buildings));

test('the bits are the brief\'s N1 E2 S4 W8', () => {
    assert.deepEqual([NORTH, EAST, SOUTH, WEST], [1, 2, 4, 8]);
});

test('all 16 masks: the frame is the mask of the cardinal neighbours, with no lookup', () => {
    const sides = [[NORTH, 0, -1], [EAST, 1, 0], [SOUTH, 0, 1], [WEST, -1, 0]];
    for (let mask = 0; mask < 16; mask++) {
        const buildings = [wall('c', 10, 10)];
        for (const [bit, dc, dr] of sides) if (mask & bit) buildings.push(wall(`n${bit}`, 10 + dc, 10 + dr));
        assert.equal(wallFrame({col: 10, row: 10}, wallLinks(buildings)), mask, `mask ${mask}`);
    }
});

test('diagonal neighbours never connect', () => {
    const buildings = [wall('c', 5, 5), wall('a', 4, 4), wall('b', 6, 4), wall('d', 4, 6), wall('e', 6, 6)];
    assert.equal(frames(buildings).c, 0);
});

test('isolated wall, pairs and lines of three', () => {
    assert.deepEqual(frames([wall('a', 3, 3)]), {a: 0});
    assert.deepEqual(frames([wall('a', 3, 3), wall('b', 4, 3)]), {a: EAST, b: WEST});
    assert.deepEqual(frames([wall('a', 3, 3), wall('b', 3, 4)]), {a: SOUTH, b: NORTH});
    assert.deepEqual(frames([wall('a', 3, 3), wall('b', 4, 3), wall('c', 5, 3)]), {a: 2, b: 10, c: 8});
    assert.deepEqual(frames([wall('a', 3, 3), wall('b', 3, 4), wall('c', 3, 5)]), {a: 4, b: 5, c: 1});
});

test('the four corners', () => {
    // Corner tile at (5,5) with one arm each way.
    const corner = (dx, dy) => frames([wall('k', 5, 5), wall('h', 5 + dx, 5), wall('v', 5, 5 + dy)]).k;
    assert.equal(corner(1, 1), EAST | SOUTH); // top-left corner, frame 6
    assert.equal(corner(-1, 1), SOUTH | WEST); // top-right, 12
    assert.equal(corner(1, -1), NORTH | EAST); // bottom-left, 3
    assert.equal(corner(-1, -1), NORTH | WEST); // bottom-right, 9
});

test('the four T-junctions and the crossing', () => {
    const at = (...cells) => frames([wall('k', 5, 5), ...cells.map(([c, r], i) => wall(`w${i}`, c, r))]).k;
    assert.equal(at([4, 5], [6, 5], [5, 6]), 14); // E+S+W
    assert.equal(at([4, 5], [6, 5], [5, 4]), 11); // N+E+W
    assert.equal(at([5, 4], [5, 6], [6, 5]), 7); // N+E+S
    assert.equal(at([5, 4], [5, 6], [4, 5]), 13); // N+S+W
    assert.equal(at([5, 4], [5, 6], [4, 5], [6, 5]), 15);
});

test('a Horizontal Gate joins walls east and west of it only', () => {
    const g = gate('g', 'gateHorizontal', 5, 5);
    assert.deepEqual(frames([wall('w', 4, 5), g, wall('e', 6, 5)]), {w: EAST, e: WEST});
    assert.deepEqual(frames([wall('n', 5, 4), g, wall('s', 5, 6)]), {n: 0, s: 0}, 'never across its passage');
});

test('a Vertical Gate joins walls north and south of it only', () => {
    const g = gate('g', 'gateVertical', 5, 5);
    assert.deepEqual(frames([wall('n', 5, 4), g, wall('s', 5, 6)]), {n: SOUTH, s: NORTH});
    assert.deepEqual(frames([wall('w', 4, 5), g, wall('e', 6, 5)]), {w: 0, e: 0}, 'never across its passage');
});

test('gates get no frame of their own, and other buildings never connect', () => {
    const result = frames([wall('a', 1, 1), gate('g', 'gateVertical', 1, 2), {id: 'hq-1', type: 'hq', col: 2, row: 0, width: 3, height: 3}]);
    assert.deepEqual(result, {a: SOUTH});
});

test('removing a wall from an established structure refreshes its neighbours', () => {
    const cross = [wall('k', 5, 5), wall('n', 5, 4), wall('e', 6, 5), wall('s', 5, 6), wall('w', 4, 5)];
    assert.deepEqual(frames(cross), {k: 15, n: SOUTH, e: WEST, s: NORTH, w: EAST});
    const withoutCentre = cross.filter(({id}) => id !== 'k');
    assert.deepEqual(frames(withoutCentre), {n: 0, e: 0, s: 0, w: 0});
    const withoutEast = cross.filter(({id}) => id !== 'e');
    assert.deepEqual(frames(withoutEast), {k: 13, n: SOUTH, s: NORTH, w: EAST});
});

test('a destroyed gate leaves the walls beside it as ends, and a destroyed wall frees the gate side', () => {
    const line = [wall('w', 4, 5), gate('g', 'gateHorizontal', 5, 5), wall('e', 6, 5), wall('ee', 7, 5)];
    assert.deepEqual(frames(line), {w: EAST, e: EAST | WEST, ee: WEST});
    assert.deepEqual(frames(line.filter(({id}) => id !== 'g')), {w: 0, e: EAST, ee: WEST});
    assert.deepEqual(frames(line.filter(({id}) => id !== 'e')), {w: EAST, ee: 0});
});

test('HP plays no part: a damaged wall keeps its connection frame', () => {
    assert.deepEqual(frames([wall('a', 3, 3, 1), wall('b', 4, 3, 66)]), {a: EAST, b: WEST});
});

test('frames are pure: the building list is not changed', () => {
    const buildings = [wall('a', 3, 3), gate('g', 'gateVertical', 3, 4)];
    const before = JSON.stringify(buildings);
    frames(buildings);
    assert.equal(JSON.stringify(buildings), before);
});
