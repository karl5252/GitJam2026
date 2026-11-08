import {BARRACKS_TYPE, BarracksRole, HQ_TYPE, REFIT_COST, ROAD_COST, getBuildingType} from './buildingTypes.js';
import {ROAD_ACCESS_TYPES, RoadFailure, barracksExit, outgoingDock} from './roads.js';
import {isFree, resolvePost, walkMap} from './walkField.js';

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
 * RoadNetwork.canAddGate agrees. Anything but HQ can be demolished.
 *
 * A Barracks needs a connected road on its left exit, and counts as a dock from
 * then on. Nothing can be built on a road, that road cannot be removed and no
 * gate can stand on it, so the exit can never be blocked. Each Barracks owns one
 * rally flag, on its record, so a flag cannot outlive its building. `revision`
 * changes whenever anything that affects walking changes, and core/infantry.js
 * rebuilds its navigation from that.
 */

export const NO_SELECTION = 'no-selection';
export const CONSTRUCTION_DISABLED = 'construction-disabled';
/** A paused timed Day: nothing may change until it runs again. */
export const GAME_PAUSED = 'game-paused';
export const UNKNOWN_BUILDING = 'unknown-building';
export const INVALID_STATE = 'invalid-state';
export const HQ_REQUIRED = 'hq-required';
export const HQ_ALREADY_BUILT = 'hq-already-built';
export const BARRACKS_LIMIT = 'barracks-limit';
export const MAX_BARRACKS = 4;

export const FlagFailure = Object.freeze({
    OUT_OF_BOUNDS: 'flag-out-of-bounds',
    OCCUPIED: 'flag-occupied',
    TAKEN: 'flag-taken',
    UNREACHABLE: 'flag-unreachable',
});

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

/** A Barracks' flag is the one nested value on a record. */
const detached = (building) => (building.flag ? {...building, flag: {...building.flag}} : {...building});

export class BuildingPlacement {
    #grid;
    #buildings = [];
    #nextId = 1;

    #economy;
    #isConstructionAllowed;
    #isPaused;
    #requireHq;
    #hqBuilt = false;
    #roads;
    #revision = 0;
    #listeners = [];
    #guards = [];

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
    constructor(grid, economy, {isConstructionAllowed = () => true, isPaused = () => false, requireHq = false, roads = null} = {}) {
        this.#grid = grid;
        this.#economy = economy;
        this.#isConstructionAllowed = isConstructionAllowed;
        this.#isPaused = isPaused;
        this.#requireHq = requireHq;
        this.#roads = roads;
        this.selectedType = null; // building type id, or null when not in placement mode
    }

    /** True once an HQ has been built this run, even if it was later destroyed. */
    get hqBuilt() {
        return this.#hqBuilt;
    }

    /** Be told the type of every building that is placed or removed, as it happens. */
    onBuildingsChanged(listener) {
        this.#listeners.push(listener);
    }

    /**
     * Let something that moves on the map refuse an edit that would put a building
     * on it or take a road from under it. A guard is asked `{action: 'place', type,
     * footprint}` or `{action: 'remove-road', cell}` and answers null, or a
     * refusal `{ok: false, reason}`. It must never mutate.
     */
    addGuard(guard) {
        this.#guards.push(guard);
    }

    #guarded(question) {
        for (const guard of this.#guards) {
            const refusal = guard(question);
            if (refusal) return refusal;
        }
        return {ok: true};
    }

    #changed(type) {
        for (const listener of this.#listeners) listener(type);
    }

    /** Changes on every placement, removal and flag change: anything that affects walking. */
    get revision() {
        return this.#revision;
    }

    /**
     * The HQ rules and the Barracks limit for a known type. Never mutates, and
     * ignores the construction gate, space and resources.
     * @returns {{ok: true} | {ok: false, reason: 'hq-required' | 'hq-already-built' | 'barracks-limit'}}
     */
    canBuild(typeId) {
        if (typeId === HQ_TYPE) return this.#hqBuilt ? {ok: false, reason: HQ_ALREADY_BUILT} : {ok: true};
        if (this.#requireHq && !this.#hqBuilt) return {ok: false, reason: HQ_REQUIRED};
        const full = typeId === BARRACKS_TYPE && this.#barracks().length >= MAX_BARRACKS;
        return full ? {ok: false, reason: BARRACKS_LIMIT} : {ok: true};
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
        const dock = this.#roads ? this.#accessTile(type.id, footprint) : null;
        return {footprint, ...(dock ? {dock} : {}), ...this.#validate(type, footprint)};
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
        if (type.id === BARRACKS_TYPE) building.flag = null;
        this.#buildings.push(building);
        this.#revision++;
        if (type.gate) this.#roads.setGate(footprint, type.gate.passageAxis);
        if (type.id === HQ_TYPE) {
            this.#hqBuilt = true;
            this.#roads?.addHqRing(footprint); // validated above, so it cannot fail
            this.cancel(); // it cannot be built again, so placement mode ends here
        }
        this.#changed(type.id);
        return {ok: true, building: detached(building)};
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
        if (this.#isPaused()) return {ok: false, reason: GAME_PAUSED};
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
     * Take down anything but HQ. Day only, free and with no refund. Always
     * possible, because losing a building can only add road connections and free
     * what depended on it: docks, exits and power are all derived. Rebuilding is
     * the only way to restore a damaged barrier.
     * @returns {{ok: true} | {ok: false, reason: string}}
     */
    demolish(id) {
        if (!this.#isConstructionAllowed()) return {ok: false, reason: CONSTRUCTION_DISABLED};
        if (this.#isPaused()) return {ok: false, reason: GAME_PAUSED};
        const index = this.#buildings.findIndex((b) => b.id === id);
        if (index === -1) return {ok: false, reason: UNKNOWN_BUILDING};
        if (getBuildingType(this.#buildings[index].type).demolishable === false) return {ok: false, reason: INVALID_STATE};
        this.#removeAt(index);
        return {ok: true};
    }

    /** Grid cells, record and any gate go together, so a building leaves exactly once. */
    #removeAt(index) {
        const building = this.#buildings[index];
        if (!this.#grid.remove(building.id)) throw new Error(`Building ${building.id} has no grid occupancy`);
        this.#buildings.splice(index, 1);
        this.#revision++;
        if (getBuildingType(building.type).gate) this.#roads.clearGate(building);
        this.#changed(building.type);
    }

    /**
     * Would this rally flag be accepted? Never mutates. It is open to Day and
     * Night alike, like setEnabled, because soldiers pay for a move in travel
     * time. Walling a flag off later is allowed: see walkField.resolvePost.
     * @returns {{ok: true} | {ok: false, reason: string}}
     */
    canSetFlag(id, cell) {
        const barracks = this.#buildings.find((b) => b.id === id && b.type === BARRACKS_TYPE);
        if (!barracks) return {ok: false, reason: UNKNOWN_BUILDING};
        if (this.#isPaused()) return {ok: false, reason: GAME_PAUSED};
        if (!this.#inBounds(cell)) return {ok: false, reason: FlagFailure.OUT_OF_BOUNDS};
        const map = walkMap(this.#grid, this.#buildings);
        if (!isFree(map, cell)) return {ok: false, reason: FlagFailure.OCCUPIED};
        const same = ({col, row}) => col === cell.col && row === cell.row;
        const taken = this.#barracks().some((b) => b !== barracks && same(b.flag ?? barracksExit(b)));
        if (taken) return {ok: false, reason: FlagFailure.TAKEN};
        return resolvePost(map, barracksExit(barracks), cell).blocked ? {ok: false, reason: FlagFailure.UNREACHABLE} : {ok: true};
    }

    /** Point a Barracks at a defensive position. Free, in both shifts. */
    setFlag(id, cell) {
        const check = this.canSetFlag(id, cell);
        if (!check.ok) return check;
        this.#assignFlag(id, cell);
        return check;
    }

    /**
     * Send a squad back to its Barracks' exit. Free, in both shifts, and it has no
     * placement rules: a recall must never fail. Soldiers walk home like anyone
     * whose post has moved, so nothing else needs telling. A squad whose exit holds
     * another squad's flag simply shares that tile.
     * @returns {{ok: true} | {ok: false, reason: string}}
     */
    clearFlag(id) {
        const barracks = this.#buildings.find((b) => b.id === id && b.type === BARRACKS_TYPE);
        if (!barracks) return {ok: false, reason: UNKNOWN_BUILDING};
        if (this.#isPaused()) return {ok: false, reason: GAME_PAUSED}; // the one thing a recall can wait for
        if (barracks.flag === null) return {ok: true};
        barracks.flag = null;
        this.#revision++;
        return {ok: true};
    }

    /**
     * Would refitting this Barracks be accepted? Never mutates.
     * @returns {{ok: true, role: string} | {ok: false, reason: string}} role is what it would become
     */
    canRefit(id) {
        const barracks = this.#buildings.find((b) => b.id === id && b.type === BARRACKS_TYPE);
        if (!barracks) return {ok: false, reason: UNKNOWN_BUILDING};
        if (!this.#isConstructionAllowed()) return {ok: false, reason: CONSTRUCTION_DISABLED};
        if (this.#isPaused()) return {ok: false, reason: GAME_PAUSED};
        const afford = this.#economy.canAfford(REFIT_COST);
        if (!afford.ok) return afford;
        return {ok: true, role: barracks.role === BarracksRole.ROCKET ? BarracksRole.RIFLE : BarracksRole.ROCKET};
    }

    /**
     * Swap a Barracks between rifles and rockets. Day only, because no unit state
     * crosses a Day: the next Night simply musters the other squad. It is not a
     * placement, so its flag, HP, power and id all stay. A rifle record carries no
     * role, which keeps a base without rockets exactly as it was.
     * @returns {{ok: true, role: string} | {ok: false, reason: string}}
     */
    refit(id) {
        const check = this.canRefit(id);
        if (!check.ok) return check;
        const spent = this.#economy.spend(REFIT_COST);
        if (!spent.ok) return spent;
        this.#assignRole(id, check.role);
        return check;
    }

    /** Layout fixtures only: a loaded base has already paid for what it is. */
    restoreRole(id, role) {
        if (!this.#barracks().some((b) => b.id === id)) return {ok: false, reason: UNKNOWN_BUILDING};
        if (!Object.values(BarracksRole).includes(role)) return {ok: false, reason: INVALID_STATE};
        this.#assignRole(id, role);
        return {ok: true};
    }

    #assignRole(id, role) {
        const barracks = this.#buildings.find((b) => b.id === id);
        if (role === BarracksRole.ROCKET) barracks.role = role;
        else delete barracks.role;
    }

    /**
     * Layout fixtures only: put back a flag without the placement rules, because
     * a legal game can hold a flag that was walled off or built over afterwards.
     */
    restoreFlag(id, cell) {
        if (!this.#barracks().some((b) => b.id === id)) return {ok: false, reason: UNKNOWN_BUILDING};
        if (!this.#inBounds(cell)) return {ok: false, reason: FlagFailure.OUT_OF_BOUNDS};
        this.#assignFlag(id, cell);
        return {ok: true};
    }

    #assignFlag(id, {col, row}) {
        this.#buildings.find((b) => b.id === id).flag = {col, row};
        this.#revision++;
    }

    #inBounds(cell) {
        const {col, row} = cell ?? {};
        return Number.isInteger(col) && Number.isInteger(row)
            && col >= 0 && row >= 0 && col < this.#grid.cols && row < this.#grid.rows;
    }

    #barracks() {
        return this.#buildings.filter((b) => b.type === BARRACKS_TYPE);
    }

    /** The road tile a type must have on this footprint, or null. */
    #accessTile(typeId, footprint) {
        if (ROAD_ACCESS_TYPES.includes(typeId)) return outgoingDock(footprint);
        return typeId === BARRACKS_TYPE ? barracksExit(footprint) : null;
    }

    #factoryDocks() {
        return this.#buildings.filter((b) => ROAD_ACCESS_TYPES.includes(b.type)).map(outgoingDock);
    }

    /** Docks and exits that must stay connected to the HQ network. */
    #roadDependents() {
        return [...this.#factoryDocks(), ...this.#barracks().map(barracksExit)];
    }

    /** ROAD_REQUIRED says a Factory depends on the road, so say so when only a Barracks does. */
    #nameDependent(check, retry) {
        if (check.ok || check.reason !== RoadFailure.ROAD_REQUIRED || !retry(this.#factoryDocks()).ok) return check;
        return {ok: false, reason: RoadFailure.EXIT_REQUIRED};
    }

    /** Add a road for ROAD_COST, or say why not. Placed and paid for together, or neither. */
    placeRoad(cell) {
        const check = this.previewRoad(cell);
        if (!check.ok) return check;
        const added = this.#roads.add(cell);
        if (added.ok) this.#economy.spend(ROAD_COST); // affordable: just checked
        return added;
    }

    /** Remove a player road, unless a Factory or Barracks would lose every route. */
    removeRoad(cell) {
        const check = this.previewRoadRemoval(cell);
        return check.ok ? this.#roads.remove(cell, this.#roadDependents()) : check;
    }

    /** Validation for adding a road. Never mutates. */
    previewRoad(cell) {
        if (!this.#isConstructionAllowed()) return {ok: false, reason: CONSTRUCTION_DISABLED};
        if (this.#isPaused()) return {ok: false, reason: GAME_PAUSED};
        const space = this.#roads.canAdd(cell);
        return space.ok ? this.#economy.canAfford(ROAD_COST) : space;
    }

    /** Validation for removing a road. Never mutates. */
    previewRoadRemoval(cell) {
        if (!this.#isConstructionAllowed()) return {ok: false, reason: CONSTRUCTION_DISABLED};
        if (this.#isPaused()) return {ok: false, reason: GAME_PAUSED};
        const check = this.#nameDependent(this.#roads.canRemove(cell, this.#roadDependents()), (docks) => this.#roads.canRemove(cell, docks));
        return check.ok ? this.#guarded({action: 'remove-road', cell}) : check;
    }

    /** Road rules for a footprint the grid has already accepted. Never mutates. */
    #validateRoads(type, footprint) {
        if (!this.#roads) {
            if (type.gate) return {ok: false, reason: RoadFailure.GATE_NEEDS_ROAD};
            return type.id === BARRACKS_TYPE ? {ok: false, reason: RoadFailure.NO_EXIT_ACCESS} : {ok: true};
        }
        if (type.gate) {
            const {passageAxis} = type.gate;
            return this.#nameDependent(this.#roads.canAddGate(footprint, passageAxis, this.#roadDependents()),
                (docks) => this.#roads.canAddGate(footprint, passageAxis, docks));
        }
        if (type.id === HQ_TYPE) {
            const ring = this.#roads.canAddHqRing(footprint);
            if (!ring.ok) return ring;
        }
        if (this.#roads.overlaps(footprint)) return {ok: false, reason: RoadFailure.ROAD_OCCUPIED};
        const dock = this.#accessTile(type.id, footprint);
        if (dock) {
            const missing = type.id === BARRACKS_TYPE ? RoadFailure.NO_EXIT_ACCESS : RoadFailure.NO_ROAD_ACCESS;
            if (!this.#roads.isConnected(dock)) return {ok: false, reason: missing};
            if (this.#roads.gateAt(dock) !== null) return {ok: false, reason: RoadFailure.GATE_ON_DOCK};
        }
        return {ok: true};
    }

    /** Construction gate, HQ rules, spatial rules (grid, roads), then resources (economy). Never mutates. */
    #validate(type, footprint) {
        if (!this.#isConstructionAllowed()) return {ok: false, reason: CONSTRUCTION_DISABLED};
        if (this.#isPaused()) return {ok: false, reason: GAME_PAUSED};
        const allowed = this.canBuild(type.id);
        if (!allowed.ok) return allowed;
        const spatial = this.#grid.canPlace(footprint);
        if (!spatial.ok) return spatial;
        const roads = this.#validateRoads(type, footprint);
        if (!roads.ok) return roads;
        const guarded = this.#guarded({action: 'place', type, footprint});
        if (!guarded.ok) return guarded;
        return this.#economy.canAfford(type.cost);
    }

    /** Detached records of the standing gates, without copying every wall. */
    gates() {
        return this.#buildings.filter((b) => getBuildingType(b.type).gate).map((b) => ({...b}));
    }

    /** Detached records of the standing Barracks, without copying every wall. */
    barracks() {
        return this.#barracks().map(detached);
    }

    /** Detached, JSON-serializable list of placed buildings. */
    buildings() {
        return this.#buildings.map(detached);
    }
}
