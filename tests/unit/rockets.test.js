import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {REFIT_COST} from '../../src/core/buildingTypes.js';
import {CONSTRUCTION_DISABLED, UNKNOWN_BUILDING} from '../../src/core/buildingPlacement.js';
import {EconomyFailure} from '../../src/core/economy.js';
import {INFANTRY, Infantry, ROCKET, selectInfantryTarget} from '../../src/core/infantry.js';
import {calculatePower, causesLowPower} from '../../src/core/power.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {BODY_RADIUS, flightTicks, mutantAt} from '../../src/core/shots.js';
import {waveSchedule} from '../../src/core/waves.js';
import {
    LAYOUT_VERSION, LAYOUT_VERSION_BARRACKS, LAYOUT_VERSION_ROLES, LayoutFailure, exportLayout, loadLayout,
} from '../../src/testShadow/layoutSnapshot.js';
import {canonicalState, checkInvariants, createWorld, digestOf, worldState} from '../soak/harness.js';

/**
 * Rocket squads, refits and layout version 3. HQ at pointer 12,8, a Barracks at
 * pointer 16,8 with its exit at 14,8, and the Plant at pointer 20,3. Combat tests
 * give Infantry a stand-in for Mutants, so a target can stand exactly where needed.
 */

const FUNDS = {credits: 100_000, ap: 200};
const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/layouts/${name}.json`, import.meta.url), 'utf8'));
const POST = {x: 256 + 20.5 * 32, y: 104 + 13.5 * 32};

function world({schedule = [], seed, rng, resources = FUNDS, ...options} = {}) {
    const w = createWorld({seed, rng, resources, requireHq: true, roads: true, schedule, ...options});
    assert.equal(w.place('hq', 12, 8).ok, true);
    assert.equal(w.place('powerPlant', 20, 3).ok, true);
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

function rocketWorld(options) {
    const w = world(options);
    const id = build(w, 'barracks', 16, 8);
    assert.equal(w.placement.refit(id).ok, true);
    return {w, id};
}

const record = (w, id) => w.placement.buildings().find((b) => b.id === id);
const soldiers = (w) => w.infantry.soldiers();
const step = (w, ticks) => {
    for (let i = 0; i < ticks && w.cycle.shift === Shift.NIGHT; i++) w.cycle.stepTicks(1, w.tick);
};
const until = (w, condition, limit = 3000) => {
    for (let i = 0; i < limit; i++) {
        if (condition()) return;
        assert.equal(w.cycle.shift, Shift.NIGHT, 'the Night ended first');
        w.cycle.stepTicks(1, w.tick);
    }
    assert.fail(`not reached in ${limit} ticks`);
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

/**
 * A rocket squad settled on its post at 20,13, then a target list. Nothing is on
 * the list until `arrive` is called, so timing starts at a known moment.
 */
function fight({squadRole = 'rocket'} = {}) {
    const w = world();
    const id = build(w, 'barracks', 16, 8);
    if (squadRole === 'rocket') w.placement.refit(id);
    assert.equal(w.placement.setFlag(id, {col: 20, row: 13}).ok, true);
    const list = [];
    const fake = standIn(list);
    const infantry = new Infantry({cycle: w.cycle, placement: w.placement, grid: w.grid, gates: w.gates, mutants: fake.mutants});
    const shots = [];
    const impacts = [];
    const tick = (t) => {
        w.cycle.onTick(t);
        const wanted = new Set();
        infantry.addGateDemands(wanted);
        w.gates.step(wanted);
        const result = infantry.step();
        shots.push(...result.shots);
        impacts.push(...(result.impacts ?? []));
    };
    const run = (ticks, watch = () => {}) => {
        for (let i = 0; i < ticks && w.cycle.shift === Shift.NIGHT; i++) {
            w.cycle.stepTicks(1, tick);
            watch();
        }
    };
    w.cycle.endDay();
    run(600);
    return {w, id, fake, list, infantry, shots, impacts, run};
}

const target = (id, dx, dy, extra = {}) => ({id, x: POST.x + dx, y: POST.y + dy, hp: 100_000, ...extra});

// ---- Values and helpers -----------------------------------------------------

test('the approved values', () => {
    assert.deepEqual(ROCKET, {role: 'rocket', squadSize: 2, weaponRange: 128, damage: 120, cooldownTicks: 480, rocketSpeed: 5});
    assert.deepEqual(REFIT_COST, {credits: 200, ap: 1});
    assert.deepEqual(BODY_RADIUS, {ordinary: 8, spitter: 11, brute: 15});
    assert.deepEqual(INFANTRY.squadSize, 4, 'rifles are untouched');
});

test('flight is whole ticks along the longer axis, and never zero', () => {
    assert.equal(flightTicks({x: 0, y: 0}, {x: 128, y: 0}, 5), 26);
    assert.equal(flightTicks({x: 0, y: 0}, {x: 30, y: 40}, 5), 8);
    assert.equal(flightTicks({x: 3, y: 3}, {x: 3, y: 3}, 5), 1);
});

test('mutantAt takes the nearest in reach, ties to the earliest', () => {
    const reach = () => 10;
    assert.equal(mutantAt({x: 0, y: 0}, [{id: 'a', x: 8, y: 0}, {id: 'b', x: 3, y: 0}], reach).id, 'b');
    assert.equal(mutantAt({x: 0, y: 0}, [{id: 'a', x: 3, y: 0}, {id: 'b', x: -3, y: 0}], reach).id, 'a');
    assert.equal(mutantAt({x: 0, y: 0}, [{id: 'a', x: 10, y: 0}], reach).id, 'a', 'inclusive');
    assert.equal(mutantAt({x: 0, y: 0}, [{id: 'a', x: 10.5, y: 0}], reach), null);
});

// ---- Refits -----------------------------------------------------------------

test('a Barracks is rifles by default, and its record says nothing about it', () => {
    const w = world();
    const id = build(w, 'barracks', 16, 8);
    assert.equal('role' in record(w, id), false);
});

test('a refit costs 200 Credits and 1 AP, in either direction', () => {
    const w = world();
    const id = build(w, 'barracks', 16, 8);
    const {credits, ap} = w.economy.snapshot();
    assert.deepEqual(w.placement.refit(id), {ok: true, role: 'rocket'});
    assert.equal(record(w, id).role, 'rocket');
    assert.deepEqual(w.economy.snapshot(), {credits: credits - 200, ap: ap - 1});
    assert.deepEqual(w.placement.refit(id), {ok: true, role: 'rifle'});
    assert.equal('role' in record(w, id), false, 'back to exactly what it was');
    assert.deepEqual(w.economy.snapshot(), {credits: credits - 400, ap: ap - 2});
});

test('a refit is not a rebuild: flag, HP, power, id and tiles all stay', () => {
    const w = world();
    const id = build(w, 'barracks', 16, 8);
    assert.equal(w.placement.setFlag(id, {col: 20, row: 12}).ok, true);
    w.placement.damageBuilding(id, 50);
    const before = record(w, id);
    const power = calculatePower(w.placement.buildings());
    const revision = w.placement.revision;
    w.placement.refit(id);
    const {role, ...after} = record(w, id);
    assert.equal(role, 'rocket');
    assert.deepEqual(after, before);
    assert.deepEqual(calculatePower(w.placement.buildings()), power);
    assert.equal(w.placement.revision, revision);
    assert.equal(w.grid.occupantAt(16, 8), id);
    assert.equal(causesLowPower(w.placement.buildings(), 'wall'), false);
});

test('a refit is Day only, and refusals change nothing', () => {
    const w = world();
    const id = build(w, 'barracks', 16, 8);
    w.cycle.endDay();
    const {credits, ap} = w.economy.snapshot();
    assert.deepEqual(w.placement.refit(id), {ok: false, reason: CONSTRUCTION_DISABLED});
    assert.deepEqual(w.placement.canRefit(id), {ok: false, reason: CONSTRUCTION_DISABLED});
    assert.deepEqual(w.economy.snapshot(), {credits, ap});
    assert.equal('role' in record(w, id), false);
});

test('a refit needs the Credits and the AP, and only a Barracks can have one', () => {
    const w = world({resources: {credits: 1100, ap: 3}});
    const id = build(w, 'barracks', 16, 8);
    assert.deepEqual(w.economy.snapshot(), {credits: 199 + 1, ap: 1});
    w.economy.adjustCredits(-1);
    assert.deepEqual(w.placement.refit(id), {ok: false, reason: EconomyFailure.INSUFFICIENT_CREDITS});
    w.economy.adjustCredits(1);
    assert.equal(w.placement.refit(id).ok, true);
    assert.equal(w.economy.ap, 0);
    w.economy.adjustCredits(500);
    assert.deepEqual(w.placement.refit(id), {ok: false, reason: EconomyFailure.INSUFFICIENT_AP});
    assert.deepEqual(w.placement.refit('barracks-999'), {ok: false, reason: UNKNOWN_BUILDING});
    assert.deepEqual(w.placement.refit('hq-1'), {ok: false, reason: UNKNOWN_BUILDING});
});

test('demolishing a rocket Barracks works as for any other', () => {
    const {w, id} = rocketWorld();
    assert.equal(w.placement.demolish(id).ok, true);
    assert.deepEqual(w.placement.barracks(), []);
});

// ---- The squad --------------------------------------------------------------

test('two soldiers leave, on powered ticks 1 and 31, with their role on their records', () => {
    const {w} = rocketWorld();
    w.cycle.endDay();
    step(w, 1);
    assert.equal(soldiers(w).length, 1);
    step(w, 29);
    assert.equal(soldiers(w).length, 1);
    step(w, 1);
    assert.equal(soldiers(w).length, 2);
    step(w, 300);
    assert.equal(soldiers(w).length, 2);
    assert.ok(soldiers(w).every(({role, hp}) => role === 'rocket' && hp === INFANTRY.maxHp));
    assert.equal(w.infantry.snapshot().squads[0].role, 'rocket');
});

test('rifle soldiers have no role on their records, and four still deploy', () => {
    const w = world();
    build(w, 'barracks', 16, 8);
    w.cycle.endDay();
    step(w, 200);
    assert.equal(soldiers(w).length, 4);
    assert.ok(soldiers(w).every((soldier) => !('role' in soldier)));
    assert.equal('role' in w.infantry.snapshot().squads[0], false);
});

test('a lost rocket soldier is replaced after 600 powered ticks, and the squad never passes two', () => {
    const {w} = rocketWorld();
    w.cycle.endDay();
    step(w, 100);
    assert.equal(w.infantry.damageSoldier(soldiers(w)[0].id, 30).killed, true);
    assert.equal(soldiers(w).length, 1);
    step(w, 599);
    assert.equal(soldiers(w).length, 1);
    step(w, 1);
    assert.equal(soldiers(w).length, 2);
    step(w, 1500);
    assert.equal(soldiers(w).length, 2);
    assert.equal(w.infantry.snapshot().totals.deployed, 3);
});

test('a refit takes effect at the next muster, and nobody crosses a Day', () => {
    const w = world();
    const id = build(w, 'barracks', 16, 8);
    w.cycle.endDay();
    step(w, 200);
    assert.equal(soldiers(w).length, 4);
    while (w.cycle.shift === Shift.NIGHT) step(w, 240);
    assert.deepEqual(soldiers(w), []);
    w.placement.refit(id);
    w.cycle.endDay();
    step(w, 200);
    assert.equal(soldiers(w).length, 2);
});

test('rocket soldiers follow a flag, and RESET FLAG brings them home on foot', () => {
    const {w, id} = rocketWorld();
    assert.equal(w.placement.setFlag(id, {col: 8, row: 3}).ok, true);
    w.cycle.endDay();
    until(w, () => soldiers(w).length === 2 && soldiers(w).every(({col, row}) => col === 8 && row === 3));
    const [before] = soldiers(w);
    w.placement.clearFlag(id);
    step(w, 2);
    assert.ok(Math.abs(soldiers(w)[0].x - before.x) + Math.abs(soldiers(w)[0].y - before.y) <= 2);
    until(w, () => soldiers(w).every(({col, row}) => col === 14 && row === 8));
    assert.equal(w.infantry.snapshot().totals.deployed, 2);
});

test('rocket soldiers go through a gate like anyone, and it opens for them', () => {
    const {w, id} = rocketWorld();
    road(w, [[9, 8], [8, 8], [7, 8], [6, 8], [5, 8]]);
    const gate = build(w, 'gateVertical', 7, 8);
    for (let row = 0; row < 16; row++) if (row !== 8) build(w, 'wall', 7, row);
    assert.equal(w.placement.setFlag(id, {col: 4, row: 8}).ok, true);
    w.cycle.endDay();
    let opened = false;
    until(w, () => {
        opened ||= w.gates.isOpen(gate);
        return soldiers(w).length === 2 && soldiers(w).every(({col}) => col < 7);
    });
    assert.ok(opened);
});

// ---- Firing -----------------------------------------------------------------

test('range is 128 px for a rocket and still 96 for a rifle', () => {
    const at = {x: 0, y: 0};
    const far = {x: 1000, y: 1000};
    const mutant = (x) => [{id: 'a', x, y: 0}];
    assert.equal(selectInfantryTarget(at, far, mutant(128), ROCKET.weaponRange)?.id, 'a');
    assert.equal(selectInfantryTarget(at, far, mutant(128.5), ROCKET.weaponRange), null);
    assert.equal(selectInfantryTarget(at, far, mutant(96))?.id, 'a');
    assert.equal(selectInfantryTarget(at, far, mutant(96.5)), null);
});

test('a rocket flies to the point and hurts only on landing', () => {
    const {w, fake, list, infantry, shots, run} = fight();
    list.push(target('a', 100, 0, {kind: 'brute'}));
    run(1);
    const rockets = infantry.rockets();
    for (const rocket of rockets) {
        assert.deepEqual([rocket.x, rocket.y], [list[0].x, list[0].y]);
        assert.equal(rocket.ticksLeft, rocket.flightTicks);
        assert.equal(rocket.flightTicks, flightTicks({x: rocket.fromX, y: rocket.fromY}, rocket, 5));
    }
    const first = Math.min(...rockets.map(({flightTicks: ticks}) => ticks));
    assert.deepEqual(fake.hits, []);
    run(first - 1);
    assert.deepEqual(fake.hits, []);
    run(1);
    assert.deepEqual(fake.hits.slice(0, 1), [{id: 'a', amount: 120}]);
    assert.equal(shots[0].rocket, true);
    assert.equal(w.infantry.rockets().length, 0, 'the real squad is not in this fight');
});

test('each soldier reloads for 480 ticks', () => {
    const {infantry, list, run} = fight();
    list.push(target('a', 100, 0));
    const launches = [];
    let seen = new Set();
    let tick = 0;
    run(1100, () => {
        tick++;
        for (const {id} of infantry.rockets()) {
            if (!seen.has(id)) launches.push(tick);
        }
        seen = new Set([...seen, ...infantry.rockets().map(({id}) => id)]);
    });
    assert.deepEqual(launches.slice(0, 2).map((t) => t - launches[0]), [0, 0], 'both have a clear shot at once');
    assert.equal(launches[2] - launches[0], 480);
    assert.equal(launches[4] - launches[2], 480);
});

test('a slow Brute cannot get out of its own body before a rocket lands', () => {
    const {fake, list, run} = fight();
    list.push(target('b', 100, 0, {kind: 'brute'}));
    run(30, () => { list[0].x += 0.25; });
    assert.ok(fake.hits.length >= 1, 'hit while walking');
});

test('a walking ordinary mutant at long range slips out from under it', () => {
    const {fake, list, impacts, run} = fight();
    list.push(target('a', 120, 0));
    run(32, () => { list[0].x += 0.5; });
    assert.deepEqual(fake.hits, []);
    assert.ok(impacts.length >= 1);
    assert.ok(impacts.every(({mutantId}) => mutantId === null));
});

test('a stationary ordinary mutant is hit, and one rocket kills it', () => {
    const {fake, list, shots, run} = fight();
    list.push({...target('a', 100, 0), hp: 40});
    run(30);
    assert.equal(fake.hits[0].id, 'a');
    assert.equal(shots[0].killed, true);
    assert.deepEqual(list, []);
});

test('body radii decide a near miss: 8, 11 and 15 px', () => {
    for (const [kind, radius] of [[undefined, 8], ['spitter', 11], ['brute', 15]]) {
        for (const [offset, hit] of [[radius, true], [radius + 0.5, false]]) {
            const {fake, list, run} = fight();
            list.push(target('a', 100, 0, kind ? {kind} : {}));
            run(1);
            list[0].x += offset;
            run(29);
            assert.equal(fake.hits.length > 0, hit, `${kind} at ${offset}`);
        }
    }
});

test('no homing, and a miss finds nothing else', () => {
    const {fake, list, run} = fight();
    list.push(target('a', 100, 0));
    run(1);
    list[0].x += 60;
    list.push(target('b', 100, 60)); // a new target well clear of the point
    run(25);
    assert.deepEqual(fake.hits, []);
});

test('one rocket damages one mutant, the nearest to the point, with no splash', () => {
    const {fake, list, run} = fight();
    list.push(target('a', 100, 0), target('b', 100, 0));
    run(1);
    list[1].x += 4;
    run(29);
    assert.deepEqual([...new Set(fake.hits.map(({id}) => id))], ['a']);
});

test('a tie on the point goes to spawn order, and two rockets landing together act in firing order', () => {
    const {fake, list, run} = fight();
    list.push({...target('a', 100, 0), hp: 120}, {...target('b', 100, 0), hp: 120});
    run(30);
    assert.deepEqual(fake.hits.map(({id}) => id), ['a', 'b'], 'the second finds the next one on the point');
});

test('rockets pass over walls', () => {
    const {w, fake, list, run} = fight();
    assert.equal(w.grid.occupantAt(20, 12), null);
    list.push(target('a', 0, -100, {kind: 'brute'}));
    run(40);
    assert.ok(fake.hits.length >= 1);
});

test('Brutes come first, over a nearer mutant and over a lock', () => {
    const {fake, list, run} = fight();
    list.push(target('a', 40, 0));
    run(440); // the first pair is spent on the ordinary mutant, and the reload is nearly over
    assert.ok(fake.hits.every(({id}) => id === 'a'));
    fake.hits.length = 0;
    list.push(target('b', 110, 0, {kind: 'brute'}));
    run(90);
    assert.ok(fake.hits.length > 0);
    assert.ok(fake.hits.every(({id}) => id === 'b'));
});

test('with no Brute about, the existing nearest target rule applies', () => {
    const {fake, list, run} = fight();
    list.push(target('far', 110, 0), target('near', 40, 0));
    run(30);
    assert.ok(fake.hits.every(({id}) => id === 'near'));
});

test('rifle squads do not prefer Brutes', () => {
    const {fake, list, run} = fight({squadRole: 'rifle'});
    list.push(target('b', 90, 0, {kind: 'brute'}), target('near', 30, 0));
    run(5);
    assert.ok(fake.hits.length > 0);
    assert.ok(fake.hits.every(({id, amount}) => id === 'near' && amount === INFANTRY.damage));
});

// ---- In flight --------------------------------------------------------------

test('a target already gone: the rocket lands harmlessly', () => {
    const {fake, list, impacts, run} = fight();
    list.push(target('a', 100, 0));
    run(1);
    list.length = 0;
    run(30);
    assert.deepEqual(fake.hits, []);
    assert.ok(impacts.every(({mutantId}) => mutantId === null));
});

test('a rocket outlives its soldier', () => {
    const {w, fake, list, infantry, run} = fight();
    list.push(target('a', 100, 0, {kind: 'brute'}));
    run(1);
    for (const {id} of infantry.soldiers()) infantry.damageSoldier(id, 30);
    assert.deepEqual(infantry.soldiers(), []);
    run(30);
    assert.ok(fake.hits.length >= 1);
    assert.equal(w.cycle.shift, Shift.NIGHT);
});

test('a rocket outlives its Barracks and its whole squad, and still lands', () => {
    const {w, id, fake, list, infantry, run} = fight();
    list.push(target('a', 100, 0, {kind: 'brute'}));
    run(1);
    for (const {id: soldier} of infantry.soldiers()) infantry.damageSoldier(soldier, 30);
    w.placement.damageBuilding(id, 300);
    run(1); // the squad is dropped here, with its rockets still in the air
    assert.equal(infantry.snapshot().squads.length, 0);
    assert.ok(infantry.rockets().length >= 1);
    run(30);
    assert.ok(fake.hits.length >= 1);
    assert.deepEqual(infantry.rockets(), []);
});

test('at dawn rockets and soldiers go, and nothing lands on the way out', () => {
    const {w, fake, list, infantry, run} = fight();
    list.push(target('a', 100, 0, {kind: 'brute'}));
    while (w.cycle.elapsedNightTicks < 3599 - 2 && w.cycle.shift === Shift.NIGHT) run(1);
    const hits = fake.hits.length;
    while (w.cycle.shift === Shift.NIGHT) run(1);
    assert.ok(fake.hits.length <= hits + 2);
    assert.deepEqual([infantry.rockets(), infantry.soldiers()], [[], []]);
});

test('with only rockets left at dawn, they still go', () => {
    const {w, id, list, infantry, run} = fight();
    while (w.cycle.elapsedNightTicks < 3590) run(1);
    list.push(target('a', 100, 0, {kind: 'brute'}));
    run(1);
    assert.ok(infantry.rockets().length > 0);
    for (const {id: soldier} of infantry.soldiers()) infantry.damageSoldier(soldier, 30);
    w.placement.damageBuilding(id, 300);
    while (w.cycle.shift === Shift.NIGHT) run(1);
    infantry.step();
    assert.deepEqual(infantry.rockets(), []);
});

// ---- The real game ----------------------------------------------------------

const lane = (options) => {
    const w = world({rng: {nextInt: () => 20, snapshot: () => ({})}, schedule: [1], bruteSlots: [0], ...options});
    return w;
};

test('a real rocket squad on a forward flag kills a real Brute, far sooner than rifles', () => {
    const killTick = (refit) => {
        const w = lane();
        const id = build(w, 'barracks', 16, 8);
        if (refit) w.placement.refit(id);
        assert.equal(w.placement.setFlag(id, {col: 18, row: 2}).ok, true);
        w.cycle.endDay();
        let killed = null;
        while (w.cycle.shift === Shift.NIGHT && killed === null) {
            w.cycle.stepTicks(1, (t) => {
                const {infantryShots} = w.tick(t);
                if (infantryShots.some((shot) => shot.killed)) killed = w.cycle.elapsedNightTicks;
            });
        }
        return killed;
    };
    const rockets = killTick(true);
    const rifles = killTick(false);
    assert.ok(rockets !== null);
    assert.ok(rifles === null || rifles > rockets * 1.5, `rockets ${rockets}, rifles ${rifles}`);
});

test('a mixed Night stays consistent', () => {
    const w = world({seed: 98, schedule: [...waveSchedule(14)], spitterSlots: [3, 9], bruteSlots: [4, 10], absorbedSlots: [5, 6, 11, 12]});
    const id = build(w, 'barracks', 16, 8);
    w.placement.refit(id);
    assert.equal(w.placement.setFlag(id, {col: 20, row: 9}).ok, true);
    w.cycle.endDay();
    while (w.cycle.shift === Shift.NIGHT) {
        w.cycle.stepTicks(1, w.tick);
        assert.deepEqual(checkInvariants(w), []);
    }
    assert.deepEqual(w.infantry.rockets(), []);
});

const mixed = (speed = null) => {
    const w = world({seed: 98, schedule: [...waveSchedule(14)], spitterSlots: [3, 9], bruteSlots: [4, 10], absorbedSlots: [5, 6, 11, 12]});
    const rocket = build(w, 'barracks', 16, 8);
    road(w, [[14, 11], [14, 12]]);
    build(w, 'barracks', 16, 12);
    w.placement.refit(rocket);
    w.placement.setFlag(rocket, {col: 20, row: 9});
    w.cycle.endDay();
    if (speed) {
        w.clock.setSpeed(speed);
        while (w.cycle.shift === Shift.NIGHT) w.clock.advance(1000 / 60, w.tick);
    } else {
        while (w.cycle.shift === Shift.NIGHT) w.cycle.stepTicks(240, w.tick);
    }
    return {digest: digestOf(canonicalState(worldState(w))), buildings: w.placement.buildings(), totals: w.infantry.snapshot().totals};
};

test('the same seed repeats exactly, and rockets in flight are part of the digest', () => {
    assert.deepEqual(mixed(), mixed());
    const state = (rockets) => digestOf(canonicalState({mutants: [], buildings: [], autocannons: [], rng: {}, rockets}));
    assert.notEqual(state([{id: 'x'}]), state([]));
});

test('1x, 2x and 4x give the same fight', () => {
    const baseline = mixed(1);
    assert.deepEqual(mixed(2), baseline);
    assert.deepEqual(mixed(4), baseline);
});

// ---- Layout version 3 -------------------------------------------------------

function twoSquads() {
    const w = world();
    const first = build(w, 'barracks', 16, 8);
    road(w, [[14, 11], [14, 12]]);
    const second = build(w, 'barracks', 16, 12);
    return {w, first, second};
}

const loaded = (snapshot) => {
    const w = createWorld({requireHq: true, roads: true});
    return {w, result: loadLayout(w, snapshot)};
};

test('an all-rifle layout is version 2, byte for byte, even after a round trip through rockets', () => {
    const {w, first} = twoSquads();
    const before = JSON.stringify(exportLayout(w));
    assert.equal(JSON.parse(before).version, LAYOUT_VERSION_BARRACKS);
    w.placement.refit(first);
    assert.equal(exportLayout(w).version, LAYOUT_VERSION_ROLES);
    w.placement.refit(first);
    assert.equal(JSON.stringify(exportLayout(w)), before);
});

test('rockets export as version 3, with a role on every Barracks and independent flags', () => {
    const {w, first, second} = twoSquads();
    w.placement.refit(second);
    assert.equal(w.placement.setFlag(first, {col: 20, row: 12}).ok, true);
    const layout = exportLayout(w);
    assert.equal(layout.version, LAYOUT_VERSION_ROLES);
    const barracks = layout.buildings.filter((b) => b.type === 'barracks');
    assert.deepEqual(barracks.map(({role, flag}) => [role, flag]), [['rifle', {col: 20, row: 12}], ['rocket', null]]);
    assert.ok(layout.buildings.filter((b) => b.type !== 'barracks').every((b) => !('role' in b) && !('flag' in b)));
});

test('export, load, export gives the same bytes, and costs nothing', () => {
    const {w, first, second} = twoSquads();
    w.placement.refit(first);
    w.placement.setFlag(second, {col: 7, row: 3});
    const layout = exportLayout(w);
    const {w: copy, result} = loaded(layout);
    assert.equal(result.ok, true, result.detail);
    assert.equal(JSON.stringify(exportLayout(copy)), JSON.stringify(layout));
    const starting = createWorld({requireHq: true, roads: true}).economy.snapshot();
    assert.deepEqual(copy.economy.snapshot(), starting, 'no refit was charged, and no AP spent');
    assert.deepEqual(copy.placement.barracks().map(({role, flag}) => [role, flag]), [['rocket', null], [undefined, {col: 7, row: 3}]]);
});

test('a loaded rocket Barracks musters rockets', () => {
    const {w, first} = twoSquads();
    w.placement.refit(first);
    const {w: copy} = loaded(exportLayout(w));
    copy.cycle.endDay();
    step(copy, 200);
    assert.equal(copy.infantry.soldiers().length, 2 + 4);
    assert.equal(copy.infantry.soldiers().filter(({role}) => role === 'rocket').length, 2);
});

test('soldiers and rockets are never saved', () => {
    const {w, first} = twoSquads();
    w.placement.refit(first);
    const before = JSON.stringify(exportLayout(w));
    w.cycle.endDay();
    step(w, 200);
    assert.equal(JSON.stringify(exportLayout(w)), before);
});

test('existing fixtures load exactly as they did: versions 1 and 2', () => {
    for (const [name, version] of [['logistics-reference', LAYOUT_VERSION], ['infantry-reference', LAYOUT_VERSION_BARRACKS], ['golden-fortress-day33-v2', LAYOUT_VERSION_BARRACKS]]) {
        const snapshot = fixture(name);
        assert.equal(snapshot.version, version);
        const {w, result} = loaded(snapshot);
        assert.equal(result.ok, true);
        assert.deepEqual(exportLayout(w), snapshot);
        assert.ok(w.placement.barracks().every((b) => !('role' in b)));
    }
});

test('the player-authored version 3 fortress loads as designed, and costs nothing', () => {
    const snapshot = fixture('golden-fortress-brute-defense-v3');
    assert.equal(snapshot.version, LAYOUT_VERSION_ROLES);
    const {w, result} = loaded(snapshot);
    assert.equal(result.ok, true, result.detail);
    assert.equal(JSON.stringify(exportLayout(w)), JSON.stringify(snapshot));
    const count = (type) => w.placement.buildings().filter((b) => b.type === type).length;
    assert.deepEqual(['autocannon', 'siegeCannon', 'powerPlant', 'factory'].map(count), [10, 2, 4, 2]);
    assert.deepEqual(w.placement.barracks().map(({role, flag}) => [role, flag]), [['rocket', {col: 7, row: 11}], ['rocket', {col: 13, row: 2}]]);
    assert.equal(calculatePower(w.placement.buildings()).status, 'normal');
    assert.deepEqual(w.economy.snapshot(), createWorld({requireHq: true, roads: true}).economy.snapshot());
});

test('specialization values are checked, and the version must match the contents', () => {
    const {w, first} = twoSquads();
    w.placement.refit(first);
    const good = exportLayout(w);
    const tamper = (change) => {
        const snapshot = structuredClone(good);
        change(snapshot, snapshot.buildings.filter((b) => b.type === 'barracks'));
        return loaded(snapshot).result;
    };
    const cases = [
        [LayoutFailure.INVALID_SNAPSHOT, (_, [a]) => { a.role = 'laser'; }],
        [LayoutFailure.INVALID_SNAPSHOT, (_, [a]) => { a.role = 7; }],
        [LayoutFailure.INVALID_SNAPSHOT, (_, [, b]) => { delete b.role; }],
        [LayoutFailure.UNSUPPORTED_SCHEMA, (s, bs) => { for (const b of bs) b.role = 'rifle'; }],
        [LayoutFailure.UNSUPPORTED_SCHEMA, (s) => { s.version = 2; }],
        [LayoutFailure.UNSUPPORTED_SCHEMA, (s) => { s.version = 4; }],
        [LayoutFailure.INVALID_SNAPSHOT, (s) => { s.buildings[1].role = 'rocket'; }],
    ];
    for (const [reason, change] of cases) {
        const result = tamper(change);
        assert.equal(result.ok, false);
        assert.equal(result.reason, reason, String(change));
        assert.notEqual(result.applied, true, 'nothing partial is left');
    }
    const rifleOnly = structuredClone(good);
    rifleOnly.version = 2;
    for (const b of rifleOnly.buildings) delete b.role;
    rifleOnly.buildings.find((b) => b.type === 'barracks').role = 'rifle';
    assert.equal(loaded(rifleOnly).result.reason, LayoutFailure.INVALID_SNAPSHOT, 'version 2 has no role field');
});
