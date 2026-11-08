import test from 'node:test';
import assert from 'node:assert/strict';
import {officeMenuLayout} from '../../src/scenes/officeMenuLayout.js';
import {
    DESKTOP_CYCLE_MS, MOBILE_CYCLE_MS, officeColonelPose, officeFlagFrame, officePhoneFrame,
} from '../../src/scenes/officeMenuTiming.js';

const checkSourceFrame = (frame) => assert.ok([0, 1, 2, 3, 7, 8, 9, 10, 14, 15, 16, 17, 18, 19, 20].includes(frame));

test('office menu uses tileable layers and retains authored sprite scales', () => {
    const l = officeMenuLayout();
    assert.equal(l.width, 1280);
    assert.equal(l.floor.top, l.wallBottom.top + l.wallBottom.height);
    assert.equal(l.wallTop.top + l.wallTop.height, l.wallBottom.top);
    assert.equal(l.flags.length, 2);
    assert.equal(l.desk.scale, 3.05);
    assert.ok(Math.abs(l.phone.y - (l.desk.y - 49 * l.desk.scale)) <= 2);
    assert.ok(Math.abs(l.bust.y - l.phone.y) <= 2);
});

test('compact menu keeps the same office backdrop, portrait and desk', () => {
    const desktop = officeMenuLayout();
    const mobile = officeMenuLayout({touch: true});
    assert.deepEqual(mobile.wallTop, desktop.wallTop);
    assert.ok(mobile.portrait.scale > desktop.portrait.scale);
    assert.ok(mobile.desk.scale > desktop.desk.scale);
});

test('desktop colonel walks to the centre, salutes, smokes, and exits smoothly', () => {
    assert.equal(officeColonelPose(0).xOffset, -175);
    assert.equal(officeColonelPose(3499).xOffset < 0, true);
    for (let t = 3500; t < 6600; t += 125) {
        const p = officeColonelPose(t);
        assert.equal(p.xOffset, 0);
        checkSourceFrame(p.frame);
    }
    assert.equal(officeColonelPose(3500 + 900).frame, 17); // salute hold
    assert.equal(officeColonelPose(3500 + 2000).frame, 19); // smoking
    assert.equal(officeColonelPose(DESKTOP_CYCLE_MS).xOffset, -175);
    for (const t of [0, 150, 1800, 6600, 6750, 9950, 10100, 12300, 17500]) {
        const p = officeColonelPose(t);
        assert.ok([7, 8, 9, 10].includes(p.frame), `walk at ${t} uses walking frame, got ${p.frame}`);
        assert.equal(p.flipX, t < 10100, `walking direction at ${t}`);
    }
    assert.equal(officeColonelPose(10100).flipX, false);
});

test('mobile colonel enters briefly and can disappear instead of marching forever', () => {
    assert.equal(officeColonelPose(0, true).visible, false);
    assert.equal(officeColonelPose(3000, true).visible, true);
    assert.equal(officeColonelPose(3000, true).flipX, true);
    assert.ok([7, 8, 9, 10].includes(officeColonelPose(3000, true).frame));
    assert.equal(officeColonelPose(5000, true).xOffset, 0);
    assert.equal(officeColonelPose(10000, true).visible, false);
    assert.equal(officeColonelPose(MOBILE_CYCLE_MS, true).visible, false);
});

test('telephone rings in two eight-frame cycles, then always returns to idle', () => {
    assert.equal(officePhoneFrame(5999), 0);
    assert.equal(officePhoneFrame(6000), 0);
    assert.equal(officePhoneFrame(6090), 1);
    assert.equal(officePhoneFrame(6630), 7);
    assert.equal(officePhoneFrame(6720), 0);
    assert.equal(officePhoneFrame(7340), 6);
    assert.equal(officePhoneFrame(7440), 0);
    assert.equal(officePhoneFrame(20999), 0);
    assert.equal(officePhoneFrame(21090), 1);
});

test('two flags ripple with a one-frame phase difference', () => {
    for (const t of [0, 100, 300, 600, 1300]) {
        assert.ok([0, 1, 2].includes(officeFlagFrame(t)));
        assert.notEqual(officeFlagFrame(t, 0), officeFlagFrame(t, 290));
    }
});
