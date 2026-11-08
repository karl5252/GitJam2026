/**
 * A tiny presentation-only timeline, completely separate from the deterministic
 * 60 Hz game simulation. No mutable state, Phaser, Math.random or timeouts.
 * Positions are offsets from the portrait at the centre of the office.
 */

// Phaser slices the 448x224 PNG into a 7x4 grid (64x56 each).
// The Aseprite JSON lists the walk as logical frames 4..7, but their
// actual grid indices are 7..10. 0..3 is idle and must never play in motion.
const WALK = Object.freeze([7, 8, 9, 10]);
const SALUTE_FRAMES = Object.freeze([
    {until: 180, frame: 14}, // glance / arm moves up
    {until: 360, frame: 15},
    {until: 540, frame: 16},
    {until: 1500, frame: 17}, // salute to his own portrait
    {until: 1850, frame: 18}, // cigar smoke
    {until: 2300, frame: 19},
    {until: 2650, frame: 20},
    {until: 3100, frame: 0},
]);

export const DESKTOP_CYCLE_MS = 18600;
export const MOBILE_CYCLE_MS = 12500;

const frameForWalk = (ageMs, frames) => frames[Math.floor(ageMs / 150) % frames.length];
const saluteFrame = (ageMs) => SALUTE_FRAMES.find(({until}) => ageMs < until)?.frame ?? 0;
const ratio = (age, duration) => Math.min(1, Math.max(0, age / duration));
const lerp = (a, b, t) => a + (b - a) * t;

// Authored walk is left-facing; flip horizontally only for rightward motion.
const pose = (frame, xOffset = 0, visible = true, flipX = false) => ({frame, xOffset, visible, flipX});

export function officeColonelPose(elapsedMs, touch = false) {
    const t = Math.max(0, elapsedMs) % (touch ? MOBILE_CYCLE_MS : DESKTOP_CYCLE_MS);
    if (touch) {
        // On a phone he only peeks into the compact composition and disappears.
        if (t < 2400 || t >= 9300) return pose(0, -180, false);
        if (t < 4200) return pose(frameForWalk(t - 2400, WALK), lerp(-180, 0, ratio(t - 2400, 1800)), true, true);
        if (t < 7300) return pose(saluteFrame(t - 4200));
        return pose(frameForWalk(t - 7300, WALK), lerp(0, 180, ratio(t - 7300, 2000)), true, true);
    }
    // Desktop: march in, salute the self-portrait, smoke, march off and back.
    if (t < 3500) return pose(frameForWalk(t, WALK), lerp(-175, 0, ratio(t, 3500)), true, true);
    if (t < 6600) return pose(saluteFrame(t - 3500));
    if (t < 10100) return pose(frameForWalk(t - 6600, WALK), lerp(0, 170, ratio(t - 6600, 3500)), true, true);
    if (t < 17700) return pose(frameForWalk(t - 10100, WALK), lerp(170, -175, ratio(t - 10100, 7600)), true, false);
    return pose(0, -175); // breath before another lap
}

/** Full 51x50 frames: the phone's receiver flies above the base while ringing. */
export function officePhoneFrame(elapsedMs) {
    if (elapsedMs < 6000) return 0;
    const phase = (elapsedMs - 6000) % 15000;
    return phase < 1440 ? Math.floor(phase / 90) % 8 : 0; // two 8-frame rings
}

export function officeFlagFrame(elapsedMs, offsetMs = 0) {
    return Math.floor((elapsedMs + offsetMs) / 290) % 3;
}
