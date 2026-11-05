import test from 'node:test';
import assert from 'node:assert/strict';
import {Economy} from '../../src/core/economy.js';
import {createEconomyQa} from '../../src/testShadow/economyQa.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {createWorld} from '../soak/harness.js';

function fixture({credits = 1250, ap = 3} = {}) {
    const scene = {economy: new Economy({credits, ap}), hudUpdates: 0, updateHud() { this.hudUpdates++; }};
    return {scene, qa: createEconomyQa(scene)};
}

test('setCredits sets the real balance, refreshes the HUD and returns the balance', () => {
    const {scene, qa} = fixture();
    assert.equal(qa.setCredits(10000), 10000);
    assert.equal(scene.economy.credits, 10000);
    assert.equal(scene.hudUpdates, 1);
    assert.equal(qa.setCredits(0), 0);
    assert.equal(qa.setCredits(-50), -50, 'debt is a real game state');
});

test('addCredits adjusts the real balance and returns the balance', () => {
    const {scene, qa} = fixture();
    assert.equal(qa.addCredits(5000), 6250);
    assert.equal(qa.addCredits(-250), 6000);
    assert.equal(scene.economy.credits, 6000);
    assert.equal(scene.hudUpdates, 2);
});

test('neither touches AP', () => {
    const {scene, qa} = fixture({ap: 3});
    qa.setCredits(10);
    qa.addCredits(10);
    assert.equal(scene.economy.ap, 3);
});

for (const bad of [NaN, Infinity, -Infinity, 1.5, '100', null, undefined, {}, Number.MAX_SAFE_INTEGER + 1]) {
    test(`an invalid amount is rejected and changes nothing: ${String(bad)}`, () => {
        const {scene, qa} = fixture();
        assert.throws(() => qa.setCredits(bad), RangeError);
        assert.throws(() => qa.addCredits(bad), RangeError);
        assert.equal(scene.economy.credits, 1250);
        assert.equal(scene.hudUpdates, 0);
    });
}

test('a balance outside the safe range is rejected and changes nothing', () => {
    const {scene, qa} = fixture();
    qa.setCredits(Number.MAX_SAFE_INTEGER);
    assert.throws(() => qa.addCredits(1), RangeError);
    assert.equal(scene.economy.credits, Number.MAX_SAFE_INTEGER);
});

test('in debt every purchase is refused, and leaves the debt as it was', () => {
    const w = createWorld({resources: {credits: 5000, ap: 5}, requireHq: true, roads: true});
    assert.equal(w.place('hq', 12, 8).ok, true);
    const qa = createEconomyQa({economy: w.economy, updateHud() {}});
    assert.equal(qa.setCredits(-200), -200);
    for (const type of ['wall', 'outpost', 'autocannon']) assert.equal(w.place(type, 3, 3).reason, 'insufficient-credits');
    assert.deepEqual(w.economy.snapshot(), {credits: -200, ap: 5});
    assert.equal(w.placement.placeRoad({col: 9, row: 8}).ok, true, 'roads are free, so debt does not stop them');
    assert.deepEqual(w.placement.buildings().map((b) => b.type), ['hq']);
    assert.equal(qa.addCredits(225), 25);
    assert.equal(w.place('wall', 3, 3).ok, true, 'out of debt, the same purchase works');
});

test('deliveries bring a debt back toward positive, 30 Credits at a time', () => {
    const w = createWorld({resources: {credits: 5000, ap: 10}, requireHq: true, roads: true, schedule: []});
    assert.equal(w.place('hq', 12, 8).ok, true);
    assert.equal(w.place('powerPlant', 20, 3).ok, true);
    assert.equal(w.place('factory', 8, 8).ok, true);
    const qa = createEconomyQa({economy: w.economy, updateHud() {}});
    qa.setCredits(-40);
    const seen = [];
    w.cycle.endDay();
    while (w.cycle.shift === Shift.NIGHT) {
        w.cycle.stepTicks(1, w.tick);
        if (seen.at(-1) !== w.economy.credits) seen.push(w.economy.credits);
    }
    assert.deepEqual(seen, [-40, -10, 20, 50, 80, 110]);
});

test('before Start there is no economy to change', () => {
    const qa = createEconomyQa({economy: null, updateHud() {}});
    assert.throws(() => qa.setCredits(100), /after Start/);
    assert.throws(() => qa.addCredits(100), /after Start/);
});
