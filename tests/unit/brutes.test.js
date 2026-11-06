import test from 'node:test';
import assert from 'node:assert/strict';
import {BRUTE, MUTANT, SPITTER, TARGET_BIAS} from '../../src/core/mutants.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {
    BRUTE_WAVE, WAVE, bruteCount, bruteSlots, nightPlan, spitterCount, spitterSlots, waveBudget, waveProgress, waveSchedule,
} from '../../src/core/waves.js';
import {canonicalState, checkInvariants, createWorld, digestOf, worldState} from '../soak/harness.js';

/**
 * The Brute: late-wave composition, melee, breaching, and what it does to walls,
 * gates, trucks and soldiers.
 *
 * HQ at pointer 12,8 covers tiles 11-13, 7-9: x 608-704, y 328-424, with its ring
 * on 10-14, 6-10. A Brute from the top of column 12 starts at 656,104 and stops at
 * 656,320, within melee range of HQ, after 216 px at 0.25 px per tick.
 */

const FUNDS = {credits: 100_000, ap: 200};
const TOP = (col) => col; // spawn indices, clockwise from the top-left
const LEFT = (row) => 64 + (15 - row);
const ARRIVAL_TICK = 1 + 864; // spawned on tick 1, walked 216 px

const spawnsAt = (...indices) => {
    let draws = 0;
    return {nextInt: () => indices[draws++ % indices.length], snapshot: () => ({draws})};
};

function world({at = [TOP(12)], schedule = at.map((_, i) => i + 1), brutes = schedule.map((_, i) => i), absorbed = [], spitters = [], hq = true, ...options} = {}) {
    const w = createWorld({
        rng: spawnsAt(...at), resources: FUNDS, requireHq: true, roads: true, schedule, spitterSlots: spitters, bruteSlots: brutes, absorbedSlots: absorbed, ...options,
    });
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

const brute = (w) => w.mutants.snapshot().find(({kind}) => kind === 'brute');
const hp = (w, id) => w.placement.buildings().find((b) => b.id === id)?.hp ?? 0;
const hq = (w) => w.placement.buildings().find((b) => b.type === 'hq');

/** A soldier the test places itself. */
function standInSoldier(w, {x, y}, soldierHp = 30) {
    const soldier = {id: 'soldier-1', x, y, hp: soldierHp};
    const hits = [];
    w.mutants.setInfantry({
        attackableSoldiers: () => (soldier.hp > 0 ? [{...soldier}] : []),
        damageSoldier: (id, amount) => {
            soldier.hp -= amount;
            hits.push({amount, tick: w.cycle.elapsedNightTicks});
            return {ok: true, killed: soldier.hp <= 0, hp: Math.max(0, soldier.hp)};
        },
    });
    return {soldier, hits};
}

// ---- Wave composition -------------------------------------------------------

test('the approved values', () => {
    assert.deepEqual(BRUTE, {kind: 'brute', maxHp: 600, speed: 0.25, attackDamage: 25, attackCooldownTicks: 120});
    assert.equal(BRUTE_WAVE.slotCost, 3);
    assert.ok(Object.isFrozen(BRUTE) && Object.isFrozen(BRUTE_WAVE));
    assert.equal(WAVE.maxPerNight, 40, 'the cap is not touched');
});

test('no Brute before Night 30, then one, two and at most three', () => {
    for (let night = 1; night <= 29; night++) assert.equal(bruteCount(night), 0, `night ${night}`);
    assert.deepEqual([30, 34, 35, 39, 40, 41, 100].map(bruteCount), [1, 1, 2, 2, 3, 3, 3]);
});

test('every plan before Night 30 is the plan it always was', () => {
    for (let night = 1; night < 30; night++) {
        const plan = nightPlan({day: night, pollution: 100, buildings: [{type: 'autocannon'}]});
        assert.deepEqual([plan.brutes, plan.bruteSlots, plan.absorbedSlots], [0, [], []]);
        assert.deepEqual(plan.spitterSlots, spitterSlots(plan.budget, spitterCount(night, plan.budget)));
    }
});

test('from Night 29 every base is at the cap, so a Brute always has room', () => {
    for (let night = 29; night <= 80; night++) {
        for (const threat of [1, 2, 3, 4]) {
            for (const cannons of [0, 1, 9, 30]) assert.equal(waveBudget(night, threat, cannons), WAVE.maxPerNight);
        }
    }
});

test('the approved late waves', () => {
    const composition = (day) => {
        const plan = nightPlan({day, pollution: 0, buildings: []});
        const absorbed = plan.absorbedSlots.length;
        const basics = plan.budget - plan.spitters - plan.brutes - absorbed;
        return {
            budget: plan.budget, spitters: plan.spitters, brutes: plan.brutes, absorbed, basics,
            enemies: basics + plan.spitters + plan.brutes,
            hp: basics * MUTANT.maxHp + plan.spitters * SPITTER.maxHp + plan.brutes * BRUTE.maxHp,
        };
    };
    assert.deepEqual(composition(29), {budget: 40, spitters: 6, brutes: 0, absorbed: 0, basics: 34, enemies: 40, hp: 1540});
    assert.deepEqual(composition(30), {budget: 40, spitters: 6, brutes: 1, absorbed: 2, basics: 31, enemies: 38, hp: 2020});
    assert.deepEqual(composition(35), {budget: 40, spitters: 6, brutes: 2, absorbed: 4, basics: 28, enemies: 36, hp: 2500});
    assert.deepEqual(composition(40), {budget: 40, spitters: 6, brutes: 3, absorbed: 6, basics: 25, enemies: 34, hp: 2980});
});

test('the slots of the approved waves', () => {
    const slots = (day) => {
        const {bruteSlots: placed, absorbedSlots} = nightPlan({day, pollution: 0, buildings: []});
        return [[...placed], [...absorbedSlots]];
    };
    assert.deepEqual(slots(30), [[11], [12, 13]]);
    assert.deepEqual(slots(35), [[5, 15], [6, 7, 17, 18]]);
    assert.deepEqual(slots(40), [[4, 11, 17], [5, 6, 12, 13, 18, 19]]);
});

test('slots never collide, whatever the Night, Threat or defenses', () => {
    for (let night = 1; night <= 80; night++) {
        for (const pollution of [0, 30, 60, 100]) {
            for (const cannons of [0, 3, 9, 30]) {
                const buildings = Array.from({length: cannons}, () => ({type: 'autocannon'}));
                const plan = nightPlan({day: night, pollution, buildings});
                const all = [...plan.spitterSlots, ...plan.bruteSlots, ...plan.absorbedSlots];
                assert.equal(new Set(all).size, all.length, `night ${night}`);
                assert.ok(all.every((slot) => slot >= 0 && slot < plan.budget));
                assert.ok(!plan.bruteSlots.includes(0), 'the first attacker is never a Brute');
                assert.equal(plan.absorbedSlots.length, (BRUTE_WAVE.slotCost - 1) * plan.brutes);
                assert.ok(Object.isFrozen(plan.bruteSlots) && Object.isFrozen(plan.absorbedSlots));
            }
        }
    }
});

test('Spitter slots are placed first and never move for a Brute', () => {
    const spitters = spitterSlots(40, 6);
    assert.deepEqual([...spitters], [3, 10, 16, 23, 30, 36]);
    for (const day of [30, 35, 40]) assert.deepEqual([...nightPlan({day, pollution: 0, buildings: []}).spitterSlots], [...spitters]);
    const crowded = bruteSlots(40, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 1);
    assert.deepEqual([[...crowded.bruteSlots], [...crowded.absorbedSlots]], [[12], [13, 14]]);
});

test('Brutes spawn early enough to arrive: all in the first half of the schedule', () => {
    const {schedule, bruteSlots: placed} = nightPlan({day: 40, pollution: 0, buildings: []});
    assert.deepEqual(placed.map((slot) => schedule[slot]), [716, 890, 1009]);
    assert.ok(Math.max(...placed) < schedule.length / 2);
});

test('slots that do not fit are refused', () => {
    assert.throws(() => bruteSlots(3, [], 1), RangeError);
    assert.throws(() => world({schedule: [5], brutes: [1]}), RangeError);
    assert.throws(() => world({schedule: [5, 6], brutes: [0], absorbed: [0]}), RangeError, 'a slot cannot be two things');
    assert.throws(() => world({schedule: [5, 6], brutes: [0], spitters: [0]}), RangeError);
});

test('an absorbed slot draws its number and spawns nothing, and still counts as reached', () => {
    const w = world({schedule: [5, 10, 15, 20], brutes: [1], absorbed: [2, 3], at: [TOP(1), TOP(2), TOP(3), TOP(4)]});
    w.cycle.endDay();
    to(w, 30);
    assert.equal(w.rng.snapshot().draws, 4);
    assert.deepEqual(w.mutants.snapshot().map(({id, kind}) => [id, kind]), [['mutant-1', undefined], ['mutant-2', 'brute']]);
    assert.equal(waveProgress(w.mutants.plan(), w.cycle.elapsedNightTicks), 4);
});

function lateNight(day, options) {
    const w = createWorld({seed: 98, firstNight: day, resources: FUNDS, requireHq: true, roads: true, ...options});
    assert.equal(w.place('hq', 12, 8).ok, true);
    for (let night = 1; night < day; night++) { w.cycle.endDay(); finishNight(w); }
    w.cycle.endDay();
    const spawned = [];
    finishNight(w, ({effects}, tick) => {
        for (const id of effects.spawned) {
            const {x, y, kind} = w.mutants.snapshot().find((m) => m.id === id);
            spawned.push({tick, x, y, kind});
        }
    });
    return {spawned, rng: w.rng.snapshot()};
}

test('the same real Night spawns the approved mix, on a real planner', () => {
    const count = (list, kind) => list.filter((m) => m.kind === kind).length;
    for (const [day, brutes, total] of [[30, 1, 38], [35, 2, 36], [40, 3, 34]]) {
        const {spawned} = lateNight(day);
        assert.deepEqual([spawned.length, count(spawned, 'brute'), count(spawned, 'spitter')], [total, brutes, 6], `night ${day}`);
    }
});

test('with Brutes everyone else spawns at the same ticks and positions, for the same draws', () => {
    const mixed = lateNight(40);
    const plain = lateNight(40, {brutes: false});
    assert.deepEqual(mixed.rng, plain.rng);
    const key = ({tick, x, y}) => `${tick}:${x},${y}`;
    const places = new Set(plain.spawned.map(key));
    assert.ok(mixed.spawned.every((m) => places.has(key(m))), 'every spawn was already a spawn');
    assert.equal(plain.spawned.length - mixed.spawned.length, 6);
    assert.deepEqual(mixed.spawned.filter((m) => m.kind === 'spitter'), plain.spawned.filter((m) => m.kind === 'spitter'));
});

// ---- Walking and melee ------------------------------------------------------

test('a Brute spawns with its own stats, the same target rules, and a record of its own', () => {
    const w = world();
    const plant = build(w, 'powerPlant', 12, 3);
    w.cycle.endDay();
    step(w, 1);
    assert.deepEqual({...brute(w)}, {
        id: 'mutant-1', x: 656, y: 104, hp: 600, targetId: plant, obstacleId: null, attackTimer: 120, kind: 'brute',
    });
    assert.deepEqual(TARGET_BIAS, {hq: 256, powerPlant: 256, factory: 128, autocannon: 64, siegeCannon: 64, barracks: 64, outpost: 0});
});

test('an ordinary record keeps its keys in their order, which is what keeps its digest', () => {
    const w = world({brutes: []});
    w.cycle.endDay();
    step(w, 1);
    assert.deepEqual(Object.keys(w.mutants.snapshot()[0]), ['id', 'x', 'y', 'hp', 'targetId', 'obstacleId', 'attackTimer']);
});

test('it walks at 0.25 px per tick and stops within melee range', () => {
    const w = world();
    w.cycle.endDay();
    to(w, 101);
    assert.equal(brute(w).y, 104 + 25);
    to(w, ARRIVAL_TICK);
    assert.equal(brute(w).y, 320);
    step(w, 50);
    assert.equal(brute(w).y, 320);
});

test('it hits for 25 every 120 ticks', () => {
    const w = world();
    w.cycle.endDay();
    const hits = [];
    to(w, ARRIVAL_TICK + 400, ({effects}, tick) => {
        for (const {damage} of effects.attacks) hits.push({tick, damage});
    });
    const first = hits[0].tick;
    assert.deepEqual(hits, [0, 1, 2].map((i) => ({tick: first + 120 * i, damage: 25})));
    assert.equal(first, ARRIVAL_TICK + 120);
    assert.equal(hq(w).hp, 525);
});

test('a lone Brute reaches and can destroy HQ, which ends the run on that hit', () => {
    const w = world();
    w.placement.damageBuilding(hq(w).id, 575);
    w.cycle.endDay();
    finishNight(w);
    assert.equal(w.cycle.shift, Shift.DEFEATED);
    const frozen = w.mutants.snapshot();
    assert.deepEqual(w.mutants.step(), {spawned: [], attacks: [], destroyed: []});
    assert.deepEqual(w.mutants.snapshot(), frozen);
});

test('at dawn it is gone, and the next Night starts clean', () => {
    const w = world();
    w.cycle.endDay();
    finishNight(w);
    assert.equal(w.cycle.shift, Shift.DAY);
    assert.deepEqual(w.mutants.snapshot(), []);
});

// ---- Breaching --------------------------------------------------------------

test('a Brute breaches where an ordinary mutant goes round', () => {
    const scene = (brutes) => {
        const w = world({brutes});
        const walls = [10, 11, 12, 13, 14].map((col) => build(w, 'wall', col, 3));
        w.cycle.endDay();
        step(w, 600);
        return {plans: w.mutants.detours()[0].plans, damaged: walls.filter((id) => hp(w, id) < 100).length, obstacle: w.mutants.snapshot()[0].obstacleId};
    };
    assert.deepEqual(scene([0]).plans, 0);
    assert.equal(scene([0]).damaged, 1);
    assert.equal(scene([]).plans, 1);
    assert.equal(scene([]).damaged, 0);
});

test('a Wall takes 480 ticks from the first blow being wound up, and it walks on through the gap', () => {
    const w = world();
    const wall = build(w, 'wall', 12, 3);
    w.cycle.endDay();
    const hits = [];
    let fell = null;
    to(w, 1000, ({effects}, tick) => {
        for (const {buildingId} of effects.attacks) if (buildingId === wall) hits.push(tick);
        if (effects.destroyed.includes(wall)) fell = tick;
    });
    assert.equal(hits.length, 4);
    assert.equal(fell - hits[0], 360);
    assert.equal(brute(w).obstacleId, null);
    assert.ok(brute(w).y > 200, 'through the breach');
});

test('its breach is open to the mutants behind it', () => {
    const w = world({at: [TOP(12), TOP(12)], schedule: [1, 700], brutes: [0]});
    for (let col = 0; col < 24; col++) build(w, 'wall', col, 3);
    w.cycle.endDay();
    let passed = false;
    to(w, 2600, () => {
        const follower = w.mutants.snapshot().find(({kind}) => kind === undefined);
        passed ||= Boolean(follower) && follower.y > 104 + 4 * 32;
    });
    assert.ok(passed, 'the ordinary mutant went through the same gap');
    assert.equal(w.placement.buildings().filter((b) => b.type === 'wall').length, 23, 'and nobody else had to dig');
});

test('a closed gate is breached in six blows, an open one is walked through, and side-on it is solid', () => {
    const scene = (type, open) => {
        const w = world();
        const cells = [[12, 5], [12, 4], [12, 3], [12, 2]];
        road(w, type === 'gateHorizontal' ? cells : [...cells, [11, 3], [13, 3]]);
        const gate = build(w, type, 12, 3);
        if (open) w.logistics.gateDemands = () => new Set([gate]);
        w.cycle.endDay();
        const hits = [];
        to(w, 1500, ({effects}) => hits.push(...effects.attacks.filter(({buildingId}) => buildingId === gate)));
        return {hits: hits.length, standing: hp(w, gate) > 0, past: brute(w).y > 208};
    };
    assert.deepEqual(scene('gateHorizontal', false), {hits: 6, standing: false, past: true});
    assert.deepEqual(scene('gateHorizontal', true), {hits: 0, standing: true, past: true});
    assert.deepEqual(scene('gateVertical', true), {hits: 6, standing: false, past: true});
});

test('a gate that opens mid-attack stops being an obstacle', () => {
    const w = world();
    road(w, [[12, 5], [12, 4], [12, 3], [12, 2]]);
    const gate = build(w, 'gateHorizontal', 12, 3);
    let wanted = false;
    w.logistics.gateDemands = () => new Set(wanted ? [gate] : []);
    w.cycle.endDay();
    to(w, 500);
    assert.equal(brute(w).obstacleId, gate);
    wanted = true;
    to(w, 800);
    assert.equal(brute(w).obstacleId, null);
    assert.ok(hp(w, gate) > 0);
    assert.ok(brute(w).y > 200);
});

test('a checkerboard is chewed through in a straight line', () => {
    const w = world();
    const walls = [];
    for (let row = 1; row <= 4; row++) {
        for (let col = 8; col <= 16; col++) if ((col + row) % 2 === 0) walls.push(build(w, 'wall', col, row));
    }
    w.cycle.endDay();
    const xs = new Set();
    finishNight(w, () => {
        const b = brute(w);
        if (b) xs.add(b.x);
        assert.deepEqual(checkInvariants(w), []);
    });
    assert.deepEqual([...xs], [656], 'it never left its lane');
    const lost = walls.length - w.placement.buildings().filter((b) => b.type === 'wall').length;
    assert.equal(lost, 2);
    assert.ok(hq(w).hp < 600, 'it arrived');
});

test('a funnel does not steer it: it takes the straight line through the wall', () => {
    const w = world({at: [LEFT(8)]});
    // A wall with its only gap far to the north: an ordinary mutant would take it.
    for (let row = 3; row < 16; row++) build(w, 'wall', 4, row);
    w.cycle.endDay();
    step(w, 800);
    assert.deepEqual(w.mutants.detours()[0], {id: 'mutant-1', following: false, extraTiles: 0, plans: 0});
    assert.equal(brute(w).y, 104 + 8 * 32 + 16);
});

test('a fully enclosed base is breached', () => {
    const w = world();
    const ring = [];
    for (let col = 9; col <= 15; col++) for (const row of [5, 11]) ring.push(build(w, 'wall', col, row));
    for (let row = 6; row <= 10; row++) for (const col of [9, 15]) ring.push(build(w, 'wall', col, row));
    w.cycle.endDay();
    finishNight(w);
    assert.ok(hq(w).hp < 600);
    assert.equal(ring.filter((id) => hp(w, id) === 0).length, 1, 'one breach is enough');
});

test('thick walls cost it time, layer by layer, and never stop it', () => {
    const w = world();
    for (const row of [1, 2, 3, 4]) build(w, 'wall', 12, row);
    w.cycle.endDay();
    let reached = null;
    finishNight(w, ({effects}, tick) => {
        if (reached === null && effects.attacks.some(({buildingId}) => buildingId === hq(w)?.id)) reached = tick;
    });
    assert.ok(reached > ARRIVAL_TICK + 4 * 360, `first blow on HQ at ${reached}`);
    assert.ok(reached < 3599);
});

test('a fortified border cell: it arrives outside the map and breaks in', () => {
    const w = world({at: [LEFT(8)]});
    const wall = build(w, 'wall', 0, 8);
    w.cycle.endDay();
    step(w, 2);
    assert.equal(brute(w).x, 255.5);
    to(w, 700);
    assert.equal(hp(w, wall), 0);
    assert.deepEqual(checkInvariants(w), []);
});

test('it attacks an ordinary building in its way like anyone', () => {
    const w = world();
    const outpost = build(w, 'outpost', 12, 3);
    w.cycle.endDay();
    to(w, 600);
    assert.ok(hp(w, outpost) < 100);
});

test('with no buildings it waits for dawn', () => {
    const w = world({hq: false, requireHq: false});
    w.cycle.endDay();
    finishNight(w);
    assert.equal(w.cycle.shift, Shift.DAY);
});

// ---- Several at once --------------------------------------------------------

test('Brutes concentrate on one wall without clashing, and it falls once', () => {
    const w = world({at: [TOP(12), TOP(12), TOP(12)]});
    const wall = build(w, 'wall', 12, 3);
    w.cycle.endDay();
    let falls = 0;
    to(w, 900, ({effects}) => {
        falls += effects.destroyed.filter((id) => id === wall).length;
        assert.deepEqual(checkInvariants(w), []);
    });
    assert.equal(falls, 1);
    assert.equal(w.mutants.snapshot().length, 3);
    assert.ok(w.mutants.snapshot().every(({obstacleId}) => obstacleId === null), 'everyone let go of it');
});

test('six Brutes on HQ stay consistent', () => {
    const w = world({at: [TOP(10), TOP(11), TOP(12), TOP(13), TOP(14), TOP(12)]});
    w.cycle.endDay();
    finishNight(w, () => assert.deepEqual(checkInvariants(w), []));
    assert.equal(w.cycle.shift, Shift.DEFEATED, '600 HP against 6 Brutes');
});

// ---- Trucks, soldiers and weapons -------------------------------------------

test('a soldier in reach stops it and takes two blows to die', () => {
    const w = world();
    const {hits} = standInSoldier(w, {x: 656, y: 180});
    w.cycle.endDay();
    finishNight(w);
    assert.deepEqual(hits.map(({amount}) => amount), [25, 25]);
    assert.equal(hits[1].tick - hits[0].tick, 120);
});

test('a soldier lures it at its own speed, with no jitter', () => {
    const w = world();
    standInSoldier(w, {x: 696, y: 170}, 1000);
    w.cycle.endDay();
    const xs = [];
    to(w, 420, () => xs.push(brute(w).x));
    assert.ok(xs.at(-1) > 656, 'it turned');
    assert.ok(xs.every((x, i) => i === 0 || x - xs[i - 1] <= BRUTE.speed));
    assert.ok(xs.every((x, i) => i === 0 || x >= xs[i - 1]), 'never back again');
});

test('a truck in reach stops it and takes the full blow, which is more than its 20 HP', () => {
    const w = world();
    let alive = true;
    const hits = [];
    w.logistics.attackableTrucks = () => (alive ? [{id: 'truck-1', x: 656, y: 180}] : []);
    w.logistics.damageTruck = (id, amount) => {
        hits.push(amount);
        alive = false;
        return {ok: true, destroyed: true, hp: 0};
    };
    w.cycle.endDay();
    to(w, 500);
    assert.deepEqual(hits, [BRUTE.attackDamage]);
    assert.ok(brute(w).y > 164, 'and walks on');
});

test('no weapon is useless: 60 cannon hits or 120 rifle hits kill it', () => {
    const w = world();
    w.cycle.endDay();
    step(w, 1);
    for (let i = 0; i < 59; i++) assert.equal(w.mutants.damageMutant('mutant-1', 10).killed, false);
    assert.deepEqual(w.mutants.damageMutant('mutant-1', 10), {ok: true, killed: true, hp: 0});
});

test('one Autocannon in its lane loses but hurts it badly, and three together kill it first', () => {
    const scene = (cells) => {
        const w = world();
        if (cells.length > 1) build(w, 'powerPlant', 20, 13);
        const cannons = cells.map(([col, row]) => build(w, 'autocannon', col, row));
        w.cycle.endDay();
        let killedAt = null;
        let lowest = BRUTE.maxHp;
        finishNight(w, ({defense}, tick) => {
            if (defense.shots.some((s) => s.killed)) killedAt ??= tick;
            lowest = Math.min(lowest, brute(w)?.hp ?? lowest);
        });
        return {killedAt, lowest, standing: cannons.filter((id) => hp(w, id) > 0).length, hq: hq(w).hp};
    };
    const one = scene([[12, 5]]);
    assert.equal(one.killedAt, null);
    assert.equal(one.standing, 0);
    assert.ok(one.lowest <= 200, `it was left on ${one.lowest}`);
    const three = scene([[11, 5], [12, 5], [13, 5]]);
    assert.ok(three.killedAt < ARRIVAL_TICK, `three cannons: ${three.killedAt}`);
    assert.deepEqual([three.standing, three.hq], [3, 600]);
});

test('real rifles hurt it', () => {
    const w = world({at: [TOP(20)]});
    build(w, 'powerPlant', 20, 3);
    const barracks = build(w, 'barracks', 16, 8);
    assert.equal(w.placement.setFlag(barracks, {col: 18, row: 3}).ok, true);
    w.cycle.endDay();
    to(w, 800);
    assert.ok(brute(w).hp < BRUTE.maxHp);
});

// ---- Determinism ------------------------------------------------------------

const mixedNight = (speed = null) => {
    const w = createWorld({
        seed: 98, resources: FUNDS, requireHq: true, roads: true, schedule: [...waveSchedule(14)], spitterSlots: [3, 9], bruteSlots: [4, 10], absorbedSlots: [5, 6, 11, 12],
    });
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

test('the same seed and commands repeat exactly', () => {
    assert.deepEqual(mixedNight(), mixedNight());
    assert.ok(new Set(mixedNight().states).size > 5);
});

test('1x, 2x and 4x give the same fight', () => {
    const baseline = mixedNight(1);
    assert.deepEqual(mixedNight(2), baseline);
    assert.deepEqual(mixedNight(4), baseline);
});
