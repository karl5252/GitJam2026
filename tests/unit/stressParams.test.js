import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStressSchedule, parseStressSpitters} from '../../src/testShadow/stressParams.js';
import {spitterSlots, waveSchedule} from '../../src/core/waves.js';

test('waveSpitters picks the real slots of a waveBudget schedule, and means nothing alone', () => {
    assert.deepEqual(parseStressSpitters('?waveBudget=12&waveSpitters=3'), [...spitterSlots(12, 3)]);
    assert.deepEqual(parseStressSpitters('?waveBudget=1&waveSpitters=1'), [0]);
    assert.deepEqual(parseStressSpitters('?waveBudget=5'), []);
    assert.deepEqual(parseStressSpitters('?waveSpitters=3'), []);
    assert.deepEqual(parseStressSpitters('?stressRamp=10&waveBudget=5&waveSpitters=1'), [], 'a ramp is a different schedule');
    for (const bad of ['6', '-1', 'x', '']) assert.deepEqual(parseStressSpitters(`?waveBudget=5&waveSpitters=${bad}`), [], bad);
});

test('no parameters means no override', () => {
    assert.equal(parseStressSchedule(''), null);
    assert.equal(parseStressSchedule('?testMode&seed=5'), null);
});

test('waveBudget uses the real wave schedule', () => {
    assert.deepEqual(parseStressSchedule('?waveBudget=20'), [...waveSchedule(20)]);
    assert.deepEqual(parseStressSchedule('?waveBudget=40'), [...waveSchedule(40)]);
    assert.deepEqual(parseStressSchedule('?waveBudget=1'), [600]);
    assert.deepEqual(parseStressSchedule('?waveBudget=0'), []);
});

test('waveLastTick ends the real schedule on that tick', () => {
    assert.deepEqual(parseStressSchedule('?waveBudget=40&waveLastTick=1200'), [...waveSchedule(40, 1200)]);
    assert.deepEqual(parseStressSchedule('?waveBudget=4&waveLastTick=2600'), [600, 1711, 2377, 2600]);
});

test('waveLastTick outside the approved windows is ignored, and it does nothing alone', () => {
    for (const tick of ['1199', '2701', '-1', '1200.5', 'x', '']) {
        assert.deepEqual(parseStressSchedule(`?waveBudget=40&waveLastTick=${tick}`), [...waveSchedule(40)], tick);
    }
    assert.equal(parseStressSchedule('?waveLastTick=1200'), null);
});

test('stressRamp spawns one mutant per tick from tick 1', () => {
    assert.deepEqual(parseStressSchedule('?stressRamp=3'), [1, 2, 3]);
    assert.equal(parseStressSchedule('?stressRamp=3599').length, 3599);
});

test('stressRamp wins when both are present', () => {
    assert.deepEqual(parseStressSchedule('?waveBudget=20&stressRamp=2'), [1, 2]);
});

test('invalid values are ignored', () => {
    for (const query of ['?waveBudget=41', '?waveBudget=-1', '?waveBudget=1.5', '?waveBudget=x', '?waveBudget=', '?stressRamp=0', '?stressRamp=3600', '?stressRamp=-5', '?stressRamp=2e3']) {
        assert.equal(parseStressSchedule(query), null, query);
    }
});
