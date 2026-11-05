import test from 'node:test';
import assert from 'node:assert/strict';
import {Economy} from '../../src/core/economy.js';
import {NIGHT_TICKS, Shift, ShiftCycle} from '../../src/core/shiftCycle.js';
import {SIMULATION_SPEEDS, SimulationClock} from '../../src/core/simulationClock.js';
import {canonicalState, createWorld, digestOf, worldState} from '../soak/harness.js';

/**
 * Speed must only change how many ticks run per frame. Each run below is
 * driven through the real clock, with frames that run several ticks at once,
 * and commands are tied to simulation ticks, never to frames.
 */

const RESOURCES = {credits: 5000, ap: 20}; // independent of the starting budget
const UNEVEN_FRAMES = [7, 90, 16, 33, 140, 16, 16, 61];
const MAX_FRAMES = 40000;

function base(world) {
    for (const [type, col, row] of [
        ['hq', 12, 8], ['powerPlant', 12, 4], ['factory', 8, 8], ['autocannon', 9, 5], ['autocannon', 15, 5],
    ]) assert.equal(world.place(type, col, row).ok, true, type);
}

/** Runs one Night, by frames or by manual steps, until it stops being Night. */
function runNight(world, {speed, frames = UNEVEN_FRAMES, onNightTick = () => {}, manual = false}) {
    const onTick = (tick) => {
        world.tick(tick);
        if (world.cycle.shift === Shift.NIGHT) onNightTick(world.cycle.elapsedNightTicks);
    };
    world.clock.setSpeed(speed);
    assert.equal(world.cycle.endDay().ok, true);
    for (let i = 0; world.cycle.shift === Shift.NIGHT; i++) {
        assert.ok(i < MAX_FRAMES, 'the Night must end');
        if (manual) world.cycle.stepTicks(240, onTick);
        else world.clock.advance(frames[i % frames.length], onTick);
    }
}

/** Four Nights with player commands issued on fixed simulation ticks. */
function playedRun({seed, speed, manual = false, switchSpeeds = false}) {
    const world = createWorld({seed, resources: RESOURCES, requireHq: true, roads: true});
    base(world);
    const [factory] = world.placement.buildings().filter((b) => b.type === 'factory').map((b) => b.id);
    const reports = [];
    for (let night = 1; night <= 4; night++) {
        const onNightTick = (tick) => {
            if (tick === 500) world.placement.setEnabled(factory, false);
            if (tick === 1700 + night) world.placement.setEnabled(factory, true);
            if (switchSpeeds && tick % 400 === 0) world.clock.setSpeed(SIMULATION_SPEEDS[(tick / 400) % 3]);
        };
        runNight(world, {speed, onNightTick, manual});
        reports.push(world.cycle.lastSettlement);
    }
    return {
        digest: digestOf(canonicalState(worldState(world))),
        tick: world.clock.tick,
        reports,
        resources: world.economy.snapshot(),
        pollution: world.pollution.value,
        logistics: world.logistics.snapshot(),
    };
}

test('the same seed and commands give identical outcomes at 1x, 2x and 4x', () => {
    for (const seed of [731, 98, 1]) {
        const stepped = playedRun({seed, speed: 1, manual: true});
        assert.ok(stepped.logistics.totals.loads >= 4, 'trucks must really deliver');
        for (const speed of SIMULATION_SPEEDS) assert.deepEqual(playedRun({seed, speed}), stepped, `seed ${seed}, ${speed}x`);
    }
});

test('switching speed during a Night changes nothing but pacing', () => {
    const stepped = playedRun({seed: 98, speed: 1, manual: true});
    assert.deepEqual(playedRun({seed: 98, speed: 4, switchSpeeds: true}), stepped);
});

test('a Night runs exactly 3600 ticks and settles once at every speed, whatever the frames', () => {
    for (const speed of SIMULATION_SPEEDS) {
        for (const frames of [[1000 / 60], [97], UNEVEN_FRAMES, [100]]) {
            const world = createWorld({resources: RESOURCES, requireHq: true, roads: true});
            base(world);
            const before = world.economy.credits;
            runNight(world, {
                speed,
                frames,
                onNightTick: () => assert.equal(world.cycle.lastSettlement, null, 'settlement only happens on the last tick'),
            });
            assert.equal(world.clock.tick, NIGHT_TICKS, `${speed}x`);
            assert.equal(world.cycle.lastSettlement.day, 1);
            assert.equal(world.economy.credits, before + 150, 'five deliveries');
            assert.equal(world.pollution.value, 20, 'one settlement');
            assert.equal(world.cycle.shift, Shift.DAY);
            assert.equal(world.cycle.day, 2);
            assert.equal(world.clock.paused, true);
            assert.equal(world.clock.advance(100, () => assert.fail('Day must not tick')), 0);
        }
    }
});

test('the frame that crosses dawn drops its extra ticks instead of running them in Day', () => {
    const clock = new SimulationClock();
    const economy = new Economy({credits: 0, ap: 0});
    let settlements = 0;
    const cycle = new ShiftCycle({clock, economy, nightTicks: 10, settleNight: () => { settlements++; return {}; }});
    cycle.begin();
    cycle.endDay();
    clock.setSpeed(4);
    const onTick = (tick) => cycle.onTick(tick);
    assert.equal(clock.advance(100, onTick), 10); // 24 ticks were available
    assert.deepEqual([clock.tick, settlements, cycle.shift, cycle.day], [10, 1, Shift.DAY, 2]);
});

test('a failed settlement inside a multi-tick frame is retried once, with no lost or extra tick', () => {
    const clock = new SimulationClock();
    const economy = new Economy({credits: 0, ap: 0});
    let attempts = 0;
    const cycle = new ShiftCycle({clock, economy, nightTicks: 10, settleNight: () => {
        attempts++;
        if (attempts === 1) throw new Error('settlement failed');
        return {};
    }});
    cycle.begin();
    cycle.endDay();
    clock.setSpeed(4);
    const onTick = (tick) => cycle.onTick(tick);
    assert.throws(() => clock.advance(100, onTick), /settlement failed/);
    assert.deepEqual([clock.tick, cycle.shift, cycle.remainingNightTicks], [9, Shift.NIGHT, 1]);
    assert.equal(clock.advance(100, onTick), 1);
    assert.deepEqual([clock.tick, attempts, cycle.shift, cycle.day], [10, 2, Shift.DAY, 2]);
});

test('defeat lands on the same tick at every speed, ends its frame and never settles', () => {
    const outcomes = SIMULATION_SPEEDS.map((speed) => {
        const world = createWorld({seed: 5, schedule: [1], resources: RESOURCES, requireHq: true});
        assert.equal(world.place('hq', 12, 8).ok, true);
        const [hq] = world.placement.buildings();
        world.placement.damageBuilding(hq.id, hq.hp - 5);
        runNight(world, {speed, frames: [97]});
        assert.equal(world.cycle.shift, Shift.DEFEATED);
        assert.equal(world.cycle.lastSettlement, null);
        assert.equal(world.clock.advance(100, () => assert.fail('nothing ticks after defeat')), 0);
        return {report: world.cycle.defeatReport, tick: world.clock.tick, digest: digestOf(canonicalState(worldState(world)))};
    });
    assert.ok(outcomes[0].report.nightTick > 1);
    assert.deepEqual(outcomes[1], outcomes[0]);
    assert.deepEqual(outcomes[2], outcomes[0]);
});

test('manual stepping advances exactly the requested Night ticks at every speed', () => {
    for (const speed of SIMULATION_SPEEDS) {
        const world = createWorld({resources: RESOURCES, requireHq: true});
        base(world);
        world.clock.setSpeed(speed);
        world.cycle.endDay();
        world.clock.pause();
        assert.equal(world.cycle.stepTicks(37, world.tick), 37);
        assert.equal(world.cycle.elapsedNightTicks, 37);
        assert.equal(world.clock.tick, 37);
        assert.equal(world.clock.advance(100, world.tick), 0);
    }
});

test('the selected speed lasts across Nights', () => {
    const world = createWorld({resources: RESOURCES, requireHq: true});
    base(world);
    runNight(world, {speed: 4, frames: [100]});
    assert.equal(world.clock.speed, 4);
});
