import {BRUTE, MUTANT, distanceToFootprint, nearestPoint} from '../core/mutants.js';

/**
 * Which way a mutant sprite looks. Presentation only: it reads detached snapshots
 * and nothing in the simulation reads it back.
 *
 * Every mutant sheet (runner, spitter, brute) is authored facing right, so the
 * sprite is mirrored with flipX only to face left.
 */
export const Facing = Object.freeze({LEFT: 'left', RIGHT: 'right'});

export const MUTANT_NATIVE_FACING = Object.freeze({
    runner: Facing.RIGHT,
    spitter: Facing.RIGHT,
    brute: Facing.RIGHT,
});

/** Smaller horizontal changes than this are not a direction: movement is 0.25 px a tick at the slowest. */
const MOVE_EPSILON = 0.1;
/** A focus this close to straight above or below says nothing about left or right. */
const FOCUS_DEAD_ZONE = 0.5;

/** Whether to mirror a sheet so that it looks the given way. */
export function flipFor(art, facing) {
    const native = MUTANT_NATIVE_FACING[art] ?? Facing.RIGHT;
    return facing !== native;
}

/**
 * The point a mutant is attacking right now, or null if it is not attacking.
 * Mirrors the order of the melee code: a truck, then a soldier or worker, then
 * the obstacle, then the target. A Spitter's fixed aim wins while it telegraphs.
 *
 * @param mutant a `Mutants.snapshot()` record
 * @param {{byId: Map, rectOf: Function, trucks?: Array, units?: Array, tileSize?: number, unitSize?: number}} world
 */
export function attackFocus(mutant, {byId, rectOf, trucks = [], units = [], tileSize = 32, unitSize = 12}) {
    if (mutant.aim) return mutant.aim;
    if (mutant.shots > 0) return null; // a Spitter between shots: only its aim says where it looks
    const cooldown = mutant.kind === BRUTE.kind ? BRUTE.attackCooldownTicks : MUTANT.attackCooldownTicks;
    if (!(mutant.attackTimer < cooldown)) return null; // the timer only runs while stationary and attacking
    const reach = (size) => ({x, y}) => distanceToFootprint(mutant, box(x, y, size)) <= MUTANT.attackRange;
    const truck = trucks.find(reach(tileSize));
    if (truck) return truck;
    const unit = units.find(reach(unitSize));
    if (unit) return unit;
    const building = byId.get(mutant.obstacleId) ?? byId.get(mutant.targetId);
    return building ? nearestPoint(mutant, rectOf(building)) : null;
}

/**
 * The next facing: towards what it attacks, else the way it moved, else unchanged.
 * @param {string} previous the last facing
 * @param {{x: number, dx: number, focus: {x: number} | null}} state
 */
export function nextFacing(previous, {x, dx, focus}) {
    if (focus) {
        const toward = focus.x - x;
        if (Math.abs(toward) >= FOCUS_DEAD_ZONE) return toward < 0 ? Facing.LEFT : Facing.RIGHT;
        return previous;
    }
    if (Math.abs(dx) > MOVE_EPSILON) return dx < 0 ? Facing.LEFT : Facing.RIGHT;
    return previous;
}

function box(x, y, size) {
    const half = size / 2;
    return {x: x - half, y: y - half, width: size, height: size};
}
