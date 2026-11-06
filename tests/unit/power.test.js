import test from 'node:test';
import assert from 'node:assert/strict';
import {calculatePower, PowerStatus, causesLowPower} from '../../src/core/power.js';
import {Grid} from '../../src/core/grid.js';
import {Economy} from '../../src/core/economy.js';
import {SimulationClock} from '../../src/core/simulationClock.js';
import {ShiftCycle, Shift} from '../../src/core/shiftCycle.js';
import {BuildingPlacement, CONSTRUCTION_DISABLED, UNKNOWN_BUILDING, INVALID_STATE} from '../../src/core/buildingPlacement.js';

let seq = 0;
const make = (type, enabled = true) => ({id: `${type}-${++seq}`, type, enabled});
const many = (type, n, enabled = true) => Array.from({length: n}, () => make(type, enabled));
const summary = ({generation, demand, status}) => ({generation, demand, status});

// ---- calculatePower ---------------------------------------------------------------

test('status values', () => {
    assert.deepEqual({...PowerStatus}, {NORMAL: 'normal', LOW_POWER: 'low-power', BLACKOUT: 'blackout'});
});

test('no buildings: 0 / 0 is NORMAL', () => {
    assert.deepEqual(calculatePower([]), {generation: 0, demand: 0, status: 'normal', buildings: []});
});

test('generation and demand sum enabled buildings', () => {
    const r = calculatePower([...many('powerPlant', 2), ...many('factory', 3), ...many('outpost', 4)]);
    assert.deepEqual(summary(r), {generation: 200, demand: 160, status: 'normal'});
});

test('exact capacity is NORMAL; one more consumer is LOW_POWER', () => {
    const exact = [make('powerPlant'), ...many('factory', 2), ...many('outpost', 2)]; // 100 vs 100
    assert.deepEqual(summary(calculatePower(exact)), {generation: 100, demand: 100, status: 'normal'});
    assert.ok(calculatePower(exact).buildings.every((b) => b.powered));

    const over = [...exact, make('outpost')]; // 100 vs 110
    const r = calculatePower(over);
    assert.deepEqual(summary(r), {generation: 100, demand: 110, status: 'low-power'});
    for (const b of r.buildings) {
        assert.equal(b.powered, b.type === 'powerPlant', `${b.id}: only the plant operates`);
    }
});

test('BLACKOUT: consumers without any generation', () => {
    const r = calculatePower([make('factory'), make('outpost')]);
    assert.deepEqual(summary(r), {generation: 0, demand: 50, status: 'blackout'});
    assert.ok(r.buildings.every((b) => !b.powered && b.enabled));
});

test('disabled generators produce nothing', () => {
    const r = calculatePower([make('powerPlant', false), make('factory')]);
    assert.deepEqual(summary(r), {generation: 0, demand: 40, status: 'blackout'});
    assert.deepEqual(r.buildings.map((b) => [b.type, b.enabled, b.powered]), [['powerPlant', false, false], ['factory', true, false]]);
});

test('disabled consumers draw nothing and never operate', () => {
    const r = calculatePower([make('powerPlant'), make('factory', false), make('outpost')]);
    assert.deepEqual(summary(r), {generation: 100, demand: 10, status: 'normal'});
    assert.deepEqual(r.buildings.map((b) => [b.type, b.powered]), [['powerPlant', true], ['factory', false], ['outpost', true]]);
});

test('only disabled consumers and no generation is NORMAL (nothing demanded)', () => {
    assert.equal(calculatePower([make('factory', false)]).status, 'normal');
});

test('disabling one consumer restores power to the whole base without touching other flags', () => {
    const base = [make('powerPlant'), ...many('factory', 2), ...many('outpost', 3)]; // 100 vs 110
    const before = calculatePower(base);
    assert.equal(before.status, PowerStatus.LOW_POWER);
    assert.ok(before.buildings.filter((b) => b.type !== 'powerPlant').every((b) => !b.powered));

    const switched = base.map((b, i) => (i === base.length - 1 ? {...b, enabled: false} : b));
    const after = calculatePower(switched);
    assert.deepEqual(summary(after), {generation: 100, demand: 100, status: 'normal'});
    for (const [i, b] of after.buildings.entries()) {
        if (i === base.length - 1) {
            assert.deepEqual([b.enabled, b.powered], [false, false]);
        } else {
            assert.equal(b.enabled, true, `${b.id} enabled flag untouched`);
            assert.equal(b.powered, true, `${b.id} now operating`);
        }
    }
});

test('blackout recovery: re-enabling the plant powers everything again', () => {
    const plant = make('powerPlant', false);
    const base = [plant, make('factory'), make('outpost')];
    assert.equal(calculatePower(base).status, 'blackout');
    plant.enabled = true;
    const r = calculatePower(base);
    assert.equal(r.status, 'normal');
    assert.ok(r.buildings.every((b) => b.powered));
});

test('enabled defaults to true when omitted', () => {
    assert.deepEqual(summary(calculatePower([{id: 'p', type: 'powerPlant'}, {id: 'f', type: 'factory'}])),
        {generation: 100, demand: 40, status: 'normal'});
});

test('deterministic and does not mutate its input', () => {
    const input = [make('powerPlant'), make('factory', false), make('outpost')];
    const copy = structuredClone(input);
    assert.deepEqual(calculatePower(input), calculatePower(input));
    assert.deepEqual(input, copy);
    const r = calculatePower(input);
    r.buildings[0].enabled = false;
    assert.equal(input[0].enabled, true);
});

test('unknown types and malformed input throw', () => {
    assert.throws(() => calculatePower([{id: 'x', type: 'tower'}]), TypeError);
    assert.throws(() => calculatePower([null]), TypeError);
    assert.throws(() => calculatePower('x'), TypeError);
});

// ---- Toggling through BuildingPlacement ---------------------------------------------

function world() {
    const clock = new SimulationClock();
    const economy = new Economy();
    const grid = new Grid({cols: 24, rows: 16, tileSize: 32});
    let cycle;
    const placement = new BuildingPlacement(grid, economy, {isConstructionAllowed: () => cycle.isConstructionAllowed});
    cycle = new ShiftCycle({clock, economy});
    cycle.begin();
    const place = (type, col, row) => {
        placement.select(type);
        const r = placement.placeAt({col, row});
        placement.cancel();
        assert.equal(r.ok, true);
        return r.building.id;
    };
    const night = () => {
        cycle.endDay();
        while (cycle.stepTicks(240, (t) => cycle.onTick(t)) > 0) { /* complete the night */ }
    };
    return {clock, economy, grid, placement, cycle, place, night};
}

test('placed buildings start enabled', () => {
    const w = world();
    const id = w.place('factory', 5, 5);
    assert.equal(w.placement.buildings().find((b) => b.id === id).enabled, true);
});

test('toggling costs no Credits or AP and leaves the grid unchanged', () => {
    const w = world();
    const plant = w.place('powerPlant', 5, 5);
    const factory = w.place('factory', 10, 5);
    const economy = w.economy.snapshot();
    const grid = w.grid.snapshot();

    assert.deepEqual(w.placement.setEnabled(plant, false), {
        ok: true, building: {id: plant, type: 'powerPlant', col: 4, row: 4, width: 3, height: 3, enabled: false, hp: 300},
    });
    assert.equal(w.placement.setEnabled(factory, false).ok, true);
    assert.equal(w.placement.setEnabled(factory, true).ok, true);

    assert.deepEqual(w.economy.snapshot(), economy);
    assert.deepEqual(w.grid.snapshot(), grid);
    assert.equal(w.grid.occupantAt(5, 5), plant);
});

test('toggling immediately changes the derived power state', () => {
    const w = world();
    const plant = w.place('powerPlant', 5, 5);
    w.place('factory', 10, 5);
    assert.equal(calculatePower(w.placement.buildings()).status, 'normal');
    w.placement.setEnabled(plant, false);
    assert.equal(calculatePower(w.placement.buildings()).status, 'blackout');
    w.placement.setEnabled(plant, true);
    assert.equal(calculatePower(w.placement.buildings()).status, 'normal');
});

test('toggling is allowed during Night Shift, while construction stays disabled', () => {
    const w = world();
    const plant = w.place('powerPlant', 5, 5);
    const factory = w.place('factory', 10, 5);
    w.cycle.endDay();
    assert.equal(w.cycle.shift, Shift.NIGHT);
    const economy = w.economy.snapshot();
    const grid = w.grid.snapshot();

    assert.equal(w.placement.setEnabled(factory, false).ok, true);
    assert.equal(w.placement.setEnabled(plant, false).ok, true);
    assert.equal(calculatePower(w.placement.buildings()).status, 'normal'); // nothing enabled draws power
    assert.equal(w.placement.setEnabled(factory, true).ok, true);
    assert.equal(calculatePower(w.placement.buildings()).status, 'blackout');

    assert.equal(w.placement.select('outpost'), false);
    assert.equal(w.placement.selectedType, null);
    assert.deepEqual(w.economy.snapshot(), economy);
    assert.deepEqual(w.grid.snapshot(), grid);
});

test('construction is still rejected at night even with a type selected', () => {
    const w = world();
    w.placement.select('outpost');
    w.cycle.endDay();
    assert.equal(w.placement.placeAt({col: 1, row: 1}).reason, CONSTRUCTION_DISABLED);
});

test('toggle state persists across Day/Night transitions', () => {
    const w = world();
    const plant = w.place('powerPlant', 5, 5);
    w.placement.setEnabled(plant, false);
    w.night();
    assert.equal(w.cycle.day, 2);
    assert.equal(w.placement.buildings()[0].enabled, false);
    w.placement.setEnabled(plant, true);
    w.night();
    assert.equal(w.placement.buildings()[0].enabled, true);
});

test('setEnabled rejects unknown ids and non-boolean states without changes', () => {
    const w = world();
    const plant = w.place('powerPlant', 5, 5);
    const before = JSON.stringify(w.placement.buildings());
    assert.deepEqual(w.placement.setEnabled('ghost-1', false), {ok: false, reason: UNKNOWN_BUILDING});
    for (const bad of [0, 1, 'false', null, undefined]) {
        assert.deepEqual(w.placement.setEnabled(plant, bad), {ok: false, reason: INVALID_STATE}, String(bad));
    }
    assert.equal(JSON.stringify(w.placement.buildings()), before);
});

test('setting the current state again succeeds without change', () => {
    const w = world();
    const plant = w.place('powerPlant', 5, 5);
    const before = JSON.stringify(w.placement.buildings());
    assert.equal(w.placement.setEnabled(plant, true).ok, true);
    assert.equal(JSON.stringify(w.placement.buildings()), before);
});

test('setEnabled returns and buildings() exposes detached copies', () => {
    const w = world();
    const plant = w.place('powerPlant', 5, 5);
    const {building} = w.placement.setEnabled(plant, false);
    building.enabled = true;
    w.placement.buildings()[0].enabled = true;
    assert.equal(w.placement.buildings()[0].enabled, false);
});

test('placement stays atomic: rejected placements never add records or flags', () => {
    const w = world();
    const plant = w.place('powerPlant', 5, 5);
    w.place('factory', 10, 5); // 100 Credits left
    w.placement.setEnabled(plant, false);
    const before = JSON.stringify({b: w.placement.buildings(), g: w.grid.snapshot(), e: w.economy.snapshot()});
    w.placement.select('factory');
    assert.equal(w.placement.placeAt({col: 5, row: 5}).reason, 'occupied');
    assert.equal(w.placement.placeAt({col: 0, row: 0}).reason, 'out-of-bounds');
    assert.equal(w.placement.placeAt({col: 15, row: 10}).reason, 'insufficient-credits');
    assert.equal(JSON.stringify({b: w.placement.buildings(), g: w.grid.snapshot(), e: w.economy.snapshot()}), before);
});

// ---- Warning before a purchase ----------------------------------------------

const types = (...list) => list.map((type, i) => ({id: `${type}-${i}`, type}));

test('only a move from NORMAL to LOW_POWER counts', () => {
    assert.equal(causesLowPower(types('hq'), 'factory'), true, '20 against 40');
    assert.equal(causesLowPower(types('hq'), 'autocannon'), false, 'exactly enough');
    assert.equal(causesLowPower(types('hq', 'autocannon'), 'autocannon'), true);
    assert.equal(causesLowPower(types('hq'), 'wall'), false, 'no demand');
    assert.equal(causesLowPower(types('hq'), 'powerPlant'), false, 'supply');
});

test('it stays quiet when power is already down, or nothing generates at all', () => {
    assert.equal(causesLowPower(types('hq', 'factory'), 'autocannon'), false, 'already LOW_POWER');
    assert.equal(causesLowPower([], 'factory'), false, 'that would be BLACKOUT, not LOW_POWER');
});

test('it counts what is switched on, and changes nothing', () => {
    const list = [...types('hq', 'powerPlant', 'factory', 'factory'), {id: 'x', type: 'factory', enabled: false}];
    assert.equal(causesLowPower(list, 'factory'), false, 'with the switched-off one ignored, 120 against 120');
    list.at(-1).enabled = true;
    assert.equal(causesLowPower(list, 'autocannon'), true, '120 against 140');
    assert.equal(list.length, 5);
});
