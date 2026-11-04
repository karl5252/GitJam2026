import test from 'node:test';
import assert from 'node:assert/strict';
import {AUTOCANNON, Autocannons, isInRange, selectMutant} from '../../src/core/autocannons.js';
import {INVALID_DAMAGE, MUTANT, Mutants, UNKNOWN_MUTANT, distanceToFootprint} from '../../src/core/mutants.js';
import {BUILDING_TYPES} from '../../src/core/buildingTypes.js';
import {BuildingPlacement} from '../../src/core/buildingPlacement.js';
import {Economy} from '../../src/core/economy.js';
import {Grid} from '../../src/core/grid.js';
import {Pollution, calculateEmissions} from '../../src/core/pollution.js';
import {calculatePower} from '../../src/core/power.js';
import {SeededRandom} from '../../src/core/seededRandom.js';
import {calculateSettlement, settleNight} from '../../src/core/settlement.js';
import {Shift, ShiftCycle} from '../../src/core/shiftCycle.js';
import {SimulationClock} from '../../src/core/simulationClock.js';
import {quantizeFacing} from '../../src/scenes/AutocannonLayer.js';

const CENTER = {x: 0, y: 0};
const topSpawn = (col) => col;

function fixedRng(...indices) {
    const rng = {draws: 0, nextInt: () => indices[rng.draws++ % indices.length]};
    return rng;
}

/** Stands in for Mutants where a test needs exact positions. */
function fakeMutants(list) {
    return {
        list,
        snapshot: () => list.map((mutant) => ({...mutant})),
        damageMutant(id, amount) {
            const index = list.findIndex((mutant) => mutant.id === id);
            if (index === -1) return {ok: false, reason: UNKNOWN_MUTANT};
            list[index].hp = Math.max(0, list[index].hp - amount);
            const {hp} = list[index];
            if (hp === 0) list.splice(index, 1);
            return {ok: true, killed: hp === 0, hp};
        },
    };
}

/** The real objects, ticked in the same order as GameScene.stepSimulation. */
function world({schedule = [1], rng = fixedRng(0), fake = null, credits = 100000, ap = 50} = {}) {
    const clock = new SimulationClock();
    const economy = new Economy({credits, ap});
    const pollution = new Pollution();
    const grid = new Grid({cols: 24, rows: 16, tileSize: 32, originX: 256, originY: 104});
    let cycle;
    let failSettlement = false;
    const reports = [];
    const placement = new BuildingPlacement(grid, economy, {isConstructionAllowed: () => cycle.isConstructionAllowed});
    cycle = new ShiftCycle({
        clock,
        economy,
        settleNight: (day) => {
            if (failSettlement) throw new Error('settlement failed');
            const report = settleNight({day, buildings: placement.buildings(), economy, pollution});
            reports.push(report);
            return report;
        },
    });
    const real = new Mutants({cycle, placement, grid, rng, schedule});
    const mutants = fake ?? real;
    const autocannons = new Autocannons({cycle, placement, grid, mutants});
    const log = [];
    const onTick = (tick) => {
        cycle.onTick(tick);
        const defense = autocannons.step();
        const effects = fake ? {spawned: [], attacks: [], destroyed: []} : real.step();
        log.push({night: cycle.elapsedNightTicks, shift: cycle.shift, shots: defense.shots, effects});
    };
    const step = (total) => {
        let done = 0;
        while (done < total) {
            const n = cycle.stepTicks(Math.min(240, total - done), onTick);
            if (n === 0) break;
            done += n;
        }
        return done;
    };
    const frames = (n, delta = 1000 / 60) => {
        for (let i = 0; i < n; i++) clock.advance(delta, onTick);
    };
    const place = (type, col, row) => {
        placement.select(type);
        const result = placement.placeAt({col, row});
        assert.equal(result.ok, true, `${type} at ${col},${row}`);
        placement.cancel();
        return result.building.id;
    };
    const setFail = (value) => { failSettlement = value; };
    const centerOf = (col, row) => grid.cellCenter(col, row);
    cycle.begin();
    return {clock, economy, pollution, grid, placement, cycle, mutants, autocannons, rng, log, reports, onTick, step, frames, place, setFail, centerOf};
}

/** Step one tick at a time; a condition never reached fails instead of hanging. */
function stepUntil(w, done, limit = 4000) {
    for (let i = 0; i < limit; i++) {
        if (done()) return;
        w.step(1);
    }
    assert.fail(`condition not reached within ${limit} ticks`);
}

const allShots = (w) => w.log.flatMap((l) => l.shots);
const shotTicks = (w) => w.log.filter((l) => l.shots.length).map((l) => l.night);
const turret = (w, id) => w.autocannons.snapshot().find((t) => t.id === id);

/** A Plant far away, an Autocannon at (12,8), and a stub mutant list. */
function fakeWorld(list) {
    const fake = fakeMutants(list);
    const w = world({fake});
    const plant = w.place('powerPlant', 2, 13);
    const cannon = w.place('autocannon', 12, 8);
    const center = w.centerOf(12, 8);
    const at = (dx, dy) => ({x: center.x + dx, y: center.y + dy});
    return {w, fake, plant, cannon, center, at};
}

const fakeMutant = (id, x, y, hp = 1000000) => ({id, x, y, hp});

// ---- Values -----------------------------------------------------------------------

test('graybox values are the approved ones', () => {
    assert.deepEqual(AUTOCANNON, {range: 160, damage: 10, cooldownTicks: 30});
    assert.ok(Object.isFrozen(AUTOCANNON));
    assert.deepEqual(BUILDING_TYPES.autocannon.cost, {credits: 250, ap: 1});
});

test('an Autocannon earns nothing, costs no upkeep and emits nothing', () => {
    const buildings = [
        {id: 'p', type: 'powerPlant', enabled: true},
        {id: 'a', type: 'autocannon', enabled: true},
    ];
    const settlement = calculateSettlement(buildings);
    assert.deepEqual([settlement.gross, settlement.upkeep, settlement.net], [0, 0, 0]);
    assert.equal(settlement.counts.autocannon, 1);
    assert.equal(calculateEmissions(buildings), 12); // the Plant only
    assert.equal(calculateEmissions([buildings[1]]), 0);
    assert.equal(calculatePower(buildings).demand, 20);
});

test('an Autocannon is a separate type: Outposts never fire', () => {
    const w = world({rng: fixedRng(topSpawn(12))});
    w.place('powerPlant', 2, 13);
    w.place('outpost', 12, 3);
    w.cycle.endDay();
    w.step(1000);
    assert.deepEqual(allShots(w), []);
    assert.deepEqual(w.autocannons.snapshot(), []);
});

// ---- Range and selection ----------------------------------------------------------

test('range is circular and inclusive at exactly 160 px', () => {
    const inside = [[160, 0], [0, 160], [-160, 0], [0, -160], [96, 128], [-128, 96]];
    const outside = [[160.5, 0], [0, -160.5], [96.5, 128], [113.5, 113.5]];
    for (const [x, y] of inside) assert.equal(isInRange(CENTER, {x, y}), true, `${x},${y}`);
    for (const [x, y] of outside) assert.equal(isInRange(CENTER, {x, y}), false, `${x},${y}`);
});

test('selectMutant picks the nearest in range, or null', () => {
    const near = {id: 'near', x: 50, y: 0};
    const far = {id: 'far', x: 100, y: 0};
    const away = {id: 'away', x: 200, y: 0};
    assert.equal(selectMutant(CENTER, [far, near, away]).id, 'near');
    assert.equal(selectMutant(CENTER, [away]), null);
    assert.equal(selectMutant(CENTER, []), null);
});

test('equal distances go to spawn order, not id order', () => {
    const a = {id: 'mutant-10', x: 30, y: 40};
    const b = {id: 'mutant-2', x: 50, y: 0};
    assert.equal(selectMutant(CENTER, [a, b]).id, 'mutant-10');
    assert.equal(selectMutant(CENTER, [b, a]).id, 'mutant-2');
});

test('range is measured from the footprint centre', () => {
    const {w, cannon, at} = fakeWorld([]);
    const mutant = fakeMutant('m', at(160, 0).x, at(160, 0).y);
    w.mutants.list.push(mutant);
    w.cycle.endDay();
    w.step(1);
    assert.equal(turret(w, cannon).targetId, 'm');
    mutant.x += 0.5;
    w.step(1);
    assert.equal(turret(w, cannon).targetId, null);
});

// ---- Target locking ---------------------------------------------------------------

test('a lock is kept when a nearer mutant arrives', () => {
    const {w, cannon, at} = fakeWorld([]);
    const first = fakeMutant('first', at(150, 0).x, at(150, 0).y);
    w.mutants.list.push(first);
    w.cycle.endDay();
    w.step(1);
    w.mutants.list.push(fakeMutant('second', at(20, 0).x, at(20, 0).y));
    w.step(100);
    assert.equal(turret(w, cannon).targetId, 'first');
    assert.ok(allShots(w).every((s) => s.mutantId === 'first'));
});

test('no jitter between mutants that keep swapping which is nearer', () => {
    const {w, cannon, at} = fakeWorld([]);
    const a = fakeMutant('a', at(50, 0).x, at(50, 0).y);
    const b = fakeMutant('b', at(60, 0).x, at(60, 0).y);
    w.mutants.list.push(a, b);
    w.cycle.endDay();
    w.step(1); // locks 'a', the nearer of the two
    for (let i = 0; i < 200; i++) {
        [a.x, b.x] = [b.x, a.x];
        w.step(1);
        assert.equal(turret(w, cannon).targetId, 'a');
    }
});

test('a target that dies is replaced by the nearest living mutant, on the next tick', () => {
    const {w, cannon, at} = fakeWorld([]);
    w.mutants.list.push(
        fakeMutant('weak', at(10, 0).x, at(10, 0).y, 10),
        fakeMutant('far', at(100, 0).x, at(100, 0).y),
        fakeMutant('near', at(50, 0).x, at(50, 0).y),
    );
    w.cycle.endDay();
    w.step(1);
    assert.equal(allShots(w)[0].killed, true);
    assert.equal(turret(w, cannon).targetId, null); // never left pointing at the dead
    w.step(1);
    assert.equal(turret(w, cannon).targetId, 'near');
});

test('a target that leaves range is replaced, and the lock does not return', () => {
    const {w, cannon, at} = fakeWorld([]);
    const a = fakeMutant('a', at(30, 0).x, at(30, 0).y);
    const b = fakeMutant('b', at(90, 0).x, at(90, 0).y);
    w.mutants.list.push(a, b);
    w.cycle.endDay();
    w.step(1);
    assert.equal(turret(w, cannon).targetId, 'a');
    a.x = at(161, 0).x;
    w.step(1);
    assert.equal(turret(w, cannon).targetId, 'b');
    a.x = at(10, 0).x; // back in range and nearer: b stays locked
    w.step(1);
    assert.equal(turret(w, cannon).targetId, 'b');
});

test('reacquisition neither resets nor bypasses the cooldown', () => {
    const {w, cannon, at} = fakeWorld([]);
    const a = fakeMutant('a', at(30, 0).x, at(30, 0).y);
    const b = fakeMutant('b', at(60, 0).x, at(60, 0).y);
    w.mutants.list.push(a, b);
    w.cycle.endDay();
    w.step(11); // fired on tick 1, then 10 ticks of cooldown
    assert.equal(turret(w, cannon).cooldown, 20);
    a.x = at(500, 0).x;
    w.step(1);
    assert.deepEqual(turret(w, cannon), {id: cannon, cooldown: 19, targetId: 'b'});
    assert.deepEqual(shotTicks(w), [1]);
    w.step(19);
    assert.deepEqual(shotTicks(w), [1, 31]);
    assert.equal(allShots(w)[1].mutantId, 'b');
});

test('disabling clears the lock; enabling acquires the nearest again', () => {
    const {w, cannon, at} = fakeWorld([]);
    const a = fakeMutant('a', at(90, 0).x, at(90, 0).y);
    w.mutants.list.push(a);
    w.cycle.endDay();
    w.step(1);
    w.mutants.list.push(fakeMutant('b', at(10, 0).x, at(10, 0).y));
    assert.equal(turret(w, cannon).targetId, 'a');
    w.placement.setEnabled(cannon, false);
    w.step(1);
    assert.equal(turret(w, cannon).targetId, null);
    w.placement.setEnabled(cannon, true);
    w.step(1);
    assert.equal(turret(w, cannon).targetId, 'b');
});

test('going unpowered clears the lock', () => {
    const {w, plant, cannon, at} = fakeWorld([]);
    w.mutants.list.push(fakeMutant('a', at(90, 0).x, at(90, 0).y));
    w.cycle.endDay();
    w.step(1);
    assert.equal(turret(w, cannon).targetId, 'a');
    w.placement.setEnabled(plant, false);
    w.step(1);
    assert.equal(turret(w, cannon).targetId, null);
});

// ---- Cooldown boundaries ----------------------------------------------------------

test('a ready turret fires on the first tick a target is in range, then every 30 ticks', () => {
    const {w, cannon, at} = fakeWorld([]);
    w.mutants.list.push(fakeMutant('a', at(10, 0).x, at(10, 0).y));
    w.cycle.endDay();
    w.step(1);
    assert.equal(turret(w, cannon).cooldown, 30);
    w.step(29);
    assert.equal(turret(w, cannon).cooldown, 1);
    assert.deepEqual(shotTicks(w), [1]);
    w.step(1);
    assert.deepEqual(shotTicks(w), [1, 31]);
    w.step(60);
    assert.deepEqual(shotTicks(w), [1, 31, 61, 91]);
});

test('the cooldown keeps counting with no target, and a ready turret waits', () => {
    const {w, cannon, at} = fakeWorld([]);
    const a = fakeMutant('a', at(10, 0).x, at(10, 0).y);
    w.mutants.list.push(a);
    w.cycle.endDay();
    w.step(1);
    a.x = at(500, 0).x;
    w.step(50);
    assert.deepEqual(turret(w, cannon), {id: cannon, cooldown: 0, targetId: null});
    a.x = at(10, 0).x;
    w.step(1);
    assert.deepEqual(shotTicks(w), [1, 52]);
});

test('the cooldown pauses while disabled and resumes where it stopped', () => {
    const {w, cannon, at} = fakeWorld([]);
    w.mutants.list.push(fakeMutant('a', at(10, 0).x, at(10, 0).y));
    w.cycle.endDay();
    w.step(11);
    assert.equal(turret(w, cannon).cooldown, 20);
    w.placement.setEnabled(cannon, false);
    w.step(500);
    assert.equal(turret(w, cannon).cooldown, 20);
    assert.deepEqual(shotTicks(w), [1]);
    w.placement.setEnabled(cannon, true);
    w.step(19);
    assert.equal(turret(w, cannon).cooldown, 1);
    assert.deepEqual(shotTicks(w), [1]);
    w.step(1);
    assert.deepEqual(shotTicks(w), [1, 531]);
});

test('the cooldown pauses in LOW_POWER and BLACKOUT', () => {
    for (const [name, disrupt, restore] of [
        ['low power', (w) => { for (const c of [15, 18, 21]) w.place('factory', c, 2); }, null],
        ['blackout', (w, plant) => w.placement.setEnabled(plant, false), (w, plant) => w.placement.setEnabled(plant, true)],
    ]) {
        const fake = fakeMutants([]);
        const w = world({fake});
        const plant = w.place('powerPlant', 2, 13);
        const cannon = w.place('autocannon', 12, 8);
        if (name === 'low power') disrupt(w, plant);
        const {x, y} = w.centerOf(12, 8);
        fake.list.push(fakeMutant('a', x + 10, y));
        w.cycle.endDay();
        if (name === 'low power') {
            assert.equal(calculatePower(w.placement.buildings()).status, 'low-power');
            w.step(100);
            assert.deepEqual(shotTicks(w), [], name);
            assert.deepEqual(turret(w, cannon), {id: cannon, cooldown: 0, targetId: null});
            continue;
        }
        w.step(11);
        disrupt(w, plant);
        assert.equal(calculatePower(w.placement.buildings()).status, 'blackout');
        w.step(100);
        assert.equal(turret(w, cannon).cooldown, 20, name);
        restore(w, plant);
        w.step(20);
        assert.deepEqual(shotTicks(w), [1, 131], name);
    }
});

test('toggling ON and OFF can never beat the fire rate', () => {
    const steady = fakeWorld([fakeMutant('a', 0, 0)]);
    const toggled = fakeWorld([fakeMutant('a', 0, 0)]);
    for (const {w, at, fake} of [steady, toggled]) {
        Object.assign(fake.list[0], at(10, 0));
        w.cycle.endDay();
    }
    for (let i = 0; i < 600; i++) {
        toggled.w.placement.setEnabled(toggled.cannon, i % 2 === 0);
        toggled.w.step(1);
        steady.w.step(1);
    }
    const gaps = shotTicks(toggled.w).map((t, i, all) => t - (all[i - 1] ?? t - 30));
    assert.ok(gaps.every((gap) => gap >= 30), `gaps ${gaps}`);
    assert.ok(shotTicks(toggled.w).length < shotTicks(steady.w).length);
});

test('every night starts ready: cooldowns and locks clear at dawn', () => {
    const {w, cannon, at} = fakeWorld([]);
    w.mutants.list.push(fakeMutant('a', at(10, 0).x, at(10, 0).y));
    w.cycle.endDay();
    w.step(3585);
    assert.ok(turret(w, cannon).cooldown > 0);
    w.step(15);
    assert.equal(w.cycle.shift, Shift.DAY);
    assert.deepEqual(turret(w, cannon), {id: cannon, cooldown: 0, targetId: null});
    w.cycle.endDay();
    w.step(1);
    assert.equal(w.log.at(-1).shots.length, 1);
});

// ---- Damage and death -------------------------------------------------------------

test('damageMutant reduces hp, kills once, and rejects bad input with no change', () => {
    const w = world();
    w.cycle.endDay();
    w.step(1);
    const {id} = w.mutants.snapshot()[0];
    for (const bad of [0, -5, 1.5, NaN, Infinity, '5', null, undefined]) {
        assert.deepEqual(w.mutants.damageMutant(id, bad), {ok: false, reason: INVALID_DAMAGE}, String(bad));
    }
    assert.deepEqual(w.mutants.damageMutant('mutant-99', 5), {ok: false, reason: UNKNOWN_MUTANT});
    assert.equal(w.mutants.snapshot()[0].hp, 40);
    assert.deepEqual(w.mutants.damageMutant(id, 39), {ok: true, killed: false, hp: 1});
    assert.equal(w.mutants.snapshot()[0].hp, 1);
    assert.deepEqual(w.mutants.damageMutant(id, 1), {ok: true, killed: true, hp: 0});
    assert.deepEqual(w.mutants.snapshot(), []);
    assert.deepEqual(w.mutants.damageMutant(id, 1), {ok: false, reason: UNKNOWN_MUTANT});
});

test('overkill reports 0 hp and kills once', () => {
    const w = world();
    w.cycle.endDay();
    w.step(1);
    assert.deepEqual(w.mutants.damageMutant('mutant-1', 9999), {ok: true, killed: true, hp: 0});
});

test('a mutant dies on the 4th shot, exactly once, and the shots are exact', () => {
    const w = world({rng: fixedRng(topSpawn(12))});
    w.place('powerPlant', 12, 13);
    w.place('autocannon', 14, 3);
    w.cycle.endDay();
    w.step(200);
    assert.deepEqual(allShots(w).map((s) => [s.hp, s.killed]), [[30, false], [20, false], [10, false], [0, true]]);
    assert.deepEqual(w.mutants.snapshot(), []);
    const ticks = shotTicks(w);
    assert.deepEqual(ticks.map((t) => t - ticks[0]), [0, 30, 60, 90]);
});

test('shots report where the mutant was when it was hit', () => {
    const w = world({rng: fixedRng(topSpawn(12))});
    w.place('powerPlant', 12, 13);
    w.place('autocannon', 14, 5);
    w.cycle.endDay();
    stepUntil(w, () => allShots(w).length > 0);
    const [shot] = allShots(w);
    assert.deepEqual([shot.x, shot.y], [w.mutants.snapshot()[0].x, w.mutants.snapshot()[0].y - MUTANT.speed]);
    assert.ok(isInRange(w.centerOf(14, 5), shot));
});

test('the first shot happens as a walking mutant crosses into range', () => {
    const w = world({rng: fixedRng(topSpawn(12))});
    w.place('powerPlant', 12, 13);
    w.place('autocannon', 12, 8);
    w.cycle.endDay();
    const center = w.centerOf(12, 8);
    stepUntil(w, () => allShots(w).length > 0);
    assert.equal(allShots(w)[0].y - center.y, -AUTOCANNON.range);
});

test('a mutant killed this tick cannot attack on that tick', () => {
    function arrange() {
        const w = world({rng: fixedRng(topSpawn(12))});
        w.place('powerPlant', 2, 13);
        const outpost = w.place('outpost', 12, 3);
        const cannon = w.place('autocannon', 16, 3); // in range, but not the preferred target
        w.placement.setEnabled(cannon, false);
        w.cycle.endDay();
        w.step(1);
        assert.equal(w.mutants.snapshot()[0].targetId, outpost);
        stepUntil(w, () => w.mutants.snapshot()[0].attackTimer === 1);
        return {w, outpost, cannon};
    }
    const control = arrange();
    control.w.step(1);
    assert.equal(control.w.log.at(-1).effects.attacks.length, 1); // the hit was due this tick

    const {w, outpost, cannon} = arrange();
    w.mutants.damageMutant('mutant-1', 30); // one shot from death
    w.placement.setEnabled(cannon, true);
    w.step(1);
    assert.deepEqual(w.log.at(-1).shots.map((s) => s.killed), [true]);
    assert.deepEqual(w.log.at(-1).effects.attacks, []);
    assert.equal(w.placement.buildings().find((b) => b.id === outpost).hp, 100);
});

test('a mutant spawned this tick is first shot on the next tick', () => {
    const w = world({schedule: [5], rng: fixedRng(topSpawn(12))});
    w.place('powerPlant', 2, 13);
    w.place('autocannon', 12, 3);
    w.cycle.endDay();
    w.step(5);
    assert.equal(w.mutants.snapshot().length, 1);
    assert.deepEqual(allShots(w), []);
    w.step(1);
    assert.equal(allShots(w).length, 1);
    assert.equal(w.log.at(-1).night, 6);
});

// ---- Two turrets ------------------------------------------------------------------

test('two turrets hit one mutant in building order on the same tick', () => {
    const fake = fakeMutants([]);
    const w = world({fake});
    w.place('powerPlant', 2, 13);
    const first = w.place('autocannon', 12, 8);
    const second = w.place('autocannon', 13, 8);
    const {x, y} = w.centerOf(12, 8);
    fake.list.push(fakeMutant('a', x, y + 40, 100));
    w.cycle.endDay();
    w.step(1);
    assert.deepEqual(allShots(w).map((s) => [s.turretId, s.hp]), [[first, 90], [second, 80]]);
});

test('no overkill: the second turret holds fire and stays ready after a kill', () => {
    const fake = fakeMutants([]);
    const w = world({fake});
    w.place('powerPlant', 2, 13);
    const first = w.place('autocannon', 12, 8);
    const second = w.place('autocannon', 13, 8);
    const {x, y} = w.centerOf(12, 8);
    fake.list.push(fakeMutant('a', x, y + 40, 10));
    w.cycle.endDay();
    w.step(1);
    assert.deepEqual(allShots(w).map((s) => s.turretId), [first]);
    assert.deepEqual(turret(w, second), {id: second, cooldown: 0, targetId: null});
    assert.deepEqual(turret(w, first), {id: first, cooldown: 30, targetId: null});
});

test('after a kill the second turret can fire at another mutant on the same tick', () => {
    const fake = fakeMutants([]);
    const w = world({fake});
    w.place('powerPlant', 2, 13);
    const first = w.place('autocannon', 12, 8);
    const second = w.place('autocannon', 13, 8);
    const {x, y} = w.centerOf(12, 8);
    fake.list.push(fakeMutant('a', x, y + 40, 10), fakeMutant('b', x, y + 90));
    w.cycle.endDay();
    w.step(1);
    assert.deepEqual(allShots(w).map((s) => [s.turretId, s.mutantId]), [[first, 'a'], [second, 'b']]);
});

test('a lock left by a kill elsewhere is dropped in the same tick', () => {
    const fake = fakeMutants([]);
    const w = world({fake});
    w.place('powerPlant', 2, 13);
    const first = w.place('autocannon', 12, 8);
    const second = w.place('autocannon', 13, 8);
    const {x, y} = w.centerOf(12, 8);
    const mutant = fakeMutant('a', x, y + 40, 20);
    fake.list.push(mutant);
    w.cycle.endDay();
    w.step(1); // both hit: first 10, second kills
    assert.deepEqual(allShots(w).map((s) => s.killed), [false, true]);
    assert.equal(turret(w, first).targetId, null);
    assert.equal(turret(w, second).targetId, null);
});

// ---- Destroyed turrets and power --------------------------------------------------

test('a destroyed turret disappears at once and never fires again', () => {
    const {w, cannon, at} = fakeWorld([]);
    w.mutants.list.push(fakeMutant('a', at(10, 0).x, at(10, 0).y));
    w.cycle.endDay();
    w.step(5);
    assert.deepEqual(w.placement.damageBuilding(cannon, 150), {ok: true, destroyed: true, hp: 0});
    assert.deepEqual(w.autocannons.snapshot(), []); // no tick needed
    w.step(200);
    assert.deepEqual(shotTicks(w), [1]);
    assert.deepEqual(w.placement.damageBuilding(cannon, 1).ok, false);
});

test('a turret may fire on the tick it is destroyed, and never after', () => {
    const w = world({rng: fixedRng(topSpawn(12))});
    w.place('powerPlant', 2, 13);
    const cannon = w.place('autocannon', 12, 3);
    w.placement.setEnabled(cannon, false);
    w.cycle.endDay();
    w.step(1);
    assert.equal(w.mutants.snapshot()[0].targetId, cannon);
    stepUntil(w, () => w.mutants.snapshot()[0].attackTimer === 1);
    w.placement.damageBuilding(cannon, 145); // the next hit kills it
    w.placement.setEnabled(cannon, true);
    w.step(1);
    assert.deepEqual(w.log.at(-1).shots.map((s) => s.turretId), [cannon]); // turrets act first
    assert.deepEqual(w.log.at(-1).effects.destroyed, [cannon]);
    assert.deepEqual(w.autocannons.snapshot(), []);
    assert.equal(w.grid.occupantAt(12, 3), null);
    w.step(500);
    assert.equal(allShots(w).length, 1);
    assert.equal(w.mutants.snapshot()[0].hp, 30);
});

test('a surviving turret keeps working after another is destroyed', () => {
    const fake = fakeMutants([]);
    const w = world({fake});
    w.place('powerPlant', 2, 13);
    const doomed = w.place('autocannon', 12, 8);
    const survivor = w.place('autocannon', 13, 8);
    const {x, y} = w.centerOf(12, 8);
    fake.list.push(fakeMutant('a', x, y + 40));
    w.cycle.endDay();
    w.step(1);
    w.placement.damageBuilding(doomed, 150);
    w.step(30);
    assert.deepEqual(w.log.at(-1).shots.map((s) => s.turretId), [survivor]);
    assert.deepEqual(w.autocannons.snapshot().map((t) => t.id), [survivor]);
});

test('a rebuilt turret in the same cell gets a new id and starts ready', () => {
    const {w, cannon, at} = fakeWorld([]);
    w.mutants.list.push(fakeMutant('a', at(10, 0).x, at(10, 0).y));
    w.cycle.endDay();
    w.step(5);
    w.placement.damageBuilding(cannon, 150);
    w.step(3595);
    const rebuilt = w.place('autocannon', 12, 8);
    assert.notEqual(rebuilt, cannon);
    assert.deepEqual(w.autocannons.snapshot(), [{id: rebuilt, cooldown: 0, targetId: null}]);
});

test('a destroyed Plant stops surviving turrets from the next tick', () => {
    const {w, plant, cannon, at} = fakeWorld([]);
    w.mutants.list.push(fakeMutant('a', at(10, 0).x, at(10, 0).y));
    w.cycle.endDay();
    w.step(30);
    assert.deepEqual(shotTicks(w), [1]);
    assert.equal(turret(w, cannon).cooldown, 1);
    w.placement.damageBuilding(plant, 300);
    assert.equal(calculatePower(w.placement.buildings()).status, 'blackout');
    w.step(200);
    assert.deepEqual(shotTicks(w), [1]);
    assert.deepEqual(turret(w, cannon), {id: cannon, cooldown: 1, targetId: null});
});

test('a Plant destroyed by a mutant cuts power on the following tick, not that one', () => {
    const w = world({rng: fixedRng(topSpawn(5))});
    const plant = w.place('powerPlant', 5, 1);
    const cannon = w.place('autocannon', 16, 3);
    w.placement.setEnabled(cannon, false);
    w.cycle.endDay();
    w.step(1);
    assert.equal(w.mutants.snapshot().length, 1);
    stepUntil(w, () => w.mutants.snapshot()[0].attackTimer === 1);
    w.placement.damageBuilding(plant, 295); // the next hit destroys it
    w.step(1);
    assert.deepEqual(w.log.at(-1).effects.destroyed, [plant]);
    w.placement.setEnabled(cannon, true);
    w.step(100);
    assert.deepEqual(allShots(w), []);
    assert.equal(calculatePower(w.placement.buildings()).status, 'blackout');
});

// ---- Tick boundaries --------------------------------------------------------------

test('turrets fire through tick 3599, never on tick 3600', () => {
    const {w, cannon, at} = fakeWorld([]);
    w.mutants.list.push(fakeMutant('a', at(10, 0).x, at(10, 0).y));
    w.cycle.endDay();
    w.step(3599);
    assert.equal(w.log.at(-1).night, 3599);
    const last = shotTicks(w).at(-1);
    assert.equal(last, 3571);
    assert.ok(turret(w, cannon).cooldown > 0);
    w.step(1);
    assert.equal(w.cycle.shift, Shift.DAY);
    assert.deepEqual(w.log.at(-1).shots, []);
    assert.equal(w.reports.length, 1);
});

test('a turret ready on the final tick still does not fire', () => {
    const {w, cannon, at} = fakeWorld([]);
    const mutant = fakeMutant('a', at(500, 0).x, at(500, 0).y);
    w.mutants.list.push(mutant);
    w.cycle.endDay();
    w.step(3599);
    assert.equal(turret(w, cannon).cooldown, 0);
    mutant.x = at(10, 0).x;
    w.step(1);
    assert.equal(w.cycle.shift, Shift.DAY);
    assert.deepEqual(allShots(w), []);
});

test('a failed settlement retry applies no shot, no double damage and one report', () => {
    const {w, at} = fakeWorld([]);
    const mutant = fakeMutant('a', at(500, 0).x, at(500, 0).y);
    w.mutants.list.push(mutant);
    w.cycle.endDay();
    w.step(3599);
    mutant.x = at(10, 0).x;
    const hp = mutant.hp;

    w.setFail(true);
    assert.throws(() => w.step(1), /settlement failed/);
    assert.equal(w.cycle.shift, Shift.NIGHT);
    assert.equal(mutant.hp, hp);
    assert.deepEqual(allShots(w), []);
    assert.equal(w.reports.length, 0);

    w.setFail(false);
    assert.equal(w.step(1), 1);
    assert.equal(w.cycle.shift, Shift.DAY);
    assert.equal(mutant.hp, hp);
    assert.deepEqual(allShots(w), []);
    assert.equal(w.reports.length, 1);
});

test('Day stays untimed and inert for turrets', () => {
    const w = world();
    const cannon = w.place('autocannon', 12, 8);
    w.place('powerPlant', 2, 13);
    w.frames(600);
    assert.equal(w.step(100), 0);
    for (let i = 0; i < 100; i++) assert.deepEqual(w.autocannons.step(), {shots: []});
    assert.equal(w.clock.tick, 0);
    assert.deepEqual(w.autocannons.snapshot()[0], {id: cannon, cooldown: 0, targetId: null});
});

test('a paused Night changes nothing', () => {
    const {w, cannon, at} = fakeWorld([]);
    w.mutants.list.push(fakeMutant('a', at(10, 0).x, at(10, 0).y));
    w.cycle.endDay();
    w.step(5);
    const before = turret(w, cannon);
    w.clock.pause();
    w.frames(600);
    assert.deepEqual(turret(w, cannon), before);
    assert.deepEqual(shotTicks(w), [1]);
});

test('snapshots are detached', () => {
    const {w, cannon, at} = fakeWorld([]);
    w.mutants.list.push(fakeMutant('a', at(10, 0).x, at(10, 0).y));
    w.cycle.endDay();
    w.step(1);
    const snapshot = w.autocannons.snapshot();
    snapshot[0].cooldown = 0;
    snapshot[0].targetId = 'x';
    assert.deepEqual(turret(w, cannon), {id: cannon, cooldown: 30, targetId: 'a'});
});

// ---- Determinism ------------------------------------------------------------------

function playThree(advance, seed = 731) {
    const rng = new SeededRandom(seed);
    const w = world({schedule: [100, 600, 1500], rng});
    w.place('powerPlant', 12, 8);
    w.place('factory', 7, 8);
    w.place('autocannon', 12, 5);
    w.place('autocannon', 16, 8);
    const trail = [];
    for (let night = 0; night < 3; night++) {
        w.cycle.endDay();
        advance(w);
        trail.push({buildings: w.placement.buildings(), report: w.reports.at(-1), rng: rng.snapshot(), cannons: w.autocannons.snapshot()});
    }
    return {trail, shots: allShots(w), economy: w.economy.snapshot()};
}

test('the same seed and commands give identical results', () => {
    const steps = (w) => w.step(3600);
    assert.deepEqual(playThree(steps), playThree(steps));
    assert.ok(playThree(steps).shots.length > 0);
});

test('real frames and manual stepping give identical results, at any frame rate', () => {
    const viaSteps = playThree((w) => w.step(3600));
    const viaFrames = playThree((w) => { while (w.cycle.shift === Shift.NIGHT) w.frames(1); });
    const viaUneven = playThree((w) => {
        for (let i = 0; w.cycle.shift === Shift.NIGHT; i++) w.frames(1, i % 3 ? 7 : 90);
    });
    assert.deepEqual(viaFrames, viaSteps);
    assert.deepEqual(viaUneven, viaSteps);
});

test('turrets never draw randomness', () => {
    const run = (withCannon) => {
        const rng = new SeededRandom(731);
        const w = world({schedule: [100, 600], rng});
        w.place('powerPlant', 12, 8);
        if (withCannon) w.place('autocannon', 12, 5);
        w.cycle.endDay();
        w.step(3600);
        return rng.snapshot();
    };
    assert.deepEqual(run(true), run(false));
});

// ---- Presentation helper ----------------------------------------------------------

test('facing snaps to the nearest of 8 directions', () => {
    const step = Math.PI / 4;
    assert.equal(quantizeFacing(0), 0);
    assert.equal(quantizeFacing(0.1), 0);
    assert.equal(quantizeFacing(step * 0.6), step);
    assert.equal(quantizeFacing(Math.PI / 2 - 0.1), 2 * step);
    assert.equal(quantizeFacing(-3 * step - 0.05), -3 * step);
});

test('distanceToFootprint still measures mutants to a turret footprint', () => {
    const w = world();
    const cannon = w.place('autocannon', 12, 8);
    const rect = w.grid.footprintRect(w.placement.buildings().find((b) => b.id === cannon));
    assert.equal(distanceToFootprint({x: rect.x - 8, y: rect.y + 16}, rect), 8);
});
