import {getBuildingType} from './buildingTypes.js';

/**
 * Placement mode + placed-building state. Pure — no Phaser.
 *
 * The Grid is the source of truth for occupancy and validity: preview()
 * and placeAt() both defer to grid.canPlace()/grid.place(); a building is
 * recorded only after the grid accepts it.
 */

export const NO_SELECTION = 'no-selection';

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

    constructor(grid) {
        this.#grid = grid;
        this.selectedType = null; // building type id, or null when not in placement mode
    }

    /** Enter placement mode for a type. Returns false for an unknown type. */
    select(typeId) {
        if (!getBuildingType(typeId)) return false;
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
        const footprint = footprintAt(getBuildingType(this.selectedType), cell);
        return {footprint, ...this.#grid.canPlace(footprint)};
    }

    /**
     * Attempt to place the selected type centred on `cell`. Atomic: on any
     * failure neither the grid nor the building list changes.
     */
    placeAt(cell) {
        if (!this.isPlacing) return {ok: false, reason: NO_SELECTION};
        const type = getBuildingType(this.selectedType); // always valid: select() checks

        const footprint = footprintAt(type, cell);
        const id = `${type.id}-${this.#nextId}`;
        const result = this.#grid.place(id, footprint);
        if (!result.ok) return result;

        this.#nextId++;
        const building = {id, type: type.id, ...footprint};
        this.#buildings.push(building);
        return {ok: true, building: {...building}};
    }

    /** Detached, JSON-serializable list of placed buildings. */
    buildings() {
        return this.#buildings.map((b) => ({...b}));
    }
}
