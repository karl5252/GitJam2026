/**
 * Deterministic night wave planning. Pure — no Phaser, no state, no clock and
 * no randomness. Spawn positions stay in Mutants, which draws one RNG value
 * per spawn.
 *
 *   nightBudget        = 1 + floor((night - 1) / nightsPerExtra)
 *   pollutionBudget    = perThreatLevel * (threatLevel - 1)
 *   defenseResponse    = min(maxResponse, floor(max(0, stationary guns - 1) / cannonsPerResponse))
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
 * existing Autocannon and Siege Cannon counts as one stationary gun, whether or
 * not it is enabled or powered.
 *
 * A Spitter takes the place of one ordinary mutant, so the budget, the schedule
 * and every spawn position stay what they would have been. The plan only says
 * which slots they fill, which is why they cost no random numbers:
 *
 *   spitters = night < firstNight ? 0
 *            : min(maxPerNight, floor(budget / budgetPerSpitter), 1 + floor((night - firstNight) / nightsPerExtra))
 *
 * A Brute is late-game pressure and arrives by the Night alone, so it does not
 * touch the Nights before it. It costs three slots: it spawns in one, and the other
 * two are absorbed, which means they keep their tick and their random number but
 * spawn nothing. The schedule, the spawn positions of everyone else and Wave X/Y
 * therefore stay as they would have been, and a wave gets heavier without getting
 * bigger. From Night 29 every base is at the cap, so a Brute always has room.
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

export const BRUTE_WAVE = Object.freeze({
    tiers: Object.freeze([ // the most recent one reached applies
        Object.freeze({fromNight: 40, brutes: 3}),
        Object.freeze({fromNight: 35, brutes: 2}),
        Object.freeze({fromNight: 30, brutes: 1}),
    ]),
    slotCost: 3,
});

const AUTOCANNON_TYPE = 'autocannon';
const SIEGE_CANNON_TYPE = 'siegeCannon';

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

/** How many of a night's mutants are Brutes. */
export function bruteCount(night) {
    assertCount('night', night, 1);
    return BRUTE_WAVE.tiers.find(({fromNight}) => night >= fromNight)?.brutes ?? 0;
}

/**
 * Where Brutes go, once Spitters have their slots, which never move. They spread
 * over the first half of the schedule, because a slow mutant spawned late would
 * never arrive, and never take slot 0. Each takes the first free slot from its
 * place, then the next free ones to absorb.
 * @param {number} budget
 * @param {readonly number[]} taken the slots already spoken for
 * @param {number} brutes
 * @returns {{bruteSlots: readonly number[], absorbedSlots: readonly number[]}} frozen, strictly increasing
 */
export function bruteSlots(budget, taken, brutes) {
    assertCount('budget', budget, 0);
    assertCount('brutes', brutes, 0);
    const used = new Set(taken);
    const claim = (from) => {
        let slot = from;
        while (used.has(slot)) slot++;
        if (slot >= budget) throw new RangeError(`${brutes} brutes do not fit a budget of ${budget}`);
        used.add(slot);
        return slot;
    };
    const slots = [];
    const absorbed = [];
    for (let k = 0; k < brutes; k++) {
        const slot = claim(Math.max(1, Math.floor((2 * k + 1) * budget / (4 * brutes))));
        slots.push(slot);
        for (let i = 1; i < BRUTE_WAVE.slotCost; i++) absorbed.push(claim(slot + 1));
    }
    const ascending = (a, b) => a - b;
    return Object.freeze({bruteSlots: Object.freeze(slots.sort(ascending)), absorbedSlots: Object.freeze(absorbed.sort(ascending))});
}

/**
 * The frozen plan for one night. It holds numbers only, so it shares nothing
 * with the building records it was computed from.
 * @param {{day: number, pollution: number, buildings: Array<{type: string}>}} input
 */
export function nightPlan({day, pollution, buildings}) {
    const threat = threatLevel(pollution);
    const autocannons = buildings.filter((b) => b.type === AUTOCANNON_TYPE).length;
    const siegeCannons = buildings.filter((b) => b.type === SIEGE_CANNON_TYPE).length;
    const guns = autocannons + siegeCannons;
    const budget = waveBudget(day, threat, guns);
    const spitters = spitterCount(day, budget);
    const spitterPlaces = spitterSlots(budget, spitters);
    const brutes = bruteCount(day);
    return Object.freeze({
        day,
        threatLevel: threat,
        autocannons,
        siegeCannons,
        nightBudget: nightBudget(day),
        pollutionBudget: pollutionBudget(threat),
        defenseResponse: defenseResponse(guns),
        accelerationBudget: accelerationBudget(day),
        budget,
        lastSpawnTick: lastSpawnTick(day),
        schedule: waveSchedule(budget, lastSpawnTick(day)),
        spitters,
        spitterSlots: spitterPlaces,
        brutes,
        ...bruteSlots(budget, spitterPlaces, brutes),
    });
}

/** Scheduled slots reached by a night tick. A skipped spawn's slot still counts. */
export function waveProgress(plan, elapsedNightTicks) {
    return plan.schedule.filter((tick) => tick <= elapsedNightTicks).length;
}
