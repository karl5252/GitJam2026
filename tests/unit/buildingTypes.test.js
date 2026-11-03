import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILDING_TYPES, getBuildingType} from '../../src/core/buildingTypes.js';

test('defines outpost (1x1) and factory (3x3)', () => {
    assert.deepEqual(Object.keys(BUILDING_TYPES), ['outpost', 'factory']);
    assert.deepEqual({...BUILDING_TYPES.outpost}, {id: 'outpost', name: 'Outpost', width: 1, height: 1});
    assert.deepEqual({...BUILDING_TYPES.factory}, {id: 'factory', name: 'Factory', width: 3, height: 3});
});

test('definitions are frozen', () => {
    assert.ok(Object.isFrozen(BUILDING_TYPES));
    for (const type of Object.values(BUILDING_TYPES)) assert.ok(Object.isFrozen(type));
    assert.throws(() => { BUILDING_TYPES.outpost.width = 5; }, TypeError);
});

test('getBuildingType returns the definition or null', () => {
    assert.equal(getBuildingType('outpost'), BUILDING_TYPES.outpost);
    assert.equal(getBuildingType('factory'), BUILDING_TYPES.factory);
    for (const bad of ['tower', '', undefined, null, 'toString', '__proto__']) {
        assert.equal(getBuildingType(bad), null, String(bad));
    }
});
