import {SeededRandom} from '../core/seededRandom.js';
import {TerrainKind, mixSeed} from '../core/terrain.js';
import {PLANTS, VEGETATION_SHEET, planVegetation, stumpsIn, touched, visible} from './vegetation.js';

const RESOLUTION = 2; // texels per world pixel, so a close zoom stays sharp
const DEPTH = -1; // under everything that exists in the world

const GROUND = '#59603a';
const GROUND_FLECKS = ['#4d5433', '#676d42', '#6e6a42', '#50583a'];
const GRID_LINE = 'rgba(205, 214, 170, 0.2)';
const JUNGLE_SHADE = 'rgba(8, 20, 10, 0.34)';
const JUNGLE_FLOOR = '#0f2d1a';
const DIRT = '#94703f';
const CLEARED_EARTH = 'rgba(122, 88, 48, 0.55)'; // raw earth where trees stood, not the clearing's grass
const STUMP = '#5b3b1c';
const STUMP_TOP = '#a07a46';
const DIRT_DARK = '#775731';
const DIRT_LIGHT = '#ad8a55';

const SHADE_DEPTH = 7; // px the jungle's shadow falls on open ground
const TRACK_RADIUS = 18; // px of each dab; the dabs together cover a track's two tiles
const TRACK_DABS = [[-14, -14], [14, -14], [-14, 14], [14, 14], [0, 0]];
const TRACK_FADE = 8; // tiles over which it thins out at the far end

/** Average out the track's corners, then round what is left. */
function smooth(points, reach = 3, passes = 2) {
    let line = points.map((_, i) => {
        const near = points.slice(Math.max(i - reach, 0), i + reach + 1);
        return {x: near.reduce((sum, p) => sum + p.x, 0) / near.length, y: near.reduce((sum, p) => sum + p.y, 0) / near.length};
    });
    for (let pass = 0; pass < passes; pass++) {
        const next = [line[0]];
        for (let i = 0; i < line.length - 1; i++) {
            const [a, b] = [line[i], line[i + 1]];
            next.push({x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25});
            next.push({x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75});
        }
        next.push(line.at(-1));
        line = next;
    }
    return line;
}

function paintGround(ctx, rng, width, height) {
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < (width * height) / 90; i++) {
        ctx.fillStyle = GROUND_FLECKS[rng.nextInt(0, GROUND_FLECKS.length - 1)];
        const size = 1 + rng.next() * 3;
        ctx.fillRect(rng.next() * width, rng.next() * height, size, size * 0.7);
    }
}

/**
 * Dabs on the track's own tiles, so the dirt covers exactly what the terrain says is
 * path and its edge is ragged where a stroke would be clean. It thins out as it
 * reaches the middle of the clearing, then wheel ruts follow the smoothed line.
 */
function paintPath(ctx, rng, terrain, tileSize) {
    const dab = (x, y, radius, color, alpha) => {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    };
    const fade = (i) => Math.min(1, (terrain.path.length - 1 - i) / TRACK_FADE);
    const jitter = (spread) => (rng.next() - 0.5) * spread;
    for (const [color, radius] of [[DIRT_DARK, TRACK_RADIUS + 3], [DIRT, TRACK_RADIUS]]) {
        terrain.path.forEach(({col, row}, i) => {
            const [x, y] = [(col + 1) * tileSize, (row + 1) * tileSize];
            const narrow = 0.25 + 0.75 * fade(i); // the dabs draw together, so the track never breaks up
            for (const [dx, dy] of TRACK_DABS) {
                dab(x + dx * narrow + jitter(6), y + dy * narrow + jitter(6), radius * (0.75 + 0.25 * fade(i)) * (0.9 + rng.next() * 0.2), color, 0.55 + 0.45 * fade(i));
            }
        });
    }
    terrain.path.forEach(({col, row}, i) => {
        dab((col + 1) * tileSize + jitter(36), (row + 1) * tileSize + jitter(36), 3 + rng.next() * 5, DIRT_LIGHT, 0.6 * fade(i));
    });
    ctx.globalAlpha = 1;

    const line = smooth(terrain.path.map(({col, row}) => ({x: (col + 1) * tileSize, y: (row + 1) * tileSize})));
    const ruts = line.slice(0, Math.floor(line.length * 0.8));
    ctx.strokeStyle = DIRT_DARK;
    ctx.lineWidth = 2;
    for (const offset of [-8, 8]) {
        ctx.beginPath();
        ruts.forEach(({x, y}, i) => {
            const [before, after] = [line[Math.max(i - 2, 0)], line[i + 2]];
            const [dx, dy] = [after.x - before.x, after.y - before.y];
            const length = Math.hypot(dx, dy) || 1;
            ctx.lineTo(x - (dy / length) * offset, y + (dx / length) * offset);
        });
        ctx.stroke();
    }
}

/** One open tile's line, and the jungle's shadow along any edge that faces jungle. */
function paintTileEdge(ctx, jungle, tileSize, col, row) {
    const [x, y] = [col * tileSize, row * tileSize];
    ctx.strokeStyle = GRID_LINE;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, tileSize, tileSize);
    ctx.fillStyle = JUNGLE_SHADE;
    if (jungle(col, row - 1)) ctx.fillRect(x, y, tileSize, SHADE_DEPTH);
    if (jungle(col, row + 1)) ctx.fillRect(x, y + tileSize - SHADE_DEPTH / 2, tileSize, SHADE_DEPTH / 2);
    if (jungle(col - 1, row)) ctx.fillRect(x, y, SHADE_DEPTH / 2, tileSize);
    if (jungle(col + 1, row)) ctx.fillRect(x + tileSize - SHADE_DEPTH / 2, y, SHADE_DEPTH / 2, tileSize);
}

/** Open ground shows its tiles, and the jungle's shadow falls on it along tile edges. */
function paintTileEdges(ctx, jungle, terrain, tileSize) {
    for (let row = 0; row < terrain.rows; row++) {
        for (let col = 0; col < terrain.cols; col++) {
            if (!jungle(col, row)) paintTileEdge(ctx, jungle, tileSize, col, row);
        }
    }
}

/**
 * Raw earth, and a stump where each tree or palm rooted in this tile stood (TASK
 * 039: the plan's trunks, so the same seed fells the same stumps). A tile that only
 * grew shrubs is left bare. The stump itself is the one drawn before the art.
 */
function paintCleared(ctx, tileSize, col, row, stumps) {
    const [x, y] = [col * tileSize, row * tileSize];
    ctx.fillStyle = CLEARED_EARTH;
    ctx.fillRect(x, y, tileSize, tileSize);
    for (const stump of stumps) {
        const sx = Math.min(Math.max(stump.x, x + 3), x + tileSize - 3); // the whole stump on its own tile
        const sy = Math.min(Math.max(stump.y - 2, y + 3), y + tileSize - 3);
        ctx.fillStyle = STUMP;
        ctx.beginPath();
        ctx.arc(sx, sy, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = STUMP_TOP;
        ctx.beginPath();
        ctx.arc(sx, sy - 0.5, 1.6, 0, Math.PI * 2);
        ctx.fill();
    }
}

// Ore: weathered rock lumps, never icons or blocks. Each colour is [shadow, body, facet].
const ORE = [
    ['#2c2118', '#8a5a2b', '#c08a4a'], // ochre
    ['#2a1b16', '#7c3b22', '#b0623a'], // rust
    ['#1e2224', '#5d6468', '#8f979a'], // slate
    ['#231f1a', '#6e5d44', '#a08c66'], // weathered stone
];
const HINT_STAIN = 'rgba(150, 92, 40, 0.16)'; // a faint rusty thinning of the canopy
const HINT_STONE = ['#7d6a52', '#8d8070', '#94643a'];

/** An irregular rock: a jittered polygon, with a shadow under it and a lit facet. */
function lump(ctx, rng, x, y, radius, [shadow, body, facet]) {
    const sides = 6 + rng.nextInt(0, 2);
    const turn = rng.next() * Math.PI;
    const points = Array.from({length: sides}, (_, i) => {
        const angle = turn + (i / sides) * Math.PI * 2;
        const reach = radius * (0.65 + rng.next() * 0.45);
        return [Math.cos(angle) * reach, Math.sin(angle) * reach * 0.8]; // rocks sit lower than they are wide
    });
    const shape = (dx, dy, scale) => {
        ctx.beginPath();
        points.forEach(([px, py], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, x + dx + px * scale, y + dy + py * scale));
        ctx.closePath();
        ctx.fill();
    };
    ctx.fillStyle = shadow;
    shape(1.5, 2, 1.08);
    ctx.fillStyle = body;
    shape(0, 0, 1);
    ctx.fillStyle = facet;
    shape(-radius * 0.22, -radius * 0.28, 0.45);
}

/**
 * The ore itself, on its own transparent picture of the whole map. Only cleared
 * deposit tiles ever show it (see clearTiles), so the canopy hides it until then.
 * Lumps vary per tile and spill over tile edges, so a deposit has no grid in it;
 * a tile at the cluster's edge gets fewer and smaller lumps, so the ore thins out.
 */
function paintOre(ctx, rng, terrain, tileSize) {
    const inDeposit = (col, row) => terrain.depositAt(col, row) !== null;
    for (const {tiles} of terrain.deposits) {
        for (const {col, row} of tiles) {
            const around = [[0, -1], [1, 0], [0, 1], [-1, 0]].filter(([dc, dr]) => inDeposit(col + dc, row + dr)).length;
            const count = 2 + around + rng.nextInt(0, 1);
            const scale = 0.55 + around * 0.12;
            for (let i = 0; i < count; i++) {
                const x = (col + 0.1 + rng.next() * 0.8) * tileSize;
                const y = (row + 0.15 + rng.next() * 0.8) * tileSize;
                lump(ctx, rng, x, y, (4 + rng.next() * 6) * scale, ORE[rng.nextInt(0, ORE.length - 1)]);
            }
        }
    }
}


/**
 * Surface signs in the jungle: a faint rusty stain and a stone or two, surest over
 * the seam core. Subtle on purpose; the fog hides them until the ground is explored,
 * and only clearing shows the ore. Planned once (same stream, same order as when
 * they were painted directly) so a repaint can draw them again.
 */
function planHints(rng, terrain, tileSize) {
    const hints = [];
    for (const {core, tiles} of terrain.deposits) {
        for (const {col, row} of tiles) {
            const inCore = col >= core.col && col <= core.col + 1 && row >= core.row && row <= core.row + 1;
            if (!inCore && rng.next() > 0.35) continue;
            const [x, y] = [(col + 0.2 + rng.next() * 0.6) * tileSize, (row + 0.2 + rng.next() * 0.6) * tileSize];
            const stain = {x, y, rx: 7 + rng.next() * 4, ry: 5 + rng.next() * 3, turn: rng.next() * Math.PI};
            const [sx, sy, radius] = [x + (rng.next() - 0.5) * 6, y + (rng.next() - 0.5) * 4, 1.6 + rng.next()];
            const color = HINT_STONE[rng.nextInt(0, HINT_STONE.length - 1)];
            hints.push({col, row, stain, stone: {x: sx, y: sy, radius, color, turn: rng.next() * Math.PI}});
        }
    }
    return hints;
}

function paintHint(ctx, {stain, stone}) {
    ctx.fillStyle = HINT_STAIN;
    ctx.beginPath();
    ctx.ellipse(stain.x, stain.y, stain.rx, stain.ry, stain.turn, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = stone.color;
    ctx.beginPath();
    ctx.ellipse(stone.x, stone.y, stone.radius, stone.radius * 0.7, stone.turn, 0, Math.PI * 2);
    ctx.fill();
}

/** The jungle's own dark floor, which shows between the plants and reads as unbuildable. */
function paintFloor(ctx, tileSize, col, row) {
    ctx.fillStyle = JUNGLE_FLOOR;
    ctx.fillRect(col * tileSize, row * tileSize, tileSize, tileSize);
}

/** One plant from the vegetation sheet, 1:1 at whole world pixels, so every source pixel is 2x2 texels. */
function paintPlant(ctx, sheet, {plant, x, y, w, h}) {
    const source = PLANTS[plant];
    ctx.drawImage(sheet, source.x, source.y, w, h, x, y, w, h);
}

/**
 * Per seed: the generated picture, its bare ground and the ore, painted once and only
 * ever read. Plain canvases, not Phaser textures, so they never take GPU memory
 * (TASK 040: on the jungle, three 24 MB textures nothing drew). Same lifetime as the
 * game's texture manager, which kept them before.
 * @type {Map<string, {picture: HTMLCanvasElement, ground: HTMLCanvasElement, ore: HTMLCanvasElement}>}
 */
const SOURCES = new Map();

function canvas(width, height) {
    const element = document.createElement('canvas');
    [element.width, element.height] = [width, height];
    return element;
}

/**
 * The terrain, painted once into a single texture and shown as a single image, so it
 * costs one quad a frame however dense the jungle is, and it cannot drift from the
 * grid, because it is one world object at the grid's origin. The same seed always
 * paints the same picture, and a restart reuses it. Presentation only: the shapes
 * come from its own generators, not the game's.
 *
 * TASK 039: the jungle is the vegetation sheet's plants (vegetation.js) on a dark
 * floor. Each plant may span several tiles, and shows only while every tile it
 * stands over is jungle, so clearing a tile fells every plant over it and a cleared
 * tile never stays under a felled plant's crown.
 */
export class TerrainLayer {
    #image;
    #terrain;
    #tileSize;
    #run; // this run's canvas texture: the only one ever painted on after generation
    #ground; // the generated ground and track, before tile lines and jungle
    #ore; // the deposits' lumps on a transparent picture, shown only where cleared
    #sheet; // the vegetation sheet, or null without it
    #plants; // the plan, in draw order
    #shown; // per plant: still drawn in this run
    #byFootprint = new Map(); // tile index -> plants that fall when it is cleared
    #byTouch = new Map(); // tile index -> plants drawn on it at all
    #hints;
    #revealed = new Set(); // deposit tiles whose ore has been painted
    #repainted = 0;

    /**
     * The generated picture and its bare ground are made once per seed (SOURCES) and
     * never touched again. Each run paints on its own copy, the only GPU texture, so a restart always shows the
     * jungle as it was generated, with nothing a previous run cleared. The picture is
     * the jungle as generated: a tile already cleared counts as jungle there, and
     * clearTiles repaints it.
     * @param {Phaser.Scene} scene
     * @param {import('../core/grid.js').Grid} grid
     * @param {import('../core/terrain.js').Terrain} terrain
     */
    constructor(scene, grid, terrain) {
        const key = `terrain-${terrain.cols}x${terrain.rows}-${terrain.seed}`;
        const {tileSize} = grid;
        const [width, height] = [terrain.cols * tileSize * RESOLUTION, terrain.rows * tileSize * RESOLUTION];
        const generated = (col, row) => {
            const kind = terrain.kindAt(col, row);
            return kind === TerrainKind.JUNGLE || kind === TerrainKind.CLEARED; // only jungle is ever cleared
        };
        this.#terrain = terrain;
        this.#tileSize = tileSize;
        this.#sheet = scene.textures.exists(VEGETATION_SHEET.key) ? scene.textures.get(VEGETATION_SHEET.key).getSourceImage() : null;
        this.#plants = this.#sheet ? planVegetation({cols: terrain.cols, rows: terrain.rows, seed: terrain.seed, tileSize, isJungle: generated}) : [];
        this.#shown = new Uint8Array(this.#plants.length).fill(1);
        const index = (map, tiles, id) => {
            for (const {col, row} of tiles) {
                const i = row * terrain.cols + col;
                if (!map.has(i)) map.set(i, []);
                map.get(i).push(id);
            }
        };
        this.#plants.forEach((plant, id) => {
            index(this.#byFootprint, plant.footprint, id);
            index(this.#byTouch, touched(plant, tileSize).filter(({col, row}) => terrain.kindAt(col, row) !== null), id);
        });
        this.#hints = planHints(new SeededRandom(mixSeed(terrain.seed + 2)), terrain, tileSize);

        if (!SOURCES.has(key)) {
            const [picture, ground, ore] = [canvas(width, height), canvas(width, height), canvas(width, height)];
            const ctx = picture.getContext('2d');
            const rng = new SeededRandom(mixSeed(terrain.seed + 1));
            ctx.scale(RESOLUTION, RESOLUTION);
            paintGround(ctx, rng, width / RESOLUTION, height / RESOLUTION);
            paintPath(ctx, rng, terrain, tileSize);
            ground.getContext('2d').drawImage(picture, 0, 0);
            paintTileEdges(ctx, generated, terrain, tileSize);
            for (let row = 0; row < terrain.rows; row++) {
                for (let col = 0; col < terrain.cols; col++) if (generated(col, row)) paintFloor(ctx, tileSize, col, row);
            }
            ctx.imageSmoothingEnabled = false;
            for (const plant of this.#plants) paintPlant(ctx, this.#sheet, plant);
            for (const hint of this.#hints) paintHint(ctx, hint);
            const oreCtx = ore.getContext('2d');
            oreCtx.scale(RESOLUTION, RESOLUTION);
            paintOre(oreCtx, new SeededRandom(mixSeed(terrain.seed + 3)), terrain, tileSize);
            SOURCES.set(key, {picture, ground, ore});
        }
        const sources = SOURCES.get(key);
        const runKey = `${key}-run`;
        if (scene.textures.exists(runKey)) scene.textures.remove(runKey);
        this.#run = scene.textures.createCanvas(runKey, width, height);
        this.#run.getContext().drawImage(sources.picture, 0, 0);
        this.#run.refresh();
        this.#ground = sources.ground;
        this.#ore = sources.ore;
        this.#image = scene.add.image(grid.originX, grid.originY, runKey).setOrigin(0, 0).setScale(1 / RESOLUTION).setDepth(DEPTH);
    }

    /**
     * Fell every plant standing over a cleared tile, then repaint, clipped to just
     * those tiles: the cleared tiles, every tile touching them (their shadow lines),
     * and every tile a felled plant was drawn on. Each is painted from scratch in the
     * generated order: bare ground, raw earth and stumps on cleared tiles, ore, tile
     * lines and shadow as the terrain now stands, the floor on jungle, then every
     * plant still standing and the hints. Nothing outside the clip changes.
     * @param {Array<{col: number, row: number}>} cells
     */
    clearTiles(cells) {
        const terrain = this.#terrain;
        const size = this.#tileSize;
        const texel = size * RESOLUTION;
        const jungle = (col, row) => terrain.kindAt(col, row) === TerrainKind.JUNGLE;
        const region = new Map();
        const add = (col, row) => {
            if (terrain.kindAt(col, row) !== null) region.set(row * terrain.cols + col, {col, row});
        };
        for (const {col, row} of cells) {
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) add(col + dc, row + dr);
            }
            for (const id of this.#byFootprint.get(row * terrain.cols + col) ?? []) {
                if (!this.#shown[id] || visible(this.#plants[id], jungle)) continue;
                this.#shown[id] = 0;
                for (const tile of touched(this.#plants[id], size)) add(tile.col, tile.row);
            }
        }
        const tiles = [...region.values()];
        const open = tiles.filter(({col, row}) => !jungle(col, row));
        const ctx = this.#run.getContext();
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.beginPath();
        for (const {col, row} of tiles) ctx.rect(col * texel, row * texel, texel, texel);
        ctx.clip();
        for (const {col, row} of open) ctx.drawImage(this.#ground, col * texel, row * texel, texel, texel, col * texel, row * texel, texel, texel);
        ctx.setTransform(RESOLUTION, 0, 0, RESOLUTION, 0, 0);
        for (const {col, row} of open) {
            if (terrain.kindAt(col, row) === TerrainKind.CLEARED) paintCleared(ctx, size, col, row, stumpsIn(this.#plants, col, row));
        }
        // Ore on every repainted open tile, so lumps spilling from a cleared deposit tile show too.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        for (const {col, row} of open) {
            ctx.drawImage(this.#ore, col * texel, row * texel, texel, texel, col * texel, row * texel, texel, texel);
            if (terrain.depositAt(col, row) !== null) this.#revealed.add(`${col},${row}`);
        }
        ctx.setTransform(RESOLUTION, 0, 0, RESOLUTION, 0, 0);
        for (const {col, row} of open) paintTileEdge(ctx, jungle, size, col, row);
        for (const {col, row} of tiles) if (jungle(col, row)) paintFloor(ctx, size, col, row);
        const standing = new Set();
        for (const key of region.keys()) for (const id of this.#byTouch.get(key) ?? []) if (this.#shown[id]) standing.add(id);
        ctx.imageSmoothingEnabled = false;
        for (const id of [...standing].sort((a, b) => a - b)) paintPlant(ctx, this.#sheet, this.#plants[id]);
        for (const hint of this.#hints) if (jungle(hint.col, hint.row)) paintHint(ctx, hint); // the clip keeps the rest
        ctx.restore();
        this.#run.refresh();
        this.#repainted += cells.length;
    }

    view() {
        const {x, y, depth, displayWidth: width, displayHeight: height, texture} = this.#image;
        let standing = 0;
        for (const shown of this.#shown) standing += shown;
        return {
            x, y, width, height, depth, texture: texture.key, repainted: this.#repainted, oreRevealed: this.#revealed.size,
            plants: this.#plants.length, plantsStanding: standing,
        };
    }
}
