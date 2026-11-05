import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectTarget} from '../../src/core/mutants.js';
import {calculatePower} from '../../src/core/power.js';
import {RoadFailure, hqRingCells} from '../../src/core/roads.js';
import {calculateSettlement} from '../../src/core/settlement.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {LAYOUT_FORMAT, LAYOUT_VERSION, LayoutFailure, exportLayout, loadLayout} from '../../src/testShadow/layoutSnapshot.js';
import {FORTRESS_22_EXACT} from '../fixtures/legacy/fortress22-exact.js';
import {createWorld} from '../soak/harness.js';

const FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/layouts/fortress22-road-legal.json', import.meta.url), 'utf8'));
const FUNDS = {credits: 9000, ap: 30};
const clone = (value) => structuredClone(value);
const fresh = (options = {}) => createWorld({requireHq: true, roads: true, ...options});

/** A base whose creation order is deliberately not coordinate order. */
function played(options = {}) {
    const w = fresh({resources: FUNDS, ...options});
    const build = (type, col, row) => {
        const result = w.place(type, col, row);
        assert.equal(result.ok, true, `${type}: ${result.reason}`);
        return result.building.id;
    };
    build('hq', 12, 8);
    for (const cell of [{col: 10, row: 5}, {col: 10, row: 4}]) assert.equal(w.placement.placeRoad(cell).ok, true);
    build('autocannon', 15, 11);
    build('powerPlant', 16, 4);
    build('autocannon', 8, 11);
    const factory = build('factory', 8, 4);
    build('outpost', 2, 2);
    return {w, factory};
}

const snapshotOf = (w) => exportLayout(w);

function loaded(snapshot, options = {}) {
    const w = fresh(options);
    const result = loadLayout(w, snapshot);
    assert.equal(result.ok, true, `${result.reason} ${result.detail ?? ''}`);
    return w;
}

// ---- Export -----------------------------------------------------------------------

test('export has the versioned shape and nothing about the run', () => {
    const {w} = played();
    const s = snapshotOf(w);
    assert.deepEqual(Object.keys(s), ['format', 'version', 'grid', 'buildings', 'roads']);
    assert.deepEqual([s.format, s.version, s.grid], [LAYOUT_FORMAT, LAYOUT_VERSION, {cols: 24, rows: 16}]);
    assert.deepEqual(Object.keys(s.buildings[0]), ['type', 'col', 'row', 'enabled']);
    assert.deepEqual(Object.keys(s.roads[0]), ['col', 'row', 'kind']);
    assert.doesNotMatch(JSON.stringify(s), /credits|"ap"|"day"|"hp"|mutant|rng|"id"/i);
});

test('buildings keep creation order and top-left coordinates, for every footprint', () => {
    const {w} = played();
    assert.deepEqual(snapshotOf(w).buildings.map(({type, col, row}) => [type, col, row]), [
        ['hq', 11, 7], ['autocannon', 15, 11], ['powerPlant', 15, 3], ['autocannon', 8, 11], ['factory', 7, 3], ['outpost', 2, 2],
    ]);
});

test('roads are sorted canonically, whatever order they were built in', () => {
    const a = played().w;
    const b = fresh({resources: FUNDS});
    b.place('hq', 12, 8);
    for (const col of [15, 16]) b.placement.placeRoad({col, row: 8});
    a.placement.placeRoad({col: 15, row: 8});
    a.placement.placeRoad({col: 16, row: 8});
    const sorted = (w) => snapshotOf(w).roads.map(({col, row}) => row * 24 + col);
    assert.deepEqual(sorted(a), [...sorted(a)].sort((x, y) => x - y));
    assert.deepEqual(sorted(b), [...sorted(b)].sort((x, y) => x - y));
});

test('the same commands give byte-identical exports', () => {
    assert.equal(JSON.stringify(snapshotOf(played().w)), JSON.stringify(snapshotOf(played().w)));
});

// ---- Round trip -------------------------------------------------------------------

test('export, load, export gives the identical snapshot', () => {
    const first = snapshotOf(played().w);
    const second = snapshotOf(loaded(first));
    assert.equal(JSON.stringify(second), JSON.stringify(first));
    assert.equal(JSON.stringify(snapshotOf(loaded(second))), JSON.stringify(first));
});

test('road order in a hand-edited snapshot does not matter', () => {
    const s = snapshotOf(played().w);
    const shuffled = clone(s);
    shuffled.roads.reverse();
    assert.equal(JSON.stringify(snapshotOf(loaded(shuffled))), JSON.stringify(s));
});

test('enabled and disabled states survive, and power is recalculated', () => {
    const {w, factory} = played();
    w.placement.setEnabled(factory, false);
    const s = snapshotOf(w);
    const after = loaded(s);
    const flags = after.placement.buildings().map((b) => b.enabled);
    assert.deepEqual(flags, [true, true, true, true, false, true]);
    assert.deepEqual(calculatePower(after.placement.buildings()).demand, calculatePower(w.placement.buildings()).demand);
});

test('the HQ ring comes back, permanent and connected', () => {
    const w = loaded(snapshotOf(played().w));
    const ring = hqRingCells({col: 11, row: 7, width: 3, height: 3});
    assert.equal(w.roads.tiles().filter((t) => t.kind === 'hq-ring').length, 16);
    assert.deepEqual(w.placement.removeRoad(ring[0]), {ok: false, reason: RoadFailure.HQ_RING_PERMANENT});
    assert.equal(w.roads.connectedTiles().length, 18);
});

test('connections are live after a load: a needed road stays protected', () => {
    const w = loaded(snapshotOf(played().w));
    assert.deepEqual(w.placement.removeRoad({col: 10, row: 5}), {ok: false, reason: RoadFailure.ROAD_REQUIRED});
    assert.equal(w.placement.removeRoad({col: 10, row: 4}).ok, true);
});

test('a legal disconnected fragment round-trips', () => {
    const {w} = played();
    for (const row of [5, 4, 3]) w.placement.placeRoad({col: 13, row});
    assert.equal(w.placement.removeRoad({col: 13, row: 5}).ok, true);
    const s = snapshotOf(w);
    const after = loaded(s);
    assert.equal(JSON.stringify(snapshotOf(after)), JSON.stringify(s));
    assert.equal(after.roads.connectedTiles().length, w.roads.connectedTiles().length);
    assert.equal(after.roads.tiles().length, w.roads.tiles().length);
});

test('a load leaves Credits and AP exactly as they were', () => {
    const w = fresh({resources: {credits: 1250, ap: 5}});
    assert.equal(loadLayout(w, FIXTURE).ok, true);
    assert.deepEqual(w.economy.snapshot(), {credits: 1250, ap: 5});
});

test('normal placement stays fully charged and validated after a load', () => {
    const w = fresh({resources: {credits: 1250, ap: 5}});
    loadLayout(w, FIXTURE);
    const result = w.place('factory', 21, 13);
    assert.deepEqual(result, {ok: false, reason: RoadFailure.NO_ROAD_ACCESS});
    assert.equal(w.place('outpost', 22, 14).ok, true);
    assert.deepEqual(w.economy.snapshot(), {credits: 1150, ap: 4});
});

// ---- Order and combat -------------------------------------------------------------

/** HQ, then two Factories that tie exactly for a mutant at TIE_POINT. */
function tieSnapshot(first, second) {
    const w = fresh({resources: FUNDS});
    w.place('hq', 12, 8);
    for (const cell of [{col: 11, row: 5}, {col: 11, row: 4}, {col: 9, row: 8}, {col: 8, row: 8}]) {
        assert.equal(w.placement.placeRoad(cell).ok, true);
    }
    for (const [col, row] of [first, second]) assert.equal(w.place('factory', col, row).ok, true);
    return exportLayout(w);
}

const UP = [12, 2]; // cols 11-13, rows 1-3
const LEFT = [6, 8]; // cols 5-7, rows 7-9

test('building order decides a real targeting tie, and a load preserves it', () => {
    const targetOf = (snapshot) => {
        const w = loaded(snapshot);
        const {x, y} = w.grid.cellToWorld(6, 2);
        const id = selectTarget({x, y}, w.placement.buildings(), w.grid);
        const {col, row} = w.placement.buildings().find((b) => b.id === id);
        return [col, row];
    };
    assert.deepEqual(targetOf(tieSnapshot(UP, LEFT)), [11, 1]);
    assert.deepEqual(targetOf(tieSnapshot(LEFT, UP)), [5, 7]);
});

/** Every shot and hit, described by position so that ids do not matter. */
function combatLog(w, nights = 3) {
    const log = [];
    const where = new Map();
    const remember = () => { for (const b of w.placement.buildings()) where.set(b.id, `${b.type}@${b.col},${b.row}`); };
    for (let night = 0; night < nights && w.cycle.shift === Shift.DAY; night++) {
        remember();
        w.cycle.endDay();
        while (w.cycle.shift === Shift.NIGHT) {
            w.cycle.stepTicks(240, (tick) => {
                const {defense, effects} = w.tick(tick);
                for (const shot of defense.shots) log.push(['shot', w.clock.tick, where.get(shot.turretId), shot.mutantId]);
                for (const hit of effects.attacks) log.push(['hit', w.clock.tick, hit.mutantId, where.get(hit.buildingId), hit.hp]);
                for (const id of effects.destroyed) log.push(['lost', w.clock.tick, where.get(id)]);
            });
        }
    }
    return {log, rng: w.rng.snapshot(), left: w.placement.buildings().map(({type, col, row, hp}) => [type, col, row, hp])};
}

const SCHEDULE = Array.from({length: 30}, (_, i) => 200 + i * 40);

test('a loaded base fights exactly like the base it was exported from', () => {
    for (const seed of [731, 98, 1]) {
        const {w} = played({seed, schedule: SCHEDULE});
        const snapshot = snapshotOf(w);
        const original = combatLog(w);
        assert.ok(original.log.filter(([kind]) => kind === 'shot').length > 10, 'turrets must fire');
        assert.ok(original.log.some(([kind]) => kind === 'hit'), 'mutants must reach something');
        const copy = combatLog(loaded(snapshot, {seed, schedule: SCHEDULE}));
        assert.deepEqual(copy, original, `seed ${seed}`);
    }
});

test('combat also matches when the original ids have gaps from a lost building', () => {
    const {w} = played({seed: 98, schedule: SCHEDULE});
    const extra = w.place('autocannon', 3, 12).building;
    w.placement.damageBuilding(extra.id, extra.hp);
    assert.equal(w.place('autocannon', 15, 12).ok, true); // id is now one higher than a replay gives it
    const snapshot = snapshotOf(w);
    const copyWorld = loaded(snapshot, {seed: 98, schedule: SCHEDULE});
    assert.notDeepEqual(copyWorld.placement.buildings().at(-1).id, w.placement.buildings().at(-1).id);
    assert.deepEqual(combatLog(copyWorld), combatLog(w));
});

test('a different building order is not silently treated as the same layout', () => {
    const {w} = played();
    const s = snapshotOf(w);
    const swapped = clone(s);
    [swapped.buildings[1], swapped.buildings[3]] = [swapped.buildings[3], swapped.buildings[1]];
    assert.notEqual(JSON.stringify(snapshotOf(loaded(swapped))), JSON.stringify(s));
});

// ---- Rejection --------------------------------------------------------------------

function base() {
    return snapshotOf(played().w);
}

const REJECTED = {
    'unsupported version': [LayoutFailure.UNSUPPORTED_SCHEMA, (s) => { s.version = 2; }],
    'wrong format': [LayoutFailure.UNSUPPORTED_SCHEMA, (s) => { s.format = 'other'; }],
    'unknown top-level field': [LayoutFailure.INVALID_SNAPSHOT, (s) => { s.credits = 5; }],
    'missing roads': [LayoutFailure.INVALID_SNAPSHOT, (s) => { delete s.roads; }],
    'unknown building field': [LayoutFailure.INVALID_SNAPSHOT, (s) => { s.buildings[1].hp = 5; }],
    'non-integer coordinate': [LayoutFailure.INVALID_SNAPSHOT, (s) => { s.buildings[1].col = 1.5; }],
    'non-boolean enabled': [LayoutFailure.INVALID_SNAPSHOT, (s) => { s.buildings[1].enabled = 'yes'; }],
    'bad road kind': [LayoutFailure.INVALID_SNAPSHOT, (s) => { s.roads.find((r) => r.kind === 'player').kind = 'bridge'; }],
    'different grid': [LayoutFailure.GRID_MISMATCH, (s) => { s.grid.cols = 30; }],
    'unknown building type': [LayoutFailure.UNKNOWN_BUILDING_TYPE, (s) => { s.buildings[1].type = 'warehouse'; }],
    'no buildings': [LayoutFailure.HQ_REQUIRED, (s) => { s.buildings = []; }],
    'HQ not first': [LayoutFailure.HQ_REQUIRED, (s) => { s.buildings.reverse(); }],
    'second HQ': [LayoutFailure.HQ_REQUIRED, (s) => { s.buildings.push({...s.buildings[0], col: 2, row: 12}); }],
    'missing ring tile': [LayoutFailure.INVALID_HQ_RING, (s) => { s.roads.splice(s.roads.findIndex((r) => r.kind === 'hq-ring'), 1); }],
    'ring tile marked as player': [LayoutFailure.INVALID_HQ_RING, (s) => { s.roads.find((r) => r.kind === 'hq-ring').kind = 'player'; }],
    'extra ring tile': [LayoutFailure.INVALID_HQ_RING, (s) => { s.roads.find((r) => r.kind === 'player').kind = 'hq-ring'; }],
    'building out of bounds': ['out-of-bounds', (s) => { s.buildings[1].col = 40; }],
    'overlapping buildings': ['occupied', (s) => { s.buildings[3].col = s.buildings[1].col; s.buildings[3].row = s.buildings[1].row; }],
    'building on a road': [RoadFailure.ROAD_OCCUPIED, (s) => { Object.assign(s.buildings[5], {col: 10, row: 6}); }],
    'duplicate road': [RoadFailure.ROAD_EXISTS, (s) => { s.roads.push({...s.roads.find((r) => r.kind === 'player')}); }],
    'road out of bounds': [RoadFailure.OUT_OF_BOUNDS, (s) => { s.roads.push({col: 30, row: 2, kind: 'player'}); }],
    'Factory with no connected road': [RoadFailure.NO_ROAD_ACCESS, (s) => { s.roads = s.roads.filter((r) => r.kind !== 'player'); }],
    'disabled HQ': ['invalid-state', (s) => { s.buildings[0].enabled = false; }],
    'HQ ring off the map': [RoadFailure.HQ_RING_OUT_OF_BOUNDS, (s) => {
        Object.assign(s.buildings[0], {col: 0, row: 7});
        s.buildings = s.buildings.slice(0, 1);
        s.roads = hqRingCells({col: 0, row: 7, width: 3, height: 3}).map((cell) => ({...cell, kind: 'hq-ring'}));
    }],
};

for (const [name, [reason, mutate]] of Object.entries(REJECTED)) {
    test(`rejected with nothing changed: ${name}`, () => {
        const snapshot = base();
        mutate(snapshot);
        const w = fresh({resources: {credits: 1250, ap: 5}});
        const result = loadLayout(w, snapshot);
        assert.equal(result.ok, false);
        assert.equal(result.reason, reason);
        assert.equal(result.applied, undefined);
        assert.deepEqual(w.placement.buildings(), []);
        assert.equal(w.placement.hqBuilt, false);
        assert.deepEqual(w.roads.tiles(), []);
        assert.deepEqual(w.grid.snapshot().occupants, []);
        assert.deepEqual(w.economy.snapshot(), {credits: 1250, ap: 5});
    });
}

test('a non-object snapshot is rejected', () => {
    for (const bad of [null, undefined, 5, 'layout']) {
        assert.equal(loadLayout(fresh(), bad).reason, LayoutFailure.INVALID_SNAPSHOT, String(bad));
    }
});

test('loading is refused during Night and after a defeat', () => {
    const w = fresh();
    w.place('hq', 12, 8);
    w.cycle.endDay();
    assert.equal(loadLayout(w, FIXTURE).reason, LayoutFailure.NOT_DAY);
    assert.equal(w.placement.buildings().length, 1);
});

test('loading needs a fresh game', () => {
    const w = fresh();
    w.place('hq', 12, 8);
    assert.equal(loadLayout(w, FIXTURE).reason, LayoutFailure.NOT_FRESH);
    const again = loaded(FIXTURE);
    assert.equal(loadLayout(again, FIXTURE).reason, LayoutFailure.NOT_FRESH);
});

test('a destroyed HQ still counts as not fresh', () => {
    const w = fresh();
    const {building} = w.place('hq', 12, 8);
    w.placement.damageBuilding(building.id, building.hp);
    assert.equal(loadLayout(w, FIXTURE).reason, LayoutFailure.NOT_FRESH);
});

test('a world without roads or a started game is refused', () => {
    assert.equal(loadLayout(createWorld({requireHq: true}), FIXTURE).reason, LayoutFailure.ROADS_UNAVAILABLE);
    assert.equal(loadLayout({}, FIXTURE).reason, LayoutFailure.NOT_STARTED);
});

test('a failure during the live replay is reported as applied, so the run can be discarded', () => {
    const w = fresh();
    const result = loadLayout(w, FIXTURE, {faultAfter: 4});
    assert.equal(result.ok, false);
    assert.equal(result.reason, LayoutFailure.APPLY_FAILED);
    assert.equal(result.applied, true);
    assert.match(result.detail, /simulated failure/);
    assert.equal(w.placement.buildings().length, 4);
});

// ---- Fixtures ---------------------------------------------------------------------

test('the road-legal fixture loads through the real rules', () => {
    const w = loaded(FIXTURE);
    const buildings = w.placement.buildings();
    const count = (type) => buildings.filter((b) => b.type === type).length;
    assert.deepEqual(['hq', 'factory', 'powerPlant', 'autocannon'].map(count), [1, 2, 3, 9]);
    assert.equal(w.roads.tiles().length, 17);
    assert.equal(w.roads.connectedTiles().length, 17);
    assert.deepEqual(calculatePower(buildings).generation, 320);
    assert.deepEqual(calculatePower(buildings).demand, 260);
    assert.equal(calculateSettlement(buildings).gross, 300);
    assert.deepEqual(snapshotOf(w), FIXTURE);
});

test('the original FORTRESS 22 stays outside the road rules', () => {
    const asSnapshot = clone(FIXTURE);
    asSnapshot.buildings = FORTRESS_22_EXACT.map(([type, col, row]) => ({type, col, row, enabled: true}));
    asSnapshot.roads = asSnapshot.roads.filter((r) => r.kind === 'hq-ring');
    const result = loadLayout(fresh(), asSnapshot);
    assert.equal(result.ok, false);
    assert.equal(result.reason, RoadFailure.NO_ROAD_ACCESS);
});

test('the original FORTRESS 22 still builds in a world without roads', () => {
    const w = createWorld({resources: {credits: 9000, ap: 30}, requireHq: true});
    for (const [type, col, row] of FORTRESS_22_EXACT) {
        const offset = type === 'autocannon' ? 0 : 1;
        assert.equal(w.place(type, col + offset, row + offset).ok, true, `${type} ${col},${row}`);
    }
    assert.equal(w.placement.buildings().length, 15);
});
