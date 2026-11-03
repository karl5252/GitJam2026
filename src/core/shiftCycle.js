/**
 * Day/Night shift cycle. Pure — no Phaser, no wall clock, no timers.
 *
 *   not-started --begin()--> DAY (day 1) --endDay()--> NIGHT
 *   NIGHT --(nightTicks-th executed tick)--> DAY (day + 1, AP restored) --> ...
 *
 * Day Shift is untimed: the SimulationClock is running but paused, so no
 * ticks execute. endDay() resumes it; onTick() — the fixed-step callback used
 * by both real frames and manual QA stepping — counts night ticks and, on
 * the last one, settles the night (optional settleNight hook), switches to
 * the next Day (AP restored to exactly dayAp) and pauses the clock again.
 *
 * Exact night length: pausing inside onTick zeroes the clock's accumulator,
 * which ends SimulationClock.advance()'s step loop right after the final
 * night tick (excess frame time is dropped). Manual stepping is clamped to
 * the remaining night ticks. So no tick ever executes during a Day.
 *
 * The global clock tick is never reset; elapsedNightTicks is tracked here.
 */

import {MAX_MANUAL_STEPS} from './simulationClock.js';

export const Shift = Object.freeze({DAY: 'day', NIGHT: 'night'});
export const NIGHT_TICKS = 3600; // 60 simulated seconds at 60 Hz
export const DAY_AP = 5;

export const ShiftFailure = Object.freeze({
    NOT_STARTED: 'not-started',
    ALREADY_STARTED: 'already-started',
    NOT_DAY: 'not-day',
});

const isPositiveInt = (n) => Number.isInteger(n) && n > 0;

export class ShiftCycle {
    #clock;
    #economy;
    #nightTicks;
    #dayAp;
    #day = 0;
    #shift = null; // null until begin()
    #elapsedNightTicks = 0;
    #settleNight;
    #lastSettlement = null;

    /**
     * @param {{clock: import('./simulationClock.js').SimulationClock,
     *          economy: import('./economy.js').Economy,
     *          nightTicks?: number, dayAp?: number,
     *          settleNight?: ((completedDay: number) => object) | null}} deps
     *   settleNight - called exactly once per completed night, with the day
     *   number whose night completed, before the next Day begins. Its return
     *   value (a frozen report) becomes `lastSettlement`.
     */
    constructor({clock, economy, nightTicks = NIGHT_TICKS, dayAp = DAY_AP, settleNight = null}) {
        if (!isPositiveInt(nightTicks)) throw new RangeError(`nightTicks must be a positive integer, got ${nightTicks}`);
        if (!Number.isInteger(dayAp) || dayAp < 0) throw new RangeError(`dayAp must be a non-negative integer, got ${dayAp}`);
        this.#clock = clock;
        this.#economy = economy;
        this.#nightTicks = nightTicks;
        this.#dayAp = dayAp;
        this.#settleNight = settleNight;
    }

    /** Report from the most recent completed night (frozen), or null. */
    get lastSettlement() { return this.#lastSettlement; }

    get day() { return this.#day; }
    get shift() { return this.#shift; }
    get started() { return this.#shift !== null; }
    get nightTicks() { return this.#nightTicks; }
    get elapsedNightTicks() { return this.#shift === Shift.NIGHT ? this.#elapsedNightTicks : 0; }
    get remainingNightTicks() { return this.#shift === Shift.NIGHT ? this.#nightTicks - this.#elapsedNightTicks : 0; }
    get isConstructionAllowed() { return this.#shift === Shift.DAY; }

    /** Enter Day 1. The clock starts but stays paused during Day Shift. */
    begin() {
        if (this.started) return {ok: false, reason: ShiftFailure.ALREADY_STARTED};
        this.#day = 1;
        this.#shift = Shift.DAY;
        this.#clock.start();
        this.#clock.pause();
        return {ok: true};
    }

    /** Day -> Night. Resumes the clock. */
    endDay() {
        if (!this.started) return {ok: false, reason: ShiftFailure.NOT_STARTED};
        if (this.#shift !== Shift.DAY) return {ok: false, reason: ShiftFailure.NOT_DAY};
        this.#shift = Shift.NIGHT;
        this.#elapsedNightTicks = 0;
        this.#clock.resume();
        return {ok: true};
    }

    /**
     * Fixed-step callback — call exactly once per executed simulation tick.
     * Ignored outside Night Shift (no ticks should execute then anyway).
     */
    onTick(_tick) {
        if (this.#shift !== Shift.NIGHT) return;
        if (this.#elapsedNightTicks + 1 >= this.#nightTicks) {
            this.#completeNight();
            return;
        }
        this.#elapsedNightTicks++;
    }

    /**
     * Manual (QA) stepping through the real clock. Only during Night, and
     * clamped so it can never step past the end of the night into a Day.
     * @returns {number} ticks executed
     */
    stepTicks(count, onTick) {
        if (!Number.isInteger(count) || count < 1 || count > MAX_MANUAL_STEPS) {
            throw new RangeError(`count must be an integer in 1..${MAX_MANUAL_STEPS}, got ${count}`);
        }
        if (this.#shift !== Shift.NIGHT) return 0;
        return this.#clock.stepTicks(Math.min(count, this.remainingNightTicks), onTick);
    }

    /** QA resume: only meaningful during Night; Day Shift never ticks. */
    resume() {
        if (this.#shift === Shift.NIGHT) this.#clock.resume();
    }

    snapshot() {
        return {
            day: this.#day,
            shift: this.#shift,
            elapsedNightTicks: this.elapsedNightTicks,
            remainingNightTicks: this.remainingNightTicks,
        };
    }

    /**
     * The final night tick: settle, then start the next Day.
     *
     * Exactly once: this is reached only from onTick during Night on its
     * last tick, and it switches to Day (which never ticks) in the same call.
     *
     * Failure behaviour: settlement runs first, before any cycle state
     * changes. If it throws, nothing is modified — still Night with one tick
     * remaining, AP and the clock untouched (SimulationClock only counts a
     * tick after onTick returns) — and the error propagates. The final tick
     * is simply retried on the next step.
     */
    #completeNight() {
        const report = this.#settleNight ? this.#settleNight(this.#day) : null;
        this.#lastSettlement = report;
        this.#day++;
        this.#shift = Shift.DAY;
        this.#elapsedNightTicks = 0;
        this.#economy.restoreAp(this.#dayAp);
        this.#clock.pause();
    }
}
