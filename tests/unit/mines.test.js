/**
 * TASK 026: deposits and the Mine. Deposit generation over many seeds, Mine
 * placement through the real rules, a Mine truck on the real road network, and
 * Mine vulnerability and target bias under the real Mutants.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILDING_TYPES, getBuildingType} from '../../src/core/buildingTypes.js';
import {MineFailure} from '../../src/core/buildingPlacement.js';
import {DEPOSIT} from '../../src/core/deposits.js';
import {LOGISTICS, MINE_OUTPUT, outputOf} from '../../src/core/logistics.js';
import {MINE_BIAS, TARGET_BIAS, borderSpawns, selectTarget, targetBias} from '../../src/core/mutants.js';
import {RoadFailure, receivingDock, shippingDock} from '../../src/core/roads.js';
import {calculateEmissions} from '../../src/core/pollution.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {PlacementFailure} from '../../src/core/grid.js';
import {TerrainKind, generateJungle} from '../../src/core/terrain.js';
import {WORLD_MAPS, createTerrain} from '../../src/core/worldMap.js';
import {MAP, clearAll, footprintTiles, mineBase, roadTo, run, toNight} from './mineBase.js';

const SEEDS = Array.from({length: 200}, (_, i) => i * 7919 + 1);
const terrainOf = (seed) => generateJungle({cols: MAP.cols, rows: MAP.rows, seed, spawnFrame: MAP.spawnFrame});
const chebyshev = (a, b) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));

/** Jungle tiles between a tile and the nearest generated clearing tile. */
function gapToClearing(terrain, cell) {
    let best = Infinity;
    for (let row = 0; row < terrain.rows; row++) {
        for (let col = 0; col < terrain.cols; col++) {
            if (terrain.kindAt(col, row) === TerrainKind.CLEARING) best = Math.min(best, chebyshev(cell, {col, row}) - 1);
        }
    }
    return best;
}

// ---- Values ---------------------------------------------------------------------

test('the Mine has the approved provisional values', () => {
    const {id, cost, power, pollutionPerNight, maxHp, width, height} = getBuildingType('mine');
    assert.deepEqual({id, cost, power, pollutionPerNight, maxHp, width, height}, {
        id: 'mine', cost: {credits: 500, ap: 1}, power: {supply: 0, demand: 30}, pollutionPerNight: 10, maxHp: 250, width: 2, height: 2,
    });
    assert.deepEqual({...MINE_OUTPUT}, {loadTicks: 600, creditsPerLoad: 60, storageLoads: 2});
    assert.equal(outputOf('factory'), LOGISTICS); // the Factory is unchanged
    assert.ok(MINE_OUTPUT.creditsPerLoad > LOGISTICS.creditsPerLoad, 'a Mine pays more per load than a Factory');
    assert.deepEqual({...MINE_BIAS}, {idle: 64, active: 192});
    assert.equal(TARGET_BIAS.mine, MINE_BIAS.idle);
    assert.ok(Object.hasOwn(BUILDING_TYPES, 'mine'));
});

test('the Mine ships from the tile under its bottom-right tile, {col + 1, row + 2}', () => {
    const footprint = {col: 10, row: 4, width: 2, height: 2};
    assert.deepEqual(shippingDock('mine', footprint), {col: 11, row: 6});
    assert.deepEqual(shippingDock('mine', footprint), receivingDock(footprint));
    assert.deepEqual(shippingDock('factory', {col: 10, row: 4, width: 3, height: 3}), {col: 13, row: 5}); // unchanged
});

// ---- Generation -----------------------------------------------------------------

test('deposits are fixed by the world seed, and the open map has none', () => {
    assert.deepEqual(terrainOf(731).depositSnapshot(), terrainOf(731).depositSnapshot());
    assert.notDeepEqual(terrainOf(731).depositSnapshot(), terrainOf(732).depositSnapshot());
    assert.equal(createTerrain(WORLD_MAPS.open), null);
    const t = createTerrain(MAP, MAP.seed);
    assert.deepEqual(t.deposits.map(({id, core, dock}) => ({id, core, dock})), [
        {id: 'deposit-1', core: {col: 30, row: 5}, dock: {col: 31, row: 7}},
        {id: 'deposit-2', core: {col: 23, row: 28}, dock: {col: 24, row: 30}},
        {id: 'deposit-3', core: {col: 42, row: 24}, dock: {col: 43, row: 26}},
    ]);
});

test('over 200 seeds every deposit obeys the approved rules', () => {
    const frame = MAP.spawnFrame;
    const onRing = ({col, row}) => {
        const [right, bottom] = [frame.col + frame.cols - 1, frame.row + frame.rows - 1];
        return col >= frame.col && col <= right && row >= frame.row && row <= bottom
            && (col === frame.col || col === right || row === frame.row || row === bottom);
    };
    for (const seed of SEEDS) {
        const t = terrainOf(seed);
        assert.equal(t.deposits.length, DEPOSIT.count, `seed ${seed}`);
        const path = [];
        for (let row = 0; row < t.rows; row++) for (let col = 0; col < t.cols; col++) if (t.kindAt(col, row) === TerrainKind.PATH) path.push({col, row});
        t.deposits.forEach((deposit, i) => {
            const tiles = new Set(deposit.tiles.map(({col, row}) => `${col},${row}`));
            const where = `seed ${seed} ${deposit.id}`;
            assert.ok(deposit.tiles.length >= DEPOSIT.size.min && deposit.tiles.length <= DEPOSIT.size.max, where);
            // A valid Mine footprint, and its south dock: in the map, free of ore, off the spawn ring.
            for (const {col, row} of footprintTiles(deposit.core)) assert.ok(tiles.has(`${col},${row}`), where);
            assert.deepEqual(deposit.dock, {col: deposit.core.col + 1, row: deposit.core.row + 2}, where);
            assert.ok(deposit.dock.row < t.rows && !tiles.has(`${deposit.dock.col},${deposit.dock.row}`) && !onRing(deposit.dock), where);
            // Under the jungle, off the path and the ring, at the approved distance from the clearing.
            for (const tile of deposit.tiles) {
                assert.equal(t.kindAt(tile.col, tile.row), TerrainKind.JUNGLE, where);
                assert.equal(t.depositAt(tile.col, tile.row), deposit.id, where);
                assert.ok(!onRing(tile), where);
                assert.ok(path.every((p) => chebyshev(p, tile) > DEPOSIT.pathGap), where);
            }
            const band = i === 0 ? DEPOSIT.near : DEPOSIT.far;
            const gap = Math.min(...footprintTiles(deposit.core).map((c) => gapToClearing(t, c)));
            assert.ok(gap >= band.minGap && gap <= band.maxGap, `${where}: gap ${gap}`);
            // One piece, and never a rectangle.
            const seen = new Set([`${deposit.core.col},${deposit.core.row}`]);
            const queue = [deposit.core];
            for (let q = 0; q < queue.length; q++) {
                for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
                    const key = `${queue[q].col + dc},${queue[q].row + dr}`;
                    if (tiles.has(key) && !seen.has(key)) {
                        seen.add(key);
                        queue.push({col: queue[q].col + dc, row: queue[q].row + dr});
                    }
                }
            }
            assert.equal(seen.size, tiles.size, `${where}: one piece`);
            const cols = deposit.tiles.map((c) => c.col);
            const rows = deposit.tiles.map((c) => c.row);
            const box = (Math.max(...cols) - Math.min(...cols) + 1) * (Math.max(...rows) - Math.min(...rows) + 1);
            assert.ok(box > tiles.size, `${where}: not a rectangle`);
        });
        // Apart from each other.
        for (const a of t.deposits) {
            for (const b of t.deposits) {
                if (a === b) continue;
                for (const x of a.tiles) for (const y of b.tiles) assert.ok(chebyshev(x, y) > DEPOSIT.separation, `seed ${seed}`);
            }
        }
    }
});

test('clearing over a deposit reveals it and changes nothing about it', () => {
    const t = createTerrain(MAP, MAP.seed);
    const before = t.depositSnapshot();
    const {core} = t.deposits[0];
    assert.equal(t.clear(core.col, core.row), true);
    assert.equal(t.kindAt(core.col, core.row), TerrainKind.CLEARED);
    assert.equal(t.depositAt(core.col, core.row), 'deposit-1');
    assert.deepEqual(t.depositSnapshot(), before);
    assert.equal(t.snapshot().deposits, undefined, 'the pinned terrain snapshot is unchanged');
});

// ---- Placement ------------------------------------------------------------------

test('a Mine needs its four tiles cleared, on one deposit, with a connected road on its south dock', () => {
    const {w, terrain, deposit} = mineBase({mine: false});
    const {core, dock} = deposit;
    const at = (col, row) => (w.placement.select('mine'), w.placement.preview({col, row}));
    assert.equal(at(core.col, core.row).reason, PlacementFailure.TERRAIN_BLOCKED, 'still under the jungle');
    clearAll(terrain, [...footprintTiles(core), ...footprintTiles({col: core.col - 1, row: core.row}), dock]);
    assert.equal(at(terrain.center.col + 6, terrain.center.row - 4).reason, MineFailure.NO_DEPOSIT, 'open clearing');
    const off = deposit.tiles.some(({col, row}) => col === core.col - 1 && row === core.row) && deposit.tiles.some(({col, row}) => col === core.col - 1 && row === core.row + 1);
    if (!off) assert.equal(at(core.col - 1, core.row).reason, MineFailure.NO_DEPOSIT, 'half off the deposit');
    const unconnected = at(core.col, core.row);
    assert.equal(unconnected.reason, RoadFailure.NO_ROAD_ACCESS);
    assert.deepEqual(unconnected.dock, dock, 'the preview shows the south dock');

    // A road on the footprint must be removed first; roads do not touch the deposit.
    roadTo(w, terrain, dock, []);
    const onFootprint = footprintTiles(core).filter(({col, row}) => w.roads.tiles().some((r) => r.col === col && r.row === row));
    if (onFootprint.length === 0) {
        const extra = {col: core.col + 1, row: core.row + 1}; // straight above the dock
        assert.equal(w.placement.placeRoad(extra).ok, true);
        onFootprint.push(extra);
    }
    assert.equal(at(core.col, core.row).reason, RoadFailure.ROAD_OCCUPIED);
    for (const cell of [...onFootprint].reverse()) assert.equal(w.placement.removeRoad(cell).ok, true);
    assert.equal(terrain.depositAt(onFootprint[0].col, onFootprint[0].row), 'deposit-1', 'the road consumed nothing');
    if (!w.roads.isConnected(dock)) roadTo(w, terrain, dock, footprintTiles(core));

    const credits = w.economy.credits;
    assert.equal(at(core.col, core.row).ok, true);
    assert.equal(w.place('mine', core.col, core.row).ok, true);
    assert.equal(w.economy.credits, credits - 500);

    // One Mine per deposit, wherever else on it a 2x2 fits.
    const second = deposit.tiles.find(({col, row}) => {
        const tiles = footprintTiles({col, row});
        return tiles.every((c) => terrain.depositAt(c.col, c.row) === deposit.id)
            && tiles.every((c) => w.grid.occupantAt(c.col, c.row) === null);
    });
    if (second) {
        clearAll(terrain, footprintTiles(second));
        assert.equal(at(second.col, second.row).reason, MineFailure.DEPOSIT_TAKEN);
    }
    // The dock is protected like a Factory's.
    assert.equal(w.placement.previewRoadRemoval(dock).reason, RoadFailure.ROAD_REQUIRED);
    w.placement.cancel();
});

test('roads and other buildings may stand on deposit tiles', () => {
    const {w, terrain, deposit} = mineBase({mine: false});
    const tile = deposit.tiles.find(({col, row}) => !footprintTiles(deposit.core).some((c) => c.col === col && c.row === row));
    clearAll(terrain, [tile]);
    roadTo(w, terrain, {col: tile.col, row: tile.row + 1}, [tile]);
    assert.equal(w.place('wall', tile.col, tile.row).ok, true);
    assert.equal(terrain.depositAt(tile.col, tile.row), deposit.id);
});

// ---- Logistics --------------------------------------------------------------------

test('a powered Mine makes a load every 600 ticks and its truck drives it to HQ by road for 60 Credits', () => {
    const {w, deposit} = mineBase();
    const mine = w.placement.buildings().find((b) => b.type === 'mine');
    const entry = w.logistics.snapshot().factories.find((f) => f.id === mine.id);
    assert.deepEqual({type: entry.type, dock: entry.dock}, {type: 'mine', dock: deposit.dock});
    const factoryEntryKeys = Object.keys(entry).filter((k) => k !== 'type');
    assert.deepEqual(factoryEntryKeys, ['id', 'col', 'row', 'width', 'height', 'dock', 'progress', 'stored', 'noRoute']);

    w.cycle.endDay(); // Day 0 to Dusk, Night 1, then the first timed Day: everything ticks
    const before = w.economy.credits;
    let delivered = null;
    let leftDock = null;
    run(w, 20000, (i) => {
        const truck = w.logistics.snapshot().trucks.find((t) => t.factoryId === mine.id);
        if (leftDock === null && truck.state === 'outbound') leftDock = i;
        if (w.logistics.snapshot().totals.loads > 0) {
            delivered = i;
            return true;
        }
        return false;
    });
    assert.ok(delivered !== null, 'a load arrived');
    assert.equal(w.logistics.snapshot().totals.credits, MINE_OUTPUT.creditsPerLoad);
    // Credits rose by exactly one payout, plus any settlement in between.
    const settled = w.cycle.lastSettlement ? w.cycle.lastSettlement.net : 0;
    assert.equal(w.economy.credits, before + MINE_OUTPUT.creditsPerLoad + settled);
    assert.ok(delivered - leftDock > 32 * 10, 'it drove the long road, it was not teleported');
});

test('an unpowered Mine produces nothing, and a powered one emits 10 Pollution a Night', () => {
    const {w} = mineBase({plant: false}); // HQ's 20 cannot carry the Mine's 30
    const mine = w.placement.buildings().find((b) => b.type === 'mine');
    w.cycle.endDay();
    run(w, 3000);
    assert.equal(w.logistics.snapshot().factories.find((f) => f.id === mine.id).progress, 0);
    const powered = mineBase();
    assert.equal(calculateEmissions(powered.w.placement.buildings()), 12 + 10); // the Plant's and the Mine's
});

// ---- Vulnerability and target bias -----------------------------------------------

test('a working Mine is noisier than an idle one: bias 192 enabled and powered, 64 otherwise', () => {
    const {w} = mineBase();
    const buildings = w.placement.buildings();
    const mine = buildings.find((b) => b.type === 'mine');
    assert.equal(targetBias(mine, new Set([mine.id])), 192);
    assert.equal(targetBias(mine, new Set()), 64);
    assert.equal(targetBias(mine, null), 64);
    assert.equal(targetBias(buildings.find((b) => b.type === 'hq'), new Set()), 256);

    // A point 100 px from the Mine and 40 px from a Factory: the noise decides.
    const grid = {footprintRect: ({col, row, width, height}) => ({x: col * 10, y: row * 10, width: width * 10, height: height * 10})};
    const factory = {id: 'factory-1', type: 'factory', col: 4, row: 0, width: 3, height: 3};
    const quiet = {id: 'mine-2', type: 'mine', col: 10, row: 0, width: 2, height: 2};
    const point = {x: 0, y: 0};
    assert.equal(selectTarget(point, [factory, quiet], grid, new Set(['mine-2'])), 'mine-2'); // 100 - 192 < 40 - 128
    assert.equal(selectTarget(point, [factory, quiet], grid, new Set()), 'factory-1');
    assert.equal(selectTarget(point, [factory, quiet], grid), 'factory-1');
});

test('on the default seed more spawn points choose a powered Mine than an idle one', () => {
    const {w} = mineBase();
    const buildings = w.placement.buildings();
    const mine = buildings.find((b) => b.type === 'mine');
    const spawns = borderSpawns(w.grid, MAP.spawnFrame);
    const choosing = (powered) => spawns.filter((s) => selectTarget(s, buildings, w.grid, powered) === mine.id).length;
    assert.equal(choosing(new Set([mine.id])), 17);
    assert.equal(choosing(new Set()), 13);
});

/** One mutant from the frame's top edge, above the Mine, on Night 1. */
function mutantAboveMine({enabled = true} = {}) {
    const mineCol = 31;
    const spawnIndex = mineCol - MAP.spawnFrame.col; // the top edge runs west to east first
    const rng = {nextInt: () => spawnIndex, next: () => 0, snapshot: () => ({})};
    const base = mineBase({active: false, schedule: [60], rng});
    const mine = base.w.placement.buildings().find((b) => b.type === 'mine');
    if (!enabled) assert.equal(base.w.placement.setEnabled(mine.id, false).ok, true);
    toNight(base.w);
    run(base.w, 60);
    return {...base, mine};
}

test('a mutant walks out beyond the spawn frame and destroys an undefended Mine', () => {
    const {w, mine} = mutantAboveMine();
    const [mutant] = w.mutants.snapshot();
    assert.equal(mutant.targetId, mine.id);
    const frameTop = w.grid.footprintRect({col: 0, row: MAP.spawnFrame.row, width: 1, height: 1}).y;
    let lowestY = mutant.y;
    run(w, 3500, () => {
        const [m] = w.mutants.snapshot();
        if (m) lowestY = Math.min(lowestY, m.y);
        return !w.placement.buildings().some((b) => b.id === mine.id);
    });
    assert.ok(lowestY < frameTop, 'it left the frame');
    assert.equal(w.placement.buildings().some((b) => b.id === mine.id), false, 'the Mine fell');
});

test('switching a Mine off never breaks a lock already on it', () => {
    const {w, mine} = mutantAboveMine();
    assert.equal(w.mutants.snapshot()[0].targetId, mine.id);
    assert.equal(w.placement.setEnabled(mine.id, false).ok, true);
    let kept = true;
    let hit = false;
    run(w, 600, () => {
        const [m] = w.mutants.snapshot();
        kept &&= m.targetId === mine.id;
        hit ||= w.placement.buildings().find((b) => b.id === mine.id).hp < getBuildingType('mine').maxHp;
        return false;
    });
    assert.ok(kept, 'the target stayed the Mine');
    assert.ok(hit, 'and it attacked it, switched off');
});

test('an inactive Mine is still a valid target', () => {
    const {w, mine} = mutantAboveMine({enabled: false});
    assert.equal(w.mutants.snapshot()[0].targetId, mine.id);
    assert.equal(w.cycle.shift, Shift.NIGHT);
});
