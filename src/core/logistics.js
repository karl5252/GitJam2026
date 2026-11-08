/**
 * Factory production and delivery trucks. Pure: no Phaser, no wall clock and no
 * randomness.
 *
 * step() runs once per tick, after Mutants.step(). Everything happens on Night
 * ticks 1..3599, because Day never ticks and tick 3600 only settles, so a
 * retried final tick cannot produce or deliver twice.
 *
 * A powered Factory makes one load per 600 powered ticks, which gives exactly
 * five loads on ticks 600..3000 of a fully powered Night. Partial progress
 * resets at dusk: carrying it over would drift to six loads a Night. Finished
 * loads wait in storage, and production pauses while it is full.
 *
 * Each Factory has one free truck, which carries a load along the quickest road
 * route from the Factory's dock to the HQ's receiving dock. Credits are paid on
 * arrival, once, and the truck drives back. Routes are chosen when a truck
 * leaves. Roads cannot change during Night, and a gate falling only adds edges,
 * so a route in use stays valid.
 *
 * Dawn: every truck goes back to its dock, so Day road edits can never strand
 * one. A carried load returns to storage if there is room; otherwise it stays
 * on the truck and leaves first next Night. Cargo is never duplicated or
 * dropped silently: a load can only be lost with its truck, or with its Factory,
 * and both are counted in `cargoLost`.
 *
 * A truck whose Factory is destroyed finishes a delivery in progress and is
 * then removed. All values are provisional.
 *
 * Records follow the Factories at two explicit moments, and reading state is
 * never one of them. During Day they follow each placement and removal as it
 * happens. During Night they follow in step(), not at the moment of destruction:
 * Mutants.step() is holding a list of trucks then, and they must not vanish from
 * under it. A loss during Day belongs to no Night, so it counts in `totals` only.
 *
 * A truck stops at the centre of the tile before a gate until it is OPEN, then
 * crosses. gateDemands() reports what every truck needs right now, so a gate
 * stays open until the last one has reached the tile beyond it. A gate lost
 * while a truck waits simply stops being in the way.
 *
 * ACTIVE cycle (ShiftCycle.timed, what the game plays): everything above runs on
 * every Day, Dusk and Night tick alike, and nothing resets at a change of phase:
 * production progress, stored loads, cargo and trucks on the road all carry on,
 * so a boundary can neither duplicate nor drop a load. The `night` tally then
 * covers a whole cycle, from the tick that starts a Day to the end of its Night,
 * and becomes `lastNight` when the next Day starts. The dusk reset and dawn
 * parking described above are LEGACY behaviour only, for an untimed Day.
 *
 * Roads can change under a moving truck by Day. A truck always finishes the edge
 * it is on. Edits that would take a road from under it, put a gate on a tile it
 * touches, or leave it no way to where it is going are refused (#guard). When a
 * road or gate change breaks the rest of its route, it takes the quickest way
 * from the end of its current edge. A route that still works is kept, so a new
 * road never changes a truck's plans halfway.
 */
import {calculatePower} from './power.js';
import {HQ_TYPE} from './buildingTypes.js';
import {ROAD_ACCESS_TYPES, outgoingDock, receivingDock} from './roads.js';
import {Shift} from './shiftCycle.js';

export const LOGISTICS = Object.freeze({
    loadTicks: 600,
    goodsPerLoad: 10,
    creditsPerLoad: 30,
    storageLoads: 2,
    truckHp: 20,
    truckSpeed: 1, // px per tick; must divide the tile size
    respawnTicks: 600,
});

export const TruckState = Object.freeze({
    IDLE: 'idle',
    OUTBOUND: 'outbound',
    RETURNING: 'returning',
    RESPAWNING: 'respawning',
});

export const UNKNOWN_TRUCK = 'unknown-truck';

export const LogisticsFailure = Object.freeze({
    TRUCK_IN_THE_WAY: 'truck-in-the-way',
    TRUCK_STRANDED: 'truck-stranded',
});
export const INVALID_DAMAGE = 'invalid-damage';

const NO_EFFECTS = Object.freeze({deliveries: 0});
const emptyTally = () => ({loads: 0, credits: 0, cargoLost: 0});

export class Logistics {
    #cycle;
    #placement;
    #grid;
    #roads;
    #economy;
    #gates;
    #factories = new Map(); // Factory id -> {progress, stored, noRoute}
    #trucks = new Map(); // Factory id -> truck
    #inNight = false;
    #tallyDay = null; // ACTIVE: the Day whose cycle `#night` counts
    #roadsRevision = -1;
    #night = emptyTally();
    #lastNight = null;
    #totals = emptyTally();

    /**
     * @param {{cycle: import('./shiftCycle.js').ShiftCycle,
     *          placement: import('./buildingPlacement.js').BuildingPlacement,
     *          grid: import('./grid.js').Grid,
     *          roads: import('./roads.js').RoadNetwork,
     *          economy: import('./economy.js').Economy,
     *          gates?: import('./gates.js').Gates | null}} deps
     */
    constructor({cycle, placement, grid, roads, economy, gates = null}) {
        this.#cycle = cycle;
        this.#placement = placement;
        this.#grid = grid;
        this.#roads = roads;
        this.#economy = economy;
        this.#gates = gates;
        placement.onBuildingsChanged((type) => {
            if (cycle.shift === Shift.DAY && ROAD_ACCESS_TYPES.includes(type)) this.#sync(placement.buildings());
        });
        placement.addGuard?.((question) => this.#guard(question));
    }

    /** The completed Night's {loads, credits, cargoLost}, or null before the first. */
    get lastNight() {
        return this.#lastNight ? {...this.#lastNight} : null;
    }

    /** @returns {{deliveries: number}} loads delivered on this tick */
    step() {
        const shift = this.#cycle.shift;
        if (shift === Shift.DEFEATED) return NO_EFFECTS;
        if (this.#cycle.timed) {
            this.#rollTally();
        } else {
            if (shift !== Shift.NIGHT) {
                if (this.#inNight) this.#endNight();
                return NO_EFFECTS;
            }
            if (!this.#inNight) this.#startNight();
        }

        const buildings = this.#placement.buildings();
        this.#followRoads();
        const factories = this.#sync(buildings);
        if (this.#trucks.size === 0) return NO_EFFECTS;

        const powered = new Set(calculatePower(buildings).buildings.filter((b) => b.powered).map((b) => b.id));
        for (const {id} of factories) this.#produce(this.#factories.get(id), powered.has(id));
        let deliveries = 0;
        for (const truck of [...this.#trucks.values()]) deliveries += this.#advance(truck);
        const route = this.#dockRouter(buildings);
        for (const factory of factories) this.#dispatch(factory, route);
        return deliveries ? {deliveries} : NO_EFFECTS;
    }

    /**
     * Apply damage to a truck. This is the only way truck HP changes. A
     * destroyed truck loses its cargo and starts its replacement cooldown.
     * @returns {{ok: true, destroyed: boolean, hp: number} | {ok: false, reason: string}}
     */
    damageTruck(id, amount) {
        if (!Number.isSafeInteger(amount) || amount <= 0) return {ok: false, reason: INVALID_DAMAGE};
        const truck = [...this.#trucks.values()].find((t) => t.id === id);
        if (!truck || truck.state === TruckState.RESPAWNING) return {ok: false, reason: UNKNOWN_TRUCK};
        truck.hp = Math.max(0, truck.hp - amount);
        if (truck.hp > 0) return {ok: true, destroyed: false, hp: truck.hp};

        if (truck.cargo > 0) this.#loseCargo(truck);
        truck.route = null;
        truck.state = TruckState.RESPAWNING;
        truck.respawn = LOGISTICS.respawnTicks;
        if (truck.orphaned) this.#trucks.delete(truck.factoryId);
        return {ok: true, destroyed: true, hp: 0};
    }

    /**
     * Gates that trucks are waiting at or crossing, derived afresh each tick.
     * The tile a truck stands on or is leaving, and the one it is heading for.
     * @returns {Set<string>} gate ids
     */
    gateDemands() {
        const demands = new Set();
        if (!this.#gates) return demands;
        for (const truck of this.#trucks.values()) {
            if (!truck.route) continue;
            const index = Math.floor(truck.travelled / this.#grid.tileSize);
            for (const cell of [truck.route[index], truck.route[index + 1]]) {
                const id = cell ? this.#gates.idAt(cell) : null;
                if (id !== null) demands.add(id);
            }
        }
        return demands;
    }

    /** Trucks on the map, in a stable order, for mutants in melee range. */
    attackableTrucks() {
        return [...this.#trucks.values()]
            .filter((t) => t.state !== TruckState.RESPAWNING)
            .map(({id, x, y}) => ({id, x, y}));
    }

    /** Detached, JSON-serializable state, in Factory creation order. Reading it changes nothing. */
    snapshot() {
        const factories = this.#placement.buildings().filter(({id}) => this.#factories.has(id));
        return {
            factories: factories.map(({id, col, row, width, height}) => ({
                id, col, row, width, height, dock: outgoingDock({col, row, width, height}), ...this.#factories.get(id),
            })),
            trucks: [...this.#trucks.values()].map(({id, factoryId, state, hp, cargo, x, y, respawn}) => ({
                id, factoryId, state, hp, cargo, x, y, respawn,
            })),
            night: {...this.#night},
            lastNight: this.lastNight,
            totals: {...this.#totals},
        };
    }

    /** ACTIVE: a new Day closes the last cycle's tally. Nothing else changes at any boundary. */
    #rollTally() {
        this.#inNight = true; // every loss belongs to a cycle's tally
        const day = this.#cycle.day;
        if (this.#tallyDay === day) return;
        if (this.#tallyDay !== null) this.#lastNight = {...this.#night};
        this.#night = emptyTally();
        this.#tallyDay = day;
    }

    /** After a road or gate change, any truck whose route no longer works takes another. */
    #followRoads() {
        if (this.#roads.revision === this.#roadsRevision) return;
        this.#roadsRevision = this.#roads.revision;
        for (const truck of this.#trucks.values()) {
            if (truck.route && !truck.goal && !this.#stillDrivable(truck)) this.#reroute(truck);
        }
    }

    /** Where a truck is on its route: the tiles it touches, and the tile it will next stand on. */
    #position(truck) {
        const {tileSize} = this.#grid;
        const index = Math.min(Math.floor(truck.travelled / tileSize), truck.route.length - 1);
        const frac = truck.travelled - index * tileSize;
        const commit = frac === 0 ? index : index + 1;
        return {index, frac, commit, touches: truck.route.slice(index, commit + 1)};
    }

    /** Every edge from the end of its current edge on is still a road it may drive. */
    #stillDrivable(truck) {
        const {commit} = this.#position(truck);
        for (let i = commit; i < truck.route.length - 1; i++) {
            if (!this.#roads.connects(truck.route[i], truck.route[i + 1])) return false;
        }
        return true;
    }

    /**
     * Finish the current edge, then the quickest way to the same end. With no way
     * there (only possible after an edit that skips the guards, such as a layout
     * fixture), it stops at the end of its edge and asks again each tick: no jump,
     * and its cargo stays aboard.
     */
    #reroute(truck, to = null) {
        const {index, frac, commit} = this.#position(truck);
        const goal = to ?? truck.goal ?? truck.route[truck.route.length - 1];
        const path = this.#roads.route(truck.route[commit], goal);
        const kept = truck.route.slice(index, commit);
        truck.route = path ? [...kept, ...path] : [...kept, truck.route[commit]];
        truck.travelled = frac;
        truck.goal = path ? null : goal;
    }

    /**
     * Refuse edits a truck cannot survive: a road taken from under it, a gate put on
     * a tile it touches, or a road it needs to reach where it is going. Never mutates.
     * @returns {null | {ok: false, reason: string}}
     */
    #guard(question) {
        const gate = question.action === 'place' ? question.type.gate : null;
        if (question.action === 'place' && !gate) return null; // nothing else goes on a road
        const cell = question.action === 'remove-road' ? question.cell : {col: question.footprint.col, row: question.footprint.row};
        const same = (other) => other.col === cell.col && other.row === cell.row;
        for (const truck of this.#trucks.values()) {
            if (!truck.route) continue;
            const {commit, touches} = this.#position(truck);
            if (touches.some(same)) return {ok: false, reason: LogisticsFailure.TRUCK_IN_THE_WAY};
            const goal = truck.goal ?? truck.route[truck.route.length - 1];
            if (!truck.goal && !truck.route.slice(commit).some(same)) continue; // its way does not use the tile
            const asIf = gate ? {gate: {cell, axis: gate.passageAxis}} : {without: cell};
            if (!this.#roads.route(truck.route[commit], goal, asIf)) return {ok: false, reason: LogisticsFailure.TRUCK_STRANDED};
        }
        return null;
    }

    /** Records follow the buildings: new Factories get a truck, lost ones lose theirs. */
    #sync(buildings) {
        const factories = buildings.filter((b) => ROAD_ACCESS_TYPES.includes(b.type));
        const standing = new Set(factories.map((f) => f.id));
        for (const id of this.#factories.keys()) {
            if (!standing.has(id)) this.#orphan(id);
        }
        for (const factory of factories) {
            if (this.#factories.has(factory.id)) continue;
            this.#factories.set(factory.id, {progress: 0, stored: 0, noRoute: false});
            const dock = outgoingDock(factory);
            this.#trucks.set(factory.id, {
                id: `truck-${factory.id}`, factoryId: factory.id, dock, state: TruckState.IDLE, hp: LOGISTICS.truckHp,
                cargo: 0, route: null, travelled: 0, respawn: 0, orphaned: false, ...this.#grid.cellCenter(dock.col, dock.row),
            });
        }
        return factories;
    }

    /** Stored loads go with the Factory. A truck carrying cargo finishes its run. */
    #orphan(id) {
        const {stored} = this.#factories.get(id);
        this.#factories.delete(id);
        for (let i = 0; i < stored; i++) this.#countLost();
        const truck = this.#trucks.get(id);
        if (truck.state === TruckState.OUTBOUND) truck.orphaned = true;
        else {
            if (truck.cargo > 0) this.#loseCargo(truck);
            this.#trucks.delete(id);
        }
    }

    #startNight() {
        this.#inNight = true;
        this.#night = emptyTally();
        for (const factory of this.#factories.values()) factory.progress = 0;
    }

    #endNight() {
        for (const truck of [...this.#trucks.values()]) {
            if (truck.orphaned) {
                if (truck.cargo > 0) this.#loseCargo(truck);
                this.#trucks.delete(truck.factoryId);
                continue;
            }
            if (truck.state === TruckState.RESPAWNING) continue;
            const factory = this.#factories.get(truck.factoryId);
            if (truck.cargo > 0 && factory.stored < LOGISTICS.storageLoads) {
                factory.stored++;
                truck.cargo = 0;
            }
            this.#park(truck);
        }
        this.#inNight = false;
        this.#lastNight = {...this.#night};
    }

    #park(truck) {
        truck.state = TruckState.IDLE;
        truck.route = null;
        truck.goal = null;
        truck.travelled = 0;
        Object.assign(truck, this.#grid.cellCenter(truck.dock.col, truck.dock.row));
    }

    #produce(factory, powered) {
        if (!powered || factory.stored >= LOGISTICS.storageLoads) return;
        if (++factory.progress < LOGISTICS.loadTicks) return;
        factory.progress = 0;
        factory.stored++;
    }

    /** One tick of one truck. @returns {number} loads delivered */
    #advance(truck) {
        if (truck.state === TruckState.RESPAWNING) {
            if (--truck.respawn === 0) {
                truck.hp = LOGISTICS.truckHp;
                this.#park(truck);
            }
            return 0;
        }
        if (truck.state === TruckState.IDLE || this.#heldAtGate(truck)) return 0;

        const length = (truck.route.length - 1) * this.#grid.tileSize;
        truck.travelled = Math.min(length, truck.travelled + LOGISTICS.truckSpeed);
        this.#place(truck);
        if (truck.travelled < length) return 0;
        if (truck.goal) { // cut off by an unguarded edit: wait here until a way opens
            this.#reroute(truck);
            return 0;
        }
        if (truck.state === TruckState.RETURNING) {
            this.#park(truck);
            return 0;
        }
        return this.#deliver(truck);
    }

    /** Only a truck at the centre of a tile can be held: never one already crossing. */
    #heldAtGate(truck) {
        const {tileSize} = this.#grid;
        if (!this.#gates || truck.travelled % tileSize !== 0) return false;
        const next = truck.route[truck.travelled / tileSize + 1];
        const id = next ? this.#gates.idAt(next) : null;
        return id !== null && !this.#gates.isOpen(id);
    }

    #place(truck) {
        const {tileSize} = this.#grid;
        const index = Math.min(Math.floor(truck.travelled / tileSize), truck.route.length - 1);
        const from = this.#grid.cellCenter(truck.route[index].col, truck.route[index].row);
        const next = truck.route[index + 1];
        if (!next) {
            Object.assign(truck, from);
            return;
        }
        const to = this.#grid.cellCenter(next.col, next.row);
        const along = (truck.travelled - index * tileSize) / tileSize;
        truck.x = from.x + (to.x - from.x) * along;
        truck.y = from.y + (to.y - from.y) * along;
    }

    #deliver(truck) {
        this.#economy.adjustCredits(LOGISTICS.creditsPerLoad);
        truck.cargo = 0;
        for (const tally of [this.#night, this.#totals]) {
            tally.loads++;
            tally.credits += LOGISTICS.creditsPerLoad;
        }
        if (truck.orphaned) {
            this.#trucks.delete(truck.factoryId);
            return 1;
        }
        truck.state = TruckState.RETURNING;
        truck.route = [...truck.route].reverse();
        truck.travelled = 0;
        // Home is its own dock. A rerouted outbound route starts where the truck was
        // when it turned off, not at the dock, and the way back may have changed.
        const end = truck.route[truck.route.length - 1];
        const home = end.col === truck.dock.col && end.row === truck.dock.row;
        if (!home || !this.#stillDrivable(truck)) this.#reroute(truck, truck.dock);
        return 1;
    }

    /** @returns {(from: {col, row}) => Array<{col, row}> | null} */
    #dockRouter(buildings) {
        const hq = buildings.find((b) => b.type === HQ_TYPE);
        const target = hq ? receivingDock(hq) : null;
        return (from) => (target ? this.#roads.route(from, target) : null);
    }

    /** Idle trucks with a load set off. Movement starts on the next tick. */
    #dispatch({id}, route) {
        const truck = this.#trucks.get(id);
        const factory = this.#factories.get(id);
        if (truck.state !== TruckState.IDLE || (truck.cargo === 0 && factory.stored === 0)) return;
        const path = route(truck.dock);
        factory.noRoute = path === null;
        if (!path) return;
        if (truck.cargo === 0) {
            factory.stored--;
            truck.cargo = 1;
        }
        truck.route = path;
        truck.travelled = 0;
        truck.state = TruckState.OUTBOUND;
    }

    #loseCargo(truck) {
        truck.cargo = 0;
        this.#countLost();
    }

    #countLost() {
        if (this.#inNight) this.#night.cargoLost++;
        this.#totals.cargoLost++;
    }
}
