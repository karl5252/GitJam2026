import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PlacementFailure, Grid} from '../../src/core/grid.js';
import {BUILDING_TYPES} from '../../src/core/buildingTypes.js';
import {borderSpawns} from '../../src/core/mutants.js';
import {RoadFailure, hqRingCells} from '../../src/core/roads.js';
import {DEFAULT_SEED} from '../../src/core/seededRandom.js';
import {CLEARING, TerrainKind, generateJungle, mixSeed} from '../../src/core/terrain.js';
import {DEFAULT_MAP, MapId, WORLD_MAPS, createTerrain, getWorldMap} from '../../src/core/worldMap.js';
import {LayoutFailure, exportLayout, loadLayout} from '../../src/testShadow/layoutSnapshot.js';
import {parseWorldParams} from '../../src/testShadow/worldParams.js';
import {createWorld, digestOf, worldState} from '../soak/harness.js';

const JUNGLE = WORLD_MAPS[MapId.JUNGLE];
const OPEN = WORLD_MAPS[MapId.OPEN];
const SEEDS = Array.from({length: 200}, (_, i) => i * 7 + 1);
const SOME_SEEDS = [DEFAULT_SEED, 1, 2, 3, 42, 99, 1000, 65535, 123456789, 4294967295];
const FUNDS = {credits: 9000, ap: 30};
const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/layouts/${name}.json`, import.meta.url), 'utf8'));

const terrainOf = (seed = JUNGLE.seed) => createTerrain(JUNGLE, seed);
const jungleWorld = (options = {}) => {
    const {seed, ...rest} = options;
    const terrain = terrainOf(seed);
    return createWorld({requireHq: true, roads: true, resources: FUNDS, map: JUNGLE, terrain, ...rest});
};

function cellsOf(terrain, kinds) {
    const cells = [];
    for (let row = 0; row < terrain.rows; row++) {
        for (let col = 0; col < terrain.cols; col++) {
            if (kinds.includes(terrain.kindAt(col, row))) cells.push({col, row});
        }
    }
    return cells;
}

/** Everything reachable from `start` by orthogonal steps over `allowed` tiles. */
function flood(terrain, starts, allowed) {
    const key = ({col, row}) => row * terrain.cols + col;
    const seen = new Map(starts.map((cell) => [key(cell), cell]));
    const queue = [...starts];
    while (queue.length > 0) {
        const {col, row} = queue.pop();
        for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
            const next = {col: col + dc, row: row + dr};
            if (!allowed.includes(terrain.kindAt(next.col, next.row)) || seen.has(key(next))) continue;
            seen.set(key(next), next);
            queue.push(next);
        }
    }
    return [...seen.values()];
}

const onEdge = ({col, row}, {cols, rows}) => col === 0 || row === 0 || col === cols - 1 || row === rows - 1;
const place = (w, type, col, row) => {
    const result = w.place(type, col, row);
    assert.equal(result.ok, true, `${type} at ${col},${row}: ${result.reason}`);
    return result.building;
};

// ---- Map configuration -------------------------------------------------------

test('new games get the 48x32 jungle, on 32 px tiles and a fixed seed', () => {
    assert.equal(DEFAULT_MAP, MapId.JUNGLE);
    assert.deepEqual([JUNGLE.cols, JUNGLE.rows, JUNGLE.tileSize, JUNGLE.seed], [48, 32, 32, DEFAULT_SEED]);
});

test('the open map is still the original 24x16 battlefield, with no terrain and no frame', () => {
    assert.deepEqual([OPEN.cols, OPEN.rows, OPEN.tileSize, OPEN.spawnFrame], [24, 16, 32, null]);
    assert.equal(createTerrain(OPEN), null);
});

test('getWorldMap knows the maps and nothing else', () => {
    assert.equal(getWorldMap('open'), OPEN);
    assert.equal(getWorldMap('jungle'), JUNGLE);
    for (const id of ['', 'toString', 'Jungle', null, undefined]) assert.equal(getWorldMap(id), null);
});

test('parseWorldParams reads a known map and a valid seed, and ignores anything else', () => {
    assert.deepEqual(parseWorldParams('?map=open&worldSeed=9'), {map: OPEN, worldSeed: 9});
    assert.deepEqual(parseWorldParams('?testMode'), {map: null, worldSeed: null});
    assert.deepEqual(parseWorldParams('?map=moon&worldSeed=-1'), {map: null, worldSeed: null});
});

// ---- Generation ----------------------------------------------------------------

test('the same seed and settings give the same terrain, tile for tile', () => {
    for (const seed of SOME_SEEDS) assert.deepEqual(terrainOf(seed).snapshot(), terrainOf(seed).snapshot());
});

test('the shipped terrain never changes by accident', () => {
    assert.equal(digestOf(JSON.stringify(terrainOf().snapshot())), '539ec3322f4954b1');
});

test('seeds give different maps, including neighbouring seeds, which a plain LCG would not', () => {
    const maps = new Set(SEEDS.map((seed) => JSON.stringify(terrainOf(seed).snapshot().rows)));
    assert.equal(maps.size, SEEDS.length);
    assert.notEqual(mixSeed(1) - mixSeed(2), 1);
    const sides = new Set(SEEDS.map((seed) => {
        const [start] = terrainOf(seed).path;
        if (start.row === 0) return 'N';
        if (start.col === 0) return 'W';
        return start.row === JUNGLE.rows - 2 ? 'S' : 'E';
    }));
    assert.equal(sides.size, 4);
});

test('a seed that is not a uint32 is refused rather than quietly changed', () => {
    for (const seed of [-1, 1.5, 2 ** 32, Number.NaN]) assert.throws(() => terrainOf(seed), RangeError);
});

test('terrain is read-only', () => {
    const terrain = terrainOf();
    assert.throws(() => { terrain.seed = 1; }, TypeError);
    assert.throws(() => { terrain.core.col = 1; }, TypeError);
    assert.throws(() => { terrain.path.push({}); }, TypeError);
    const snapshot = terrain.snapshot();
    snapshot.rows[0] = 'changed';
    snapshot.core.col = -5;
    assert.notEqual(terrain.snapshot().rows[0], 'changed');
    assert.notEqual(terrain.core.col, -5);
});

test('kindAt is null off the map, and off-map tiles are not buildable', () => {
    const terrain = terrainOf();
    for (const [col, row] of [[-1, 0], [0, -1], [48, 0], [0, 32], [1.5, 0]]) {
        assert.equal(terrain.kindAt(col, row), null);
        assert.equal(terrain.isBuildable(col, row), false);
    }
});

// ---- The clearing --------------------------------------------------------------

test('on every seed the core rectangle is entirely open', () => {
    for (const seed of SEEDS) {
        const terrain = terrainOf(seed);
        const {col, row, width, height} = terrain.core;
        assert.deepEqual([width, height], [CLEARING.core.width, CLEARING.core.height]);
        for (let r = row; r < row + height; r++) {
            for (let c = col; c < col + width; c++) assert.equal(terrain.isBuildable(c, r), true, `seed ${seed} at ${c},${r}`);
        }
    }
});

test('on every seed the clearing is one piece with no pockets of jungle in it', () => {
    for (const seed of SEEDS) {
        const terrain = terrainOf(seed);
        const open = [TerrainKind.CLEARING, TerrainKind.PATH];
        assert.equal(flood(terrain, [terrain.center], open).length, cellsOf(terrain, open).length, `seed ${seed}: split`);
        const jungle = cellsOf(terrain, [TerrainKind.JUNGLE]);
        const outer = flood(terrain, jungle.filter((cell) => onEdge(cell, terrain)), [TerrainKind.JUNGLE]);
        assert.equal(outer.length, jungle.length, `seed ${seed}: a pocket of jungle`);
    }
});

test('on every seed the clearing sits inside the spawn frame, with jungle between them', () => {
    const {col, row, cols, rows} = JUNGLE.spawnFrame;
    for (const seed of SEEDS) {
        for (const cell of cellsOf(terrainOf(seed), [TerrainKind.CLEARING])) {
            assert.ok(cell.col > col && cell.col < col + cols - 1 && cell.row > row && cell.row < row + rows - 1, `seed ${seed}: ${JSON.stringify(cell)}`);
        }
    }
});

test('on every seed the clearing is irregular and small, and the jungle dominates the map', () => {
    for (const seed of SEEDS) {
        const terrain = terrainOf(seed);
        const clearing = cellsOf(terrain, [TerrainKind.CLEARING, TerrainKind.PATH]);
        const rows = terrain.snapshot().rows.filter((line) => line.includes('.'));
        assert.ok(new Set(rows.map((line) => line.replaceAll('=', '.').indexOf('.'))).size >= 3, `seed ${seed}: a straight edge`);
        assert.ok(cellsOf(terrain, [TerrainKind.JUNGLE]).length / (48 * 32) > 0.75, `seed ${seed}: too little jungle`);
        assert.ok(clearing.length >= 130, `seed ${seed}: only ${clearing.length} open tiles`);
    }
});

test('on every seed a full opening fits through the real rules: HQ and ring, Factory on a road, Plant, cannons, Barracks', () => {
    for (const seed of SEEDS.slice(0, 60)) {
        const w = jungleWorld({seed});
        const {center: {col, row}} = w.grid.terrain;
        place(w, 'hq', col, row);
        assert.equal(w.placement.placeRoad({col: col - 3, row}).ok, true, `seed ${seed}: road`);
        place(w, 'factory', col - 5, row);
        place(w, 'powerPlant', col + 4, row - 2);
        place(w, 'autocannon', col - 1, row - 3);
        place(w, 'autocannon', col + 1, row - 3);
        place(w, 'autocannon', col - 1, row + 3);
        place(w, 'autocannon', col + 1, row + 3);
        assert.equal(w.placement.placeRoad({col: col + 3, row: row + 2}).ok, true, `seed ${seed}: exit road`);
        place(w, 'barracks', col + 5, row + 2);
    }
});

// ---- The dirt path -------------------------------------------------------------

test('on every seed the path is one unbroken track from a map edge into the clearing', () => {
    for (const seed of SEEDS) {
        const terrain = terrainOf(seed);
        const tiles = cellsOf(terrain, [TerrainKind.PATH]);
        assert.ok(tiles.some((cell) => onEdge(cell, terrain)), `seed ${seed}: never reaches an edge`);
        assert.equal(flood(terrain, [tiles[0]], [TerrainKind.PATH]).length, tiles.length, `seed ${seed}: broken`);
        const touching = tiles.some(({col, row}) => [[0, 1], [1, 0], [0, -1], [-1, 0]]
            .some(([dc, dr]) => terrain.kindAt(col + dc, row + dr) === TerrainKind.CLEARING));
        assert.ok(touching, `seed ${seed}: never meets the clearing`);
        for (const [a, b] of terrain.path.slice(1).map((cell, i) => [terrain.path[i], cell])) {
            assert.equal(Math.abs(a.col - b.col) + Math.abs(a.row - b.row), 1, `seed ${seed}: the track jumps`);
        }
    }
});

test('the path is not straight', () => {
    const wander = SEEDS.filter((seed) => {
        const {path} = terrainOf(seed);
        return new Set(path.map(({col}) => col)).size > 1 && new Set(path.map(({row}) => row)).size > 1;
    });
    assert.equal(wander.length, SEEDS.length);
});

test('the path is decoration: no road, no dock access, no income, no cost', () => {
    const w = jungleWorld();
    const {terrain} = w.grid;
    const {center: {col, row}} = terrain;
    const before = w.economy.snapshot();
    assert.equal(w.roads.tiles().length, 0);
    place(w, 'hq', col, row);
    assert.equal(w.roads.tiles().length, 16); // the ring, and nothing from the path
    assert.equal(w.economy.credits, before.credits);
    for (const cell of cellsOf(terrain, [TerrainKind.PATH])) {
        if (hqRingCells({col: col - 1, row: row - 1, width: 3, height: 3}).some((ring) => ring.col === cell.col && ring.row === cell.row)) continue;
        assert.equal(w.roads.has(cell), false);
        assert.equal(w.roads.isConnected(cell), false);
    }
    // A Factory whose dock is a path tile still needs a real road there.
    const dock = terrain.path.find((cell) => terrain.isBuildable(cell.col - 1, cell.row)
        && terrain.kindAt(cell.col, cell.row) === TerrainKind.PATH && !w.roads.has(cell));
    w.placement.select('factory');
    const refused = w.placement.placeAt({col: dock.col - 2, row: dock.row});
    w.placement.cancel();
    assert.equal(refused.ok, false);
    assert.equal(w.logistics.snapshot().factories.length, 0);
});

test('path and clearing tiles take buildings and roads like any open ground', () => {
    const w = jungleWorld();
    const {terrain} = w.grid;
    const {center: {col, row}} = terrain;
    place(w, 'hq', col, row);
    const open = cellsOf(terrain, [TerrainKind.PATH]).find((cell) => !w.roads.has(cell) && w.grid.occupantAt(cell.col, cell.row) === null);
    place(w, 'wall', open.col, open.row);
});

// ---- Jungle restrictions -------------------------------------------------------

test('jungle refuses every building type, and spends nothing', () => {
    const w = jungleWorld();
    const {center: {col, row}} = w.grid.terrain;
    place(w, 'hq', col, row);
    const before = w.economy.snapshot();
    for (const {id, gate} of Object.values(BUILDING_TYPES)) {
        if (id === 'hq' || gate) continue;
        w.placement.select(id);
        const result = w.placement.placeAt({col: 5, row: 5});
        const preview = w.placement.preview({col: 5, row: 5});
        w.placement.cancel();
        assert.deepEqual([result.ok, result.reason], [false, PlacementFailure.TERRAIN_BLOCKED], id);
        assert.deepEqual([preview.ok, preview.reason], [false, PlacementFailure.TERRAIN_BLOCKED], id);
    }
    assert.deepEqual(w.economy.snapshot(), before);
    assert.equal(w.placement.buildings().length, 1);
    assert.equal(w.grid.snapshot().occupants.length, 1);
});

test('one jungle tile under a footprint is enough to refuse it', () => {
    const w = jungleWorld();
    const {terrain} = w.grid;
    const edge = cellsOf(terrain, [TerrainKind.CLEARING]).find(({col, row}) => terrain.kindAt(col, row - 1) === TerrainKind.JUNGLE);
    assert.equal(w.grid.canPlace({col: edge.col, row: edge.row, width: 1, height: 1}).ok, true);
    assert.equal(w.grid.canPlace({col: edge.col, row: edge.row - 1, width: 1, height: 2}).reason, PlacementFailure.TERRAIN_BLOCKED);
});

test('HQ needs its whole ring on open ground, even with its own 3x3 clear', () => {
    const w = jungleWorld();
    const {terrain} = w.grid;
    const anchor = cellsOf(terrain, [TerrainKind.CLEARING, TerrainKind.PATH]).find(({col, row}) => {
        const footprint = {col: col - 1, row: row - 1, width: 3, height: 3};
        return w.grid.canPlace(footprint).ok && !w.roads.canAddHqRing(footprint).ok;
    });
    assert.ok(anchor);
    w.placement.select('hq');
    assert.equal(w.placement.placeAt(anchor).reason, RoadFailure.TERRAIN_BLOCKED);
    assert.equal(w.placement.hqBuilt, false);
    assert.equal(w.roads.tiles().length, 0);
});

test('roads stop at the jungle', () => {
    const w = jungleWorld();
    const {terrain} = w.grid;
    const {center: {col, row}} = terrain;
    place(w, 'hq', col, row);
    let c = col - 3;
    while (terrain.isBuildable(c, row)) assert.equal(w.placement.placeRoad({col: c--, row}).ok, true);
    assert.deepEqual(w.placement.placeRoad({col: c, row}), {ok: false, reason: RoadFailure.TERRAIN_BLOCKED});
    assert.equal(w.placement.previewRoad({col: c, row}).reason, RoadFailure.TERRAIN_BLOCKED);
    assert.equal(w.roads.restoreTile({col: c, row}).reason, RoadFailure.TERRAIN_BLOCKED);
});

test('without terrain the grid and roads behave exactly as before', () => {
    const grid = new Grid({cols: 4, rows: 4, tileSize: 32});
    assert.equal(grid.terrain, null);
    assert.equal(grid.isBuildable(0, 0), true);
    assert.equal(grid.isBuildable(4, 0), false);
    assert.equal(Object.hasOwn(grid.snapshot(), 'terrain'), false);
    assert.deepEqual(grid.canPlace({col: 0, row: 0, width: 2, height: 2}), {ok: true});
});

test('an occupied tile still reports occupied, not terrain', () => {
    const w = jungleWorld();
    const {center: {col, row}} = w.grid.terrain;
    place(w, 'hq', col, row);
    assert.equal(w.grid.canPlace({col, row, width: 1, height: 1}).reason, PlacementFailure.OCCUPIED);
});

// ---- Combat is unchanged -------------------------------------------------------

test('the spawn frame is the open map border, at the same world pixels', () => {
    const open = createWorld();
    const jungle = jungleWorld();
    const pixels = (spawns) => spawns.map(({x, y}) => ({x, y}));
    const framed = borderSpawns(jungle.grid, JUNGLE.spawnFrame);
    assert.deepEqual(pixels(framed), pixels(borderSpawns(open.grid)));
    assert.deepEqual(framed[0], {col: 12, row: 8, x: 272, y: 104});
});

test('without a frame the spawns are still the border of the whole map', () => {
    const {grid} = createWorld();
    const spawns = borderSpawns(grid);
    assert.equal(spawns.length, 80);
    assert.deepEqual(spawns[0], {col: 0, row: 0, x: 272, y: 104});
    assert.deepEqual(spawns.at(-1), {col: 0, row: 0, x: 256, y: 120});
});

/** One Night, tick by tick, as digests that hold no tile coordinates. */
function nightTrace(w, day) {
    w.cycle.jumpToDay(day);
    w.cycle.endDay();
    const trace = [];
    let spawned = 0;
    while (w.cycle.shift === 'night') {
        w.cycle.stepTicks(1, (t) => {
            const {effects} = w.tick(t);
            spawned += effects.spawned.length;
        });
        const {mutants, rng, soldiers, shells, buildings} = worldState(w);
        trace.push(digestOf(JSON.stringify({mutants, rng, soldiers, shells, hp: buildings.map((b) => [b.type, b.hp])})));
    }
    return {trace, spawned, shift: w.cycle.shift};
}

for (const [night, label] of [[1, 'Night 1'], [12, 'a Night with Spitters'], [35, 'a Night with Brutes']]) {
    test(`a base in the clearing fights ${label} exactly as it does at those pixels on the open map`, () => {
        const jungle = jungleWorld();
        const open = createWorld({requireHq: true, roads: true, resources: FUNDS});
        const {frame, center} = {frame: JUNGLE.spawnFrame, center: jungle.grid.terrain.center};
        for (const [type, dc, dr] of [['hq', 0, 0], ['powerPlant', 4, 0], ['autocannon', 0, -3], ['autocannon', -3, 3], ['wall', 2, 3], ['wall', 3, 3]]) {
            const [col, row] = [center.col + dc, center.row + dr];
            place(jungle, type, col, row);
            place(open, type, col - frame.col, row - frame.row);
        }
        const a = nightTrace(jungle, night);
        const b = nightTrace(open, night);
        assert.ok(a.spawned > 0);
        assert.equal(a.spawned, b.spawned);
        assert.deepEqual(a.trace, b.trace);
    });
}

test('mutants walk through jungle to reach the base: terrain never stops them', () => {
    const w = jungleWorld();
    const {center: {col, row}} = w.grid.terrain;
    place(w, 'hq', col, row);
    const hq = w.placement.buildings()[0];
    const {shift} = nightTrace(w, 3);
    assert.equal(shift, 'day');
    assert.ok(w.placement.buildings()[0].hp < hq.hp, 'HQ was never reached');
});

test('a wall on the frame, where the path crosses it, does not displace a spawn: the mutant arrives outside it', () => {
    const {spawnFrame} = JUNGLE;
    const seed = SEEDS.find((s) => {
        const terrain = terrainOf(s);
        return terrain.path[0].row === 0 && terrain.kindAt(terrain.path.find((cell) => cell.row === spawnFrame.row).col, spawnFrame.row) === TerrainKind.PATH;
    });
    const probe = terrainOf(seed);
    const {col} = probe.path.find((cell) => cell.row === spawnFrame.row);
    const row = spawnFrame.row;
    const w0 = jungleWorld({seed});
    const index = borderSpawns(w0.grid, spawnFrame).findIndex((spawn) => spawn.col === col && spawn.row === row);
    const w = jungleWorld({seed, schedule: [10], rng: {nextInt: () => index, snapshot: () => ({})}});
    const {center} = w.grid.terrain;
    place(w, 'hq', center.col, center.row);
    place(w, 'wall', col, row);
    w.cycle.endDay();
    w.cycle.stepTicks(10, (t) => w.tick(t));
    const [mutant] = w.mutants.snapshot();
    assert.ok(mutant);
    assert.equal(mutant.y, w.grid.cellToWorld(col, row).y - 0.5);
    assert.equal(mutant.x, w.grid.cellCenter(col, row).x);
});

// ---- Layouts -------------------------------------------------------------------

const canonicalFixture = (snapshot) => JSON.stringify({
    format: snapshot.format,
    version: snapshot.version,
    grid: snapshot.grid,
    buildings: snapshot.buildings,
    roads: [...snapshot.roads].sort((a, b) => (a.row * 24 + a.col) - (b.row * 24 + b.col)),
});

for (const name of ['golden-fortress-day33-v2', 'golden-fortress-brute-defense-v3']) {
    test(`${name} loads on the open map, every coordinate exactly as stored`, () => {
        const snapshot = fixture(name);
        const w = createWorld({requireHq: true, roads: true});
        assert.equal(loadLayout(w, snapshot).ok, true);
        assert.equal(JSON.stringify(exportLayout(w)), canonicalFixture(snapshot));
    });

    test(`${name} is refused on the jungle map, with nothing moved, resized or changed`, () => {
        const snapshot = fixture(name);
        const stored = JSON.stringify(snapshot);
        const w = jungleWorld();
        const before = w.economy.snapshot();
        assert.deepEqual(loadLayout(w, snapshot), {ok: false, reason: LayoutFailure.GRID_MISMATCH});
        assert.equal(JSON.stringify(snapshot), stored);
        assert.deepEqual(w.economy.snapshot(), before);
        assert.equal(w.placement.buildings().length, 0);
    });
}

function jungleBase(options) {
    const w = jungleWorld(options);
    const {center: {col, row}} = w.grid.terrain;
    place(w, 'hq', col, row);
    assert.equal(w.placement.placeRoad({col: col - 3, row}).ok, true);
    place(w, 'factory', col - 5, row);
    place(w, 'powerPlant', col + 4, row);
    return w;
}

test('a jungle layout exports in the same format as ever, and comes back the same', () => {
    const snapshot = exportLayout(jungleBase());
    assert.deepEqual(Object.keys(snapshot), ['format', 'version', 'grid', 'buildings', 'roads']);
    assert.equal(snapshot.version, 1);
    assert.deepEqual(snapshot.grid, {cols: 48, rows: 32});
    const w = jungleWorld();
    assert.equal(loadLayout(w, snapshot).ok, true);
    assert.deepEqual(exportLayout(w), snapshot);
});

test('a layout that puts a building in the jungle fails its dry run, and the live game is untouched', () => {
    const snapshot = exportLayout(jungleBase());
    snapshot.buildings.push({type: 'wall', col: 5, row: 5, enabled: true});
    const w = jungleWorld();
    const before = w.economy.snapshot();
    const result = loadLayout(w, snapshot);
    assert.equal(result.ok, false);
    assert.equal(result.reason, PlacementFailure.TERRAIN_BLOCKED);
    assert.equal(result.applied, undefined);
    assert.deepEqual(w.economy.snapshot(), before);
    assert.equal(w.placement.buildings().length, 0);
    assert.equal(w.placement.hqBuilt, false);
});
