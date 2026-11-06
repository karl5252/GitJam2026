import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {GATE, GateState, Gates} from '../../src/core/gates.js';
import {LOGISTICS, TruckState} from '../../src/core/logistics.js';
import {MUTANT} from '../../src/core/mutants.js';
import {ROUTE_COST, RoadFailure} from '../../src/core/roads.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {LayoutFailure, exportLayout, loadLayout} from '../../src/testShadow/layoutSnapshot.js';
import {MapId, WORLD_MAPS, createTerrain} from '../../src/core/worldMap.js';
import {canonicalState, checkInvariants, createWorld, digestOf, worldState} from '../soak/harness.js';
import {FORTRESS_22_EXACT} from '../fixtures/legacy/fortress22-exact.js';
import {getBuildingType} from '../../src/core/buildingTypes.js';

/**
 * Gates: placement against road geometry, the state machine, truck crossings,
 * mutant passage, time-aware routing and layout snapshots.
 *
 * HQ at pointer 12,8 has its ring on 10-14, 6-10 and its dock at 12,10. The
 * west road runs along row 8 to a Factory at pointer 3,8, with its dock at 5,8.
 * The north road runs up col 12 to a Factory at pointer 10,2, dock 12,2.
 */

const FUNDS = {credits: 100_000, ap: 200};
const NIGHT = 3600;
const WEST_ROAD = [[9, 8], [8, 8], [7, 8], [6, 8], [5, 8]];
const NORTH_ROAD = [[12, 5], [12, 4], [12, 3], [12, 2]];
const spawnsAt = (...indices) => {
    let draws = 0;
    return {nextInt: () => indices[draws++ % indices.length], snapshot: () => ({draws})};
};

function world({schedule = [], rng, seed = 731} = {}) {
    const w = createWorld({seed, rng, resources: FUNDS, requireHq: true, roads: true, schedule});
    assert.equal(w.place('hq', 12, 8).ok, true);
    assert.equal(w.place('powerPlant', 20, 3).ok, true);
    return w;
}

const road = (w, cells) => {
    for (const [col, row] of cells) assert.equal(w.placement.placeRoad({col, row}).ok, true, `road ${col},${row}`);
};

const build = (w, type, col, row) => {
    const result = w.place(type, col, row);
    assert.equal(result.ok, true, `${type} ${col},${row}: ${result.reason}`);
    return result.building.id;
};

function westFactory({gate = true} = {}) {
    const w = world();
    road(w, WEST_ROAD);
    build(w, 'factory', 3, 8);
    return {w, gateId: gate ? build(w, 'gateVertical', 7, 8) : null};
}

const step = (w, ticks, watch = () => {}) => {
    for (let i = 0; i < ticks && w.cycle.shift === Shift.NIGHT; i++) {
        w.cycle.stepTicks(1, w.tick);
        watch(w.cycle.elapsedNightTicks);
    }
};

const truck = (w) => w.logistics.snapshot().trucks[0];
const gateOf = (w, id) => w.gates.snapshot().find((g) => g.id === id);

/** Tick of each delivery and each return to the dock in one Night. */
function timeline(w) {
    const out = {deliveries: [], parked: []};
    let state = TruckState.IDLE;
    let loads = 0;
    w.cycle.endDay();
    step(w, NIGHT - 1, (at) => {
        const now = truck(w).state;
        const delivered = w.logistics.snapshot().night.loads;
        if (delivered > loads) out.deliveries.push(at);
        if (state === TruckState.RETURNING && now !== TruckState.RETURNING) out.parked.push(at); // a waiting load sends it straight out again
        state = now;
        loads = delivered;
    });
    return out;
}

// ---- Placement against the road -------------------------------------------------

test('a vertical gate needs an east-west road through its tile, a horizontal one north-south', () => {
    const w = world();
    road(w, WEST_ROAD);
    road(w, NORTH_ROAD);
    assert.equal(w.place('gateHorizontal', 7, 8).reason, RoadFailure.GATE_NEEDS_STRAIGHT_ROAD);
    assert.equal(w.place('gateVertical', 12, 4).reason, RoadFailure.GATE_NEEDS_STRAIGHT_ROAD);
    const vertical = build(w, 'gateVertical', 7, 8);
    const horizontal = build(w, 'gateHorizontal', 12, 4);
    assert.equal(w.roads.gateAt({col: 7, row: 8}), 'x');
    assert.equal(w.roads.gateAt({col: 12, row: 4}), 'y');
    assert.deepEqual(w.placement.gates().map((g) => g.id), [vertical, horizontal]);
    assert.equal(w.roads.has({col: 7, row: 8}), true, 'the road stays under it');
});

test('a gate needs a road, and not at the end of one or on a corner', () => {
    const w = world();
    road(w, [[9, 8], [8, 8], [8, 7], [8, 6]]);
    assert.equal(w.place('gateVertical', 3, 3).reason, RoadFailure.GATE_NEEDS_ROAD);
    assert.equal(w.place('gateVertical', 8, 8).reason, RoadFailure.GATE_NEEDS_STRAIGHT_ROAD, 'a corner');
    assert.equal(w.place('gateHorizontal', 8, 8).reason, RoadFailure.GATE_NEEDS_STRAIGHT_ROAD, 'a corner');
    assert.equal(w.place('gateHorizontal', 8, 6).reason, RoadFailure.GATE_NEEDS_STRAIGHT_ROAD, 'a dead end');
    build(w, 'gateHorizontal', 8, 7); // one tile along the arm is fine
});

test('no gate on the HQ ring, on a Factory dock, or on another building', () => {
    const w = world();
    road(w, WEST_ROAD);
    build(w, 'factory', 3, 8);
    assert.equal(w.place('gateVertical', 12, 6).reason, RoadFailure.GATE_ON_HQ_RING);
    assert.equal(w.place('gateVertical', 12, 10).reason, RoadFailure.GATE_ON_HQ_RING, 'the HQ dock is on the ring');
    assert.equal(w.place('gateVertical', 5, 8).reason, RoadFailure.GATE_ON_DOCK);
    const id = build(w, 'gateVertical', 7, 8);
    assert.equal(w.place('gateVertical', 7, 8).reason, 'occupied', id);
});

test('a Factory cannot take a gated tile as its dock', () => {
    const w = world();
    road(w, [[9, 8], [8, 8], [8, 7], [8, 6], [8, 5]]);
    build(w, 'gateHorizontal', 8, 6);
    assert.equal(w.place('factory', 6, 6).reason, RoadFailure.GATE_ON_DOCK);
});

test('there are no gates without a road network', () => {
    const w = createWorld({resources: FUNDS});
    assert.equal(w.place('gateVertical', 3, 3).reason, RoadFailure.GATE_NEEDS_ROAD);
});

test('a junction can be gated while every dock keeps a route, and the crossing branch is cut', () => {
    const w = world();
    // A crossroads at 7,8, with a loop that keeps the north arm connected.
    road(w, WEST_ROAD);
    road(w, [[7, 7], [7, 6], [8, 6], [9, 6]]);
    road(w, [[7, 9], [7, 10]]);
    build(w, 'gateVertical', 7, 8);
    assert.equal(w.roads.isConnected({col: 7, row: 7}), true, 'through the loop');
    assert.equal(w.roads.isConnected({col: 7, row: 9}), false, 'the south arm lost its link');
    assert.equal(w.placement.placeRoad({col: 8, row: 9}).reason, undefined, 'and could be relinked');
});

test('a gate that would strand a dock is refused, and that is the only junction limit', () => {
    const w = world();
    road(w, WEST_ROAD);
    road(w, [[7, 7], [7, 6], [7, 5], [7, 4]]);
    build(w, 'factory', 5, 4); // dock 7,4: its only way out is south through 7,8
    assert.equal(w.place('gateVertical', 7, 8).reason, RoadFailure.ROAD_REQUIRED);
    assert.equal(w.roads.gateAt({col: 7, row: 8}), null);
    assert.equal(w.grid.occupantAt(7, 8), null);
});

test('adjacent gates must agree: a barrier across the road is not a straight road', () => {
    const w = world();
    road(w, WEST_ROAD);
    road(w, [[7, 7], [7, 6], [8, 6], [9, 6], [7, 9], [7, 10], [8, 10], [9, 10]]);
    build(w, 'gateHorizontal', 7, 8);
    assert.equal(w.place('gateVertical', 8, 8).reason, RoadFailure.GATE_NEEDS_STRAIGHT_ROAD);
    const w2 = world();
    road(w2, WEST_ROAD);
    build(w2, 'gateVertical', 7, 8);
    build(w2, 'gateVertical', 8, 8);
});

test('roads a gate depends on cannot be removed; other roads can', () => {
    const w = world();
    road(w, WEST_ROAD);
    road(w, [[7, 7]]);
    build(w, 'gateVertical', 7, 8);
    for (const col of [6, 7, 8]) assert.equal(w.placement.removeRoad({col, row: 8}).reason, RoadFailure.GATE_DEPENDS_ON_ROAD, `col ${col}`);
    assert.equal(w.placement.removeRoad({col: 5, row: 8}).ok, true);
    assert.equal(w.placement.removeRoad({col: 7, row: 7}).ok, true);
});

test('demolishing a gate restores plain road, and a route across it', () => {
    const w = world();
    road(w, WEST_ROAD);
    road(w, [[7, 7]]);
    const id = build(w, 'gateVertical', 7, 8);
    assert.equal(w.roads.neighbors({col: 7, row: 7}).length, 0);
    const before = w.economy.snapshot();
    assert.deepEqual(w.placement.demolish(id), {ok: true});
    assert.deepEqual(w.economy.snapshot(), before);
    assert.equal(w.roads.gateAt({col: 7, row: 8}), null);
    assert.deepEqual(w.roads.neighbors({col: 7, row: 7}), [{col: 7, row: 8}]);
    assert.equal(w.placement.removeRoad({col: 7, row: 8}).ok, true);
});

test('a road cannot join the network across a barrier', () => {
    const w = world();
    road(w, WEST_ROAD);
    build(w, 'gateVertical', 7, 8);
    assert.equal(w.placement.placeRoad({col: 7, row: 7}).reason, RoadFailure.NOT_CONNECTED);
    assert.equal(w.placement.placeRoad({col: 6, row: 7}).ok, true);
});

// ---- The state machine ----------------------------------------------------------

function machine() {
    const cycle = {shift: Shift.NIGHT};
    const placement = {gates: () => [{id: 'g', type: 'gateVertical', col: 0, row: 0}]};
    const grid = {occupantAt: () => 'g'};
    const gates = new Gates({cycle, placement, grid});
    const state = () => gates.snapshot()[0];
    const run = (ticks, wanted) => {
        for (let i = 0; i < ticks; i++) gates.step(new Set(wanted ? ['g'] : []));
    };
    return {cycle, gates, state, run};
}

test('values: opening takes 150 ticks and closing 60', () => {
    assert.deepEqual(GATE, {openTicks: 150, closeTicks: 60});
    assert.deepEqual(ROUTE_COST, {tileTicks: 32, gateTicks: 150});
});

test('closed, opening, open, closing, closed, with exact timing', () => {
    const {state, run} = machine();
    run(5, false);
    assert.deepEqual([state().state, state().timer], [GateState.CLOSED, 0]);
    run(1, true);
    assert.deepEqual([state().state, state().timer], [GateState.OPENING, GATE.openTicks]);
    run(GATE.openTicks - 1, true);
    assert.equal(state().state, GateState.OPENING);
    run(1, true);
    assert.equal(state().state, GateState.OPEN);
    run(500, true);
    assert.equal(state().state, GateState.OPEN, 'for as long as it is needed');
    run(1, false);
    assert.deepEqual([state().state, state().timer], [GateState.CLOSING, GATE.closeTicks]);
    run(GATE.closeTicks - 1, false);
    assert.equal(state().state, GateState.CLOSING);
    run(1, false);
    assert.equal(state().state, GateState.CLOSED);
});

test('a reversal keeps the barrier where it is', () => {
    const {state, run} = machine();
    run(1, true);
    run(75, true); // halfway open
    run(1, false);
    assert.deepEqual([state().state, state().timer], [GateState.CLOSING, 30]);
    run(10, false); // two thirds of the way back to halfway
    run(1, true);
    assert.equal(state().state, GateState.OPENING);
    assert.equal(state().timer, 150 - Math.round(150 * (20 / 60)));
});

test('only OPEN lets anything through, and only along its axis', () => {
    const {gates, run} = machine();
    const building = {id: 'g', type: 'gateVertical'};
    const passes = () => [gates.allows(building, 'x'), gates.allows(building, 'y')];
    assert.deepEqual(passes(), [false, false]);
    run(1, true);
    assert.deepEqual(passes(), [false, false], 'opening');
    run(GATE.openTicks, true);
    assert.deepEqual(passes(), [true, false], 'open');
    run(1, false);
    assert.deepEqual(passes(), [false, false], 'closing');
    assert.equal(gates.allows({id: 'g', type: 'gateHorizontal'}, 'x'), false);
    assert.equal(gates.allows({id: 'g', type: 'wall'}, 'x'), false);
});

test('at dawn gates forget everything, and after a defeat they freeze', () => {
    const {cycle, state, run} = machine();
    run(1, true);
    cycle.shift = Shift.DAY;
    run(1, true);
    assert.equal(state().state, GateState.CLOSED);
    cycle.shift = Shift.NIGHT;
    run(10, true);
    const {timer} = state();
    cycle.shift = Shift.DEFEATED;
    run(10, true);
    assert.equal(state().timer, timer);
});

// ---- Trucks ---------------------------------------------------------------------

test('each crossing costs a truck exactly the opening time, there and back', () => {
    const free = timeline(westFactory({gate: false}).w);
    const gated = timeline(westFactory().w);
    assert.equal(gated.deliveries[0] - free.deliveries[0], GATE.openTicks, 'out');
    assert.equal(gated.parked[0] - free.parked[0], 2 * GATE.openTicks, 'and back');
});

test('a truck waits at the centre of the tile before the gate, then crosses in the open', () => {
    const {w, gateId} = westFactory();
    const hold = w.grid.cellCenter(6, 8);
    const states = [];
    w.cycle.endDay();
    let held = 0;
    step(w, 1200, () => {
        const t = truck(w);
        const gate = gateOf(w, gateId);
        if (t.x === hold.x && t.y === hold.y && t.state === TruckState.OUTBOUND) held++;
        if (states.at(-1) !== gate.state) states.push(gate.state);
        const inside = t.x > hold.x && t.x < w.grid.cellCenter(8, 8).x;
        if (inside) assert.equal(gate.state, GateState.OPEN, `crossing at ${t.x}`);
    });
    assert.ok(held >= GATE.openTicks);
    assert.deepEqual(states.slice(0, 5), [GateState.CLOSED, GateState.OPENING, GateState.OPEN, GateState.CLOSING, GateState.CLOSED]);
});

test('horizontal gates work the same way on a north-south road', () => {
    const run = (gate) => {
        const w = world();
        road(w, NORTH_ROAD);
        build(w, 'factory', 10, 2);
        if (gate) build(w, 'gateHorizontal', 12, 4);
        return timeline(w);
    };
    const free = run(false);
    const gated = run(true);
    assert.equal(gated.deliveries[0] - free.deliveries[0], GATE.openTicks);
    assert.equal(gated.parked[0] - free.parked[0], 2 * GATE.openTicks);
});

test('a truck never crosses a gate sideways: no route exists across a barrier', () => {
    const w = world();
    road(w, WEST_ROAD);
    road(w, [[7, 7], [7, 6], [7, 5], [7, 4]]);
    road(w, [[8, 6], [9, 6]]);
    build(w, 'gateVertical', 7, 8);
    const path = w.roads.route({col: 7, row: 7}, {col: 6, row: 8});
    assert.equal(path.at(-2).col, 7, 'it crosses the gate...');
    assert.equal(path.at(-3).col, 8, '...from the east, the long way round');
    assert.ok(path.length > 3);
});

test('two trucks share one opening, and it stays open until both have passed', () => {
    const w = world();
    road(w, WEST_ROAD);
    road(w, [[5, 7], [5, 6], [5, 5], [5, 4]]);
    build(w, 'factory', 3, 8); // dock 5,8
    build(w, 'factory', 3, 4); // dock 5,4: down the same road, four tiles behind
    const id = build(w, 'gateVertical', 7, 8);
    const beyond = w.grid.cellCenter(8, 8).x;
    let openings = 0;
    let previous = GateState.CLOSED;
    let bothPast = null;
    w.cycle.endDay();
    step(w, 1000, (at) => {
        const {state} = gateOf(w, id);
        if (state === GateState.OPENING && previous !== GateState.OPENING) openings++;
        previous = state;
        const trucks = w.logistics.snapshot().trucks;
        if (bothPast === null && trucks.every((t) => t.x >= beyond)) {
            bothPast = at;
            assert.equal(state, GateState.OPEN, 'still open as the last one clears it');
        }
    });
    assert.notEqual(bothPast, null);
    assert.equal(openings, 1, 'one opening served both');
});

test('trucks meeting at a gate from both sides pass each other, with no deadlock', () => {
    const w = world();
    road(w, WEST_ROAD);
    road(w, [[5, 7], [5, 6], [5, 5], [5, 4]]);
    build(w, 'factory', 3, 8);
    build(w, 'factory', 3, 4);
    build(w, 'gateVertical', 7, 8);
    w.cycle.endDay();
    step(w, NIGHT - 1);
    assert.ok(w.logistics.snapshot().night.loads >= 6, 'both kept delivering all Night');
    assert.deepEqual(checkInvariants(w), []);
});

test('adjacent gates in a line: the truck passes both, with no deadlock', () => {
    const w = world();
    road(w, WEST_ROAD);
    build(w, 'factory', 3, 8);
    build(w, 'gateVertical', 7, 8);
    build(w, 'gateVertical', 8, 8);
    const {deliveries} = timeline(w);
    assert.ok(deliveries.length >= 3);
});

test('a gate destroyed while a truck waits no longer stops it', () => {
    const {w, gateId} = westFactory();
    w.cycle.endDay();
    step(w, 700);
    const waiting = truck(w);
    assert.equal(waiting.x, w.grid.cellCenter(6, 8).x);
    assert.equal(gateOf(w, gateId).state, GateState.OPENING);
    assert.equal(w.placement.damageBuilding(gateId, 150).destroyed, true);
    step(w, 1);
    assert.ok(truck(w).x > waiting.x);
    assert.equal(w.roads.has({col: 7, row: 8}), true);
    assert.equal(w.grid.occupantAt(7, 8), null);
    assert.deepEqual(w.gates.snapshot(), []);
});

test('a gate destroyed during a crossing leaves the truck on its route', () => {
    const {w, gateId} = westFactory();
    w.cycle.endDay();
    step(w, 900, () => {
        const here = truck(w);
        const onGate = here.x === w.grid.cellCenter(7, 8).x;
        if (onGate && w.placement.buildings().some((b) => b.id === gateId)) w.placement.damageBuilding(gateId, 150);
    });
    assert.equal(w.placement.gates().length, 0);
    step(w, 500);
    assert.ok(w.logistics.snapshot().night.loads >= 1, 'the load still arrived');
});

test('a truck destroyed at a gate lets it close: no record can hold it open', () => {
    const {w, gateId} = westFactory();
    w.cycle.endDay();
    step(w, 800);
    assert.notEqual(gateOf(w, gateId).state, GateState.CLOSED);
    assert.equal(w.logistics.damageTruck(truck(w).id, LOGISTICS.truckHp).destroyed, true);
    step(w, GATE.openTicks + GATE.closeTicks);
    assert.equal(gateOf(w, gateId).state, GateState.CLOSED);
    assert.equal(w.logistics.gateDemands().size, 0);
});

test('a truck is never held longer than a full close and open', () => {
    const {w} = westFactory();
    let longest = 0;
    let held = 0;
    let last = null;
    w.cycle.endDay();
    step(w, NIGHT - 1, () => {
        const t = truck(w);
        const moving = t.state === TruckState.OUTBOUND || t.state === TruckState.RETURNING;
        held = moving && last !== null && t.x === last.x && t.y === last.y ? held + 1 : 0;
        longest = Math.max(longest, held);
        last = t;
    });
    assert.ok(longest <= GATE.openTicks + GATE.closeTicks, `held for ${longest} ticks`);
    assert.ok(longest >= GATE.openTicks - 1);
});

test('at dawn trucks park and gates close, and Day can edit around them', () => {
    const {w, gateId} = westFactory();
    w.cycle.endDay();
    step(w, 800);
    while (w.cycle.shift === Shift.NIGHT) w.cycle.stepTicks(240, w.tick);
    assert.equal(w.cycle.shift, Shift.DAY);
    assert.equal(gateOf(w, gateId).state, GateState.CLOSED);
    assert.equal(truck(w).state, TruckState.IDLE);
    assert.equal(w.logistics.gateDemands().size, 0);
    assert.deepEqual(w.placement.demolish(gateId), {ok: true});
});

test('a destroyed gate leaves no record behind', () => {
    const {w, gateId} = westFactory();
    w.cycle.endDay();
    step(w, 700);
    w.placement.damageBuilding(gateId, 150);
    step(w, 2);
    assert.equal(w.gates.idAt({col: 7, row: 8}), null);
    assert.equal(w.gates.isOpen(gateId), false);
});

// ---- Mutants at gates -----------------------------------------------------------

const LEFT = (row) => 64 + (15 - row);
const TOP = (col) => col;

function sealedWest({rng}) {
    const w = world({schedule: [1], rng});
    road(w, WEST_ROAD);
    const walls = [];
    for (let row = 0; row < 16; row++) {
        if (row !== 8) walls.push(build(w, 'wall', 7, row));
    }
    return {w, walls, gateId: build(w, 'gateVertical', 7, 8)};
}

/** One tick with a gate held open, as a truck would hold it. */
const holding = (w, wanted, effects) => (tick) => {
    w.cycle.onTick(tick);
    w.gates.step(wanted);
    effects.push(w.mutants.step());
};

test('a closed gate blocks a mutant, which attacks it and goes on when it falls', () => {
    const {w, gateId} = sealedWest({rng: spawnsAt(LEFT(8))});
    const effects = [];
    w.cycle.endDay();
    for (let i = 0; i < 2300; i++) w.cycle.stepTicks(1, holding(w, new Set(), effects));
    const hits = effects.flatMap((e) => e.attacks);
    assert.equal(hits[0].buildingId, gateId);
    assert.equal(hits.filter((a) => a.buildingId === gateId).length, 150 / MUTANT.attackDamage);
    assert.ok(w.mutants.snapshot()[0].x > w.grid.cellCenter(7, 8).x, 'it walked on through');
});

test('an open gate admits a mutant along its axis, without a hit', () => {
    const {w, gateId} = sealedWest({rng: spawnsAt(LEFT(8))});
    const effects = [];
    w.cycle.endDay();
    for (let i = 0; i < 900; i++) w.cycle.stepTicks(1, holding(w, new Set([gateId]), effects));
    assert.equal(effects.flatMap((e) => e.attacks).filter((a) => a.buildingId === gateId).length, 0);
    assert.ok(w.mutants.snapshot()[0].x > w.grid.cellCenter(8, 8).x);
    assert.equal(gateOf(w, gateId).state, GateState.OPEN);
});

test('a mutant attacking a closed gate walks in the moment it opens', () => {
    const {w, gateId} = sealedWest({rng: spawnsAt(LEFT(8))});
    const effects = [];
    w.cycle.endDay();
    for (let i = 0; i < 800; i++) w.cycle.stepTicks(1, holding(w, new Set(), effects));
    assert.equal(w.mutants.snapshot()[0].obstacleId, gateId);
    const {x} = w.mutants.snapshot()[0];
    for (let i = 0; i < GATE.openTicks + 2; i++) w.cycle.stepTicks(1, holding(w, new Set([gateId]), effects));
    for (let i = 0; i < 20; i++) w.cycle.stepTicks(1, holding(w, new Set([gateId]), effects));
    const [mutant] = w.mutants.snapshot();
    assert.equal(mutant.obstacleId, null);
    assert.ok(mutant.x > x);
});

test('an open gate is still solid across its axis', () => {
    // A vertical gate lets east-west traffic through. From the north it is a wall.
    const w = world({schedule: [1], rng: spawnsAt(TOP(7))});
    road(w, WEST_ROAD);
    const gateId = build(w, 'gateVertical', 7, 8);
    const effects = [];
    w.cycle.endDay();
    for (let i = 0; i < 800; i++) w.cycle.stepTicks(1, holding(w, new Set([gateId]), effects));
    const [mutant] = w.mutants.snapshot();
    const rect = w.grid.footprintRect({col: 7, row: 8});
    assert.ok(mutant.y < rect.y || mutant.x !== w.grid.cellCenter(7, 8).x, 'it never entered from the side');
    assert.deepEqual(checkInvariants(w), []);
});

test('a gate closing on a mutant holds it until it breaks free, never for ever', () => {
    const {w, gateId} = sealedWest({rng: spawnsAt(LEFT(8))});
    const effects = [];
    const rect = w.grid.footprintRect({col: 7, row: 8});
    w.cycle.endDay();
    const inDoorway = () => w.mutants.snapshot()[0]?.x > rect.x + 8;
    for (let i = 0; i < 1000 && !inDoorway(); i++) w.cycle.stepTicks(1, holding(w, new Set([gateId]), effects));
    assert.ok(inDoorway());
    for (let i = 0; i < 2400 && w.placement.gates().length > 0; i++) w.cycle.stepTicks(1, holding(w, new Set(), effects));
    assert.equal(w.placement.gates().length, 0, 'it attacked its way out');
    assert.deepEqual(w.mutants.snapshot().length, 1);
});

test('real trucks really do let mutants in, and the same seed repeats it', () => {
    const digest = () => {
        const w = world({schedule: [200, 300, 400, 500, 600, 700], seed: 98});
        road(w, WEST_ROAD);
        build(w, 'factory', 3, 8);
        build(w, 'gateVertical', 7, 8);
        for (let row = 0; row < 16; row++) if (row !== 8) build(w, 'wall', 7, row);
        w.cycle.endDay();
        step(w, NIGHT - 1, () => assert.deepEqual(checkInvariants(w), []));
        return digestOf(canonicalState({...worldState(w), gates: w.gates.snapshot(), trucks: w.logistics.snapshot()}));
    };
    assert.equal(digest(), digest());
});

// ---- Time-aware routing ---------------------------------------------------------

/** Two ways from 3,3 to the ring: straight along row 3 and down, or a loop round row 1. */
function parallel(detourRows) {
    const w = world();
    road(w, [[12, 5], [12, 4], [12, 3]]);
    const direct = [];
    for (let col = 11; col >= 3; col--) direct.push([col, 3]);
    road(w, direct);
    const top = 3 - detourRows;
    const loop = [];
    for (let row = 2; row >= top; row--) loop.push([9, row]);
    for (let col = 8; col >= 5; col--) loop.push([col, top]);
    for (let row = top + 1; row <= 2; row++) loop.push([5, row]);
    road(w, loop);
    build(w, 'gateVertical', 7, 3);
    return w;
}

const crossesGate = (path) => path.some(({col, row}) => col === 7 && row === 3);

test('without gates, routes are unchanged: shortest, in the same stable order', () => {
    const w = world();
    road(w, [[12, 5], [12, 4], [11, 4], [10, 4], [10, 5]]);
    const path = w.roads.route({col: 12, row: 4}, {col: 12, row: 10});
    assert.equal(path.length, 11);
    assert.deepEqual(path.slice(0, 3), [{col: 12, row: 4}, {col: 12, row: 5}, {col: 12, row: 6}]);
});

test('a road a little longer beats a gate: 4 extra tiles cost 128 ticks, the gate 150', () => {
    const w = parallel(2);
    const path = w.roads.route({col: 3, row: 3}, {col: 12, row: 6});
    assert.equal(crossesGate(path), false);
    assert.equal(path.length - 1, 16);
});

test('a road much longer loses to a gate: 6 extra tiles cost 192 ticks', () => {
    const w = parallel(3);
    const path = w.roads.route({col: 3, row: 3}, {col: 12, row: 6});
    assert.equal(crossesGate(path), true);
    assert.equal(path.length - 1, 12);
});

test('a route costs the same both ways, so a truck can always drive it back', () => {
    for (const rows of [2, 3]) {
        const w = parallel(rows);
        const there = w.roads.route({col: 3, row: 3}, {col: 12, row: 6});
        const back = w.roads.route({col: 12, row: 6}, {col: 3, row: 3});
        const cost = (path) => path.slice(1).reduce((sum, cell) => sum + ROUTE_COST.tileTicks
            + (w.roads.gateAt(cell) ? ROUTE_COST.gateTicks : 0), 0);
        assert.equal(cost(there) - (w.roads.gateAt(there[0]) ? ROUTE_COST.gateTicks : 0), cost(back) - (w.roads.gateAt(back[0]) ? ROUTE_COST.gateTicks : 0));
    }
});

test('equal costs always resolve the same way', () => {
    const route = () => {
        const w = world();
        road(w, [[12, 5], [12, 4], [11, 4], [11, 3], [12, 3], [13, 3], [13, 4]]);
        return w.roads.route({col: 12, row: 3}, {col: 12, row: 5});
    };
    assert.deepEqual(route(), route());
});

test('trucks pick the quicker way round and earn the difference', () => {
    const w = parallel(2);
    build(w, 'factory', 1, 3); // dock 3,3
    w.cycle.endDay();
    let touched = false;
    step(w, 1500, () => {
        const here = truck(w);
        if (here.y === w.grid.cellCenter(7, 3).y && here.x === w.grid.cellCenter(7, 3).x) touched = true;
    });
    assert.equal(touched, false, 'it never touched the gate');
    assert.ok(w.logistics.snapshot().night.loads >= 1);
});

test('a route chosen around a gate stays valid when that gate falls', () => {
    const {w, gateId} = westFactory();
    w.cycle.endDay();
    step(w, 650);
    w.placement.damageBuilding(gateId, 150);
    step(w, 1500);
    assert.ok(w.logistics.snapshot().night.loads >= 2);
});

// ---- Speed ----------------------------------------------------------------------

test('1x, 2x and 4x give the same fight at the same ticks', () => {
    const digest = (speed) => {
        const w = world({schedule: [200, 500, 800, 1100, 1400], seed: 98});
        road(w, WEST_ROAD);
        build(w, 'factory', 3, 8);
        build(w, 'gateVertical', 7, 8);
        for (const row of [5, 6, 7, 9, 10, 11]) build(w, 'wall', 7, row);
        w.cycle.endDay();
        w.clock.setSpeed(speed);
        while (w.cycle.shift === Shift.NIGHT) w.clock.advance(1000 / 60, w.tick);
        return digestOf(canonicalState({...worldState(w), gates: w.gates.snapshot(), trucks: w.logistics.snapshot()}));
    };
    const baseline = digest(1);
    assert.equal(digest(2), baseline);
    assert.equal(digest(4), baseline);
});

// ---- Layout snapshots -----------------------------------------------------------

const fresh = (schedule = []) => createWorld({resources: FUNDS, requireHq: true, roads: true, schedule});

function fortified(schedule = []) {
    const w = world({schedule});
    road(w, WEST_ROAD);
    road(w, NORTH_ROAD);
    build(w, 'factory', 3, 8);
    build(w, 'wall', 2, 2);
    build(w, 'gateVertical', 7, 8);
    build(w, 'wall', 3, 2);
    build(w, 'gateHorizontal', 12, 4);
    return w;
}

test('walls and gates fit the version 1 schema, in creation order', () => {
    const snapshot = exportLayout(fortified());
    assert.equal(snapshot.version, 1);
    assert.deepEqual(Object.keys(snapshot), ['format', 'version', 'grid', 'buildings', 'roads']);
    assert.deepEqual(snapshot.buildings.slice(2).map((b) => b.type), ['factory', 'wall', 'gateVertical', 'wall', 'gateHorizontal']);
    for (const building of snapshot.buildings) assert.deepEqual(Object.keys(building), ['type', 'col', 'row', 'enabled']);
});

test('a snapshot with walls and gates round-trips exactly, with working gates', () => {
    const snapshot = exportLayout(fortified());
    const w = fresh();
    const before = w.economy.snapshot();
    assert.deepEqual(loadLayout(w, snapshot), {ok: true, buildings: 7, roads: 25});
    assert.deepEqual(exportLayout(w), snapshot);
    assert.deepEqual(w.economy.snapshot(), before);
    assert.equal(w.roads.gateAt({col: 7, row: 8}), 'x');
    assert.equal(w.roads.gateAt({col: 12, row: 4}), 'y');
    assert.equal(w.placement.removeRoad({col: 7, row: 8}).reason, RoadFailure.GATE_DEPENDS_ON_ROAD);
});

test('loading a layout gives the same fight as building it by hand', () => {
    const fight = (w) => {
        w.cycle.endDay();
        while (w.cycle.shift === Shift.NIGHT) w.cycle.stepTicks(240, w.tick);
        return digestOf(canonicalState({...worldState(w), gates: w.gates.snapshot()}));
    };
    const schedule = [200, 500, 800, 1100];
    const copy = fresh(schedule);
    assert.equal(loadLayout(copy, exportLayout(fortified())).ok, true);
    assert.equal(fight(copy), fight(fortified(schedule)));
});

test('a legal final state always replays, even after road removals', () => {
    const w = world();
    road(w, WEST_ROAD);
    road(w, [[5, 7], [5, 6]]);
    build(w, 'factory', 3, 8);
    build(w, 'gateVertical', 7, 8);
    assert.equal(w.placement.removeRoad({col: 5, row: 6}).ok, true);
    const snapshot = exportLayout(w);
    const copy = fresh();
    assert.equal(loadLayout(copy, snapshot).ok, true);
});

const INVALID = {
    'a gate off the road': (s) => { s.buildings.push({type: 'gateVertical', col: 2, row: 12, enabled: true}); },
    'a gate on the wrong axis': (s) => { s.buildings.find((b) => b.type === 'gateVertical').type = 'gateHorizontal'; },
    'a wall on a road': (s) => { s.buildings.push({type: 'wall', col: 8, row: 8, enabled: true}); },
    'a wall switched off': (s) => { s.buildings.find((b) => b.type === 'wall').enabled = false; },
    'a tier that does not exist': (s) => { s.buildings.find((b) => b.type === 'gateVertical').type = 'reinforcedGateVertical'; },
};

for (const [name, spoil] of Object.entries(INVALID)) {
    test(`an invalid layout changes nothing live: ${name}`, () => {
        const snapshot = structuredClone(exportLayout(fortified()));
        spoil(snapshot);
        const w = fresh();
        const result = loadLayout(w, snapshot);
        assert.equal(result.ok, false);
        assert.notEqual(result.applied, true);
        assert.deepEqual(w.placement.buildings(), []);
        assert.deepEqual(w.roads.tiles(), []);
        assert.deepEqual(w.grid.snapshot().occupants, []);
    });
}

test('version 2 stays unsupported: walls and gates did not need it', () => {
    const snapshot = {...exportLayout(fortified()), version: 2};
    assert.equal(loadLayout(fresh(), snapshot).reason, LayoutFailure.UNSUPPORTED_SCHEMA);
});

// ---- Historical fixtures --------------------------------------------------------

/**
 * Every layout fixture has a declared status. Schema compatibility is not a
 * promise that an old layout is still legal: a stale one must keep being
 * rejected for its real reason, and rules are never relaxed to admit it.
 */
const FIXTURES = {
    'logistics-reference.json': {status: 'valid'},
    'fortification-reference.json': {status: 'valid'},
    'fortress-logistics-v1.json': {status: 'valid'},
    'fortress-checkerboard-v1.json': {status: 'valid'},
    'infantry-reference.json': {status: 'valid'},
    'golden-fortress-day33-v2.json': {status: 'valid'},
    'golden-fortress-brute-defense-v3.json': {status: 'valid'},
    'golden-fortress-jungle-v3.json': {status: 'valid', map: WORLD_MAPS[MapId.JUNGLE]},
    'fortress-corner-v1.json': {status: 'stale', reason: RoadFailure.NO_ROAD_ACCESS},
    'fortress22-road-legal.json': {status: 'stale', reason: RoadFailure.NO_ROAD_ACCESS},
};

test('every layout fixture has a declared status', () => {
    const dir = new URL('../fixtures/layouts/', import.meta.url);
    const files = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
    assert.deepEqual(files, Object.keys(FIXTURES).sort());
});

for (const [name, {status, reason, map}] of Object.entries(FIXTURES)) {
    test(`fixture ${name} is ${status}`, () => {
        const snapshot = JSON.parse(readFileSync(new URL(`../fixtures/layouts/${name}`, import.meta.url), 'utf8'));
        const w = map ? createWorld({requireHq: true, roads: true, map, terrain: createTerrain(map)}) : fresh();
        const result = loadLayout(w, snapshot);
        if (status === 'valid') {
            assert.equal(result.ok, true, `${result.reason}: ${result.detail}`);
            assert.deepEqual(exportLayout(w), snapshot);
        } else {
            assert.equal(result.ok, false);
            assert.equal(result.reason, reason, result.detail);
            assert.notEqual(result.applied, true);
            assert.deepEqual(w.placement.buildings(), [], 'nothing partial is left');
        }
    });
}

test('FORTRESS 22 exact is a legacy combat benchmark: it builds only in a world with no roads', () => {
    const build = (roads) => {
        const w = createWorld({resources: FUNDS, requireHq: true, roads});
        return FORTRESS_22_EXACT.map(([type, col, row]) => {
            const {width, height} = getBuildingType(type);
            return w.place(type, col + Math.floor((width - 1) / 2), row + Math.floor((height - 1) / 2)).ok;
        });
    };
    assert.ok(build(false).every(Boolean), 'combat benchmark');
    assert.ok(build(true).includes(false), 'never a legal layout under road rules');
});
