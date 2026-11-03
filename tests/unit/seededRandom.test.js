import test from 'node:test';
import assert from 'node:assert/strict';
import {SeededRandom, DEFAULT_SEED, parseSeed} from '../../src/core/seededRandom.js';
import {SimulationClock} from '../../src/core/simulationClock.js';

const draw = (rng, n) => Array.from({length: n}, () => rng.next());

test('matches the Refit/BarrelStorm LCG exactly', () => {
    const rng = new SeededRandom(731);
    let s = 731;
    for (let i = 0; i < 100; i++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        assert.equal(rng.next(), s / 4294967296);
        assert.equal(rng.state, s);
    }
});

test('default seed', () => {
    assert.equal(DEFAULT_SEED, 731);
    assert.deepEqual(new SeededRandom().snapshot(), {seed: 731, state: 731});
});

test('identical seeds produce identical sequences', () => {
    assert.deepEqual(draw(new SeededRandom(42), 1000), draw(new SeededRandom(42), 1000));
});

test('different seeds produce different sequences', () => {
    const a = draw(new SeededRandom(1), 50);
    const b = draw(new SeededRandom(2), 50);
    assert.notDeepEqual(a, b);
    assert.notEqual(a[0], b[0]);
});

test('next() stays in [0, 1)', () => {
    for (const seed of [0, 1, 731, 0xFFFFFFFF]) {
        for (const v of draw(new SeededRandom(seed), 5000)) {
            assert.ok(v >= 0 && v < 1, `seed ${seed}: ${v}`);
        }
    }
});

test('reset() restarts the sequence from the original seed', () => {
    const rng = new SeededRandom(99);
    const first = draw(rng, 20);
    assert.notEqual(rng.state, 99);
    rng.reset();
    assert.deepEqual(rng.snapshot(), {seed: 99, state: 99});
    assert.deepEqual(draw(rng, 20), first);
});

test('nextInt is inclusive, covers the whole range and is deterministic', () => {
    const rng = new SeededRandom(5);
    const seen = new Set();
    for (let i = 0; i < 2000; i++) {
        const v = rng.nextInt(-3, 3);
        assert.ok(Number.isInteger(v) && v >= -3 && v <= 3);
        seen.add(v);
    }
    assert.equal(seen.size, 7);
    assert.equal(new SeededRandom(5).nextInt(7, 7), 7);
    const a = new SeededRandom(8);
    const b = new SeededRandom(8);
    for (let i = 0; i < 100; i++) assert.equal(a.nextInt(0, 99), b.nextInt(0, 99));
});

test('nextInt rejects invalid bounds without consuming state', () => {
    const rng = new SeededRandom(5);
    for (const [min, max] of [[3, 1], [0.5, 2], [0, NaN], ['0', 5], [0, 2 ** 60]]) {
        assert.throws(() => rng.nextInt(min, max), RangeError, `${min}..${max}`);
    }
    assert.equal(rng.state, 5);
});

test('constructor rejects invalid seeds', () => {
    for (const bad of [-1, 1.5, 2 ** 32, NaN, Infinity, '7', null]) {
        assert.throws(() => new SeededRandom(bad), RangeError, String(bad));
    }
});

test('state is read-only; snapshot is detached', () => {
    const rng = new SeededRandom(3);
    assert.throws(() => { rng.state = 0; }, TypeError);
    const snap = rng.snapshot();
    snap.state = 0;
    assert.equal(rng.state, 3);
});

test('parseSeed accepts uint32 decimal strings and rejects everything else', () => {
    assert.equal(parseSeed('0'), 0);
    assert.equal(parseSeed('42'), 42);
    assert.equal(parseSeed(' 7 '), 7);
    assert.equal(parseSeed('4294967295'), 4294967295);
    for (const bad of [null, undefined, '', 'abc', '-1', '1.5', '1e3', '4294967296', '0x10', 42]) {
        assert.equal(parseSeed(bad), null, String(bad));
    }
});

// ---- Determinism with the clock ---------------------------------------------

test('same seed + same tick sequence -> same outcome, independent of frame pattern', () => {
    const simulate = (frameDeltas) => {
        const clock = new SimulationClock();
        const rng = new SeededRandom(1234);
        const outcomes = [];
        clock.start();
        for (const d of frameDeltas) {
            clock.advance(d, (tick) => outcomes.push([tick, rng.nextInt(1, 6)]));
        }
        return {outcomes, rng: rng.snapshot(), tick: clock.tick};
    };
    const at60 = simulate(Array.from({length: 120}, () => 1000 / 60));
    const at30 = simulate(Array.from({length: 60}, () => 1000 / 30));
    const raggedDeltas = [100, 100, 50, 50, 100, 33, 67, ...Array.from({length: 15}, () => 100)];
    assert.equal(raggedDeltas.reduce((a, b) => a + b), 2000);
    const ragged = simulate(raggedDeltas);
    assert.equal(at60.tick, 120);
    assert.deepEqual(at30, at60);
    assert.deepEqual(ragged, at60);

    const manual = (() => {
        const clock = new SimulationClock();
        const rng = new SeededRandom(1234);
        const outcomes = [];
        clock.start();
        clock.stepTicks(120, (tick) => outcomes.push([tick, rng.nextInt(1, 6)]));
        return {outcomes, rng: rng.snapshot(), tick: clock.tick};
    })();
    assert.deepEqual(manual, at60);
});
