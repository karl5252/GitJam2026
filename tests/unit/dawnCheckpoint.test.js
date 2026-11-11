/**
 * TASK 042: a campaign at its dawn hold, captured and restored into a fresh world
 * (src/core/dawnCheckpoint.js), on the jungle map in the ACTIVE cycle, through the
 * soak harness in GameScene's tick order. Continue normalizes what was moving;
 * uninterrupted play is never touched by any of this.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {atDawnHold, captureDawn, restoreDawn} from '../../src/core/dawnCheckpoint.js';
import {LOGISTICS, TruckState} from '../../src/core/logistics.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {TerrainKind} from '../../src/core/terrain.js';
import {FogOfWar, VisionState, startingKnown} from '../../src/core/vision.js';
import {getBuildingType} from '../../src/core/buildingTypes.js';
import {WORKER, repairPrice} from '../../src/core/workers.js';
import {WORLD_MAPS, createTerrain} from '../../src/core/worldMap.js';
import {createWorld} from '../soak/harness.js';

const MAP = WORLD_MAPS.jungle;

/** The same world twice: once to play, once (never begun) to restore into. */
function build({begin = true, schedule = []} = {}) {
    const terrain = createTerrain(MAP, MAP.seed);
    const w = createWorld({
        requireHq: true, roads: true, resources: {credits: 9000, ap: 40}, schedule, active: true, map: MAP, terrain, ecologists: true, pollution: 60, begin,
    });
    w.fog = new FogOfWar({cols: MAP.cols, rows: MAP.rows, explored: startingKnown(terrain)});
    return w;
}

function run(w, ticks) {
    for (let i = 0; i < ticks && w.cycle.active; i++) if (w.cycle.stepTicks(1, w.tick) === 0) break;
}

/** On to the next dawn hold: the tick that settles a Night and starts a Day. */
function toDawn(w) {
    const day = w.cycle.day;
    for (let guard = 0; !(w.cycle.shift === Shift.DAY && w.cycle.day > day) && guard < 20_000; guard++) run(w, 1);
    assert.equal(atDawnHold(w.cycle), true);
}

/** HQ, a Plant, a Factory on a road to the ring, a work flag in the jungle; to the first timed Day. */
function campaign({schedule = []} = {}) {
    const w = build({schedule});
    const {center} = w.grid.terrain;
    assert.equal(w.place('hq', center.col, center.row).ok, true);
    assert.equal(w.place('powerPlant', center.col + 5, center.row).ok, true);
    for (const col of [center.col - 3, center.col - 4]) assert.equal(w.placement.placeRoad({col, row: center.row}).ok, true);
    assert.equal(w.place('factory', center.col - 6, center.row).ok, true);
    w.cycle.endDay();
    while (w.cycle.shift !== Shift.DAY) run(w, 1);
    w.economy.restoreAp(40);
    let col = center.col;
    while (w.grid.terrain.kindAt(col, center.row - 4) !== TerrainKind.JUNGLE) col++;
    assert.deepEqual(w.workers.setFlag({col, row: center.row - 4}), {ok: true});
    return w;
}

/** Nothing moving at dawn: no worker or protester outside, every truck idle and empty. */
const quiet = (w) => w.workers.workers().length === 0 && w.ecologists.snapshot().ecologists.length === 0
    && w.logistics.snapshot().trucks.every((t) => t.state === TruckState.IDLE && t.cargo === 0);

function quietDawn(w) {
    for (let i = 0; i < 6; i++) {
        toDawn(w);
        if (quiet(w)) return;
    }
    assert.fail('no quiet dawn in six');
}

/** Everything the simulation reads or reports, for tick-by-tick comparison. */
const state = (w) => JSON.stringify({
    economy: w.economy.snapshot(), pollution: w.pollution.value, cycle: w.cycle.snapshot(), settlement: w.cycle.lastSettlement,
    buildings: w.placement.buildings(), roads: w.roads.snapshot(), logistics: w.logistics.snapshot(), workers: w.workers.snapshot(),
    ecologists: w.ecologists.snapshot(), terrain: w.grid.terrain.snapshot().rows, mutants: w.mutants.snapshot(), shells: w.mutants.shells(),
    rng: w.rng.snapshot(), gates: w.gates.snapshot(), infantry: w.infantry.snapshot(), siege: w.siegeCannons.snapshot(),
});

/** Continue: a fresh world, the checkpoint, then La Voz closes. */
function restored(checkpoint, options) {
    const r = build({begin: false, ...options});
    restoreDawn(r, checkpoint);
    r.cycle.resume();
    return r;
}

/** A copy of a checkpoint to edit, as if it had been saved with that state. */
const edited = (checkpoint, edit) => {
    const copy = structuredClone(checkpoint);
    edit(copy);
    return copy;
};

test('1. a checkpoint is plain data, taken only at the dawn hold, and a restored dawn captures as the same checkpoint', () => {
    const w = campaign();
    run(w, 10);
    assert.throws(() => captureDawn(w), /dawn hold/, 'not in the middle of a Day');
    quietDawn(w);
    const checkpoint = captureDawn(w);
    assert.deepEqual(JSON.parse(JSON.stringify(checkpoint)), checkpoint);
    const r = build({begin: false});
    restoreDawn(r, checkpoint);
    assert.deepEqual(captureDawn(r), checkpoint);
    assert.deepEqual([r.cycle.shift, r.cycle.day, r.cycle.deployment, r.cycle.elapsedDayTicks], [Shift.DAY, checkpoint.day, false, 0]);
    assert.equal(r.clock.paused, true, 'held behind La Voz until the caller resumes it');
    assert.equal(r.clock.speed, 1);
    assert.deepEqual(r.cycle.lastSettlement, w.cycle.lastSettlement);
    assert.equal(Object.isFrozen(r.cycle.lastSettlement.pollution), true);
});

test('2. buildings keep their ids, creation order, HP, switches and flags; new ids follow on', () => {
    const w = campaign();
    const plant = w.placement.buildings().find((b) => b.type === 'powerPlant');
    assert.deepEqual(w.placement.damageBuilding(plant.id, 40).ok, true);
    const {center} = w.grid.terrain;
    for (const row of [center.row + 3, center.row + 4]) assert.equal(w.placement.placeRoad({col: center.col - 2, row}).ok, true); // its exit
    assert.equal(w.place('barracks', center.col, center.row + 4).ok, true);
    const barracks = w.placement.buildings().find((b) => b.type === 'barracks');
    assert.equal(w.placement.restoreFlag(barracks.id, {col: 20, row: 20}).ok, true);
    assert.equal(w.placement.setEnabled(plant.id, false).ok, true);
    toDawn(w);
    const r = restored(captureDawn(w));
    assert.deepEqual(r.placement.buildings(), w.placement.buildings());
    assert.deepEqual(r.placement.buildings().map((b) => b.id), ['hq-1', 'powerPlant-2', 'factory-3', 'barracks-4']);
    assert.deepEqual(r.roads.snapshot(), w.roads.snapshot(), 'the HQ ring and player roads, nothing else');
    assert.equal(r.placement.hqBuilt, true);
    const next = (x) => x.place('powerPlant', x.grid.terrain.center.col + 5, x.grid.terrain.center.row - 4);
    assert.equal(next(w).building.id, next(r).building.id);
});

test('3. Credits, AP, Pollution and production are exactly as saved, and restoring pays nothing', () => {
    const w = campaign();
    toDawn(w);
    const checkpoint = captureDawn(w);
    const r = build({begin: false});
    restoreDawn(r, checkpoint);
    assert.deepEqual(r.economy.snapshot(), w.economy.snapshot());
    assert.equal(r.pollution.value, w.pollution.value);
    assert.deepEqual(r.logistics.snapshot().factories, w.logistics.snapshot().factories);
    assert.ok(checkpoint.logistics.factories[0].progress > 0, 'a Factory part way through a load');
    assert.deepEqual(r.logistics.snapshot().lastNight, w.logistics.snapshot().lastNight, 'La Voz reports the same Night');
});

test('4. cleared jungle and explored fog come back exactly', () => {
    const w = campaign();
    w.fog.markExplored([{col: 0, row: 0}, {col: 47, row: 31}]);
    toDawn(w);
    const checkpoint = captureDawn(w);
    assert.ok(checkpoint.terrain.cleared.length > 0, 'the workers have cleared some jungle');
    const r = restored(checkpoint);
    assert.deepEqual(r.grid.terrain.snapshot().rows, w.grid.terrain.snapshot().rows);
    for (let row = 0; row < MAP.rows; row++) {
        for (let col = 0; col < MAP.cols; col++) {
            const known = (x) => x.fog.stateAt(col, row) !== VisionState.UNEXPLORED;
            assert.equal(known(r), known(w), `${col},${row}`);
        }
    }
    const tile = checkpoint.terrain.cleared[0];
    assert.equal(r.grid.isBuildable(tile.col, tile.row), true, 'cleared ground builds again');
});

test('5. partial clearing and a repair\'s partial block survive; the squad is whole, inside, and nobody repairs for free', () => {
    const w = campaign();
    // Called home mid-chop: the tile keeps its progress for whoever comes back.
    for (let i = 0; i < 3000 && w.workers.clearing().progress.length === 0; i++) run(w, 1);
    run(w, 100);
    assert.deepEqual(w.workers.recall(), {ok: true});
    const hq = w.placement.buildings()[0];
    assert.equal(w.placement.damageBuilding(hq.id, 590).ok, true); // longer than the rest of the Day to repair
    assert.equal(w.workers.orderRepair(hq.id).ok, true);
    toDawn(w);
    const checkpoint = captureDawn(w);
    assert.ok(checkpoint.workers.progress.length > 0, 'a tile part cleared');
    assert.ok(checkpoint.workers.orders[0]?.ticks > 0, 'a block part repaired');
    const r = restored(checkpoint);
    assert.deepEqual(r.workers.clearing(), w.workers.clearing());
    assert.deepEqual(r.workers.repairs().orders.map(({buildingId, ticks}) => ({buildingId, ticks})), checkpoint.workers.orders);
    assert.deepEqual([r.workers.workers(), r.workers.snapshot().inside], [[], WORKER.squadSize]);
    assert.equal(r.placement.buildings()[0].hp, w.placement.buildings()[0].hp);

    // The order resumes from its partial block, and every HP it restores is paid for at the usual price.
    const type = getBuildingType('hq');
    const before = {hp: r.placement.buildings()[0].hp, spent: r.workers.repairs().spent};
    run(r, 1200);
    const after = {hp: r.placement.buildings()[0].hp, spent: r.workers.repairs().spent};
    assert.ok(after.hp > before.hp, 'the repair goes on');
    assert.equal(after.spent - before.spent, repairPrice(type, type.maxHp - before.hp) - repairPrice(type, type.maxHp - after.hp));
});

test('6. trucks are parked and empty: cargo on a truck is discarded and counted lost, never refunded or paid; storage is untouched', () => {
    const w = campaign();
    quietDawn(w);
    const base = captureDawn(w);
    const checkpoint = edited(base, (c) => {
        Object.assign(c.logistics.trucks[0], {cargo: 1, hp: 13});
        c.logistics.factories[0].stored = 2;
    });
    const r = restored(checkpoint);
    const {trucks, factories, totals, night} = r.logistics.snapshot();
    const dock = r.grid.cellCenter(factories[0].dock.col, factories[0].dock.row);
    assert.deepEqual(trucks.map(({state, cargo, hp, x, y}) => ({state, cargo, hp, x, y})), [{state: TruckState.IDLE, cargo: 0, hp: 13, ...dock}]);
    assert.equal(factories[0].stored, 2, 'not refunded to storage: it holds what it held');
    assert.equal(r.economy.credits, w.economy.credits, 'not paid');
    assert.equal(totals.cargoLost, base.logistics.totals.cargoLost + 1);
    assert.equal(night.cargoLost, base.logistics.night.cargoLost + 1);
    assert.equal(totals.credits, base.logistics.totals.credits);

    // A wrecked truck keeps its countdown and comes back on time, whole.
    const wreck = restored(edited(base, (c) => Object.assign(c.logistics.trucks[0], {respawning: true, hp: 0, respawn: 250})));
    assert.deepEqual(wreck.logistics.snapshot().trucks.map(({state, respawn, hp}) => ({state, respawn, hp})), [{state: TruckState.RESPAWNING, respawn: 250, hp: 0}]);
    run(wreck, 250);
    assert.equal(wreck.logistics.snapshot().trucks[0].hp, LOGISTICS.truckHp);

    // A real dawn with a truck still driving: parked, nothing earned or lost by the move.
    const busy = campaign();
    let found = null;
    for (let i = 0; i < 6 && !found; i++) {
        toDawn(busy);
        if (busy.logistics.snapshot().trucks.some((t) => t.state !== TruckState.IDLE)) found = captureDawn(busy);
    }
    assert.ok(found, 'a dawn with a truck on the road');
    const parked = restored(found);
    assert.ok(parked.logistics.snapshot().trucks.every((t) => t.state === TruckState.IDLE && t.cargo === 0));
    assert.equal(parked.economy.credits, busy.economy.credits);
    assert.deepEqual(parked.logistics.snapshot().factories, busy.logistics.snapshot().factories);
});

test('7. a truck whose producer is gone stays gone: its cargo counts lost, nothing is rebuilt and nothing is paid', () => {
    const w = campaign();
    quietDawn(w);
    const base = captureDawn(w);
    const r = restored(edited(base, (c) => c.logistics.trucks.push({factoryId: 'factory-99', respawning: false, hp: 20, respawn: 0, cargo: 1, orphaned: true})));
    assert.deepEqual(r.logistics.snapshot().trucks.map((t) => t.factoryId), ['factory-3']);
    assert.equal(r.placement.buildings().some((b) => b.id === 'factory-99'), false);
    assert.equal(r.logistics.snapshot().totals.cargoLost, base.logistics.totals.cargoLost + 1);
    assert.equal(r.economy.credits, w.economy.credits);
});

test('8. random streams and id counters continue where they stopped', () => {
    const w = campaign();
    quietDawn(w);
    const base = captureDawn(w);
    assert.notEqual(base.ecologists.rng.state, base.ecologists.rng.seed, 'the protest stream has been drawn from');
    const checkpoint = edited(base, (c) => {
        c.rng.state = 123456789;
        Object.assign(c.mutants, {nextId: 41, nextShellId: 7});
        Object.assign(c.infantry, {nextId: 13, nextRocketId: 5});
        c.siegeCannons.nextShellId = 9;
    });
    const r = restored(checkpoint);
    assert.deepEqual(r.rng.snapshot(), checkpoint.rng);
    assert.deepEqual(r.ecologists.checkpoint(), checkpoint.ecologists);
    assert.deepEqual([r.mutants.checkpoint(), r.infantry.checkpoint(), r.siegeCannons.checkpoint()], [checkpoint.mutants, checkpoint.infantry, checkpoint.siegeCannons]);
    assert.equal(r.workers.checkpoint().nextId, checkpoint.workers.nextId);
    assert.throws(() => restored(edited(base, (c) => { c.rng.seed += 1; })), /seed/, 'never another run\'s stream');
});

test('9. what is derived comes back by itself: routes, the squad\'s way out, deliveries and clearing', () => {
    const w = campaign();
    quietDawn(w);
    const r = restored(captureDawn(w));
    assert.deepEqual(r.workers.route(), w.workers.route());
    const loads = r.logistics.snapshot().totals.loads;
    const cleared = r.workers.clearing().cleared;
    run(r, 1); // the first Day tick, then a new flag in fresh jungle, as a player sets one
    const {center} = r.grid.terrain;
    let col = center.col;
    while (r.grid.terrain.kindAt(col, center.row + 4) !== TerrainKind.JUNGLE) col--;
    assert.deepEqual(r.workers.setFlag({col, row: center.row + 4}), {ok: true});
    run(r, 3000);
    assert.ok(r.logistics.snapshot().totals.loads > loads, 'trucks find their way to HQ and are paid');
    assert.ok(r.workers.clearing().cleared > cleared, 'workers find the flag and clear');
});

test('10. from a quiet dawn, a restored campaign plays tick for tick as the uninterrupted one, through a Night with mutants', () => {
    const schedule = [600, 900, 1200, 1500]; // spawned through the game's random stream, its one consumer
    const w = campaign({schedule});
    const {center} = w.grid.terrain;
    for (const [dc, dr] of [[5, -4], [5, 4], [-5, -4]]) assert.equal(w.place('autocannon', center.col + dc, center.row + dr).ok, true);
    quietDawn(w);
    const r = restored(captureDawn(w), {schedule});
    const restoredDay = r.cycle.day;
    for (const x of [w, r]) {
        run(x, 1);
        assert.deepEqual(x.workers.dispatch(), {ok: true});
    }
    let night = false;
    for (let t = 0; t < 7600; t++) {
        run(w, 1);
        run(r, 1);
        night ||= w.cycle.shift === Shift.NIGHT && w.mutants.snapshot().length > 0;
        assert.equal(state(r), state(w), `tick ${t}`);
    }
    assert.ok(night, 'a Night with mutants on the map was compared');
    // The whole cycle was compared: on into the next Day, or, if this base falls that Night, the fall itself.
    assert.ok(w.cycle.shift === Shift.DEFEATED || (w.cycle.shift === Shift.DAY && w.cycle.day === restoredDay + 1), `${w.cycle.shift} ${w.cycle.day}`);
});

test('10b. from a quiet dawn with no waves, the restored campaign matches tick for tick through the next dawn and beyond', () => {
    const w = campaign();
    quietDawn(w);
    const r = restored(captureDawn(w));
    const restoredDay = r.cycle.day;
    for (const x of [w, r]) {
        run(x, 1);
        assert.deepEqual(x.workers.dispatch(), {ok: true});
    }
    for (let t = 0; t < 7500 + 600; t++) {
        run(w, 1);
        run(r, 1);
        assert.equal(state(r), state(w), `tick ${t}`);
    }
    assert.deepEqual([w.cycle.shift, w.cycle.day], [Shift.DAY, restoredDay + 1], 'a whole cycle and into the next Day');
});

test('a bad checkpoint is refused before any building stands; another world\'s is refused outright', () => {
    const w = campaign();
    quietDawn(w);
    const base = captureDawn(w);
    const r = build({begin: false});
    assert.throws(() => restoreDawn(r, edited(base, (c) => { c.placement.buildings.at(-1).hp = 9999; })), /hp/);
    assert.equal(r.placement.buildings().length, 0, 'every record is checked before anything changes');
    assert.throws(() => restoreDawn(build({begin: false}), edited(base, (c) => { c.terrain.seed += 1; })), /world seed/);
    assert.throws(() => restoreDawn(build({begin: false}), edited(base, (c) => { c.day = 1; })), /day/);
});
