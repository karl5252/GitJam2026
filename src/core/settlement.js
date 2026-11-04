/**
 * Nightly settlement. Pure arithmetic — no Phaser, integers only.
 *
 * After each completed Night Shift every placed building contributes per
 * BUILDING_TYPES[...].operations, given the power state at that moment
 * (core/power.js, derived from the buildings' enabled flags):
 *   gross  = sum(income) of buildings that are POWERED (operating)
 *   upkeep = sum(upkeep) of ALL buildings, regardless of enabled/powered
 *   net    = gross - upkeep
 *
 * Upkeep is always charged in full; Credits may go negative (debt).
 */
import {BUILDING_TYPES, getBuildingType} from './buildingTypes.js';
import {calculatePower} from './power.js';
import {Pollution, calculateEmissions, threatLevel} from './pollution.js';

const isNonNegativeInt = (n) => Number.isInteger(n) && n >= 0;

/**
 * @param {Array<{id: string, type: string, enabled?: boolean}>} buildings - e.g. BuildingPlacement.buildings()
 * @returns {{gross: number, upkeep: number, net: number, counts: Record<string, number>,
 *            power: {generation: number, demand: number, status: string}}}
 * @throws {TypeError} for an unknown building type or non-integer operations
 */
export function calculateSettlement(buildings) {
    const power = calculatePower(buildings); // validates input and types
    const counts = Object.fromEntries(Object.keys(BUILDING_TYPES).map((id) => [id, 0]));
    let gross = 0;
    let upkeep = 0;
    for (const {type: typeId, powered} of power.buildings) {
        const type = getBuildingType(typeId);
        const {income, upkeep: cost} = type.operations;
        if (!isNonNegativeInt(income) || !isNonNegativeInt(cost)) {
            throw new TypeError(`Building type ${type.id} has invalid operations`);
        }
        if (powered) gross += income;
        upkeep += cost;
        counts[type.id]++;
    }
    return {
        gross,
        upkeep,
        net: gross - upkeep,
        counts,
        power: {generation: power.generation, demand: power.demand, status: power.status},
    };
}

/**
 * Apply one completed night to the economy and to pollution, as one atomic
 * step with no rollback:
 *   1. Calculate settlement and emissions (no side effects; may throw).
 *   2. Prevalidate both changes, inputs and results (may throw).
 *   3. Commit pollution, then Credits. Neither can fail for prevalidated
 *      values: Pollution.add and Economy.adjustCredits reject only what step
 *      2 has already ruled out, and everything here is synchronous.
 *   4. Build the report, so it exists only after both commits.
 * Any throw therefore happens with Credits and pollution both unchanged, and
 * ShiftCycle can safely retry the final tick. AP, buildings, power flags and
 * grid are never touched.
 *
 * @param {{day: number, buildings: Array, economy: import('./economy.js').Economy,
 *          pollution: Pollution}} input
 *   day - the day whose night just completed
 * @returns {Readonly<{day, gross, upkeep, net, creditsBefore, creditsAfter, counts, power,
 *                     pollution: {before, emitted, after, threatLevel}}>} frozen report
 */
export function settleNight({day, buildings, economy, pollution}) {
    if (!Number.isInteger(day) || day < 1) throw new RangeError(`day must be a positive integer, got ${day}`);
    if (!(pollution instanceof Pollution)) throw new TypeError('settleNight requires a Pollution instance');

    const {gross, upkeep, net, counts, power} = calculateSettlement(buildings);
    const emitted = calculateEmissions(buildings);

    const creditsBefore = economy.credits;
    const pollutionBefore = pollution.value;
    for (const [label, value] of Object.entries({
        creditsBefore, net, creditsAfter: creditsBefore + net,
        pollutionBefore, emitted, pollutionAfter: pollutionBefore + emitted,
    })) {
        if (!Number.isSafeInteger(value)) throw new RangeError(`Settlement ${label} is not a safe integer: ${value}`);
    }

    pollution.add(emitted);
    economy.adjustCredits(net);

    return Object.freeze({
        day,
        gross,
        upkeep,
        net,
        creditsBefore,
        creditsAfter: economy.credits,
        counts: Object.freeze(counts),
        power: Object.freeze(power),
        pollution: Object.freeze({
            before: pollutionBefore,
            emitted,
            after: pollution.value,
            threatLevel: threatLevel(pollution.value),
        }),
    });
}
