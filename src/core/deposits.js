/**
 * Mineral deposits, generated with the jungle. Pure: no Phaser.
 *
 * A deposit is an irregular cluster of tiles under the jungle, away from the
 * starting clearing. Distance is measured from the generated clearing, never
 * from HQ, which the player places. Each cluster grows from a 2x2 seam core,
 * which is always one valid Mine footprint, and the tile under the core's
 * bottom-right tile (the Mine's south dock) is kept free of ore and inside the
 * map, with a way on to the clearing that does not cross the core.
 *
 * Generation draws from its own stream, derived from the world seed, after the
 * terrain is finished: the terrain, its snapshot and the game's RNG are exactly
 * as they were before deposits existed. Deposits never change during a run.
 * Clearing the jungle over one only reveals it; roads and buildings may stand on
 * deposit tiles and consume nothing.
 */
import {SeededRandom} from './seededRandom.js';

/** All provisional. Gaps count jungle tiles between the clearing and the nearest ore. */
export const DEPOSIT = Object.freeze({
    count: 3,
    near: Object.freeze({minGap: 3, maxGap: 5}), // one deposit always this close, to be found from the clearing
    far: Object.freeze({minGap: 5, maxGap: 9}),
    size: Object.freeze({min: 7, max: 12}), // tiles in a cluster, core included
    pathGap: 2, // jungle tiles kept between ore and the dirt path
    separation: 3, // jungle tiles kept between two deposits
    salt: 0x5d0b1e57,
});

const NEIGHBOURS = Object.freeze([[0, -1], [1, 0], [0, 1], [-1, 0]]);
const key = (col, row) => `${col},${row}`;

/** The Mine's south dock for a 2x2 at this anchor: the same tile roads.receivingDock gives. */
const dockOf = ({col, row}) => ({col: col + 1, row: row + 2});

/** Chebyshev distance from every tile to the nearest tile in `sources`. */
function distanceFrom(cols, rows, isSource) {
    const distance = new Int32Array(cols * rows).fill(-1);
    let frontier = [];
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            if (!isSource(col, row)) continue;
            distance[row * cols + col] = 0;
            frontier.push([col, row]);
        }
    }
    for (let d = 1; frontier.length > 0; d++) {
        const next = [];
        for (const [col, row] of frontier) {
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    const [c, r] = [col + dc, row + dr];
                    if (c < 0 || r < 0 || c >= cols || r >= rows || distance[r * cols + c] !== -1) continue;
                    distance[r * cols + c] = d;
                    next.push([c, r]);
                }
            }
        }
        frontier = next;
    }
    return distance;
}

/** Which side of the clearing a tile lies on: 0 N, 1 E, 2 S, 3 W. */
function sideOf({col, row}, center) {
    const [dx, dy] = [col - center.col, row - center.row];
    if (Math.abs(dy) * 2 >= Math.abs(dx)) return dy < 0 ? 0 : 2; // the map is wider than tall
    return dx > 0 ? 1 : 3;
}

/** Can a road get from the dock to the clearing without crossing the Mine? */
function dockReachesClearing(cols, rows, dock, blocked, isClearing) {
    const seen = new Set([key(dock.col, dock.row)]);
    const queue = [dock];
    for (let i = 0; i < queue.length; i++) {
        const {col, row} = queue[i];
        if (isClearing(col, row)) return true;
        for (const [dc, dr] of NEIGHBOURS) {
            const [c, r] = [col + dc, row + dr];
            const k = key(c, r);
            if (c < 0 || r < 0 || c >= cols || r >= rows || seen.has(k) || blocked.has(k)) continue;
            seen.add(k);
            queue.push({col: c, row: r});
        }
    }
    return false;
}

/**
 * Growth can, rarely, fill its own bounding box. A deposit is never a rectangle, so
 * then it loses a corner outside the core, which keeps it in one piece.
 */
function breakRectangle(cluster, core) {
    const tiles = [...cluster.values()];
    const [cols, rows] = [tiles.map((t) => t.col), tiles.map((t) => t.row)];
    const [left, right, top, bottom] = [Math.min(...cols), Math.max(...cols), Math.min(...rows), Math.max(...rows)];
    if ((right - left + 1) * (bottom - top + 1) !== cluster.size) return;
    const inCore = ({col, row}) => col >= core.col && col <= core.col + 1 && row >= core.row && row <= core.row + 1;
    const corner = [{col: left, row: top}, {col: right, row: top}, {col: left, row: bottom}, {col: right, row: bottom}].find((c) => !inCore(c));
    cluster.delete(key(corner.col, corner.row));
}

/**
 * @param {{cols, rows, seed, center: {col, row}, kindAt: (col, row) => string|null,
 *          spawnFrame: {col, row, cols, rows} | null}} terrain
 * @returns {Array<{id: string, core: {col, row}, dock: {col, row}, tiles: Array<{col, row}>}>}
 */
export function generateDeposits({cols, rows, seed, center, kindAt, spawnFrame}) {
    const rng = new SeededRandom((seed ^ DEPOSIT.salt) >>> 0);
    const fromClearing = distanceFrom(cols, rows, (c, r) => kindAt(c, r) === 'clearing');
    const fromPath = distanceFrom(cols, rows, (c, r) => kindAt(c, r) === 'path');
    const gapAt = (c, r) => fromClearing[r * cols + c] - 1;
    const onFrameRing = (c, r) => {
        if (!spawnFrame) return false;
        const [right, bottom] = [spawnFrame.col + spawnFrame.cols - 1, spawnFrame.row + spawnFrame.rows - 1];
        const inside = c >= spawnFrame.col && c <= right && r >= spawnFrame.row && r <= bottom;
        return inside && (c === spawnFrame.col || c === right || r === spawnFrame.row || r === bottom);
    };
    const inMap = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows;
    // A tile ore may cover: jungle, clear of the path and of the frame mutants spawn on.
    const oreFree = (c, r) => inMap(c, r) && kindAt(c, r) === 'jungle' && !onFrameRing(c, r)
        && fromPath[r * cols + c] > DEPOSIT.pathGap;

    const taken = []; // tiles of deposits already placed, for separation
    const apart = (c, r) => taken.every((t) => Math.max(Math.abs(t.col - c), Math.abs(t.row - r)) > DEPOSIT.separation);

    const coresFor = (band) => {
        const cores = [];
        for (let row = 0; row < rows - 2; row++) {
            for (let col = 0; col < cols - 1; col++) {
                const tiles = [[col, row], [col + 1, row], [col, row + 1], [col + 1, row + 1]];
                if (!tiles.every(([c, r]) => oreFree(c, r) && apart(c, r))) continue;
                const gap = Math.min(...tiles.map(([c, r]) => gapAt(c, r)));
                if (gap < band.minGap || gap > band.maxGap) continue;
                const dock = dockOf({col, row});
                if (!inMap(dock.col, dock.row) || onFrameRing(dock.col, dock.row) || !apart(dock.col, dock.row)) continue;
                cores.push({col, row});
            }
        }
        return cores;
    };

    const deposits = [];
    const usedSides = new Set();
    for (let i = 0; i < DEPOSIT.count; i++) {
        const band = i === 0 ? DEPOSIT.near : DEPOSIT.far;
        const candidates = coresFor(band).filter((core) => !usedSides.has(sideOf(core, center)));
        let core = null;
        while (candidates.length > 0 && core === null) {
            const [pick] = candidates.splice(rng.nextInt(0, candidates.length - 1), 1);
            const blocked = new Set([[0, 0], [1, 0], [0, 1], [1, 1]].map(([dc, dr]) => key(pick.col + dc, pick.row + dr)));
            if (dockReachesClearing(cols, rows, dockOf(pick), blocked, (c, r) => kindAt(c, r) === 'clearing')) core = pick;
        }
        if (core === null) continue;
        usedSides.add(sideOf(core, center));
        const dock = dockOf(core);
        const cluster = new Map();
        for (const [dc, dr] of [[0, 0], [1, 0], [0, 1], [1, 1]]) cluster.set(key(core.col + dc, core.row + dr), {col: core.col + dc, row: core.row + dr});
        const size = rng.nextInt(DEPOSIT.size.min, DEPOSIT.size.max);
        const limit = band.maxGap + 2;
        while (cluster.size < size) {
            const frontier = new Map();
            for (const {col, row} of cluster.values()) {
                for (const [dc, dr] of NEIGHBOURS) {
                    const [c, r] = [col + dc, row + dr];
                    const k = key(c, r);
                    if (cluster.has(k) || frontier.has(k) || !oreFree(c, r) || !apart(c, r)) continue;
                    if ((c === dock.col && r === dock.row) || gapAt(c, r) < band.minGap || gapAt(c, r) > limit) continue;
                    frontier.set(k, {col: c, row: r});
                }
            }
            if (frontier.size === 0) break;
            const options = [...frontier.values()].sort((a, b) => a.row - b.row || a.col - b.col);
            const pick = options[rng.nextInt(0, options.length - 1)];
            cluster.set(key(pick.col, pick.row), pick);
        }
        breakRectangle(cluster, core);
        const tiles = [...cluster.values()].sort((a, b) => a.row - b.row || a.col - b.col);
        taken.push(...tiles, dock);
        deposits.push({id: `deposit-${deposits.length + 1}`, core: {...core}, dock, tiles});
    }
    return deposits.map((d) => Object.freeze({
        id: d.id,
        core: Object.freeze(d.core),
        dock: Object.freeze(d.dock),
        tiles: Object.freeze(d.tiles.map((t) => Object.freeze(t))),
    }));
}
