/**
 * Where soldiers can walk. Pure: no Phaser and no state.
 *
 * A walk map is one value per tile, read from the building records. Roads do not
 * appear: soldiers treat them as open ground. An edge between two touching tiles
 * exists only if BOTH ends allow travel along that axis, so a gate can only be
 * entered and left along its passage axis, and from the side it is as solid as a
 * wall. A gate's state is not part of the map: soldiers wait for it to open, so
 * opening and closing never change the map.
 *
 * A walk field is the cost of reaching one goal from every tile, shared by a
 * whole squad, so a soldier needs no path of its own. Each step strictly lowers
 * the cost, so following a field cannot loop.
 */
import {getBuildingType} from './buildingTypes.js';
import {ROUTE_COST} from './roads.js';

export const UNREACHABLE = 0x7fffffff;

/** Extra cost of entering a gate, in tiles: the wait for it to open. */
export const GATE_TILE_COST = Math.round(ROUTE_COST.gateTicks / ROUTE_COST.tileTicks);

const FREE = 0;
const SOLID = 1;
const GATE_X = 2;
const GATE_Y = 3;

const STEPS = Object.freeze([[0, -1], [1, 0], [0, 1], [-1, 0]]); // N, E, S, W

const allows = (tile, axis) => tile === FREE || tile === (axis === 'x' ? GATE_X : GATE_Y);
const enterCost = (tile) => 1 + (tile === FREE ? 0 : GATE_TILE_COST);

/** @returns {{cols: number, rows: number, tiles: Uint8Array}} */
export function walkMap({cols, rows}, buildings) {
    const tiles = new Uint8Array(cols * rows);
    for (const {type, col, row, width, height} of buildings) {
        const gate = getBuildingType(type).gate;
        const value = gate ? (gate.passageAxis === 'x' ? GATE_X : GATE_Y) : SOLID;
        for (let r = row; r < row + height; r++) tiles.fill(value, r * cols + col, r * cols + col + width);
    }
    return {cols, rows, tiles};
}

const keyOf = ({cols}, {col, row}) => row * cols + col;
const inMap = ({cols, rows}, col, row) => col >= 0 && row >= 0 && col < cols && row < rows;

/** A tile with nothing on it. A gate does not count: nobody can stand on one for long. */
export const isFree = (map, cell) => map.tiles[keyOf(map, cell)] === FREE;

/** A tile holding a gate. */
export const isGate = (map, cell) => map.tiles[keyOf(map, cell)] >= GATE_X;

/** Can a soldier step between these two touching tiles? */
export function canStep(map, from, to) {
    const axis = from.row === to.row ? 'x' : 'y';
    return allows(map.tiles[keyOf(map, from)], axis) && allows(map.tiles[keyOf(map, to)], axis);
}

/**
 * Cost to `goal` from every tile, in tiles, walking outward from it with one
 * bucket per cost. A goal that is not free is reached from nowhere.
 * @returns {Int32Array} indexed by row * cols + col
 */
export function walkField(map, goal) {
    const {cols, tiles} = map;
    const field = new Int32Array(tiles.length).fill(UNREACHABLE);
    if (!isFree(map, goal)) return field;
    const start = keyOf(map, goal);
    field[start] = 0;
    const buckets = [[start]];
    for (let cost = 0; cost < buckets.length; cost++) {
        for (const key of buckets[cost] ?? []) {
            if (field[key] !== cost) continue;
            const col = key % cols;
            const cell = {col, row: (key - col) / cols};
            const total = cost + enterCost(tiles[key]);
            for (const [dc, dr] of STEPS) {
                const near = {col: cell.col + dc, row: cell.row + dr};
                if (!inMap(map, near.col, near.row) || !canStep(map, near, cell)) continue;
                const nearKey = keyOf(map, near);
                if (total >= field[nearKey]) continue;
                field[nearKey] = total;
                (buckets[total] ??= []).push(nearKey);
            }
        }
    }
    return field;
}

/**
 * The next tile on a cheapest way to the field's goal, N, E, S, W on ties, or
 * null at the goal or with no way there.
 */
export function nextStep(map, field, cell) {
    const here = field[keyOf(map, cell)];
    if (here === 0 || here === UNREACHABLE) return null;
    for (const [dc, dr] of STEPS) {
        const near = {col: cell.col + dc, row: cell.row + dr};
        if (!inMap(map, near.col, near.row) || !canStep(map, cell, near)) continue;
        const key = keyOf(map, near);
        if (field[key] !== UNREACHABLE && field[key] + enterCost(map.tiles[key]) === here) return near;
    }
    return null;
}

/** Tiles touching `cell` that a soldier could step onto without entering a gate, in N, E, S, W order. */
export function openNeighbors(map, cell) {
    const open = [];
    for (const [dc, dr] of STEPS) {
        const near = {col: cell.col + dc, row: cell.row + dr};
        if (inMap(map, near.col, near.row) && isFree(map, near) && canStep(map, cell, near)) open.push(near);
    }
    return open;
}

/**
 * Where a squad actually stands. The flag if soldiers leaving the exit can reach
 * it, otherwise the exit, which they always can. This is derived, not stored, so
 * a flag that was walled off works again the moment a way opens.
 * @param {{col, row}} exit
 * @param {{col, row} | null} flag
 * @returns {{post: {col, row}, blocked: boolean, field: Int32Array}}
 */
export function resolvePost(map, exit, flag) {
    if (flag) {
        const field = walkField(map, flag);
        if (field[keyOf(map, exit)] !== UNREACHABLE) return {post: {col: flag.col, row: flag.row}, blocked: false, field};
    }
    return {post: {col: exit.col, row: exit.row}, blocked: flag !== null, field: walkField(map, exit)};
}
