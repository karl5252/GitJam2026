import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILDING_TYPES} from '../../src/core/buildingTypes.js';
import {calculatePower, causesLowPower} from '../../src/core/power.js';
import {BRUTE, TARGET_BIAS} from '../../src/core/mutants.js';
import {SIEGE, SiegeCannons, isInSiegeRange, selectSiegeTarget} from '../../src/core/siegeCannons.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {defenseResponse, nightPlan, waveBudget, waveSchedule} from '../../src/core/waves.js';
import {canonicalState, checkInvariants, createWorld, digestOf, worldState} from '../soak/harness.js';

/**
 * The Siege Cannon. HQ at pointer 12,8 supplies 20 power, enough for one. Pointer
 * 12,4 is the top-left of a 2x2: tiles 12-13, 4-5, x 640-704, y 232-296, centred on
 * 672,264. Tests of the gun alone give it a stand-in for Mutants, so a target can
 * stand exactly where it needs to.
 */

const FUNDS = {credits: 100_000, ap: 200};
const CENTER = {x: 672, y: 264};
const at = (dx, dy) => ({x: CENTER.x + dx, y: CENTER.y + dy});
const ordinary = (id, dx, dy, hp = 40) => ({id, ...at(dx, dy), hp});
const brute = (id, dx, dy, hp = 600) => ({id, ...at(dx, dy), hp, kind: 'brute'});
const spitter = (id, dx, dy, hp = 30) => ({id, ...at(dx, dy), hp, kind: 'spitter'});

function world({schedule = [], ...options} = {}) {
    const w = createWorld({resources: FUNDS, requireHq: true, roads: true, schedule, ...options});
    assert.equal(w.place('hq', 12, 8).ok, true);
    return w;
}

const build = (w, type, col, row) => {
    const result = w.place(type, col, row);
    assert.equal(result.ok, true, `${type} ${col},${row}: ${result.reason}`);
    return result.building.id;
};

function standIn(list) {
    const hits = [];
    return {
        list,
        hits,
        mutants: {
            snapshot: () => list.map((m) => ({...m})),
            damageMutant: (id, amount) => {
                const mutant = list.find((m) => m.id === id);
                if (!mutant) return {ok: false, reason: 'unknown-mutant'};
                hits.push({id, amount});
                mutant.hp -= amount;
                if (mutant.hp > 0) return {ok: true, killed: false, hp: mutant.hp};
                list.splice(list.indexOf(mutant), 1);
                return {ok: true, killed: true, hp: 0};
            },
        },
    };
}

/** A gun with a stand-in target list. `run` steps real Night ticks. */
function gunWorld(list, {setUp = () => {}} = {}) {
    const w = world();
    const id = build(w, 'siegeCannon', 12, 4);
    setUp(w, id);
    const fake = standIn(list);
    const guns = new SiegeCannons({cycle: w.cycle, placement: w.placement, grid: w.grid, mutants: fake.mutants});
    const fired = [];
    const impacts = [];
    const run = (ticks, watch = () => {}) => {
        for (let i = 0; i < ticks && w.cycle.shift === Shift.NIGHT; i++) {
            w.cycle.stepTicks(1, (t) => {
                w.cycle.onTick(t);
                const effects = guns.step();
                fired.push(...effects.fired.map((shot) => ({...shot, tick: w.cycle.elapsedNightTicks})));
                impacts.push(...effects.impacts.map((impact) => ({...impact, tick: w.cycle.elapsedNightTicks})));
            });
            watch();
        }
    };
    w.cycle.endDay();
    return {w, id, fake, guns, fired, impacts, run};
}

// ---- The building -----------------------------------------------------------

test('the approved values', () => {
    assert.deepEqual(SIEGE, {range: 256, minRange: 64, damage: 200, reloadTicks: 300, shellSpeed: 8, impactRadius: 24});
    assert.ok(Object.isFrozen(SIEGE));
    assert.deepEqual(BUILDING_TYPES.siegeCannon, {
        id: 'siegeCannon', name: 'Siege Cannon', width: 2, height: 2,
        cost: {credits: 600, ap: 1}, operations: {income: 0, upkeep: 0}, power: {supply: 0, demand: 20}, pollutionPerNight: 0, maxHp: 250,
    });
    assert.equal(TARGET_BIAS.siegeCannon, 64);
});

test('it is 2x2, charged like any building, and refused where it does not fit', () => {
    const w = world();
    const {credits, ap} = w.economy.snapshot();
    const id = build(w, 'siegeCannon', 12, 4);
    const record = w.placement.buildings().find((b) => b.id === id);
    assert.deepEqual([record.col, record.row, record.width, record.height, record.hp, record.enabled], [12, 4, 2, 2, 250, true]);
    for (const [col, row] of [[12, 4], [13, 4], [12, 5], [13, 5]]) assert.equal(w.grid.occupantAt(col, row), id);
    assert.deepEqual(w.economy.snapshot(), {credits: credits - 600, ap: ap - 1});
    assert.equal(w.place('siegeCannon', 13, 5).ok, false, 'overlaps');
    assert.equal(w.place('siegeCannon', 23, 15).ok, false, 'off the map');
    assert.equal(w.place('siegeCannon', 13, 7).ok, false, 'on the HQ ring');
});

test('it needs no road, and is a normal building to walk round, target and demolish', () => {
    const w = world();
    const id = build(w, 'siegeCannon', 3, 3);
    assert.deepEqual(w.placement.demolish(id).ok, true);
    assert.equal(w.grid.occupantAt(3, 3), null);
});

test('power: 20, in the global pool', () => {
    const w = world();
    build(w, 'siegeCannon', 12, 4);
    assert.deepEqual([calculatePower(w.placement.buildings()).generation, calculatePower(w.placement.buildings()).demand], [20, 20]);
    assert.equal(causesLowPower(w.placement.buildings(), 'siegeCannon'), true, 'a second one would stop everything');
});

// ---- Range and targets ------------------------------------------------------

test('range is an inclusive ring between the minimum and the maximum', () => {
    assert.deepEqual([63.5, 64, 256, 256.5].map((d) => isInSiegeRange({x: 0, y: 0}, {x: d, y: 0})), [false, true, true, false]);
    assert.equal(isInSiegeRange({x: 0, y: 0}, {x: 150, y: 200}), true, 'circular: exactly 250 away');
    assert.equal(isInSiegeRange({x: 0, y: 0}, {x: 190, y: 190}), false, 'circular: about 269 away');
});

test('the nearest Brute comes first, however near anything else is', () => {
    const list = [ordinary('a', 70, 0), brute('b', 250, 0), brute('c', 200, 0), spitter('d', 90, 0)];
    assert.equal(selectSiegeTarget(CENTER, list).id, 'c');
});

test('a Brute out of the ring does not count, either side of it', () => {
    assert.equal(selectSiegeTarget(CENTER, [brute('near', 40, 0), ordinary('a', 100, 0)]).id, 'a');
    assert.equal(selectSiegeTarget(CENTER, [brute('far', 300, 0), ordinary('a', 100, 0)]).id, 'a');
    assert.equal(selectSiegeTarget(CENTER, [brute('near', 40, 0), ordinary('a', 40, 0)]), null);
});

test('otherwise the nearest mutant, and a Spitter is not preferred', () => {
    assert.equal(selectSiegeTarget(CENTER, [spitter('s', 200, 0), ordinary('a', 100, 0)]).id, 'a');
    assert.equal(selectSiegeTarget(CENTER, [ordinary('a', 200, 0), spitter('s', 100, 0)]).id, 's');
});

test('ties go to spawn order, the same way each time', () => {
    assert.equal(selectSiegeTarget(CENTER, [ordinary('a', 100, 0), ordinary('b', -100, 0)]).id, 'a');
    assert.equal(selectSiegeTarget(CENTER, [brute('a', 100, 0), brute('b', 0, 100)]).id, 'a');
});

// ---- Firing -----------------------------------------------------------------

test('it fires the moment it has a target, then reloads for 300 ticks', () => {
    const {fired, run} = gunWorld([brute('b', 100, 0, 100_000)]);
    run(700);
    assert.deepEqual(fired.map(({tick}) => tick), [1, 301, 601]);
});

test('with nothing in range it holds its fire, ready', () => {
    const list = [];
    const {fired, run} = gunWorld(list);
    run(500);
    assert.deepEqual(fired, []);
    list.push(ordinary('a', 100, 0, 1000));
    run(1);
    assert.equal(fired.length, 1);
});

test('the shell flies to the point the target stood on, and hurts only on landing', () => {
    const {fake, guns, impacts, run} = gunWorld([brute('b', 200, 0)]);
    run(1);
    assert.deepEqual(guns.shells(), [{
        id: 'siege-shell-1', gunId: 'siegeCannon-2', fromX: 672, fromY: 264, x: 872, y: 264, flightTicks: 25, ticksLeft: 25,
    }]);
    run(24);
    assert.deepEqual(fake.hits, []);
    run(1);
    assert.deepEqual(fake.hits, [{id: 'b', amount: 200}]);
    assert.deepEqual(impacts, [{x: 872, y: 264, mutantId: 'b', damage: 200, hp: 400, killed: false, tick: 26}]);
    assert.deepEqual(guns.shells(), []);
});

test('no homing: a target that leaves is missed, and the shell finds nothing else', () => {
    const list = [ordinary('a', 200, 0, 1000)];
    const {fake, guns, impacts, run} = gunWorld(list);
    run(1);
    const {x, y} = guns.shells()[0];
    list[0].x += 25;
    run(30);
    assert.deepEqual([guns.shells(), fake.hits], [[], []]);
    assert.deepEqual([impacts[0].x, impacts[0].y, impacts[0].mutantId], [x, y, null]);
});

test('the impact radius is inclusive, and a target that barely moved is still hit', () => {
    const list = [ordinary('a', 200, 0, 1000)];
    const {fake, run} = gunWorld(list);
    run(1);
    list[0].x += 24;
    run(30);
    assert.equal(fake.hits.length, 1);
});

test('one shell damages one mutant, the nearest to the point, with no splash', () => {
    const list = [ordinary('a', 200, 0, 1000), ordinary('b', 205, 0, 1000), ordinary('c', 195, 0, 1000)];
    const {fake, run} = gunWorld(list);
    run(1);
    list[0].x += 3;
    list[1].x -= 4;
    list[2].x += 10; // a is now 3 px from the point, b 1 px and c 5 px, all inside the radius
    run(30);
    assert.deepEqual(fake.hits, [{id: 'b', amount: 200}]);
    assert.deepEqual(list.map((m) => m.hp), [1000, 800, 1000]);
});

test('whoever stands on the point when it lands is hit, not whoever was aimed at', () => {
    const list = [ordinary('a', 200, 0, 1000), ordinary('b', 240, 0, 1000)];
    const {fake, run} = gunWorld(list);
    run(1);
    list[0].x += 100;
    list[1].x -= 40;
    run(30);
    assert.deepEqual(fake.hits, [{id: 'b', amount: 200}]);
});

test('a target killed in flight: the shell lands harmlessly, and nothing throws', () => {
    const list = [ordinary('a', 200, 0)];
    const {fake, impacts, run} = gunWorld(list);
    run(1);
    list.length = 0;
    run(30);
    assert.deepEqual(fake.hits, []);
    assert.equal(impacts[0].mutantId, null);
});

test('shells pass over walls and buildings', () => {
    const {fake, run} = gunWorld([brute('b', 200, 0, 1000)], {
        setUp: (w) => {
            for (const row of [2, 3, 4, 5, 6, 7]) build(w, 'wall', 16, row);
        },
    });
    run(30);
    assert.deepEqual(fake.hits, [{id: 'b', amount: 200}]);
});

// ---- Power and losses -------------------------------------------------------

test('disabled, it neither fires nor reloads, and it picks up where it stopped', () => {
    const {w, id, fired, run} = gunWorld([brute('b', 100, 0, 100_000)]);
    run(101);
    assert.equal(fired.length, 1);
    w.placement.setEnabled(id, false);
    run(500);
    assert.equal(fired.length, 1);
    w.placement.setEnabled(id, true);
    run(199);
    assert.equal(fired.length, 1);
    run(1);
    assert.equal(fired.length, 2);
});

test('LOW_POWER silences it, and a shell already in the air still lands', () => {
    const w = world();
    const plant = build(w, 'powerPlant', 20, 3);
    build(w, 'siegeCannon', 12, 4);
    build(w, 'autocannon', 3, 3);
    const fake = standIn([brute('b', 200, 0, 100_000)]);
    const guns = new SiegeCannons({cycle: w.cycle, placement: w.placement, grid: w.grid, mutants: fake.mutants});
    const fired = [];
    const step = (n) => {
        for (let i = 0; i < n; i++) w.cycle.stepTicks(1, (t) => { w.cycle.onTick(t); fired.push(...guns.step().fired); });
    };
    w.cycle.endDay();
    step(1);
    assert.equal(w.placement.damageBuilding(plant, 300).destroyed, true);
    assert.equal(calculatePower(w.placement.buildings()).status, 'low-power');
    assert.equal(guns.shells().length, 1);
    step(30);
    assert.equal(fake.hits.length, 1, 'it landed');
    step(600);
    assert.equal(fired.length, 1, 'and nothing else was fired');
});

test('a lost Plant stops it the next tick, and reload pauses with it', () => {
    const w = world();
    const plant = build(w, 'powerPlant', 20, 3);
    const gun = build(w, 'siegeCannon', 12, 4);
    build(w, 'autocannon', 3, 3);
    const fake = standIn([brute('b', 100, 0, 100_000)]);
    const guns = new SiegeCannons({cycle: w.cycle, placement: w.placement, grid: w.grid, mutants: fake.mutants});
    const fired = [];
    const step = (n) => {
        for (let i = 0; i < n; i++) w.cycle.stepTicks(1, (t) => { w.cycle.onTick(t); fired.push(...guns.step().fired); });
    };
    w.cycle.endDay();
    step(100);
    assert.equal(fired.length, 1);
    assert.equal(w.placement.damageBuilding(plant, 300).destroyed, true);
    assert.equal(calculatePower(w.placement.buildings()).status, 'low-power');
    step(500);
    assert.equal(fired.length, 1);
    assert.equal(guns.snapshot().find(({id}) => id === gun).cooldown, 201);
});

test('a gun destroyed in flight: its shell still lands, and it never fires again', () => {
    const {w, id, fake, guns, fired, run} = gunWorld([brute('b', 200, 0, 100_000)]);
    run(1);
    assert.equal(w.placement.damageBuilding(id, 250).destroyed, true);
    assert.deepEqual(guns.snapshot(), []);
    run(30);
    assert.equal(fake.hits.length, 1, 'the only gun is gone, and its shell landed all the same');
    run(600);
    assert.equal(fired.length, 1);
});

test('a gun lost by Day takes its reload with it', () => {
    const w = world();
    const id = build(w, 'siegeCannon', 12, 4);
    w.placement.demolish(id);
    assert.deepEqual(w.siegeCannons.snapshot(), []);
    w.cycle.endDay();
    w.cycle.stepTicks(1, w.tick);
    assert.deepEqual(w.siegeCannons.shells(), []);
});

test('at dawn shells go without landing, and reloads reset', () => {
    const {w, fake, guns, run} = gunWorld([brute('b', 200, 0, 100_000)]);
    run(3599 - 5);
    const landed = fake.hits.length;
    assert.ok(guns.shells().length === 1 || guns.snapshot()[0].cooldown > 0);
    while (w.cycle.shift === Shift.NIGHT) run(1);
    assert.deepEqual(guns.shells(), []);
    assert.ok(fake.hits.length <= landed + 1);
    assert.deepEqual(guns.snapshot(), [{id: 'siegeCannon-2', cooldown: 0}]);
});

test('after a defeat nothing moves', () => {
    const {w, fake, guns, run} = gunWorld([brute('b', 200, 0, 100_000)]);
    run(1);
    w.cycle.defeat();
    const shells = guns.shells();
    assert.deepEqual(guns.step(), {fired: [], impacts: []});
    assert.deepEqual([guns.shells(), fake.hits], [shells, []]);
});

// ---- Wave Director ----------------------------------------------------------

test('each counts as one stationary gun in the existing formula', () => {
    const cannons = (n) => Array.from({length: n}, () => ({type: 'autocannon'}));
    const sieges = (n) => Array.from({length: n}, () => ({type: 'siegeCannon'}));
    const plan = (list) => nightPlan({day: 10, pollution: 100, buildings: list});
    assert.deepEqual([plan(cannons(2)).defenseResponse, plan([...cannons(2), ...sieges(1)]).defenseResponse], [0, 1]);
    assert.equal(plan(sieges(3)).defenseResponse, 1);
    assert.equal(plan([...cannons(8), ...sieges(2)]).defenseResponse, defenseResponse(10));
    assert.equal(plan([...cannons(30), ...sieges(30)]).defenseResponse, 4, 'the cap holds');
    const both = plan([...cannons(4), ...sieges(1)]);
    assert.deepEqual([both.autocannons, both.siegeCannons, both.budget], [4, 1, waveBudget(10, 4, 5)]);
});

test('a disabled Siege Cannon counts, like a disabled Autocannon', () => {
    const w = world();
    build(w, 'siegeCannon', 12, 4);
    build(w, 'siegeCannon', 3, 3);
    build(w, 'autocannon', 3, 10);
    w.placement.setEnabled('siegeCannon-2', false);
    assert.equal(nightPlan({day: 1, pollution: 0, buildings: w.placement.buildings()}).defenseResponse, 1);
});

test('a base without one plans exactly as before', () => {
    const plan = nightPlan({day: 12, pollution: 60, buildings: [{type: 'autocannon'}, {type: 'autocannon'}, {type: 'autocannon'}]});
    assert.deepEqual([plan.siegeCannons, plan.defenseResponse, plan.budget], [0, 1, waveBudget(12, 3, 3)]);
});

// ---- The real game ----------------------------------------------------------

const WEST = 71; // the spawn at the west end of row 8
const heavyWorld = ({schedule = [1], bruteSlots = [0], absorbedSlots = [], at: spawn = 12, ...options} = {}) => {
    const w = world({schedule, bruteSlots, absorbedSlots, rng: {nextInt: () => spawn, snapshot: () => ({})}, ...options});
    return w;
};

test('from off its lane, three shells kill a real Brute before it reaches HQ', () => {
    const w = heavyWorld({at: WEST});
    build(w, 'siegeCannon', 12, 4);
    w.cycle.endDay();
    const killedBy = [];
    while (w.cycle.shift === Shift.NIGHT) {
        w.cycle.stepTicks(1, (t) => {
            const {siege} = w.tick(t);
            killedBy.push(...siege.impacts.filter(({killed}) => killed));
        });
    }
    assert.equal(killedBy.length, 1);
    assert.equal(w.placement.buildings().find((b) => b.type === 'siegeCannon').hp, 250);
    assert.equal(w.placement.buildings().find((b) => b.type === 'hq').hp, 600);
});

test('a gun in the lane is reached before its third shell: once inside the minimum range it cannot answer', () => {
    const w = heavyWorld();
    const gun = build(w, 'siegeCannon', 12, 4);
    w.cycle.endDay();
    const shots = [];
    while (w.cycle.shift === Shift.NIGHT && w.placement.buildings().some((b) => b.id === gun)) {
        w.cycle.stepTicks(1, (t) => shots.push(...w.tick(t).siege.fired));
    }
    assert.equal(shots.length, 2);
    assert.equal(w.mutants.snapshot()[0].hp, BRUTE.maxHp - 2 * SIEGE.damage);
});

test('mutants attack it like any building, and it stays consistent', () => {
    const w = world({schedule: [...waveSchedule(20)], seed: 98});
    build(w, 'powerPlant', 20, 3);
    build(w, 'siegeCannon', 12, 4);
    w.cycle.endDay();
    while (w.cycle.shift === Shift.NIGHT) {
        w.cycle.stepTicks(1, w.tick);
        assert.deepEqual(checkInvariants(w), []);
    }
});

const fight = (speed = null) => {
    const w = createWorld({
        seed: 98, resources: FUNDS, requireHq: true, roads: true, schedule: [...waveSchedule(14)], spitterSlots: [3, 9], bruteSlots: [4, 10], absorbedSlots: [5, 6, 11, 12],
    });
    build(w, 'hq', 12, 8);
    build(w, 'powerPlant', 20, 3);
    build(w, 'siegeCannon', 12, 4);
    build(w, 'autocannon', 9, 5);
    w.cycle.endDay();
    const states = [];
    if (speed) {
        w.clock.setSpeed(speed);
        while (w.cycle.shift === Shift.NIGHT) w.clock.advance(1000 / 60, w.tick);
    } else {
        while (w.cycle.shift === Shift.NIGHT) {
            w.cycle.stepTicks(100, w.tick);
            states.push(digestOf(canonicalState(worldState(w))));
        }
    }
    return {digest: digestOf(canonicalState(worldState(w))), states, buildings: w.placement.buildings()};
};

test('the same seed repeats exactly, and shells in flight are part of the digest', () => {
    assert.deepEqual(fight(), fight());
    const state = (siegeShells) => digestOf(canonicalState({mutants: [], buildings: [], autocannons: [], rng: {}, siegeShells}));
    assert.notEqual(state([{id: 'x'}]), state([]));
});

test('1x, 2x and 4x give the same fight', () => {
    const {digest, buildings} = fight(1);
    for (const speed of [2, 4]) assert.deepEqual(fight(speed).digest, digest);
    assert.deepEqual(fight(4).buildings, buildings);
});

test('reading never changes anything, and what is read is detached', () => {
    const {guns, run} = gunWorld([brute('b', 200, 0, 100_000)]);
    run(1);
    guns.shells()[0].ticksLeft = 1;
    guns.snapshot()[0].cooldown = 1;
    assert.equal(guns.shells()[0].ticksLeft, 25);
    assert.equal(guns.snapshot()[0].cooldown, 300);
});
