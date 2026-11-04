/**
 * Automated Autocannon fire. Pure — no Phaser, no timers, no randomness.
 *
 * step() runs once per executed simulation tick, AFTER ShiftCycle.onTick()
 * and BEFORE Mutants.step(), so a mutant killed on a tick cannot act on it.
 * Turrets fire on night ticks 1..nightTicks-1; outside Night step() clears
 * all turret state, which resets cooldowns at dawn.
 *
 * HP, position and the enabled flag belong to BuildingPlacement, power is
 * derived by calculatePower, and mutant HP belongs to Mutants. This module
 * only holds each turret's cooldown and locked target, keyed by building id.
 *
 * Each turret, in building-list order:
 *   - Unpowered or disabled: the lock is cleared and the cooldown pauses.
 *   - The cooldown counts down, whether or not there is a target.
 *   - A locked target is kept while it is alive and in range. Otherwise the
 *     nearest living mutant in range is acquired. This never touches the
 *     cooldown.
 *   - With a target and a cooldown of 0, the turret hits instantly.
 */
import {Shift} from './shiftCycle.js';
import {calculatePower} from './power.js';

export const AUTOCANNON = Object.freeze({
    range: 160, // world px, from the footprint centre to the mutant
    damage: 10,
    cooldownTicks: 30,
});

const AUTOCANNON_TYPE = 'autocannon';
const NO_EFFECTS = Object.freeze({shots: Object.freeze([])});

const squaredDistance = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Range is circular and inclusive. Squared values stay exact, with no sqrt. */
export function isInRange(center, mutant) {
    return squaredDistance(center, mutant) <= AUTOCANNON.range ** 2;
}

/**
 * Nearest mutant in range. Ties go to the earliest in the list, which is spawn
 * order; ids are not compared ('mutant-10' sorts before 'mutant-2').
 * @returns {object|null} the mutant, or null when none is in range
 */
export function selectMutant(center, mutants) {
    let best = null;
    for (const mutant of mutants) {
        if (!isInRange(center, mutant)) continue;
        if (!best || squaredDistance(center, mutant) < squaredDistance(center, best)) best = mutant;
    }
    return best;
}

export class Autocannons {
    #cycle;
    #placement;
    #grid;
    #mutants;
    #turrets = new Map(); // building id -> {cooldown, targetId}

    /**
     * @param {{cycle: import('./shiftCycle.js').ShiftCycle,
     *          placement: import('./buildingPlacement.js').BuildingPlacement,
     *          grid: import('./grid.js').Grid,
     *          mutants: import('./mutants.js').Mutants}} deps
     */
    constructor({cycle, placement, grid, mutants}) {
        this.#cycle = cycle;
        this.#placement = placement;
        this.#grid = grid;
        this.#mutants = mutants;
    }

    /**
     * One simulation tick.
     * @returns {{shots: Array<{turretId, mutantId, damage, hp, killed, x, y}>}}
     *   x and y are where the mutant was when it was hit
     */
    step() {
        if (this.#cycle.shift !== Shift.NIGHT) {
            this.#turrets.clear();
            return NO_EFFECTS;
        }
        const buildings = this.#placement.buildings();
        const cannons = buildings.filter((b) => b.type === AUTOCANNON_TYPE);
        this.#forgetDestroyed(cannons);
        if (cannons.length === 0) return NO_EFFECTS;

        const powered = new Set(calculatePower(buildings).buildings.filter((b) => b.powered).map((b) => b.id));
        const shots = [];
        for (const cannon of cannons) {
            const turret = this.#turretFor(cannon.id);
            if (!powered.has(cannon.id)) {
                turret.targetId = null;
                continue;
            }
            if (turret.cooldown > 0) turret.cooldown--;
            const target = this.#aim(turret, cannon);
            if (target && turret.cooldown === 0) shots.push(this.#fire(turret, cannon, target));
        }
        this.#dropDeadTargets();
        return shots.length ? {shots} : NO_EFFECTS;
    }

    /** Detached plain data for existing Autocannons, in building-list order. */
    snapshot() {
        return this.#placement.buildings()
            .filter((b) => b.type === AUTOCANNON_TYPE)
            .map(({id}) => ({id, cooldown: 0, targetId: null, ...this.#turrets.get(id)}));
    }

    #turretFor(id) {
        if (!this.#turrets.has(id)) this.#turrets.set(id, {cooldown: 0, targetId: null});
        return this.#turrets.get(id);
    }

    #forgetDestroyed(cannons) {
        for (const id of this.#turrets.keys()) {
            if (!cannons.some((cannon) => cannon.id === id)) this.#turrets.delete(id);
        }
    }

    /** Keep a valid lock, or acquire the nearest mutant in range. */
    #aim(turret, cannon) {
        const center = this.#centerOf(cannon);
        const mutants = this.#mutants.snapshot();
        const locked = mutants.find((mutant) => mutant.id === turret.targetId);
        const target = locked && isInRange(center, locked) ? locked : selectMutant(center, mutants);
        turret.targetId = target ? target.id : null;
        return target;
    }

    #fire(turret, cannon, target) {
        turret.cooldown = AUTOCANNON.cooldownTicks;
        const result = this.#mutants.damageMutant(target.id, AUTOCANNON.damage);
        if (!result.ok) throw new Error(`Autocannon ${cannon.id} could not damage ${target.id}: ${result.reason}`);
        return {
            turretId: cannon.id,
            mutantId: target.id,
            damage: AUTOCANNON.damage,
            hp: result.hp,
            killed: result.killed,
            x: target.x,
            y: target.y,
        };
    }

    /** A kill by one turret must not leave another turret locked on the dead mutant. */
    #dropDeadTargets() {
        const living = new Set(this.#mutants.snapshot().map((mutant) => mutant.id));
        for (const turret of this.#turrets.values()) {
            if (!living.has(turret.targetId)) turret.targetId = null;
        }
    }

    #centerOf(building) {
        const {x, y, width, height} = this.#grid.footprintRect(building);
        return {x: x + width / 2, y: y + height / 2};
    }
}
