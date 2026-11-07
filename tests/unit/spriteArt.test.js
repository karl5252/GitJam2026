import test from 'node:test';
import assert from 'node:assert/strict';
import {ART, artKey, buildingFrame, infantryActionFrame} from '../../src/scenes/SpriteArt.js';

test('building art uses the correct HQ day/night and Barracks role frames', () => {
    assert.equal(buildingFrame({type: 'hq'}, 'day'), 0);
    assert.equal(buildingFrame({type: 'hq'}, 'night'), 1);
    assert.equal(buildingFrame({type: 'barracks'}, 'day'), 0);
    assert.equal(buildingFrame({type: 'barracks', role: 'rocket'}, 'day'), 1);
    assert.equal(buildingFrame({type: 'factory'}, 'night'), 0);
    assert.equal(buildingFrame({type: 'powerPlant', enabled: false}, 'day'), 0);
    assert.equal(buildingFrame({type: 'powerPlant', enabled: true}, 'day'), 1);
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
    assert.deepEqual([ART.factory.frameWidth, ART.factory.frameHeight], [32, 32]);
    assert.deepEqual([ART.powerPlant.frameWidth, ART.powerPlant.frameHeight], [32, 34]);
    assert.equal(ART.siegeCannon.scale, 2);
    assert.equal(artKey('hq'), 'papi-art-hq');
});
