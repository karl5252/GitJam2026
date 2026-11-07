import test from 'node:test';
import assert from 'node:assert/strict';
import {gateArtFrame, gateArtAngle, GATE_ART} from '../../src/scenes/GateFrames.js';

test('gate renders authored closed, intermediate and open frames in order', () => {
    assert.equal(gateArtFrame('horizontal', 0), 0);
    assert.equal(gateArtFrame('horizontal', 0.5), 8);
    assert.equal(gateArtFrame('horizontal', 1), 15);
    assert.equal(gateArtFrame('horizontal', -1), 0);
    assert.equal(gateArtFrame('horizontal', 2), 15);
    assert.equal(gateArtFrame('vertical', Number.NaN), 0);
});

test('vertical gate temporarily rotates the complete 16-frame animation', () => {
    assert.equal(GATE_ART.frames, 16);
    assert.equal(gateArtFrame('vertical', 0), 0);
    assert.equal(gateArtFrame('vertical', 0.5), 8);
    assert.equal(gateArtFrame('vertical', 1), 15);
    assert.equal(gateArtAngle('horizontal'), 0);
    assert.equal(gateArtAngle('vertical'), 90);
});
