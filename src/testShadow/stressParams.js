// testShadow/stressParams.js
//
// TEST_MODE-only spawn overrides for the soak suites. The caller must guard
// this with TEST_MODE, so production never reads these parameters. Both give
// the real Mutants a fixed schedule; nothing here simulates anything.
//
//   ?waveBudget=N    the real waveSchedule(N), for N in 0..WAVE.maxPerNight
//   ?waveLastTick=T  with waveBudget, ends that schedule on tick T, for T in
//                    WAVE.minLastTick..WAVE.lastTick. Ignored on its own.
//   ?stressRamp=N  one mutant per tick from tick 1, for N in 1..3599
//   ?waveSpitters=K  with waveBudget, makes K of those mutants Spitters, in the
//                    real spitterSlots(N, K), for K in 0..N. Ignored on its own.

import {WAVE, spitterSlots, waveSchedule} from '../core/waves.js';

const MAX_RAMP = 3599; // spawns must land on a night tick before the last

function parseCount(raw, min, max) {
    if (raw === null || !/^\d+$/.test(raw)) return null;
    const value = Number(raw);
    return value >= min && value <= max ? value : null;
}

/** @returns {number[]|null} a fixed schedule, or null when no valid override is present */
export function parseStressSchedule(search) {
    const params = new URLSearchParams(search);
    const ramp = parseCount(params.get('stressRamp'), 1, MAX_RAMP);
    if (ramp !== null) return Array.from({length: ramp}, (_, i) => i + 1);
    const budget = parseCount(params.get('waveBudget'), 0, WAVE.maxPerNight);
    if (budget === null) return null;
    const lastTick = parseCount(params.get('waveLastTick'), WAVE.minLastTick, WAVE.lastTick);
    return [...waveSchedule(budget, lastTick ?? WAVE.lastTick)];
}

/** @returns {number[]} which slots of a waveBudget schedule are Spitters; none without a valid override */
export function parseStressSpitters(search) {
    const params = new URLSearchParams(search);
    if (parseCount(params.get('stressRamp'), 1, MAX_RAMP) !== null) return [];
    const budget = parseCount(params.get('waveBudget'), 0, WAVE.maxPerNight);
    if (budget === null) return [];
    const spitters = parseCount(params.get('waveSpitters'), 0, budget);
    return spitters === null ? [] : [...spitterSlots(budget, spitters)];
}
