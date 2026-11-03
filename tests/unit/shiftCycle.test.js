import test from 'node:test';
import assert from 'node:assert/strict';
import {ShiftCycle, Shift, ShiftFailure, NIGHT_TICKS, DAY_AP} from '../../src/core/shiftCycle.js';
import {SimulationClock} from '../../src/core/simulationClock.js';
import {Economy} from '../../src/core/economy.js';
import {Grid, PlacementFailure} from '../../src/core/grid.js';
import {BuildingPlacement, CONSTRUCTION_DISABLED} from '../../src/core/buildingPlacement.js';

const FRAME = 1000 / 60;

function setup() {
    const clock = new SimulationClock();
    const economy = new Economy();
    const cycle = new ShiftCycle({clock, economy});
    const grid = new Grid({cols: 24, rows: 16, tileSize: 32, originX: 256, originY: 104});
    const placement = new BuildingPlacement(grid, economy, {isConstructionAllowed: () => cycle.isConstructionAllowed});
    let callbacks = 0;
    const onTick = (tick) => {
        callbacks++;
        cycle.onTick(tick);
    };
    /** Real-time path: feed frames through clock.advance with the cycle callback. */
    const frames = (n, delta = FRAME) => {
        let steps = 0;
        for (let i = 0; i < n; i++) steps += clock.advance(delta, onTick);
        return steps;
    };
    /** Manual path: step `total` ticks via the cycle in 240-tick chunks. */
    const step = (total) => {
        let done = 0;
        while (done < total) {
            const n = cycle.stepTicks(Math.min(240, total - done), onTick);
            if (n === 0) break;
            done += n;
        }
        return done;
    };
    return {clock, economy, cycle, grid, placement, frames, step, callbacks: () => callbacks};
}

const fullState = ({grid, economy, placement}) => JSON.stringify({
    grid: grid.snapshot(), economy: economy.snapshot(), buildings: placement.buildings(),
});

// ---- Constants / construction ------------------------------------------------

test('constants: 3600-tick nights, 5 AP per day', () => {
    assert.equal(NIGHT_TICKS, 3600);
    assert.equal(DAY_AP, 5);
});

test('constructor validates nightTicks and dayAp', () => {
    const deps = {clock: new SimulationClock(), economy: new Economy()};
    for (const bad of [0, -1, 1.5, NaN]) assert.throws(() => new ShiftCycle({...deps, nightTicks: bad}), RangeError);
    for (const bad of [-1, 1.5, NaN]) assert.throws(() => new ShiftCycle({...deps, dayAp: bad}), RangeError);
});

// ---- Not started -------------------------------------------------------------------

test('before begin(): no shift, no construction, endDay rejected', () => {
    const {cycle, clock} = setup();
    assert.deepEqual(cycle.snapshot(), {day: 0, shift: null, elapsedNightTicks: 0, remainingNightTicks: 0});
    assert.equal(cycle.isConstructionAllowed, false);
    assert.deepEqual(cycle.endDay(), {ok: false, reason: ShiftFailure.NOT_STARTED});
    assert.equal(cycle.stepTicks(10), 0);
    assert.equal(clock.running, false);
});

// ---- Day Shift ---------------------------------------------------------------------

test('begin() enters Day 1 with the clock running but paused; only once', () => {
    const {cycle, clock} = setup();
    assert.deepEqual(cycle.begin(), {ok: true});
    assert.deepEqual(cycle.snapshot(), {day: 1, shift: Shift.DAY, elapsedNightTicks: 0, remainingNightTicks: 0});
    assert.equal(clock.running, true);
    assert.equal(clock.paused, true);
    assert.equal(cycle.isConstructionAllowed, true);
    assert.deepEqual(cycle.begin(), {ok: false, reason: ShiftFailure.ALREADY_STARTED});
    assert.equal(cycle.day, 1);
});

test('Day Shift never advances the clock: real frames, manual steps, or QA resume', () => {
    const ctx = setup();
    ctx.cycle.begin();
    assert.equal(ctx.frames(600), 0); // 10 s of frames
    assert.equal(ctx.frames(20, 5000), 0); // long frames
    assert.equal(ctx.step(240), 0);
    ctx.cycle.resume(); // QA resume is a no-op during Day
    assert.equal(ctx.clock.paused, true);
    assert.equal(ctx.frames(60), 0);
    assert.equal(ctx.clock.tick, 0);
    assert.equal(ctx.callbacks(), 0);
});

test('stepTicks validates its count in every shift', () => {
    const {cycle} = setup();
    for (const bad of [0, -1, 241, 1.5, NaN]) assert.throws(() => cycle.stepTicks(bad), RangeError);
    cycle.begin();
    for (const bad of [0, 241]) assert.throws(() => cycle.stepTicks(bad), RangeError);
    cycle.endDay();
    for (const bad of [0, 241]) assert.throws(() => cycle.stepTicks(bad), RangeError);
});

// ---- Night Shift -------------------------------------------------------------------

test('endDay() starts Night: elapsed 0, remaining 3600, clock resumed', () => {
    const {cycle, clock} = setup();
    cycle.begin();
    assert.deepEqual(cycle.endDay(), {ok: true});
    assert.deepEqual(cycle.snapshot(), {day: 1, shift: Shift.NIGHT, elapsedNightTicks: 0, remainingNightTicks: 3600});
    assert.equal(clock.paused, false);
    assert.equal(cycle.isConstructionAllowed, false);
    assert.deepEqual(cycle.endDay(), {ok: false, reason: ShiftFailure.NOT_DAY});
});

test('Night ends exactly at 3600 ticks, not at 3599 (manual path)', () => {
    const ctx = setup();
    ctx.cycle.begin();
    ctx.cycle.endDay();
    assert.equal(ctx.step(3599), 3599);
    assert.deepEqual(ctx.cycle.snapshot(), {day: 1, shift: Shift.NIGHT, elapsedNightTicks: 3599, remainingNightTicks: 1});
    assert.equal(ctx.step(1), 1);
    assert.deepEqual(ctx.cycle.snapshot(), {day: 2, shift: Shift.DAY, elapsedNightTicks: 0, remainingNightTicks: 0});
    assert.equal(ctx.clock.tick, 3600);
    assert.equal(ctx.clock.paused, true);
});

test('Night ends exactly at 3600 ticks via real frames, including frame-rate independence', () => {
    for (const delta of [FRAME, 1000 / 30, 1000 / 144, 100]) {
        const ctx = setup();
        ctx.cycle.begin();
        ctx.cycle.endDay();
        // Feed far more time than a night; the clock must stop at exactly 3600.
        ctx.frames(Math.ceil(120_000 / delta), delta);
        assert.equal(ctx.clock.tick, 3600, `delta ${delta}`);
        assert.equal(ctx.callbacks(), 3600, `delta ${delta}`);
        assert.deepEqual(ctx.cycle.snapshot(), {day: 2, shift: Shift.DAY, elapsedNightTicks: 0, remainingNightTicks: 0});
    }
});

test('a long final frame stops at the end of night; excess time is dropped', () => {
    const ctx = setup();
    ctx.cycle.begin();
    ctx.cycle.endDay();
    ctx.step(3597); // 3 ticks remaining
    assert.equal(ctx.clock.advance(100, (t) => ctx.cycle.onTick(t)), 3); // 6 ticks' worth, only 3 run
    assert.equal(ctx.clock.tick, 3600);
    assert.equal(ctx.cycle.shift, Shift.DAY);
    assert.equal(ctx.frames(60), 0); // no leftover ticks leak into Day 2
});

test('manual stepping is clamped to the remaining night ticks', () => {
    const ctx = setup();
    ctx.cycle.begin();
    ctx.cycle.endDay();
    ctx.step(3500); // 100 remaining
    assert.equal(ctx.cycle.stepTicks(240, (t) => ctx.cycle.onTick(t)), 100);
    assert.equal(ctx.clock.tick, 3600);
    assert.equal(ctx.cycle.shift, Shift.DAY);
    assert.equal(ctx.cycle.stepTicks(240, (t) => ctx.cycle.onTick(t)), 0);
});

test('QA pause freezes Night; resume continues it; manual steps keep it paused', () => {
    const ctx = setup();
    ctx.cycle.begin();
    ctx.cycle.endDay();
    ctx.frames(30);
    ctx.clock.pause();
    assert.equal(ctx.frames(60), 0);
    assert.equal(ctx.step(10), 10);
    assert.equal(ctx.clock.paused, true);
    assert.equal(ctx.cycle.elapsedNightTicks, 40);
    ctx.cycle.resume();
    assert.equal(ctx.frames(30), 30);
    assert.equal(ctx.cycle.elapsedNightTicks, 70);
});

// ---- Multiple cycles -------------------------------------------------------------

test('global tick is monotonic across nights; day number increments', () => {
    const ctx = setup();
    ctx.cycle.begin();
    let last = ctx.clock.tick;
    for (let night = 1; night <= 3; night++) {
        ctx.frames(300); // Day: nothing happens
        assert.equal(ctx.clock.tick, last);
        ctx.cycle.endDay();
        ctx.frames(1800); // half the night in real time
        assert.ok(ctx.clock.tick > last);
        ctx.step(1800);
        assert.equal(ctx.clock.tick, night * 3600);
        assert.ok(ctx.clock.tick > last);
        last = ctx.clock.tick;
        assert.equal(ctx.cycle.day, night + 1);
        assert.equal(ctx.cycle.shift, Shift.DAY);
    }
    assert.equal(ctx.clock.tick, 10800);
});

test('each new Day restores AP to 5; Credits carry over unchanged', () => {
    const ctx = setup();
    ctx.cycle.begin();
    ctx.placement.select('factory');
    ctx.placement.placeAt({col: 5, row: 5}); // 600 / 4
    ctx.placement.select('outpost');
    ctx.placement.placeAt({col: 10, row: 10}); // 500 / 3
    assert.deepEqual(ctx.economy.snapshot(), {credits: 500, ap: 3});
    ctx.cycle.endDay();
    ctx.step(3600);
    assert.deepEqual(ctx.economy.snapshot(), {credits: 500, ap: 5});

    // Spend AP to zero, then another night.
    ctx.placement.select('outpost');
    for (let i = 0; i < 5; i++) assert.equal(ctx.placement.placeAt({col: i * 2, row: 0}).ok, true);
    assert.deepEqual(ctx.economy.snapshot(), {credits: 0, ap: 0});
    ctx.cycle.endDay();
    ctx.step(3600);
    assert.deepEqual(ctx.economy.snapshot(), {credits: 0, ap: 5});
});

test('restoreAp sets AP to the daily value, even if AP was higher', () => {
    const clock = new SimulationClock();
    const economy = new Economy({credits: 10, ap: 9});
    const cycle = new ShiftCycle({clock, economy, nightTicks: 2});
    cycle.begin();
    cycle.endDay();
    cycle.stepTicks(2, (t) => cycle.onTick(t));
    assert.deepEqual(economy.snapshot(), {credits: 10, ap: 5});
});

test('buildings and grid occupancy persist across shifts', () => {
    const ctx = setup();
    ctx.cycle.begin();
    ctx.placement.select('factory');
    ctx.placement.placeAt({col: 5, row: 5});
    ctx.placement.cancel();
    const gridBefore = ctx.grid.snapshot();
    const buildingsBefore = ctx.placement.buildings();
    ctx.cycle.endDay();
    ctx.step(3600);
    assert.deepEqual(ctx.grid.snapshot(), gridBefore);
    assert.deepEqual(ctx.placement.buildings(), buildingsBefore);
    assert.equal(ctx.grid.occupantAt(5, 5), 'factory-1');
});

// ---- Construction gate -----------------------------------------------------------

test('construction and spending are rejected during Night through domain methods', () => {
    const ctx = setup();
    ctx.cycle.begin();
    ctx.placement.select('outpost'); // selected during Day, then night starts
    ctx.cycle.endDay();
    const before = fullState(ctx);

    assert.deepEqual(ctx.placement.placeAt({col: 3, row: 3}), {ok: false, reason: CONSTRUCTION_DISABLED});
    assert.deepEqual(ctx.placement.preview({col: 3, row: 3}), {
        footprint: {col: 3, row: 3, width: 1, height: 1}, ok: false, reason: CONSTRUCTION_DISABLED,
    });
    assert.equal(ctx.placement.select('factory'), false);
    assert.equal(ctx.placement.selectedType, 'outpost'); // unchanged by the refused select
    assert.equal(fullState(ctx), before);

    ctx.step(1800);
    assert.equal(ctx.placement.placeAt({col: 3, row: 3}).reason, CONSTRUCTION_DISABLED);
    assert.equal(fullState(ctx), before);
});

test('construction works again on the next Day', () => {
    const ctx = setup();
    ctx.cycle.begin();
    ctx.cycle.endDay();
    ctx.step(3600);
    assert.equal(ctx.placement.select('factory'), true);
    assert.equal(ctx.placement.placeAt({col: 5, row: 5}).ok, true);
    assert.equal(ctx.placement.placeAt({col: 6, row: 6}).reason, PlacementFailure.OCCUPIED);
    assert.deepEqual(ctx.economy.snapshot(), {credits: 600, ap: 4});
});

test('construction is disabled before the cycle begins', () => {
    const ctx = setup();
    assert.equal(ctx.placement.select('outpost'), false);
    assert.equal(ctx.placement.placeAt({col: 1, row: 1}).reason, 'no-selection');
});

test('snapshot is detached plain data', () => {
    const {cycle} = setup();
    cycle.begin();
    const s = cycle.snapshot();
    s.day = 99;
    assert.equal(cycle.day, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(cycle.snapshot())), cycle.snapshot());
});
