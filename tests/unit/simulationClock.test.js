import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SimulationClock, SIMULATION_SPEEDS, TICK_RATE, MAX_FRAME_MS, MAX_MANUAL_STEPS} from '../../src/core/simulationClock.js';

const started = (opts) => {
    const c = new SimulationClock(opts);
    c.start();
    return c;
};

/** Feed a list of frame deltas; return total steps. */
const feed = (clock, deltas, onTick) => deltas.reduce((n, d) => n + clock.advance(d, onTick), 0);
const repeat = (n, d) => Array.from({length: n}, () => d);

// ---- Config / lifecycle -----------------------------------------------------

test('defaults: 60 Hz, 100 ms frame cap, 240 manual steps max', () => {
    assert.equal(TICK_RATE, 60);
    assert.equal(MAX_FRAME_MS, 100);
    assert.equal(MAX_MANUAL_STEPS, 240);
    const c = new SimulationClock();
    assert.equal(c.tickRate, 60);
    assert.deepEqual(c.snapshot(), {running: false, paused: false, tick: 0, timeSeconds: 0});
});

test('constructor rejects invalid configuration', () => {
    for (const tickRate of [0, -60, 59.5, NaN, '60']) {
        assert.throws(() => new SimulationClock({tickRate}), RangeError);
    }
    for (const maxFrameMs of [NaN, Infinity, 10, -1]) {
        assert.throws(() => new SimulationClock({maxFrameMs}), RangeError);
    }
});

test('no ticks before start(): neither real-time nor manual', () => {
    const c = new SimulationClock();
    let calls = 0;
    assert.equal(feed(c, repeat(120, 16.7), () => calls++), 0);
    assert.equal(c.stepTicks(10, () => calls++), 0);
    assert.equal(calls, 0);
    assert.equal(c.tick, 0);
    assert.equal(c.running, false);
});

test('start() is idempotent and does not tick by itself', () => {
    const c = new SimulationClock();
    c.start();
    c.start();
    assert.equal(c.running, true);
    assert.equal(c.tick, 0);
});

// ---- Fixed-step accumulation -----------------------------------------------

test('a frame shorter than one step accumulates without ticking', () => {
    const c = started();
    assert.equal(c.advance(10), 0);
    assert.equal(c.tick, 0);
    assert.equal(c.advance(10), 1); // 20 ms >= 16.67 ms
    assert.equal(c.tick, 1);
});

test('remainders carry across frames', () => {
    const c = started();
    // 25 ms frames: 1, 2(50), 1(75 -> 4 total @ 66.7), ...
    const steps = repeat(12, 25).map((d) => c.advance(d));
    assert.equal(steps.reduce((a, b) => a + b), 18); // 300 ms -> 18 ticks
    assert.deepEqual(steps.slice(0, 4), [1, 2, 1, 2]);
});

test('frame-rate independence: 1 s delivered as frames <= 100 ms always yields 60 ticks', () => {
    const patterns = {
        '60 fps': repeat(60, 1000 / 60),
        '30 fps': repeat(30, 1000 / 30),
        '144 fps': repeat(144, 1000 / 144),
        '10 fps (at cap)': repeat(10, 100),
        '240 fps': repeat(240, 1000 / 240),
        irregular: [5, 100, 33, 17, 1, 99, 50, 0, 45, 100, 100, 70, 30, 12, 88, 64, 36, 25, 25, 50, 50],
    };
    for (const [name, deltas] of Object.entries(patterns)) {
        assert.ok(deltas.every((d) => d <= MAX_FRAME_MS), name);
        assert.ok(Math.abs(deltas.reduce((a, b) => a + b) - 1000) < 1e-9, `${name} sums to 1000 ms`);
        const c = started();
        assert.equal(feed(c, deltas), 60, name);
        assert.equal(c.tick, 60, name);
        assert.equal(c.timeSeconds, 1, name);
    }
});

test('simulation time is derived from the integer tick count', () => {
    const c = started();
    feed(c, repeat(90, 1000 / 60));
    assert.equal(c.tick, 90);
    assert.equal(c.timeSeconds, 90 / 60);
    c.stepTicks(30);
    assert.equal(c.timeSeconds, 2);
});

test('onTick receives consecutive tick numbers starting at 0', () => {
    const c = started();
    const seen = [];
    feed(c, [50, 50], (t) => seen.push(t));
    c.stepTicks(3, (t) => seen.push(t));
    assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test('invalid frame deltas are rejected without changing state', () => {
    const c = started();
    c.advance(10);
    for (const bad of [-1, NaN, Infinity, '16']) {
        assert.throws(() => c.advance(bad), RangeError, String(bad));
    }
    assert.equal(c.advance(7), 1); // the 10 ms remainder is still there
});

// ---- Long-frame cap --------------------------------------------------------

test('a single long frame is capped at 100 ms (6 ticks); excess time is dropped', () => {
    for (const delta of [101, 1000, 5000, 60_000]) {
        const c = started();
        assert.equal(c.advance(delta), 6, `${delta} ms`);
        assert.equal(c.tick, 6);
        // Excess is gone: the next tiny frame does not release backlog ticks.
        assert.equal(c.advance(1), 0, `${delta} ms: no backlog`);
    }
});

test('repeated long frames never exceed 6 ticks each (no catch-up spiral)', () => {
    const c = started();
    const steps = repeat(20, 2000).map((d) => c.advance(d));
    assert.ok(steps.every((n) => n === 6));
    assert.equal(c.tick, 120);
});

test('a custom frame cap is honoured', () => {
    const c = started({maxFrameMs: 50});
    assert.equal(c.advance(1000), 3);
});

// ---- Pause / resume / reset ------------------------------------------------

test('pause stops real-time ticks and discards the partial step; resume continues', () => {
    const c = started();
    c.advance(30); // 1 tick, ~13.3 ms remainder
    c.pause();
    assert.equal(c.paused, true);
    assert.equal(feed(c, repeat(60, 1000 / 60)), 0);
    assert.equal(c.tick, 1);
    c.resume();
    assert.equal(c.paused, false);
    assert.equal(c.advance(10), 0); // remainder was discarded on pause
    assert.equal(c.advance(10), 1);
});

test('pause/resume before start are no-ops', () => {
    const c = new SimulationClock();
    c.pause();
    assert.equal(c.paused, false);
    c.resume();
    c.start();
    assert.equal(c.advance(17), 1);
});

test('reset returns to the stopped initial state', () => {
    const c = started();
    feed(c, repeat(30, 20));
    c.pause();
    c.reset();
    assert.deepEqual(c.snapshot(), {running: false, paused: false, tick: 0, timeSeconds: 0});
    assert.equal(c.advance(100), 0);
    assert.equal(c.stepTicks(5), 0);
    c.start();
    assert.equal(c.advance(17), 1);
});

// ---- Manual stepping -------------------------------------------------------

test('stepTicks advances exactly N ticks without any frame delta', () => {
    const c = started();
    let calls = 0;
    assert.equal(c.stepTicks(1, () => calls++), 1);
    assert.equal(c.stepTicks(240, () => calls++), 240);
    assert.equal(calls, 241);
    assert.equal(c.tick, 241);
});

test('stepTicks works while paused and does not unpause', () => {
    const c = started();
    c.pause();
    assert.equal(c.stepTicks(10), 10);
    assert.equal(c.tick, 10);
    assert.equal(c.paused, true);
    assert.equal(c.advance(100), 0);
});

test('stepTicks rejects counts outside 1..240', () => {
    const c = started();
    for (const bad of [0, -1, 241, 1.5, NaN, '5']) {
        assert.throws(() => c.stepTicks(bad), RangeError, String(bad));
    }
    assert.equal(c.tick, 0);
});

test('manual and real-time stepping produce the same callback sequence', () => {
    const run = (drive) => {
        const c = started();
        const log = [];
        drive(c, (t) => log.push(t));
        return {log, tick: c.tick};
    };
    const realTime = run((c, cb) => feed(c, repeat(60, 1000 / 60), cb));
    const manual = run((c, cb) => c.stepTicks(60, cb));
    assert.deepEqual(manual, realTime);
});

test('snapshot is detached plain data', () => {
    const c = started();
    c.stepTicks(5);
    const s = c.snapshot();
    s.tick = 999;
    assert.equal(c.tick, 5);
    assert.deepEqual(JSON.parse(JSON.stringify(c.snapshot())), c.snapshot());
});

// ---- Purity ----------------------------------------------------------------

test('clock and RNG sources use no wall clock, timers, Math.random or Phaser', () => {
    for (const file of ['src/core/simulationClock.js', 'src/core/seededRandom.js']) {
        const src = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // ignore comments
        for (const banned of ['Date.now', 'performance.now', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'Math.random', 'phaser']) {
            assert.ok(!src.includes(banned), `${file} must not use ${banned}`);
        }
    }
});

// ---- Speed ------------------------------------------------------------------------

function runningClock(speed) {
    const c = new SimulationClock();
    c.start();
    c.setSpeed(speed);
    return c;
}

test('the approved speeds are 1, 2 and 4, starting at 1', () => {
    assert.deepEqual([...SIMULATION_SPEEDS], [1, 2, 4]);
    assert.ok(Object.isFrozen(SIMULATION_SPEEDS));
    assert.equal(new SimulationClock().speed, 1);
});

test('an invalid speed is rejected and changes nothing', () => {
    const c = runningClock(2);
    for (const bad of [0, 3, -1, 1.5, 8, NaN, Infinity, '2', null, undefined]) {
        assert.throws(() => c.setSpeed(bad), RangeError, String(bad));
    }
    assert.equal(c.speed, 2);
});

test('one real second runs 60, 120 or 240 ticks', () => {
    for (const [speed, expected] of [[1, 60], [2, 120], [4, 240]]) {
        const c = runningClock(speed);
        assert.equal(feed(c, repeat(60, 1000 / 60)), expected, `${speed}x at 60 FPS`);
        const slow = runningClock(speed);
        assert.equal(feed(slow, repeat(30, 1000 / 30)), expected, `${speed}x at 30 FPS`);
    }
});

test('the frame cap applies before the speed, so 4x still holds at low frame rates', () => {
    const atTenFps = runningClock(4);
    assert.equal(feed(atTenFps, repeat(10, 100)), 240);
    for (const [speed, expected] of [[1, 6], [2, 12], [4, 24]]) {
        const c = runningClock(speed);
        assert.equal(c.advance(2000), expected, `${speed}x`);
        assert.equal(c.advance(1), 0, `${speed}x: no backlog`);
    }
});

test('changing speed keeps the partial step and applies from the next frame', () => {
    const c = runningClock(1);
    assert.equal(c.advance(10), 0);
    c.setSpeed(4);
    assert.equal(c.tick, 0);
    assert.equal(c.advance(2), 1); // 10 ms kept, plus 8 ms
    c.setSpeed(1);
    assert.equal(c.advance(1000 / 60), 1);
});

test('manual stepping runs exactly the requested ticks at every speed, paused or not', () => {
    for (const speed of SIMULATION_SPEEDS) {
        const c = runningClock(speed);
        assert.equal(c.stepTicks(7), 7);
        c.pause();
        assert.equal(c.stepTicks(240), 240);
        assert.equal(c.tick, 247);
        assert.equal(c.paused, true);
    }
});

test('pause freezes every speed and discards the partial step', () => {
    for (const speed of SIMULATION_SPEEDS) {
        const c = runningClock(speed);
        c.advance(10 / speed + 1000 / 60 / speed);
        const before = c.tick;
        c.pause();
        assert.equal(c.advance(100), 0, `${speed}x`);
        assert.equal(c.tick, before);
        c.resume();
        assert.equal(c.advance(7 / speed), 0, `${speed}x: the remainder was discarded`);
    }
});

test('pausing inside a tick ends a multi-tick frame at once', () => {
    const c = runningClock(4);
    const ran = [];
    c.advance(100, (tick) => {
        ran.push(tick);
        if (tick === 4) c.pause();
    });
    assert.deepEqual(ran, [0, 1, 2, 3, 4]);
    assert.equal(c.tick, 5);
});

test('speed stays through pause and resume, and reset returns to 1', () => {
    const c = runningClock(4);
    c.pause();
    c.resume();
    assert.equal(c.speed, 4);
    c.reset();
    assert.equal(c.speed, 1);
});

test('the snapshot shape does not depend on speed', () => {
    assert.deepEqual(Object.keys(runningClock(4).snapshot()), ['running', 'paused', 'tick', 'timeSeconds']);
});
