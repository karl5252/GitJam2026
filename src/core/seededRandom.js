/**
 * Seeded deterministic PRNG. Pure — never uses Math.random().
 *
 * Same LCG as Steel Abyss: Refit (World.random) and BarrelStorm
 * (SeededRandom), kept identical for consistency across WGS games:
 *   state = (state * 1664525 + 1013904223) mod 2^32
 */

export const DEFAULT_SEED = 731;

const MAX_UINT32 = 0xFFFFFFFF;

/**
 * Parse a seed override (e.g. a `?seed=` query value). Returns an integer
 * in 0..2^32-1, or null if the value is missing or invalid.
 */
export function parseSeed(raw) {
    if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) return null;
    const n = Number(raw.trim());
    return Number.isSafeInteger(n) && n <= MAX_UINT32 ? n : null;
}

export class SeededRandom {
    #seed;
    #state;

    /** @param {number} seed - integer in 0..2^32-1 */
    constructor(seed = DEFAULT_SEED) {
        if (!Number.isInteger(seed) || seed < 0 || seed > MAX_UINT32) {
            throw new RangeError(`seed must be an integer in 0..${MAX_UINT32}, got ${seed}`);
        }
        this.#seed = seed;
        this.#state = seed;
    }

    get seed() { return this.#seed; }
    get state() { return this.#state; }

    /** Next float in [0, 1). */
    next() {
        this.#state = (Math.imul(this.#state, 1664525) + 1013904223) >>> 0;
        return this.#state / 4294967296;
    }

    /** Next integer in [min, max], both inclusive. */
    nextInt(min, max) {
        if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
            throw new RangeError(`nextInt needs safe integers with min <= max, got ${min}..${max}`);
        }
        return min + Math.floor(this.next() * (max - min + 1));
    }

    /** Restart the sequence from the original seed. */
    reset() {
        this.#state = this.#seed;
    }

    snapshot() {
        return {seed: this.#seed, state: this.#state};
    }

    /**
     * TASK 042: continue a saved sequence. The seed must be this generator's own,
     * so a checkpoint can never graft one run's draws onto another's.
     */
    restore({seed, state}) {
        if (seed !== this.#seed) throw new RangeError(`checkpoint seed ${seed} is not this generator's ${this.#seed}`);
        if (!Number.isInteger(state) || state < 0 || state > MAX_UINT32) {
            throw new RangeError(`state must be an integer in 0..${MAX_UINT32}, got ${state}`);
        }
        this.#state = state;
    }
}
