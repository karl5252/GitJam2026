import test from 'node:test';
import assert from 'node:assert/strict';
import {
    WAVE, accelerationBudget, defenseResponse, lastSpawnTick, nightBudget, nightPlan, pollutionBudget, waveBudget,
    waveProgress, waveSchedule,
} from '../../src/core/waves.js';
import {Autocannons} from '../../src/core/autocannons.js';
import {BuildingPlacement} from '../../src/core/buildingPlacement.js';
import {Economy} from '../../src/core/economy.js';
import {Grid} from '../../src/core/grid.js';
import {Mutants, borderSpawns} from '../../src/core/mutants.js';
import {Pollution, threatLevel} from '../../src/core/pollution.js';
import {SeededRandom} from '../../src/core/seededRandom.js';
import {settleNight} from '../../src/core/settlement.js';
import {Shift, ShiftCycle} from '../../src/core/shiftCycle.js';
import {SimulationClock} from '../../src/core/simulationClock.js';
import {createWorld} from '../soak/harness.js';

const cannons = (n) => Array.from({length: n}, (_, i) => ({id: `autocannon-${i + 1}`, type: 'autocannon'}));

// ---- Budget formula ---------------------------------------------------------------

test('wave values are the approved ones, and frozen', () => {
    assert.deepEqual(WAVE, {
        firstTick: 600, lastTick: 2700, minLastTick: 1200, windowShrinkPerNight: 100,
        nightsPerExtra: 2, perThreatLevel: 2, cannonsPerResponse: 2, maxResponse: 4,
        accelerationFromNight: 6, accelerationDivisor: 12, maxPerNight: 40,
    });
    assert.ok(Object.isFrozen(WAVE));
});

test('night budget adds one mutant every two nights', () => {
    const expected = [[1, 1], [2, 1], [3, 2], [4, 2], [5, 3], [10, 5], [11, 6], [20, 10]];
    for (const [night, budget] of expected) assert.equal(nightBudget(night), budget, `night ${night}`);
});

test('pollution budget adds two mutants per Threat Level above 1', () => {
    assert.deepEqual([1, 2, 3, 4].map(pollutionBudget), [0, 2, 4, 6]);
});

test('defense response steps at 3, 5, 7 and 9 cannons, capped at 4', () => {
    const expected = [[0, 0], [1, 0], [2, 0], [3, 1], [4, 1], [5, 2], [6, 2], [7, 3], [8, 3], [9, 4], [10, 4], [20, 4], [500, 4]];
    for (const [count, response] of expected) assert.equal(defenseResponse(count), response, `${count} cannons`);
});

test('the approved wave table, by night, threat and cannons', () => {
    const table = {
        0: {1: [1, 3, 5, 7], 3: [2, 4, 6, 8], 5: [3, 5, 7, 9], 10: [6, 8, 10, 12], 20: [26, 28, 30, 32]},
        1: {1: [1, 3, 5, 7], 3: [2, 4, 6, 8], 5: [3, 5, 7, 9], 10: [6, 8, 10, 12], 20: [26, 28, 30, 32]},
        3: {1: [2, 4, 6, 8], 3: [3, 5, 7, 9], 5: [4, 6, 8, 10], 10: [7, 9, 11, 13], 20: [27, 29, 31, 33]},
        5: {1: [3, 5, 7, 9], 3: [4, 6, 8, 10], 5: [5, 7, 9, 11], 10: [8, 10, 12, 14], 20: [28, 30, 32, 34]},
        9: {1: [5, 7, 9, 11], 3: [6, 8, 10, 12], 5: [7, 9, 11, 13], 10: [10, 12, 14, 16], 20: [30, 32, 34, 36]},
    };
    for (const [count, nights] of Object.entries(table)) {
        for (const [night, row] of Object.entries(nights)) {
            assert.deepEqual([1, 2, 3, 4].map((t) => waveBudget(Number(night), t, Number(count))), row, `${count} cannons, night ${night}`);
        }
    }
});

test('night 2 at Threat 1 is one mutant; night 3 is two', () => {
    assert.equal(waveBudget(2, 1, 0), 1);
    assert.equal(waveBudget(3, 1, 0), 2);
});

test('the total cap of 40 holds, and is reached on the expected nights', () => {
    const firstCapped = (count) => Array.from({length: 60}, (_, i) => i + 1).find((night) => waveBudget(night, 4, count) === 40);
    assert.equal(firstCapped(0), 23);
    assert.equal(firstCapped(9), 22);
    assert.equal(waveBudget(21, 4, 9), 39);
    assert.equal(waveBudget(1000, 4, 1000), 40);
});

test('acceleration starts after night 6 and grows with the square of the nights since', () => {
    const expected = [[1, 0], [6, 0], [7, 0], [9, 0], [10, 1], [11, 2], [12, 3], [15, 6], [18, 12], [20, 16], [25, 30]];
    for (const [night, budget] of expected) assert.equal(accelerationBudget(night), budget, `night ${night}`);
});

test('the spawn window closes 100 ticks earlier each night after 6, down to tick 1200', () => {
    const expected = [[1, 2700], [6, 2700], [7, 2600], [10, 2300], [20, 1300], [21, 1200], [22, 1200], [1000, 1200]];
    for (const [night, tick] of expected) assert.equal(lastSpawnTick(night), tick, `night ${night}`);
});

test('nights 1 to 6 keep the earlier budgets and the full spawn window', () => {
    for (let night = 1; night <= 6; night++) {
        for (let threat = 1; threat <= 4; threat++) {
            for (const count of [0, 3, 9]) {
                const plan = nightPlan({day: night, pollution: [0, 25, 50, 100][threat - 1], buildings: cannons(count)});
                const earlier = nightBudget(night) + pollutionBudget(threat) + defenseResponse(count);
                assert.equal(plan.budget, earlier);
                assert.deepEqual(plan.schedule, waveSchedule(earlier));
            }
        }
    }
});

test('night-based pressure does not need Pollution', () => {
    const quiet = (night) => nightPlan({day: night, pollution: 0, buildings: []});
    assert.deepEqual([quiet(20).budget, quiet(20).lastSpawnTick], [26, 1300]);
    assert.deepEqual([quiet(23).budget, quiet(23).lastSpawnTick], [36, 1200]);
    const dirty = nightPlan({day: 20, pollution: 100, buildings: []});
    assert.equal(dirty.budget, quiet(20).budget + 6);
    assert.equal(dirty.lastSpawnTick, quiet(20).lastSpawnTick);
});

test('pressure never falls as night, threat or cannons rise', () => {
    for (let night = 1; night <= 40; night++) {
        for (let threat = 1; threat <= 4; threat++) {
            for (let count = 0; count <= 12; count++) {
                const budget = waveBudget(night, threat, count);
                assert.ok(budget >= 1 && budget <= WAVE.maxPerNight);
                assert.ok(lastSpawnTick(night + 1) <= lastSpawnTick(night));
                assert.ok(waveBudget(night + 1, threat, count) >= budget);
                if (threat < 4) assert.ok(waveBudget(night, threat + 1, count) >= budget);
                assert.ok(waveBudget(night, threat, count + 1) >= budget);
            }
        }
    }
});

test('invalid inputs are rejected', () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity, '2', null]) {
        assert.throws(() => nightBudget(bad), RangeError, String(bad));
        assert.throws(() => pollutionBudget(bad), RangeError, String(bad));
        assert.throws(() => accelerationBudget(bad), RangeError, String(bad));
        assert.throws(() => lastSpawnTick(bad), RangeError, String(bad));
    }
    for (const bad of [-1, 1.5, NaN, '2', null]) {
        assert.throws(() => defenseResponse(bad), RangeError, String(bad));
        assert.throws(() => waveSchedule(bad), RangeError, String(bad));
    }
    for (const bad of [599, 1.5, NaN, '2700', null]) {
        assert.throws(() => waveSchedule(2, bad), RangeError, String(bad));
    }
});

// ---- Schedules --------------------------------------------------------------------

test('exact schedules for sample budgets', () => {
    assert.deepEqual(waveSchedule(0), []);
    assert.deepEqual(waveSchedule(1), [600]);
    assert.deepEqual(waveSchedule(2), [600, 2700]);
    assert.deepEqual(waveSchedule(3), [600, 2175, 2700]);
    assert.deepEqual(waveSchedule(4), [600, 1766, 2466, 2700]);
    assert.deepEqual(waveSchedule(5), [600, 1518, 2175, 2568, 2700]);
    assert.deepEqual(waveSchedule(8), [600, 1157, 1628, 2014, 2314, 2528, 2657, 2700]);
});

test('a shorter window ends on its own last tick', () => {
    assert.deepEqual(waveSchedule(0, 1200), []);
    assert.deepEqual(waveSchedule(1, 1200), [600]);
    assert.deepEqual(waveSchedule(2, 1200), [600, 1200]);
    assert.deepEqual(waveSchedule(4, 2600), [600, 1711, 2377, 2600]);
});

test('every budget fits every night window, one spawn per tick', () => {
    for (let night = 1; night <= 30; night++) {
        const lastTick = lastSpawnTick(night);
        for (let budget = 2; budget <= WAVE.maxPerNight; budget++) {
            const schedule = waveSchedule(budget, lastTick);
            const label = `night ${night}, budget ${budget}`;
            assert.equal(schedule.length, budget, label);
            assert.equal(schedule[0], WAVE.firstTick, label);
            assert.equal(schedule.at(-1), lastTick, label);
            assert.ok(schedule.every((tick, i) => Number.isInteger(tick) && (i === 0 || tick > schedule[i - 1])), label);
        }
    }
});

test('the tightest approved wave keeps a tick for every spawn', () => {
    assert.deepEqual(waveSchedule(40, 1200).slice(-6), [1190, 1193, 1196, 1198, 1199, 1200]);
});

test('crowded spawns are walked back to their own ticks, without moving the first or last', () => {
    const packed = Array.from({length: 40}, (_, i) => 600 + i);
    assert.deepEqual(waveSchedule(40, 639), packed);
    const tight = waveSchedule(40, 660);
    assert.deepEqual([tight[0], tight.at(-1)], [600, 660]);
    assert.ok(tight.every((tick, i) => i === 0 || tick > tight[i - 1]));
    assert.deepEqual(waveSchedule(2, 601), [600, 601]);
});

test('a budget too large for its window is refused, not silently shortened', () => {
    assert.throws(() => waveSchedule(5, 603), /does not fit/);
    assert.throws(() => waveSchedule(3, 601), /does not fit/);
    assert.equal(waveSchedule(1, 600).length, 1);
});

test('every budget gives strictly increasing ticks inside the window, one per tick', () => {
    for (let budget = 1; budget <= WAVE.maxPerNight; budget++) {
        const schedule = waveSchedule(budget);
        assert.equal(schedule.length, budget);
        assert.equal(schedule[0], WAVE.firstTick);
        if (budget > 1) assert.equal(schedule.at(-1), WAVE.lastTick);
        assert.ok(schedule.every((tick, i) => Number.isInteger(tick) && (i === 0 || tick > schedule[i - 1])), `budget ${budget}`);
    }
});

test('gaps never widen, and the smallest gap of a 20-mutant wave is 6 ticks', () => {
    for (let budget = 3; budget <= WAVE.maxPerNight; budget++) {
        const schedule = waveSchedule(budget);
        const gaps = schedule.slice(1).map((tick, i) => tick - schedule[i]);
        // floor() can shift a gap by one tick either way.
        assert.ok(gaps.every((gap, i) => i === 0 || gap <= gaps[i - 1] + 1), `budget ${budget}: ${gaps}`);
    }
    const twenty = waveSchedule(20);
    assert.equal(Math.min(...twenty.slice(1).map((tick, i) => tick - twenty[i])), 6);
});

test('large waves are quiet early and strongest late', () => {
    const schedule = waveSchedule(20);
    const count = (from, to) => schedule.filter((tick) => tick >= from && tick < to).length;
    const opening = count(600, 1125);
    const finale = count(2175, 2701);
    assert.ok(opening < finale / 2, `${opening} vs ${finale}`);
});

// ---- nightPlan --------------------------------------------------------------------

test('a plan reports every term of the formula', () => {
    assert.deepEqual(nightPlan({day: 5, pollution: 60, buildings: cannons(3)}), {
        day: 5, threatLevel: 3, autocannons: 3, nightBudget: 3, pollutionBudget: 4, defenseResponse: 1,
        accelerationBudget: 0, budget: 8, lastSpawnTick: 2700, schedule: [...waveSchedule(8)],
        spitters: 1, spitterSlots: [4],
    });
});

test('a late plan uses the accelerated budget and its shorter window', () => {
    const plan = nightPlan({day: 20, pollution: 100, buildings: cannons(3)});
    assert.deepEqual(
        [plan.nightBudget, plan.pollutionBudget, plan.defenseResponse, plan.accelerationBudget, plan.budget, plan.lastSpawnTick],
        [10, 6, 1, 16, 33, 1300],
    );
    assert.deepEqual(plan.schedule, waveSchedule(33, 1300));
    assert.equal(plan.schedule.length, 33);
    assert.ok(Object.isFrozen(plan.schedule));
});

test('Threat Level boundaries change the plan at pollution 25, 50 and 100', () => {
    const budget = (pollution) => nightPlan({day: 1, pollution, buildings: []}).budget;
    assert.deepEqual([24, 25, 49, 50, 99, 100].map(budget), [1, 3, 3, 5, 5, 7]);
});

test('every Autocannon counts, enabled or not, and other buildings never do', () => {
    const buildings = [
        {id: 'a', type: 'autocannon', enabled: false},
        {id: 'b', type: 'autocannon', enabled: true},
        {id: 'c', type: 'autocannon', enabled: false},
        {id: 'd', type: 'outpost', enabled: true},
        {id: 'e', type: 'factory', enabled: true},
    ];
    assert.equal(nightPlan({day: 1, pollution: 0, buildings}).autocannons, 3);
    assert.equal(nightPlan({day: 1, pollution: 0, buildings}).defenseResponse, 1);
});

test('a plan is deeply frozen and shares nothing with the building records', () => {
    const buildings = cannons(3);
    const plan = nightPlan({day: 3, pollution: 30, buildings});
    const before = structuredClone(plan);
    assert.ok(Object.isFrozen(plan));
    assert.ok(Object.isFrozen(plan.schedule));
    assert.ok(Object.values(plan).every((v) => typeof v === 'number' || Array.isArray(v)));
    assert.throws(() => { plan.budget = 99; }, TypeError);
    assert.throws(() => { plan.schedule[0] = 1; }, TypeError);
    buildings.length = 0;
    assert.deepEqual(structuredClone(plan), before);
});

test('planning changes neither its inputs nor pollution', () => {
    const pollution = new Pollution(30);
    const buildings = cannons(3);
    const copy = structuredClone(buildings);
    nightPlan({day: 2, pollution: pollution.value, buildings});
    assert.equal(pollution.value, 30);
    assert.deepEqual(buildings, copy);
});

test('waveProgress counts scheduled slots reached', () => {
    const plan = {schedule: waveSchedule(3)};
    assert.deepEqual([0, 599, 600, 2174, 2175, 2699, 2700, 3599].map((t) => waveProgress(plan, t)), [0, 0, 1, 1, 2, 2, 3, 3]);
});

// ---- Integration ------------------------------------------------------------------

/** The real objects, ticked in the same order as GameScene.stepSimulation. */
function world({seed = 731, credits = 100000, ap = 50, pollution: start = 0} = {}) {
    const clock = new SimulationClock();
    const economy = new Economy({credits, ap});
    const pollution = new Pollution(start);
    const grid = new Grid({cols: 24, rows: 16, tileSize: 32, originX: 256, originY: 104});
    const rng = new SeededRandom(seed);
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
    const planCalls = [];
    const planNight = (day) => {
        planCalls.push({day, tick: cycle.elapsedNightTicks, pollution: pollution.value});
        return nightPlan({day, pollution: pollution.value, buildings: placement.buildings()});
    };
    const mutants = new Mutants({cycle, placement, grid, rng, planNight});
    const autocannons = new Autocannons({cycle, placement, grid, mutants});
    const log = [];
    const onTick = (tick) => {
        cycle.onTick(tick);
        const defense = autocannons.step();
        const effects = mutants.step();
        log.push({night: cycle.elapsedNightTicks, day: cycle.day, shots: defense.shots, effects});
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
    cycle.begin();
    return {clock, economy, pollution, grid, rng, placement, cycle, mutants, autocannons, log, reports, planCalls, onTick, step, frames, place, setFail};
}

const spawnTicks = (w) => w.log.filter((l) => l.effects.spawned.length).map((l) => l.night);
const cannonRow = (w, n, row = 1) => Array.from({length: n}, (_, i) => w.place('autocannon', 2 + i, row));

test('no plan exists before the first Night tick, and it freezes on tick 1', () => {
    const w = world();
    assert.equal(w.mutants.plan(), null);
    w.cycle.endDay();
    assert.equal(w.mutants.plan(), null);
    w.step(1);
    assert.deepEqual(w.planCalls, [{day: 1, tick: 1, pollution: 0}]);
    assert.equal(w.mutants.plan().budget, 1);
});

test('the plan is made once per night, however many ticks run', () => {
    const w = world();
    w.place('powerPlant', 2, 13);
    for (let night = 1; night <= 3; night++) {
        w.cycle.endDay();
        w.step(3600);
    }
    assert.deepEqual(w.planCalls.map((c) => [c.day, c.tick]), [[1, 1], [2, 1], [3, 1]]);
});

test('spawns land on exactly the planned ticks, one per tick', () => {
    const w = world({pollution: 50}); // Threat 3: budget 5 on night 1
    w.cycle.endDay();
    w.step(3599);
    assert.deepEqual(spawnTicks(w), [600, 1518, 2175, 2568, 2700]);
    assert.ok(w.log.every((l) => l.effects.spawned.length <= 1));
});

test('a night emits into the next night\'s plan, never its own', () => {
    const w = world({pollution: 13}); // the Plant's +12 reaches 25 at dawn
    w.place('powerPlant', 2, 13);
    w.cycle.endDay();
    w.step(3600);
    assert.equal(w.reports[0].pollution.after, 25);
    assert.deepEqual(w.planCalls[0], {day: 1, tick: 1, pollution: 13});
    w.cycle.endDay();
    w.step(1);
    assert.deepEqual(w.planCalls[1], {day: 2, tick: 1, pollution: 25});
    assert.equal(w.mutants.plan().threatLevel, 2);
    assert.equal(w.mutants.plan().budget, 3);
});

test('losing or switching off a cannon mid-night changes nothing this night', () => {
    const w = world();
    const ids = cannonRow(w, 3);
    w.cycle.endDay();
    w.step(10);
    const plan = w.mutants.plan();
    assert.equal(plan.budget, 2);
    w.placement.setEnabled(ids[0], false);
    w.placement.damageBuilding(ids[1], 150);
    w.step(3589);
    assert.equal(w.mutants.plan(), plan);
    assert.deepEqual(spawnTicks(w), [600, 2700]);
});

test('the next night plans from the cannons that remain', () => {
    const w = world();
    const ids = cannonRow(w, 3);
    w.cycle.endDay();
    w.step(10);
    w.placement.damageBuilding(ids[1], 150);
    w.step(3590);
    w.cycle.endDay();
    w.step(1);
    assert.equal(w.mutants.plan().autocannons, 2);
    assert.equal(w.mutants.plan().defenseResponse, 0);
});

test('disabled and unpowered cannons still count', () => {
    const w = world();
    const ids = cannonRow(w, 3); // no Plant: all unpowered
    w.placement.setEnabled(ids[0], false);
    w.cycle.endDay();
    w.step(1);
    assert.equal(w.mutants.plan().autocannons, 3);
    assert.equal(w.mutants.plan().defenseResponse, 1);
});

test('wave planning leaves Pollution and Credits to settlement', () => {
    const w = world({pollution: 40});
    cannonRow(w, 5);
    const credits = w.economy.credits;
    w.cycle.endDay();
    w.step(3599);
    assert.equal(w.pollution.value, 40);
    assert.equal(threatLevel(w.pollution.value), 2);
    assert.equal(w.economy.credits, credits);
});

test('Day stays free of enemies, with no plan and no spawns', () => {
    const w = world();
    w.frames(600);
    assert.equal(w.step(100), 0);
    for (let i = 0; i < 100; i++) w.mutants.step();
    assert.equal(w.mutants.plan(), null);
    assert.deepEqual(w.planCalls, []);
    assert.deepEqual(w.mutants.snapshot(), []);
});

test('dawn clears every survivor and the plan, on tick 3600', () => {
    const w = world({pollution: 100});
    w.place('powerPlant', 12, 8);
    w.cycle.endDay();
    w.step(3599);
    assert.ok(w.mutants.snapshot().length > 1);
    assert.ok(w.mutants.plan());
    w.step(1);
    assert.equal(w.cycle.shift, Shift.DAY);
    assert.deepEqual(w.mutants.snapshot(), []);
    assert.equal(w.mutants.plan(), null);
});

test('a failed settlement retry neither re-plans nor duplicates spawns', () => {
    const w = world({pollution: 50});
    w.cycle.endDay();
    w.step(3599);
    const plan = w.mutants.plan();
    const alive = w.mutants.snapshot();
    const rng = w.rng.snapshot();

    w.setFail(true);
    assert.throws(() => w.step(1), /settlement failed/);
    assert.equal(w.mutants.plan(), plan);
    assert.deepEqual(w.mutants.snapshot(), alive);

    w.setFail(false);
    assert.equal(w.step(1), 1);
    assert.equal(w.planCalls.length, 1);
    assert.equal(spawnTicks(w).length, 5);
    assert.equal(w.reports.length, 1);
    assert.deepEqual(w.rng.snapshot(), rng);
});

test('a full border skips the spawn: its slot still counts, and it is not retried', () => {
    const w = world({pollution: 25}); // Threat 2: budget 3
    const cells = new Map(borderSpawns(w.grid).map(({col, row}) => [`${col},${row}`, {col, row}]));
    for (const [key, {col, row}] of cells) assert.equal(w.grid.place(key, {col, row, width: 1, height: 1}).ok, true);
    w.cycle.endDay();
    w.step(600);
    assert.deepEqual(w.mutants.snapshot(), []);
    assert.equal(waveProgress(w.mutants.plan(), w.cycle.elapsedNightTicks), 1);
    assert.equal(w.rng.snapshot().state === 731, false); // the draw still happened

    w.grid.remove('10,0');
    w.step(1000);
    assert.deepEqual(w.mutants.snapshot(), []); // the missed spawn never returns
    w.step(575); // tick 2175, the next slot
    assert.equal(w.mutants.snapshot().length, 1);
    assert.equal(w.mutants.snapshot()[0].id, 'mutant-1');
    assert.equal(waveProgress(w.mutants.plan(), w.cycle.elapsedNightTicks), 2);
});

test('Autocannons lock, kill and reacquire through a wave', () => {
    const w = world({pollution: 100, seed: 5}); // Threat 4: budget 7
    w.place('powerPlant', 12, 8);
    for (const [col, row] of [[10, 6], [14, 6], [10, 10], [14, 10]]) w.place('autocannon', col, row);
    w.cycle.endDay();
    w.step(3599);
    const shots = w.log.flatMap((l) => l.shots);
    const kills = shots.filter((s) => s.killed).map((s) => s.mutantId);
    assert.equal(w.mutants.plan().budget, 8); // 7 + response for 4 cannons
    assert.ok(kills.length >= 6, `kills ${kills.length}`);
    assert.equal(new Set(kills).size, kills.length, 'no mutant dies twice');
    assert.equal(kills.length + w.mutants.snapshot().length, 8);
    for (const id of kills) assert.equal(shots.filter((s) => s.mutantId === id).length, 4);
});

function playThree(advance, seed = 731) {
    const w = world({seed, pollution: 30});
    w.place('powerPlant', 12, 8);
    w.place('factory', 7, 8);
    w.place('autocannon', 12, 5);
    w.place('autocannon', 16, 8);
    w.place('autocannon', 9, 12);
    const trail = [];
    for (let night = 0; night < 3; night++) {
        w.cycle.endDay();
        advance(w);
        trail.push({buildings: w.placement.buildings(), report: w.reports.at(-1), rng: w.rng.snapshot()});
    }
    return {trail, spawnTicks: spawnTicks(w), plans: w.planCalls, shots: w.log.flatMap((l) => l.shots), economy: w.economy.snapshot()};
}

test('a late night spawns on exactly the planned ticks, and the same seed repeats them', () => {
    const late = () => {
        const w = world({pollution: 100});
        for (let night = 1; night < 21; night++) { w.cycle.endDay(); w.step(3600); }
        w.log.length = 0;
        w.cycle.endDay();
        w.step(1300);
        return {plan: w.mutants.plan(), ticks: spawnTicks(w), mutants: w.mutants.snapshot()};
    };
    const first = late();
    assert.equal(first.plan.lastSpawnTick, 1200);
    assert.deepEqual(first.ticks, [...first.plan.schedule]);
    assert.equal(first.ticks.length, first.plan.budget);
    assert.deepEqual(late(), first);
});

/**
 * A no-income turtle: the whole 1250-Credit budget on three Autocannons and a
 * Plant on Day 1, with no further commands. Nobody plays it, so it is a benchmark
 * of the waves and not a target for real play.
 *
 * Two contracts, because they guard different things. Ordinary waves alone, the
 * same waves with the Spitters taken out, must still hold it for many Nights and
 * then beat it: that is the TASK 015 escalation. The real waves must beat it much
 * sooner, but not at once. Falling early is the approved difference between a
 * static base and a managed one (a developer playtest with a managed economy
 * reached Day 40), so it is protected from both sides: a Spitter that stopped
 * mattering fails here, and so does one that collapsed a base as soon as it came.
 */
const TURTLES = {
    centre: {hq: [12, 8], cannons: [[10, 6], [14, 6], [10, 10]], plant: [12, 4]},
    'north-west corner': {hq: [1, 1], cannons: [[3, 3], [1, 3], [3, 1]], plant: [1, 5]},
    'south-east corner': {hq: [22, 14], cannons: [[20, 12], [22, 12], [20, 14]], plant: [22, 10]},
};

function playTurtle(layout, seed, spitters) {
    const w = createWorld({seed, requireHq: true, spitters});
    assert.equal(w.place('hq', ...layout.hq).ok, true);
    assert.equal(w.place('powerPlant', ...layout.plant).ok, true);
    for (const cell of layout.cannons) assert.equal(w.place('autocannon', ...cell).ok, true);
    const run = {w, shots: 0, shellsLanded: 0, plantFell: null};
    for (let night = 1; night <= 25 && w.cycle.shift === Shift.DAY; night++) {
        w.cycle.endDay();
        while (w.cycle.shift === Shift.NIGHT) {
            w.cycle.stepTicks(240, (t) => {
                const {defense, effects} = w.tick(t);
                run.shots += defense.shots.length;
                run.shellsLanded += effects.impacts?.length ?? 0;
                if (effects.destroyed.some((id) => id.startsWith('powerPlant'))) run.plantFell ??= night;
            });
        }
    }
    return run;
}

for (const [name, layout] of Object.entries(TURTLES)) {
    test(`on ordinary waves a no-income turtle holds for many nights, then falls to combat: ${name}`, () => {
        for (const seed of [1, 98]) {
            const {w, shots, shellsLanded} = playTurtle(layout, seed, false);
            assert.equal(w.cycle.shift, Shift.DEFEATED, `seed ${seed} should fall by night 25`);
            assert.ok(w.cycle.defeatReport.day >= 15, `seed ${seed} fell on night ${w.cycle.defeatReport.day}`);
            assert.ok(shots > 500, `seed ${seed} only fired ${shots} shots`);
            assert.equal(shellsLanded, 0);
            assert.equal(w.economy.credits, 0); // spent everything on Day 1, and never earned anything
        }
    });

    test(`Spitters beat a static turtle much sooner, but not at once: ${name}`, () => {
        for (const seed of [1, 98]) {
            const ordinary = playTurtle(layout, seed, false).w.cycle.defeatReport.day;
            const {w, shots, shellsLanded, plantFell} = playTurtle(layout, seed, true);
            assert.equal(w.cycle.shift, Shift.DEFEATED, `seed ${seed} should fall`);
            const {day} = w.cycle.defeatReport;
            assert.ok(day >= 10, `seed ${seed} collapsed on night ${day}`); // 30 seeds: never before 11
            assert.ok(ordinary - day >= 5, `seed ${seed} fell on night ${day}, ordinary waves on ${ordinary}`);
            assert.ok(shellsLanded >= 20, `seed ${seed} landed ${shellsLanded} shells`);
            assert.ok(shots > 150, `seed ${seed} only fired ${shots} shots`);
            assert.ok(plantFell !== null && plantFell <= day, 'the Plant goes first or with HQ: it is what silences the cannons');
            assert.equal(w.economy.credits, 0);
        }
    });
}

test('the same seed and state give identical waves', () => {
    const steps = (w) => w.step(3600);
    assert.deepEqual(playThree(steps), playThree(steps));
});

test('different seeds keep the same spawn ticks but change positions', () => {
    const steps = (w) => w.step(3600);
    const a = playThree(steps, 731);
    const b = playThree(steps, 732);
    assert.deepEqual(a.spawnTicks, b.spawnTicks);
    assert.notDeepEqual(a.shots, b.shots);
});

test('real frames and manual stepping give identical waves, at any frame rate', () => {
    const viaSteps = playThree((w) => w.step(3600));
    const viaFrames = playThree((w) => { while (w.cycle.shift === Shift.NIGHT) w.frames(1); });
    const viaUneven = playThree((w) => {
        for (let i = 0; w.cycle.shift === Shift.NIGHT; i++) w.frames(1, i % 3 ? 7 : 90);
    });
    assert.deepEqual(viaFrames, viaSteps);
    assert.deepEqual(viaUneven, viaSteps);
});

test('fixed schedules still work, with a plan that holds only the schedule', () => {
    const clock = new SimulationClock();
    const economy = new Economy();
    const grid = new Grid({cols: 24, rows: 16, tileSize: 32, originX: 256, originY: 104});
    const placement = new BuildingPlacement(grid, economy);
    const cycle = new ShiftCycle({clock, economy});
    const mutants = new Mutants({cycle, placement, grid, rng: new SeededRandom(1), schedule: [5]});
    cycle.begin();
    cycle.endDay();
    cycle.stepTicks(5, (t) => { cycle.onTick(t); mutants.step(); });
    assert.deepEqual(mutants.plan(), {schedule: [5]});
    assert.ok(Object.isFrozen(mutants.plan().schedule));
    assert.equal(mutants.snapshot().length, 1);
});

test('an invalid planner result is rejected', () => {
    const clock = new SimulationClock();
    const economy = new Economy();
    const grid = new Grid({cols: 24, rows: 16, tileSize: 32, originX: 256, originY: 104});
    const placement = new BuildingPlacement(grid, economy);
    const cycle = new ShiftCycle({clock, economy});
    const mutants = new Mutants({cycle, placement, grid, rng: new SeededRandom(1), planNight: () => ({schedule: [10, 10]})});
    cycle.begin();
    cycle.endDay();
    assert.throws(() => cycle.stepTicks(1, (t) => { cycle.onTick(t); mutants.step(); }), RangeError);
});
