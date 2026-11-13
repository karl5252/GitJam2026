/** Spawn eligibility follows the current, connected jungle, not the fixed inner frame. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Grid} from '../../src/core/grid.js';
import {BRUTE, MIN_SPAWN_JUNGLE, SPITTER, borderSpawns, jungleSpawnSites} from '../../src/core/mutants.js';
import {DUSK_TICKS} from '../../src/core/shiftCycle.js';
import {Terrain, TerrainKind} from '../../src/core/terrain.js';
import {WORLD_MAPS, createTerrain} from '../../src/core/worldMap.js';
import {createWorld} from '../soak/harness.js';

const MAP = WORLD_MAPS.jungle;
const FRAME = MAP.spawnFrame;
const frameEdge = ({col, row}) => col <= FRAME.col || col >= FRAME.col + FRAME.cols - 1
    || row <= FRAME.row || row >= FRAME.row + FRAME.rows - 1;
const realGrid = (seed = MAP.seed) => new Grid({cols: MAP.cols, rows: MAP.rows, tileSize: MAP.tileSize, terrain: createTerrain(MAP, seed)});

/** A separate BFS assertion: the candidate has at least four forest tiles and reaches the world edge. */
function exteriorComponent(terrain, origin) {
    const key = ({col, row}) => `${col},${row}`;
    const seen = new Set([key(origin)]);
    const queue = [origin];
    let touchesEdge = false;
    for (let head = 0; head < queue.length; head++) {
        const {col, row} = queue[head];
        if (col === 0 || row === 0 || col === terrain.cols - 1 || row === terrain.rows - 1) touchesEdge = true;
        for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
            const next = {col: col + dc, row: row + dr};
            if (terrain.kindAt(next.col, next.row) !== TerrainKind.JUNGLE || seen.has(key(next))) continue;
            seen.add(key(next));
            queue.push(next);
        }
    }
    return {size: seen.size, touchesEdge};
}

function artificialGrid(jungle) {
    const cols = 12;
    const rows = 10;
    const cells = new Uint8Array(cols * rows).fill(1); // CLEARING; jungle is 0
    for (const [col, row] of jungle) cells[row * cols + col] = 0;
    const terrain = new Terrain({seed: 1, cols, rows, cells, center: {col: 6, row: 5}, core: {col: 5, row: 4, width: 3, height: 3}, path: []});
    return new Grid({cols, rows, tileSize: 32, terrain});
}

const smallFrame = {col: 3, row: 2, cols: 6, rows: 6};

const freshWorld = ({schedule = [1], rng = null} = {}) => {
    const gridTerrain = createTerrain(MAP, MAP.seed);
    const w = createWorld({map: MAP, terrain: gridTerrain, requireHq: true, roads: true, resources: {credits: 9000, ap: 40}, schedule, rng});
    const {col, row} = gridTerrain.center;
    assert.equal(w.place('hq', col, row).ok, true);
    return w;
};

const advance = (w, ticks, onTick = () => {}) => {
    let remaining = ticks;
    while (remaining > 0) {
        const n = w.cycle.stepTicks(Math.min(240, remaining), (t) => onTick(w.tick(t)));
        if (n === 0) break;
        remaining -= n;
    }
};

test('real jungle spawn candidates are on or outside the old ring, on exterior-connected clusters of at least four tiles', () => {
    assert.equal(MIN_SPAWN_JUNGLE, 4);
    for (const seed of [MAP.seed, 1, 2, 42, 999]) {
        const grid = realGrid(seed);
        const slots = borderSpawns(grid, FRAME);
        const sites = jungleSpawnSites(grid, FRAME);
        assert.equal(sites.length, slots.length);
        assert.equal(sites.length, 80);
        for (const site of sites) {
            assert.ok(site, `seed ${seed} has no external jungle`);
            assert.equal(grid.terrain.kindAt(site.col, site.row), TerrainKind.JUNGLE);
            assert.equal(grid.occupantAt(site.col, site.row), null);
            assert.ok(frameEdge(site), `${site.col},${site.row} is inside the developed interior`);
            assert.deepEqual({x: site.x, y: site.y}, grid.cellCenter(site.col, site.row));
            const component = exteriorComponent(grid.terrain, site);
            assert.equal(component.touchesEdge, true);
            assert.ok(component.size >= MIN_SPAWN_JUNGLE);
        }
    }
});

test('an isolated four-tile pocket inside a fortress is excluded even with enough trees', () => {
    const exterior = Array.from({length: 6}, (_, col) => [col + 3, 0]);
    const pocket = [[4, 3], [5, 3], [4, 4], [5, 4]];
    const grid = artificialGrid([...exterior, ...pocket]);
    const sites = jungleSpawnSites(grid, smallFrame);
    assert.ok(sites.every((site) => site && site.row === 0), 'the enclosed 2x2 pocket must never be used');
});

test('clusters smaller than four cannot spawn, even when they touch the map edge', () => {
    const grid = artificialGrid([[4, 0], [5, 0], [6, 0]]);
    assert.ok(jungleSpawnSites(grid, smallFrame).every((site) => site === null));
    // Growing that same edge-connected component to four makes it eligible.
    const other = artificialGrid([[4, 0], [5, 0], [6, 0], [7, 0]]);
    assert.ok(jungleSpawnSites(other, smallFrame).every((site) => site?.row === 0));
});

test('clearing the old frame moves entrances into nearby exterior jungle rather than into the developed base', () => {
    const grid = realGrid();
    for (let col = FRAME.col; col < FRAME.col + FRAME.cols; col++) {
        grid.terrain.clear(col, FRAME.row);
        grid.terrain.clear(col, FRAME.row + FRAME.rows - 1);
    }
    for (let row = FRAME.row; row < FRAME.row + FRAME.rows; row++) {
        grid.terrain.clear(FRAME.col, row);
        grid.terrain.clear(FRAME.col + FRAME.cols - 1, row);
    }
    const slots = borderSpawns(grid, FRAME);
    const sites = jungleSpawnSites(grid, FRAME, slots);
    for (const site of sites) {
        assert.ok(site);
        assert.equal(grid.terrain.kindAt(site.col, site.row), TerrainKind.JUNGLE);
        assert.ok(site.col < FRAME.col || site.col >= FRAME.col + FRAME.cols
            || site.row < FRAME.row || site.row >= FRAME.row + FRAME.rows);
    }
    assert.ok(sites.some((site, i) => Math.abs(site.col - slots[i].col) + Math.abs(site.row - slots[i].row) <= 2),
        'some mutants still emerge close to the former frame, not at the world border');
});

test('the cached candidates refresh on terrain revision, without any extra RNG draws', () => {
    const rng = {draws: 0, nextInt(min, max) {
        assert.deepEqual([min, max], [0, 79]);
        this.draws++;
        return 0;
    }};
    const w = freshWorld({schedule: [1, 2], rng});
    const first = jungleSpawnSites(w.grid, FRAME)[0];
    w.cycle.endDay();
    advance(w, 1);
    const spawned = w.mutants.snapshot()[0];
    assert.deepEqual({x: spawned.x, y: spawned.y}, {x: first.x, y: first.y});
    assert.equal(rng.draws, 1);
    assert.equal(w.grid.terrain.clear(first.col, first.row), true);
    const second = jungleSpawnSites(w.grid, FRAME)[0];
    assert.notDeepEqual({col: first.col, row: first.row}, {col: second.col, row: second.row});
    advance(w, 1);
    const next = w.mutants.snapshot()[1];
    assert.deepEqual({x: next.x, y: next.y}, {x: second.x, y: second.y});
    assert.equal(rng.draws, 2);
});

test('ordinary, Spitter and Brute all use the jungle rule and preserve the planned composition', () => {
    const slots = [0, 24, 45];
    const t = createTerrain(MAP, MAP.seed);
    const other = createWorld({map: MAP, terrain: t, requireHq: true, resources: {credits: 9000, ap: 40},
        schedule: [1, 2, 3], spitterSlots: [1], bruteSlots: [2], rng: {draws: 0, nextInt(min, max) { assert.deepEqual([min, max], [0, 79]); return slots[this.draws++]; }} });
    const {col, row} = t.center;
    assert.equal(other.place('hq', col, row).ok, true);
    other.cycle.endDay();
    const snapshots = [];
    advance(other, 3, ({effects}) => {
        for (const id of effects.spawned) snapshots.push(other.mutants.snapshot().find((m) => m.id === id));
    });
    assert.equal(snapshots.length, 3);
    assert.deepEqual(snapshots.map((m) => m.kind ?? 'ordinary'), ['ordinary', SPITTER.kind, BRUTE.kind]);
    for (const m of snapshots) {
        const cell = other.grid.worldToCell(m.x, m.y);
        assert.equal(t.kindAt(cell.col, cell.row), TerrainKind.JUNGLE);
        assert.deepEqual({x: m.x, y: m.y}, other.grid.cellCenter(cell.col, cell.row));
    }
});

test('when no qualifying jungle survives, enemies enter from outside the real world instead of cleared tiles', () => {
    const w = freshWorld({rng: {nextInt: () => 0}});
    const terrain = w.grid.terrain;
    for (let row = 0; row < MAP.rows; row++) for (let col = 0; col < MAP.cols; col++) terrain.clear(col, row);
    assert.ok(jungleSpawnSites(w.grid, FRAME).every((site) => site === null));
    w.cycle.endDay();
    advance(w, 1);
    const [m] = w.mutants.snapshot();
    assert.ok(m);
    assert.equal(w.grid.worldToCell(m.x, m.y), null, 'must not appear on cleared land');
    assert.equal(m.y, w.grid.originY - 0.5);
});

test('the same seed, clearings and commands produce the same Night and RNG state', () => {
    const worlds = [freshWorld(), freshWorld()];
    const frame = FRAME;
    for (const w of worlds) {
        for (let col = frame.col; col < frame.col + frame.cols; col++) w.grid.terrain.clear(col, frame.row);
        w.cycle.endDay();
    }
    for (let i = 0; i < DUSK_TICKS + 100; i++) {
        for (const w of worlds) advance(w, 1);
    }
    assert.deepEqual(worlds[0].mutants.snapshot(), worlds[1].mutants.snapshot());
    assert.deepEqual(worlds[0].rng.snapshot(), worlds[1].rng.snapshot());
});
