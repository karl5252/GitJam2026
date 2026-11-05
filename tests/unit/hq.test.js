import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILDING_TYPES, HQ_TYPE} from '../../src/core/buildingTypes.js';
import {
    BuildingPlacement, CONSTRUCTION_DISABLED, HQ_ALREADY_BUILT, HQ_REQUIRED, INVALID_STATE,
} from '../../src/core/buildingPlacement.js';
import {Autocannons} from '../../src/core/autocannons.js';
import {Economy} from '../../src/core/economy.js';
import {GamePhase, defeatGame, startGame} from '../../src/core/gamePhase.js';
import {Grid} from '../../src/core/grid.js';
import {MUTANT, Mutants, TARGET_BIAS, selectTarget} from '../../src/core/mutants.js';
import {Pollution, calculateEmissions} from '../../src/core/pollution.js';
import {calculatePower} from '../../src/core/power.js';
import {SeededRandom} from '../../src/core/seededRandom.js';
import {calculateSettlement, settleNight} from '../../src/core/settlement.js';
import {Shift, ShiftCycle, ShiftFailure} from '../../src/core/shiftCycle.js';
import {SimulationClock} from '../../src/core/simulationClock.js';
import {nightPlan} from '../../src/core/waves.js';

const topSpawn = (col) => col;

function fixedRng(...indices) {
    const rng = {draws: 0, nextInt: () => indices[rng.draws++ % indices.length]};
    return rng;
}

/** The real objects with HQ enforced, ticked in the same order as GameScene. */
function world({schedule = [1], rng = fixedRng(0), credits = 100000, ap = 50, plan = false} = {}) {
    const clock = new SimulationClock();
    const economy = new Economy({credits, ap});
    const pollution = new Pollution();
    const grid = new Grid({cols: 24, rows: 16, tileSize: 32, originX: 256, originY: 104});
    let cycle;
    const placement = new BuildingPlacement(grid, economy, {isConstructionAllowed: () => cycle.isConstructionAllowed, requireHq: true});
    const reports = [];
    cycle = new ShiftCycle({
        clock,
        economy,
        canEndDay: () => placement.hqBuilt,
        settleNight: (day) => {
            const report = settleNight({day, buildings: placement.buildings(), economy, pollution});
            reports.push(report);
            return report;
        },
    });
    const mutants = new Mutants({
        cycle,
        placement,
        grid,
        rng,
        schedule,
        planNight: plan ? (day) => nightPlan({day, pollution: pollution.value, buildings: placement.buildings()}) : null,
    });
    const autocannons = new Autocannons({cycle, placement, grid, mutants});
    const log = [];
    const onTick = (tick) => {
        cycle.onTick(tick);
        const defense = autocannons.step();
        const effects = mutants.step();
        log.push({defense, effects});
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
        placement.cancel();
        return result;
    };
    const build = (type, col, row) => {
        const result = place(type, col, row);
        assert.equal(result.ok, true, `${type} at ${col},${row}: ${result.reason}`);
        return result.building.id;
    };
    cycle.begin();
    return {clock, economy, pollution, grid, placement, cycle, mutants, autocannons, rng, log, reports, onTick, step, frames, place, build};
}

function stepUntil(w, done, limit = 4000) {
    for (let i = 0; i < limit; i++) {
        if (done()) return;
        w.step(1);
    }
    assert.fail(`condition not reached within ${limit} ticks`);
}

const hqOf = (w) => w.placement.buildings().find((b) => b.type === HQ_TYPE);

/** A mutant parked in attack range of HQ, one tick from landing a hit. */
function atHqDoor({hp, schedule = [1], rng = fixedRng(topSpawn(12))} = {}) {
    const w = world({schedule, rng});
    const hq = w.build('hq', 12, 3);
    w.cycle.endDay();
    w.step(1);
    stepUntil(w, () => w.mutants.snapshot()[0].attackTimer === 1);
    if (hp !== undefined) w.placement.damageBuilding(hq, 600 - hp);
    return {w, hq};
}

// ---- Type and construction rules --------------------------------------------------

test('HQ values are the approved ones', () => {
    assert.deepEqual(BUILDING_TYPES.hq, {
        id: 'hq', name: 'HQ', width: 3, height: 3,
        cost: {credits: 0, ap: 0}, operations: {income: 0, upkeep: 0}, power: {supply: 20, demand: 0},
        pollutionPerNight: 0, maxHp: 600, switchable: false,
    });
    assert.equal(TARGET_BIAS.hq, 256);
});

test('a new run can build only HQ', () => {
    const w = world();
    assert.deepEqual(w.placement.canBuild('hq'), {ok: true});
    for (const type of ['outpost', 'factory', 'powerPlant', 'autocannon']) {
        assert.deepEqual(w.placement.canBuild(type), {ok: false, reason: HQ_REQUIRED});
        assert.equal(w.placement.select(type), false, type);
    }
    assert.equal(w.placement.select('hq'), true);
});

test('a locked type changes nothing, even if placement is attempted', () => {
    const w = world();
    const before = {grid: w.grid.snapshot(), economy: w.economy.snapshot()};
    w.placement.selectedType = 'outpost'; // force past select()
    assert.deepEqual(w.placement.placeAt({col: 3, row: 3}), {ok: false, reason: HQ_REQUIRED});
    assert.equal(w.placement.preview({col: 3, row: 3}).reason, HQ_REQUIRED);
    assert.deepEqual(w.placement.buildings(), []);
    assert.deepEqual(w.grid.snapshot(), before.grid);
    assert.deepEqual(w.economy.snapshot(), before.economy);
});

test('HQ is placed anywhere valid, costs nothing and ends placement mode', () => {
    const w = world({credits: 0, ap: 0});
    w.placement.select('hq');
    assert.equal(w.placement.preview({col: 1, row: 1}).ok, true); // corners are allowed
    const result = w.placement.placeAt({col: 1, row: 1});
    assert.equal(result.ok, true);
    assert.deepEqual(result.building, {id: 'hq-1', type: 'hq', col: 0, row: 0, width: 3, height: 3, enabled: true, hp: 600});
    assert.equal(w.placement.isPlacing, false);
    assert.equal(w.placement.hqBuilt, true);
    assert.deepEqual(w.economy.snapshot(), {credits: 0, ap: 0});
    assert.equal(w.grid.occupantAt(2, 2), 'hq-1');
});

test('an invalid HQ placement changes nothing and stays in placement mode', () => {
    const w = world();
    w.placement.select('hq');
    assert.equal(w.placement.preview({col: 0, row: 0}).ok, false); // footprint leaves the grid
    assert.equal(w.placement.placeAt({col: 0, row: 0}).ok, false);
    assert.equal(w.placement.hqBuilt, false);
    assert.equal(w.placement.isPlacing, true);
    assert.deepEqual(w.placement.buildings(), []);
});

test('placing HQ unlocks everything else and marks HQ as built', () => {
    const w = world();
    w.build('hq', 12, 8);
    assert.deepEqual(w.placement.canBuild('hq'), {ok: false, reason: HQ_ALREADY_BUILT});
    for (const type of ['outpost', 'factory', 'powerPlant', 'autocannon']) assert.deepEqual(w.placement.canBuild(type), {ok: true});
    w.build('outpost', 3, 3);
});

test('a second HQ is rejected, including through forced placement', () => {
    const w = world();
    w.build('hq', 12, 8);
    assert.equal(w.placement.select('hq'), false);
    w.placement.selectedType = 'hq';
    assert.deepEqual(w.placement.placeAt({col: 3, row: 3}), {ok: false, reason: HQ_ALREADY_BUILT});
    assert.equal(w.placement.buildings().length, 1);
});

test('one HQ per run holds without requireHq too, and after destruction', () => {
    const grid = new Grid({cols: 24, rows: 16, tileSize: 32});
    const placement = new BuildingPlacement(grid, new Economy());
    placement.select('hq');
    const {building} = placement.placeAt({col: 5, row: 5});
    placement.damageBuilding(building.id, 600);
    assert.equal(placement.hqBuilt, true); // latched, not derived from what stands
    assert.equal(placement.select('hq'), false);
    placement.selectedType = 'hq';
    assert.deepEqual(placement.placeAt({col: 5, row: 5}), {ok: false, reason: HQ_ALREADY_BUILT});
});

test('the construction gate still comes first', () => {
    const grid = new Grid({cols: 24, rows: 16, tileSize: 32});
    const placement = new BuildingPlacement(grid, new Economy(), {isConstructionAllowed: () => false, requireHq: true});
    assert.equal(placement.select('hq'), false);
    placement.selectedType = 'outpost';
    assert.deepEqual(placement.placeAt({col: 3, row: 3}), {ok: false, reason: CONSTRUCTION_DISABLED});
});

test('HQ cannot be toggled, and enabled stays true', () => {
    const w = world();
    const hq = w.build('hq', 12, 8);
    for (const value of [false, true]) assert.deepEqual(w.placement.setEnabled(hq, value), {ok: false, reason: INVALID_STATE});
    assert.equal(hqOf(w).enabled, true);
});

test('END DAY is refused until HQ is placed', () => {
    const w = world();
    assert.equal(w.cycle.canEndDay, false);
    assert.deepEqual(w.cycle.endDay(), {ok: false, reason: ShiftFailure.HQ_REQUIRED});
    assert.equal(w.cycle.shift, Shift.DAY);
    assert.equal(w.clock.paused, true);
    w.build('hq', 12, 8);
    assert.equal(w.cycle.canEndDay, true);
    assert.deepEqual(w.cycle.endDay(), {ok: true});
    assert.equal(w.cycle.canEndDay, false); // not during Night
});

// ---- Power and economy ------------------------------------------------------------

const hqRecord = {id: 'hq-1', type: 'hq', enabled: true};
const records = (...types) => [hqRecord, ...types.map((type, i) => ({id: `${type}-${i + 2}`, type, enabled: true}))];
const powerOf = (buildings) => {
    const {generation, demand, status} = calculatePower(buildings);
    return [generation, demand, status];
};

test('HQ alone generates 20 and needs no power itself', () => {
    assert.deepEqual(powerOf(records()), [20, 0, 'normal']);
    assert.equal(calculatePower(records()).buildings[0].powered, true);
});

test('HQ runs one Autocannon or two Outposts, but not a Factory', () => {
    assert.deepEqual(powerOf(records('autocannon')), [20, 20, 'normal']);
    assert.deepEqual(powerOf(records('outpost', 'outpost')), [20, 20, 'normal']);
    assert.deepEqual(powerOf(records('factory')), [20, 40, 'low-power']);
    assert.deepEqual(powerOf(records('autocannon', 'outpost')), [20, 30, 'low-power']);
});

test('HQ adds to a Plant through the same global pool', () => {
    assert.deepEqual(powerOf(records('powerPlant')), [120, 0, 'normal']);
    assert.deepEqual(powerOf(records('powerPlant', 'factory', 'factory', 'autocannon', 'autocannon')), [120, 120, 'normal']);
});

test('generation never reaches 0 while HQ stands, so there is no blackout', () => {
    const disabledPlant = records('powerPlant', 'factory');
    disabledPlant[1].enabled = false;
    assert.deepEqual(powerOf(disabledPlant), [20, 40, 'low-power']);
});

test('HQ adds no income, upkeep or pollution', () => {
    const settlement = calculateSettlement(records());
    assert.deepEqual([settlement.gross, settlement.upkeep, settlement.net, settlement.counts.hq], [0, 0, 0, 1]);
    assert.equal(calculateEmissions(records()), 0);
});

// ---- Targeting --------------------------------------------------------------------

const building = (id, type, col, row, size = 3) => ({id, type, col, row, width: size, height: size, enabled: true, hp: 100});

test('HQ beats a closer Outpost until the Outpost is 8 cells closer, like a Plant', () => {
    const grid = new Grid({cols: 24, rows: 16, tileSize: 32, originX: 256, originY: 104});
    const point = {x: 256, y: 120};
    const hq = building('hq-1', 'hq', 10, 0);
    assert.equal(selectTarget(point, [building('outpost-2', 'outpost', 3, 0, 1), hq], grid), 'hq-1');
    assert.equal(selectTarget(point, [building('outpost-2', 'outpost', 1, 0, 1), hq], grid), 'outpost-2');
});

test('an exact tie with a Plant goes to whichever was built first', () => {
    const grid = new Grid({cols: 24, rows: 16, tileSize: 32, originX: 256, originY: 104});
    const point = {x: 256 + 32 * 12, y: 104};
    const hq = building('hq-1', 'hq', 8, 2);
    const plant = building('powerPlant-2', 'powerPlant', 13, 2);
    assert.equal(selectTarget(point, [hq, plant], grid), 'hq-1');
});

test('a Plant behind HQ is never reached first: HQ is nearer, so it is the target', () => {
    // Equal bias plus shortest-path movement means HQ cannot be a mere obstacle.
    const w = world({rng: fixedRng(topSpawn(12))});
    const hq = w.build('hq', 12, 4);
    w.build('powerPlant', 12, 13);
    w.cycle.endDay();
    w.step(1);
    assert.equal(w.mutants.snapshot()[0].targetId, hq);
    assert.equal(w.mutants.snapshot()[0].obstacleId, null);
});

// ---- Lethal boundary and the defeat transition ------------------------------------

test('HQ at 6 HP survives a hit; at 5 HP it falls and the run ends', () => {
    const survives = atHqDoor({hp: 6});
    survives.w.step(1);
    assert.equal(hqOf(survives.w).hp, 1);
    assert.equal(survives.w.cycle.shift, Shift.NIGHT);

    const falls = atHqDoor({hp: 5});
    const {w, hq} = falls;
    const tick = w.cycle.elapsedNightTicks + 1;
    w.step(1);
    assert.equal(hqOf(w), undefined);
    assert.deepEqual(w.log.at(-1).effects.destroyed, [hq]);
    assert.equal(w.cycle.shift, Shift.DEFEATED);
    assert.deepEqual(w.cycle.defeatReport, {day: 1, nightTick: tick, completedShifts: 0});
    assert.equal(w.grid.occupantAt(12, 3), null);
});

test('defeat is recorded with the shifts actually completed', () => {
    const w = world({schedule: [], rng: fixedRng(0)});
    const hq = w.build('hq', 12, 3);
    w.cycle.endDay();
    w.step(3600);
    w.cycle.endDay();
    w.step(3600);
    w.cycle.endDay();
    w.step(100);
    w.placement.damageBuilding(hq, 595);
    w.cycle.defeat();
    assert.deepEqual(w.cycle.defeatReport, {day: 3, nightTick: 100, completedShifts: 2});
});

test('defeat can only happen once, and only during Night', () => {
    const w = world({schedule: []});
    assert.deepEqual(w.cycle.defeat(), {ok: false, reason: ShiftFailure.NOT_NIGHT});
    w.build('hq', 12, 8);
    w.cycle.endDay();
    w.step(5);
    assert.deepEqual(w.cycle.defeat(), {ok: true});
    const report = w.cycle.defeatReport;
    assert.deepEqual(w.cycle.defeat(), {ok: false, reason: ShiftFailure.NOT_NIGHT});
    assert.equal(w.cycle.defeatReport, report);
    assert.ok(Object.isFrozen(report));
});

test('a killing hit stops later mutants and drops a due spawn on that tick', () => {
    // Two mutants arrive together: column 14 is 16 px farther from HQ than column 12,
    // and that spawn goes 32 ticks earlier. The first hit kills; the second never acts.
    const w = world({schedule: [1, 33], rng: fixedRng(topSpawn(14), topSpawn(12))});
    w.build('hq', 12, 7);
    w.cycle.endDay();
    w.step(33);
    stepUntil(w, () => w.mutants.snapshot().length === 2 && w.mutants.snapshot().every((m) => m.attackTimer === 1));
    w.placement.damageBuilding(hqOf(w).id, 595);
    const before = w.mutants.snapshot();
    w.step(1);
    assert.equal(w.cycle.shift, Shift.DEFEATED);
    assert.equal(w.log.at(-1).effects.attacks.length, 1);
    assert.equal(w.log.at(-1).effects.attacks[0].mutantId, 'mutant-1');
    const after = w.mutants.snapshot();
    assert.equal(after[1].attackTimer, before[1].attackTimer); // it did not act
});

test('a spawn due on the defeat tick does not happen', () => {
    const probe = atHqDoor();
    const dueTick = probe.w.cycle.elapsedNightTicks + 1;
    const {w} = atHqDoor({hp: 5, schedule: [1, dueTick]});
    const draws = w.rng.draws;
    w.step(1);
    assert.equal(w.cycle.shift, Shift.DEFEATED);
    assert.equal(w.mutants.snapshot().length, 1);
    assert.equal(w.rng.draws, draws);
});

test('a turret kill on the same tick prevents the killing hit', () => {
    const w = world({rng: fixedRng(topSpawn(12))});
    const hq = w.build('hq', 12, 3);
    const cannon = w.build('autocannon', 15, 3);
    w.placement.setEnabled(cannon, false);
    w.cycle.endDay();
    w.step(1);
    stepUntil(w, () => w.mutants.snapshot()[0].attackTimer === 1);
    w.placement.damageBuilding(hq, 595);
    w.mutants.damageMutant('mutant-1', 30);
    w.placement.setEnabled(cannon, true);
    w.step(1);
    assert.equal(w.cycle.shift, Shift.NIGHT);
    assert.equal(hqOf(w).hp, 5);
    assert.deepEqual(w.mutants.snapshot(), []);
});

test('a hit that lands exactly on the last combat tick defeats before settlement', () => {
    // Choose a spawn so that a hit lands on tick 3599 exactly.
    const probe = world({schedule: [1], rng: fixedRng(topSpawn(12))});
    probe.build('hq', 12, 3);
    probe.build('powerPlant', 20, 12);
    probe.build('factory', 15, 12);
    probe.cycle.endDay();
    probe.step(400);
    const firstHit = probe.log.findIndex((l) => l.effects.attacks.length) + 1;
    const offset = (3599 - firstHit) % 60;
    const w = world({schedule: [1 + offset], rng: fixedRng(topSpawn(12))});
    const hq = w.build('hq', 12, 3);
    w.build('powerPlant', 20, 12);
    w.build('factory', 15, 12); // would earn and emit, if this night settled
    const credits = w.economy.credits;
    w.cycle.endDay();
    w.step(3598);
    w.placement.damageBuilding(hq, hqOf(w).hp - 5);
    assert.equal(w.mutants.snapshot()[0].attackTimer, 1);
    w.step(1);
    assert.equal(w.cycle.shift, Shift.DEFEATED);
    assert.equal(w.cycle.defeatReport.nightTick, 3599);
    assert.equal(w.step(10), 0); // tick 3600 never happens
    assert.deepEqual(w.reports, []);
    assert.equal(w.economy.credits, credits);
    assert.equal(w.pollution.value, 0);
    assert.equal(w.cycle.day, 1);
});

// ---- After defeat -----------------------------------------------------------------

function defeated() {
    const {w, hq} = atHqDoor({hp: 5, schedule: [1, 2000], rng: fixedRng(topSpawn(12), topSpawn(4))});
    w.step(1);
    assert.equal(w.cycle.shift, Shift.DEFEATED);
    return {w, hq};
}

test('after defeat nothing ticks, spawns, attacks, earns or emits', () => {
    const {w} = defeated();
    const before = {
        tick: w.clock.tick, mutants: w.mutants.snapshot(), buildings: w.placement.buildings(),
        economy: w.economy.snapshot(), pollution: w.pollution.value, draws: w.rng.draws, log: w.log.length,
    };
    assert.equal(w.step(240), 0);
    w.frames(600);
    w.cycle.resume();
    w.frames(600);
    assert.deepEqual(w.mutants.step(), {spawned: [], attacks: [], destroyed: []});
    assert.deepEqual(w.autocannons.step(), {shots: []});
    assert.equal(w.clock.tick, before.tick);
    assert.equal(w.log.length, before.log);
    assert.deepEqual(w.mutants.snapshot(), before.mutants);
    assert.deepEqual(w.placement.buildings(), before.buildings);
    assert.deepEqual(w.economy.snapshot(), before.economy);
    assert.equal(w.pollution.value, before.pollution);
    assert.equal(w.rng.draws, before.draws);
    assert.deepEqual(w.reports, []);
});

test('turret state stays frozen after defeat', () => {
    const w = world({rng: fixedRng(topSpawn(12))});
    w.build('hq', 12, 8);
    w.build('autocannon', 12, 3);
    w.cycle.endDay();
    stepUntil(w, () => w.log.some((l) => l.defense.shots.length));
    assert.deepEqual(w.cycle.defeat(), {ok: true});
    const before = w.autocannons.snapshot();
    assert.ok(before[0].cooldown > 0);
    assert.deepEqual(w.autocannons.step(), {shots: []});
    assert.deepEqual(w.autocannons.snapshot(), before);
});

test('survivors stay frozen on the board', () => {
    const {w} = defeated();
    const [mutant] = w.mutants.snapshot();
    assert.ok(mutant);
    w.mutants.step();
    assert.deepEqual(w.mutants.snapshot()[0], mutant);
});

test('after defeat END DAY, construction and rebuilding are all refused', () => {
    const {w} = defeated();
    assert.equal(w.cycle.canEndDay, false);
    assert.deepEqual(w.cycle.endDay(), {ok: false, reason: ShiftFailure.NOT_DAY});
    assert.equal(w.cycle.isConstructionAllowed, false);
    for (const type of ['hq', 'outpost', 'autocannon']) assert.equal(w.placement.select(type), false, type);
    assert.equal(w.placement.hqBuilt, true);
});

test('QA stepping stops at the defeat tick, part-way through a chunk', () => {
    const {w} = atHqDoor({hp: 5});
    const onTickCount = w.log.length;
    assert.equal(w.cycle.stepTicks(100, w.onTick), 1);
    assert.equal(w.log.length, onTickCount + 1);
    assert.equal(w.cycle.shift, Shift.DEFEATED);
    assert.equal(w.mutants.snapshot().length, 1); // not cleared by a stray tick
});

test('real frames stop at the defeat tick too, even in a large frame', () => {
    const {w} = atHqDoor({hp: 5});
    const tick = w.clock.tick;
    w.clock.resume();
    w.clock.advance(100, w.onTick); // up to 6 ticks
    assert.equal(w.cycle.shift, Shift.DEFEATED);
    assert.equal(w.clock.tick, tick + 1);
    assert.equal(w.clock.paused, true);
});

test('defeat is identical through stepping, even frames and uneven frames', () => {
    const run = (advance) => {
        const w = world({schedule: [100, 200, 300, 400, 500], rng: new SeededRandom(731)});
        w.build('hq', 12, 8);
        w.cycle.endDay();
        advance(w);
        return {report: w.cycle.defeatReport, mutants: w.mutants.snapshot(), attacks: w.log.flatMap((l) => l.effects.attacks), rng: w.rng.snapshot?.()};
    };
    const untilDone = (w, advanceOnce) => {
        for (let i = 0; i < 20000 && w.cycle.shift === Shift.NIGHT; i++) advanceOnce(w);
        if (w.cycle.shift === Shift.DAY) { w.cycle.endDay(); untilDone(w, advanceOnce); }
    };
    const steps = run((w) => untilDone(w, (x) => x.step(1)));
    const frames = run((w) => untilDone(w, (x) => x.frames(1)));
    const uneven = run((w) => { let i = 0; untilDone(w, (x) => x.frames(1, i++ % 3 ? 7 : 90)); });
    assert.ok(steps.report);
    assert.deepEqual(frames, steps);
    assert.deepEqual(uneven, steps);
});

test('the wave planner counts HQ as neither a turret nor extra pressure', () => {
    const w = world({plan: true});
    w.build('hq', 12, 8);
    w.cycle.endDay();
    w.step(1);
    assert.deepEqual([w.mutants.plan().budget, w.mutants.plan().autocannons], [1, 0]);
});

test('an emergency: losing the Plant with HQ standing, cutting demand brings a cannon back', () => {
    const w = world({schedule: []});
    w.build('hq', 12, 8);
    const plant = w.build('powerPlant', 18, 8);
    const factory = w.build('factory', 6, 8);
    w.build('autocannon', 12, 5);
    w.placement.damageBuilding(plant, 300);
    assert.equal(calculatePower(w.placement.buildings()).status, 'low-power');
    w.placement.setEnabled(factory, false);
    assert.deepEqual(powerOf(w.placement.buildings()), [20, 20, 'normal']);
});

test('losing a Plant, every cannon or all Credits never ends the run', () => {
    const w = world({schedule: [], credits: 750});
    w.build('hq', 12, 8);
    const plant = w.build('powerPlant', 18, 8);
    const cannon = w.build('autocannon', 12, 5);
    w.placement.damageBuilding(plant, 300);
    w.placement.damageBuilding(cannon, 150);
    w.economy.adjustCredits(-5000);
    w.cycle.endDay();
    w.step(3600);
    assert.equal(w.cycle.shift, Shift.DAY);
    assert.equal(w.cycle.defeatReport, null);
});

// ---- Phase ------------------------------------------------------------------------

test('only a started run can be defeated, and defeat is final for the phase', () => {
    assert.equal(defeatGame(GamePhase.STARTED), GamePhase.DEFEATED);
    assert.equal(defeatGame(GamePhase.READY), GamePhase.READY);
    assert.equal(defeatGame(GamePhase.DEFEATED), GamePhase.DEFEATED);
    assert.equal(startGame(GamePhase.DEFEATED), GamePhase.DEFEATED);
});

test('MUTANT stats are untouched by HQ', () => {
    assert.equal(MUTANT.attackDamage, 5);
    assert.equal(MUTANT.attackCooldownTicks, 60);
});
