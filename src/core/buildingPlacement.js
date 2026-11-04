import {getBuildingType} from './buildingTypes.js';

/**
 * Placement mode + placed-building state. Pure — no Phaser.
 *
 * The Grid is the source of truth for occupancy and spatial validity; the
 * Economy for affordability. preview() and placeAt() share one validation
 * (grid first, then economy); a building is recorded only after both the
 * grid placement and the resource spend succeed.
 */

export const NO_SELECTION = 'no-selection';
export const CONSTRUCTION_DISABLED = 'construction-disabled';
export const UNKNOWN_BUILDING = 'unknown-building';
export const INVALID_STATE = 'invalid-state';

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

    /**
     * @param {import('./grid.js').Grid} grid
     * @param {import('./economy.js').Economy} economy
     * @param {{isConstructionAllowed?: () => boolean}} [options] - e.g. false during Night Shift
     */
    constructor(grid, economy, {isConstructionAllowed = () => true} = {}) {
        this.#grid = grid;
        this.#economy = economy;
        this.#isConstructionAllowed = isConstructionAllowed;
        this.selectedType = null; // building type id, or null when not in placement mode
    }

    /** Enter placement mode for a type. False for an unknown type or while construction is disabled. */
    select(typeId) {
        if (!getBuildingType(typeId) || !this.#isConstructionAllowed()) return false;
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
        return {footprint, ...this.#validate(type, footprint)};
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
        if (!this.#grid.remove(id)) throw new Error(`Building ${id} has no grid occupancy`);
        this.#buildings.splice(index, 1);
        return {ok: true, destroyed: true, hp};
    }

    /** Construction gate, then spatial rules (grid), then resources (economy). Never mutates. */
    #validate(type, footprint) {
        if (!this.#isConstructionAllowed()) return {ok: false, reason: CONSTRUCTION_DISABLED};
        const spatial = this.#grid.canPlace(footprint);
        if (!spatial.ok) return spatial;
        return this.#economy.canAfford(type.cost);
    }

    /** Detached, JSON-serializable list of placed buildings. */
    buildings() {
        return this.#buildings.map((b) => ({...b}));
    }
}
