import test from 'node:test';
import assert from 'node:assert/strict';
import {createSetDay} from '../../src/testShadow/dayQa.js';
import {Economy} from '../../src/core/economy.js';
import {Shift, ShiftCycle, ShiftFailure} from '../../src/core/shiftCycle.js';
import {SimulationClock} from '../../src/core/simulationClock.js';
import {nightPlan} from '../../src/core/waves.js';
import {createWorld} from '../soak/harness.js';

/** The QA helper over a real cycle, with a stand-in for the scene's UI refresh. */
function fixture({pollution = 0, schedule = null} = {}) {
    const w = createWorld({resources: {credits: 5000, ap: 40}, requireHq: true, roads: true, pollution, schedule});
    assert.equal(w.place('hq', 12, 8).ok, true);
    const scene = {cycle: w.cycle, refreshes: 0, syncShiftUi() { this.refreshes++; }};
    return {w, scene, setDay: createSetDay(scene)};
}

const finishNight = (w) => {
    while (w.cycle.shift === Shift.NIGHT) w.cycle.stepTicks(240, w.tick);
};

test('it moves the real day and refreshes the UI', () => {
    const {w, scene, setDay} = fixture();
    assert.equal(setDay(30), 30);
    assert.equal(w.cycle.day, 30);
    assert.equal(w.cycle.snapshot().day, 30);
    assert.equal(w.cycle.shift, Shift.DAY);
    assert.equal(scene.refreshes, 1);
    assert.equal(setDay(3), 3, 'the calendar can go back too');
    assert.equal(w.cycle.day, 3);
});

test('it changes nothing but the day', () => {
    const {w, setDay} = fixture({pollution: 37});
    assert.equal(w.place('powerPlant', 20, 3).ok, true);
    assert.equal(w.place('barracks', 16, 8).ok, true);
    assert.equal(w.place('wall', 3, 3).ok, true);
    const barracks = w.placement.barracks()[0].id;
    assert.equal(w.placement.setFlag(barracks, {col: 20, row: 12}).ok, true);
    w.placement.damageBuilding(w.placement.buildings()[1].id, 40);
    assert.equal(w.placement.setEnabled(w.placement.buildings()[1].id, false).ok, true);
    const state = () => ({
        buildings: w.placement.buildings(),
        revision: w.placement.revision,
        grid: w.grid.snapshot(),
        roads: w.roads.snapshot(),
        economy: w.economy.snapshot(),
        pollution: w.pollution.snapshot(),
        rng: w.rng.snapshot(),
        clock: w.clock.snapshot(),
        settlement: w.cycle.lastSettlement,
        mutants: w.mutants.snapshot(),
        logistics: w.logistics.snapshot(),
        infantry: w.infantry.snapshot(),
    });
    const before = state();
    setDay(25);
    assert.deepEqual(state(), before);
});

test('skipped Nights did not happen: no income, emissions, settlement, ticks or spawns', () => {
    const {w, setDay} = fixture();
    assert.equal(w.place('powerPlant', 20, 3).ok, true);
    const {credits} = w.economy.snapshot();
    setDay(40);
    assert.deepEqual([w.economy.credits, w.pollution.value, w.cycle.lastSettlement, w.clock.tick], [credits, 0, null, 0]);
    assert.deepEqual(w.mutants.snapshot(), []);
    assert.equal(w.mutants.plan(), null);
});

test('the next Night is planned for the selected day, from the real base and pollution', () => {
    for (const day of [5, 12, 30, 35, 40]) {
        const {w, setDay} = fixture({pollution: 60});
        assert.equal(w.place('autocannon', 12, 5).ok, true);
        setDay(day);
        w.cycle.endDay();
        w.cycle.stepTicks(1, w.tick);
        const plan = w.mutants.plan();
        assert.deepEqual(plan, nightPlan({day, pollution: 60, buildings: w.placement.buildings()}));
        assert.equal(plan.day, day);
    }
});

test('a late day really brings its wave: Spitters and a Brute on Night 30', () => {
    const {w, setDay} = fixture();
    setDay(30);
    w.cycle.endDay();
    const kinds = {brute: 0, spitter: 0, ordinary: 0};
    while (w.cycle.shift === Shift.NIGHT) {
        w.cycle.stepTicks(1, (t) => {
            const {effects} = w.tick(t);
            for (const id of effects.spawned) kinds[w.mutants.snapshot().find((m) => m.id === id).kind ?? 'ordinary']++;
        });
    }
    assert.deepEqual(kinds, {brute: 1, spitter: 6, ordinary: 31});
});

test('the plan of the Night just played does not linger: a jump after it sets the next one', () => {
    const {w, setDay} = fixture();
    w.cycle.endDay();
    finishNight(w);
    assert.equal(w.cycle.day, 2);
    assert.equal(w.mutants.plan(), null);
    setDay(35);
    w.cycle.endDay();
    w.cycle.stepTicks(1, w.tick);
    assert.deepEqual([w.mutants.plan().day, w.mutants.plan().brutes], [35, 2]);
});

test('time carries on from the selected day, and settlement reports it', () => {
    const {w, setDay} = fixture({schedule: []});
    setDay(30);
    w.cycle.endDay();
    finishNight(w);
    assert.deepEqual([w.cycle.day, w.cycle.shift, w.cycle.lastSettlement.day], [31, Shift.DAY, 30]);
});

test('it works only during Day, and a refusal changes nothing', () => {
    const {w, scene, setDay} = fixture();
    w.cycle.endDay();
    assert.throws(() => setDay(9), /Day Shift only: not-day/);
    assert.deepEqual([w.cycle.day, w.cycle.shift, scene.refreshes], [1, Shift.NIGHT, 0]);
    assert.deepEqual(w.cycle.jumpToDay(9), {ok: false, reason: ShiftFailure.NOT_DAY});
    w.cycle.stepTicks(1, w.tick);
    assert.equal(w.mutants.plan().day, 1, 'tonight is not replanned');
});

test('it is refused after a defeat', () => {
    const {w, setDay} = fixture();
    w.cycle.endDay();
    w.cycle.stepTicks(1, w.tick);
    w.cycle.defeat();
    assert.throws(() => setDay(9), /Day Shift only/);
    assert.equal(w.cycle.day, 1);
});

test('it is refused before Start', () => {
    assert.throws(() => createSetDay({cycle: null, syncShiftUi() {}})(5), /after Start/);
    const economy = new Economy({credits: 0, ap: 0});
    const cycle = new ShiftCycle({clock: new SimulationClock(), economy});
    assert.deepEqual(cycle.jumpToDay(5), {ok: false, reason: ShiftFailure.NOT_STARTED});
    assert.equal(cycle.day, 0);
});

test('anything but a positive integer is refused, and changes nothing', () => {
    const {w, scene, setDay} = fixture();
    for (const bad of [0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '30', null, undefined, {}]) {
        assert.throws(() => setDay(bad), RangeError, String(bad));
        assert.throws(() => w.cycle.jumpToDay(bad), RangeError, String(bad));
    }
    assert.deepEqual([w.cycle.day, scene.refreshes], [1, 0]);
});
