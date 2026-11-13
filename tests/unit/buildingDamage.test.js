import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILDING_TYPES} from '../../src/core/buildingTypes.js';
import {DAMAGE_THRESHOLDS, BUILDING_FX_SHEETS, buildingFxFrame, buildingFxKinds, damageFrame, speakerLampOn} from '../../src/scenes/buildingDamage.js';
import {BUILDING_FX_ANCHORS, buildingFxPosition, buildingFxKey, speakerLampPosition} from '../../src/scenes/BuildingDamageLayer.js';

const b = (type, hp, extra = {}) => ({type, id: `${type}-1`, hp, enabled: true, col: 0, row: 0, width: 1, height: 1, ...extra});
const max = (type) => BUILDING_TYPES[type].maxHp;

test('HP thresholds use real per-building max HP, include exact boundaries and heal in both directions', () => {
    assert.deepEqual(DAMAGE_THRESHOLDS, {damaged: 0.70, critical: 0.35});
    for (const type of ['hq', 'barracks', 'factory', 'powerPlant', 'mine', 'outpost', 'loudspeaker']) {
        assert.equal(damageFrame(b(type, max(type))), 0, type);
        assert.equal(damageFrame(b(type, max(type) * 0.70)), 1, type);
        assert.equal(damageFrame(b(type, max(type) * 0.35)), 2, type);
        assert.equal(damageFrame(b(type, max(type) * 0.72)), 0, type);
        assert.equal(damageFrame(b(type, max(type) * 0.4)), 1, type);
        assert.equal(damageFrame(b(type, max(type) * 0.9)), 0, `${type} repaired`);
    }
    assert.equal(damageFrame(b('factory', undefined)), 0, 'old view without HP');
});

test('FX mapping matches building-specific artistic rules', () => {
    const kinds = (type, share) => buildingFxKinds(b(type, max(type) * share));
    assert.deepEqual(kinds('barracks', 0.6), ['fire']);
    assert.deepEqual(kinds('barracks', 0.1), ['fire']);
    assert.deepEqual(kinds('factory', 0.6), ['weldingSparks']);
    assert.deepEqual(kinds('factory', 0.1), ['weldingSparks', 'fire']);
    assert.deepEqual(kinds('powerPlant', 0.6), ['electricSparks']);
    assert.deepEqual(kinds('powerPlant', 0.1), ['electricSparks', 'fire']);
    assert.deepEqual(kinds('hq', 0.6), ['electricSparks']);
    assert.deepEqual(kinds('hq', 0.1), ['electricSparks', 'fire']);
    assert.deepEqual(kinds('loudspeaker', 0.1), ['weldingSparks']);
    assert.deepEqual(kinds('outpost', 0.1), ['fire']);
    assert.deepEqual(kinds('autocannon', 0.6), ['electricSparks']);
    assert.deepEqual(kinds('autocannon', 0.1), ['fire']);
    assert.deepEqual(kinds('siegeCannon', 0.6), ['electricSparks']);
    assert.deepEqual(kinds('siegeCannon', 0.1), ['fire']);
    assert.deepEqual(kinds('mine', 0.1), [], 'no effect assigned to mine yet');
    assert.deepEqual(kinds('wall', 0.1), [], 'wall keeps existing connection frames');
    assert.deepEqual(kinds('factory', 1), []);
});

test('the red speaker bulb requires online power, an enabled building and pristine HP', () => {
    const tower = b('loudspeaker', max('loudspeaker'));
    assert.equal(speakerLampOn(tower, new Set([tower.id])), true);
    assert.equal(speakerLampOn(tower, new Set()), false);
    assert.equal(speakerLampOn({...tower, enabled: false}, new Set([tower.id])), false);
    assert.equal(speakerLampOn({...tower, hp: max('loudspeaker') * 0.69}, new Set([tower.id])), false);
    assert.equal(speakerLampOn(b('hq', max('hq')), new Set([tower.id])), false);
});

test('effect animation uses eight frames, is deterministic, and pauses with the simulation tick', () => {
    assert.equal(BUILDING_FX_SHEETS.weldingSparks.frameHeight, 16);
    assert.equal(BUILDING_FX_SHEETS.electricSparks.frameHeight, 18);
    assert.equal(BUILDING_FX_SHEETS.fire.frameHeight, 16);
    for (const kind of Object.keys(BUILDING_FX_SHEETS)) {
        const frame = buildingFxFrame(100, 'hq-1', kind);
        assert.equal(frame, buildingFxFrame(100, 'hq-1', kind));
        assert.ok(frame >= 0 && frame < 8);
        assert.equal(frame, buildingFxFrame(100 + 8 * 6, 'hq-1', kind), 'loop');
    }
    assert.equal(buildingFxKey('fire'), 'papi-building-fx-fire');
});

test('pure FX positions follow sprite footprints and retain the loudspeaker bulb position', () => {
    const grid = {footprintRect: ({col, row, width, height}) => ({x: col * 32, y: row * 32, width: width * 32, height: height * 32})};
    const tower = b('loudspeaker', 100, {col: 2, row: 1});
    assert.deepEqual(speakerLampPosition(tower, grid), {x: 80, y: 12}, 'pixel 20 of the 72px loudspeaker art');
    assert.ok(BUILDING_FX_ANCHORS.loudspeaker.weldingSparks);
    assert.ok(buildingFxPosition(tower, grid, 'weldingSparks').y < 32 + 32);
});
