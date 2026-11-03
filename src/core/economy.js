/**
 * Credits + Action Points. Pure — no Phaser.
 *
 * Balances are private; read them via the getters or snapshot(). spend() is
 * all-or-nothing: both resources are deducted together, or neither is.
 */

export const STARTING_RESOURCES = Object.freeze({credits: 1000, ap: 5});

export const EconomyFailure = Object.freeze({
    INSUFFICIENT_CREDITS: 'insufficient-credits',
    INSUFFICIENT_AP: 'insufficient-ap',
    INVALID_COST: 'invalid-cost',
});

const isNonNegativeInt = (n) => Number.isInteger(n) && n >= 0;

export class Economy {
    #credits;
    #ap;

    constructor({credits, ap} = STARTING_RESOURCES) {
        if (!isNonNegativeInt(credits) || !isNonNegativeInt(ap)) {
            throw new RangeError(`Economy balances must be non-negative integers, got credits=${credits}, ap=${ap}`);
        }
        this.#credits = credits;
        this.#ap = ap;
    }

    get credits() {
        return this.#credits;
    }

    get ap() {
        return this.#ap;
    }

    /**
     * Never mutates. Deterministic check order:
     * invalid-cost -> insufficient-credits -> insufficient-ap.
     * @param {{credits: number, ap: number}} cost
     */
    canAfford(cost) {
        if (cost === null || typeof cost !== 'object'
            || !isNonNegativeInt(cost.credits) || !isNonNegativeInt(cost.ap)) {
            return {ok: false, reason: EconomyFailure.INVALID_COST};
        }
        if (cost.credits > this.#credits) return {ok: false, reason: EconomyFailure.INSUFFICIENT_CREDITS};
        if (cost.ap > this.#ap) return {ok: false, reason: EconomyFailure.INSUFFICIENT_AP};
        return {ok: true};
    }

    /** Deduct both resources if affordable; otherwise change nothing. */
    spend(cost) {
        const result = this.canAfford(cost);
        if (!result.ok) return result;
        this.#credits -= cost.credits;
        this.#ap -= cost.ap;
        return {ok: true};
    }

    /** Set AP to `ap` (e.g. at the start of a Day Shift). Credits are untouched. */
    restoreAp(ap) {
        if (!isNonNegativeInt(ap)) throw new RangeError(`AP must be a non-negative integer, got ${ap}`);
        this.#ap = ap;
    }

    /** Detached plain data. */
    snapshot() {
        return {credits: this.#credits, ap: this.#ap};
    }
}
