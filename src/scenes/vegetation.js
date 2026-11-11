import {SeededRandom} from '../core/seededRandom.js';
import {mixSeed} from '../core/terrain.js';

/**
 * Where the jungle's plants stand (TASK 039). Pure and Phaser-free, so it is unit
 * tested; TerrainLayer paints the plan into its cached texture. Presentation only:
 * its own seeded stream, never the game's RNG, and no gameplay reads it.
 *
 * `tree atlas-0-sheet.png` is 640x64: ten plants, each alone in its own 64x64 cell,
 * standing on (or 1-3 px above) the cell's bottom. The rectangles below are each
 * plant's opaque bounds as measured on the sheet; `root` is the trunk's x inside
 * them, taken from the bottom rows. Drawn 1:1, a big tree is about 2x2 tiles.
 */
export const VEGETATION_SHEET = Object.freeze({key: 'papi-vegetation', path: 'assets/sprites/environment/tree atlas-0-sheet.png'});

export const PLANTS = Object.freeze([
    {name: 'fig', x: 5, y: 0, w: 53, h: 64, root: 23, kind: 'tree', weight: 4},
    {name: 'banyan', x: 64, y: 6, w: 63, h: 57, root: 32, kind: 'tree', weight: 3},
    {name: 'palm', x: 146, y: 7, w: 36, h: 55, root: 7, kind: 'palm', weight: 3},
    {name: 'grove', x: 203, y: 19, w: 40, h: 43, root: 18, kind: 'tree', weight: 4},
    {name: 'sapling', x: 268, y: 26, w: 37, h: 37, root: 18, kind: 'palm', weight: 4},
    {name: 'grass', x: 333, y: 43, w: 36, h: 18, root: 17, kind: 'shrub', weight: 5},
    {name: 'fern', x: 398, y: 42, w: 30, h: 21, root: 14, kind: 'shrub', weight: 5},
    {name: 'vine', x: 463, y: 41, w: 30, h: 21, root: 17, kind: 'shrub', weight: 3},
    {name: 'bulb', x: 527, y: 38, w: 29, h: 25, root: 14, kind: 'shrub', weight: 2},
    {name: 'log', x: 594, y: 43, w: 33, h: 20, root: 25, kind: 'shrub', weight: 1},
].map(Object.freeze));

export const VEGETATION = Object.freeze({
    tallChance: 0.6, // a tile grows a tree or palm this often
    shrubs: [1, 2], // and this many low plants
    overhang: 5, // px a plant may reach onto a tile it does not need: the jungle's ragged edge
    seedOffset: 4, // TerrainLayer's streams are seed + 1..3
});

const TALL = PLANTS.map((p, i) => i).filter((i) => PLANTS[i].kind !== 'shrub');
const LOW = PLANTS.map((p, i) => i).filter((i) => PLANTS[i].kind === 'shrub');
const byArea = (ids) => [...ids].sort((a, b) => PLANTS[b].w * PLANTS[b].h - PLANTS[a].w * PLANTS[a].h);

function pick(rng, ids) {
    let roll = rng.next() * ids.reduce((sum, i) => sum + PLANTS[i].weight, 0);
    for (const i of ids) {
        roll -= PLANTS[i].weight;
        if (roll < 0) return i;
    }
    return ids.at(-1);
}

/**
 * The tiles a drawn rectangle really covers: a tile it only grazes by `overhang`
 * px or less is not one of them.
 */
export function footprint({x, y, w, h}, tileSize, overhang = VEGETATION.overhang) {
    const first = (start) => Math.floor((start + overhang) / tileSize);
    const last = (end) => Math.floor((end - overhang - 1) / tileSize);
    const tiles = [];
    for (let row = first(y); row <= last(y + h); row++) {
        for (let col = first(x); col <= last(x + w); col++) tiles.push({col, row});
    }
    return tiles;
}

/** Every tile the drawn rectangle touches at all, overhang included. */
export function touched({x, y, w, h}, tileSize) {
    const tiles = [];
    for (let row = Math.floor(y / tileSize); row <= Math.floor((y + h - 1) / tileSize); row++) {
        for (let col = Math.floor(x / tileSize); col <= Math.floor((x + w - 1) / tileSize); col++) tiles.push({col, row});
    }
    return tiles;
}

/**
 * One plant per pick, rooted at a point inside its own tile, standing on it. A plant
 * is kept only if every tile of its footprint is jungle, trying smaller plants of
 * the same class first, so no plant stands over open ground. It stays drawn only
 * while all those tiles are still jungle (see visible()).
 * @param {{cols: number, rows: number, seed: number, tileSize: number, isJungle: (col: number, row: number) => boolean}} map
 * @returns {Array<{plant: number, x: number, y: number, w: number, h: number, baseX: number, baseY: number,
 *   col: number, row: number, footprint: Array<{col, row}>, stump: boolean}>} in draw order, back to front
 */
export function planVegetation({cols, rows, seed, tileSize, isJungle}) {
    const rng = new SeededRandom(mixSeed(seed + VEGETATION.seedOffset));
    const jungle = (col, row) => col >= 0 && row >= 0 && col < cols && row < rows && isJungle(col, row);
    const plants = [];
    const place = (choice, ids, col, row, baseX, baseY) => {
        for (const id of [choice, ...byArea(ids).filter((i) => i !== choice && PLANTS[i].w * PLANTS[i].h < PLANTS[choice].w * PLANTS[choice].h)]) {
            const {w, h, root, kind} = PLANTS[id];
            const rect = {x: baseX - root, y: baseY - h, w, h};
            const tiles = footprint(rect, tileSize);
            if (!tiles.every((t) => jungle(t.col, t.row))) continue;
            plants.push({plant: id, ...rect, baseX, baseY, col, row, footprint: tiles, stump: kind !== 'shrub'});
            return;
        }
    };
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            if (!jungle(col, row)) continue;
            const [left, top] = [col * tileSize, row * tileSize];
            if (rng.next() < VEGETATION.tallChance) {
                place(pick(rng, TALL), TALL, col, row, left + rng.nextInt(4, tileSize - 4), top + rng.nextInt(Math.round(tileSize * 0.55), tileSize - 1));
            }
            const shrubs = rng.nextInt(...VEGETATION.shrubs);
            for (let i = 0; i < shrubs; i++) {
                place(pick(rng, LOW), LOW, col, row, left + rng.nextInt(2, tileSize - 2), top + rng.nextInt(Math.round(tileSize * 0.4), tileSize - 1));
            }
        }
    }
    // Further south stands in front; a draw order fixed by the plan, never by chance.
    return plants
        .map((plant, order) => ({plant, order}))
        .sort((a, b) => a.plant.baseY - b.plant.baseY || a.plant.baseX - b.plant.baseX || a.order - b.order)
        .map(({plant}) => plant);
}

/** A plant shows while every tile it stands over is still jungle. */
export function visible(plant, isJungle) {
    return plant.footprint.every(({col, row}) => isJungle(col, row));
}

/** The trunks rooted in one tile, where its stumps go when it is cleared. Shrubs leave bare ground. */
export function stumpsIn(plants, col, row) {
    return plants.filter((p) => p.stump && p.col === col && p.row === row).map(({baseX, baseY}) => ({x: baseX, y: baseY}));
}
