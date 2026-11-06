/**
 * Deterministic night wave planning. Pure — no Phaser, no state, no clock and
 * no randomness. Spawn positions stay in Mutants, which draws one RNG value
 * per spawn.
 *
 *   nightBudget        = 1 + floor((night - 1) / nightsPerExtra)
 *   pollutionBudget    = perThreatLevel * (threatLevel - 1)
 *   defenseResponse    = min(maxResponse, floor(max(0, autocannons - 1) / cannonsPerResponse))
 *   accelerationBudget = floor(max(0, night - accelerationFromNight)^2 / accelerationDivisor)
 *   budget             = min(maxPerNight, the sum of all four)
 *   lastSpawnTick      = max(minLastTick, lastTick - windowShrinkPerNight * max(0, night - accelerationFromNight))
 *
 * Acceleration and the shrinking spawn window depend only on the night, so
 * pressure keeps rising without Pollution. A larger wave arriving in a shorter
 * window is what outruns a fixed number of Autocannons.
 *
 * Mutants asks for a plan once, on night tick 1, and keeps it until dawn.
 * Pollution only changes during settlement, construction is off at night and
 * no mutant exists yet on tick 1, so this equals sampling at END DAY. Every
 * existing Autocannon counts, whether or not it is enabled or powered.
 *
 * A Spitter takes the place of one ordinary mutant, so the budget, the schedule
 * and every spawn position stay what they would have been. The plan only says
 * which slots they fill, which is why they cost no random numbers:
 *
 *   spitters = night < firstNight ? 0
 *            : min(maxPerNight, floor(budget / budgetPerSpitter), 1 + floor((night - firstNight) / nightsPerExtra))
 *
 * All values are temporary and unbalanced; rebalance them here.
 */
import {threatLevel} from './pollution.js';

export const WAVE = Object.freeze({
    firstTick: 600,
    lastTick: 2700, // later spawns would mostly be removed at dawn before arriving
    minLastTick: 1200,
    windowShrinkPerNight: 100,
    nightsPerExtra: 2,
    perThreatLevel: 2,
    cannonsPerResponse: 2,
    maxResponse: 4,
    accelerationFromNight: 6,
    accelerationDivisor: 12,
    maxPerNight: 40,
});

export const SPITTER_WAVE = Object.freeze({
    firstNight: 5,
    budgetPerSpitter: 4,
    nightsPerExtra: 3,
    maxPerNight: 6,
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

const nightsAccelerated = (night) => Math.max(0, night - WAVE.accelerationFromNight);

export function accelerationBudget(night) {
    assertCount('night', night, 1);
    return Math.floor(nightsAccelerated(night) ** 2 / WAVE.accelerationDivisor);
}

export function waveBudget(night, threat, autocannons) {
    const total = nightBudget(night) + pollutionBudget(threat) + defenseResponse(autocannons) + accelerationBudget(night);
    return Math.min(WAVE.maxPerNight, total);
}

/** The latest spawn tick of a night: the window closes earlier as nights pass. */
export function lastSpawnTick(night) {
    assertCount('night', night, 1);
    return Math.max(WAVE.minLastTick, WAVE.lastTick - WAVE.windowShrinkPerNight * nightsAccelerated(night));
}

/**
 * Spawn ticks for a budget: strictly increasing, one spawn per tick, from
 * firstTick to lastTick, with gaps that shrink through the night. Integer
 * arithmetic only. The approved windows never need it, but in a window much
 * shorter than the budget gaps round to zero, so spawns are walked back until
 * each has its own tick.
 * @param {number} budget
 * @param {number} [lastTick] - the last spawn tick; a budget must fit the window
 * @returns {readonly number[]} frozen
 */
export function waveSchedule(budget, lastTick = WAVE.lastTick) {
    assertCount('budget', budget, 0);
    assertCount('lastTick', lastTick, WAVE.firstTick);
    if (budget <= 1) return Object.freeze(budget === 1 ? [WAVE.firstTick] : []);
    const span = lastTick - WAVE.firstTick;
    const last = budget - 1;
    if (last > span) throw new RangeError(`budget ${budget} does not fit a window ending on tick ${lastTick}`);
    const ticks = Array.from({length: budget}, (_, i) => (
        WAVE.firstTick + Math.floor(span * i * (2 * last - i) / (last * last))
    ));
    for (let i = last - 1; i >= 0; i--) ticks[i] = Math.min(ticks[i], ticks[i + 1] - 1);
    return Object.freeze(ticks);
}

/** How many of a night's mutants are Spitters. */
export function spitterCount(night, budget) {
    assertCount('night', night, 1);
    assertCount('budget', budget, 0);
    if (night < SPITTER_WAVE.firstNight) return 0;
    const ramp = 1 + Math.floor((night - SPITTER_WAVE.firstNight) / SPITTER_WAVE.nightsPerExtra);
    return Math.min(SPITTER_WAVE.maxPerNight, Math.floor(budget / SPITTER_WAVE.budgetPerSpitter), ramp);
}

/**
 * Which slots of a schedule are Spitters: evenly spread and centred. In a real
 * wave at most a quarter are Spitters, so the first attacker is always melee.
 * @returns {readonly number[]} frozen, strictly increasing indices into the schedule
 */
export function spitterSlots(budget, spitters) {
    assertCount('budget', budget, 0);
    assertCount('spitters', spitters, 0);
    if (spitters > budget) throw new RangeError(`${spitters} spitters do not fit a budget of ${budget}`);
    return Object.freeze(Array.from({length: spitters}, (_, k) => Math.floor((2 * k + 1) * budget / (2 * spitters))));
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
    const spitters = spitterCount(day, budget);
    return Object.freeze({
        day,
        threatLevel: threat,
        autocannons,
        nightBudget: nightBudget(day),
        pollutionBudget: pollutionBudget(threat),
        defenseResponse: defenseResponse(autocannons),
        accelerationBudget: accelerationBudget(day),
        budget,
        lastSpawnTick: lastSpawnTick(day),
        schedule: waveSchedule(budget, lastSpawnTick(day)),
        spitters,
        spitterSlots: spitterSlots(budget, spitters),
    });
}

/** Scheduled slots reached by a night tick. A skipped spawn's slot still counts. */
export function waveProgress(plan, elapsedNightTicks) {
    return plan.schedule.filter((tick) => tick <= elapsedNightTicks).length;
}
