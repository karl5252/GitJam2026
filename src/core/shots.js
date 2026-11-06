/**
 * What every aimed projectile has in common. Pure: no Phaser, no state and no
 * randomness. This is not a projectile engine: each weapon keeps its own short
 * list, because what a shot may hit and when it is cleared differ between them.
 *
 * The convention they share: a shot is aimed at a point, not at a target, and
 * flies a fixed number of ticks there with no correction. Whatever stands on that
 * point when it lands is what it hits.
 */

export const BRUTE_KIND = 'brute';

/** Px from a mutant's position to the edge of its body, by kind. */
export const BODY_RADIUS = Object.freeze({ordinary: 8, spitter: 11, [BRUTE_KIND]: 15});

export const bodyRadius = ({kind}) => BODY_RADIUS[kind ?? 'ordinary'];
export const isBrute = ({kind}) => kind === BRUTE_KIND;

/** Ticks to fly between two points, at `speed` px per tick along the longer axis. Never less than one. */
export function flightTicks(from, to, speed) {
    return Math.max(1, Math.ceil(Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) / speed));
}

/**
 * The nearest mutant within reach of a point. Ties go to the earliest in the list,
 * which is spawn order. Squared values stay exact: positions are multiples of a
 * quarter pixel.
 * @param {{x: number, y: number}} point
 * @param {Array<{x: number, y: number, kind?: string}>} mutants
 * @param {(mutant: object) => number} reachOf px from the point
 * @returns {object|null}
 */
export function mutantAt(point, mutants, reachOf) {
    let best = null;
    let bestDistance = Infinity;
    for (const mutant of mutants) {
        const distance = (mutant.x - point.x) ** 2 + (mutant.y - point.y) ** 2;
        if (distance > reachOf(mutant) ** 2 || distance >= bestDistance) continue;
        best = mutant;
        bestDistance = distance;
    }
    return best;
}
