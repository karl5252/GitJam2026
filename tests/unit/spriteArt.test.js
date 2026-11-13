import test from 'node:test';
import assert from 'node:assert/strict';
import {ART, artKey, buildingArtKind, buildingFrame, infantryActionFrame, mutantMeleeFrame, spitterSpitFrame} from '../../src/scenes/SpriteArt.js';

test('building damage frames use 0 pristine, 1 damaged, 2 critical regardless of night and ON state', () => {
    for (const type of ['hq', 'barracks', 'factory', 'powerPlant', 'mine', 'outpost', 'loudspeaker']) {
        assert.equal(buildingFrame({type}, 'day'), 0, `${type}: missing HP defaults pristine`);
    }
    assert.equal(buildingFrame({type: 'hq', hp: 300}, 'day'), 1);
    assert.equal(buildingFrame({type: 'hq', hp: 300}, 'night'), 1);
    assert.equal(buildingFrame({type: 'barracks', hp: 300, role: 'rocket'}, 'night'), 0);
    assert.equal(buildingFrame({type: 'powerPlant', hp: 30, enabled: true}, 'day'), 2);
    assert.equal(buildingFrame({type: 'powerPlant', hp: 30, enabled: false}, 'day'), 2);
    assert.equal(buildingFrame({type: 'factory', hp: 300}, 'night'), 0);
});

test('Rifle and Rocket Barracks use distinct three-frame spritesheets', () => {
    assert.equal(buildingArtKind({type: 'barracks', role: 'rifle'}), 'barracks');
    assert.equal(buildingArtKind({type: 'barracks', role: 'rocket'}), 'barracksRocket');
    assert.equal(buildingArtKind({type: 'barracks'}), 'barracks');
    assert.equal(buildingArtKind({type: 'outpost'}), 'outpost');
    assert.equal(ART.barracks.path, 'buildings/barracks_rifle.png');
    assert.equal(ART.barracksRocket.path, 'buildings/barracks_rocket.png');
});

test('four Aseprite action frames play once per gameplay shot and stop', () => {
    assert.equal(infantryActionFrame(undefined, 100), null);
    assert.equal(infantryActionFrame(100, 99), null);
    assert.equal(infantryActionFrame(100, 100), 8);
    assert.equal(infantryActionFrame(100, 105), 8);
    assert.equal(infantryActionFrame(100, 106), 9);
    assert.equal(infantryActionFrame(100, 112), 10);
    assert.equal(infantryActionFrame(100, 118), 11);
    assert.equal(infantryActionFrame(100, 123), 11);
    assert.equal(infantryActionFrame(100, 124), null);
});

test('building sheets retain independent authored frame dimensions', () => {
    assert.deepEqual([ART.hq.frameWidth, ART.hq.frameHeight], [32, 40]);
    assert.deepEqual([ART.barracks.frameWidth, ART.barracks.frameHeight], [32, 29]);
    assert.deepEqual([ART.barracksRocket.frameWidth, ART.barracksRocket.frameHeight], [32, 29]);
    assert.deepEqual([ART.factory.frameWidth, ART.factory.frameHeight], [32, 32]);
    assert.deepEqual([ART.powerPlant.frameWidth, ART.powerPlant.frameHeight], [32, 34]);
    assert.equal(ART.siegeCannon.scale, 2);
    assert.equal(artKey('hq'), 'papi-art-hq');
});


test('melee animation uses the six attack frames over a complete cooldown, but never when inactive', () => {
    assert.equal(mutantMeleeFrame(false, 59, 60), null);
    assert.deepEqual([60, 50, 40, 30, 20, 10, 1].map((t) => mutantMeleeFrame(true, t, 60)),
        [12, 13, 14, 15, 16, 17, 17]);
    assert.equal(mutantMeleeFrame(true, 120, 120), 12);
    assert.equal(mutantMeleeFrame(true, 1, 120), 17);
});

test('Spitter has one four-frame windup per shot and no animation between shots', () => {
    assert.equal(spitterSpitFrame(null, 30, 45), null);
    assert.deepEqual([45, 33, 22, 11, 1].map((t) => spitterSpitFrame({x: 1}, t, 45)),
        [12, 13, 14, 15, 15]);
});
