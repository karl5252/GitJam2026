/**
 * What a shot hits. Pure: no Phaser, no state and no randomness.
 *
 * A shot is a straight line, and it stops at the first solid thing on it, so it
 * can never damage what stands behind something else. Bounds are closed, as they
 * are for walking: two buildings touching at a corner leave no gap to shoot
 * through.
 *
 * An OPEN gate is the one exception, and only for a line that goes through the
 * doorway: in by one passage face and out by the other, strictly between the
 * posts. A line that clips a post, comes in from the side or ends in the doorway
 * hits the gate, whichever way the line mostly runs. Everything else about a gate
 * is as solid as a wall.
 *
 * Positions are multiples of half a pixel, so doubling them gives whole numbers,
 * and where a line meets something is compared as an exact fraction. Nothing here
 * can round differently in another engine.
 */
import {getBuildingType} from './buildingTypes.js';

const ZERO = Object.freeze({n: 0, d: 1});
const ONE = Object.freeze({n: 1, d: 1});

/** A fraction of the way along a line, always with d > 0. */
const fraction = (n, d) => (d < 0 ? {n: -n, d: -d} : {n, d});
const isBefore = (a, b) => a.n * b.d < b.n * a.d;

/** The part of a line within from..to on one axis, or null if it never gets there. */
function slab(start, delta, from, to) {
    if (delta === 0) return start >= from && start <= to ? {enter: ZERO, exit: ONE} : null;
    const near = fraction(from - start, delta);
    const far = fraction(to - start, delta);
    return isBefore(near, far) ? {enter: near, exit: far} : {enter: far, exit: near};
}

/**
 * Where a line first meets a closed rectangle.
 * @returns {{n: number, d: number}|null} the fraction along the line, 0 to 1
 */
function entryInto(line, rect) {
    const x = slab(line.x, line.dx, rect.left, rect.right);
    const y = x && slab(line.y, line.dy, rect.top, rect.bottom);
    if (!y) return null;
    const latest = [x.enter, y.enter, ZERO].reduce((a, b) => (isBefore(a, b) ? b : a));
    const earliest = [x.exit, y.exit, ONE].reduce((a, b) => (isBefore(b, a) ? b : a));
    return isBefore(earliest, latest) ? null : latest;
}

/**
 * Does a line cross both faces of a doorway, strictly between its posts? `along`
 * is the passage axis and `across` the other one.
 */
function crossesDoorway(along, across, faces, posts) {
    if (along.delta === 0) return false;
    const end = along.start + along.delta;
    if (Math.min(along.start, end) > faces.low || Math.max(along.start, end) < faces.high) return false;
    return [faces.low, faces.high].every((face) => {
        const {n, d} = fraction(face - along.start, along.delta);
        const crossing = across.start * d + across.delta * n; // the position on the face, times d
        return crossing > posts.low * d && crossing < posts.high * d;
    });
}

function passesDoorway(line, rect, passageAxis) {
    const x = {start: line.x, delta: line.dx};
    const y = {start: line.y, delta: line.dy};
    const columns = {low: rect.left, high: rect.right};
    const rows = {low: rect.top, high: rect.bottom};
    return passageAxis === 'x' ? crossesDoorway(x, y, columns, rows) : crossesDoorway(y, x, rows, columns);
}

const doubledRect = ({x, y, width, height}) => ({
    left: 2 * x, right: 2 * (x + width), top: 2 * y, bottom: 2 * (y + height),
});

const contains = (rect, {x, y}) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

/** The tiles a span touches. A point on a tile line touches the tiles either side. */
function tileSpan(a, b, origin, tileSize) {
    return [Math.ceil((Math.min(a, b) - origin) / tileSize) - 1, Math.floor((Math.max(a, b) - origin) / tileSize)];
}

/** Every building on a tile within the line's bounding box. */
function candidates(from, to, grid, byId) {
    const [firstCol, lastCol] = tileSpan(from.x, to.x, grid.originX, grid.tileSize);
    const [firstRow, lastRow] = tileSpan(from.y, to.y, grid.originY, grid.tileSize);
    const found = new Set();
    for (let row = firstRow; row <= lastRow; row++) {
        for (let col = firstCol; col <= lastCol; col++) {
            const building = byId.get(grid.occupantAt(col, row));
            if (building) found.add(building);
        }
    }
    return found;
}

/**
 * The first solid building on the line from one point to another. A building the
 * shooter is standing in does not count: it can only be a gate that closed on it.
 * Ties go to the earliest building in the list.
 * @param {{x: number, y: number}} from
 * @param {{x: number, y: number}} to
 * @param {{grid: import('./grid.js').Grid, buildings: object[], byId: Map<string, object>,
 *          isOpenGate?: (id: string) => boolean}} world
 * @returns {{building: object, x: number, y: number}|null} what it hits and where; null means a clear line
 */
export function firstSolid(from, to, {grid, buildings, byId, isOpenGate = () => false}) {
    const line = {x: 2 * from.x, y: 2 * from.y, dx: 2 * (to.x - from.x), dy: 2 * (to.y - from.y)};
    let best = null;
    for (const building of candidates(from, to, grid, byId)) {
        const rect = doubledRect(grid.footprintRect(building));
        if (contains(rect, line)) continue;
        const entry = entryInto(line, rect);
        if (!entry) continue;
        const gate = getBuildingType(building.type)?.gate;
        if (gate && isOpenGate(building.id) && passesDoorway(line, rect, gate.passageAxis)) continue;
        const sooner = !best || isBefore(entry, best.entry);
        const tied = best && !sooner && !isBefore(best.entry, entry);
        if (sooner || (tied && buildings.indexOf(building) < buildings.indexOf(best.building))) best = {building, entry};
    }
    if (!best) return null;
    const {n, d} = best.entry;
    return {building: best.building, x: from.x + (to.x - from.x) * n / d, y: from.y + (to.y - from.y) * n / d};
}
