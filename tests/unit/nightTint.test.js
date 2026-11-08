import test from 'node:test';
import assert from 'node:assert/strict';
import {NIGHT_TINT, nightTintAlpha} from '../../src/scenes/nightTint.js';

const at = (shift, {day = 2, timed = true, dusk = 0, dayTicks = 0} = {}) =>
    nightTintAlpha({shift, timed, day, elapsedDuskTicks: dusk, elapsedDayTicks: dayTicks});

test('the approved starting values, all in one place', () => {
    assert.deepEqual({...NIGHT_TINT}, {color: 0x18365c, alpha: 0.18, duskTicks: 300, dawnTicks: 120});
});

test('Day is clear, Night holds the tint, and a defeat keeps the last sight dark', () => {
    assert.equal(at('day', {dayTicks: 500}), 0);
    assert.equal(at('day', {day: 1}), 0, 'Day 1 has no Night before it');
    assert.equal(at('night'), NIGHT_TINT.alpha);
    assert.equal(at('defeated'), NIGHT_TINT.alpha);
    assert.equal(at(null), 0);
});

test('Dusk fades in over 300 ticks and dawn fades out over 120, smoothly and never past full', () => {
    assert.equal(at('dusk', {dusk: 0}), 0);
    assert.ok(Math.abs(at('dusk', {dusk: 150}) - NIGHT_TINT.alpha / 2) < 1e-12);
    assert.equal(at('dusk', {dusk: 300}), NIGHT_TINT.alpha);
    assert.equal(at('day', {dayTicks: 0}), NIGHT_TINT.alpha, 'dawn starts where Night left off');
    assert.ok(Math.abs(at('day', {dayTicks: 60}) - NIGHT_TINT.alpha / 2) < 1e-12);
    assert.equal(at('day', {dayTicks: 120}), 0);
    let previous = Infinity;
    for (let t = 0; t <= 120; t++) {
        const alpha = at('day', {dayTicks: t});
        assert.ok(alpha <= previous);
        previous = alpha;
    }
});

test('an untimed LEGACY Day never ticks, so it is simply clear', () => {
    assert.equal(at('day', {timed: false, dayTicks: 0}), 0);
});
