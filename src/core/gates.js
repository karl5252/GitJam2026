/**
 * Gate state machine. Pure: no Phaser, no wall clock and no randomness.
 *
 * One machine serves every gate. Orientation and tier are data on the building
 * type (see core/buildingTypes.js), so a future tier needs no code here.
 *
 * HP and position stay on the building records in BuildingPlacement. This
 * module only holds {state, timer} per gate, keyed by building id, and only
 * during Night: outside it every gate is CLOSED.
 *
 * step() runs once per tick, after Autocannons.step() and before Mutants.step().
 * It is given the gates that trucks need this tick, derived afresh from the
 * trucks themselves, so nothing is claimed or released. A truck that dies simply
 * stops asking, and no record can hold a gate open. A gate never refuses, needs
 * no power and depends on nothing else, so a waiting truck always gets through.
 *
 * Only OPEN lets anything through. OPENING and CLOSING are solid for trucks and
 * mutants alike. Closing never waits for a mutant in the doorway.
 */
import {getBuildingType} from './buildingTypes.js';
import {Shift} from './shiftCycle.js';

export const GATE = Object.freeze({
    openTicks: 150, // the delay one truck pays per crossing
    closeTicks: 60,
});

export const GateState = Object.freeze({
    CLOSED: 'closed',
    OPENING: 'opening',
    OPEN: 'open',
    CLOSING: 'closing',
});

const closed = () => ({state: GateState.CLOSED, timer: 0});

/** Reversing keeps the barrier where it is: the same fraction of the other timer. */
const reversedTimer = (timer, from, to) => Math.max(1, to - Math.round(to * (timer / from)));

export class Gates {
    #cycle;
    #placement;
    #grid;
    #gates = new Map(); // building id -> {state, timer}, Night only

    /**
     * @param {{cycle: import('./shiftCycle.js').ShiftCycle,
     *          placement: import('./buildingPlacement.js').BuildingPlacement,
     *          grid: import('./grid.js').Grid}} deps
     */
    constructor({cycle, placement, grid}) {
        this.#cycle = cycle;
        this.#placement = placement;
        this.#grid = grid;
    }

    /** @param {ReadonlySet<string>} wanted gate ids a truck needs this tick */
    step(wanted = new Set()) {
        const shift = this.#cycle.shift;
        if (shift === Shift.DEFEATED) return;
        if (shift !== Shift.NIGHT) {
            this.#gates.clear();
            return;
        }
        const standing = this.#placement.gates();
        if (this.#gates.size > standing.length) this.#forgetDestroyed(standing);
        for (const {id} of standing) {
            if (!this.#gates.has(id)) this.#gates.set(id, closed());
            this.#advance(this.#gates.get(id), wanted.has(id));
        }
    }

    /** The id of the gate on a cell, or null. */
    idAt({col, row}) {
        const id = this.#grid.occupantAt(col, row);
        return id !== null && this.#gates.has(id) ? id : null;
    }

    isOpen(id) {
        return this.#gates.get(id)?.state === GateState.OPEN;
    }

    /** Can a mutant step through this building along `axis` right now? */
    allows(building, axis) {
        const gate = getBuildingType(building.type)?.gate;
        return Boolean(gate) && gate.passageAxis === axis && this.isOpen(building.id);
    }

    /** Detached plain data for standing gates, in building-list order. */
    snapshot() {
        return this.#placement.gates().map(({id, type, col, row}) => {
            const {orientation, passageAxis, tier} = getBuildingType(type).gate;
            return {id, type, col, row, orientation, passageAxis, tier, ...closed(), ...this.#gates.get(id)};
        });
    }

    #forgetDestroyed(standing) {
        const ids = new Set(standing.map((gate) => gate.id));
        for (const id of this.#gates.keys()) {
            if (!ids.has(id)) this.#gates.delete(id);
        }
    }

    #advance(gate, wanted) {
        switch (gate.state) {
            case GateState.CLOSED:
                if (wanted) Object.assign(gate, {state: GateState.OPENING, timer: GATE.openTicks});
                break;
            case GateState.OPENING:
                if (!wanted) Object.assign(gate, {state: GateState.CLOSING, timer: reversedTimer(gate.timer, GATE.openTicks, GATE.closeTicks)});
                else if (--gate.timer === 0) gate.state = GateState.OPEN;
                break;
            case GateState.OPEN:
                if (!wanted) Object.assign(gate, {state: GateState.CLOSING, timer: GATE.closeTicks});
                break;
            case GateState.CLOSING:
                if (wanted) Object.assign(gate, {state: GateState.OPENING, timer: reversedTimer(gate.timer, GATE.closeTicks, GATE.openTicks)});
                else if (--gate.timer === 0) gate.state = GateState.CLOSED;
                break;
            default:
                throw new Error(`Unknown gate state: ${gate.state}`);
        }
    }
}
