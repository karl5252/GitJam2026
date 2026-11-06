import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateSettlement, settleNight} from '../../src/core/settlement.js';
import {Economy, EconomyFailure} from '../../src/core/economy.js';
import {Pollution} from '../../src/core/pollution.js';
import {SimulationClock} from '../../src/core/simulationClock.js';
import {ShiftCycle, Shift} from '../../src/core/shiftCycle.js';
import {Grid} from '../../src/core/grid.js';
import {BuildingPlacement} from '../../src/core/buildingPlacement.js';

const b = (type, n = 1, extra = {}) => Array.from({length: n}, (_, i) => ({id: `${type}-${i + 1}`, type, enabled: true, ...extra}));
const ZERO_COUNTS = {hq: 0, outpost: 0, factory: 0, powerPlant: 0, autocannon: 0, siegeCannon: 0, barracks: 0, wall: 0, gateVertical: 0, gateHorizontal: 0};
const counts = (c) => ({...ZERO_COUNTS, ...c});

// ---- calculateSettlement --------------------------------------------------------

test('empty settlement is all zeros (power 0 / 0, normal)', () => {
    assert.deepEqual(calculateSettlement([]), {
        gross: 0, upkeep: 0, net: 0, counts: ZERO_COUNTS,
        power: {generation: 0, demand: 0, status: 'normal'},
    });
});

test('a powered Factory adds nothing at settlement: it earns by delivery', () => {
    assert.deepEqual(calculateSettlement([...b('powerPlant'), ...b('factory')]), {
        gross: 0, upkeep: 0, net: 0, counts: counts({factory: 1, powerPlant: 1}),
        power: {generation: 100, demand: 40, status: 'normal'},
    });
});

test('an unpowered factory earns 0 (blackout without a plant)', () => {
    assert.deepEqual(calculateSettlement(b('factory')), {
        gross: 0, upkeep: 0, net: 0, counts: counts({factory: 1}),
        power: {generation: 0, demand: 40, status: 'blackout'},
    });
});

test('a disabled factory earns 0 even with spare power', () => {
    const r = calculateSettlement([...b('powerPlant'), ...b('factory', 1, {enabled: false})]);
    assert.equal(r.gross, 0);
    assert.deepEqual(r.power, {generation: 100, demand: 0, status: 'normal'});
});

test('a factory earns 0 when its plant is disabled', () => {
    const r = calculateSettlement([...b('powerPlant', 1, {enabled: false}), ...b('factory')]);
    assert.equal(r.gross, 0);
    assert.deepEqual(r.power, {generation: 0, demand: 40, status: 'blackout'});
});

test('an Outpost costs nothing to keep, whatever its power or enabled state', () => {
    const cases = [
        b('outpost'), // blackout
        [...b('powerPlant'), ...b('outpost')], // powered
        b('outpost', 1, {enabled: false}), // disabled
        [...b('powerPlant', 1, {enabled: false}), ...b('outpost')], // plant off
    ];
    for (const buildings of cases) {
        const r = calculateSettlement(buildings);
        assert.equal(r.upkeep, 0, JSON.stringify(buildings));
        assert.equal(r.net, 0);
    }
});

test('mixed combinations sum exactly', () => {
    // 2 plants (200) vs 2 factories + 3 outposts (110): normal.
    assert.deepEqual(calculateSettlement([...b('powerPlant', 2), ...b('factory', 2), ...b('outpost', 3)]), {
        gross: 0, upkeep: 0, net: 0, counts: counts({outpost: 3, factory: 2, powerPlant: 2}),
        power: {generation: 200, demand: 110, status: 'normal'},
    });
    // Same buildings with 1 plant (100 < 110): low power stops every factory.
    assert.deepEqual(calculateSettlement([...b('powerPlant'), ...b('factory', 2), ...b('outpost', 3)]), {
        gross: 0, upkeep: 0, net: 0, counts: counts({outpost: 3, factory: 2, powerPlant: 1}),
        power: {generation: 100, demand: 110, status: 'low-power'},
    });
    assert.equal(calculateSettlement([...b('powerPlant'), ...b('factory'), ...b('outpost')]).net, 0);
});

test('result is integer-only', () => {
    const r = calculateSettlement([...b('powerPlant', 5), ...b('factory', 7), ...b('outpost', 11)]);
    for (const v of [r.gross, r.upkeep, r.net, r.power.generation, r.power.demand]) assert.ok(Number.isInteger(v));
});

test('calculation is pure and deterministic; input is not mutated', () => {
    const input = [...b('powerPlant'), ...b('factory', 2), ...b('outpost', 1, {enabled: false})];
    const copy = structuredClone(input);
    assert.deepEqual(calculateSettlement(input), calculateSettlement(input));
    assert.deepEqual(input, copy);
});

test('unknown building types and malformed input throw', () => {
    assert.throws(() => calculateSettlement([{id: 'x', type: 'tower'}]), TypeError);
    assert.throws(() => calculateSettlement([null]), TypeError);
    assert.throws(() => calculateSettlement([{id: 'x'}]), TypeError);
    assert.throws(() => calculateSettlement('factory'), TypeError);
    assert.throws(() => calculateSettlement(undefined), TypeError);
});

// ---- settleNight ------------------------------------------------------------------

test('settleNight applies net once and returns an exact report', () => {
    const economy = new Economy({credits: 0, ap: 2});
    const report = settleNight({day: 1, buildings: [...b('powerPlant'), ...b('factory'), ...b('outpost')], economy, pollution: new Pollution()});
    assert.deepEqual(report, {
        day: 1, gross: 0, upkeep: 0, net: 0, creditsBefore: 0, creditsAfter: 0,
        counts: counts({outpost: 1, factory: 1, powerPlant: 1}),
        power: {generation: 100, demand: 50, status: 'normal'},
        pollution: {before: 0, emitted: 20, after: 20, threatLevel: 1},
    });
    assert.deepEqual(economy.snapshot(), {credits: 0, ap: 2}); // AP untouched
});

test('settleNight without power: factory idle, and nothing is charged', () => {
    const economy = new Economy({credits: 500, ap: 3});
    const report = settleNight({day: 1, buildings: [...b('factory'), ...b('outpost')], economy, pollution: new Pollution()});
    assert.deepEqual(report, {
        day: 1, gross: 0, upkeep: 0, net: 0, creditsBefore: 500, creditsAfter: 500,
        counts: counts({outpost: 1, factory: 1}),
        power: {generation: 0, demand: 50, status: 'blackout'},
        pollution: {before: 0, emitted: 0, after: 0, threatLevel: 1},
    });
});

test('settleNight with no buildings still reports a zero night', () => {
    const economy = new Economy({credits: 1000, ap: 5});
    const report = settleNight({day: 4, buildings: [], economy, pollution: new Pollution()});
    assert.deepEqual(report, {
        day: 4, gross: 0, upkeep: 0, net: 0, creditsBefore: 1000, creditsAfter: 1000, counts: ZERO_COUNTS,
        power: {generation: 0, demand: 0, status: 'normal'},
        pollution: {before: 0, emitted: 0, after: 0, threatLevel: 1},
    });
    assert.deepEqual(economy.snapshot(), {credits: 1000, ap: 5});
});

test('reports are frozen and detached from domain state', () => {
    const economy = new Economy({credits: 1000, ap: 5});
    const buildings = [...b('powerPlant'), ...b('factory')];
    const report = settleNight({day: 1, buildings, economy, pollution: new Pollution()});
    assert.ok(Object.isFrozen(report));
    assert.ok(Object.isFrozen(report.counts));
    assert.ok(Object.isFrozen(report.power));
    assert.ok(Object.isFrozen(report.pollution));
    assert.throws(() => { report.net = 0; }, TypeError);
    assert.throws(() => { report.counts.factory = 9; }, TypeError);
    assert.throws(() => { report.power.status = 'x'; }, TypeError);
    buildings.push(...b('factory', 3));
    buildings[0].enabled = false;
    economy.adjustCredits(-5000);
    assert.equal(report.creditsAfter, 1000);
    assert.equal(report.counts.factory, 1);
    assert.equal(report.power.generation, 100);
});

test('a night of Outposts leaves a debt exactly as it was', () => {
    const economy = new Economy({credits: 30, ap: 5});
    economy.adjustCredits(-60);
    const report = settleNight({day: 2, buildings: b('outpost', 3), economy, pollution: new Pollution()});
    assert.equal(report.net, 0);
    assert.equal(report.creditsAfter, -30);
    assert.deepEqual(economy.snapshot(), {credits: -30, ap: 5});
});

test('invalid settlement data changes nothing', () => {
    const economy = new Economy({credits: 500, ap: 2});
    assert.throws(() => settleNight({day: 1, buildings: [...b('factory'), {id: 'x', type: 'tower'}], economy, pollution: new Pollution()}), TypeError);
    assert.throws(() => settleNight({day: 0, buildings: b('factory'), economy, pollution: new Pollution()}), RangeError);
    assert.throws(() => settleNight({day: 1.5, buildings: [], economy, pollution: new Pollution()}), RangeError);
    assert.deepEqual(economy.snapshot(), {credits: 500, ap: 2});
});

// ---- Debt and affordability ------------------------------------------------------

test('in debt, every purchase is rejected by the unchanged affordability rule', () => {
    const grid = new Grid({cols: 24, rows: 16, tileSize: 32});
    const economy = new Economy({credits: 0, ap: 5});
    economy.adjustCredits(-40);
    const placement = new BuildingPlacement(grid, economy);
    placement.select('outpost');
    assert.deepEqual(placement.placeAt({col: 2, row: 2}), {ok: false, reason: EconomyFailure.INSUFFICIENT_CREDITS});
    assert.deepEqual(economy.snapshot(), {credits: -40, ap: 5});
    assert.deepEqual(grid.snapshot().occupants, []);
    // Paying the debt back restores purchasing power exactly at the threshold.
    economy.adjustCredits(140);
    assert.equal(placement.placeAt({col: 2, row: 2}).ok, true);
    assert.deepEqual(economy.snapshot(), {credits: 0, ap: 4});
});

// ---- Integration with ShiftCycle --------------------------------------------------

function world({credits = 1000, ap = 5} = {}) {
    const clock = new SimulationClock();
    const economy = new Economy({credits, ap});
    const grid = new Grid({cols: 24, rows: 16, tileSize: 32});
    let cycle;
    const placement = new BuildingPlacement(grid, economy, {isConstructionAllowed: () => cycle.isConstructionAllowed});
    const pollution = new Pollution();
    const calls = [];
    cycle = new ShiftCycle({
        clock,
        economy,
        settleNight: (day) => {
            calls.push(day);
            return settleNight({day, buildings: placement.buildings(), economy, pollution});
        },
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
    return {clock, economy, pollution, grid, placement, cycle, calls, step, frames, onTick};
}

function build(w, type, col, row) {
    w.placement.select(type);
    const r = w.placement.placeAt({col, row});
    assert.equal(r.ok, true, `${type} at ${col},${row}`);
    w.placement.cancel();
}

test('an incomplete night does not settle', () => {
    const w = world();
    build(w, 'factory', 5, 5);
    w.cycle.endDay();
    w.step(3599);
    assert.deepEqual(w.calls, []);
    assert.equal(w.cycle.lastSettlement, null);
    assert.equal(w.economy.credits, 600);
    // A paused clock does not complete the night either.
    w.clock.pause();
    w.frames(600);
    assert.deepEqual(w.calls, []);
});

test('settlement happens exactly once, at the end of night tick 3600', () => {
    const w = world();
    build(w, 'powerPlant', 15, 5);
    build(w, 'factory', 5, 5);
    build(w, 'outpost', 12, 3);
    assert.deepEqual(w.economy.snapshot(), {credits: 0, ap: 2});
    w.cycle.endDay();
    w.step(3599);
    assert.equal(w.economy.credits, 0);
    w.step(1);
    assert.deepEqual(w.calls, [1]);
    assert.deepEqual(w.cycle.lastSettlement, {
        day: 1, gross: 0, upkeep: 0, net: 0, creditsBefore: 0, creditsAfter: 0,
        counts: counts({outpost: 1, factory: 1, powerPlant: 1}),
        power: {generation: 100, demand: 50, status: 'normal'},
        pollution: {before: 0, emitted: 20, after: 20, threatLevel: 1},
    });
    assert.deepEqual(w.economy.snapshot(), {credits: 0, ap: 5}); // AP restored to exactly 5
    assert.equal(w.cycle.shift, Shift.DAY);
    assert.equal(w.cycle.day, 2);

    // Further callbacks, frames, resume and manual steps during Day settle nothing more.
    for (let i = 0; i < 10; i++) w.onTick(3600 + i);
    w.frames(600);
    w.cycle.resume();
    w.frames(60);
    assert.equal(w.step(240), 0);
    assert.deepEqual(w.calls, [1]);
    assert.equal(w.economy.credits, 0);
});

test('frame-driven and manual completion settle identically', () => {
    const viaFrames = world();
    const viaSteps = world();
    for (const w of [viaFrames, viaSteps]) {
        build(w, 'powerPlant', 15, 5);
        build(w, 'factory', 5, 5);
        w.cycle.endDay();
    }
    viaFrames.frames(5000, 100); // far more than a night, capped frames
    viaSteps.step(3600);
    assert.deepEqual(viaFrames.calls, [1]);
    assert.deepEqual(viaSteps.calls, [1]);
    assert.deepEqual(viaFrames.cycle.lastSettlement, viaSteps.cycle.lastSettlement);
    assert.equal(viaFrames.cycle.lastSettlement.pollution.emitted, 20);
    assert.equal(viaFrames.clock.tick, 3600);
});

test('settlement does not consume AP and AP is set to exactly 5, not +5', () => {
    const w = world({credits: 1000, ap: 5});
    build(w, 'outpost', 1, 1); // AP 4
    w.cycle.endDay();
    w.step(3600);
    assert.equal(w.economy.ap, 5);
    // Unspent AP does not accumulate.
    w.cycle.endDay();
    w.step(3600);
    assert.equal(w.economy.ap, 5);
});

test('buildings and grid occupancy are unchanged by settlement', () => {
    const w = world();
    build(w, 'factory', 5, 5);
    build(w, 'outpost', 20, 10);
    const grid = w.grid.snapshot();
    const buildings = w.placement.buildings();
    w.cycle.endDay();
    w.step(3600);
    assert.deepEqual(w.grid.snapshot(), grid);
    assert.deepEqual(w.placement.buildings(), buildings);
});

test('consecutive nights settle once each; Credits persist between them', () => {
    const w = world();
    build(w, 'powerPlant', 15, 5);
    build(w, 'factory', 5, 5);
    build(w, 'outpost', 12, 3);
    w.economy.adjustCredits(75);
    const reports = [];
    for (let i = 0; i < 3; i++) {
        w.cycle.endDay();
        w.step(3600);
        reports.push(w.cycle.lastSettlement);
    }
    assert.deepEqual(w.calls, [1, 2, 3]);
    assert.deepEqual(reports.map((r) => [r.day, r.creditsBefore, r.creditsAfter]), [[1, 75, 75], [2, 75, 75], [3, 75, 75]]);
    assert.equal(w.economy.credits, 75);
    assert.equal(w.cycle.day, 4);
});

test('a night with zero buildings still produces a zero report', () => {
    const w = world();
    w.cycle.endDay();
    w.step(3600);
    assert.deepEqual(w.cycle.lastSettlement, {
        day: 1, gross: 0, upkeep: 0, net: 0, creditsBefore: 1000, creditsAfter: 1000, counts: ZERO_COUNTS,
        power: {generation: 0, demand: 0, status: 'normal'},
        pollution: {before: 0, emitted: 0, after: 0, threatLevel: 1},
    });
});

// ---- Power toggling and settlement ------------------------------------------------

test('settlement uses the power state at the end of the night; toggles persist across shifts', () => {
    const w = world();
    build(w, 'powerPlant', 15, 5);
    build(w, 'factory', 5, 5);
    const plant = w.placement.buildings()[0].id;

    // Night 1: plant switched OFF during Day -> blackout, factory idle.
    assert.equal(w.placement.setEnabled(plant, false).ok, true);
    w.cycle.endDay();
    w.step(3600);
    assert.deepEqual(w.cycle.lastSettlement.power, {generation: 0, demand: 40, status: 'blackout'});
    assert.equal(w.cycle.lastSettlement.gross, 0);
    assert.equal(w.placement.buildings()[0].enabled, false); // persisted into Day 2

    // Night 2: plant switched back ON during the NIGHT -> powered at settlement.
    w.cycle.endDay();
    w.step(1800);
    assert.equal(w.placement.setEnabled(plant, true).ok, true);
    w.step(1800);
    assert.equal(w.cycle.lastSettlement.pollution.emitted, 20); // Plant and Factory, both on at the end
    assert.equal(w.cycle.lastSettlement.power.status, 'normal');
    assert.equal(w.placement.buildings()[0].enabled, true);
});

test('debt lasts across nights and blocks purchases until repaid', () => {
    const w = world({credits: 300, ap: 5});
    for (let i = 0; i < 3; i++) build(w, 'outpost', i * 2, 0); // 0 credits left
    w.economy.adjustCredits(-60);
    w.cycle.endDay();
    w.step(3600);
    assert.equal(w.economy.credits, -60);
    w.placement.select('outpost');
    assert.equal(w.placement.placeAt({col: 10, row: 10}).reason, EconomyFailure.INSUFFICIENT_CREDITS);
    w.placement.cancel();
    w.cycle.endDay();
    w.step(3600);
    assert.equal(w.cycle.lastSettlement.creditsBefore, -60);
    assert.equal(w.economy.credits, -60);
});

test('a throwing settlement hook changes nothing; the final tick is retried', () => {
    const clock = new SimulationClock();
    const economy = new Economy({credits: 500, ap: 2});
    let fail = true;
    const cycle = new ShiftCycle({
        clock,
        economy,
        settleNight: (day) => {
            if (fail) {
                // Invalid data: settleNight rejects before mutating the economy.
                return settleNight({day, buildings: [{id: 'x', type: 'tower'}], economy, pollution: new Pollution()});
            }
            return settleNight({day, buildings: [], economy, pollution: new Pollution()});
        },
    });
    const onTick = (t) => cycle.onTick(t);
    cycle.begin();
    cycle.endDay();
    clock.stepTicks(240, onTick);
    for (let i = 0; i < 14; i++) clock.stepTicks(Math.min(240, 3599 - clock.tick), onTick);
    assert.equal(clock.tick, 3599);

    assert.throws(() => cycle.stepTicks(1, onTick), TypeError);
    assert.deepEqual(cycle.snapshot(), {day: 1, shift: Shift.NIGHT, elapsedNightTicks: 3599, remainingNightTicks: 1});
    assert.equal(clock.tick, 3599); // the failed tick did not count
    assert.equal(clock.paused, false);
    assert.equal(cycle.lastSettlement, null);
    assert.deepEqual(economy.snapshot(), {credits: 500, ap: 2}); // AP not restored, credits untouched

    fail = false;
    assert.equal(cycle.stepTicks(1, onTick), 1);
    assert.equal(clock.tick, 3600);
    assert.equal(cycle.shift, Shift.DAY);
    assert.equal(cycle.lastSettlement.day, 1);
    assert.deepEqual(economy.snapshot(), {credits: 500, ap: 5});
});
