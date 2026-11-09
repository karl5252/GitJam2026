/**
 * Generated terrain. Pure: no Phaser. Generation is fixed by the seed; the one
 * change a run can make is clearing a jungle tile (`clear`), which HQ's workers do.
 * A new run generates a new Terrain, so nothing cleared outlives its run.
 *
 * Every tile is jungle, clearing, dirt path or cleared ground. Cleared ground is
 * buildable open ground, like the clearing, and is never jungle again. Jungle only stops construction: the
 * Grid asks isBuildable, and nothing that walks reads this at all. Clearing and path
 * are both open ground, so the path is decoration: it is not a road, gives no truck
 * access and costs nothing.
 *
 * Generation draws from its own SeededRandom, never the game's, so terrain can never
 * shift a spawn. It uses integers, sqrt and the LCG only, which every engine rounds
 * alike, so a seed is the same map everywhere.
 *
 * The clearing is one run of open tiles per row, and every run contains the centre
 * column, so it is always a single piece with no holes. Its core rectangle is always
 * open, which is what keeps a starting base from depending on a lucky seed.
 */
import {generateDeposits} from './deposits.js';
import {SeededRandom} from './seededRandom.js';

export const TerrainKind = Object.freeze({JUNGLE: 'jungle', CLEARING: 'clearing', PATH: 'path', CLEARED: 'cleared'});

const GLYPHS = Object.freeze({
    [TerrainKind.JUNGLE]: '#', [TerrainKind.CLEARING]: '.', [TerrainKind.PATH]: '=', [TerrainKind.CLEARED]: ',',
});
const KINDS = Object.freeze([TerrainKind.JUNGLE, TerrainKind.CLEARING, TerrainKind.PATH, TerrainKind.CLEARED]);
const JUNGLE_CODE = KINDS.indexOf(TerrainKind.JUNGLE);
const CLEARING_CODE = KINDS.indexOf(TerrainKind.CLEARING);
const PATH_CODE = KINDS.indexOf(TerrainKind.PATH);

export const CLEARING = Object.freeze({
    radiusCols: 9, // half the width of the clearing, before the edge wanders
    radiusRows: 6,
    centreShift: 1, // tiles the centre may move on each axis
    edgeWander: 2, // tiles each row's end may wander from the ellipse
    core: Object.freeze({width: 13, height: 9}), // always open: HQ and its ring, a Plant, a Factory, cannons
    frameInset: 1, // jungle kept between the clearing and the spawn frame
});

export const PATH = Object.freeze({
    edgeSpread: Object.freeze({min: 3, max: 6}), // how far along the map edge it starts from the middle, so it always has to bend
    meander: 0.25, // chance per tile of changing course
    sideStepEvery: 3, // it drifts sideways one tile in this many forward, so it never zigzags
    tilesInClearing: 4, // how far it runs on into the clearing
});

/** A sequence of nearby seeds must not be a sequence of nearby maps, and an LCG alone gives that. */
export function mixSeed(seed) {
    let h = seed >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** One end of the clearing's edge, walking slowly in and out from row to row. */
function wanderer(rng) {
    let offset = rng.nextInt(-CLEARING.edgeWander, CLEARING.edgeWander);
    return () => {
        offset = clamp(offset + rng.nextInt(-1, 1), -CLEARING.edgeWander, CLEARING.edgeWander);
        return offset;
    };
}

export class Terrain {
    #cells;
    #revision = 0;
    #depositAt = new Map(); // "col,row" -> deposit id

    /**
     * @param {{seed: number, cols: number, rows: number, cells: Uint8Array,
     *          center: {col, row}, core: {col, row, width, height}, path: Array<{col, row}>}} parts
     *   path - the middle of the track, in order from the map edge
     *   deposits - from core/deposits.js; fixed for the run, and not in snapshot()
     */
    constructor({seed, cols, rows, cells, center, core, path, deposits = []}) {
        this.seed = seed;
        this.cols = cols;
        this.rows = rows;
        this.center = Object.freeze({...center});
        this.core = Object.freeze({...core});
        this.path = Object.freeze(path.map((cell) => Object.freeze({...cell})));
        this.deposits = Object.freeze([...deposits]);
        for (const {id, tiles} of this.deposits) {
            for (const {col, row} of tiles) this.#depositAt.set(`${col},${row}`, id);
        }
        this.#cells = cells;
        Object.freeze(this);
    }

    /** @returns {string|null} a TerrainKind, or null outside the map */
    kindAt(col, row) {
        if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= this.cols || row >= this.rows) return null;
        return KINDS[this.#cells[row * this.cols + col]];
    }

    /** Changes each time a tile is cleared, so anything derived from the terrain knows to look again. */
    get revision() {
        return this.#revision;
    }

    /**
     * Turn one jungle tile into cleared ground, for the rest of the run.
     * @returns {boolean} true only if this call cleared it: never twice, never anything but jungle
     */
    clear(col, row) {
        if (this.kindAt(col, row) !== TerrainKind.JUNGLE) return false;
        this.#cells[row * this.cols + col] = KINDS.indexOf(TerrainKind.CLEARED);
        this.#revision++;
        return true;
    }

    /**
     * The deposit under a tile, whatever grows on it: clearing reveals ore, it does
     * not change it. @returns {string|null} a deposit id
     */
    depositAt(col, row) {
        return this.#depositAt.get(`${col},${row}`) ?? null;
    }

    /** Detached deposits, for QA and the terrain picture. Kept out of snapshot(), which pins the map. */
    depositSnapshot() {
        return this.deposits.map(({id, core, dock, tiles}) => ({id, core: {...core}, dock: {...dock}, tiles: tiles.map((t) => ({...t}))}));
    }

    isBuildable(col, row) {
        const kind = this.kindAt(col, row);
        return kind !== null && kind !== TerrainKind.JUNGLE;
    }

    /** Detached. Each row is a string: # jungle, . clearing, = path, , cleared ground. */
    snapshot() {
        const rows = [];
        for (let row = 0; row < this.rows; row++) {
            let line = '';
            for (let col = 0; col < this.cols; col++) line += GLYPHS[this.kindAt(col, row)];
            rows.push(line);
        }
        return {
            seed: this.seed,
            cols: this.cols,
            rows,
            center: {...this.center},
            core: {...this.core},
            path: this.path.map((cell) => ({...cell})),
        };
    }
}

/** Open one run of tiles per row, each holding the centre column and all of the core. */
function carveClearing(cells, cols, {center, core, limit}, rng) {
    const left = wanderer(rng);
    const right = wanderer(rng);
    const reach = CLEARING.radiusRows + 1;
    const top = Math.max(limit.top, center.row - CLEARING.radiusRows - rng.nextInt(0, 1));
    const bottom = Math.min(limit.bottom, center.row + CLEARING.radiusRows + rng.nextInt(0, 1));
    for (let row = top; row <= bottom; row++) {
        const dy = row - center.row;
        const half = Math.round(CLEARING.radiusCols * Math.sqrt(1 - (dy * dy) / (reach * reach)));
        const inCore = row >= core.row && row < core.row + core.height;
        let from = Math.min(center.col - half + left(), center.col);
        let to = Math.max(center.col + half + right(), center.col);
        if (inCore) {
            from = Math.min(from, core.col);
            to = Math.max(to, core.col + core.width - 1);
        }
        cells.fill(CLEARING_CODE, row * cols + Math.max(from, limit.left), row * cols + Math.min(to, limit.right) + 1);
    }
}

/**
 * From a seeded spot on a map edge towards the middle of the clearing, wandering
 * sideways and straightening up in time to arrive. Each move is one tile along an
 * axis, so the track never breaks.
 */
function tracePath(cols, rows, center, cellsAt, rng) {
    const side = rng.nextInt(0, 3); // N, E, S, W
    const vertical = side === 0 || side === 2;
    const along = vertical ? 'row' : 'col';
    const across = vertical ? 'col' : 'row';
    const end = vertical ? rows - 2 : cols - 2; // the track is two tiles wide
    const spread = rng.nextInt(PATH.edgeSpread.min, PATH.edgeSpread.max) * (rng.next() < 0.5 ? -1 : 1);
    const inward = side === 0 || side === 3 ? 1 : -1;
    const cell = {[along]: inward > 0 ? 0 : end, [across]: center[across] + spread};
    const path = [{...cell}];
    let course = 0;
    let inClearing = 0;
    let forward = 0;

    const move = (axis, step) => {
        cell[axis] += step;
        path.push({...cell});
    };
    while (inClearing < PATH.tilesInClearing && cell[along] !== center[along]) {
        const remaining = Math.abs(center[along] - cell[along]);
        const off = center[across] - cell[across];
        if (rng.next() < PATH.meander) course = rng.nextInt(-1, 1);
        // Late enough that it must head for the middle, it does, at the same gentle slope.
        if (Math.abs(off) * PATH.sideStepEvery >= remaining - PATH.sideStepEvery) course = Math.sign(off);
        if (course !== 0 && forward % PATH.sideStepEvery === 0) move(across, course);
        move(along, inward);
        forward++;
        if (cellsAt(cell.col, cell.row) === CLEARING_CODE) inClearing++;
    }
    return path;
}

/** The track can curl round a few trees where it joins the clearing. They count as open ground beside it. */
function openPockets(cells, cols, rows) {
    const outer = new Uint8Array(cols * rows);
    const queue = [];
    const visit = (col, row) => {
        const index = row * cols + col;
        if (col < 0 || row < 0 || col >= cols || row >= rows || outer[index] || cells[index] !== JUNGLE_CODE) return;
        outer[index] = 1;
        queue.push({col, row});
    };
    for (let col = 0; col < cols; col++) [0, rows - 1].forEach((row) => visit(col, row));
    for (let row = 0; row < rows; row++) [0, cols - 1].forEach((col) => visit(col, row));
    while (queue.length > 0) {
        const {col, row} = queue.pop();
        for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) visit(col + dc, row + dr);
    }
    cells.forEach((code, index) => {
        if (code === JUNGLE_CODE && !outer[index]) cells[index] = PATH_CODE;
    });
}

/**
 * @param {{cols: number, rows: number, seed: number, spawnFrame: {col, row, cols, rows}}} settings
 *   spawnFrame - where mutants emerge. The clearing sits inside it, with jungle
 *   between them, so nothing that can be built on a clearing is ever on the frame.
 * @returns {Terrain}
 */
export function generateJungle({cols, rows, seed, spawnFrame}) {
    new SeededRandom(seed); // refuses a seed that is not a uint32, which mixing would quietly change
    const rng = new SeededRandom(mixSeed(seed));
    const cells = new Uint8Array(cols * rows).fill(JUNGLE_CODE);
    const shift = () => rng.nextInt(-CLEARING.centreShift, CLEARING.centreShift);
    const center = {
        col: spawnFrame.col + Math.floor(spawnFrame.cols / 2) + shift(),
        row: spawnFrame.row + Math.floor(spawnFrame.rows / 2) + shift(),
    };
    const {width, height} = CLEARING.core;
    const core = {col: center.col - Math.floor(width / 2), row: center.row - Math.floor(height / 2), width, height};
    const limit = {
        left: spawnFrame.col + CLEARING.frameInset,
        right: spawnFrame.col + spawnFrame.cols - 1 - CLEARING.frameInset,
        top: spawnFrame.row + CLEARING.frameInset,
        bottom: spawnFrame.row + spawnFrame.rows - 1 - CLEARING.frameInset,
    };
    carveClearing(cells, cols, {center, core, limit}, rng);

    const path = tracePath(cols, rows, center, (col, row) => cells[row * cols + col], rng);
    for (const {col, row} of path) {
        for (const [dc, dr] of [[0, 0], [1, 0], [0, 1], [1, 1]]) cells[(row + dr) * cols + col + dc] = PATH_CODE;
    }
    openPockets(cells, cols, rows);
    const kindAt = (col, row) => KINDS[cells[row * cols + col]];
    const deposits = generateDeposits({cols, rows, seed, center, kindAt, spawnFrame});
    return new Terrain({seed, cols, rows, cells, center, core, path, deposits});
}
