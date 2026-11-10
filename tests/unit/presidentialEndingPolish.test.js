import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ENDING_CUES, ENDING_FRAMES, ENDING_TIMING, endingFrame, landingPoint, speechStartMs, stageLayout,
} from '../../src/scenes/presidentialEnding.js';
import {HELI, HeliVisit, flightPose, pickupPoint} from '../../src/scenes/presidentialHeli.js';
import {LA_GUARDIA} from '../../src/scenes/presidentialEnding.js';

/** TASK 036.1: La Guardia Royal and the Day 100 helicopter's landing. */

const HQ = {x: 576, y: 160, width: 96, height: 96};
const L = stageLayout(HQ);
const at = (speechS) => speechStartMs() + speechS * 1000;
const FLYING = [2, 3, 4, 5, 6, 7];

test('La Guardia Royal is security.png, its own geometry: 45 x 40 cells, 5 px apart', () => {
    assert.equal(LA_GUARDIA.path, 'assets/sprites/units/security.png');
    assert.equal(LA_GUARDIA.key, 'papi-laGuardia');
    assert.deepEqual([LA_GUARDIA.frameWidth, LA_GUARDIA.frameHeight, LA_GUARDIA.spacing], [45, 40, 5]);
    assert.equal(4 * LA_GUARDIA.frameWidth + 3 * LA_GUARDIA.spacing, 195, 'four cells across the 195 px sheet');
});

test('La Guardia Royal: march out on 2-3 (cells 4-5), attention on 0-1, one salute 4-7 (cells 8-11) at the speech, held, then the retreat', () => {
    const G = ENDING_FRAMES.guard;
    assert.deepEqual([[...G.idle], [...G.walk], [...G.salute]], [[0, 1], [4, 5], [8, 9, 10, 11]]);
    const marching = endingFrame(ENDING_TIMING.guardOutMs[1] + 300, L).guards;
    assert.ok(marching.some((g) => g.state === 'marching' && G.walk.includes(g.frame)));
    const attention = endingFrame(speechStartMs() - 100, L).guards;
    assert.ok(attention.every((g) => g.state === 'attention' && G.idle.includes(g.frame)));
    const frames = [];
    for (let ms = 0; ms <= 3000; ms += 50) frames.push(endingFrame(at(ms / 1000), L).guards[0].frame);
    assert.deepEqual(frames.filter((f, i) => i === 0 || f !== frames[i - 1]), [8, 9, 10, 11], 'once through, never looped');
    for (const s of [1, 10, 30, 45, 53.9]) {
        assert.ok(endingFrame(at(s), L).guards.every((g) => g.state === 'holding-salute' && g.frame === 11), `held at ${s} s`);
    }
    const retreat = endingFrame(at(54.5), L).guards;
    assert.equal(retreat.length, 2);
    assert.ok(retreat.every((g) => g.state === 'retreating' && G.walk.includes(g.frame)));
});

test('the Day 100 helicopter: down to half Day 1\'s clearance, engine off on frame 0, straight up spinning, gone before the speech', () => {
    const H = ENDING_TIMING.heli;
    assert.equal(H.landAltitude, HELI.hoverAltitude / 2);
    const {ground, skids} = landingPoint(HQ);
    assert.deepEqual(ground, pickupPoint(HQ));
    assert.equal(skids.y - (ground.y - HELI.hoverAltitude), HELI.hoverAltitude / 2, 'twice as far down towards the roof');
    const approach = endingFrame(1000, L).heli;
    assert.equal(approach.leg, 'approach');
    assert.ok(FLYING.includes(approach.frame));
    const landedAt = H.approachMs + 10;
    const landed = [0, 600, H.landedMs - 30].map((d) => endingFrame(landedAt + d, L));
    assert.ok(landed.every(({heli}) => heli.leg === 'landed' && heli.frame === 0 && heli.y === skids.y), 'frame 0, held, at the lowest point');
    assert.ok(H.landedMs >= 1000 && H.landedMs <= 2000);
    assert.ok(landed.some((f) => f.president.visible), 'the President comes out of HQ meanwhile');
    const lift = endingFrame(H.approachMs + H.landedMs + H.takeoffMs / 2, L).heli;
    assert.equal(lift.leg, 'takeoff');
    assert.ok(FLYING.includes(lift.frame));
    assert.equal(lift.ground.x, ground.x, 'straight up first');
    assert.ok(lift.altitude > H.landAltitude);
    assert.equal(endingFrame(H.approachMs + H.landedMs + H.takeoffMs + 100, L).heli.leg, 'depart');
    assert.equal(endingFrame(speechStartMs(), L).heli.visible, false, 'gone before the speech');
    assert.ok(H.approachMs + H.landedMs + H.takeoffMs + H.departMs <= speechStartMs());
    assert.deepEqual({...ENDING_CUES}, {
        SPEECH_START: 0, PRESIDENTIAL_TRIUMPH: 38.5, BRUTE_REVEAL: 46.5, BRUTE_APPROACH: 48.5,
        BRUTE_LUNGE: 51.6, PRESIDENT_CONSUMED: 54, CHEWING: 55.5, ENDING_COMPLETE: 57.42,
    }, 'the speech cues never moved');
});

test('Day 1 keeps its own flight: hover height and no engine stop', () => {
    const g = pickupPoint(HQ);
    assert.equal(flightPose('hover', 0, {start: g, pickup: g, end: g}).altitude, HELI.hoverAltitude);
    const visit = new HeliVisit();
    visit.start(HQ, {x: 400, y: 200, width: 600, height: 340});
    for (let i = 0; i < 2000 && visit.active; i++) {
        visit.update(16);
        const v = visit.view();
        if (v.visible) assert.ok(FLYING.includes(v.frame), 'never frame 0 on Day 1');
        if (v.state === 'hover') assert.ok(v.altitude >= HELI.hoverAltitude - HELI.dip);
    }
});
