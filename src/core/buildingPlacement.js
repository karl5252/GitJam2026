import {HQ_TYPE, getBuildingType} from './buildingTypes.js';
import {ROAD_ACCESS_TYPES, RoadFailure, outgoingDock} from './roads.js';

/**
 * Placement mode + placed-building state. Pure — no Phaser.
 *
 * The Grid is the source of truth for occupancy and spatial validity; the
 * Economy for affordability. preview() and placeAt() share one validation
 * (grid first, then economy); a building is recorded only after both the
 * grid placement and the resource spend succeed.
 *
 * HQ rules: only one HQ can ever be built, enforced by a latch rather than by
 * looking for an existing HQ, so a destroyed HQ cannot be rebuilt. With
 * requireHq, nothing else can be built until it stands.
 *
 * Roads are optional: with a RoadNetwork, HQ brings its ring, nothing can be
 * built on a road and a Factory's fixed dock must be a connected road. Without
 * one, as in legacy fixtures and ?hq=off, none of those rules exist, and there
 * can be no gates, because a gate stands on a road.
 *
 * Fortifications are ordinary buildings here. Walls obey the normal rules. A
 * gate is the one building that goes ON a road, and only where
 * RoadNetwork.canAddGate agrees. Only fortifications can be demolished.
 */

export const NO_SELECTION = 'no-selection';
export const CONSTRUCTION_DISABLED = 'construction-disabled';
export const UNKNOWN_BUILDING = 'unknown-building';
export const INVALID_STATE = 'invalid-state';
export const HQ_REQUIRED = 'hq-required';
export const HQ_ALREADY_BUILT = 'hq-already-built';

/**
 * Footprint for a building centred on a pointer cell.
 *
 * Convention: anchor = cell - floor((size - 1) / 2) on each axis.
 *   - Odd sizes: the pointer cell is the exact centre (3x3 -> col-1..col+1).
 *   - Even sizes: the pointer cell is the top-left of the central 2x2, i.e.
 *     the footprint extends one extra cell right/down (2x2 -> col..col+1).
 */
export function footprintAt(type, {col, row}) {
    return {
        col: col - Math.floor((type.width - 1) / 2),
        row: row - Math.floor((type.height - 1) / 2),
        width: type.width,
        height: type.height,
    };
}

export class BuildingPlacement {
    #grid;
    #buildings = [];
    #nextId = 1;

    #economy;
    #isConstructionAllowed;
    #requireHq;
    #hqBuilt = false;
    #roads;

    /**
     * @param {import('./grid.js').Grid} grid
     * @param {import('./economy.js').Economy} economy
     * @param {{isConstructionAllowed?: () => boolean, requireHq?: boolean,
     *          roads?: import('./roads.js').RoadNetwork | null}} [options]
     *   isConstructionAllowed - e.g. false during Night Shift
     *   requireHq - only HQ can be built until it stands. Real play always sets
     *   this. The false default is legacy compatibility, for fixtures that test
     *   other rules without an HQ; do not rely on it in new gameplay code.
     */
    constructor(grid, economy, {isConstructionAllowed = () => true, requireHq = false, roads = null} = {}) {
        this.#grid = grid;
        this.#economy = economy;
        this.#isConstructionAllowed = isConstructionAllowed;
        this.#requireHq = requireHq;
        this.#roads = roads;
        this.selectedType = null; // building type id, or null when not in placement mode
    }

    /** True once an HQ has been built this run, even if it was later destroyed. */
    get hqBuilt() {
        return this.#hqBuilt;
    }

    /**
     * The HQ rules for a known type. Never mutates, and ignores the
     * construction gate, space and resources.
     * @returns {{ok: true} | {ok: false, reason: 'hq-required' | 'hq-already-built'}}
     */
    canBuild(typeId) {
        if (typeId === HQ_TYPE) return this.#hqBuilt ? {ok: false, reason: HQ_ALREADY_BUILT} : {ok: true};
        return this.#requireHq && !this.#hqBuilt ? {ok: false, reason: HQ_REQUIRED} : {ok: true};
    }

    /** Enter placement mode for a type. False if unknown, not buildable now, or construction is disabled. */
    select(typeId) {
        if (!getBuildingType(typeId) || !this.#isConstructionAllowed() || !this.canBuild(typeId).ok) return false;
        this.selectedType = typeId;
        return true;
    }

    cancel() {
        this.selectedType = null;
    }

    get isPlacing() {
        return this.selectedType !== null;
    }

    /**
     * Validation result for placing the selected type centred on `cell`.
     * Never mutates. Returns null when not in placement mode or no cell.
     * @returns {null | {footprint, ok: boolean, reason?: string, blockers?: string[]}}
     */
    preview(cell) {
        if (!this.isPlacing || !cell) return null;
        const type = getBuildingType(this.selectedType);
        const footprint = footprintAt(type, cell);
        const needsDock = this.#roads && ROAD_ACCESS_TYPES.includes(type.id);
        return {footprint, ...(needsDock ? {dock: outgoingDock(footprint)} : {}), ...this.#validate(type, footprint)};
    }

    /**
     * Attempt to place the selected type centred on `cell` as one atomic
     * transaction: validate everything first, then commit grid + economy.
     * On any failure the grid, balances, building list and next id are
     * unchanged.
     */
    placeAt(cell) {
        if (!this.isPlacing) return {ok: false, reason: NO_SELECTION};
        const type = getBuildingType(this.selectedType); // always valid: select() checks
        const footprint = footprintAt(type, cell);

        const check = this.#validate(type, footprint);
        if (!check.ok) return check;

        // Commit. Both steps were just validated; the guards below only make
        // the transaction all-or-nothing should a commit ever disagree.
        const id = `${type.id}-${this.#nextId}`;
        const placed = this.#grid.place(id, footprint);
        if (!placed.ok) return placed;
        const spent = this.#economy.spend(type.cost);
        if (!spent.ok) {
            this.#grid.remove(id);
            return spent;
        }

        this.#nextId++;
        const building = {id, type: type.id, ...footprint, enabled: true, hp: type.maxHp};
        this.#buildings.push(building);
        if (type.gate) this.#roads.setGate(footprint, type.gate.passageAxis);
        if (type.id === HQ_TYPE) {
            this.#hqBuilt = true;
            this.#roads?.addHqRing(footprint); // validated above, so it cannot fail
            this.cancel(); // it cannot be built again, so placement mode ends here
        }
        return {ok: true, building: {...building}};
    }

    /**
     * Switch a placed building ON/OFF (player intent; see core/power.js for
     * the derived powered state). Allowed in BOTH Day and Night Shift — it is
     * deliberately not behind the construction gate — and costs no Credits or
     * AP. Never touches the grid or the economy. Setting the current value
     * again succeeds without change.
     * @returns {{ok: true, building} | {ok: false, reason: 'unknown-building' | 'invalid-state'}}
     */
    setEnabled(id, enabled) {
        if (typeof enabled !== 'boolean') return {ok: false, reason: INVALID_STATE};
        const building = this.#buildings.find((b) => b.id === id);
        if (!building) return {ok: false, reason: UNKNOWN_BUILDING};
        if (getBuildingType(building.type).switchable === false) return {ok: false, reason: INVALID_STATE};
        building.enabled = enabled;
        return {ok: true, building: {...building}};
    }

    /**
     * Apply damage to a placed building. This is the only way HP changes and
     * the only way a building is destroyed. At 0 HP the grid cells and the
     * record go together, so a building is destroyed exactly once; further
     * damage is rejected as unknown. Deliberately not behind the construction
     * gate, and never touches the economy. Ids are never reused.
     * @returns {{ok: true, destroyed: boolean, hp: number} | {ok: false, reason: 'unknown-building' | 'invalid-state'}}
     */
    damageBuilding(id, amount) {
        if (!Number.isSafeInteger(amount) || amount <= 0) return {ok: false, reason: INVALID_STATE};
        const index = this.#buildings.findIndex((b) => b.id === id);
        if (index === -1) return {ok: false, reason: UNKNOWN_BUILDING};

        const building = this.#buildings[index];
        const hp = Math.max(0, building.hp - amount);
        if (hp > 0) {
            building.hp = hp;
            return {ok: true, destroyed: false, hp};
        }
        this.#removeAt(index);
        return {ok: true, destroyed: true, hp};
    }

    /**
     * Take down a wall or gate. Day only, free and with no refund. Always
     * possible, because losing a barrier can only add road connections.
     * Rebuilding is the only way to restore a damaged one.
     * @returns {{ok: true} | {ok: false, reason: string}}
     */
    demolish(id) {
        if (!this.#isConstructionAllowed()) return {ok: false, reason: CONSTRUCTION_DISABLED};
        const index = this.#buildings.findIndex((b) => b.id === id);
        if (index === -1) return {ok: false, reason: UNKNOWN_BUILDING};
        if (!getBuildingType(this.#buildings[index].type).fortification) return {ok: false, reason: INVALID_STATE};
        this.#removeAt(index);
        return {ok: true};
    }

    /** Grid cells, record and any gate go together, so a building leaves exactly once. */
    #removeAt(index) {
        const building = this.#buildings[index];
        if (!this.#grid.remove(building.id)) throw new Error(`Building ${building.id} has no grid occupancy`);
        this.#buildings.splice(index, 1);
        if (getBuildingType(building.type).gate) this.#roads.clearGate(building);
    }

    /** Docks that must stay connected to the HQ network. */
    #roadDependents() {
        return this.#buildings.filter((b) => ROAD_ACCESS_TYPES.includes(b.type)).map(outgoingDock);
    }

    /** Add a free road, or say why not. Never touches the economy. */
    placeRoad(cell) {
        const check = this.previewRoad(cell);
        return check.ok ? this.#roads.add(cell) : check;
    }

    /** Remove a player road, unless a Factory would lose every route. */
    removeRoad(cell) {
        if (!this.#isConstructionAllowed()) return {ok: false, reason: CONSTRUCTION_DISABLED};
        return this.#roads.remove(cell, this.#roadDependents());
    }

    /** Validation for adding a road. Never mutates. */
    previewRoad(cell) {
        if (!this.#isConstructionAllowed()) return {ok: false, reason: CONSTRUCTION_DISABLED};
        return this.#roads.canAdd(cell);
    }

    /** Validation for removing a road. Never mutates. */
    previewRoadRemoval(cell) {
        if (!this.#isConstructionAllowed()) return {ok: false, reason: CONSTRUCTION_DISABLED};
        return this.#roads.canRemove(cell, this.#roadDependents());
    }

    /** Road rules for a footprint the grid has already accepted. Never mutates. */
    #validateRoads(type, footprint) {
        if (!this.#roads) return type.gate ? {ok: false, reason: RoadFailure.GATE_NEEDS_ROAD} : {ok: true};
        if (type.gate) return this.#roads.canAddGate(footprint, type.gate.passageAxis, this.#roadDependents());
        if (type.id === HQ_TYPE) {
            const ring = this.#roads.canAddHqRing(footprint);
            if (!ring.ok) return ring;
        }
        if (this.#roads.overlaps(footprint)) return {ok: false, reason: RoadFailure.ROAD_OCCUPIED};
        if (ROAD_ACCESS_TYPES.includes(type.id)) {
            const dock = outgoingDock(footprint);
            if (!this.#roads.isConnected(dock)) return {ok: false, reason: RoadFailure.NO_ROAD_ACCESS};
            if (this.#roads.gateAt(dock) !== null) return {ok: false, reason: RoadFailure.GATE_ON_DOCK};
        }
        return {ok: true};
    }

    /** Construction gate, HQ rules, spatial rules (grid, roads), then resources (economy). Never mutates. */
    #validate(type, footprint) {
        if (!this.#isConstructionAllowed()) return {ok: false, reason: CONSTRUCTION_DISABLED};
        const allowed = this.canBuild(type.id);
        if (!allowed.ok) return allowed;
        const spatial = this.#grid.canPlace(footprint);
        if (!spatial.ok) return spatial;
        const roads = this.#validateRoads(type, footprint);
        if (!roads.ok) return roads;
        return this.#economy.canAfford(type.cost);
    }

    /** Detached records of the standing gates, without copying every wall. */
    gates() {
        return this.#buildings.filter((b) => getBuildingType(b.type).gate).map((b) => ({...b}));
    }

    /** Detached, JSON-serializable list of placed buildings. */
    buildings() {
        return this.#buildings.map((b) => ({...b}));
    }
}
