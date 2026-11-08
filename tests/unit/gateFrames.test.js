import test from 'node:test';
import assert from 'node:assert/strict';
import {gateArtFrame, gateArtKind, GATE_ART} from '../../src/scenes/GateFrames.js';

test('each orientation draws its own sheet', () => {
    assert.equal(gateArtKind('horizontal'), 'gateHorizontal');
    assert.equal(gateArtKind('vertical'), 'gateVertical');
    assert.equal(GATE_ART.frames, 8);
});

test('both run closed to open through frames 0..7, and closing runs back down them', () => {
    for (const orientation of ['horizontal', 'vertical']) {
        assert.equal(gateArtFrame(orientation, 0), 0);
        assert.equal(gateArtFrame(orientation, 0.5), 4);
        assert.equal(gateArtFrame(orientation, 1), 7);
        assert.equal(gateArtFrame(orientation, -1), 0);
        assert.equal(gateArtFrame(orientation, 2), 7);
        assert.equal(gateArtFrame(orientation, Number.NaN), 0, 'unknown openness shows it closed');
        const frames = new Set(Array.from({length: 101}, (_, i) => gateArtFrame(orientation, i / 100)));
        assert.deepEqual([...frames], [0, 1, 2, 3, 4, 5, 6, 7]);
    }
});
