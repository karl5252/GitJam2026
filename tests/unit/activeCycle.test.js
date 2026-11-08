/**
 * TASK 025.4A: the ACTIVE cycle GameScene plays. Day 3600 ticks, Dusk 300, Night
 * 3600, through the real domain objects in GameScene's tick order (soak harness).
 * None of this runs the LEGACY untimed Day, whose tests live elsewhere.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {LOGISTICS, LogisticsFailure, TruckState} from '../../src/core/logistics.js';
import {DAY_AP, DAY_TICKS, DUSK_TICKS, NIGHT_TICKS, Shift, ShiftFailure} from '../../src/core/shiftCycle.js';
import {MAX_MANUAL_STEPS} from '../../src/core/simulationClock.js';
import {Ground, TERRAIN_SPEED, groundAt, halfTileTicks, speedOn} from '../../src/core/terrainSpeed.js';
import {nextStep, walkField, walkMap} from '../../src/core/walkField.js';
import {WORKER, WorkFlagFailure, WorkerFailure} from '../../src/core/workers.js';
import {WORLD_MAPS, createTerrain} from '../../src/core/worldMap.js';
import {canonicalState, createWorld, digestOf, worldState} from '../soak/harness.js';

const FUNDS = {credits: 9000, ap: 40};
const HQ = [12, 8]; // footprint 11..13, 7..9; ring 10..14, 6..10; receiving dock 12,10
const FACTORY = [8, 8]; // dock 10,8 is on the ring
const EXIT = {col: 12, row: 10};

/** HQ built in Day 0, the untimed deployment. Nothing has ticked yet. */
function deployed(options = {}) {
    const w = createWorld({requireHq: true, roads: true, resources: FUNDS, schedule: [], active: true, ...options});
    assert.equal(w.cycle.deployment, true);
    assert.equal(w.place('hq', ...HQ).ok, true);
    return w;
}

/** Through Day 0's Dusk and Night 1 to the first timed Day (calendar day 2, shown as Day 1). */
function toFirstTimedDay(w) {
    assert.deepEqual(w.cycle.endDay(), {ok: true});
    let guard = 0;
    while (w.cycle.shift !== Shift.DAY && guard++ < 10_000) w.cycle.stepTicks(1, w.tick);
    assert.deepEqual([w.cycle.shift, w.cycle.day, w.cycle.deployment, w.cycle.elapsedDayTicks], [Shift.DAY, 2, false, 0]);
    return w;
}

/** A base at the start of its first timed Day. */
function world(options = {}) {
    return toFirstTimedDay(deployed(options));
}

function industry(options) {
    const w = world(options);
    assert.equal(w.place('powerPlant', 20, 3).ok, true);
    assert.equal(w.place('factory', ...FACTORY).ok, true);
    return w;
}

/** Exactly `ticks` ticks through the real tick, across phases, or until defeat. */
function run(w, ticks, onTick = () => {}) {
    let done = 0;
    while (done < ticks && w.cycle.active) {
        if (w.cycle.stepTicks(1, w.tick) === 0) break;
        done++;
        onTick(w);
    }
    return done;
}

const untilShift = (w, shift, onTick) => {
    let n = 0;
    while (w.cycle.shift !== shift && n < 20_000) n += run(w, 1, onTick);
    return n;
};

/** What END DAY does in GameScene: bounded batches through the same tick until Dusk. */
function fastForward(w) {
    const batches = [];
    assert.deepEqual(w.cycle.endDay(), {ok: true});
    while (w.cycle.fastForwarding) batches.push(w.cycle.stepTicks(MAX_MANUAL_STEPS, w.tick));
    return batches;
}

// ---- 1. Day -> Dusk -> Night -> Day -----------------------------------------

// ---- Day 0 --------------------------------------------------------------------

test('Day 0 is untimed: no tick runs, so nothing produces, earns, moves or emits, however long it lasts', () => {
    const w = deployed();
    assert.equal(w.place('powerPlant', 20, 3).ok, true);
    assert.equal(w.place('factory', ...FACTORY).ok, true);
    const before = JSON.stringify([w.economy.snapshot(), w.pollution.snapshot(), w.logistics.snapshot(), w.workers.snapshot(), w.clock.tick]);
    for (let i = 0; i < 1000; i++) w.clock.advance(100, w.tick); // 100 seconds of real frames
    assert.equal(w.cycle.stepTicks(MAX_MANUAL_STEPS, w.tick), 0, 'not even QA can step it');
    w.cycle.resume(); // QA resume does not start it either
    w.clock.advance(100, w.tick);
    assert.equal(JSON.stringify([w.economy.snapshot(), w.pollution.snapshot(), w.logistics.snapshot(), w.workers.snapshot(), w.clock.tick]), before);
    assert.deepEqual([w.cycle.shift, w.cycle.deployment, w.cycle.canPause, w.cycle.remainingDayTicks], [Shift.DAY, true, false, 0]);
});

test('Day 0 cannot be farmed: its END DAY works once, AP is not restored in it, and it never comes back', () => {
    const w = deployed();
    const ap = w.economy.ap;
    assert.equal(w.workers.setFlag({col: 4, row: 4}).reason, WorkFlagFailure.DAY_ONLY, 'no worker orders in Day 0');
    assert.equal(w.economy.ap, ap);
    assert.deepEqual(w.cycle.endDay(), {ok: true});
    assert.deepEqual(w.cycle.endDay(), {ok: false, reason: ShiftFailure.NOT_DAY});
    let deploymentsSeen = 0;
    run(w, 3 * (DAY_TICKS + DUSK_TICKS + NIGHT_TICKS), ({cycle}) => {
        if (cycle.deployment) deploymentsSeen++;
    });
    assert.equal(deploymentsSeen, 0, 'Day 0 happens once, before the first Night');
});

test('Day 0 END DAY starts the first Night through a full Dusk; Night 1 is planned and settled as before', () => {
    const w = deployed({schedule: null});
    assert.deepEqual(w.cycle.endDay(), {ok: true});
    assert.deepEqual([w.cycle.shift, w.cycle.elapsedDuskTicks, w.clock.paused], [Shift.DUSK, 0, false], 'Dusk begins with its first tick to come');
    const seen = [];
    let last = Shift.DUSK;
    run(w, DUSK_TICKS + NIGHT_TICKS + DAY_TICKS + 2, ({cycle}) => {
        if (cycle.shift !== last) seen.push([cycle.shift, cycle.elapsedDayTicks, cycle.elapsedDuskTicks, cycle.elapsedNightTicks, cycle.day, cycle.deployment]);
        last = cycle.shift;
    });
    assert.deepEqual(seen, [
        [Shift.NIGHT, 0, 0, 1, 1, false], // after Dusk ticks 1..300: Night tick 1 of Night 1
        [Shift.DAY, 0, 0, 0, 2, false], // Night 1's 3600th tick settles and starts the first timed Day
        [Shift.DUSK, 0, 1, 0, 2, false], // which runs its 3600 ticks by itself
    ]);
    assert.equal(w.cycle.lastSettlement.day, 1, 'Night 1 settled once');
    assert.equal(w.economy.ap, DAY_AP);
});

test('timed Days begin after the first Night: Day ticks, then Dusk 300, then Night ticks 1..3600 numbered as before', () => {
    const w = world();
    const seen = [];
    let last = null;
    run(w, DAY_TICKS + DUSK_TICKS + NIGHT_TICKS + 2, ({cycle}) => {
        if (cycle.shift !== last) seen.push([cycle.shift, cycle.elapsedDayTicks, cycle.elapsedDuskTicks, cycle.elapsedNightTicks, cycle.day]);
        last = cycle.shift;
    });
    assert.deepEqual(seen, [
        [Shift.DAY, 1, 0, 0, 2],
        [Shift.DUSK, 0, 1, 0, 2], // Day tick 3601 is Dusk tick 1
        [Shift.NIGHT, 0, 0, 1, 2], // Dusk tick 301 is Night tick 1, exactly as after a LEGACY END DAY
        [Shift.DAY, 0, 0, 0, 3], // Night's 3600th tick settles and starts the next Day
    ]);
    assert.equal(w.cycle.elapsedDayTicks, 2, 'and that Day ticks on by itself');
    assert.equal(w.cycle.lastSettlement.day, 2);
});

test('every timed Day starts at 1x and unpaused, whatever speed the Night ran at', () => {
    const w = world();
    fastForward(w);
    untilShift(w, Shift.NIGHT);
    w.clock.setSpeed(4);
    w.clock.pause(); // QA pauses a Night; a player cannot, but a new Day must start running anyway
    while (w.cycle.shift === Shift.NIGHT) w.cycle.stepTicks(MAX_MANUAL_STEPS, w.tick);
    assert.deepEqual([w.cycle.shift, w.clock.speed, w.clock.paused, w.cycle.canPause], [Shift.DAY, 1, false, true]);
    w.clock.setSpeed(4); // and from 4x within a Day, too
    fastForward(w);
    untilShift(w, Shift.DAY);
    assert.equal(w.clock.speed, 1);
});

test('construction is open in Day only: closed in Dusk, at Night and while END DAY runs', () => {
    const w = world();
    assert.equal(w.cycle.isConstructionAllowed, true);
    assert.equal(w.place('wall', 2, 2).ok, true);
    const closed = () => {
        assert.equal(w.placement.select('wall'), false, 'nothing can even be chosen');
        assert.equal(w.placement.previewRoad({col: 3, row: 2}).reason, 'construction-disabled');
    };
    w.cycle.endDay();
    assert.equal(w.cycle.isConstructionAllowed, false, 'fast-forwarding');
    closed();
    untilShift(w, Shift.DUSK);
    closed();
    untilShift(w, Shift.NIGHT);
    closed();
});

test('the player may pause a Day; Dusk resumes the clock, and a paused Day never ends by itself', () => {
    const w = world();
    assert.equal(w.cycle.canPause, true);
    w.clock.pause();
    w.clock.advance(1000, w.tick);
    assert.equal(w.cycle.elapsedDayTicks, 0, 'paused: real frames run nothing');
    w.clock.resume();
    w.clock.advance(50, w.tick); // 3 ticks
    assert.equal(w.cycle.elapsedDayTicks, 3);
    w.clock.pause();
    fastForward(w); // END DAY still works from a paused Day
    assert.equal(w.cycle.shift, Shift.DUSK);
    assert.equal(w.clock.paused, false, 'nobody can pause a Dusk');
    assert.equal(w.cycle.canPause, false);
});

test('Night combat and the wave plan are unchanged: the same base fights the same Night as under the LEGACY cycle', () => {
    const digests = [false, true].map((active) => {
        const w = createWorld({requireHq: true, roads: true, resources: FUNDS, schedule: null, active});
        assert.equal(w.place('hq', ...HQ).ok, true);
        assert.equal(w.place('autocannon', 16, 8).ok, true);
        assert.equal(w.place('autocannon', 8, 8).ok, true);
        w.cycle.jumpToDay(12);
        if (active) fastForward(w);
        else w.cycle.endDay();
        untilShift(w, Shift.NIGHT);
        const trace = [];
        run(w, NIGHT_TICKS - 1, () => {
            if (w.cycle.elapsedNightTicks % 300 === 0) trace.push(digestOf(canonicalState(worldState(w))));
        });
        return {trace, plan: w.mutants.plan(), rng: w.rng.snapshot()};
    });
    assert.ok(digests[0].plan.schedule.length > 0);
    assert.deepEqual(digests[1], digests[0]);
});

// ---- 2. END DAY fast-forward ----------------------------------------------

test('END DAY runs the rest of the Day in bounded batches through the normal tick, then plays Dusk', () => {
    const w = industry();
    run(w, 1000);
    const steps = w.tick;
    let ticks = 0;
    w.tick = (t) => {
        ticks++;
        return steps(t);
    };
    const batches = fastForward(w);
    assert.ok(batches.every((n) => n > 0 && n <= MAX_MANUAL_STEPS), 'never more than one batch a frame');
    assert.equal(ticks, DAY_TICKS - 1000 + 1, 'every remaining Day tick, then Dusk tick 1');
    assert.deepEqual([w.cycle.shift, w.cycle.elapsedDuskTicks, w.cycle.fastForwarding], [Shift.DUSK, 1, false]);
    assert.deepEqual(w.cycle.endDay(), {ok: false, reason: ShiftFailure.NOT_DAY});
});

test('fast-forward produces and delivers exactly what waiting would have: nothing is skipped or jumped', () => {
    const waited = industry();
    untilShift(waited, Shift.DUSK);
    const skipped = industry();
    run(skipped, 700);
    fastForward(skipped);
    for (const w of [waited, skipped]) assert.equal(w.cycle.elapsedDuskTicks, 1);
    assert.deepEqual(skipped.logistics.snapshot(), waited.logistics.snapshot());
    assert.equal(skipped.economy.credits, waited.economy.credits);
});

// ---- 3. Factories by Day, 4. continuous across boundaries ---------------------

test('a powered Factory makes loads and its truck delivers them by Day, paying on arrival', () => {
    const w = industry();
    const start = w.economy.credits;
    untilShift(w, Shift.DUSK);
    const {night: tally, trucks: [truck], factories: [factory]} = w.logistics.snapshot();
    assert.equal(tally.loads + factory.stored + truck.cargo, Math.floor(DAY_TICKS / LOGISTICS.loadTicks), 'six loads made in a 3600-tick Day');
    assert.equal(tally.loads, 5, 'five delivered: the sixth, made on the last Day tick, is still on its way');
    assert.equal(w.economy.credits - start, tally.loads * LOGISTICS.creditsPerLoad);
    assert.equal(tally.loads * LOGISTICS.creditsPerLoad, tally.credits);
    assert.ok(truck && factory);
});

test('production, cargo and trucks carry straight across Day, Dusk, Night and dawn: no reset, no jump, no duplicate', () => {
    const w = industry();
    let before = w.logistics.snapshot();
    let credits = w.economy.credits;
    let produced = 0;
    let shift = w.cycle.shift;
    const boundaries = [];
    run(w, 2 * (DAY_TICKS + DUSK_TICKS + NIGHT_TICKS), () => {
        const now = w.logistics.snapshot();
        const [was] = before.factories;
        const [is] = now.factories;
        // Progress counts up by one, or wraps to 0 as a load is stored, and nothing else.
        assert.ok(is.progress === was.progress + 1 || (is.progress === 0 && was.progress === LOGISTICS.loadTicks - 1), `progress ${was.progress} -> ${is.progress}`);
        if (is.progress === 0) produced++;
        const [a] = before.trucks;
        const [b] = now.trucks;
        assert.ok(Math.abs(b.x - a.x) + Math.abs(b.y - a.y) <= LOGISTICS.truckSpeed, 'a truck never jumps');
        const paid = w.economy.credits - credits;
        if (w.cycle.shift === shift || shift !== Shift.NIGHT) {
            assert.ok(paid === 0 || paid === LOGISTICS.creditsPerLoad, `paid ${paid} in one tick`);
        }
        if (w.cycle.shift !== shift) boundaries.push(w.cycle.shift);
        shift = w.cycle.shift;
        credits = w.economy.credits;
        before = now;
    });
    assert.deepEqual(boundaries, [Shift.DUSK, Shift.NIGHT, Shift.DAY, Shift.DUSK, Shift.NIGHT, Shift.DAY]);
    const {factories: [factory], trucks: [truck], totals} = w.logistics.snapshot();
    assert.equal(produced, totals.loads + factory.stored + truck.cargo + totals.cargoLost, 'every load made is delivered, stored or aboard');
    assert.equal(totals.cargoLost, 0);
});

test('each cycle\'s tally runs from the start of a Day to the end of its Night and becomes lastNight at dawn', () => {
    const w = industry();
    untilShift(w, Shift.NIGHT);
    const byDusk = w.logistics.snapshot().night.loads;
    untilShift(w, Shift.DAY);
    const {lastNight, night} = w.logistics.snapshot();
    assert.ok(lastNight.loads > byDusk, 'Day, Dusk and Night together');
    assert.equal(lastNight.loads, Math.floor((DAY_TICKS + DUSK_TICKS + NIGHT_TICKS) / LOGISTICS.loadTicks), '12 loads where a LEGACY Night made 5');
    assert.ok(night.loads <= 1, 'the new tally starts at dawn');
});

// Factory at pointer 4,13: footprint 3..5, 12..14, dock 6,13. Roads are laid outward from the ring.
const SHORT_WAY = [[10, 11], [9, 11], [8, 11], [7, 11], [6, 11], [6, 12], [6, 13]];
const LONG_WAY = [[12, 11], [12, 12], [12, 13], [12, 14], [11, 14], [10, 14], [9, 14], [8, 14], [7, 14], [6, 14]];

function farFactory(ways) {
    const w = world({resources: {credits: 50_000, ap: 90}});
    assert.equal(w.place('powerPlant', 20, 3).ok, true);
    for (const [col, row] of ways) assert.equal(w.placement.placeRoad({col, row}).ok, true, `road ${col},${row}`);
    assert.equal(w.place('factory', 4, 13).ok, true);
    return w;
}

test('a truck finishes its edge and reroutes round a removed road, never driving the removed tile', () => {
    const w = farFactory([...SHORT_WAY, ...LONG_WAY]);
    run(w, LOGISTICS.loadTicks + 40); // the first load left on the short way and is part way along it
    const [truck] = w.logistics.snapshot().trucks;
    assert.equal(truck.state, TruckState.OUTBOUND);
    const credits = w.economy.credits;
    const loads = w.logistics.snapshot().totals.loads;
    assert.equal(w.placement.removeRoad({col: 9, row: 11}).ok, true, 'ahead of the truck, with a way round: allowed');
    const visited = new Set();
    let last = truck;
    run(w, 1200, () => {
        const [t] = w.logistics.snapshot().trucks;
        assert.ok(Math.abs(t.x - last.x) + Math.abs(t.y - last.y) <= LOGISTICS.truckSpeed, 'no jump');
        last = t;
        const cell = w.grid.worldToCell(t.x, t.y);
        visited.add(`${cell.col},${cell.row}`);
    });
    assert.ok(!visited.has('9,11'), 'never on the removed tile');
    assert.ok(visited.has('12,14'), 'it went the long way');
    const delivered = w.logistics.snapshot().totals.loads - loads;
    assert.ok(delivered >= 1, 'it still delivered');
    assert.equal(w.economy.credits - credits, delivered * LOGISTICS.creditsPerLoad, 'paid once per load, never twice');
});

test('an edit on a tile a moving truck touches is refused; a road edit behind it is not', () => {
    const w = farFactory(SHORT_WAY);
    run(w, LOGISTICS.loadTicks + 10); // between the dock 6,13 and 6,12
    const [truck] = w.logistics.snapshot().trucks;
    assert.equal(truck.state, TruckState.OUTBOUND);
    w.placement.select('gateHorizontal'); // a gate across the north-south lane, on the tile the truck is entering
    assert.deepEqual(w.placement.placeAt({col: 6, row: 12}), {ok: false, reason: LogisticsFailure.TRUCK_IN_THE_WAY});
    w.placement.cancel();
    assert.equal(w.placement.removeRoad({col: 8, row: 11}).ok, false, 'the dock rule still holds the only way');
    assert.equal(w.placement.placeRoad({col: 7, row: 12}).ok, true);
    assert.equal(w.placement.removeRoad({col: 7, row: 12}).ok, true, 'a spur it does not use can go');
    run(w, 60);
    w.placement.select('gateHorizontal');
    assert.equal(w.placement.placeAt({col: 6, row: 12}).ok, true, 'once it has passed, the gate can go in');
    w.placement.cancel();
    const credits = w.economy.credits;
    run(w, 600);
    assert.ok(w.economy.credits > credits, 'and trucks open it and keep delivering by Day');
});

// ---- 5. Worker dispatch, 6. recall and stragglers ---------------------------

test('a new flag costs 1 AP, moving it costs 1 AP each time, the same tile costs nothing', () => {
    const w = world();
    const ap = w.economy.ap;
    assert.equal(w.workers.flagCostsAp({col: 4, row: 4}), true);
    assert.deepEqual(w.workers.setFlag({col: 4, row: 4}), {ok: true});
    assert.equal(w.economy.ap, ap - 1, 'new flag');
    assert.deepEqual(w.workers.setFlag({col: 4, row: 4}), {ok: true});
    assert.equal(w.economy.ap, ap - 1, 'the same tile again: free');
    assert.deepEqual(w.workers.setFlag({col: 5, row: 4}), {ok: true});
    assert.equal(w.economy.ap, ap - 2, 'moved');
    assert.deepEqual(w.workers.setFlag({col: 6, row: 4}), {ok: true});
    assert.equal(w.economy.ap, ap - 3, 'moved again, the same Day');
    assert.equal(w.economy.credits, FUNDS.credits, 'never Credits');
});

test('recall is free and keeps the flag; sending them back to it is free', () => {
    const w = world();
    w.workers.setFlag({col: 4, row: 4});
    const ap = w.economy.ap;
    run(w, 300);
    assert.ok(w.workers.workers().length > 0);
    w.workers.recall();
    assert.deepEqual([w.workers.flag, w.workers.sent], [{col: 4, row: 4}, false]);
    assert.deepEqual(w.workers.dispatch(), {ok: true});
    assert.equal(w.workers.sent, true);
    w.workers.recall();
    assert.deepEqual(w.workers.dispatch(), {ok: true});
    assert.equal(w.economy.ap, ap, 'recalls and redispatches cost nothing');
    run(w, 1500);
    assert.ok(w.workers.workers().every(({col, row}) => col === 4 && row === 4), 'and they really go back to it');
});

test('the flag lasts through Dusk, Night and dawn; Dusk only calls the squad home, and the next Day sends it free', () => {
    const w = world();
    w.workers.setFlag({col: 4, row: 4});
    untilShift(w, Shift.DUSK);
    assert.deepEqual([w.workers.flag, w.workers.sent], [{col: 4, row: 4}, false], 'Dusk recalls without deleting the flag');
    untilShift(w, Shift.NIGHT);
    assert.deepEqual(w.workers.flag, {col: 4, row: 4});
    untilShift(w, Shift.DAY);
    assert.deepEqual([w.workers.flag, w.workers.sent], [{col: 4, row: 4}, false]);
    run(w, 200);
    assert.equal(w.workers.workers().length, 0, 'nobody leaves until sent');
    const ap = w.economy.ap;
    assert.deepEqual(w.workers.dispatch(), {ok: true});
    run(w, 1500);
    assert.equal(w.economy.ap, ap, 'reusing yesterday\'s flag costs nothing');
    assert.equal(w.workers.workers().length, WORKER.squadSize);
});

test('placing, moving and sending are refused without AP, in Day 0, while paused, during END DAY, at Dusk and at Night', () => {
    const w = world();
    w.economy.restoreAp(0);
    assert.deepEqual(w.workers.setFlag({col: 4, row: 4}), {ok: false, reason: 'insufficient-ap'});
    assert.deepEqual(w.workers.dispatch(), {ok: false, reason: WorkFlagFailure.NO_FLAG});
    assert.equal(w.workers.flag, null);
    w.economy.restoreAp(1);
    assert.deepEqual(w.workers.setFlag({col: 4, row: 4}), {ok: true});
    w.workers.recall();
    w.economy.restoreAp(2);
    const refused = {ok: false, reason: WorkFlagFailure.DAY_ONLY};
    w.clock.pause();
    assert.deepEqual(w.workers.setFlag({col: 5, row: 4}), {ok: false, reason: 'game-paused'}, 'paused');
    assert.deepEqual(w.workers.dispatch(), {ok: false, reason: 'game-paused'}, 'paused');
    w.clock.resume();
    w.cycle.endDay();
    assert.deepEqual(w.workers.setFlag({col: 5, row: 4}), refused, 'fast-forwarding');
    assert.deepEqual(w.workers.dispatch(), refused, 'fast-forwarding');
    untilShift(w, Shift.DUSK);
    assert.deepEqual(w.workers.setFlag({col: 5, row: 4}), refused);
    untilShift(w, Shift.NIGHT);
    assert.deepEqual(w.workers.dispatch(), refused);
    assert.equal(w.economy.ap, 2, 'no refusal spends anything');
    assert.deepEqual(w.workers.flag, {col: 4, row: 4});
    w.workers.recall(); // always works
});

test('workers leave by Day, walk to the flag and wait there', () => {
    const w = world();
    w.workers.setFlag({col: 4, row: 4});
    run(w, 1500);
    const out = w.workers.workers();
    assert.equal(out.length, WORKER.squadSize);
    assert.ok(out.every((worker) => worker.col === 4 && worker.row === 4 && !worker.next));
    const still = JSON.stringify(out);
    run(w, 200);
    assert.equal(JSON.stringify(w.workers.workers()), still, 'they stay put until there is work');
});

test('Dusk recalls them on foot; a straggler keeps its id, HP and place into Night and can be hit', () => {
    const w = world();
    w.workers.setFlag({col: 0, row: 0}); // 22 tiles from the exit: far more than Dusk's 300 ticks
    untilShift(w, Shift.DUSK);
    assert.deepEqual([w.workers.flag, w.workers.sent], [{col: 0, row: 0}, false], 'Dusk recalls, and the flag stays');
    const atDusk = w.workers.workers();
    assert.equal(atDusk.length, WORKER.squadSize);
    let previous = new Map(atDusk.map((worker) => [worker.id, worker]));
    untilShift(w, Shift.NIGHT, () => {
        for (const worker of w.workers.workers()) {
            const was = previous.get(worker.id);
            assert.ok(Math.abs(worker.x - was.x) + Math.abs(worker.y - was.y) <= speedOn(Ground.ROAD, WORKER.speed) + 1e-9, 'walking, not jumping');
        }
        previous = new Map(w.workers.workers().map((worker) => [worker.id, worker]));
    });
    const atNight = w.workers.workers();
    assert.ok(atNight.length > 0, 'still outside when Night falls');
    assert.deepEqual(atNight.map(({id, hp}) => [id, hp]), atDusk.filter(({id}) => atNight.some((s) => s.id === id)).map(({id, hp}) => [id, hp]));
    assert.ok(w.workers.attackable().length === atNight.length, 'and mutants can reach them');
    const [first] = atNight;
    assert.equal(w.workers.damageWorker(first.id, 5).ok, true);
    run(w, 1);
    assert.equal(w.workers.workers().find(({id}) => id === first.id).hp, WORKER.maxHp - 5, 'HP carries on');
});

test('a straggler walks home and goes in; dawn replaces the dead but never a survivor still outside', () => {
    const w = world();
    w.workers.setFlag({col: 0, row: 0});
    untilShift(w, Shift.NIGHT);
    const outside = w.workers.workers();
    assert.equal(outside.length, WORKER.squadSize);
    assert.equal(w.workers.damageWorker(outside[0].id, WORKER.maxHp).ok, true, 'one dies at Night');
    untilShift(w, Shift.DAY);
    const {inside, workers} = w.workers.snapshot();
    assert.equal(inside + workers.length, WORKER.squadSize, 'three in all, never four');
    assert.ok(!workers.some(({id}) => id === outside[0].id), 'the dead stay dead');
    assert.equal(new Set(workers.map(({id}) => id)).size, workers.length, 'nobody twice');
    // Sent again: the replacement is a new worker, and at most three are ever out.
    w.workers.setFlag({col: 4, row: 4});
    run(w, 1500, () => assert.ok(w.workers.workers().length <= WORKER.squadSize));
    assert.equal(w.workers.workers().length, WORKER.squadSize);
});

test('a survivor still outside at dawn is not doubled: the squad leaving counts it', () => {
    const w = world();
    w.workers.setFlag({col: 0, row: 0});
    untilShift(w, Shift.NIGHT);
    // Inside plus outside, at every tick from Night through dawn and on.
    run(w, NIGHT_TICKS + 200, () => {
        const {inside, workers} = w.workers.snapshot();
        assert.ok(inside + workers.length <= WORKER.squadSize);
        assert.ok(inside >= 0);
    });
});

test('nothing can be built on a tile a worker stands on or is stepping into', () => {
    const w = world();
    w.workers.setFlag({col: 4, row: 4});
    run(w, 1500);
    assert.deepEqual(w.place('wall', 4, 4), {ok: false, reason: WorkerFailure.UNIT_IN_THE_WAY});
    assert.equal(w.place('wall', 5, 5).ok, true);
});

// ---- 7. terrain speeds, 8. quickest routes ---------------------------------

test('terrain multipliers: road and HQ ring x1.2, open ground and dirt track x1.0, jungle x0.65', () => {
    assert.deepEqual([TERRAIN_SPEED[Ground.ROAD], TERRAIN_SPEED[Ground.OPEN], TERRAIN_SPEED[Ground.JUNGLE]], [1.2, 1.0, 0.65]);
    assert.deepEqual([Ground.ROAD, Ground.OPEN, Ground.JUNGLE].map((g) => halfTileTicks(g, 32)), [14, 16, 25]);
    const map = WORLD_MAPS.jungle;
    const terrain = createTerrain(map, map.seed);
    const track = terrain.path[0];
    assert.equal(terrain.kindAt(track.col, track.row), 'path');
    assert.equal(groundAt(track, {terrain}), Ground.OPEN, 'the dirt track is not a constructed road');
    assert.equal(groundAt({col: 0, row: 0}, {terrain}), Ground.JUNGLE);
    const roads = {has: ({col, row}) => col === 3 && row === 3};
    assert.equal(groundAt({col: 3, row: 3}, {roads, terrain: null}), Ground.ROAD);
});

test('workers really walk at road, open and jungle speed', () => {
    const map = WORLD_MAPS.jungle;
    const terrain = createTerrain(map, map.seed);
    const w = createWorld({requireHq: true, roads: true, resources: FUNDS, schedule: [], active: true, map, terrain});
    const {center} = terrain;
    assert.equal(w.place('hq', center.col, center.row).ok, true);
    toFirstTimedDay(w);
    // A flag deep in the jungle, so the walk crosses road, open ground and jungle.
    const flag = {col: 1, row: 1};
    assert.equal(w.workers.setFlag(flag).ok, true);
    const seen = new Map();
    let previous = null;
    run(w, 3400, () => {
        const [first] = w.workers.workers();
        if (!first) return;
        if (previous && previous.id === first.id) {
            const moved = Math.abs(first.x - previous.x) + Math.abs(first.y - previous.y);
            const under = w.grid.worldToCell(previous.x, previous.y);
            const ground = groundAt(under, {roads: w.roads, terrain});
            if (moved > 0) seen.set(ground, Math.max(seen.get(ground) ?? 0, moved));
        }
        previous = first;
    });
    for (const ground of [Ground.ROAD, Ground.OPEN, Ground.JUNGLE]) {
        assert.ok(Math.abs(seen.get(ground) - speedOn(ground, WORKER.speed)) < 1e-9, `ground ${ground}: ${seen.get(ground)}`);
    }
});

test('routes are chosen by travel time: a longer road beats a shorter walk through jungle', () => {
    // 7x3: a straight line along row 1 is jungle; row 0 is road, two tiles longer.
    const jungle = new Set(['1,1', '2,1', '3,1', '4,1', '5,1']);
    const road = new Set(['0,1', '0,0', '1,0', '2,0', '3,0', '4,0', '5,0', '6,0', '6,1']);
    const ground = {
        roads: {has: ({col, row}) => road.has(`${col},${row}`)},
        terrain: {kindAt: (col, row) => (jungle.has(`${col},${row}`) ? 'jungle' : 'clearing')},
    };
    const grid = {cols: 7, rows: 3, tileSize: 32};
    const walk = (g) => {
        const map = walkMap(grid, [], g);
        const field = walkField(map, {col: 6, row: 1});
        const path = [];
        for (let cell = {col: 0, row: 1}; cell; cell = nextStep(map, field, cell)) path.push(`${cell.col},${cell.row}`);
        return path;
    };
    assert.deepEqual(walk(null), ['0,1', '1,1', '2,1', '3,1', '4,1', '5,1', '6,1'], 'fewest tiles on plain ground');
    assert.deepEqual(walk(ground), ['0,1', '0,0', '1,0', '2,0', '3,0', '4,0', '5,0', '6,0', '6,1'], 'quickest with terrain');
});

// ---- 10. determinism --------------------------------------------------------

test('the same seed and commands give the same run, tick for tick, across a whole cycle', () => {
    const digest = () => {
        const w = industry({schedule: null});
        assert.equal(w.place('autocannon', 16, 8).ok, true);
        w.workers.setFlag({col: 3, row: 3});
        const trace = [];
        run(w, 1200);
        w.workers.setFlag({col: 4, row: 12});
        fastForward(w);
        run(w, DUSK_TICKS + NIGHT_TICKS + 600, () => {
            if (w.clock.tick % 250 === 0) {
                trace.push(digestOf(JSON.stringify([canonicalState(worldState(w)), w.workers.snapshot(), w.logistics.snapshot(), w.economy.snapshot()])));
            }
        });
        return trace;
    };
    const a = digest();
    assert.ok(a.length > 10);
    assert.deepEqual(digest(), a);
});

// ---- a paused timed Day: look, select, inspect; change nothing ----------------

/** HQ, a Barracks on the ring with a flag, a Plant, and a straight road south of the HQ exit. */
function pausable() {
    const w = world();
    assert.equal(w.place('powerPlant', 20, 3).ok, true);
    assert.equal(w.place('barracks', 16, 8).ok, true); // exit 14,8 on the ring
    for (const [col, row] of [[12, 11], [12, 12], [12, 13], [11, 13]]) assert.equal(w.placement.placeRoad({col, row}).ok, true);
    const barracks = w.placement.barracks()[0].id;
    assert.equal(w.placement.setFlag(barracks, {col: 18, row: 12}).ok, true);
    assert.equal(w.workers.setFlag({col: 4, row: 4}).ok, true);
    run(w, 200); // workers are out
    w.economy.restoreAp(20); // enough for every order below, so only the pause can refuse one
    return {w, barracks, plant: w.placement.buildings().find((b) => b.type === 'powerPlant').id};
}

/** Every gameplay change a player can make, through the real domain methods. */
function everyAction(w, {barracks, plant}) {
    const select = (type, cell) => {
        w.placement.select(type);
        const result = w.placement.placeAt(cell);
        w.placement.cancel();
        return result;
    };
    return {
        build: select('wall', {col: 3, row: 3}),
        gate: select('gateHorizontal', {col: 12, row: 12}),
        addRoad: w.placement.placeRoad({col: 13, row: 13}),
        removeRoad: w.placement.removeRoad({col: 11, row: 13}),
        demolish: w.placement.demolish(plant),
        power: w.placement.setEnabled(barracks, false),
        refit: w.placement.refit(barracks),
        barracksFlag: w.placement.setFlag(barracks, {col: 19, row: 12}),
        barracksReset: w.placement.clearFlag(barracks),
        workFlag: w.workers.setFlag({col: 5, row: 4}),
        recall: w.workers.recall(),
    };
}

const everything = (w) => JSON.stringify([
    w.placement.buildings(), w.roads.tiles(), w.economy.snapshot(), w.workers.snapshot(), w.placement.revision,
]);

test('a paused timed Day refuses every gameplay change and changes nothing; PLAY restores them all', () => {
    const {w, barracks, plant} = pausable();
    w.clock.pause();
    assert.equal(w.cycle.pausedDay, true);
    const before = everything(w);
    const paused = everyAction(w, {barracks, plant});
    for (const [action, result] of Object.entries(paused)) {
        assert.deepEqual(result, {ok: false, reason: 'game-paused'}, action);
    }
    assert.deepEqual(w.workers.dispatch(), {ok: false, reason: 'game-paused'});
    assert.equal(everything(w), before, 'not a building, road, Credit, AP, flag or worker changed');
    // Looking is still allowed: selection and previews read without changing anything.
    assert.equal(w.placement.select('wall'), true, 'a building type can still be picked to look at its price');
    assert.equal(w.placement.preview({col: 3, row: 3}).reason, 'game-paused');
    w.placement.cancel();
    assert.equal(everything(w), before);

    w.clock.resume();
    assert.equal(w.cycle.pausedDay, false);
    const running = everyAction(w, {barracks, plant});
    for (const [action, result] of Object.entries(running)) assert.equal(result.ok, true, `${action}: ${result.reason}`);
});

test('Day 0 is not a paused Day: its clock is stopped, but everything can be built and switched', () => {
    const w = deployed();
    assert.deepEqual([w.clock.paused, w.cycle.pausedDay], [true, false]);
    assert.equal(w.place('powerPlant', 20, 3).ok, true);
    const plant = w.placement.buildings().at(-1).id;
    assert.equal(w.placement.setEnabled(plant, false).ok, true);
    assert.equal(w.placement.placeRoad({col: 12, row: 11}).ok, true);
    assert.equal(w.placement.demolish(plant).ok, true);
});

test('a pause during a Day never blocks the simulation\'s own recall at Dusk, nor END DAY', () => {
    const w = world();
    w.workers.setFlag({col: 0, row: 0});
    run(w, 300);
    w.clock.pause();
    assert.deepEqual(w.workers.recall(), {ok: false, reason: 'game-paused'});
    fastForward(w); // END DAY from a paused Day still runs out the Day
    assert.equal(w.cycle.shift, Shift.DUSK);
    run(w, 1);
    assert.equal(w.workers.sent, false, 'Dusk recalled them anyway');
    assert.deepEqual(w.workers.flag, {col: 0, row: 0});
});
