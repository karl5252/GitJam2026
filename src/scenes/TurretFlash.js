import {turretFrame} from './SpriteArt.js';

/**
 * Purely visual timings measured in 60 Hz simulation ticks.
 * Autocannon: 4 x 3 ticks = 12 ticks (200 ms); fires every 30 ticks at most.
 * Siege Cannon: 4 x 6 ticks = 24 ticks (400 ms); reload is 300 ticks.
 * Never stretch a flash across a reload cycle or keep its last frame visible.
 */
export const TURRET_FLASH = Object.freeze({
    autocannon: Object.freeze({frameTicks: 3, frameCount: 4}),
    siegeCannon: Object.freeze({frameTicks: 6, frameCount: 4}),
});

/**
 * Each 64x64 sheet has 8 rows: N, NE, E, SE, S, SW, W, NW.
 * Every row has four frames, left-to-right. Return null outside the one-shot
 * animation, not the last frame. Timestamp comes from a real fired event.
 */
export function turretFlashFrame(angle, firedTick, tick, timing) {
    if (!Number.isFinite(firedTick) || !Number.isFinite(tick)) return null;
    const age = tick - firedTick;
    if (age < 0 || age >= timing.frameTicks * timing.frameCount) return null;
    return turretFrame(angle) * timing.frameCount + Math.floor(age / timing.frameTicks);
}
