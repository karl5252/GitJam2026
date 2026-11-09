/**
 * Day/Dusk/Night shift cycle. Pure — no Phaser, no wall clock, no timers.
 *
 *   not-started --begin()--> DAY (day 1)
 *   DAY --(dayTicks executed)--> DUSK --(duskTicks executed)--> NIGHT
 *   NIGHT --(nightTicks-th executed tick)--> DAY (day + 1, AP restored) --> ...
 *   NIGHT --defeat()--> DEFEATED (final: nothing ticks or settles again)
 *
 * Two modes, chosen by `dayTicks`:
 *
 *   ACTIVE (dayTicks set; what GameScene plays): the first Day is DAY 0, the
 *   initial deployment. It is untimed: the clock stays paused, so no tick runs,
 *   nothing produces, moves, earns or emits, and building is the only thing that
 *   happens. Its END DAY goes straight into Dusk and the first Night. The calendar
 *   does not count it separately: `day` stays 1 through Day 0 and Night 1, so Night
 *   numbering, wave plans and settlement are exactly what they were. Every later
 *   Day runs on the clock like any other phase, and starts at 1x, unpaused. Day ticks 1..dayTicks see DAY, then Dusk ticks 1..duskTicks see
 *   DUSK, then the next tick is Night tick 1. END DAY does not jump: it asks for a
 *   fast-forward, and the caller runs the remaining Day ticks through stepTicks()
 *   in bounded batches, through the same tick callback as real frames. Construction
 *   stops the moment END DAY is pressed. The player may pause a Day, never a Dusk
 *   or Night: entering Dusk resumes the clock.
 *
 *   LEGACY (dayTicks null, the constructor default): Day is untimed. The clock is
 *   running but paused, so no ticks execute by Day, and endDay() starts the Night
 *   at once. Unit fixtures and TEST_MODE's ?cycle=legacy keep the scenarios they
 *   were written for.
 *
 * Night is the same in both modes. onTick() counts Night ticks 1..nightTicks; on
 * the last it settles the night (optional settleNight hook), switches to the next
 * Day (AP restored to exactly dayAp), and in LEGACY mode pauses the clock. Mutants,
 * waves and settlement therefore see exactly the Night numbering they always did.
 *
 * Exact night length: in LEGACY mode, pausing inside onTick zeroes the clock's
 * accumulator, which ends SimulationClock.advance()'s step loop right after the
 * final night tick. Manual stepping never runs past a change of shift.
 *
 * The global clock tick is never reset; phase ticks are tracked here.
 */

import {MAX_MANUAL_STEPS} from './simulationClock.js';

export const Shift = Object.freeze({DAY: 'day', DUSK: 'dusk', NIGHT: 'night', DEFEATED: 'defeated'});
export const NIGHT_TICKS = 3600; // 60 simulated seconds at 60 Hz
export const DAY_TICKS = 3600;
export const DUSK_TICKS = 300;
export const DAY_AP = 5;

export const ShiftFailure = Object.freeze({
    NOT_STARTED: 'not-started',
    ALREADY_STARTED: 'already-started',
    NOT_DAY: 'not-day',
    NOT_NIGHT: 'not-night',
    HQ_REQUIRED: 'hq-required',
    FAST_FORWARDING: 'fast-forwarding',
});

const isPositiveInt = (n) => Number.isInteger(n) && n > 0;

export class ShiftCycle {
    #clock;
    #economy;
    #nightTicks;
    #dayTicks;
    #duskTicks;
    #dayAp;
    #day = 0;
    #shift = null; // null until begin()
    #elapsedNightTicks = 0;
    #elapsedDayTicks = 0;
    #elapsedDuskTicks = 0;
    #fastForward = false;
    #deployment = false;
    #settleNight;
    #lastSettlement = null;
    #canEndDay;
    #holdDawn; // ACTIVE: () => boolean; true keeps a new Day at tick 0, paused, until the caller resumes it
    #defeatReport = null;

    /**
     * @param {{clock: import('./simulationClock.js').SimulationClock,
     *          economy: import('./economy.js').Economy,
     *          nightTicks?: number, dayTicks?: number | null, duskTicks?: number, dayAp?: number,
     *          settleNight?: ((completedDay: number) => object) | null,
     *          canEndDay?: () => boolean}} deps
     *   dayTicks - null for an untimed (LEGACY) Day, otherwise the Day's length
     *   duskTicks - ACTIVE mode only; 0 goes straight from Day to Night
     *   settleNight - called exactly once per completed night, with the day
     *   number whose night completed, before the next Day begins. Its return
     *   value (a frozen report) becomes `lastSettlement`.
     *   canEndDay - false keeps the run in Day, e.g. until HQ is built
     */
    constructor({clock, economy, nightTicks = NIGHT_TICKS, dayTicks = null, duskTicks = 0, dayAp = DAY_AP, settleNight = null, canEndDay = () => true, holdDawn = null}) {
        if (!isPositiveInt(nightTicks)) throw new RangeError(`nightTicks must be a positive integer, got ${nightTicks}`);
        if (dayTicks !== null && !isPositiveInt(dayTicks)) throw new RangeError(`dayTicks must be null or a positive integer, got ${dayTicks}`);
        if (!Number.isInteger(duskTicks) || duskTicks < 0) throw new RangeError(`duskTicks must be a non-negative integer, got ${duskTicks}`);
        if (!Number.isInteger(dayAp) || dayAp < 0) throw new RangeError(`dayAp must be a non-negative integer, got ${dayAp}`);
        this.#clock = clock;
        this.#economy = economy;
        this.#nightTicks = nightTicks;
        this.#dayTicks = dayTicks;
        this.#duskTicks = dayTicks === null ? 0 : duskTicks;
        this.#dayAp = dayAp;
        this.#settleNight = settleNight;
        this.#canEndDay = canEndDay;
        this.#holdDawn = holdDawn;
    }

    /** Report from the most recent completed night (frozen), or null. */
    get lastSettlement() { return this.#lastSettlement; }

    get day() { return this.#day; }
    get shift() { return this.#shift; }
    get started() { return this.#shift !== null; }
    /** ACTIVE mode: Day runs on the clock. */
    get timed() { return this.#dayTicks !== null; }
    get nightTicks() { return this.#nightTicks; }
    get dayTicks() { return this.#dayTicks; }
    get duskTicks() { return this.#duskTicks; }
    get elapsedNightTicks() { return this.#shift === Shift.NIGHT ? this.#elapsedNightTicks : 0; }
    get remainingNightTicks() { return this.#shift === Shift.NIGHT ? this.#nightTicks - this.#elapsedNightTicks : 0; }
    get elapsedDayTicks() { return this.#timedDay ? this.#elapsedDayTicks : 0; }
    get remainingDayTicks() { return this.#timedDay ? this.#dayTicks - this.#elapsedDayTicks : 0; }
    /** ACTIVE only: Day 0, the untimed initial deployment before the first Night. */
    get deployment() { return this.#deployment && this.#shift === Shift.DAY; }
    /** Is the clock running? Paused by the player, in Day 0, or in a LEGACY Day it is not. */
    get running() { return this.#clock.running && !this.#clock.paused; }
    get #timedDay() { return this.timed && this.#shift === Shift.DAY && !this.#deployment; }
    get elapsedDuskTicks() { return this.#shift === Shift.DUSK ? this.#elapsedDuskTicks : 0; }
    get remainingDuskTicks() { return this.#shift === Shift.DUSK ? this.#duskTicks - this.#elapsedDuskTicks : 0; }
    /** END DAY was pressed and the rest of the Day is being run. */
    get fastForwarding() { return this.#fastForward; }
    get isConstructionAllowed() { return this.#shift === Shift.DAY && !this.#fastForward; }
    get canEndDay() { return this.isConstructionAllowed && this.#canEndDay(); }
    /**
     * A timed Day the player has paused: look, select and inspect only. Every
     * gameplay change is refused until PLAY. Day 0 is never this: it is untimed,
     * not paused. END DAY's fast-forward is not either, because it runs.
     */
    get pausedDay() { return this.#timedDay && !this.#fastForward && !this.running; }
    /** Only a timed ACTIVE Day can be paused by the player; Day 0 has no clock to stop. */
    get canPause() { return this.#timedDay && !this.#fastForward; }
    /** Is the simulation in a phase that ticks? */
    get active() {
        return this.#shift === Shift.NIGHT || this.#shift === Shift.DUSK || this.#timedDay;
    }

    /** Frozen {day, nightTick, completedShifts} once defeated, otherwise null. */
    get defeatReport() { return this.#defeatReport; }

    /** Enter the first Day: Day 0 in the ACTIVE cycle. The clock starts paused: that Day is untimed. */
    begin() {
        if (this.started) return {ok: false, reason: ShiftFailure.ALREADY_STARTED};
        this.#day = 1;
        this.#shift = Shift.DAY;
        this.#elapsedDayTicks = 0;
        this.#deployment = this.timed;
        this.#clock.start();
        this.#clock.pause();
        return {ok: true};
    }

    /**
     * END DAY. LEGACY: Day -> Night at once, resuming the clock. ACTIVE: start the
     * fast-forward through the rest of the Day; the caller steps it in batches.
     */
    endDay() {
        if (!this.started) return {ok: false, reason: ShiftFailure.NOT_STARTED};
        if (this.#shift !== Shift.DAY) return {ok: false, reason: ShiftFailure.NOT_DAY};
        if (this.#fastForward) return {ok: false, reason: ShiftFailure.FAST_FORWARDING};
        if (!this.#canEndDay()) return {ok: false, reason: ShiftFailure.HQ_REQUIRED};
        if (this.#deployment) {
            this.#endDeployment();
            return {ok: true};
        }
        if (this.timed) {
            this.#fastForward = true;
            return {ok: true};
        }
        this.#shift = Shift.NIGHT;
        this.#elapsedNightTicks = 0;
        this.#clock.resume();
        return {ok: true};
    }

    /**
     * Fixed-step callback — call exactly once per executed simulation tick.
     * Ignored in an untimed Day (no ticks should execute then anyway).
     */
    onTick(_tick) {
        switch (this.#shift) {
            case Shift.DAY:
                if (!this.#timedDay) return;
                if (this.#elapsedDayTicks >= this.#dayTicks) this.#enterDusk();
                else this.#elapsedDayTicks++;
                return;
            case Shift.DUSK:
                if (this.#elapsedDuskTicks >= this.#duskTicks) this.#enterNight();
                else this.#elapsedDuskTicks++;
                return;
            case Shift.NIGHT:
                if (this.#elapsedNightTicks + 1 >= this.#nightTicks) {
                    this.#completeNight();
                    return;
                }
                this.#elapsedNightTicks++;
                return;
            default:
        }
    }

    /**
     * End the run. Only HQ destruction during Night calls this, and it can only
     * happen once. The clock pauses inside the tick, which ends advance()'s loop,
     * and no later tick settles, so this night earns and emits nothing.
     */
    defeat() {
        if (this.#shift !== Shift.NIGHT) return {ok: false, reason: ShiftFailure.NOT_NIGHT};
        this.#defeatReport = Object.freeze({
            day: this.#day,
            nightTick: this.#elapsedNightTicks,
            completedShifts: this.#day - 1,
        });
        this.#shift = Shift.DEFEATED;
        this.#clock.pause();
        return {ok: true};
    }

    /**
     * Stepping through the real clock, for QA and for END DAY's fast-forward. Runs
     * at most `count` ticks and never past a change of shift: the tick that changes
     * it is the last one run. Nothing runs in an untimed Day. It steps one tick at a
     * time because the clock's own stepTicks keeps running after a pause, which
     * would run on past a defeat.
     * @returns {number} ticks executed
     */
    stepTicks(count, onTick) {
        if (!Number.isInteger(count) || count < 1 || count > MAX_MANUAL_STEPS) {
            throw new RangeError(`count must be an integer in 1..${MAX_MANUAL_STEPS}, got ${count}`);
        }
        if (!this.active) return 0;
        const start = this.#shift;
        let done = 0;
        while (done < count && this.#shift === start) {
            const ran = this.#clock.stepTicks(1, onTick);
            if (ran === 0) break;
            done += ran;
        }
        return done;
    }

    /**
     * QA only: testShadow/dayQa.js is the one caller, and it exists in test mode
     * alone. Moves the calendar during a Day and does nothing else: no Night runs,
     * so nothing settles, spawns or earns, and AP stays as it is. The plan for a
     * Night is made on its first tick, so the next Night reads this day.
     * @returns {{ok: true} | {ok: false, reason: string}}
     */
    jumpToDay(day) {
        if (!Number.isSafeInteger(day) || day < 1) throw new RangeError(`day must be a positive integer, got ${day}`);
        if (!this.started) return {ok: false, reason: ShiftFailure.NOT_STARTED};
        if (this.#shift !== Shift.DAY) return {ok: false, reason: ShiftFailure.NOT_DAY};
        this.#day = day;
        return {ok: true};
    }

    /** Resume a paused clock: LEGACY only at Night, ACTIVE in any phase that ticks. */
    resume() {
        if (this.timed ? this.active : this.#shift === Shift.NIGHT) this.#clock.resume();
    }

    snapshot() {
        const base = {
            day: this.#day,
            shift: this.#shift,
            elapsedNightTicks: this.elapsedNightTicks,
            remainingNightTicks: this.remainingNightTicks,
        };
        if (!this.timed) return base;
        return {
            ...base,
            deployment: this.deployment,
            elapsedDayTicks: this.elapsedDayTicks,
            remainingDayTicks: this.remainingDayTicks,
            elapsedDuskTicks: this.elapsedDuskTicks,
            remainingDuskTicks: this.remainingDuskTicks,
            fastForwarding: this.#fastForward,
        };
    }

    /**
     * Day 0's END DAY: no Day ticks are left to run, so Dusk starts now and the next
     * tick is its first. Nothing has ticked yet, so nothing was skipped.
     */
    #endDeployment() {
        this.#deployment = false;
        this.#elapsedDayTicks = 0;
        this.#clock.resume();
        if (this.#duskTicks === 0) {
            this.#shift = Shift.NIGHT;
            this.#elapsedNightTicks = 0;
            return;
        }
        this.#shift = Shift.DUSK;
        this.#elapsedDuskTicks = 0;
    }

    /** This tick is Dusk tick 1, or Night tick 1 with no Dusk. Nobody can pause a Dusk. */
    #enterDusk() {
        this.#fastForward = false;
        this.#elapsedDayTicks = 0;
        this.#clock.resume();
        if (this.#duskTicks === 0) {
            this.#enterNight();
            return;
        }
        this.#shift = Shift.DUSK;
        this.#elapsedDuskTicks = 1;
    }

    /** This tick is Night tick 1, exactly as the first tick after a LEGACY END DAY. */
    #enterNight() {
        this.#shift = Shift.NIGHT;
        this.#elapsedDuskTicks = 0;
        this.#elapsedNightTicks = 1;
    }

    /**
     * The final night tick: settle, then start the next Day.
     *
     * Exactly once: this is reached only from onTick during Night on its
     * last tick, and it switches to Day in the same call.
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
        this.#elapsedDayTicks = 0;
        this.#economy.restoreAp(this.#dayAp);
        if (!this.timed) {
            this.#clock.pause();
            return;
        }
        // Every timed Day starts the same way, whatever the Night was played at.
        this.#clock.setSpeed(1);
        // TASK 029: held, the clock pauses inside this tick, as LEGACY does, so no Day
        // tick can follow in the same frame however fast the Night ran. The Day then
        // waits at tick 0 as an ordinary paused Day until the caller resumes it.
        if (this.#holdDawn?.()) this.#clock.pause();
        else this.#clock.resume();
    }
}
