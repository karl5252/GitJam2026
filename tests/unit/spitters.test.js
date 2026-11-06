import test from 'node:test';
import assert from 'node:assert/strict';
import {MUTANT, SPITTER, TARGET_BIAS, borderSpawns} from '../../src/core/mutants.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {SPITTER_WAVE, WAVE, nightPlan, spitterCount, spitterSlots, waveBudget, waveSchedule} from '../../src/core/waves.js';
import {canonicalState, checkInvariants, createWorld, digestOf, worldState} from '../soak/harness.js';

/**
 * The Spitter: wave composition, firing, what a shot hits, shells in flight, and
 * how it deals with soldiers.
 *
 * HQ at pointer 12,8 covers tiles 11-13, 7-9: x 608-704, y 328-424, with its ring
 * on 10-14, 6-10. A Spitter from the top of column 12 starts at 656,104, 224 px
 * from HQ, and stops at 656,136, exactly 192 px away.
 */

const FUNDS = {credits: 100_000, ap: 200};
const TOP = (col) => col; // spawn indices, clockwise from the top-left
const BOTTOM = (col) => 40 + (23 - col);
const LEFT = (row) => 64 + (15 - row);
const STOP = {x: 656, y: 136};
const FIRST_AIM_TICK = 66; // spawned on tick 1, walked 32 px
const FIRST_RELEASE_TICK = FIRST_AIM_TICK + SPITTER.windupTicks;
const FLIGHT = 24;
const FIRST_LANDING_TICK = FIRST_RELEASE_TICK + FLIGHT;

const spawnsAt = (...indices) => {
    let draws = 0;
    return {nextInt: () => indices[draws++ % indices.length], snapshot: () => ({draws})};
};

function world({at = [TOP(12)], schedule = at.map((_, i) => i + 1), slots = schedule.map((_, i) => i), hq = true, seed, ...options} = {}) {
    const w = createWorld({rng: seed ? null : spawnsAt(...at), seed, resources: FUNDS, requireHq: true, roads: true, schedule, spitterSlots: slots, ...options});
    if (hq) assert.equal(w.place('hq', 12, 8).ok, true);
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

const step = (w, ticks, watch = () => {}) => {
    for (let i = 0; i < ticks && w.cycle.shift === Shift.NIGHT; i++) {
        w.cycle.stepTicks(1, (t) => watch(w.tick(t), w.cycle.elapsedNightTicks));
    }
};

const to = (w, tick, watch) => step(w, tick - w.cycle.elapsedNightTicks, watch);
const finishNight = (w, watch) => {
    while (w.cycle.shift === Shift.NIGHT) step(w, 1, watch);
};

const spitter = (w) => w.mutants.snapshot()[0];
const hp = (w, id) => w.placement.buildings().find((b) => b.id === id)?.hp ?? 0;
const hq = (w) => w.placement.buildings().find((b) => b.type === 'hq');
const center = (w, col, row) => w.grid.cellCenter(col, row);

/** Soldiers the test moves itself. `hits` records what actually hurt them. */
function standInSoldiers(w, ...positions) {
    const list = positions.map(({x, y}, i) => ({id: `soldier-${i + 1}`, x, y, hp: 30}));
    const hits = [];
    w.mutants.setInfantry({
        attackableSoldiers: () => list.filter((s) => s.hp > 0).map((s) => ({...s})),
        damageSoldier: (id, amount) => {
            const soldier = list.find((s) => s.id === id);
            if (!soldier || soldier.hp <= 0) return {ok: false, reason: 'unknown-soldier'};
            soldier.hp -= amount;
            hits.push({id, amount, tick: w.cycle.elapsedNightTicks});
            return {ok: true, killed: soldier.hp <= 0, hp: Math.max(0, soldier.hp)};
        },
    });
    return {list, hits};
}

// ---- Wave composition -------------------------------------------------------

test('the approved values', () => {
    assert.deepEqual(SPITTER, {
        kind: 'spitter', maxHp: 30, range: 192, damage: 10, cycleTicks: 180, windupTicks: 45, maxShots: 5, shellSpeed: 8, retaliationRange: 128,
    });
    assert.deepEqual(SPITTER_WAVE, {firstNight: 5, budgetPerSpitter: 4, nightsPerExtra: 3, maxPerNight: 6});
    assert.ok(Object.isFrozen(SPITTER) && Object.isFrozen(SPITTER_WAVE));
});

test('no Spitter comes before Night 5, whatever the budget', () => {
    for (let night = 1; night < 5; night++) {
        for (const budget of [0, 4, 8, 40]) assert.equal(spitterCount(night, budget), 0);
    }
    assert.equal(spitterCount(5, 4), 1);
});

test('Spitters ramp up with the Nights, are at most a quarter of a wave, and never pass six', () => {
    const counts = [5, 7, 8, 10, 11, 13, 14, 16, 17, 19, 20, 25, 40].map((night) => spitterCount(night, 40));
    assert.deepEqual(counts, [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 6]);
    assert.deepEqual([3, 4, 7, 8, 11, 12].map((budget) => spitterCount(30, budget)), [0, 1, 1, 2, 2, 3]);
});

test('a heavy polluter meets one Spitter on Night 5, not a spike', () => {
    const buildings = Array.from({length: 7}, () => ({type: 'autocannon'}));
    const plan = nightPlan({day: 5, pollution: 160, buildings});
    assert.equal(plan.budget, 12);
    assert.equal(plan.spitters, 1);
});

test('slots are evenly spread, in order and inside the schedule', () => {
    assert.deepEqual(spitterSlots(4, 1), [2]);
    assert.deepEqual(spitterSlots(9, 2), [2, 6]);
    assert.deepEqual(spitterSlots(33, 6), [2, 8, 13, 19, 24, 30]);
    assert.deepEqual(spitterSlots(5, 0), []);
    assert.deepEqual(spitterSlots(3, 3), [0, 1, 2]);
    assert.throws(() => spitterSlots(2, 3), RangeError);
    assert.ok(Object.isFrozen(spitterSlots(8, 2)));
});

test('in every real plan the first attacker is melee, and the wave itself is untouched', () => {
    for (let night = 1; night <= 40; night++) {
        for (const threat of [0, 30, 60, 100]) {
            for (const cannons of [0, 3, 9]) {
                const buildings = Array.from({length: cannons}, () => ({type: 'autocannon'}));
                const plan = nightPlan({day: night, pollution: threat, buildings});
                assert.equal(plan.spitterSlots.length, plan.spitters);
                assert.ok(plan.spitters <= SPITTER_WAVE.maxPerNight);
                assert.ok(plan.budget <= WAVE.maxPerNight);
                assert.ok(!plan.spitterSlots.includes(0));
                assert.ok(plan.spitterSlots.every((slot, i) => slot < plan.budget && (i === 0 || slot > plan.spitterSlots[i - 1])));
                assert.equal(plan.schedule.length, plan.budget);
            }
        }
    }
    assert.deepEqual([...nightPlan({day: 12, pollution: 100, buildings: []}).schedule], [...waveSchedule(waveBudget(12, 4, 0), 2100)]);
});

test('Spitters take the place of ordinary mutants at the same ticks and positions, for the same draws', () => {
    const night = (spitters) => {
        const w = createWorld({seed: 98, firstNight: 8, resources: FUNDS, requireHq: true, roads: true, spitters});
        assert.equal(w.place('hq', 12, 8).ok, true);
        for (let day = 1; day < 8; day++) { w.cycle.endDay(); finishNight(w); }
        w.cycle.endDay();
        const spawned = [];
        finishNight(w, ({effects}, tick) => {
            for (const id of effects.spawned) {
                const {x, y, kind} = w.mutants.snapshot().find((m) => m.id === id);
                spawned.push({tick, id, x, y, kind});
            }
        });
        return {spawned, rng: w.rng.snapshot()};
    };
    const mixed = night(true);
    const plain = night(false);
    const withoutKind = (list) => list.map(({kind: _, ...rest}) => rest);
    assert.ok(mixed.spawned.some(({kind}) => kind === 'spitter'));
    assert.ok(plain.spawned.every(({kind}) => kind === undefined));
    assert.deepEqual(withoutKind(mixed.spawned), withoutKind(plain.spawned));
    assert.deepEqual(mixed.rng, plain.rng);
});

test('a plan with bad slots is refused', () => {
    assert.throws(() => world({schedule: [5], slots: [1]}), RangeError);
    assert.throws(() => world({schedule: [5, 6], slots: [1, 0]}), RangeError);
});

test('an ordinary mutant record and an ordinary tick are exactly what they were', () => {
    const w = world({slots: []});
    w.cycle.endDay();
    step(w, 1);
    assert.deepEqual(Object.keys(spitter(w)), ['id', 'x', 'y', 'hp', 'targetId', 'obstacleId', 'attackTimer']);
    assert.deepEqual(w.mutants.plan(), {schedule: [1]});
    assert.deepEqual(w.mutants.shells(), []);
    let keys;
    step(w, 1, ({effects}) => { keys = Object.keys(effects); });
    assert.deepEqual(keys, ['spawned', 'attacks', 'destroyed']);
});

// ---- Firing -----------------------------------------------------------------

test('a Spitter spawns with its own stats, and the same target rules as anyone', () => {
    const w = world();
    const plant = build(w, 'powerPlant', 12, 3);
    w.cycle.endDay();
    step(w, 1);
    assert.deepEqual({...spitter(w)}, {
        id: 'mutant-1', x: 656, y: 104, hp: 30, targetId: plant, obstacleId: null, attackTimer: 45, kind: 'spitter', shots: 5, aim: null,
    });
    assert.deepEqual(TARGET_BIAS, {hq: 256, powerPlant: 256, factory: 128, autocannon: 64, siegeCannon: 64, barracks: 64, outpost: 0});
});

test('it walks at the ordinary speed and stops exactly at range, with its aim fixed', () => {
    const w = world();
    w.cycle.endDay();
    to(w, FIRST_AIM_TICK - 1);
    assert.deepEqual([spitter(w).x, spitter(w).y, spitter(w).aim], [STOP.x, STOP.y, null]);
    to(w, FIRST_AIM_TICK);
    assert.deepEqual(spitter(w).aim, {x: 656, y: 328, soldier: false});
    assert.deepEqual([spitter(w).x, spitter(w).y], [STOP.x, STOP.y]);
});

test('range is circular and inclusive, to the nearest footprint point', () => {
    const w = world({at: [LEFT(0)]});
    w.cycle.endDay();
    let stopped = null;
    step(w, 1200, () => { stopped ??= spitter(w).aim && {x: spitter(w).x, y: spitter(w).y}; });
    assert.ok(stopped);
    const dx = Math.max(608 - stopped.x, 0);
    const dy = Math.max(328 - stopped.y, 0);
    assert.ok(dx ** 2 + dy ** 2 <= 192 ** 2);
    assert.ok(dx + dy > 192, 'a Manhattan range would have walked closer');
});

test('the telegraph lasts 45 ticks, the shell flies, and damage lands once, on landing', () => {
    const w = world();
    w.cycle.endDay();
    to(w, FIRST_RELEASE_TICK - 1);
    assert.deepEqual(w.mutants.shells(), []);
    to(w, FIRST_RELEASE_TICK);
    assert.deepEqual(w.mutants.shells(), [{
        id: 'shell-1', mutantId: 'mutant-1', fromX: 656, fromY: 136, x: 656, y: 328, buildingId: hq(w).id, soldier: false, flightTicks: FLIGHT, ticksLeft: FLIGHT,
    }]);
    assert.equal(spitter(w).aim, null);
    assert.equal(spitter(w).shots, 4);
    to(w, FIRST_LANDING_TICK - 1);
    assert.equal(hq(w).hp, 600);
    let tickEffects;
    to(w, FIRST_LANDING_TICK, ({effects}) => { tickEffects = effects; });
    assert.equal(hq(w).hp, 590);
    assert.deepEqual(tickEffects.attacks, [{mutantId: 'mutant-1', buildingId: hq(w).id, damage: 10, hp: 590}]);
    assert.deepEqual(tickEffects.impacts, [{x: 656, y: 328, buildingId: hq(w).id, soldierId: null}]);
    assert.deepEqual(w.mutants.shells(), []);
    step(w, 100);
    assert.equal(hq(w).hp, 590);
});

test('shells are released every 180 ticks, and five shots are all it has', () => {
    const w = world();
    w.cycle.endDay();
    const releases = [];
    let last = 0;
    finishNight(w, (_, tick) => {
        const fired = w.mutants.shells().filter((s) => s.ticksLeft === s.flightTicks).length;
        if (fired) releases.push(tick);
        last = spitter(w)?.shots ?? last;
    });
    assert.deepEqual(releases, [0, 1, 2, 3, 4].map((i) => FIRST_RELEASE_TICK + 180 * i));
    assert.equal(last, 0);
});

test('with its shots gone it is an ordinary melee mutant', () => {
    const w = world();
    w.cycle.endDay();
    const lastRelease = FIRST_RELEASE_TICK + 180 * 4;
    to(w, lastRelease);
    assert.equal(spitter(w).shots, 0);
    assert.equal(spitter(w).attackTimer, MUTANT.attackCooldownTicks);
    assert.deepEqual([spitter(w).x, spitter(w).y], [STOP.x, STOP.y], 'still where it stood');
    step(w, 2);
    assert.equal(spitter(w).y, STOP.y + MUTANT.speed * 2, 'and walking');
    const hpWhenSpent = hq(w).hp - 10; // the last shell is still in the air
    const hits = [];
    finishNight(w, ({effects}) => hits.push(...effects.attacks));
    assert.equal(hits[0].damage, 10);
    assert.ok(hits.slice(1).every(({damage}) => damage === MUTANT.attackDamage), 'melee damage from here on');
    assert.ok(hits.length > 2);
    assert.ok(hq(w).hp < hpWhenSpent);
    assert.equal(w.mutants.shells().length, 0);
});

test('losing a target cannot shorten the firing cycle', () => {
    const w = world();
    const plant = build(w, 'powerPlant', 12, 3);
    w.cycle.endDay();
    const releases = [];
    step(w, 1000, (_, tick) => {
        if (w.mutants.shells().some((s) => s.ticksLeft === s.flightTicks)) releases.push(tick);
        if (releases.length === 1 && hp(w, plant)) w.placement.damageBuilding(plant, 300);
    });
    assert.ok(releases.length >= 2);
    for (let i = 1; i < releases.length; i++) assert.ok(releases[i] - releases[i - 1] >= 180, `${releases}`);
});

test('a Spitter stays put until its target falls, so it cannot wander between positions', () => {
    const w = world();
    const wall = build(w, 'wall', 12, 5); // on the line, so it stands there hitting the wall
    w.cycle.endDay();
    to(w, FIRST_AIM_TICK);
    const positions = new Set();
    to(w, FIRST_RELEASE_TICK + 180 * 4 - 1, () => positions.add(`${spitter(w).x},${spitter(w).y}`));
    assert.deepEqual([...positions], ['656,136']);
    assert.equal(spitter(w).shots, 1);
    assert.ok(hp(w, wall) > 0);
});

// ---- Line of fire -----------------------------------------------------------

test('a Wall on the line takes the shot and the building behind it takes nothing', () => {
    const w = world();
    const wall = build(w, 'wall', 12, 5);
    w.cycle.endDay();
    to(w, FIRST_LANDING_TICK + 180 * 4);
    assert.equal(hp(w, wall), 50);
    assert.equal(hq(w).hp, 600);
    assert.equal(spitter(w).targetId, hq(w).id, 'a Wall is never the target');
});

test('an ordinary building on the line takes the shot too', () => {
    const w = world();
    const outpost = build(w, 'outpost', 12, 5);
    w.cycle.endDay();
    to(w, FIRST_LANDING_TICK);
    assert.equal(hp(w, outpost), 90);
    assert.equal(hq(w).hp, 600);
});

test('a shell damages one thing, never everything on the line', () => {
    const w = world();
    const near = build(w, 'wall', 12, 3);
    const far = build(w, 'wall', 12, 5);
    w.cycle.endDay();
    to(w, FIRST_LANDING_TICK + 1);
    assert.deepEqual([hp(w, near), hp(w, far), hq(w).hp], [90, 100, 600]);
});

test('when the Wall falls the same line reaches what was behind it', () => {
    const w = world({at: [TOP(12), TOP(12), TOP(12)]});
    const wall = build(w, 'wall', 12, 5);
    w.placement.damageBuilding(wall, 90);
    w.cycle.endDay();
    to(w, 1000);
    assert.equal(hp(w, wall), 0);
    assert.ok(hq(w).hp < 600);
});

test('a shut gate takes the shot and an open one lets it through, only along its passage', () => {
    const scene = (open) => {
        const w = world();
        road(w, [[12, 5], [12, 4], [12, 3], [12, 2]]);
        const gate = build(w, 'gateHorizontal', 12, 4);
        if (open) w.logistics.gateDemands = () => new Set([gate]);
        w.cycle.endDay();
        to(w, FIRST_LANDING_TICK + 180);
        return {gate: hp(w, gate), hq: hq(w).hp};
    };
    assert.deepEqual(scene(false), {gate: 130, hq: 600});
    // Opening takes 150 ticks, so the first shell still hits it, and the second passes.
    assert.deepEqual(scene(true), {gate: 140, hq: 590});
});

test('a Vertical Gate is solid to a shot from the north, even wide open', () => {
    const w = world();
    road(w, [[12, 5], [12, 4], [13, 4], [11, 4]]);
    const gate = build(w, 'gateVertical', 12, 4);
    w.logistics.gateDemands = () => new Set([gate]);
    w.cycle.endDay();
    to(w, FIRST_LANDING_TICK + 180);
    assert.equal(w.gates.isOpen(gate), true);
    assert.deepEqual([hp(w, gate), hq(w).hp], [130, 600]);
});

// ---- When there is no firing position ---------------------------------------

test('blocked with no way round and out of range, it shoots what blocks it, then chews through it', () => {
    const w = world({at: [LEFT(8)]});
    const walls = [];
    for (let row = 0; row < 16; row++) walls.push(build(w, 'wall', 2, row));
    w.cycle.endDay();
    const firing = [];
    finishNight(w, ({effects}) => firing.push(...effects.attacks));
    assert.ok(firing.length > 5, 'never idle');
    assert.deepEqual(firing.slice(0, 5).map(({damage}) => damage), [10, 10, 10, 10, 10]);
    assert.ok(firing.slice(0, 5).every(({buildingId}) => walls.includes(buildingId)));
    assert.ok(firing.slice(5).every(({damage}) => damage === MUTANT.attackDamage), 'then with its claws');
});

test('it takes an open way round like any mutant, and stops when in range', () => {
    const w = world({at: [LEFT(8)]});
    for (let row = 4; row < 12; row++) build(w, 'wall', 2, row);
    w.cycle.endDay();
    step(w, 1600);
    assert.equal(w.mutants.detours()[0].plans, 1);
    assert.ok(w.placement.buildings().filter((b) => b.type === 'wall').every((b) => b.hp === 100), 'it went round');
    assert.ok(hq(w).hp < 600);
});

test('a fully enclosed base: shots land on the enclosure, and the base is safe until it is breached', () => {
    const w = world();
    const ring = [];
    for (let col = 9; col <= 15; col++) for (const row of [5, 11]) ring.push(build(w, 'wall', col, row));
    for (let row = 6; row <= 10; row++) for (const col of [9, 15]) ring.push(build(w, 'wall', col, row));
    w.cycle.endDay();
    to(w, 1100);
    assert.equal(hq(w).hp, 600);
    const damaged = ring.filter((id) => hp(w, id) < 100);
    assert.equal(damaged.length, 1);
    assert.equal(hp(w, damaged[0]), 50);
    assert.deepEqual(checkInvariants(w), []);
});

test('a fortified border cell: it arrives outside the map, and shoots its way in from there', () => {
    const w = world({at: [LEFT(8)]});
    const wall = build(w, 'wall', 0, 8);
    w.cycle.endDay();
    step(w, 2);
    assert.equal(spitter(w).x, 255.5);
    to(w, 3000);
    assert.ok(hp(w, wall) < 100, 'it never sits idle at the edge of the map');
    assert.deepEqual(checkInvariants(w), []);
});

test('a Spitter on the map edge or a corner with its target already in range fires from there', () => {
    for (const [at, hqCell] of [[TOP(0), [2, 2]], [LEFT(0), [2, 2]], [BOTTOM(23), [21, 13]]]) {
        const w = world({at: [at], hq: false});
        assert.equal(w.place('hq', ...hqCell).ok, true);
        w.cycle.endDay();
        const spawn = borderSpawns(w.grid)[at];
        to(w, 2 + SPITTER.windupTicks + 32);
        assert.deepEqual([spitter(w).x, spitter(w).y], [spawn.x, spawn.y]);
        assert.ok(hq(w).hp < 600);
        assert.deepEqual(checkInvariants(w), []);
    }
});

test('with no buildings at all it waits for dawn without error', () => {
    const w = world({hq: false, requireHq: false});
    w.cycle.endDay();
    finishNight(w);
    assert.equal(w.cycle.shift, Shift.DAY);
    assert.deepEqual(w.mutants.snapshot(), []);
});

// ---- Soldiers: aim, misses and retaliation ----------------------------------

test('a soldier in retaliation range with a clear line is shot at, ahead of the building', () => {
    const w = world();
    const {hits} = standInSoldiers(w, {x: STOP.x, y: STOP.y + 128});
    w.cycle.endDay();
    to(w, FIRST_AIM_TICK);
    assert.deepEqual(spitter(w).aim, {x: STOP.x, y: STOP.y + 128, soldier: true});
    to(w, FIRST_RELEASE_TICK + 17);
    assert.deepEqual(hits, [{id: 'soldier-1', amount: 10, tick: FIRST_RELEASE_TICK + 16}]);
    assert.equal(hq(w).hp, 600);
    assert.equal(spitter(w).shots, 4, 'it used up a shot');
});

test('a soldier just beyond retaliation range, or behind a wall, is left alone', () => {
    const beyond = world();
    const far = standInSoldiers(beyond, {x: STOP.x, y: STOP.y + 128.5});
    beyond.cycle.endDay();
    to(beyond, FIRST_AIM_TICK);
    assert.equal(spitter(beyond).aim.soldier, false);
    assert.deepEqual(far.hits, []);

    const walled = world();
    build(walled, 'wall', 12, 2);
    standInSoldiers(walled, {x: STOP.x, y: STOP.y + 100});
    walled.cycle.endDay();
    to(walled, FIRST_AIM_TICK);
    assert.equal(spitter(walled).aim.soldier, false);
});

test('the nearest exposed soldier is chosen, passing over a nearer one behind a wall', () => {
    const w = world();
    build(w, 'wall', 12, 2); // y 168-200, just below the Spitter's stop
    standInSoldiers(w, {x: STOP.x, y: STOP.y + 70}, {x: STOP.x + 100, y: STOP.y});
    w.cycle.endDay();
    step(w, 2); // ready from the start, so it takes aim where it stands
    assert.deepEqual(spitter(w).aim, {x: STOP.x + 100, y: STOP.y, soldier: true});
});

test('a soldier nearby stops a walking Spitter once it is ready to fire, and it never chases', () => {
    const w = world();
    const {list} = standInSoldiers(w, {x: 656, y: 180});
    w.cycle.endDay();
    step(w, 3);
    const {y} = spitter(w);
    assert.ok(spitter(w).aim?.soldier, 'it took aim on the way in');
    list[0].y = 600;
    list[0].x = 300;
    step(w, SPITTER.windupTicks - 2);
    assert.ok(spitter(w).aim);
    assert.equal(spitter(w).y, y, 'it finishes its telegraph where it stood');
});

test('a charged Spitter is not lured', () => {
    const w = world();
    // Close enough to lure anyone else while it walks on between shots.
    standInSoldiers(w, {x: STOP.x + 40, y: 150});
    w.cycle.endDay();
    const xs = new Set();
    const ys = new Set();
    step(w, 300, () => {
        xs.add(spitter(w).x);
        ys.add(spitter(w).y);
    });
    assert.ok(ys.size > 1, 'it did walk');
    assert.deepEqual([...xs], [656]);
});

test('a soldier that keeps moving during the telegraph is missed: the shell does not follow', () => {
    const w = world();
    const {list, hits} = standInSoldiers(w, {x: STOP.x, y: STOP.y + 128});
    w.cycle.endDay();
    to(w, FIRST_AIM_TICK);
    const aim = {...spitter(w).aim};
    let impacts = [];
    to(w, FIRST_RELEASE_TICK + 20, ({effects}) => {
        list[0].x += 1; // a soldier's speed
        if (spitter(w).aim) assert.deepEqual(spitter(w).aim, aim, 'the aim never moves');
        impacts = [...impacts, ...(effects.impacts ?? [])];
    });
    assert.deepEqual(hits, []);
    assert.deepEqual(impacts, [{x: aim.x, y: aim.y, buildingId: null, soldierId: null}]);
    assert.equal(hq(w).hp, 600, 'a miss does not go on to find a building');
});

test('moving only while the shell is in the air is enough', () => {
    const w = world();
    const {list, hits} = standInSoldiers(w, {x: STOP.x, y: STOP.y + 128});
    w.cycle.endDay();
    to(w, FIRST_RELEASE_TICK);
    list[0].y -= 7; // out of its own body's width of the aimed point
    to(w, FIRST_RELEASE_TICK + 20);
    assert.deepEqual(hits, []);
});

test('moving a few pixels is not enough to dodge', () => {
    const w = world();
    const {list, hits} = standInSoldiers(w, {x: STOP.x, y: STOP.y + 128});
    w.cycle.endDay();
    to(w, FIRST_RELEASE_TICK);
    list[0].y -= 6;
    to(w, FIRST_RELEASE_TICK + 20);
    assert.equal(hits.length, 1);
});

test('a telegraph is committed: the Spitter never swaps to a nearer soldier that walks up', () => {
    const w = world();
    const {list} = standInSoldiers(w, {x: STOP.x + 128, y: STOP.y});
    w.cycle.endDay();
    to(w, FIRST_AIM_TICK);
    list[0].x = STOP.x + 60;
    step(w, 20);
    assert.deepEqual(spitter(w).aim, {x: STOP.x + 128, y: STOP.y, soldier: true});
});

test('whoever stands on the aimed point when it lands is hit, but only them', () => {
    const w = world();
    const {list, hits} = standInSoldiers(w, {x: STOP.x, y: STOP.y + 128}, {x: STOP.x, y: STOP.y + 150});
    w.cycle.endDay();
    to(w, FIRST_AIM_TICK);
    list[0].x += 40;
    list[1].y = STOP.y + 128;
    to(w, FIRST_RELEASE_TICK + 20);
    assert.deepEqual(hits.map(({id}) => id), ['soldier-2']);
});

test('a soldier already dead when the shell lands: no error, no hit', () => {
    const w = world();
    const {list, hits} = standInSoldiers(w, {x: STOP.x, y: STOP.y + 128});
    w.cycle.endDay();
    to(w, FIRST_RELEASE_TICK);
    list[0].hp = 0;
    to(w, FIRST_RELEASE_TICK + 20);
    assert.deepEqual(hits, []);
    assert.equal(spitter(w).shots, 4);
});

test('a soldier dead during the telegraph: it still fires at the point, and wastes the shot', () => {
    const w = world();
    const {list, hits} = standInSoldiers(w, {x: STOP.x, y: STOP.y + 128});
    w.cycle.endDay();
    to(w, FIRST_AIM_TICK);
    list[0].hp = 0;
    to(w, FIRST_RELEASE_TICK);
    assert.equal(spitter(w).shots, 4);
    to(w, FIRST_RELEASE_TICK + 20);
    assert.deepEqual([hits, hq(w).hp], [[], 600]);
});

test('a gate that shuts after the aim takes the shell meant for the soldier behind it', () => {
    const w = world({schedule: [200]}); // it arrives with the gate already open
    road(w, [[12, 5], [12, 4], [12, 3], [12, 2]]);
    const gate = build(w, 'gateHorizontal', 12, 3);
    let wanted = true;
    w.logistics.gateDemands = () => new Set(wanted ? [gate] : []);
    const {hits} = standInSoldiers(w, {x: STOP.x, y: STOP.y + 128});
    w.cycle.endDay();
    to(w, 265);
    assert.equal(w.gates.isOpen(gate), true);
    assert.equal(spitter(w).aim.soldier, true, 'through the open gate');
    wanted = false;
    to(w, 265 + SPITTER.windupTicks);
    assert.deepEqual([w.mutants.shells()[0].buildingId, w.mutants.shells()[0].soldier], [gate, false]);
    to(w, 265 + SPITTER.windupTicks + 12);
    assert.deepEqual([hits, hp(w, gate)], [[], 140]);
});

// ---- Shells in flight -------------------------------------------------------

test('a building destroyed in flight: the shell lands on nothing and finds nothing else', () => {
    const w = world();
    const wall = build(w, 'wall', 12, 5);
    w.cycle.endDay();
    to(w, FIRST_RELEASE_TICK);
    assert.equal(w.mutants.shells()[0].buildingId, wall);
    assert.equal(w.placement.damageBuilding(wall, 100).destroyed, true);
    const seen = [];
    to(w, FIRST_LANDING_TICK + 1, ({effects}) => seen.push(...(effects.impacts ?? []), ...effects.attacks));
    assert.equal(seen.length, 1);
    assert.equal(seen[0].buildingId, null);
    assert.equal(hq(w).hp, 600);
});

test('the shooter killed in flight: the shell still lands, once', () => {
    const w = world();
    w.cycle.endDay();
    to(w, FIRST_RELEASE_TICK);
    assert.equal(w.mutants.damageMutant('mutant-1', 30).killed, true);
    assert.deepEqual(w.mutants.snapshot(), []);
    assert.equal(w.mutants.shells().length, 1);
    finishNight(w);
    assert.equal(hq(w).hp, 590);
});

test('the shooter killed during its telegraph fires nothing', () => {
    const w = world();
    w.cycle.endDay();
    to(w, FIRST_AIM_TICK + 10);
    w.mutants.damageMutant('mutant-1', 30);
    finishNight(w);
    assert.equal(hq(w).hp, 600);
});

test('several shells land in order, each exactly once', () => {
    const w = world({at: [TOP(10), TOP(11), TOP(12), TOP(13), TOP(14), TOP(12)]});
    w.cycle.endDay();
    const attacks = [];
    to(w, 500, ({effects}) => attacks.push(...effects.attacks));
    assert.ok(attacks.length >= 6);
    assert.equal(hq(w).hp, 600 - attacks.reduce((sum, {damage}) => sum + damage, 0));
    assert.deepEqual(checkInvariants(w), []);
});

test('six Spitters at once stay inside their combined limit', () => {
    const w = world({at: [TOP(9), TOP(10), TOP(11), TOP(12), TOP(13), TOP(14)]});
    w.cycle.endDay();
    let spitDamage = 0;
    finishNight(w, ({effects}) => {
        spitDamage += effects.attacks.filter(({damage}) => damage === SPITTER.damage).reduce((sum, {damage}) => sum + damage, 0);
        assert.deepEqual(checkInvariants(w), []);
    });
    assert.equal(spitDamage, 300);
});

test('a shell that destroys HQ ends the run on that hit', () => {
    const w = world({at: [TOP(11), TOP(12), TOP(13)]});
    w.placement.damageBuilding(hq(w).id, 590);
    w.cycle.endDay();
    finishNight(w);
    assert.equal(w.cycle.shift, Shift.DEFEATED);
    const shells = w.mutants.shells();
    const mutants = w.mutants.snapshot();
    assert.deepEqual(w.mutants.step(), {spawned: [], attacks: [], destroyed: []});
    assert.deepEqual([w.mutants.shells(), w.mutants.snapshot()], [shells, mutants], 'everything stays frozen');
});

test('at dawn shells and Spitters are gone, nothing lands on tick 3600, and the next Night starts clean', () => {
    const w = world({schedule: [3600 - 1 - SPITTER.windupTicks - 40], at: [TOP(12)]});
    w.cycle.endDay();
    to(w, 3599 - 2);
    const hpBefore = hq(w).hp;
    finishNight(w);
    assert.equal(w.cycle.shift, Shift.DAY);
    assert.equal(hq(w).hp, hpBefore);
    assert.deepEqual(w.mutants.shells(), []);
    assert.deepEqual(w.mutants.snapshot(), []);
    w.cycle.endDay();
    step(w, 5);
    assert.deepEqual(w.mutants.shells(), []);
});

test('a shell in the air on the last combat tick is removed, not carried over', () => {
    const release = 3599 - 5; // lands well after dawn
    const w = world({schedule: [release - 45 - 66 + 1]});
    w.cycle.endDay();
    to(w, release);
    assert.equal(w.mutants.shells().length, 1);
    finishNight(w);
    assert.deepEqual(w.mutants.shells(), []);
    assert.equal(hq(w).hp, 600);
});

// ---- Autocannons and real Infantry ------------------------------------------

test('Spitters die to the same damage as any mutant, and neither gun changes', () => {
    const w = world();
    build(w, 'autocannon', 12, 5); // 144 px from the Spitter's stop
    w.cycle.endDay();
    const kills = [];
    finishNight(w, ({defense}) => kills.push(...defense.shots.filter((s) => s.killed)));
    assert.equal(kills.length, 1);
    assert.equal(w.mutants.shells().length, 0);
});

test('a ring cannon answers a Spitter at HQ with no help: it barely gets a shot off', () => {
    const w = world();
    const cannon = build(w, 'autocannon', 12, 5);
    w.cycle.endDay();
    finishNight(w);
    assert.ok(hp(w, cannon) >= 140, `cannon on ${hp(w, cannon)}`);
    assert.equal(hq(w).hp, 600);
});

test('an out-ranged Autocannon cannot answer, and the Spitter ends up walking into its fire', () => {
    const w = world({at: [BOTTOM(20)], hq: false});
    build(w, 'hq', 3, 3);
    const cannon = build(w, 'autocannon', 20, 3); // far from HQ, so it is the target
    w.cycle.endDay();
    const kills = [];
    let shotsWhenHit = null;
    finishNight(w, ({defense}) => {
        if (defense.shots.length && shotsWhenHit === null) shotsWhenHit = spitter(w)?.shots ?? 0;
        kills.push(...defense.shots.filter((s) => s.killed));
    });
    assert.equal(shotsWhenHit, 0, 'the first cannon shot came after its last spit');
    assert.equal(kills.length, 1);
    assert.equal(hp(w, cannon), 100);
});

function exposedPlant() {
    const w = world({at: [BOTTOM(20)]});
    build(w, 'powerPlant', 20, 3);
    const barracks = build(w, 'barracks', 16, 8);
    return {w, barracks};
}

test('squads have no special knowledge: a flag beside the target does not reach a Spitter at range', () => {
    const {w, barracks} = exposedPlant();
    assert.equal(w.placement.setFlag(barracks, {col: 20, row: 5}).ok, true);
    w.cycle.endDay();
    to(w, 1000);
    assert.equal(w.infantry.snapshot().night.shots, 0);
    assert.ok(spitter(w).shots < SPITTER.maxShots, 'it is firing, unanswered');
});

test('moving the flag forward at Night brings the squad to the Spitter, which dies with shots unspent', () => {
    const {w, barracks} = exposedPlant();
    w.cycle.endDay();
    to(w, 400);
    assert.equal(spitter(w).x, 912);
    assert.equal(w.placement.setFlag(barracks, {col: 20, row: 11}).ok, true);
    let shotsAtDeath = null;
    let last = null;
    finishNight(w, () => {
        if (shotsAtDeath === null && !spitter(w)) shotsAtDeath = last;
        last = spitter(w)?.shots ?? last;
    });
    assert.ok(shotsAtDeath !== null, 'the squad killed it');
    assert.ok(shotsAtDeath >= 1, `${shotsAtDeath} left`);
    assert.equal(w.infantry.snapshot().totals.kills, 1);
    assert.equal(w.infantry.snapshot().totals.lost, 0);
});

test('real soldiers who stop to fire stand still, so return fire hits them', () => {
    const w = world({at: [BOTTOM(20), BOTTOM(20), BOTTOM(20)]});
    build(w, 'powerPlant', 20, 3);
    const barracks = build(w, 'barracks', 16, 8);
    assert.equal(w.placement.setFlag(barracks, {col: 20, row: 11}).ok, true);
    w.cycle.endDay();
    let hurt = 0;
    finishNight(w, () => { hurt = Math.max(hurt, ...w.infantry.soldiers().map((s) => 30 - s.hp), 0); });
    assert.ok(hurt >= 10, 'a soldier took a shell');
});

test('a dying soldier is taken out of the tick, so two shells cannot hit a corpse', () => {
    const w = world({at: [TOP(12), TOP(12)]});
    const {list, hits} = standInSoldiers(w, {x: STOP.x, y: STOP.y + 60});
    list[0].hp = 10;
    w.cycle.endDay();
    finishNight(w);
    assert.equal(hits.length, 1);
});

// ---- Determinism ------------------------------------------------------------

const mixedNight = (speed = null) => {
    const w = createWorld({seed: 98, resources: FUNDS, requireHq: true, roads: true, schedule: [...waveSchedule(12)], spitterSlots: [2, 5, 8, 11]});
    build(w, 'hq', 12, 8);
    build(w, 'powerPlant', 20, 3);
    build(w, 'barracks', 16, 8);
    build(w, 'autocannon', 12, 5);
    for (const col of [8, 9, 10]) build(w, 'wall', col, 4);
    w.cycle.endDay();
    const states = [];
    if (speed) {
        w.clock.setSpeed(speed);
        while (w.cycle.shift === Shift.NIGHT) w.clock.advance(1000 / 60, w.tick);
    } else {
        finishNight(w, (_, tick) => { if (tick % 300 === 0) states.push(digestOf(canonicalState(worldState(w)))); });
    }
    return {digest: digestOf(canonicalState(worldState(w))), buildings: w.placement.buildings(), states, tick: w.clock.tick};
};

test('the same seed and commands repeat exactly, shells included', () => {
    assert.deepEqual(mixedNight(), mixedNight());
    assert.ok(new Set(mixedNight().states).size > 5);
});

test('shells in the air are part of the digest', () => {
    const state = (shells) => digestOf(canonicalState({mutants: [], buildings: [], autocannons: [], rng: {}, shells}));
    assert.notEqual(state([{id: 'shell-1'}]), state([]));
});

test('1x, 2x and 4x give the same fight', () => {
    const baseline = mixedNight(1);
    assert.deepEqual(mixedNight(2), baseline);
    assert.deepEqual(mixedNight(4), baseline);
});

test('reading a snapshot or the shells cannot touch the simulation', () => {
    const w = world();
    w.cycle.endDay();
    to(w, FIRST_AIM_TICK + 1);
    spitter(w).aim.x = 0;
    assert.equal(spitter(w).aim.x, 656);
    to(w, FIRST_RELEASE_TICK);
    w.mutants.shells()[0].ticksLeft = 1;
    assert.equal(w.mutants.shells()[0].ticksLeft, FLIGHT);
});
