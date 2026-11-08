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
 *
 * A gate stands on a road tile and closes its sides: an edge across the barrier
 * does not exist, so routes and connectivity obey orientation without knowing
 * about it. Losing a gate only adds edges, so it can never break a route.
 */
import {GATE} from './gates.js';
import {PlacementFailure} from './grid.js';

export const HQ_RING = 'hq-ring';
export const PLAYER_ROAD = 'player';

/** Building types whose outgoing dock must be a connected road. */
export const ROAD_ACCESS_TYPES = Object.freeze(['factory']);

/** The tile a building ships from: the middle of its right side. No rotation. */
export const outgoingDock = ({col, row, width, height}) => ({col: col + width, row: row + Math.floor(height / 2)});

/** The tile a Barracks deploys from: the middle of its left side. No rotation. */
export const barracksExit = ({col, row, height}) => ({col: col - 1, row: row + Math.floor(height / 2)});

/** The tile a building receives on: the middle of its bottom side. */
export const receivingDock = ({col, row, width, height}) => ({col: col + Math.floor(width / 2), row: row + height});

export const RoadFailure = Object.freeze({
    OUT_OF_BOUNDS: 'out-of-bounds',
    OCCUPIED: 'occupied',
    TERRAIN_BLOCKED: PlacementFailure.TERRAIN_BLOCKED,
    ROAD_EXISTS: 'road-exists',
    NOT_CONNECTED: 'not-connected',
    UNKNOWN_ROAD: 'unknown-road',
    HQ_RING_PERMANENT: 'hq-ring-permanent',
    ROAD_REQUIRED: 'road-required',
    HQ_RING_OUT_OF_BOUNDS: 'hq-ring-out-of-bounds',
    ROAD_OCCUPIED: 'road-occupied',
    NO_ROAD_ACCESS: 'no-road-access',
    NO_EXIT_ACCESS: 'no-exit-access',
    EXIT_REQUIRED: 'exit-required',
    GATE_NEEDS_ROAD: 'gate-needs-road',
    GATE_NEEDS_STRAIGHT_ROAD: 'gate-needs-straight-road',
    GATE_ON_HQ_RING: 'gate-on-hq-ring',
    GATE_ON_DOCK: 'gate-on-dock',
    GATE_DEPENDS_ON_ROAD: 'gate-depends-on-road',
});

/** Estimated truck travel time, for choosing a route. Static: no traffic is modelled. */
export const ROUTE_COST = Object.freeze({tileTicks: 32, gateTicks: GATE.openTicks});

const STEPS = Object.freeze([[0, -1], [1, 0], [0, 1], [-1, 0]]); // N, E, S, W
const AXIS_STEPS = Object.freeze({x: Object.freeze([[-1, 0], [1, 0]]), y: Object.freeze([[0, -1], [0, 1]])});

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

export class RoadNetwork {
    #grid;
    #tiles = new Map(); // integer cell index -> {col, row, kind}
    #gates = new Map(); // integer cell index -> passage axis
    #revision = 0;

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

    /** Changes on every road or gate change, so walkers and trucks know to look again. */
    get revision() {
        return this.#revision;
    }

    has(cell) {
        return this.#tiles.has(this.#key(cell));
    }

    /** Detached tiles in row-major order. */
    tiles() {
        return [...this.#tiles.values()].map((t) => ({...t})).sort((a, b) => this.#key(a) - this.#key(b));
    }

    /** A step between two touching cells, unless a gate's barrier lies across it. */
    #crossable(a, b) {
        const axis = a.col === b.col ? 'y' : 'x';
        const barrier = (cell) => (this.#gates.get(this.#key(cell)) ?? axis) !== axis;
        return !barrier(a) && !barrier(b);
    }

    /** Road tiles reachable in one step, in fixed N, E, S, W order. */
    neighbors(cell) {
        return STEPS.map(([dc, dr]) => ({col: cell.col + dc, row: cell.row + dr}))
            .filter((next) => this.#inBounds(next) && this.has(next) && this.#crossable(cell, next));
    }

    /** Can a truck drive straight from `a` to the touching tile `b` right now? */
    connects(a, b) {
        return this.neighbors(a).some((next) => next.col === b.col && next.row === b.row);
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

    /** Is this cell a road connected to the HQ ring? */
    isConnected(cell) {
        return this.#inBounds(cell) && this.#connectedKeys().has(this.#key(cell));
    }

    /**
     * The quickest road route between two tiles, both included, or null, by
     * estimated travel time (ROUTE_COST), so a gate is worth a detour of several
     * tiles. A route costs the same in both directions, so a truck can drive it
     * back. Equal costs are settled in discovery order, expanding N, E, S, W,
     * which without gates is exactly a breadth-first search. Identical tiles
     * give a one-tile route.
     * @returns {Array<{col, row}> | null}
     */
    route(from, to, {without = null, gate = null} = {}) {
        if (without || gate) return this.#asIf({without, gate}, () => this.route(from, to));
        if (!this.#inBounds(from) || !this.#inBounds(to) || !this.has(from) || !this.has(to)) return null;
        const target = this.#key(to);
        const cost = new Map([[this.#key(from), 0]]);
        const cameFrom = new Map([[this.#key(from), null]]);
        const frontier = [{cell: {col: from.col, row: from.row}, ticks: 0}];
        while (frontier.length > 0) {
            let first = 0;
            for (let i = 1; i < frontier.length; i++) {
                if (frontier[i].ticks < frontier[first].ticks) first = i;
            }
            const [{cell, ticks}] = frontier.splice(first, 1);
            if (ticks > cost.get(this.#key(cell))) continue; // a cheaper way was found since
            if (this.#key(cell) === target) {
                const path = [];
                for (let step = cell; step; step = cameFrom.get(this.#key(step))) path.push(step);
                return path.reverse();
            }
            for (const next of this.neighbors(cell)) {
                const key = this.#key(next);
                const total = ticks + ROUTE_COST.tileTicks + (this.#gates.has(key) ? ROUTE_COST.gateTicks : 0);
                if (cost.has(key) && cost.get(key) <= total) continue;
                cost.set(key, total);
                cameFrom.set(key, cell);
                frontier.push({cell: next, ticks: total});
            }
        }
        return null;
    }

    /**
     * Ask a question as if one tile were gone or one more gate stood, and put
     * everything back before anyone can see it. Map order does not matter to any
     * answer, but the tile goes back where it was anyway.
     */
    #asIf({without, gate}, ask) {
        const saved = new Map(this.#tiles);
        if (without) this.#tiles.delete(this.#key(without));
        if (gate) this.#gates.set(this.#key(gate.cell), gate.axis);
        try {
            return ask();
        } finally {
            this.#tiles = saved;
            if (gate) this.#gates.delete(this.#key(gate.cell));
        }
    }

    /** The passage axis of the gate on a cell, or null. */
    gateAt(cell) {
        return this.#gates.get(this.#key(cell)) ?? null;
    }

    /**
     * Could a gate with this passage axis stand here? It needs a player road
     * running straight through along that axis, and it must not cut any dock in
     * `docks` off from the network. Other branches of a junction may be cut:
     * that is the player's choice, and the barrier shows it. Never mutates.
     * @param {{col, row}} cell
     * @param {'x' | 'y'} axis
     * @param {Array<{col, row}>} docks
     */
    canAddGate(cell, axis, docks = []) {
        if (!this.#inBounds(cell) || !this.has(cell)) return {ok: false, reason: RoadFailure.GATE_NEEDS_ROAD};
        const key = this.#key(cell);
        if (this.#tiles.get(key).kind === HQ_RING) return {ok: false, reason: RoadFailure.GATE_ON_HQ_RING};
        if (docks.some((dock) => this.#key(dock) === key)) return {ok: false, reason: RoadFailure.GATE_ON_DOCK};

        const straight = AXIS_STEPS[axis].every(([dc, dr]) => {
            const next = {col: cell.col + dc, row: cell.row + dr};
            return this.#inBounds(next) && this.has(next) && (this.gateAt(next) ?? axis) === axis;
        });
        if (!straight) return {ok: false, reason: RoadFailure.GATE_NEEDS_STRAIGHT_ROAD};

        this.#gates.set(key, axis); // only to ask the question; gone before anyone can see it
        const connected = this.#connectedKeys();
        this.#gates.delete(key);
        const stranded = docks.some((dock) => !connected.has(this.#key(dock)));
        return stranded ? {ok: false, reason: RoadFailure.ROAD_REQUIRED} : {ok: true};
    }

    /** Record a gate that BuildingPlacement has already validated. */
    setGate(cell, axis) {
        this.#gates.set(this.#key(cell), axis);
        this.#revision++;
    }

    /** The tile stays, as a plain road. */
    clearGate(cell) {
        this.#gates.delete(this.#key(cell));
        this.#revision++;
    }

    /** A gate's own tile and the road it runs along must stay while it stands. */
    #holdsUpGate(key) {
        if (this.#gates.has(key)) return true;
        for (const [gateKey, axis] of this.#gates) {
            const col = gateKey % this.#grid.cols;
            const row = Math.floor(gateKey / this.#grid.cols);
            if (AXIS_STEPS[axis].some(([dc, dr]) => this.#key({col: col + dc, row: row + dr}) === key)) return true;
        }
        return false;
    }

    /** Would the whole ring fit around this footprint? Never mutates. */
    canAddHqRing(footprint) {
        const cells = hqRingCells(footprint);
        if (!cells.every((cell) => this.#inBounds(cell))) return {ok: false, reason: RoadFailure.HQ_RING_OUT_OF_BOUNDS};
        const blocked = cells.some(({col, row}) => this.#grid.occupantAt(col, row) !== null);
        if (blocked) return {ok: false, reason: RoadFailure.OCCUPIED};
        const buildable = cells.every(({col, row}) => this.#grid.isBuildable(col, row));
        return buildable ? {ok: true} : {ok: false, reason: RoadFailure.TERRAIN_BLOCKED};
    }

    addHqRing(footprint) {
        const check = this.canAddHqRing(footprint);
        if (!check.ok) return check;
        for (const cell of hqRingCells(footprint)) this.#tiles.set(this.#key(cell), {...cell, kind: HQ_RING});
        this.#revision++;
        return {ok: true};
    }

    #canOccupy(cell) {
        if (!this.#inBounds(cell)) return {ok: false, reason: RoadFailure.OUT_OF_BOUNDS};
        if (this.has(cell)) return {ok: false, reason: RoadFailure.ROAD_EXISTS};
        if (this.#grid.occupantAt(cell.col, cell.row) !== null) return {ok: false, reason: RoadFailure.OCCUPIED};
        if (!this.#grid.isBuildable(cell.col, cell.row)) return {ok: false, reason: RoadFailure.TERRAIN_BLOCKED};
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
        if (check.ok) {
            this.#tiles.set(this.#key(cell), {col: cell.col, row: cell.row, kind: PLAYER_ROAD});
            this.#revision++;
        }
        return check;
    }

    /**
     * Layout fixtures only: put back a player tile without the touching rule,
     * because a legal game can hold disconnected fragments. Bounds and
     * collisions still apply, and Factories must still have real access.
     */
    restoreTile(cell) {
        const check = this.#canOccupy(cell);
        if (check.ok) {
            this.#tiles.set(this.#key(cell), {col: cell.col, row: cell.row, kind: PLAYER_ROAD});
            this.#revision++;
        }
        return check;
    }

    /**
     * A tile can go unless it is part of the HQ ring, or a dock in `docks`
     * would lose every connected route. Never mutates.
     * @param {{col, row}} cell
     * @param {Array<{col, row}>} docks
     */
    canRemove(cell, docks = []) {
        if (!this.#inBounds(cell) || !this.has(cell)) return {ok: false, reason: RoadFailure.UNKNOWN_ROAD};
        const key = this.#key(cell);
        if (this.#tiles.get(key).kind === HQ_RING) return {ok: false, reason: RoadFailure.HQ_RING_PERMANENT};
        if (this.#holdsUpGate(key)) return {ok: false, reason: RoadFailure.GATE_DEPENDS_ON_ROAD};
        const connected = this.#connectedKeys(key);
        connected.delete(key);
        const stranded = docks.some((dock) => !connected.has(this.#key(dock)));
        return stranded ? {ok: false, reason: RoadFailure.ROAD_REQUIRED} : {ok: true};
    }

    remove(cell, docks = []) {
        const check = this.canRemove(cell, docks);
        if (check.ok) {
            this.#tiles.delete(this.#key(cell));
            this.#revision++;
        }
        return check;
    }

    /** Detached, JSON-serializable state. */
    snapshot() {
        const connected = this.#connectedKeys();
        return {tiles: this.tiles(), connected: this.tiles().filter((t) => connected.has(this.#key(t))).length};
    }
}
