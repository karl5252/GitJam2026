import test from 'node:test';
import assert from 'node:assert/strict';
import {Economy, EconomyFailure, STARTING_RESOURCES} from '../../src/core/economy.js';

test('starts with 1000 credits and 5 AP by default', () => {
    assert.deepEqual({...STARTING_RESOURCES}, {credits: 1000, ap: 5});
    assert.ok(Object.isFrozen(STARTING_RESOURCES));
    const e = new Economy();
    assert.equal(e.credits, 1000);
    assert.equal(e.ap, 5);
    assert.deepEqual(e.snapshot(), {credits: 1000, ap: 5});
});

test('accepts custom non-negative integer balances, including zero', () => {
    assert.deepEqual(new Economy({credits: 0, ap: 0}).snapshot(), {credits: 0, ap: 0});
    assert.deepEqual(new Economy({credits: 50, ap: 2}).snapshot(), {credits: 50, ap: 2});
});

test('constructor rejects invalid balances', () => {
    for (const bad of [-1, 1.5, NaN, Infinity, '10', undefined, null]) {
        assert.throws(() => new Economy({credits: bad, ap: 5}), RangeError, `credits=${bad}`);
        assert.throws(() => new Economy({credits: 100, ap: bad}), RangeError, `ap=${bad}`);
    }
});

test('balances are read-only', () => {
    const e = new Economy();
    assert.throws(() => { e.credits = 99999; }, TypeError);
    assert.throws(() => { e.ap = 99; }, TypeError);
    assert.deepEqual(e.snapshot(), {credits: 1000, ap: 5});
});

test('canAfford reports affordability and never mutates', () => {
    const e = new Economy({credits: 100, ap: 1});
    assert.deepEqual(e.canAfford({credits: 100, ap: 1}), {ok: true});
    assert.deepEqual(e.canAfford({credits: 0, ap: 0}), {ok: true});
    assert.deepEqual(e.canAfford({credits: 101, ap: 1}), {ok: false, reason: EconomyFailure.INSUFFICIENT_CREDITS});
    assert.deepEqual(e.canAfford({credits: 100, ap: 2}), {ok: false, reason: EconomyFailure.INSUFFICIENT_AP});
    assert.deepEqual(e.snapshot(), {credits: 100, ap: 1});
});

test('when both resources are short, insufficient-credits is reported first', () => {
    const e = new Economy({credits: 10, ap: 0});
    assert.deepEqual(e.canAfford({credits: 100, ap: 1}), {ok: false, reason: EconomyFailure.INSUFFICIENT_CREDITS});
});

test('spend deducts both resources exactly once', () => {
    const e = new Economy();
    assert.deepEqual(e.spend({credits: 400, ap: 1}), {ok: true});
    assert.deepEqual(e.snapshot(), {credits: 600, ap: 4});
    assert.deepEqual(e.spend({credits: 100, ap: 1}), {ok: true});
    assert.deepEqual(e.snapshot(), {credits: 500, ap: 3});
});

test('spend can drain balances to exactly zero', () => {
    const e = new Economy({credits: 100, ap: 1});
    assert.deepEqual(e.spend({credits: 100, ap: 1}), {ok: true});
    assert.deepEqual(e.snapshot(), {credits: 0, ap: 0});
});

test('rejected spends leave balances unchanged (no partial deduction)', () => {
    const e = new Economy({credits: 500, ap: 1});
    assert.deepEqual(e.spend({credits: 600, ap: 1}), {ok: false, reason: EconomyFailure.INSUFFICIENT_CREDITS});
    assert.deepEqual(e.spend({credits: 100, ap: 2}), {ok: false, reason: EconomyFailure.INSUFFICIENT_AP});
    assert.deepEqual(e.snapshot(), {credits: 500, ap: 1});
});

test('invalid costs are rejected with invalid-cost and change nothing', () => {
    const e = new Economy();
    const bad = [
        null, undefined, 5, 'x',
        {}, {credits: 100}, {ap: 1},
        {credits: -100, ap: 1}, {credits: 100, ap: -1},
        {credits: 1.5, ap: 1}, {credits: 100, ap: NaN}, {credits: '100', ap: 1},
    ];
    for (const cost of bad) {
        assert.deepEqual(e.canAfford(cost), {ok: false, reason: EconomyFailure.INVALID_COST}, JSON.stringify(cost));
        assert.deepEqual(e.spend(cost), {ok: false, reason: EconomyFailure.INVALID_COST}, JSON.stringify(cost));
    }
    assert.deepEqual(e.snapshot(), {credits: 1000, ap: 5});
});

test('snapshot is detached', () => {
    const e = new Economy();
    const snap = e.snapshot();
    snap.credits = 0;
    snap.ap = 0;
    assert.deepEqual(e.snapshot(), {credits: 1000, ap: 5});
    assert.notEqual(e.snapshot(), e.snapshot());
});
