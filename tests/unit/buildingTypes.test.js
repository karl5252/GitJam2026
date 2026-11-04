import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILDING_TYPES, getBuildingType} from '../../src/core/buildingTypes.js';

test('defines outpost (1x1), factory (3x3) and power plant (3x3)', () => {
    assert.deepEqual(Object.keys(BUILDING_TYPES), ['outpost', 'factory', 'powerPlant']);
    assert.deepEqual(BUILDING_TYPES.outpost, {
        id: 'outpost', name: 'Outpost', width: 1, height: 1,
        cost: {credits: 100, ap: 1}, operations: {income: 0, upkeep: 20}, power: {supply: 0, demand: 10},
        pollutionPerNight: 0,
        maxHp: 100,
    });
    assert.deepEqual(BUILDING_TYPES.factory, {
        id: 'factory', name: 'Factory', width: 3, height: 3,
        cost: {credits: 400, ap: 1}, operations: {income: 150, upkeep: 0}, power: {supply: 0, demand: 40},
        pollutionPerNight: 8,
        maxHp: 300,
    });
    assert.deepEqual(BUILDING_TYPES.powerPlant, {
        id: 'powerPlant', name: 'Power Plant', width: 3, height: 3,
        cost: {credits: 500, ap: 1}, operations: {income: 0, upkeep: 0}, power: {supply: 100, demand: 0},
        pollutionPerNight: 12,
        maxHp: 300,
    });
});

test('definitions and costs are frozen', () => {
    assert.ok(Object.isFrozen(BUILDING_TYPES));
    for (const type of Object.values(BUILDING_TYPES)) {
        assert.ok(Object.isFrozen(type));
        assert.ok(Object.isFrozen(type.cost));
        assert.ok(Object.isFrozen(type.operations));
        assert.ok(Object.isFrozen(type.power));
    }
    assert.throws(() => { BUILDING_TYPES.outpost.width = 5; }, TypeError);
    assert.throws(() => { BUILDING_TYPES.factory.cost.credits = 0; }, TypeError);
});

test('getBuildingType returns the definition or null', () => {
    assert.equal(getBuildingType('outpost'), BUILDING_TYPES.outpost);
    assert.equal(getBuildingType('factory'), BUILDING_TYPES.factory);
    for (const bad of ['tower', '', undefined, null, 'toString', '__proto__']) {
        assert.equal(getBuildingType(bad), null, String(bad));
    }
});
