import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILDING_TYPES} from '../../src/core/buildingTypes.js';
import {BARRACKS_LIMIT, CONSTRUCTION_DISABLED, INVALID_STATE} from '../../src/core/buildingPlacement.js';
import {calculatePower, PowerStatus} from '../../src/core/power.js';
import {RoadFailure} from '../../src/core/roads.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {nightPlan} from '../../src/core/waves.js';
import {LAYOUT_VERSION, LAYOUT_VERSION_BARRACKS, exportLayout, loadLayout} from '../../src/testShadow/layoutSnapshot.js';
import {canonicalState, createWorld, digestOf, worldState} from '../soak/harness.js';

/**
 * Demolition: anything but HQ, Day only, free, no refund, and everything that
 * depended on the building follows. HQ at pointer 12,8 has its ring on 10-14,
 * 6-10. The west road runs along row 8 to a Factory at pointer 3,8, dock 5,8.
 */

const FUNDS = {credits: 100_000, ap: 200};
const WEST_ROAD = [[9, 8], [8, 8], [7, 8], [6, 8], [5, 8]];

function world(options = {}) {
    const w = createWorld({resources: FUNDS, requireHq: true, roads: true, schedule: [], ...options});
    assert.equal(w.place('hq', 12, 8).ok, true);
    return w;
}

const build = (w, type, col, row) => {
    const result = w.place(type, col, row);
    assert.equal(result.ok, true, `${type} ${col},${row}: ${result.reason}`);
    return result.building.id;
};

const road = (w, cells) => {
    for (const [col, row] of cells) assert.equal(w.placement.placeRoad({col, row}).ok, true, `road ${col},${row}`);
};

const step = (w, ticks) => {
    for (let i = 0; i < ticks && w.cycle.shift === Shift.NIGHT; i++) w.cycle.stepTicks(1, w.tick);
};

const finishNight = (w) => step(w, 3600);

/** A Factory on the west road, with power to run it. */
function factoryBase(options) {
    const w = world(options);
    road(w, WEST_ROAD);
    build(w, 'powerPlant', 20, 3);
    return {w, id: build(w, 'factory', 3, 8)};
}

/** Where each type can stand next to HQ, as pointer cells. */
const SITES = {
    outpost: [3, 3], factory: [3, 8], powerPlant: [20, 3], autocannon: [3, 3], barracks: [16, 8], wall: [3, 3],
    gateVertical: [7, 8], gateHorizontal: null,
};

for (const type of Object.keys(BUILDING_TYPES).filter((id) => id !== 'hq' && SITES[id])) {
    test(`${type} can be demolished by Day: free, no refund, and its tiles come back`, () => {
        const w = world();
        road(w, WEST_ROAD);
        const [col, row] = SITES[type];
        const id = build(w, type, col, row);

        w.cycle.endDay();
        assert.equal(w.placement.demolish(id).reason, CONSTRUCTION_DISABLED, 'not at Night');
        assert.ok(w.placement.buildings().some((b) => b.id === id));
        finishNight(w);

        const before = w.economy.snapshot();
        assert.deepEqual(w.placement.demolish(id), {ok: true});
        assert.deepEqual(w.economy.snapshot(), before, 'no Credits, no AP');
        assert.equal(w.placement.buildings().some((b) => b.id === id), false);
        assert.equal(w.grid.occupantAt(col, row), null);
        assert.equal(w.placement.demolish(id).reason, 'unknown-building', 'it goes once');
    });
}

test('HQ cannot be demolished, by Day or by Night, and its ring stays', () => {
    const w = world();
    assert.equal(BUILDING_TYPES.hq.demolishable, false);
    assert.equal(w.placement.demolish('hq-1').reason, INVALID_STATE);
    w.cycle.endDay();
    assert.equal(w.placement.demolish('hq-1').reason, CONSTRUCTION_DISABLED);
    finishNight(w);
    assert.equal(w.placement.hqBuilt, true);
    assert.equal(w.placement.removeRoad({col: 14, row: 8}).reason, RoadFailure.HQ_RING_PERMANENT);
});

test('demolishing a building leaves the HQ ring permanent', () => {
    const w = world();
    const id = build(w, 'barracks', 16, 8); // exit on the ring
    w.placement.demolish(id);
    assert.equal(w.placement.removeRoad({col: 14, row: 8}).reason, RoadFailure.HQ_RING_PERMANENT);
});

test('power follows: a demolished Plant or consumer changes the pool at once', () => {
    const {w, id: factory} = factoryBase();
    build(w, 'autocannon', 3, 3);
    const plant = w.placement.buildings().find((b) => b.type === 'powerPlant').id;
    const power = () => calculatePower(w.placement.buildings());
    assert.deepEqual([power().generation, power().demand, power().status], [120, 60, PowerStatus.NORMAL]);
    w.placement.demolish(plant);
    assert.deepEqual([power().generation, power().status], [20, PowerStatus.LOW_POWER]);
    w.placement.demolish(factory);
    assert.deepEqual([power().demand, power().status], [20, PowerStatus.NORMAL]);
});

test('a road kept by a Factory dock can go once the Factory has', () => {
    const {w, id} = factoryBase();
    assert.equal(w.placement.removeRoad({col: 5, row: 8}).reason, RoadFailure.ROAD_REQUIRED);
    w.placement.demolish(id);
    assert.equal(w.placement.removeRoad({col: 5, row: 8}).ok, true);
});

test('a road kept by a Barracks exit can go once the Barracks has', () => {
    const w = world();
    road(w, [[15, 8], [16, 8]]);
    const id = build(w, 'barracks', 18, 8);
    assert.equal(w.placement.removeRoad({col: 16, row: 8}).reason, RoadFailure.EXIT_REQUIRED);
    w.placement.demolish(id);
    assert.equal(w.placement.removeRoad({col: 16, row: 8}).ok, true);
});

test('a demolished Factory takes its truck, and earns and carries nothing after', () => {
    const {w, id} = factoryBase();
    w.cycle.endDay();
    finishNight(w);
    assert.equal(w.logistics.snapshot().trucks.length, 1);
    const credits = w.economy.credits;
    w.placement.demolish(id);
    assert.deepEqual([w.logistics.snapshot().trucks, w.logistics.snapshot().factories], [[], []]);
    w.cycle.endDay();
    finishNight(w);
    assert.equal(w.economy.credits, credits);
    assert.equal(w.logistics.lastNight.loads, 0);
});

test('stored loads go with the Factory and are counted', () => {
    const {w, id} = factoryBase();
    w.cycle.endDay();
    step(w, 2999);
    w.logistics.damageTruck(`truck-${id}`, 20); // back at the last moment, too late to deliver
    finishNight(w);
    const [{stored}] = w.logistics.snapshot().factories;
    assert.ok(stored > 0);
    const {cargoLost} = w.logistics.snapshot().totals;
    const finished = w.logistics.snapshot().night;
    w.placement.demolish(id);
    const after = w.logistics.snapshot();
    assert.equal(after.totals.cargoLost, cargoLost + stored);
    assert.deepEqual(after.night, finished, 'a Day demolition is no Night\'s loss');
    assert.deepEqual(w.logistics.lastNight, finished);
    w.cycle.endDay();
    finishNight(w);
    assert.equal(w.logistics.lastNight.cargoLost, 0, 'nor the next Night\'s');
    assert.equal(w.logistics.snapshot().totals.cargoLost, cargoLost + stored, 'and it counts once');
});

test('a truck still respawning at dawn goes with its Factory', () => {
    const {w, id} = factoryBase();
    w.cycle.endDay();
    step(w, 3200);
    w.logistics.damageTruck(`truck-${id}`, 20);
    finishNight(w);
    assert.equal(w.logistics.snapshot().trucks[0].state, 'respawning');
    w.placement.demolish(id);
    w.cycle.endDay();
    step(w, 700);
    assert.deepEqual(w.logistics.snapshot().trucks, []);
});

test('when the logistics state is read changes nothing that matters', () => {
    const run = (read) => {
        const {w, id} = factoryBase();
        road(w, [[5, 9], [5, 10], [5, 11], [5, 12]]);
        const second = build(w, 'factory', 3, 12);
        w.cycle.endDay();
        finishNight(w);
        w.placement.demolish(id);
        if (read) w.logistics.snapshot();
        w.cycle.endDay();
        finishNight(w);
        const {trucks, totals} = w.logistics.snapshot();
        return {credits: w.economy.credits, trucks, totals, second};
    };
    assert.deepEqual(run(true), run(false));
});

test('a demolished Autocannon stops counting for the next wave', () => {
    const w = world();
    const first = build(w, 'autocannon', 3, 3);
    build(w, 'autocannon', 3, 4);
    build(w, 'autocannon', 3, 5);
    const plan = () => nightPlan({day: 1, pollution: 0, buildings: w.placement.buildings()});
    assert.deepEqual([plan().autocannons, plan().defenseResponse], [3, 1]);
    w.placement.demolish(first);
    assert.deepEqual([plan().autocannons, plan().defenseResponse], [2, 0]);
});

test('a demolished building is no target: mutants go for what is left', () => {
    const {w, id} = factoryBase({schedule: [1], rng: {nextInt: () => 71, snapshot: () => ({})}}); // from the west edge
    w.placement.demolish(id);
    w.cycle.endDay();
    step(w, 2);
    const [mutant] = w.mutants.snapshot();
    assert.notEqual(mutant.targetId, id);
    assert.ok(w.placement.buildings().some((b) => b.id === mutant.targetId));
});

test('a demolished cannon leaves nothing behind in the turrets', () => {
    const w = world();
    build(w, 'powerPlant', 20, 3);
    const id = build(w, 'autocannon', 3, 3);
    w.cycle.endDay();
    finishNight(w);
    w.placement.demolish(id);
    assert.deepEqual(w.autocannons.snapshot(), []);
    w.cycle.endDay();
    assert.deepEqual(w.autocannons.step(), {shots: []});
});

test('walking follows: demolishing what stood on a flag makes it good again', () => {
    const w = world();
    build(w, 'powerPlant', 20, 3);
    const barracks = build(w, 'barracks', 16, 8);
    w.placement.setFlag(barracks, {col: 4, row: 4});
    const outpost = build(w, 'outpost', 4, 4);
    assert.equal(w.infantry.posts()[0].blocked, true);
    const revision = w.placement.revision;
    w.placement.demolish(outpost);
    assert.notEqual(w.placement.revision, revision);
    assert.equal(w.infantry.posts()[0].blocked, false);
    w.cycle.endDay();
    step(w, 900);
    assert.deepEqual(w.infantry.soldiers().map(({col, row}) => [col, row]), new Array(4).fill([4, 4]));
});

test('soldiers walk through the space a demolished building left', () => {
    const route = (demolish) => {
        const w = world();
        build(w, 'powerPlant', 20, 3);
        const barracks = build(w, 'barracks', 16, 8);
        w.placement.setFlag(barracks, {col: 20, row: 10});
        const blocker = build(w, 'powerPlant', 20, 7);
        if (demolish) w.placement.demolish(blocker);
        w.cycle.endDay();
        let ticks = 0;
        while (ticks < 1500 && !w.infantry.soldiers().some((s) => s.col === 20 && s.row === 10)) {
            step(w, 1);
            ticks++;
        }
        return ticks;
    };
    assert.ok(route(true) <= route(false));
});

test('a demolished Barracks sends nobody, its flag goes with it, and the limit frees', () => {
    const w = world();
    build(w, 'powerPlant', 20, 3);
    const id = build(w, 'barracks', 16, 8);
    w.placement.setFlag(id, {col: 4, row: 4});
    w.placement.demolish(id);
    assert.deepEqual(w.infantry.posts(), []);
    w.cycle.endDay();
    step(w, 200);
    assert.deepEqual(w.infantry.soldiers(), []);
    assert.notEqual(w.placement.canBuild('barracks').reason, BARRACKS_LIMIT);
});

test('the same demolitions give the same run, and ids are never reused', () => {
    const run = () => {
        const w = world({seed: 98, schedule: [100, 300, 500]});
        build(w, 'powerPlant', 20, 3);
        const barracks = build(w, 'barracks', 16, 8);
        const doomed = build(w, 'autocannon', 3, 3);
        w.placement.setFlag(barracks, {col: 20, row: 10});
        w.placement.demolish(doomed);
        const rebuilt = build(w, 'autocannon', 3, 3);
        assert.notEqual(rebuilt, doomed);
        w.cycle.endDay();
        step(w, 1500);
        return digestOf(canonicalState(worldState(w)));
    };
    assert.equal(run(), run());
});

test('a layout after demolition round trips, keeps building order, and drops to version 1 with no Barracks', () => {
    const w = world();
    road(w, WEST_ROAD);
    build(w, 'powerPlant', 20, 3);
    const doomed = build(w, 'factory', 3, 8);
    build(w, 'autocannon', 3, 3);
    const barracks = build(w, 'barracks', 16, 8);
    build(w, 'outpost', 3, 4);
    w.placement.demolish(doomed);

    const v2 = exportLayout(w);
    assert.equal(v2.version, LAYOUT_VERSION_BARRACKS);
    assert.deepEqual(v2.buildings.map((b) => b.type), ['hq', 'powerPlant', 'autocannon', 'barracks', 'outpost']);
    const copy = createWorld({resources: FUNDS, requireHq: true, roads: true});
    assert.equal(loadLayout(copy, v2).ok, true);
    assert.deepEqual(exportLayout(copy), v2);

    w.placement.demolish(barracks);
    const v1 = exportLayout(w);
    assert.equal(v1.version, LAYOUT_VERSION);
    assert.equal(JSON.stringify(v1).includes('flag'), false);
    const plain = createWorld({resources: FUNDS, requireHq: true, roads: true});
    assert.equal(loadLayout(plain, v1).ok, true);
    assert.deepEqual(exportLayout(plain), v1);
});
