/**
 * How blue the world is. Pure: no Phaser. Presentation only: nothing in the
 * simulation reads it, and it reads phase ticks without changing anything.
 *
 * Tune here after a playtest. Alpha is the strength at full Night.
 */
export const NIGHT_TINT = Object.freeze({
    color: 0x18365c,
    alpha: 0.18,
    duskTicks: 300, // fade in across Dusk
    dawnTicks: 120, // fade out across the start of Day
});

/**
 * @param {{shift: string|null, timed: boolean, day: number, elapsedDuskTicks: number, elapsedDayTicks: number}} cycle
 * @returns {number} the overlay's alpha, 0 by Day
 */
export function nightTintAlpha({shift, timed, day, elapsedDuskTicks, elapsedDayTicks}, tint = NIGHT_TINT) {
    switch (shift) {
        case 'night':
        case 'defeated': // a run only ends at Night, and the last sight of it stays dark
            return tint.alpha;
        case 'dusk':
            return tint.alpha * Math.min(1, elapsedDuskTicks / tint.duskTicks);
        case 'day':
            // Dawn exists only where a Night came before and Day ticks; an untimed Day is plain day.
            if (!timed || day <= 1 || elapsedDayTicks >= tint.dawnTicks) return 0;
            return tint.alpha * (1 - elapsedDayTicks / tint.dawnTicks);
        default:
            return 0;
    }
}
