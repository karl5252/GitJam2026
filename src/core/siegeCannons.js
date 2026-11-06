/**
 * Siege Cannons: slow, long-range, stationary guns for heavy targets. Pure: no
 * Phaser, no timers and no randomness.
 *
 * step() runs once per tick, after ShiftCycle.onTick() and BEFORE
 * Autocannons.step(), so a mutant killed here is one no turret stays locked on,
 * and it cannot act on this tick. Guns fire on Night ticks 1..nightTicks-1.
 * Outside Night step() clears everything, shells in the air included, which resets
 * reloads at dawn. After a defeat everything stays as it was.
 *
 * Each gun, in building-list order:
 *   - Unpowered or disabled: the reload pauses and it does not fire.
 *   - The reload counts down, whether or not there is a target.
 *   - Ready, it picks a target between its minimum and maximum range: the nearest
 *     Brute, otherwise the nearest mutant. There is no lock, and nothing else is
 *     preferred: a Spitter is one more mutant.
 *
 * A shell flies over everything, like all player fire, to the point its target
 * stood on when it was fired. It lands first thing on its tick and hits at most one
 * mutant near that point. There is no splash. A shell outlives its gun, which only
 * means a gun that has gone can fire no more.
 *
 * HP, position and the enabled flag belong to BuildingPlacement, power is derived
 * by calculatePower and mutant HP belongs to Mutants. This module only holds each
 * gun's reload, keyed by building id, and the shells in flight.
 */
import {calculatePower} from './power.js';
import {flightTicks, isBrute, mutantAt} from './shots.js';
import {Shift} from './shiftCycle.js';

export const SIEGE_CANNON_TYPE = 'siegeCannon';

export const SIEGE = Object.freeze({
    range: 256, // px, circular and inclusive, from the footprint centre
    minRange: 64, // px, also inclusive: anything closer cannot be fired at
    damage: 200,
    reloadTicks: 300,
    shellSpeed: 8, // px per tick along the longer axis
    impactRadius: 24, // px around the aimed point
});

const NO_EFFECTS = Object.freeze({fired: Object.freeze([]), impacts: Object.freeze([])});

const squaredDistance = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Range is an inclusive ring. Squared values stay exact, with no sqrt. */
export function isInSiegeRange(center, mutant) {
    const distance = squaredDistance(center, mutant);
    return distance >= SIEGE.minRange ** 2 && distance <= SIEGE.range ** 2;
}

/**
 * The nearest Brute in range, otherwise the nearest mutant in range. Ties go to the
 * earliest in the list, which is spawn order.
 * @returns {object|null}
 */
export function selectSiegeTarget(center, mutants) {
    let best = null;
    for (const mutant of mutants) {
        if (!isInSiegeRange(center, mutant)) continue;
        if (!best) {
            best = mutant;
            continue;
        }
        const heavier = isBrute(mutant) && !isBrute(best);
        const lighter = !isBrute(mutant) && isBrute(best);
        if (heavier || (!lighter && squaredDistance(center, mutant) < squaredDistance(center, best))) best = mutant;
    }
    return best;
}

export class SiegeCannons {
    #cycle;
    #placement;
    #grid;
    #mutants;
    #guns = new Map(); // building id -> {cooldown}
    #shells = []; // in firing order, Night only
    #nextShellId = 1;

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
     * @returns {{fired: Array<{gunId, mutantId, x, y}>,
     *            impacts: Array<{x, y, mutantId: string|null, damage: number, hp: number, killed: boolean}>}}
     */
    step() {
        if (this.#cycle.shift === Shift.DEFEATED) return NO_EFFECTS;
        if (this.#cycle.shift !== Shift.NIGHT) {
            this.#guns.clear();
            this.#shells.length = 0;
            return NO_EFFECTS;
        }
        const impacts = this.#land();
        const buildings = this.#placement.buildings();
        const guns = buildings.filter((b) => b.type === SIEGE_CANNON_TYPE);
        this.#forgetDestroyed(guns);
        if (guns.length === 0) return impacts.length ? {fired: [], impacts} : NO_EFFECTS;

        const powered = new Set(calculatePower(buildings).buildings.filter((b) => b.powered).map((b) => b.id));
        const fired = [];
        for (const gun of guns) {
            if (!this.#guns.has(gun.id)) this.#guns.set(gun.id, {cooldown: 0});
            const state = this.#guns.get(gun.id);
            if (!powered.has(gun.id)) continue;
            if (state.cooldown > 0) state.cooldown--;
            if (state.cooldown > 0) continue;
            const center = this.#centerOf(gun);
            const target = selectSiegeTarget(center, this.#mutants.snapshot());
            if (target) fired.push(this.#fire(gun, state, center, target));
        }
        return fired.length || impacts.length ? {fired, impacts} : NO_EFFECTS;
    }

    /** Detached reloads for existing guns, in building-list order. */
    snapshot() {
        return this.#placement.buildings()
            .filter((b) => b.type === SIEGE_CANNON_TYPE)
            .map(({id}) => ({id, cooldown: 0, ...this.#guns.get(id)}));
    }

    /** Detached shells in flight, in firing order. */
    shells() {
        return this.#shells.map((shell) => ({...shell}));
    }

    #fire(gun, state, center, target) {
        state.cooldown = SIEGE.reloadTicks;
        const {x, y} = target;
        const ticks = flightTicks(center, target, SIEGE.shellSpeed);
        this.#shells.push({
            id: `siege-shell-${this.#nextShellId++}`, gunId: gun.id, fromX: center.x, fromY: center.y, x, y, flightTicks: ticks, ticksLeft: ticks,
        });
        return {gunId: gun.id, mutantId: target.id, x, y};
    }

    /** Oldest first. Each sees the mutants the one before it left. */
    #land() {
        if (this.#shells.length === 0) return [];
        for (const shell of this.#shells) shell.ticksLeft--;
        const landing = this.#shells.filter((shell) => shell.ticksLeft === 0);
        if (landing.length === 0) return [];
        this.#shells = this.#shells.filter((shell) => shell.ticksLeft > 0);
        return landing.map(({x, y}) => {
            const victim = mutantAt({x, y}, this.#mutants.snapshot(), () => SIEGE.impactRadius);
            if (!victim) return {x, y, mutantId: null, damage: 0, hp: 0, killed: false};
            const result = this.#mutants.damageMutant(victim.id, SIEGE.damage);
            if (!result.ok) throw new Error(`A Siege shell could not damage ${victim.id}: ${result.reason}`);
            return {x, y, mutantId: victim.id, damage: SIEGE.damage, hp: result.hp, killed: result.killed};
        });
    }

    #forgetDestroyed(guns) {
        for (const id of this.#guns.keys()) {
            if (!guns.some((gun) => gun.id === id)) this.#guns.delete(id);
        }
    }

    #centerOf(building) {
        const {x, y, width, height} = this.#grid.footprintRect(building);
        return {x: x + width / 2, y: y + height / 2};
    }
}
