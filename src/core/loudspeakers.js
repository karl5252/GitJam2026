/**
 * TASK 028: Loudspeaker Towers. Pure: no Phaser.
 *
 * Every tower follows one HQ switch, the network (BuildingPlacement owns it, as it
 * owns all power intent). A tower **operates** when it is enabled and power.js
 * reports it powered: OFF, LOW_POWER and BLACKOUT all silence it.
 *
 * This module is the one owner of what towers have done:
 *   - coverage: the tiles within `radius` (circular, centre to centre) of an
 *     operating tower, which protesters avoid and are driven from by Day;
 *   - noise memory: a tower that operated on any tick of a timed Day is still
 *     loud for that Day's Night, switched off or not. The record is the Day's
 *     calendar number, so the next Day starts silent with nothing to reset.
 * A tower is **loud** while operating, or while its memory covers this Night;
 * mutants give a loud tower LOUDSPEAKER_BIAS.loud (384) and a silent one 0 (core/mutants.js).
 *
 * step() runs first in the tick, after ShiftCycle.onTick(), so everything after it
 * reads this tick's state. Nothing here reads or writes ecologists or mutants.
 */
import {LOUDSPEAKER_TYPE} from './buildingTypes.js';
import {calculatePower} from './power.js';
import {Shift} from './shiftCycle.js';

/** Provisional playtest values. */
export const LOUDSPEAKER = Object.freeze({radius: 3}); // tiles; the bias lives with the others, in mutants.js

export class Loudspeakers {
    #cycle;
    #placement;
    #operating = new Set(); // tower ids operating this tick
    #broadcast = new Map(); // tower id -> the calendar day of the last Day it operated in
    #towers = []; // this tick's tower records

    /** @param {{cycle: import('./shiftCycle.js').ShiftCycle, placement: import('./buildingPlacement.js').BuildingPlacement}} deps */
    constructor({cycle, placement}) {
        this.#cycle = cycle;
        this.#placement = placement;
    }

    /** One tick: who operates now, and the noise a timed Day leaves behind. */
    step() {
        const buildings = this.#placement.buildings();
        this.#towers = buildings.filter((b) => b.type === LOUDSPEAKER_TYPE);
        this.#operating = new Set();
        if (this.#towers.length > 0) {
            const powered = new Set(calculatePower(buildings).buildings.filter((b) => b.powered).map((b) => b.id));
            for (const tower of this.#towers) if (tower.enabled && powered.has(tower.id)) this.#operating.add(tower.id);
        }
        const standing = new Set(this.#towers.map(({id}) => id));
        for (const id of [...this.#broadcast.keys()]) if (!standing.has(id)) this.#broadcast.delete(id);
        if (this.#cycle.timed && this.#cycle.shift === Shift.DAY && !this.#cycle.deployment) {
            for (const id of this.#operating) this.#broadcast.set(id, this.#cycle.day);
        }
    }

    /** Is this tower operating now? */
    isOperating(id) {
        return this.#operating.has(id);
    }

    /** Operating, or remembered from this Night's own Day. */
    isLoud(id) {
        if (this.#operating.has(id)) return true;
        const shift = this.#cycle.shift;
        return (shift === Shift.NIGHT || shift === Shift.DUSK) && this.#broadcast.get(id) === this.#cycle.day;
    }

    /** Ids of loud towers, for mutant target choice. */
    loudIds() {
        return new Set(this.#towers.filter(({id}) => this.isLoud(id)).map(({id}) => id));
    }

    /** Is this tile within reach of an operating tower? */
    covers({col, row}) {
        const r2 = LOUDSPEAKER.radius * LOUDSPEAKER.radius;
        return this.#towers.some((t) => this.#operating.has(t.id) && (t.col - col) ** 2 + (t.row - row) ** 2 <= r2);
    }

    /** Detached. */
    snapshot() {
        return {
            radius: LOUDSPEAKER.radius,
            towers: this.#towers.map(({id, col, row, enabled}) => ({
                id, col, row, enabled, operating: this.#operating.has(id), broadcastDay: this.#broadcast.get(id) ?? null, loud: this.isLoud(id),
            })),
        };
    }
}
