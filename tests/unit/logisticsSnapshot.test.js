import test from 'node:test';
import assert from 'node:assert/strict';
import {LOGISTICS} from '../../src/core/logistics.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {canonicalState, createWorld, digestOf, worldState} from '../soak/harness.js';

/**
 * Logistics.snapshot() only reads. Records follow the Factories at two explicit
 * moments, placement and removal by Day and step() by Night, so the browser game,
 * which reads every frame, and the harness, which hardly ever does, cannot differ.
 *
 * HQ at pointer 12,8 has its ring on 10-14, 6-10. The west road runs along row 8
 * to a Factory at pointer 3,8, dock 5,8, and on south to one at pointer 3,12.
 */

const FUNDS = {credits: 100_000, ap: 200};

function base({schedule = [], seed = 731} = {}) {
    const w = createWorld({seed, resources: FUNDS, requireHq: true, roads: true, schedule});
    assert.equal(w.place('hq', 12, 8).ok, true);
    assert.equal(w.place('powerPlant', 20, 3).ok, true);
    for (const [col, row] of [[9, 8], [8, 8], [7, 8], [6, 8], [5, 8], [5, 9], [5, 10], [5, 11], [5, 12]]) {
        assert.equal(w.placement.placeRoad({col, row}).ok, true);
    }
    return {w, first: w.place('factory', 3, 8).building.id, second: w.place('factory', 3, 12).building.id};
}

const step = (w, ticks, each = () => {}) => {
    for (let i = 0; i < ticks && w.cycle.shift === Shift.NIGHT; i++) {
        w.cycle.stepTicks(1, w.tick);
        each();
    }
};

const read = (w) => JSON.stringify(w.logistics.snapshot());

test('reading twice gives the same answer, by Day and at Night', () => {
    const {w} = base();
    assert.equal(read(w), read(w));
    w.cycle.endDay();
    step(w, 700);
    assert.equal(read(w), read(w));
});

test('a snapshot is detached', () => {
    const {w} = base();
    const before = read(w);
    const snapshot = w.logistics.snapshot();
    snapshot.trucks[0].hp = 1;
    snapshot.trucks.length = 0;
    snapshot.factories[0].stored = 9;
    snapshot.totals.cargoLost = 9;
    assert.equal(read(w), before);
});

test('by Day a Factory has its truck the moment it stands, and loses it the moment it goes', () => {
    const {w, first} = base();
    assert.deepEqual(w.logistics.snapshot().trucks.map((t) => t.factoryId), [first, `factory-${Number(first.split('-')[1]) + 1}`]);
    w.placement.demolish(first);
    assert.equal(w.logistics.snapshot().trucks.length, 1);
    assert.equal(w.logistics.snapshot().factories.length, 1);
});

test('reading never orphans: a Factory destroyed at Night is dealt with by the next step', () => {
    const {w, first} = base();
    w.cycle.endDay();
    step(w, 100);
    assert.equal(w.placement.damageBuilding(first, 300).destroyed, true);

    const trucks = w.logistics.snapshot().trucks.length;
    const {cargoLost} = w.logistics.snapshot().totals;
    for (let i = 0; i < 5; i++) w.logistics.snapshot();
    assert.equal(w.logistics.snapshot().trucks.length, trucks, 'still there until the simulation says otherwise');
    assert.equal(w.logistics.snapshot().totals.cargoLost, cargoLost);
    assert.equal(w.logistics.snapshot().factories.some((f) => f.id === first), false, 'a fallen Factory is not reported');

    step(w, 1);
    assert.equal(w.logistics.snapshot().trucks.length, trucks - 1);
});

test('mutants can still reach a truck whose Factory fell on the same tick', () => {
    const {w, first} = base({schedule: [1]});
    w.cycle.endDay();
    step(w, 50);
    const [truck] = w.logistics.attackableTrucks();
    w.placement.damageBuilding(first, 300); // at Night nothing moves until Logistics steps
    assert.deepEqual(w.logistics.damageTruck(truck.id, 1), {ok: true, destroyed: false, hp: LOGISTICS.truckHp - 1});
});

/** Two Nights with truck losses, a Night destruction and a Day demolition. */
function fullRun(look) {
    const {w, first, second} = base({schedule: [100, 400, 900, 1500, 2100]});
    look(w);
    w.cycle.endDay();
    step(w, 1000, () => look(w));
    const [truck] = w.logistics.attackableTrucks();
    if (truck) w.logistics.damageTruck(truck.id, LOGISTICS.truckHp);
    look(w);
    step(w, 1000, () => look(w));
    w.placement.damageBuilding(first, 300);
    look(w);
    step(w, 3600, () => look(w));
    look(w);
    w.placement.demolish(second);
    look(w);
    assert.equal(w.place('factory', 3, 8).ok, true);
    look(w);
    w.cycle.endDay();
    step(w, 3600, () => look(w));
    return {
        digest: digestOf(canonicalState(worldState(w))),
        logistics: w.logistics.snapshot(),
        credits: w.economy.credits,
        pollution: w.pollution.value,
    };
}

test('a run read every tick is the same run as one never read', () => {
    const quiet = fullRun(() => {});
    const watched = fullRun((w) => {
        for (let i = 0; i < 3; i++) w.logistics.snapshot();
    });
    assert.deepEqual(watched, quiet);
    assert.ok(quiet.logistics.totals.loads > 0, 'the run must do something');
});

test('cargo-loss accounting does not depend on when anyone looks', () => {
    const account = (look) => {
        const {w, first} = base();
        w.cycle.endDay();
        step(w, 2999);
        w.logistics.damageTruck(`truck-${first}`, LOGISTICS.truckHp);
        step(w, 3600, look ? () => w.logistics.snapshot() : () => {});
        if (look) w.logistics.snapshot();
        w.placement.demolish(first);
        if (look) w.logistics.snapshot();
        const atDay = w.logistics.snapshot();
        w.cycle.endDay();
        step(w, 3600, look ? () => w.logistics.snapshot() : () => {});
        return {night: atDay.night, totals: atDay.totals, last: w.logistics.lastNight, end: w.logistics.snapshot().totals};
    };
    const quiet = account(false);
    assert.deepEqual(account(true), quiet);
    assert.ok(quiet.totals.cargoLost > 0, 'the demolition counts in the totals');
    assert.equal(quiet.night.cargoLost, 0, 'not in the Night just finished');
    assert.equal(quiet.last.cargoLost, 0, 'nor in the next');
    assert.equal(quiet.end.cargoLost, quiet.totals.cargoLost, 'and only once');
});

test('a load lost with a Factory at Night still belongs to that Night, even at dawn', () => {
    const {w, first} = base();
    w.cycle.endDay();
    step(w, 2990);
    w.logistics.damageTruck(`truck-${first}`, LOGISTICS.truckHp); // back on tick 3590, then out with a load
    step(w, 605);
    const truck = w.logistics.snapshot().trucks.find((t) => t.factoryId === first);
    assert.deepEqual([truck.state, truck.cargo], ['outbound', 1]);
    w.placement.damageBuilding(first, 300);
    const before = w.logistics.snapshot().night.cargoLost;
    step(w, 5);
    assert.equal(w.cycle.shift, Shift.DAY);
    assert.ok(w.logistics.lastNight.cargoLost > before, 'the truck never arrived');
    assert.equal(w.logistics.lastNight.cargoLost, w.logistics.snapshot().night.cargoLost);
});

test('a Factory built and demolished in one Day leaves nothing', () => {
    const {w} = base();
    const trucks = w.logistics.snapshot().trucks.length;
    const {cargoLost} = w.logistics.snapshot().totals;
    assert.equal(w.placement.placeRoad({col: 5, row: 7}).ok, true);
    assert.equal(w.placement.placeRoad({col: 5, row: 6}).ok, true);
    assert.equal(w.placement.placeRoad({col: 5, row: 5}).ok, true);
    const {id} = w.place('factory', 3, 5).building;
    assert.equal(w.logistics.snapshot().trucks.length, trucks + 1);
    w.placement.demolish(id);
    assert.equal(w.logistics.snapshot().trucks.length, trucks);
    assert.equal(w.logistics.snapshot().totals.cargoLost, cargoLost);
});
