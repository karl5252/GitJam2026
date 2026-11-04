/**
 * Cumulative pollution and the threat level derived from it. Pure — no
 * Phaser, integers only, no randomness.
 *
 * Pollution is added once per completed night, by settleNight() in
 * core/settlement.js, and never decays. Emissions follow the same `powered`
 * flag as income (core/power.js), so disabled buildings and unpowered
 * consumers emit nothing. Threat is always derived from the current value
 * and is never stored.
 */
import {getBuildingType} from './buildingTypes.js';
import {calculatePower} from './power.js';

export const STARTING_POLLUTION = 0;

const isValidAmount = (n) => Number.isSafeInteger(n) && n >= 0;

/**
 * @param {number} pollution - non-negative safe integer
 * @returns {1|2|3|4} 0-24 = 1, 25-49 = 2, 50-99 = 3, 100+ = 4
 */
export function threatLevel(pollution) {
    if (!isValidAmount(pollution)) throw new RangeError(`Pollution must be a non-negative safe integer, got ${pollution}`);
    if (pollution >= 100) return 4;
    if (pollution >= 50) return 3;
    if (pollution >= 25) return 2;
    return 1;
}

/**
 * Pollution the given buildings emit for one completed night. Never mutates
 * its input.
 *
 * @param {Array<{id: string, type: string, enabled?: boolean}>} buildings
 * @returns {number}
 * @throws {TypeError} for an unknown building type or invalid emission data
 */
export function calculateEmissions(buildings) {
    let emitted = 0;
    for (const {type: typeId, powered} of calculatePower(buildings).buildings) {
        const {id, pollutionPerNight} = getBuildingType(typeId);
        if (!isValidAmount(pollutionPerNight)) throw new TypeError(`Building type ${id} has invalid pollutionPerNight`);
        if (powered) emitted += pollutionPerNight;
    }
    return emitted;
}

export class Pollution {
    #value;

    constructor(value = STARTING_POLLUTION) {
        if (!isValidAmount(value)) throw new RangeError(`Pollution must be a non-negative safe integer, got ${value}`);
        this.#value = value;
    }

    get value() {
        return this.#value;
    }

    /** Validates the whole operation first; on failure nothing changes. */
    add(amount) {
        if (!isValidAmount(amount)) throw new RangeError(`Pollution amount must be a non-negative safe integer, got ${amount}`);
        const next = this.#value + amount;
        if (!Number.isSafeInteger(next)) throw new RangeError(`Pollution would exceed the safe integer range: ${this.#value} + ${amount}`);
        this.#value = next;
    }

    /** Detached plain data. */
    snapshot() {
        return {value: this.#value};
    }
}
