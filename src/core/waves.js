/**
 * Deterministic night wave planning. Pure — no Phaser, no state, no clock and
 * no randomness. Spawn positions stay in Mutants, which draws one RNG value
 * per spawn.
 *
 *   nightBudget     = 1 + floor((night - 1) / nightsPerExtra)
 *   pollutionBudget = perThreatLevel * (threatLevel - 1)
 *   defenseResponse = min(maxResponse, floor(max(0, autocannons - 1) / cannonsPerResponse))
 *   budget          = min(maxPerNight, nightBudget + pollutionBudget + defenseResponse)
 *
 * Mutants asks for a plan once, on night tick 1, and keeps it until dawn.
 * Pollution only changes during settlement, construction is off at night and
 * no mutant exists yet on tick 1, so this equals sampling at END DAY. Every
 * existing Autocannon counts, whether or not it is enabled or powered.
 *
 * All values are temporary and unbalanced; rebalance them here.
 */
import {threatLevel} from './pollution.js';

export const WAVE = Object.freeze({
    firstTick: 600,
    lastTick: 2700, // later spawns would mostly be removed at dawn before arriving
    nightsPerExtra: 2,
    perThreatLevel: 2,
    cannonsPerResponse: 2,
    maxResponse: 4,
    maxPerNight: 20,
});

const AUTOCANNON_TYPE = 'autocannon';

function assertCount(name, value, min) {
    if (!Number.isSafeInteger(value) || value < min) {
        throw new RangeError(`${name} must be an integer of at least ${min}, got ${value}`);
    }
}

export function nightBudget(night) {
    assertCount('night', night, 1);
    return 1 + Math.floor((night - 1) / WAVE.nightsPerExtra);
}

export function pollutionBudget(threat) {
    assertCount('threat', threat, 1);
    return WAVE.perThreatLevel * (threat - 1);
}

export function defenseResponse(autocannons) {
    assertCount('autocannons', autocannons, 0);
    return Math.min(WAVE.maxResponse, Math.floor(Math.max(0, autocannons - 1) / WAVE.cannonsPerResponse));
}

export function waveBudget(night, threat, autocannons) {
    return Math.min(WAVE.maxPerNight, nightBudget(night) + pollutionBudget(threat) + defenseResponse(autocannons));
}

/**
 * Spawn ticks for a budget: strictly increasing, one spawn per tick, from
 * firstTick to lastTick, with gaps that shrink through the night. Integer
 * arithmetic only.
 * @returns {readonly number[]} frozen
 */
export function waveSchedule(budget) {
    assertCount('budget', budget, 0);
    if (budget <= 1) return Object.freeze(budget === 1 ? [WAVE.firstTick] : []);
    const span = WAVE.lastTick - WAVE.firstTick;
    const last = budget - 1;
    return Object.freeze(Array.from({length: budget}, (_, i) => (
        WAVE.firstTick + Math.floor(span * i * (2 * last - i) / (last * last))
    )));
}

/**
 * The frozen plan for one night. It holds numbers only, so it shares nothing
 * with the building records it was computed from.
 * @param {{day: number, pollution: number, buildings: Array<{type: string}>}} input
 */
export function nightPlan({day, pollution, buildings}) {
    const threat = threatLevel(pollution);
    const autocannons = buildings.filter((b) => b.type === AUTOCANNON_TYPE).length;
    const budget = waveBudget(day, threat, autocannons);
    return Object.freeze({
        day,
        threatLevel: threat,
        autocannons,
        nightBudget: nightBudget(day),
        pollutionBudget: pollutionBudget(threat),
        defenseResponse: defenseResponse(autocannons),
        budget,
        schedule: waveSchedule(budget),
    });
}

/** Scheduled slots reached by a night tick. A skipped spawn's slot still counts. */
export function waveProgress(plan, elapsedNightTicks) {
    return plan.schedule.filter((tick) => tick <= elapsedNightTicks).length;
}
