import test from 'node:test';
import assert from 'node:assert/strict';
import {Pollution, STARTING_POLLUTION, calculateEmissions, threatLevel} from '../../src/core/pollution.js';
import {settleNight} from '../../src/core/settlement.js';
import {Economy} from '../../src/core/economy.js';
import {SimulationClock} from '../../src/core/simulationClock.js';
import {ShiftCycle, Shift} from '../../src/core/shiftCycle.js';
import {Grid} from '../../src/core/grid.js';
import {BuildingPlacement} from '../../src/core/buildingPlacement.js';

const MAX = Number.MAX_SAFE_INTEGER;
const b = (type, n = 1, extra = {}) => Array.from({length: n}, (_, i) => ({id: `${type}-${i + 1}`, type, enabled: true, ...extra}));

// ---- threatLevel ------------------------------------------------------------------

test('threat level changes exactly at 25, 50 and 100', () => {
    const expected = [[0, 1], [24, 1], [25, 2], [49, 2], [50, 3], [99, 3], [100, 4], [5000, 4], [MAX, 4]];
    for (const [pollution, level] of expected) assert.equal(threatLevel(pollution), level, `pollution ${pollution}`);
});

test('threatLevel rejects invalid pollution', () => {
    for (const bad of [-1, 1.5, NaN, Infinity, MAX + 1, '10', null, undefined]) {
        assert.throws(() => threatLevel(bad), RangeError, String(bad));
    }
});

// ---- calculateEmissions -----------------------------------------------------------

test('no buildings emit nothing', () => {
    assert.equal(calculateEmissions([]), 0);
});

test('an enabled Power Plant emits 12, a disabled one 0', () => {
    assert.equal(calculateEmissions(b('powerPlant')), 12);
    assert.equal(calculateEmissions(b('powerPlant', 1, {enabled: false})), 0);
});

test('a powered Factory emits 8', () => {
    assert.equal(calculateEmissions([...b('powerPlant'), ...b('factory')]), 20);
});

test('a disabled Factory emits 0 even with spare power', () => {
    assert.equal(calculateEmissions([...b('powerPlant'), ...b('factory', 1, {enabled: false})]), 12);
});

test('a Factory in blackout emits 0', () => {
    assert.equal(calculateEmissions(b('factory')), 0);
    assert.equal(calculateEmissions([...b('powerPlant', 1, {enabled: false}), ...b('factory')]), 0);
});

test('low power stops every Factory, but the Plant still emits', () => {
    assert.equal(calculateEmissions([...b('powerPlant'), ...b('factory', 3)]), 12); // 100 / 120
});

test('demand exactly equal to supply keeps Factories emitting', () => {
    const buildings = [...b('powerPlant'), ...b('factory', 2), ...b('outpost', 2)]; // 100 / 100
    assert.equal(calculateEmissions(buildings), 12 + 16);
});

test('Outposts never emit, powered or not', () => {
    assert.equal(calculateEmissions(b('outpost', 5)), 0);
    assert.equal(calculateEmissions([...b('powerPlant'), ...b('outpost', 5)]), 12);
    assert.equal(calculateEmissions(b('outpost', 5, {enabled: false})), 0);
});

test('calculateEmissions is pure and deterministic', () => {
    const buildings = [...b('powerPlant'), ...b('factory', 1, {enabled: false})];
    const before = structuredClone(buildings);
    assert.equal(calculateEmissions(buildings), calculateEmissions(buildings));
    assert.deepEqual(buildings, before);
});

test('calculateEmissions rejects unknown types and malformed input', () => {
    assert.throws(() => calculateEmissions([{id: 'x', type: 'tower'}]), TypeError);
    assert.throws(() => calculateEmissions(null), TypeError);
});

// ---- Pollution state --------------------------------------------------------------

test('pollution starts at 0 and accumulates without decay', () => {
    const pollution = new Pollution();
    assert.equal(STARTING_POLLUTION, 0);
    assert.equal(pollution.value, 0);
    pollution.add(12);
    pollution.add(0);
    pollution.add(8);
    assert.equal(pollution.value, 20);
});

test('the constructor rejects invalid values', () => {
    for (const bad of [-1, 1.5, NaN, Infinity, MAX + 1, '5', null]) {
        assert.throws(() => new Pollution(bad), RangeError, String(bad));
    }
});

test('add rejects invalid amounts and leaves the value unchanged', () => {
    const pollution = new Pollution(30);
    for (const bad of [-1, 1.5, NaN, Infinity, MAX + 1, '5', null, undefined]) {
        assert.throws(() => pollution.add(bad), RangeError, String(bad));
        assert.equal(pollution.value, 30);
    }
});

test('add accepts the exact safe-integer limit and rejects one past it, unchanged', () => {
    const pollution = new Pollution(MAX - 1);
    assert.throws(() => pollution.add(2), RangeError);
    assert.equal(pollution.value, MAX - 1);
    pollution.add(1);
    assert.equal(pollution.value, MAX);
    assert.throws(() => pollution.add(1), RangeError);
    assert.equal(pollution.value, MAX);
    pollution.add(0);
    assert.equal(pollution.value, MAX);
});

test('snapshots are detached and hold no threat state', () => {
    const pollution = new Pollution(40);
    const snapshot = pollution.snapshot();
    assert.deepEqual(snapshot, {value: 40});
    snapshot.value = 999;
    assert.equal(pollution.value, 40);
    pollution.add(1);
    assert.equal(snapshot.value, 999);
    assert.deepEqual(pollution.snapshot(), {value: 41});
});

// ---- settleNight: required dependency and atomicity -------------------------------

test('settleNight requires a Pollution and changes nothing without one', () => {
    const economy = new Economy({credits: 500, ap: 2});
    for (const bad of [undefined, null, {}, {value: 0, add() {}}]) {
        assert.throws(() => settleNight({day: 1, buildings: b('outpost'), economy, pollution: bad}), TypeError);
    }
    assert.deepEqual(economy.snapshot(), {credits: 500, ap: 2});
});

test('settleNight reports pollution before, emitted, after and threat', () => {
    const pollution = new Pollution(10);
    const report = settleNight({day: 1, buildings: [...b('powerPlant'), ...b('factory')], economy: new Economy(), pollution});
    assert.deepEqual(report.pollution, {before: 10, emitted: 20, after: 30, threatLevel: 2});
    assert.equal(pollution.value, 30);
});

test('an unknown building changes neither Credits nor pollution', () => {
    const economy = new Economy({credits: 500, ap: 2});
    const pollution = new Pollution(7);
    const buildings = [...b('powerPlant'), {id: 'x', type: 'tower'}];
    assert.throws(() => settleNight({day: 1, buildings, economy, pollution}), TypeError);
    assert.deepEqual(economy.snapshot(), {credits: 500, ap: 2});
    assert.deepEqual(pollution.snapshot(), {value: 7});
});

test('pollution may land exactly on the safe limit; one past it changes nothing', () => {
    const buildings = b('powerPlant'); // +12 pollution, net 0
    const fits = new Pollution(MAX - 12);
    assert.equal(settleNight({day: 1, buildings, economy: new Economy(), pollution: fits}).pollution.after, MAX);

    const economy = new Economy({credits: 500, ap: 2});
    const overflows = new Pollution(MAX - 11);
    assert.throws(() => settleNight({day: 1, buildings, economy, pollution: overflows}), RangeError);
    assert.deepEqual(economy.snapshot(), {credits: 500, ap: 2});
    assert.equal(overflows.value, MAX - 11);
});

test('Credits may land exactly on the safe limit; one past it changes nothing', () => {
    const buildings = [...b('powerPlant'), ...b('factory')]; // net +150, +20 pollution
    const fits = new Economy({credits: MAX - 150, ap: 2});
    assert.equal(settleNight({day: 1, buildings, economy: fits, pollution: new Pollution()}).creditsAfter, MAX);

    const economy = new Economy({credits: MAX - 149, ap: 2});
    const pollution = new Pollution(3);
    assert.throws(() => settleNight({day: 1, buildings, economy, pollution}), RangeError);
    assert.deepEqual(economy.snapshot(), {credits: MAX - 149, ap: 2});
    assert.deepEqual(pollution.snapshot(), {value: 3}); // not committed first and left behind
});

test('Credits below the negative safe limit are rejected with no partial change', () => {
    const economy = new Economy({credits: 0, ap: 2});
    economy.adjustCredits(-MAX + 20); // exactly reaches -MAX after one Outpost
    const fits = new Pollution();
    assert.equal(settleNight({day: 1, buildings: b('outpost'), economy, pollution: fits}).creditsAfter, -MAX);

    const pollution = new Pollution(3);
    assert.throws(() => settleNight({day: 2, buildings: [...b('outpost'), ...b('powerPlant')], economy, pollution}), RangeError);
    assert.equal(economy.credits, -MAX);
    assert.equal(pollution.value, 3);
});

test('an already unsafe Credits balance is rejected, even with zero net', () => {
    const start = 2 ** 60; // the Economy constructor allows this today
    const economy = new Economy({credits: start, ap: 2});
    const pollution = new Pollution(3);
    assert.throws(() => settleNight({day: 1, buildings: [], economy, pollution}), RangeError);
    assert.equal(economy.credits, start);
    assert.equal(pollution.value, 3);
});

test('settlement leaves AP, buildings and enabled flags alone', () => {
    const economy = new Economy({credits: 100, ap: 3});
    const buildings = [...b('powerPlant'), ...b('factory', 1, {enabled: false})];
    const before = structuredClone(buildings);
    settleNight({day: 1, buildings, economy, pollution: new Pollution()});
    assert.equal(economy.ap, 3);
    assert.deepEqual(buildings, before);
});

// ---- Integration with ShiftCycle --------------------------------------------------

function world({credits = 1000, ap = 5} = {}) {
    const clock = new SimulationClock();
    const economy = new Economy({credits, ap});
    const pollution = new Pollution();
    const grid = new Grid({cols: 24, rows: 16, tileSize: 32});
    let cycle;
    const placement = new BuildingPlacement(grid, economy, {isConstructionAllowed: () => cycle.isConstructionAllowed});
    cycle = new ShiftCycle({
        clock,
        economy,
        settleNight: (day) => settleNight({day, buildings: placement.buildings(), economy, pollution}),
    });
    const onTick = (t) => cycle.onTick(t);
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
    cycle.begin();
    return {clock, economy, pollution, grid, placement, cycle, step, frames, onTick};
}

function build(w, type, col, row) {
    w.placement.select(type);
    const r = w.placement.placeAt({col, row});
    assert.equal(r.ok, true, `${type} at ${col},${row}`);
    w.placement.cancel();
}

/** Plant + Factory: exactly 900 Credits, emits 20 per night while powered. */
function poweredBase(w) {
    build(w, 'powerPlant', 3, 3);
    build(w, 'factory', 8, 3);
}

test('nothing is emitted at tick 3599; the 3600th tick emits once', () => {
    const w = world();
    poweredBase(w);
    w.cycle.endDay();
    assert.equal(w.step(3599), 3599);
    assert.equal(w.cycle.shift, Shift.NIGHT);
    assert.equal(w.pollution.value, 0);
    w.step(1);
    assert.equal(w.cycle.shift, Shift.DAY);
    assert.equal(w.pollution.value, 20);
    assert.equal(w.cycle.lastSettlement.pollution.emitted, 20);
});

test('Day Shift, paused nights and rejected transitions add no pollution', () => {
    const w = world();
    poweredBase(w);
    for (let i = 0; i < 10; i++) w.onTick(i); // ignored during Day
    w.frames(600);
    assert.equal(w.step(10), 0);
    assert.equal(w.pollution.value, 0);

    assert.equal(w.cycle.endDay().ok, true);
    assert.equal(w.cycle.endDay().ok, false); // rejected: already Night
    w.step(100);
    w.clock.pause();
    w.frames(600);
    assert.equal(w.cycle.elapsedNightTicks, 100);
    assert.equal(w.pollution.value, 0);
    assert.equal(w.cycle.lastSettlement, null);
});

test('a rejected placement adds no pollution or emissions', () => {
    const w = world({credits: 400});
    build(w, 'factory', 3, 3);
    w.placement.select('powerPlant'); // now unaffordable
    assert.equal(w.placement.placeAt({col: 12, row: 3}).ok, false);
    assert.equal(calculateEmissions(w.placement.buildings()), 0);
    assert.equal(w.pollution.value, 0);
});

test('pollution updates once per night and crosses threat levels over several nights', () => {
    const w = world();
    poweredBase(w);
    const seen = [];
    for (let night = 1; night <= 6; night++) {
        w.cycle.endDay();
        w.step(3600);
        const {pollution} = w.cycle.lastSettlement;
        seen.push([pollution.before, pollution.after, pollution.threatLevel]);
        w.frames(120); // the following Day adds nothing
        assert.equal(w.pollution.value, night * 20);
    }
    assert.deepEqual(seen, [[0, 20, 1], [20, 40, 2], [40, 60, 3], [60, 80, 3], [80, 100, 4], [100, 120, 4]]);
});

test('emissions use the power state at the end of the night', () => {
    const w = world();
    poweredBase(w);
    const [plant, factory] = w.placement.buildings();

    w.cycle.endDay();
    w.step(3000);
    w.placement.setEnabled(factory.id, false); // off for the final ticks
    w.step(600);
    assert.equal(w.cycle.lastSettlement.pollution.emitted, 12);
    assert.equal(w.cycle.lastSettlement.gross, 0);

    w.placement.setEnabled(factory.id, true);
    w.placement.setEnabled(plant.id, false); // Factory is now in blackout too
    w.cycle.endDay();
    w.step(3600);
    assert.equal(w.cycle.lastSettlement.pollution.emitted, 0);
    assert.equal(w.pollution.value, 12);
});

test('pollution does not change power state, the grid or building records', () => {
    const w = world();
    poweredBase(w);
    const grid = w.grid.snapshot();
    const buildings = w.placement.buildings();
    w.cycle.endDay();
    w.step(3600);
    assert.deepEqual(w.grid.snapshot(), grid);
    assert.deepEqual(w.placement.buildings(), buildings);
});

test('frame-driven and manual completion produce identical pollution', () => {
    const run = (advance) => {
        const w = world();
        poweredBase(w);
        for (let night = 0; night < 3; night++) {
            w.cycle.endDay();
            advance(w);
        }
        return {pollution: w.pollution.snapshot(), report: w.cycle.lastSettlement, economy: w.economy.snapshot()};
    };
    const viaSteps = run((w) => w.step(3600));
    const viaFrames = run((w) => { while (w.cycle.shift === Shift.NIGHT) w.frames(1); });
    const viaUnevenFrames = run((w) => {
        for (let i = 0; w.cycle.shift === Shift.NIGHT; i++) w.frames(1, i % 2 ? 7 : 90);
    });
    assert.deepEqual(viaFrames, viaSteps);
    assert.deepEqual(viaUnevenFrames, viaSteps);
    assert.equal(viaSteps.pollution.value, 60);
});

/** A cycle whose final tick is reached with `hook`, one tick short of the end. */
function atFinalTick(hook, economy) {
    const clock = new SimulationClock();
    const cycle = new ShiftCycle({clock, economy, settleNight: hook});
    const onTick = (t) => cycle.onTick(t);
    cycle.begin();
    cycle.endDay();
    let done = 0;
    while (done < 3599) done += cycle.stepTicks(Math.min(240, 3599 - done), onTick);
    return {clock, cycle, onTick};
}

test('a failed Pollution.add then a successful retry: no double charge, one report', () => {
    class FlakyPollution extends Pollution {
        failures = 1;
        addCalls = 0;
        add(amount) {
            this.addCalls++;
            if (this.failures-- > 0) throw new Error('add failed');
            super.add(amount);
        }
    }
    const economy = new Economy({credits: 500, ap: 2});
    const pollution = new FlakyPollution();
    const buildings = [...b('powerPlant'), ...b('factory')]; // net +150, +20 pollution
    const reports = [];
    const {clock, cycle, onTick} = atFinalTick((day) => {
        const report = settleNight({day, buildings, economy, pollution});
        reports.push(report);
        return report;
    }, economy);

    assert.throws(() => cycle.stepTicks(1, onTick), /add failed/);
    assert.deepEqual(cycle.snapshot(), {day: 1, shift: Shift.NIGHT, elapsedNightTicks: 3599, remainingNightTicks: 1});
    assert.equal(clock.tick, 3599);
    assert.equal(cycle.lastSettlement, null);
    assert.equal(reports.length, 0);
    assert.deepEqual(economy.snapshot(), {credits: 500, ap: 2});
    assert.equal(pollution.value, 0);

    assert.equal(cycle.stepTicks(1, onTick), 1);
    assert.equal(cycle.shift, Shift.DAY);
    assert.equal(cycle.day, 2);
    assert.equal(pollution.addCalls, 2);
    assert.equal(reports.length, 1);
    assert.equal(cycle.lastSettlement, reports[0]);
    assert.deepEqual(economy.snapshot(), {credits: 650, ap: 5}); // charged once
    assert.equal(pollution.value, 20); // emitted once
    assert.deepEqual(reports[0].pollution, {before: 0, emitted: 20, after: 20, threatLevel: 1});
    assert.equal(reports[0].creditsBefore, 500);
});

test('a real overflow rejected by validation can be retried with no partial change', () => {
    const economy = new Economy({credits: 500, ap: 2});
    const full = new Pollution(MAX);
    const pollution = new Pollution(5);
    let current = full;
    const buildings = b('powerPlant');
    const {cycle, onTick} = atFinalTick((day) => settleNight({day, buildings, economy, pollution: current}), economy);

    assert.throws(() => cycle.stepTicks(1, onTick), RangeError);
    assert.equal(cycle.shift, Shift.NIGHT);
    assert.equal(cycle.lastSettlement, null);
    assert.deepEqual(economy.snapshot(), {credits: 500, ap: 2});
    assert.equal(full.value, MAX);

    current = pollution;
    assert.equal(cycle.stepTicks(1, onTick), 1);
    assert.equal(cycle.shift, Shift.DAY);
    assert.equal(pollution.value, 17);
    assert.equal(full.value, MAX);
    assert.deepEqual(economy.snapshot(), {credits: 500, ap: 5});
});
