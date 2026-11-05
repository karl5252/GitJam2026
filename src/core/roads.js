/**
 * Road network. Pure: no Phaser, no state beyond its tiles.
 *
 * Roads are separate from buildings. They have no HP, power or settlement
 * entry, and they never occupy the Grid, because Grid occupants are buildings:
 * mutant spawning, blocking and targeting all read them. Roads therefore have
 * no effect on combat. The Grid is only read here, for bounds and collisions.
 *
 * Connectivity is orthogonal only and is derived, never stored: the network is
 * everything reachable from the permanent HQ ring. A player tile can become a
 * disconnected fragment after a removal; fragments give no access until a new
 * tile joins them to the network again.
 */

export const HQ_RING = 'hq-ring';
export const PLAYER_ROAD = 'player';

/** Building types that need a connected road touching their footprint. */
export const ROAD_ACCESS_TYPES = Object.freeze(['factory']);

export const RoadFailure = Object.freeze({
    OUT_OF_BOUNDS: 'out-of-bounds',
    OCCUPIED: 'occupied',
    ROAD_EXISTS: 'road-exists',
    NOT_CONNECTED: 'not-connected',
    UNKNOWN_ROAD: 'unknown-road',
    HQ_RING_PERMANENT: 'hq-ring-permanent',
    ROAD_REQUIRED: 'road-required',
    HQ_RING_OUT_OF_BOUNDS: 'hq-ring-out-of-bounds',
    ROAD_OCCUPIED: 'road-occupied',
    NO_ROAD_ACCESS: 'no-road-access',
});

const STEPS = Object.freeze([[0, -1], [1, 0], [0, 1], [-1, 0]]); // N, E, S, W

/** The 16 cells around a 3x3 footprint, or the same ring for any size, row by row. */
export function hqRingCells({col, row, width, height}) {
    const cells = [];
    for (let r = row - 1; r <= row + height; r++) {
        for (let c = col - 1; c <= col + width; c++) {
            const edge = r === row - 1 || r === row + height || c === col - 1 || c === col + width;
            if (edge) cells.push({col: c, row: r});
        }
    }
    return cells;
}

/** Cells orthogonally touching a footprint's edges. Corners do not touch. */
function edgeCells({col, row, width, height}) {
    const cells = [];
    for (let c = col; c < col + width; c++) cells.push({col: c, row: row - 1}, {col: c, row: row + height});
    for (let r = row; r < row + height; r++) cells.push({col: col - 1, row: r}, {col: col + width, row: r});
    return cells;
}

export class RoadNetwork {
    #grid;
    #tiles = new Map(); // integer cell index -> {col, row, kind}

    /** @param {{grid: import('./grid.js').Grid}} deps */
    constructor({grid}) {
        this.#grid = grid;
    }

    #key({col, row}) {
        return row * this.#grid.cols + col;
    }

    #inBounds({col, row}) {
        return Number.isInteger(col) && Number.isInteger(row)
            && col >= 0 && row >= 0 && col < this.#grid.cols && row < this.#grid.rows;
    }

    has(cell) {
        return this.#tiles.has(this.#key(cell));
    }

    /** Detached tiles in row-major order. */
    tiles() {
        return [...this.#tiles.values()].map((t) => ({...t})).sort((a, b) => this.#key(a) - this.#key(b));
    }

    /** Road tiles next to a cell, in fixed N, E, S, W order. */
    neighbors({col, row}) {
        return STEPS.map(([dc, dr]) => ({col: col + dc, row: row + dr}))
            .filter((cell) => this.#inBounds(cell) && this.has(cell));
    }

    overlaps({col, row, width, height}) {
        for (let r = row; r < row + height; r++) {
            for (let c = col; c < col + width; c++) {
                if (this.#tiles.has(this.#key({col: c, row: r})) && this.#inBounds({col: c, row: r})) return true;
            }
        }
        return false;
    }

    /** Keys reachable from the HQ ring, optionally as if one tile were gone. */
    #connectedKeys(without = null) {
        const queue = [...this.#tiles.values()].filter((t) => t.kind === HQ_RING);
        const seen = new Set(queue.map((t) => this.#key(t)));
        while (queue.length > 0) {
            for (const next of this.neighbors(queue.pop())) {
                const key = this.#key(next);
                if (key !== without && !seen.has(key)) {
                    seen.add(key);
                    queue.push(next);
                }
            }
        }
        return seen;
    }

    /** Detached tiles connected to the HQ ring, in row-major order. */
    connectedTiles() {
        const connected = this.#connectedKeys();
        return this.tiles().filter((t) => connected.has(this.#key(t)));
    }

    #access(footprint, connected) {
        return edgeCells(footprint)
            .filter((cell) => this.#inBounds(cell) && connected.has(this.#key(cell)))
            .sort((a, b) => this.#key(a) - this.#key(b));
    }

    /** Connected road cells touching a footprint, in row-major order. */
    accessTiles(footprint) {
        return this.#access(footprint, this.#connectedKeys());
    }

    /** Would the whole ring fit around this footprint? Never mutates. */
    canAddHqRing(footprint) {
        const cells = hqRingCells(footprint);
        if (!cells.every((cell) => this.#inBounds(cell))) return {ok: false, reason: RoadFailure.HQ_RING_OUT_OF_BOUNDS};
        const blocked = cells.some(({col, row}) => this.#grid.occupantAt(col, row) !== null);
        return blocked ? {ok: false, reason: RoadFailure.OCCUPIED} : {ok: true};
    }

    addHqRing(footprint) {
        const check = this.canAddHqRing(footprint);
        if (!check.ok) return check;
        for (const cell of hqRingCells(footprint)) this.#tiles.set(this.#key(cell), {...cell, kind: HQ_RING});
        return {ok: true};
    }

    #canOccupy(cell) {
        if (!this.#inBounds(cell)) return {ok: false, reason: RoadFailure.OUT_OF_BOUNDS};
        if (this.has(cell)) return {ok: false, reason: RoadFailure.ROAD_EXISTS};
        if (this.#grid.occupantAt(cell.col, cell.row) !== null) return {ok: false, reason: RoadFailure.OCCUPIED};
        return {ok: true};
    }

    /** New roads must extend the connected network. Never mutates. */
    canAdd(cell) {
        const free = this.#canOccupy(cell);
        if (!free.ok) return free;
        const connected = this.#connectedKeys();
        const touches = this.neighbors(cell).some((next) => connected.has(this.#key(next)));
        return touches ? {ok: true} : {ok: false, reason: RoadFailure.NOT_CONNECTED};
    }

    add(cell) {
        const check = this.canAdd(cell);
        if (check.ok) this.#tiles.set(this.#key(cell), {col: cell.col, row: cell.row, kind: PLAYER_ROAD});
        return check;
    }

    /**
     * Layout fixtures only: put back a player tile without the touching rule,
     * because a legal game can hold disconnected fragments. Bounds and
     * collisions still apply, and Factories must still have real access.
     */
    restoreTile(cell) {
        const check = this.#canOccupy(cell);
        if (check.ok) this.#tiles.set(this.#key(cell), {col: cell.col, row: cell.row, kind: PLAYER_ROAD});
        return check;
    }

    /**
     * A tile can go unless it is part of the HQ ring, or some footprint in
     * `dependents` would lose every connected route. Never mutates.
     * @param {{col, row}} cell
     * @param {Array<{col, row, width, height}>} dependents
     */
    canRemove(cell, dependents = []) {
        if (!this.#inBounds(cell) || !this.has(cell)) return {ok: false, reason: RoadFailure.UNKNOWN_ROAD};
        const key = this.#key(cell);
        if (this.#tiles.get(key).kind === HQ_RING) return {ok: false, reason: RoadFailure.HQ_RING_PERMANENT};
        const connected = this.#connectedKeys(key);
        connected.delete(key);
        const stranded = dependents.some((footprint) => this.#access(footprint, connected).length === 0);
        return stranded ? {ok: false, reason: RoadFailure.ROAD_REQUIRED} : {ok: true};
    }

    remove(cell, dependents = []) {
        const check = this.canRemove(cell, dependents);
        if (check.ok) this.#tiles.delete(this.#key(cell));
        return check;
    }

    /** Detached, JSON-serializable state. */
    snapshot() {
        const connected = this.#connectedKeys();
        return {tiles: this.tiles(), connected: this.tiles().filter((t) => connected.has(this.#key(t))).length};
    }
}
