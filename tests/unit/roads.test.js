import test from 'node:test';
import assert from 'node:assert/strict';
import {Grid} from '../../src/core/grid.js';
import {BuildingPlacement, CONSTRUCTION_DISABLED} from '../../src/core/buildingPlacement.js';
import {Economy} from '../../src/core/economy.js';
import {HQ_RING, PLAYER_ROAD, RoadFailure, RoadNetwork, hqRingCells} from '../../src/core/roads.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {canonicalState, createWorld, digestOf, worldState} from '../soak/harness.js';

const HQ_AT = {col: 11, row: 7, width: 3, height: 3}; // pointer cell 12,8

function network() {
    const grid = new Grid({cols: 24, rows: 16, tileSize: 32});
    const roads = new RoadNetwork({grid});
    return {grid, roads};
}

function ringed() {
    const ctx = network();
    assert.equal(ctx.roads.addHqRing(HQ_AT).ok, true);
    return ctx;
}

function game({credits = 5000, ap = 20} = {}) {
    const grid = new Grid({cols: 24, rows: 16, tileSize: 32});
    const economy = new Economy({credits, ap});
    const roads = new RoadNetwork({grid});
    let open = true;
    const placement = new BuildingPlacement(grid, economy, {isConstructionAllowed: () => open, requireHq: true, roads});
    const build = (type, col, row) => {
        placement.select(type);
        const result = placement.placeAt({col, row});
        placement.cancel();
        return result;
    };
    return {grid, economy, roads, placement, build, close: () => { open = false; }};
}

function hqGame(options) {
    const ctx = game(options);
    assert.equal(ctx.build('hq', 12, 8).ok, true);
    return ctx;
}

// ---- HQ ring ----------------------------------------------------------------------

test('the ring is the 16 cells around HQ, with its corners', () => {
    const cells = hqRingCells(HQ_AT);
    assert.equal(cells.length, 16);
    assert.deepEqual(cells[0], {col: 10, row: 6});
    assert.deepEqual(cells.at(-1), {col: 14, row: 10});
    for (const {col, row} of cells) {
        const inside = col >= 11 && col <= 13 && row >= 7 && row <= 9;
        assert.equal(inside, false);
        assert.ok(col >= 10 && col <= 14 && row >= 6 && row <= 10);
    }
});

test('placing HQ creates the permanent ring in the same step', () => {
    const {roads} = hqGame();
    assert.equal(roads.tiles().length, 16);
    assert.ok(roads.tiles().every((t) => t.kind === HQ_RING));
    assert.equal(roads.connectedTiles().length, 16);
    assert.deepEqual(roads.snapshot().connected, 16);
});

test('the whole 5x5 must fit: HQ cannot touch any map edge', () => {
    const rejected = [[1, 8], [22, 8], [12, 1], [12, 14], [1, 1], [22, 14]];
    for (const [col, row] of rejected) {
        const {build, roads, placement, economy} = game();
        const result = build('hq', col, row);
        assert.deepEqual(result, {ok: false, reason: RoadFailure.HQ_RING_OUT_OF_BOUNDS}, `${col},${row}`);
        assert.equal(roads.tiles().length, 0);
        assert.equal(placement.buildings().length, 0);
        assert.equal(placement.hqBuilt, false);
        assert.equal(economy.ap, 20);
    }
    for (const [col, row] of [[2, 2], [21, 2], [2, 13], [21, 13]]) {
        assert.equal(game().build('hq', col, row).ok, true, `${col},${row}`);
    }
});

test('the preview reports a ring that does not fit, and changes nothing', () => {
    const {placement, roads} = game();
    placement.select('hq');
    assert.deepEqual(placement.preview({col: 1, row: 1}).reason, RoadFailure.HQ_RING_OUT_OF_BOUNDS);
    assert.equal(placement.preview({col: 12, row: 8}).ok, true);
    assert.equal(roads.tiles().length, 0);
});

test('a ring cannot go over an existing building', () => {
    const {grid, roads} = network();
    grid.place('outpost-1', {col: 10, row: 6, width: 1, height: 1});
    assert.deepEqual(roads.addHqRing(HQ_AT), {ok: false, reason: RoadFailure.OCCUPIED});
    assert.equal(roads.tiles().length, 0);
});

// ---- Adding roads -----------------------------------------------------------------

test('roads extend the connected network orthogonally', () => {
    const {roads} = ringed();
    assert.equal(roads.add({col: 12, row: 5}).ok, true);
    assert.equal(roads.add({col: 12, row: 4}).ok, true);
    assert.equal(roads.tiles().find((t) => t.col === 12 && t.row === 4).kind, PLAYER_ROAD);
    assert.equal(roads.connectedTiles().length, 18);
});

test('a tile touching the network only diagonally is rejected', () => {
    const {roads} = ringed();
    assert.deepEqual(roads.add({col: 9, row: 5}), {ok: false, reason: RoadFailure.NOT_CONNECTED});
    assert.deepEqual(roads.add({col: 2, row: 2}), {ok: false, reason: RoadFailure.NOT_CONNECTED});
    assert.equal(roads.tiles().length, 16);
});

test('bounds, existing roads and buildings are rejected', () => {
    const {grid, roads} = ringed();
    grid.place('outpost-1', {col: 12, row: 5, width: 1, height: 1});
    for (const [cell, reason] of [
        [{col: -1, row: 0}, RoadFailure.OUT_OF_BOUNDS],
        [{col: 24, row: 0}, RoadFailure.OUT_OF_BOUNDS],
        [{col: 0, row: 16}, RoadFailure.OUT_OF_BOUNDS],
        [{col: 1.5, row: 0}, RoadFailure.OUT_OF_BOUNDS],
        [{col: 10, row: 6}, RoadFailure.ROAD_EXISTS],
        [{col: 12, row: 5}, RoadFailure.OCCUPIED],
    ]) assert.deepEqual(roads.add(cell), {ok: false, reason}, JSON.stringify(cell));
    assert.equal(roads.tiles().length, 16);
});

test('a new road tile costs 2 Credits and no AP; the HQ ring is free and removal refunds nothing', () => {
    const {placement, economy} = hqGame({credits: 0, ap: 0});
    assert.deepEqual(economy.snapshot(), {credits: 0, ap: 0}, 'the HQ ring cost nothing');
    assert.deepEqual(placement.previewRoad({col: 12, row: 5}), {ok: false, reason: 'insufficient-credits'});
    assert.deepEqual(placement.placeRoad({col: 12, row: 5}), {ok: false, reason: 'insufficient-credits'});
    economy.adjustCredits(3);
    assert.equal(placement.placeRoad({col: 12, row: 5}).ok, true);
    assert.deepEqual(economy.snapshot(), {credits: 1, ap: 0});
    assert.equal(placement.removeRoad({col: 12, row: 5}).ok, true);
    assert.deepEqual(economy.snapshot(), {credits: 1, ap: 0});
    assert.equal(placement.placeRoad({col: 12, row: 5}).reason, 'insufficient-credits', 'space comes back, the 2 Credits do not');
});

test('roads never touch the Grid, so they cannot affect combat rules', () => {
    const {grid, placement} = hqGame();
    const before = grid.snapshot();
    placement.placeRoad({col: 12, row: 5});
    assert.deepEqual(grid.snapshot(), before);
    assert.equal(grid.occupantAt(12, 5), null);
    assert.equal(grid.occupantAt(10, 6), null);
});

test('construction rules gate roads at Night', () => {
    const {placement, roads, close} = hqGame();
    assert.equal(placement.placeRoad({col: 12, row: 5}).ok, true);
    close();
    assert.deepEqual(placement.placeRoad({col: 12, row: 4}), {ok: false, reason: CONSTRUCTION_DISABLED});
    assert.deepEqual(placement.removeRoad({col: 12, row: 5}), {ok: false, reason: CONSTRUCTION_DISABLED});
    assert.deepEqual(placement.previewRoad({col: 12, row: 4}), {ok: false, reason: CONSTRUCTION_DISABLED});
    assert.deepEqual(placement.previewRoadRemoval({col: 12, row: 5}), {ok: false, reason: CONSTRUCTION_DISABLED});
    assert.equal(roads.tiles().length, 17);
});

// ---- Buildings and roads ----------------------------------------------------------

test('nothing can be built on a road', () => {
    const {build, placement, economy} = hqGame();
    placement.placeRoad({col: 12, row: 5});
    const before = economy.snapshot();
    assert.deepEqual(build('autocannon', 10, 6), {ok: false, reason: RoadFailure.ROAD_OCCUPIED});
    assert.deepEqual(build('outpost', 14, 10), {ok: false, reason: RoadFailure.ROAD_OCCUPIED});
    assert.deepEqual(build('powerPlant', 12, 4), {ok: false, reason: RoadFailure.ROAD_OCCUPIED});
    assert.deepEqual(economy.snapshot(), before);
    assert.equal(placement.buildings().length, 1);
});

test('a road cannot go on a building', () => {
    const {build, placement} = hqGame();
    assert.equal(build('outpost', 12, 5).ok, true);
    assert.deepEqual(placement.placeRoad({col: 12, row: 5}), {ok: false, reason: RoadFailure.OCCUPIED});
});

test('space is checked before resources', () => {
    const {build} = hqGame({credits: 0, ap: 0});
    assert.deepEqual(build('factory', 3, 3), {ok: false, reason: RoadFailure.NO_ROAD_ACCESS});
    assert.deepEqual(build('outpost', 10, 6), {ok: false, reason: RoadFailure.ROAD_OCCUPIED});
    assert.equal(build('factory', 8, 8).reason, 'insufficient-credits');
});

test('a Factory with no road on its dock tile is rejected', () => {
    const {build, placement, economy} = hqGame();
    const before = economy.snapshot();
    assert.deepEqual(build('factory', 8, 4), {ok: false, reason: RoadFailure.NO_ROAD_ACCESS});
    assert.deepEqual(economy.snapshot(), before);
    assert.equal(placement.buildings().length, 1);
});

test('a Factory reaches further along a player road', () => {
    const {build, placement} = hqGame();
    for (const row of [5, 4, 3]) assert.equal(placement.placeRoad({col: 10, row}).ok, true);
    assert.equal(build('factory', 8, 3).ok, true);
});

test('other buildings need no road', () => {
    const {build} = hqGame();
    for (const [type, col, row] of [['powerPlant', 3, 3], ['autocannon', 20, 2], ['outpost', 2, 12]]) {
        assert.equal(build(type, col, row).ok, true, type);
    }
});

test('without a RoadNetwork, none of these rules exist', () => {
    const grid = new Grid({cols: 24, rows: 16, tileSize: 32});
    const placement = new BuildingPlacement(grid, new Economy({credits: 5000, ap: 20}));
    placement.select('factory');
    assert.equal(placement.placeAt({col: 3, row: 3}).ok, true);
    placement.select('hq');
    assert.equal(placement.placeAt({col: 1, row: 14}).ok, true);
});

// ---- Removal ----------------------------------------------------------------------

test('HQ ring tiles are permanent', () => {
    const {placement, roads} = hqGame();
    for (const cell of hqRingCells(HQ_AT)) {
        assert.deepEqual(placement.removeRoad(cell), {ok: false, reason: RoadFailure.HQ_RING_PERMANENT});
    }
    assert.equal(roads.tiles().length, 16);
});

test('unknown tiles cannot be removed', () => {
    const {placement} = hqGame();
    assert.deepEqual(placement.removeRoad({col: 0, row: 0}), {ok: false, reason: RoadFailure.UNKNOWN_ROAD});
    assert.deepEqual(placement.removeRoad({col: -1, row: 0}), {ok: false, reason: RoadFailure.UNKNOWN_ROAD});
});

test('a road a Factory depends on cannot be removed', () => {
    const {build, placement, roads} = hqGame();
    placement.placeRoad({col: 10, row: 5});
    placement.placeRoad({col: 10, row: 4});
    assert.equal(build('factory', 8, 4).ok, true); // touches 10,4 and 10,5 on its right edge
    assert.deepEqual(placement.removeRoad({col: 10, row: 5}), {ok: false, reason: RoadFailure.ROAD_REQUIRED});
    assert.equal(roads.has({col: 10, row: 5}), true);
});

test('a road can go when another connected route still serves the Factory', () => {
    const {build, placement, roads} = hqGame();
    for (const [col, row] of [[10, 5], [10, 4], [11, 4], [11, 5]]) placement.placeRoad({col, row});
    assert.equal(build('factory', 8, 4).ok, true); // dock 10,4
    assert.equal(placement.removeRoad({col: 10, row: 5}).ok, true); // 11,4 and 11,5 still connect it
    assert.equal(roads.has({col: 10, row: 5}), false);
});

test('a loop keeps a Factory served when one side is removed', () => {
    const {build, placement} = hqGame();
    // Two routes from the ring to 10,2, then one tile on to the Factory at 9,2.
    for (const cell of [[10, 5], [10, 4], [10, 3], [10, 2], [9, 2], [12, 5], [12, 4], [12, 3], [12, 2], [11, 2]]) {
        assert.equal(placement.placeRoad({col: cell[0], row: cell[1]}).ok, true, String(cell));
    }
    assert.equal(placement.placeRoad({col: 10, row: 2}).reason, RoadFailure.ROAD_EXISTS);
    assert.equal(build('factory', 7, 2).ok, true); // dock 9,2
    assert.equal(placement.removeRoad({col: 10, row: 4}).ok, true); // the other side still connects
    assert.deepEqual(placement.removeRoad({col: 12, row: 4}), {ok: false, reason: RoadFailure.ROAD_REQUIRED});
});

test('removing a road may leave a harmless disconnected fragment', () => {
    const {placement, roads} = hqGame();
    for (const row of [5, 4, 3]) placement.placeRoad({col: 12, row});
    assert.equal(placement.removeRoad({col: 12, row: 5}).ok, true);
    assert.equal(roads.tiles().length, 18);
    assert.equal(roads.connectedTiles().length, 16);
    assert.deepEqual(roads.snapshot().connected, 16);
});

test('a fragment gives no Factory access and cannot be extended', () => {
    const {build, placement} = hqGame();
    for (const row of [5, 4, 3]) placement.placeRoad({col: 12, row});
    placement.removeRoad({col: 12, row: 5});
    assert.deepEqual(build('factory', 10, 3), {ok: false, reason: RoadFailure.NO_ROAD_ACCESS}); // its dock is on the fragment
    assert.deepEqual(placement.placeRoad({col: 12, row: 2}), {ok: false, reason: RoadFailure.NOT_CONNECTED});
});

test('a new tile reconnects a fragment', () => {
    const {placement, roads} = hqGame();
    for (const row of [5, 4, 3]) placement.placeRoad({col: 12, row});
    placement.removeRoad({col: 12, row: 5});
    assert.equal(placement.placeRoad({col: 12, row: 5}).ok, true);
    assert.equal(roads.connectedTiles().length, 19);
});

test('a destroyed Factory stops protecting its road, and roads survive it', () => {
    const {build, placement, roads} = hqGame();
    placement.placeRoad({col: 10, row: 5});
    placement.placeRoad({col: 10, row: 4});
    const {building} = build('factory', 8, 4);
    assert.equal(placement.damageBuilding(building.id, 300).destroyed, true);
    assert.equal(roads.tiles().length, 18);
    assert.equal(placement.removeRoad({col: 10, row: 5}).ok, true);
});

// ---- Queries ----------------------------------------------------------------------

test('neighbors have a stable, documented order', () => {
    const {roads} = ringed();
    roads.add({col: 12, row: 5});
    assert.deepEqual(roads.neighbors({col: 12, row: 6}), [{col: 12, row: 5}, {col: 13, row: 6}, {col: 11, row: 6}]);
});

test('tiles and snapshots are detached and independent of build order', () => {
    const a = ringed();
    const b = ringed();
    a.roads.add({col: 12, row: 5});
    a.roads.add({col: 11, row: 5});
    b.roads.add({col: 11, row: 5});
    b.roads.add({col: 12, row: 5});
    assert.deepEqual(a.roads.tiles(), b.roads.tiles());
    const tiles = a.roads.tiles();
    tiles[0].col = 99;
    assert.notEqual(a.roads.tiles()[0].col, 99);
    assert.deepEqual(JSON.parse(JSON.stringify(a.roads.snapshot())), a.roads.snapshot());
});

// ---- Combat independence ----------------------------------------------------------

test('roads do not change combat: identical digests with and without them', () => {
    const run = (roads) => {
        const w = createWorld({seed: 98, resources: {credits: 5000, ap: 20}, requireHq: true, roads, schedule: [100, 110, 120, 700, 720]});
        // No Factory, so no truck: this isolates the roads themselves.
        for (const [type, col, row] of [['hq', 12, 8], ['powerPlant', 12, 4], ['outpost', 8, 8], ['autocannon', 15, 4]]) {
            assert.equal(w.place(type, col, row).ok, true, type);
        }
        if (roads) for (const cell of [{col: 15, row: 6}, {col: 15, row: 7}]) w.roads.add(cell);
        let shots = 0;
        for (let night = 0; night < 3 && w.cycle.shift === Shift.DAY; night++) {
            w.cycle.endDay();
            while (w.cycle.shift === Shift.NIGHT) w.cycle.stepTicks(240, (t) => { shots += w.tick(t).defense.shots.length; });
        }
        assert.ok(shots > 0);
        return digestOf(canonicalState(worldState(w)));
    };
    assert.equal(run(true), run(false));
});
