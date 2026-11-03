import test from 'node:test';
import assert from 'node:assert/strict';
import {Grid, PlacementFailure} from '../../src/core/grid.js';

const make = (overrides = {}) => new Grid({cols: 10, rows: 8, tileSize: 64, ...overrides});

// ---- Construction ---------------------------------------------------------

test('constructor stores configuration with default origin', () => {
    const g = make();
    assert.equal(g.cols, 10);
    assert.equal(g.rows, 8);
    assert.equal(g.tileSize, 64);
    assert.equal(g.originX, 0);
    assert.equal(g.originY, 0);
});

test('constructor rejects invalid sizes', () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity, '10', undefined, null]) {
        assert.throws(() => make({cols: bad}), RangeError, `cols=${bad}`);
        assert.throws(() => make({rows: bad}), RangeError, `rows=${bad}`);
        assert.throws(() => make({tileSize: bad}), RangeError, `tileSize=${bad}`);
    }
    assert.throws(() => new Grid(), RangeError);
});

test('constructor rejects non-finite origins', () => {
    for (const bad of [NaN, Infinity, -Infinity, '5']) {
        assert.throws(() => make({originX: bad}), RangeError);
        assert.throws(() => make({originY: bad}), RangeError);
    }
});

test('configuration is read-only', () => {
    const g = make();
    assert.throws(() => { g.cols = 99; }, TypeError);
    assert.equal(g.cols, 10);
});

// ---- Coordinate conversion -----------------------------------------------

for (const origin of [{originX: 0, originY: 0}, {originX: 100, originY: 40}, {originX: -32, originY: -96}]) {
    test(`cell -> world -> cell round-trips for every cell (origin ${origin.originX},${origin.originY})`, () => {
        const g = make(origin);
        for (let row = 0; row < g.rows; row++) {
            for (let col = 0; col < g.cols; col++) {
                const corner = g.cellToWorld(col, row);
                assert.deepEqual(g.worldToCell(corner.x, corner.y), {col, row});
                const center = g.cellCenter(col, row);
                assert.deepEqual(g.worldToCell(center.x, center.y), {col, row});
            }
        }
    });
}

test('cellToWorld and cellCenter honour origin offset', () => {
    const g = make({originX: 100, originY: 40});
    assert.deepEqual(g.cellToWorld(0, 0), {x: 100, y: 40});
    assert.deepEqual(g.cellToWorld(2, 3), {x: 228, y: 232});
    assert.deepEqual(g.cellCenter(2, 3), {x: 260, y: 264});
});

test('boundary points belong to the right/lower cell', () => {
    const g = make();
    assert.deepEqual(g.worldToCell(63.999, 63.999), {col: 0, row: 0});
    assert.deepEqual(g.worldToCell(64, 64), {col: 1, row: 1});
});

test('worldToCell returns null outside the grid, on the far edge, and for bad input', () => {
    const g = make({originX: 100, originY: 40});
    assert.equal(g.worldToCell(99.9, 50), null);
    assert.equal(g.worldToCell(150, 39.9), null);
    assert.equal(g.worldToCell(100 + 10 * 64, 50), null); // right edge
    assert.equal(g.worldToCell(150, 40 + 8 * 64), null); // bottom edge
    assert.deepEqual(g.worldToCell(100 + 10 * 64 - 0.001, 40 + 8 * 64 - 0.001), {col: 9, row: 7});
    assert.equal(g.worldToCell(NaN, 50), null);
    assert.equal(g.worldToCell(150, Infinity), null);
});

test('footprintRect covers 1x1 and 3x2 footprints', () => {
    const g = make({originX: 100, originY: 40});
    assert.deepEqual(g.footprintRect({col: 1, row: 2}), {x: 164, y: 168, width: 64, height: 64});
    assert.deepEqual(g.footprintRect({col: 1, row: 2, width: 3, height: 2}), {x: 164, y: 168, width: 192, height: 128});
});

// ---- Bounds validation ----------------------------------------------------

test('isInBounds accepts footprints flush against the right/bottom edge', () => {
    const g = make();
    assert.equal(g.isInBounds({col: 7, row: 6, width: 3, height: 2}), true);
    assert.equal(g.isInBounds({col: 0, row: 0, width: 10, height: 8}), true);
});

test('isInBounds rejects footprints that cross any edge or exceed the grid', () => {
    const g = make();
    assert.equal(g.isInBounds({col: -1, row: 0}), false);
    assert.equal(g.isInBounds({col: 0, row: -1}), false);
    assert.equal(g.isInBounds({col: 8, row: 0, width: 3, height: 1}), false);
    assert.equal(g.isInBounds({col: 0, row: 7, width: 1, height: 2}), false);
    assert.equal(g.isInBounds({col: 0, row: 0, width: 11, height: 1}), false);
});

test('invalid footprints are rejected with invalid-footprint', () => {
    const g = make();
    const bad = [
        null, undefined, 'a', 42,
        {row: 0}, {col: 0},
        {col: 0.5, row: 0}, {col: 0, row: '1'},
        {col: 0, row: 0, width: 0}, {col: 0, row: 0, height: -1},
        {col: 0, row: 0, width: 1.5}, {col: 0, row: 0, width: NaN},
    ];
    for (const fp of bad) {
        assert.deepEqual(g.canPlace(fp), {ok: false, reason: PlacementFailure.INVALID_FOOTPRINT}, JSON.stringify(fp));
        assert.equal(g.isInBounds(fp), false);
    }
});

test('out-of-bounds placements are rejected with out-of-bounds', () => {
    const g = make();
    for (const fp of [{col: -1, row: 0}, {col: 9, row: 0, width: 2}, {col: 0, row: 7, height: 2}, {col: 0, row: 0, width: 11, height: 9}]) {
        assert.deepEqual(g.place('x', fp), {ok: false, reason: PlacementFailure.OUT_OF_BOUNDS});
    }
    assert.deepEqual(g.snapshot().occupants, []);
});

// ---- Occupancy ------------------------------------------------------------

test('place occupies every cell of an NxM footprint', () => {
    const g = make();
    assert.deepEqual(g.place('factory', {col: 2, row: 1, width: 3, height: 2}), {ok: true});
    for (let row = 1; row <= 2; row++) {
        for (let col = 2; col <= 4; col++) {
            assert.equal(g.occupantAt(col, row), 'factory');
        }
    }
    assert.equal(g.occupantAt(1, 1), null);
    assert.equal(g.occupantAt(5, 1), null);
    assert.equal(g.occupantAt(2, 0), null);
    assert.equal(g.occupantAt(2, 3), null);
});

test('width and height default to 1', () => {
    const g = make();
    assert.deepEqual(g.place('turret', {col: 4, row: 4}), {ok: true});
    assert.equal(g.occupantAt(4, 4), 'turret');
    assert.deepEqual(g.snapshot().occupants, [{id: 'turret', col: 4, row: 4, width: 1, height: 1}]);
});

test('occupantAt returns null out of bounds and for non-integer input', () => {
    const g = make();
    g.place('a', {col: 0, row: 0});
    assert.equal(g.occupantAt(-1, 0), null);
    assert.equal(g.occupantAt(10, 0), null);
    assert.equal(g.occupantAt(0, 8), null);
    assert.equal(g.occupantAt(0.5, 0), null);
});

test('overlapping placement is rejected with occupied and the blocker id', () => {
    const g = make();
    g.place('factory', {col: 2, row: 1, width: 3, height: 2});
    assert.deepEqual(
        g.canPlace({col: 4, row: 2, width: 2, height: 2}),
        {ok: false, reason: PlacementFailure.OCCUPIED, blockers: ['factory']},
    );
});

test('blockers list each distinct occupant once, in row-major scan order', () => {
    const g = make();
    g.place('b', {col: 3, row: 0, width: 2, height: 2});
    g.place('a', {col: 0, row: 1, width: 2, height: 2});
    const result = g.canPlace({col: 1, row: 0, width: 3, height: 3});
    assert.deepEqual(result, {ok: false, reason: PlacementFailure.OCCUPIED, blockers: ['b', 'a']});
});

test('adjacent non-overlapping footprints are accepted', () => {
    const g = make();
    g.place('a', {col: 2, row: 2, width: 2, height: 2});
    assert.equal(g.place('right', {col: 4, row: 2, width: 1, height: 2}).ok, true);
    assert.equal(g.place('left', {col: 1, row: 2}).ok, true);
    assert.equal(g.place('above', {col: 2, row: 1, width: 2, height: 1}).ok, true);
    assert.equal(g.place('below', {col: 2, row: 4, width: 3, height: 1}).ok, true);
});

test('duplicate ids are rejected with duplicate-id', () => {
    const g = make();
    g.place('a', {col: 0, row: 0});
    assert.deepEqual(g.place('a', {col: 5, row: 5}), {ok: false, reason: PlacementFailure.DUPLICATE_ID});
    assert.equal(g.occupantAt(5, 5), null);
});

test('place throws for a missing or non-string id', () => {
    const g = make();
    for (const bad of [undefined, null, '', 7, {}]) {
        assert.throws(() => g.place(bad, {col: 0, row: 0}), TypeError);
    }
    assert.equal(g.occupantAt(0, 0), null);
});

test('rejected placements never mutate the grid', () => {
    const g = make();
    g.place('factory', {col: 2, row: 1, width: 3, height: 2});
    const before = JSON.stringify(g.snapshot());
    const cellsBefore = [];
    for (let row = 0; row < g.rows; row++) for (let col = 0; col < g.cols; col++) cellsBefore.push(g.occupantAt(col, row));

    g.place('x', {col: 4, row: 2, width: 3, height: 3}); // occupied (partial overlap)
    g.place('x', {col: 8, row: 0, width: 3, height: 1}); // out-of-bounds (partially inside)
    g.place('x', {col: 0, row: 0, width: 0, height: 1}); // invalid-footprint
    g.place('factory', {col: 0, row: 5}); // duplicate-id

    assert.equal(JSON.stringify(g.snapshot()), before);
    const cellsAfter = [];
    for (let row = 0; row < g.rows; row++) for (let col = 0; col < g.cols; col++) cellsAfter.push(g.occupantAt(col, row));
    assert.deepEqual(cellsAfter, cellsBefore);
});

test('canPlace never mutates the grid', () => {
    const g = make();
    g.canPlace({col: 0, row: 0, width: 2, height: 2});
    assert.equal(g.occupantAt(0, 0), null);
    assert.deepEqual(g.snapshot().occupants, []);
});

test('remove frees every cell and the space can be reused', () => {
    const g = make();
    g.place('factory', {col: 2, row: 1, width: 3, height: 2});
    g.place('other', {col: 6, row: 1});
    assert.equal(g.remove('factory'), true);
    for (let row = 1; row <= 2; row++) {
        for (let col = 2; col <= 4; col++) assert.equal(g.occupantAt(col, row), null);
    }
    assert.equal(g.occupantAt(6, 1), 'other');
    assert.equal(g.place('factory', {col: 2, row: 1, width: 3, height: 2}).ok, true);
});

test('remove returns false for an unknown id', () => {
    const g = make();
    assert.equal(g.remove('ghost'), false);
    g.place('a', {col: 0, row: 0});
    g.remove('a');
    assert.equal(g.remove('a'), false);
});

test('placement does not keep a reference to the caller footprint', () => {
    const g = make();
    const fp = {col: 0, row: 0, width: 2, height: 1};
    g.place('a', fp);
    fp.col = 5;
    fp.width = 4;
    assert.deepEqual(g.snapshot().occupants, [{id: 'a', col: 0, row: 0, width: 2, height: 1}]);
    assert.equal(g.occupantAt(0, 0), 'a');
});

// ---- Snapshot -------------------------------------------------------------

test('snapshot is JSON-serializable and describes config and occupants', () => {
    const g = make({originX: 100, originY: 40});
    g.place('a', {col: 0, row: 0, width: 2, height: 2});
    g.place('b', {col: 5, row: 3});
    const snap = g.snapshot();
    assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap);
    assert.deepEqual(snap, {
        cols: 10, rows: 8, tileSize: 64, originX: 100, originY: 40,
        occupants: [
            {id: 'a', col: 0, row: 0, width: 2, height: 2},
            {id: 'b', col: 5, row: 3, width: 1, height: 1},
        ],
    });
});

test('mutating a snapshot cannot modify the grid', () => {
    const g = make();
    g.place('a', {col: 0, row: 0, width: 2, height: 2});
    const snap = g.snapshot();

    snap.cols = 99;
    snap.occupants[0].col = 7;
    snap.occupants[0].width = 3;
    snap.occupants.push({id: 'fake', col: 5, row: 5, width: 1, height: 1});
    snap.occupants.shift();

    assert.equal(g.cols, 10);
    assert.deepEqual(g.snapshot().occupants, [{id: 'a', col: 0, row: 0, width: 2, height: 2}]);
    assert.equal(g.occupantAt(0, 0), 'a');
    assert.equal(g.occupantAt(7, 0), null);
    assert.equal(g.occupantAt(5, 5), null);
    assert.equal(g.place('a2', {col: 7, row: 0}).ok, true);
    assert.notEqual(g.snapshot(), g.snapshot());
});
