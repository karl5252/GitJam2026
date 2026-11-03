/**
 * Square logical grid with NxM footprint occupancy. Pure — no Phaser.
 *
 * Coordinates:
 *   - World space is whatever space the caller works in (scenes pass
 *     pointer.worldX/worldY, which already accounts for camera and canvas
 *     scaling). The grid's top-left corner sits at (originX, originY).
 *   - Cells are addressed by integer {col, row}, (0,0) at top-left.
 *   - A footprint is {col, row, width, height}, anchored at its top-left cell.
 *
 * Placement is atomic: canPlace() validates, place() mutates only when the
 * same validation passes. Rejections return a reason, never throw.
 */

export const PlacementFailure = Object.freeze({
    INVALID_FOOTPRINT: 'invalid-footprint',
    OUT_OF_BOUNDS: 'out-of-bounds',
    OCCUPIED: 'occupied',
    DUPLICATE_ID: 'duplicate-id',
});

const isPositiveInt = (n) => Number.isInteger(n) && n > 0;

function assertPositiveInt(name, value) {
    if (!isPositiveInt(value)) {
        throw new RangeError(`Grid ${name} must be a positive integer, got ${value}`);
    }
}

function assertFinite(name, value) {
    if (!Number.isFinite(value)) {
        throw new RangeError(`Grid ${name} must be a finite number, got ${value}`);
    }
}

export class Grid {
    #cells;
    #occupants = new Map(); // id -> {col, row, width, height}

    /**
     * @param {{cols: number, rows: number, tileSize: number, originX?: number, originY?: number}} config
     */
    constructor({cols, rows, tileSize, originX = 0, originY = 0} = {}) {
        assertPositiveInt('cols', cols);
        assertPositiveInt('rows', rows);
        assertPositiveInt('tileSize', tileSize);
        assertFinite('originX', originX);
        assertFinite('originY', originY);

        this.cols = cols;
        this.rows = rows;
        this.tileSize = tileSize;
        this.originX = originX;
        this.originY = originY;
        Object.freeze(this); // config fields are read-only; private state stays mutable

        this.#cells = new Array(cols * rows).fill(null);
    }

    // ---- Coordinate conversion -------------------------------------------

    /**
     * World point -> cell. A point exactly on a cell boundary belongs to the
     * cell to its right/below. Returns null outside the grid (including the
     * far right/bottom edge) or for non-finite input.
     */
    worldToCell(x, y) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        const col = Math.floor((x - this.originX) / this.tileSize);
        const row = Math.floor((y - this.originY) / this.tileSize);
        return this.#cellInBounds(col, row) ? {col, row} : null;
    }

    /** Top-left world corner of a cell. */
    cellToWorld(col, row) {
        return {
            x: this.originX + col * this.tileSize,
            y: this.originY + row * this.tileSize,
        };
    }

    /** World centre of a cell. */
    cellCenter(col, row) {
        const half = this.tileSize / 2;
        const {x, y} = this.cellToWorld(col, row);
        return {x: x + half, y: y + half};
    }

    /** World-space rectangle covered by a footprint (for rendering / proxies). */
    footprintRect({col, row, width = 1, height = 1}) {
        const {x, y} = this.cellToWorld(col, row);
        return {x, y, width: width * this.tileSize, height: height * this.tileSize};
    }

    // ---- Queries ---------------------------------------------------------

    /** True when the entire footprint lies inside the grid. */
    isInBounds(footprint) {
        const fp = normalizeFootprint(footprint);
        return fp !== null && this.#footprintInBounds(fp);
    }

    /** Occupant id at a cell, or null when empty / out of bounds / invalid. */
    occupantAt(col, row) {
        if (!this.#cellInBounds(col, row)) return null;
        return this.#cells[row * this.cols + col];
    }

    // ---- Placement -------------------------------------------------------

    /**
     * @returns {{ok: true} | {ok: false, reason: string, blockers?: string[]}}
     *   blockers (for 'occupied') lists each distinct occupant once, in
     *   row-major scan order.
     */
    canPlace(footprint) {
        const fp = normalizeFootprint(footprint);
        if (fp === null) return fail(PlacementFailure.INVALID_FOOTPRINT);
        if (!this.#footprintInBounds(fp)) return fail(PlacementFailure.OUT_OF_BOUNDS);

        const blockers = [];
        this.#forEachCell(fp, (index) => {
            const id = this.#cells[index];
            if (id !== null && !blockers.includes(id)) blockers.push(id);
        });
        if (blockers.length > 0) return {ok: false, reason: PlacementFailure.OCCUPIED, blockers};

        return {ok: true};
    }

    /**
     * Occupy a footprint. Atomic: on any failure the grid is unchanged.
     * @param {string} id - non-empty string, unique within this grid
     */
    place(id, footprint) {
        if (typeof id !== 'string' || id.length === 0) {
            throw new TypeError(`Grid occupant id must be a non-empty string, got ${id}`);
        }
        if (this.#occupants.has(id)) return fail(PlacementFailure.DUPLICATE_ID);

        const result = this.canPlace(footprint);
        if (!result.ok) return result;

        const fp = normalizeFootprint(footprint);
        this.#forEachCell(fp, (index) => {
            this.#cells[index] = id;
        });
        this.#occupants.set(id, fp);
        return {ok: true};
    }

    /** Free every cell held by `id`. Returns false if `id` is unknown. */
    remove(id) {
        const fp = this.#occupants.get(id);
        if (!fp) return false;
        this.#forEachCell(fp, (index) => {
            this.#cells[index] = null;
        });
        this.#occupants.delete(id);
        return true;
    }

    /** Detached, JSON-serializable view of the grid (e.g. for QASurface). */
    snapshot() {
        return {
            cols: this.cols,
            rows: this.rows,
            tileSize: this.tileSize,
            originX: this.originX,
            originY: this.originY,
            occupants: [...this.#occupants].map(([id, fp]) => ({id, ...fp})),
        };
    }

    // ---- Internals -------------------------------------------------------

    #cellInBounds(col, row) {
        return Number.isInteger(col) && Number.isInteger(row)
            && col >= 0 && row >= 0 && col < this.cols && row < this.rows;
    }

    #footprintInBounds({col, row, width, height}) {
        return col >= 0 && row >= 0
            && col + width <= this.cols && row + height <= this.rows;
    }

    #forEachCell({col, row, width, height}, fn) {
        for (let r = row; r < row + height; r++) {
            for (let c = col; c < col + width; c++) {
                fn(r * this.cols + c);
            }
        }
    }
}

/** Returns a fresh {col,row,width,height} copy, or null if malformed. */
function normalizeFootprint(footprint) {
    if (footprint === null || typeof footprint !== 'object') return null;
    const {col, row, width = 1, height = 1} = footprint;
    if (!Number.isInteger(col) || !Number.isInteger(row)) return null;
    if (!isPositiveInt(width) || !isPositiveInt(height)) return null;
    return {col, row, width, height};
}

const fail = (reason) => ({ok: false, reason});
