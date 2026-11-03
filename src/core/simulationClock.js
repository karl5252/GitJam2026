/**
 * Fixed-step simulation clock. Pure — no Phaser, no wall clock, no timers.
 *
 * Same accumulator contract as Steel Abyss: Refit / BarrelStorm: frame
 * deltas (ms) feed an accumulator that is drained in fixed 1/60 s steps.
 *
 * Lifecycle: stopped --start()--> running <--pause()/resume()--> paused
 *            reset() returns to stopped (tick 0) from any state.
 *
 * Long frames: each frame delta is capped at maxFrameMs (default 100 ms =
 * 6 ticks) BEFORE accumulation. Excess elapsed time is deliberately dropped,
 * so a stall or a suspended tab slows the simulation instead of triggering a
 * catch-up spiral.
 *
 * Time is derived from the integer tick count, so it never drifts.
 */

export const TICK_RATE = 60;
export const MAX_FRAME_MS = 100;
export const MAX_MANUAL_STEPS = 240;

const EPSILON = 1e-9; // ms; absorbs float error when deltas sum to exact step multiples

export class SimulationClock {
    #tickRate;
    #stepMs;
    #maxFrameMs;
    #tick = 0;
    #accumulatorMs = 0;
    #running = false;
    #paused = false;

    constructor({tickRate = TICK_RATE, maxFrameMs = MAX_FRAME_MS} = {}) {
        if (!Number.isInteger(tickRate) || tickRate <= 0) {
            throw new RangeError(`tickRate must be a positive integer, got ${tickRate}`);
        }
        this.#tickRate = tickRate;
        this.#stepMs = 1000 / tickRate;
        if (!Number.isFinite(maxFrameMs) || maxFrameMs < this.#stepMs) {
            throw new RangeError(`maxFrameMs must be a finite number >= one step (${this.#stepMs} ms), got ${maxFrameMs}`);
        }
        this.#maxFrameMs = maxFrameMs;
    }

    get tickRate() { return this.#tickRate; }
    get tick() { return this.#tick; }
    get timeSeconds() { return this.#tick / this.#tickRate; }
    get running() { return this.#running; }
    get paused() { return this.#paused; }

    /** stopped -> running. No-op if already started. */
    start() {
        this.#running = true;
    }

    /** Stops real-time advancement and discards any partial step. */
    pause() {
        if (!this.#running) return;
        this.#paused = true;
        this.#accumulatorMs = 0;
    }

    resume() {
        if (!this.#running) return;
        this.#paused = false;
    }

    /** Back to the initial stopped state. */
    reset() {
        this.#tick = 0;
        this.#accumulatorMs = 0;
        this.#running = false;
        this.#paused = false;
    }

    /**
     * Real-time path: convert one frame delta into fixed steps.
     * Does nothing (returns 0) when stopped or paused.
     * @param {number} deltaMs - frame delta in milliseconds, >= 0
     * @param {(tick: number) => void} onTick - called once per step with the tick being executed
     * @returns {number} steps executed
     */
    advance(deltaMs, onTick = () => {}) {
        if (!Number.isFinite(deltaMs) || deltaMs < 0) {
            throw new RangeError(`deltaMs must be a finite non-negative number, got ${deltaMs}`);
        }
        if (!this.#running || this.#paused) return 0;

        this.#accumulatorMs += Math.min(deltaMs, this.#maxFrameMs);
        let steps = 0;
        while (this.#accumulatorMs + EPSILON >= this.#stepMs) {
            this.#accumulatorMs -= this.#stepMs;
            this.#runStep(onTick);
            steps++;
        }
        if (this.#accumulatorMs < 0) this.#accumulatorMs = 0; // epsilon overshoot
        return steps;
    }

    /**
     * Manual path: execute exactly `count` steps through the same callback,
     * without rendering. Allowed while paused (single-stepping) and does not
     * unpause. Does nothing (returns 0) before start() or after reset().
     * @returns {number} steps executed
     */
    stepTicks(count, onTick = () => {}) {
        if (!Number.isInteger(count) || count < 1 || count > MAX_MANUAL_STEPS) {
            throw new RangeError(`count must be an integer in 1..${MAX_MANUAL_STEPS}, got ${count}`);
        }
        if (!this.#running) return 0;
        for (let i = 0; i < count; i++) this.#runStep(onTick);
        return count;
    }

    /** Detached, JSON-serializable state. */
    snapshot() {
        return {
            running: this.#running,
            paused: this.#paused,
            tick: this.#tick,
            timeSeconds: this.timeSeconds,
        };
    }

    #runStep(onTick) {
        onTick(this.#tick);
        this.#tick++;
    }
}
