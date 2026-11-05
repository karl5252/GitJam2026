import test from 'node:test';
import assert from 'node:assert/strict';
import {BuildingPlacement} from '../../src/core/buildingPlacement.js';
import {Economy} from '../../src/core/economy.js';
import {Grid} from '../../src/core/grid.js';
import {INVALID_DAMAGE, LOGISTICS, TruckState, UNKNOWN_TRUCK} from '../../src/core/logistics.js';
import {MUTANT, Mutants} from '../../src/core/mutants.js';
import {RoadFailure, hqRingCells, outgoingDock, receivingDock} from '../../src/core/roads.js';
import {Shift, ShiftCycle} from '../../src/core/shiftCycle.js';
import {SimulationClock} from '../../src/core/simulationClock.js';
import {canonicalState, createWorld, digestOf, worldState} from '../soak/harness.js';

const FUNDS = {credits: 9000, ap: 40};
const HQ = {col: 11, row: 7, width: 3, height: 3}; // pointer cell 12,8
const NEAR_FACTORY = [8, 8]; // pointer cell: dock 10,8 is on the ring
const NIGHT = 3600;

function world({schedule = [], seed = 731, resources = FUNDS} = {}) {
    const w = createWorld({seed, resources, requireHq: true, roads: true, schedule});
    assert.equal(w.place('hq', 12, 8).ok, true);
    return w;
}

function powered(options) {
    const w = world(options);
    assert.equal(w.place('powerPlant', 20, 3).ok, true);
    return w;
}

function factory(w, [col, row] = NEAR_FACTORY) {
    const result = w.place('factory', col, row);
    assert.equal(result.ok, true, `factory: ${result.reason}`);
    return result.building;
}

const lay = (w, cells) => {
    for (const [col, row] of cells) assert.equal(w.placement.placeRoad({col, row}).ok, true, `road ${col},${row}`);
};

/** Step ticks one at a time, stopping at the end of the Night or on defeat. */
function step(w, ticks, onTick = () => {}) {
    for (let i = 0; i < ticks && w.cycle.shift === Shift.NIGHT; i++) {
        w.cycle.stepTicks(1, w.tick);
        onTick(w.cycle.elapsedNightTicks);
    }
}

function night(w, onTick) {
    w.cycle.endDay();
    step(w, NIGHT, onTick);
}

const state = (w) => w.logistics.snapshot();

function cells({col, row, width, height}) {
    const out = [];
    for (let c = col; c < col + width; c++) for (let r = row; r < row + height; r++) out.push({col: c, row: r});
    return out;
}

/** A Factory whose dock has been cut off, which only the raw network API can do. */
function cutOff() {
    const w = powered();
    lay(w, [[10, 5], [10, 4]]);
    const building = factory(w, [8, 4]); // dock 10,4
    assert.equal(w.roads.remove({col: 10, row: 5}, []).ok, true);
    return {w, building};
}

/**
 * A 22-edge route, from a Factory with its dock at 3,1. Round trips take 1408
 * ticks, so the truck leaves on ticks 600, 2009 and 3418: still out at dawn.
 */
function longRoad() {
    const w = powered();
    const path = [];
    for (let row = 5; row >= 1; row--) path.push([12, row]);
    for (let col = 11; col >= 3; col--) path.push([col, 1]);
    lay(w, path);
    return {w, building: factory(w, [1, 1])};
}

// ---- Docks ------------------------------------------------------------------------

test('docks are fixed: Factory right middle, HQ bottom centre', () => {
    assert.deepEqual(outgoingDock({col: 7, row: 7, width: 3, height: 3}), {col: 10, row: 8});
    assert.deepEqual(receivingDock(HQ), {col: 12, row: 10});
});

test('the HQ receiving dock is always part of the permanent ring', () => {
    const {col, row} = receivingDock(HQ);
    assert.ok(hqRingCells(HQ).some((cell) => cell.col === col && cell.row === row));
});

test('a Factory can be placed on every side of HQ, once its dock is reached', () => {
    const cases = {
        left: {at: [8, 8], roads: []},
        above: {at: [9, 3], roads: [[11, 5], [11, 4], [11, 3]]},
        below: {at: [9, 12], roads: [[11, 11], [11, 12]]},
        right: {at: [16, 8], roads: [[15, 6], [16, 6], [17, 6], [18, 6], [18, 7], [18, 8]]},
    };
    for (const [side, {at, roads}] of Object.entries(cases)) {
        const w = world();
        lay(w, roads);
        const building = factory(w, at);
        assert.ok(w.roads.isConnected(outgoingDock(building)), side);
    }
});

test('a Factory is rejected when its dock is missing, disconnected or blocked', () => {
    const missing = world();
    assert.deepEqual(missing.place('factory', 3, 3), {ok: false, reason: RoadFailure.NO_ROAD_ACCESS});

    const disconnected = world();
    lay(disconnected, [[12, 5], [12, 4], [12, 3]]);
    assert.equal(disconnected.placement.removeRoad({col: 12, row: 5}).ok, true);
    assert.deepEqual(disconnected.place('factory', 10, 3), {ok: false, reason: RoadFailure.NO_ROAD_ACCESS});

    const blocked = world();
    assert.equal(blocked.place('outpost', 8, 3).ok, true);
    assert.deepEqual(blocked.place('factory', 6, 3), {ok: false, reason: RoadFailure.NO_ROAD_ACCESS});
    assert.equal(blocked.placement.buildings().length, 2);
});

test('only the dock counts: a road on any other side gives no access', () => {
    const w = world();
    lay(w, [[10, 5], [10, 4], [9, 4], [8, 4], [7, 4]]); // along the bottom of a Factory at 6-8, 1-3
    assert.deepEqual(w.place('factory', 7, 2), {ok: false, reason: RoadFailure.NO_ROAD_ACCESS});
    lay(w, [[9, 3], [9, 2]]); // now its right-middle tile
    assert.equal(w.place('factory', 7, 2).ok, true);
});

test('the preview names the required dock', () => {
    const w = world();
    w.placement.select('factory');
    assert.deepEqual(w.placement.preview({col: 3, row: 3}).dock, {col: 5, row: 3});
    assert.equal(w.placement.preview({col: 3, row: 3}).ok, false);
    assert.deepEqual(w.placement.preview({col: 8, row: 8}).dock, {col: 10, row: 8});
    assert.equal(w.placement.preview({col: 8, row: 8}).ok, true);
    w.placement.select('outpost');
    assert.equal(w.placement.preview({col: 3, row: 3}).dock, undefined);
});

test('a road cannot be removed if a dock would lose every route, but a loop may lose a side', () => {
    const w = world();
    lay(w, [[10, 5], [10, 4], [11, 4], [11, 5]]);
    factory(w, [8, 4]); // dock 10,4
    assert.deepEqual(w.placement.removeRoad({col: 10, row: 4}), {ok: false, reason: RoadFailure.ROAD_REQUIRED});
    assert.equal(w.placement.removeRoad({col: 10, row: 5}).ok, true); // the other side still connects
    assert.deepEqual(w.placement.removeRoad({col: 11, row: 4}), {ok: false, reason: RoadFailure.ROAD_REQUIRED});
    assert.deepEqual(w.placement.removeRoad({col: 11, row: 5}), {ok: false, reason: RoadFailure.ROAD_REQUIRED});
});

test('a zero-edge route is impossible: docks could only meet if the footprints overlapped', () => {
    const blocked = new Set([...hqRingCells(HQ), ...cells(HQ)].map(({col, row}) => `${col},${row}`));
    const target = receivingDock(HQ);
    let shortest = Infinity;
    for (let col = 0; col <= 21; col++) {
        for (let row = 0; row <= 13; row++) {
            const footprint = {col, row, width: 3, height: 3};
            if (cells(footprint).some((c) => blocked.has(`${c.col},${c.row}`))) continue;
            const dock = outgoingDock(footprint);
            shortest = Math.min(shortest, Math.abs(dock.col - target.col) + Math.abs(dock.row - target.row));
        }
    }
    assert.equal(shortest, 2);
    const coinciding = {col: target.col - 3, row: target.row - 1, width: 3, height: 3};
    assert.deepEqual(outgoingDock(coinciding), target);
    assert.ok(cells(coinciding).some((c) => blocked.has(`${c.col},${c.row}`)));
    assert.equal(world().place('factory', coinciding.col + 1, coinciding.row + 1).ok, false);
});

test('the shortest legal route, two edges, delivers once per load', () => {
    const w = powered();
    const building = factory(w, [8, 10]); // top-left 7,9: dock 10,10
    assert.equal(w.roads.route(outgoingDock(building), receivingDock(HQ)).length - 1, 2);
    const before = w.economy.credits;
    night(w);
    assert.equal(w.economy.credits, before + 150);
    assert.equal(w.logistics.lastNight.loads, 5);
});

// ---- Routes -----------------------------------------------------------------------

test('routes are shortest, include both ends, and are deterministic', () => {
    const {roads} = world();
    const from = {col: 10, row: 8};
    const path = roads.route(from, {col: 12, row: 10});
    assert.deepEqual(path, [{col: 10, row: 8}, {col: 10, row: 9}, {col: 10, row: 10}, {col: 11, row: 10}, {col: 12, row: 10}]);
    assert.deepEqual(roads.route(from, {col: 12, row: 10}), path);
});

test('equal routes always resolve the same way, whatever order roads were built in', () => {
    const a = world();
    lay(a, [[15, 8], [15, 7], [15, 9]]);
    const b = world();
    lay(b, [[15, 8], [15, 9], [15, 7]]);
    assert.deepEqual(a.roads.route({col: 12, row: 6}, {col: 12, row: 10}), b.roads.route({col: 12, row: 6}, {col: 12, row: 10}));
});

test('a route to or from a non-road, or across a gap, is null; one tile is a route', () => {
    const w = world();
    lay(w, [[12, 5], [12, 4], [12, 3]]);
    assert.equal(w.placement.removeRoad({col: 12, row: 5}).ok, true);
    assert.equal(w.roads.route({col: 12, row: 3}, {col: 12, row: 10}), null);
    assert.equal(w.roads.route({col: 2, row: 2}, {col: 12, row: 10}), null);
    assert.equal(w.roads.route({col: -1, row: 0}, {col: 12, row: 10}), null);
    assert.deepEqual(w.roads.route({col: 12, row: 10}, {col: 12, row: 10}), [{col: 12, row: 10}]);
});

// ---- Production -------------------------------------------------------------------

test('the provisional values are the approved ones, and frozen', () => {
    assert.deepEqual(LOGISTICS, {
        loadTicks: 600, goodsPerLoad: 10, creditsPerLoad: 30, storageLoads: 2, truckHp: 20, truckSpeed: 1, respawnTicks: 600,
    });
    assert.ok(Object.isFrozen(LOGISTICS));
});

test('each Factory gets one free truck, in creation order', () => {
    const w = powered();
    const before = w.economy.credits;
    const first = factory(w);
    assert.equal(w.economy.credits, before - 400);
    assert.deepEqual(state(w).trucks.map((t) => [t.id, t.state, t.hp, t.cargo]), [[`truck-${first.id}`, TruckState.IDLE, 20, 0]]);
    assert.deepEqual([state(w).trucks[0].x, state(w).trucks[0].y], Object.values(w.grid.cellCenter(10, 8)));
});

test('a fully powered Night makes five loads, on exact ticks, and pays exactly 150', () => {
    const w = powered();
    factory(w);
    const before = w.economy.credits;
    const finished = [];
    let lastLoads = 0;
    night(w, (tick) => {
        const {loads} = state(w).night;
        if (loads !== lastLoads) finished.push(tick);
        lastLoads = loads;
    });
    assert.deepEqual(finished, [728, 1328, 1928, 2528, 3128]); // 600 + 128 px of road, and so on
    assert.equal(w.economy.credits, before + 150);
    assert.deepEqual(w.logistics.lastNight, {loads: 5, credits: 150, cargoLost: 0});
    assert.equal(w.cycle.lastSettlement.gross, 0);
    assert.equal(w.cycle.lastSettlement.net, 0);
});

test('credits arrive on delivery, exactly once, not at settlement', () => {
    const w = powered();
    factory(w);
    const before = w.economy.credits;
    w.cycle.endDay();
    step(w, 727);
    assert.equal(w.economy.credits, before);
    assert.equal(state(w).trucks[0].cargo, 1);
    step(w, 1);
    assert.equal(w.economy.credits, before + 30);
    assert.equal(state(w).trucks[0].cargo, 0);
    assert.equal(state(w).trucks[0].state, TruckState.RETURNING);
    step(w, 40);
    assert.equal(w.economy.credits, before + 30);
});

test('nights repeat: five loads and 150 each time', () => {
    const w = powered();
    factory(w);
    const before = w.economy.credits;
    for (let i = 0; i < 4; i++) night(w);
    assert.equal(w.economy.credits, before + 600);
    assert.equal(state(w).totals.loads, 20);
});

test('production needs power: a disabled or unpowered Factory makes nothing', () => {
    const unpowered = world();
    factory(unpowered);
    night(unpowered);
    assert.deepEqual(unpowered.logistics.lastNight, {loads: 0, credits: 0, cargoLost: 0});

    const disabled = powered();
    const {id} = factory(disabled);
    disabled.placement.setEnabled(id, false);
    night(disabled);
    assert.equal(state(disabled).factories[0].progress, 0);
    assert.equal(disabled.logistics.lastNight.loads, 0);
});

test('an outage costs production time, and only that', () => {
    const w = powered();
    const {id} = factory(w);
    night(w, (tick) => {
        if (tick === 100) w.placement.setEnabled(id, false);
        if (tick === 1300) w.placement.setEnabled(id, true);
    });
    assert.equal(w.logistics.lastNight.loads, 3); // 2399 powered ticks
});

test('switching on just before dawn earns nothing', () => {
    const w = powered();
    const {id} = factory(w);
    const before = w.economy.credits;
    w.placement.setEnabled(id, false);
    night(w, (tick) => { if (tick === 3590) w.placement.setEnabled(id, true); });
    assert.equal(w.economy.credits, before);
    assert.equal(w.cycle.lastSettlement.gross, 0);
});

test('incomplete progress resets at dusk', () => {
    const w = powered();
    const {id} = factory(w);
    w.placement.setEnabled(id, false);
    night(w, (tick) => { if (tick === 3100) w.placement.setEnabled(id, true); });
    assert.equal(state(w).factories[0].progress, 499);
    w.cycle.endDay();
    step(w, 1);
    assert.equal(state(w).factories[0].progress, 1);
    step(w, 598);
    assert.equal(state(w).factories[0].stored + state(w).trucks[0].cargo, 0);
    step(w, 1);
    assert.equal(state(w).factories[0].stored + state(w).trucks[0].cargo, 1); // the full 600 ticks again
});

test('an unreachable dock is handled safely: storage fills, then production pauses', () => {
    const {w} = cutOff();
    const before = w.economy.credits;
    night(w);
    const [record] = state(w).factories;
    assert.equal(record.stored, 2);
    assert.equal(record.progress, 0);
    assert.equal(record.noRoute, true);
    assert.equal(state(w).trucks[0].state, TruckState.IDLE);
    assert.equal(w.economy.credits, before);
});

test('stored loads persist through Day, then deliver once the route is back', () => {
    const {w} = cutOff();
    night(w);
    lay(w, [[10, 5]]);
    const before = w.economy.credits;
    night(w);
    assert.equal(state(w).factories[0].noRoute, false);
    assert.ok(w.logistics.lastNight.loads > 5, 'stored loads go first, on top of new ones');
    assert.equal(w.economy.credits, before + w.logistics.lastNight.loads * 30);
});

// ---- Long routes ------------------------------------------------------------------

test('a longer route naturally delivers less, and nothing is lost', () => {
    const {w} = longRoad();
    assert.equal(w.roads.route({col: 3, row: 1}, receivingDock(HQ)).length - 1, 22);
    night(w);
    const {loads, cargoLost} = w.logistics.lastNight;
    assert.equal(loads, 2);
    assert.equal(cargoLost, 0);
    assert.ok(state(w).factories[0].stored <= LOGISTICS.storageLoads);
});

test('two Factories share the road without traffic, and each earns in full', () => {
    const w = powered();
    assert.equal(w.place('powerPlant', 20, 12).ok, true);
    factory(w);
    lay(w, [[10, 11], [10, 12]]);
    factory(w, [8, 12]); // dock 10,12
    const before = w.economy.credits;
    night(w);
    assert.equal(w.economy.credits, before + 300);
});

// ---- Trucks and combat ------------------------------------------------------------

test('a destroyed truck loses its cargo, pays nothing, and returns after 600 ticks', () => {
    const w = powered();
    factory(w);
    const before = w.economy.credits;
    w.cycle.endDay();
    step(w, 650);
    const [{id}] = state(w).trucks;
    assert.deepEqual(w.logistics.damageTruck(id, 5), {ok: true, destroyed: false, hp: 15});
    assert.deepEqual(w.logistics.damageTruck(id, 15), {ok: true, destroyed: true, hp: 0});
    assert.equal(state(w).trucks[0].state, TruckState.RESPAWNING);
    assert.equal(state(w).trucks[0].cargo, 0);
    assert.equal(state(w).night.cargoLost, 1);
    assert.deepEqual(w.logistics.damageTruck(id, 5), {ok: false, reason: UNKNOWN_TRUCK});
    assert.equal(w.logistics.attackableTrucks().length, 0);

    step(w, 599);
    assert.equal(state(w).trucks[0].state, TruckState.RESPAWNING);
    step(w, 1);
    const [truck] = state(w).trucks;
    assert.equal(truck.hp, 20);
    assert.notEqual(truck.state, TruckState.RESPAWNING);
    step(w, NIGHT);
    assert.equal(w.logistics.lastNight.loads, 4);
    assert.equal(w.economy.credits, before + 120);
});

test('invalid truck damage is rejected', () => {
    const w = powered();
    factory(w);
    const [{id}] = state(w).trucks;
    for (const bad of [0, -1, 1.5, NaN, '5']) {
        assert.deepEqual(w.logistics.damageTruck(id, bad), {ok: false, reason: INVALID_DAMAGE}, String(bad));
    }
    assert.deepEqual(w.logistics.damageTruck('nope', 5), {ok: false, reason: UNKNOWN_TRUCK});
});

test('the replacement cooldown runs on Night ticks and carries across Day', () => {
    const w = powered();
    factory(w);
    w.cycle.endDay();
    step(w, 3400);
    const [{id}] = state(w).trucks;
    w.logistics.damageTruck(id, 20);
    step(w, NIGHT);
    assert.equal(w.cycle.shift, Shift.DAY);
    const left = state(w).trucks[0].respawn;
    assert.ok(left > 0 && left < 600);
    w.cycle.endDay();
    step(w, left);
    assert.equal(state(w).trucks[0].hp, 20);
});

/** A real Mutants with a stand-in for logistics, to test melee in isolation. */
function melee(trucks) {
    const clock = new SimulationClock();
    const economy = new Economy({credits: 9000, ap: 9});
    const grid = new Grid({cols: 24, rows: 16, tileSize: 32, originX: 256, originY: 104});
    let cycle;
    const placement = new BuildingPlacement(grid, economy, {isConstructionAllowed: () => cycle.isConstructionAllowed});
    cycle = new ShiftCycle({clock, economy});
    const hits = [];
    const logistics = trucks && {
        attackableTrucks: () => trucks(),
        damageTruck: (id, amount) => {
            hits.push({id, amount});
            return {ok: true, destroyed: false, hp: 10};
        },
    };
    const mutants = new Mutants({cycle, placement, grid, rng: {nextInt: () => 0}, schedule: [1], logistics});
    cycle.begin();
    placement.select('outpost');
    placement.placeAt({col: 12, row: 8});
    placement.cancel();
    cycle.endDay();
    const run = (ticks) => {
        for (let i = 0; i < ticks; i++) cycle.stepTicks(1, (t) => { cycle.onTick(t); mutants.step(); });
    };
    return {mutants, run, hits};
}

test('a mutant in range stops and hits a truck with its normal damage and cooldown', () => {
    const at = {x: 272, y: 104}; // the first border spawn
    const w = melee(() => [{id: 'truck-a', ...at}]);
    w.run(1);
    const [start] = w.mutants.snapshot();
    w.run(MUTANT.attackCooldownTicks - 1);
    assert.deepEqual(w.hits, []);
    w.run(1);
    assert.deepEqual(w.hits, [{id: 'truck-a', amount: MUTANT.attackDamage}]);
    w.run(MUTANT.attackCooldownTicks);
    assert.equal(w.hits.length, 2);
    assert.deepEqual([w.mutants.snapshot()[0].x, w.mutants.snapshot()[0].y], [start.x, start.y]);
});

test('mutants never hunt trucks: a distant truck changes nothing', () => {
    const quiet = melee(null);
    const far = melee(() => [{id: 'truck-a', x: 900, y: 500}]);
    quiet.run(500);
    far.run(500);
    assert.deepEqual(far.mutants.snapshot(), quiet.mutants.snapshot());
    assert.deepEqual(far.hits, []);
});

test('a truck that drives off ends the attack, and the mutant moves on', () => {
    let near = true;
    const w = melee(() => (near ? [{id: 'truck-a', x: 272, y: 104}] : []));
    w.run(30);
    const [waiting] = w.mutants.snapshot();
    near = false;
    w.run(10);
    assert.notDeepEqual([w.mutants.snapshot()[0].x, w.mutants.snapshot()[0].y], [waiting.x, waiting.y]);
    assert.deepEqual(w.hits, []);
});

test('real mutants damage real trucks during a real attack', () => {
    const schedule = Array.from({length: 40}, (_, i) => 100 + i * 20);
    const w = powered({schedule, seed: 98});
    factory(w);
    let lowest = LOGISTICS.truckHp;
    night(w, () => { lowest = Math.min(lowest, state(w).trucks[0]?.hp ?? lowest); });
    assert.ok(lowest < LOGISTICS.truckHp, 'a swarm around the base must catch a truck');
});

// ---- Dawn -------------------------------------------------------------------------

test('at dawn every truck is parked at its dock, and in-transit cargo returns to storage', () => {
    const {w, building} = longRoad();
    w.placement.setEnabled(building.id, false);
    let carrying = 0;
    night(w, (tick) => {
        if (tick === 2400) w.placement.setEnabled(building.id, true); // one load, leaving on tick 3000
        if (w.cycle.shift === Shift.NIGHT) carrying = state(w).trucks[0].cargo;
    });
    assert.equal(carrying, 1, 'the truck must be out with a load near dawn');
    const [truck] = state(w).trucks;
    assert.equal(truck.state, TruckState.IDLE);
    assert.deepEqual([truck.x, truck.y], Object.values(w.grid.cellCenter(3, 1)));
    assert.equal(truck.cargo, 0);
    assert.equal(state(w).factories[0].stored, 1);
    assert.equal(w.logistics.lastNight.loads, 0);
});

test('when storage is full, cargo stays on the truck: nothing overflows or vanishes', () => {
    const {w} = longRoad();
    // Losing the truck on tick 2300 brings it back on 2900. It leaves with one of
    // two stored loads, storage refills on 3500, and it is still out at dawn.
    night(w, (tick) => { if (tick === 2300) w.logistics.damageTruck(state(w).trucks[0].id, LOGISTICS.truckHp); });
    const {factories: [record], trucks: [truck], totals} = state(w);
    assert.equal(record.stored, LOGISTICS.storageLoads);
    assert.equal(truck.cargo, 1);
    assert.equal(truck.state, TruckState.IDLE);
    assert.equal(totals.cargoLost, 1); // the load on the truck that was destroyed, and no other

    const delivered = totals.loads;
    w.cycle.endDay();
    step(w, 2);
    const next = state(w);
    assert.equal(next.trucks[0].state, TruckState.OUTBOUND);
    assert.equal(next.trucks[0].cargo, 1);
    assert.equal(next.factories[0].stored, LOGISTICS.storageLoads); // the held load left first
    assert.equal(next.totals.loads, delivered);
});

test('dawn never creates or destroys a load, and production never adds more than one a tick', () => {
    const {w} = longRoad();
    const count = () => {
        const s = state(w);
        return s.factories[0].stored + s.trucks[0].cargo + s.totals.loads + s.totals.cargoLost;
    };
    let previous = count();
    for (let n = 0; n < 5; n++) {
        w.cycle.endDay();
        for (let tick = 0; tick < NIGHT; tick++) {
            w.cycle.stepTicks(1, w.tick);
            const now = count();
            assert.ok(now === previous || now === previous + 1, `tick ${tick}: ${previous} to ${now}`);
            if (tick === NIGHT - 1) assert.equal(now, previous, 'the dawn tick changes no totals');
            previous = now;
        }
    }
    assert.ok(previous > 5);
});

test('roads can change during Day with trucks parked, and the next route uses them', () => {
    const w = powered();
    lay(w, [[10, 5], [10, 4], [11, 4], [11, 5]]);
    factory(w, [8, 4]); // dock 10,4
    night(w);
    assert.equal(w.placement.removeRoad({col: 10, row: 5}).ok, true);
    const before = w.economy.credits;
    night(w);
    assert.equal(w.economy.credits, before + 150);
});

test('a truck on the road finishes its delivery after its Factory falls, then goes', () => {
    const w = powered();
    const {id, hp} = factory(w);
    const before = w.economy.credits;
    w.cycle.endDay();
    step(w, 650);
    assert.equal(state(w).trucks[0].state, TruckState.OUTBOUND);
    w.placement.damageBuilding(id, hp);
    step(w, 100);
    assert.equal(w.economy.credits, before + 30);
    assert.deepEqual(state(w).trucks, []);
    assert.deepEqual(state(w).factories, []);
});

test('a destroyed Factory takes its truck and stored loads, and the loss is counted', () => {
    const {w, building} = cutOff();
    night(w);
    assert.equal(state(w).factories[0].stored, 2);
    w.placement.damageBuilding(building.id, building.hp);
    assert.deepEqual(state(w).trucks, []);
    assert.equal(state(w).totals.cargoLost, 2);
});

test('Credits already delivered are kept when the run is lost later that Night', () => {
    const w = powered();
    factory(w);
    const before = w.economy.credits;
    w.cycle.endDay();
    step(w, 800);
    assert.equal(w.economy.credits, before + 30);
    assert.equal(w.cycle.defeat().ok, true);
    const frozen = JSON.stringify(state(w));
    w.logistics.step();
    assert.equal(JSON.stringify(state(w)), frozen);
    assert.equal(w.economy.credits, before + 30);
    assert.equal(w.cycle.lastSettlement, null);
});

test('Day does nothing, however often logistics steps', () => {
    const w = powered();
    factory(w);
    night(w);
    const before = JSON.stringify(state(w));
    for (let i = 0; i < 5; i++) w.logistics.step();
    assert.equal(JSON.stringify(state(w)), before);
});

// ---- Determinism ------------------------------------------------------------------

function playedDigest(seed) {
    const w = powered({seed, schedule: [100, 110, 650, 700, 1300, 1320]});
    factory(w);
    assert.equal(w.place('autocannon', 9, 5).ok, true);
    for (let i = 0; i < 3 && w.cycle.shift === Shift.DAY; i++) night(w);
    return {world: digestOf(canonicalState(worldState(w))), logistics: state(w), credits: w.economy.credits};
}

test('the same seed gives identical logistics and combat', () => {
    assert.deepEqual(playedDigest(98), playedDigest(98));
    assert.deepEqual(playedDigest(731), playedDigest(731));
});

test('a world with no Factory is unaffected by logistics', () => {
    const run = (roads) => {
        const w = createWorld({seed: 98, resources: FUNDS, requireHq: true, roads, schedule: [100, 110, 700]});
        w.place('hq', 12, 8);
        w.place('powerPlant', 20, 3);
        w.place('autocannon', 15, 5);
        for (let i = 0; i < 2 && w.cycle.shift === Shift.DAY; i++) {
            w.cycle.endDay();
            while (w.cycle.shift === Shift.NIGHT) w.cycle.stepTicks(240, w.tick);
        }
        return digestOf(canonicalState(worldState(w)));
    };
    assert.equal(run(true), run(false));
});
