import {SeededRandom} from '../core/seededRandom.js';
import {TerrainKind, mixSeed} from '../core/terrain.js';

const RESOLUTION = 2; // texels per world pixel, so a close zoom stays sharp
const DEPTH = -1; // under everything that exists in the world

const GROUND = '#59603a';
const GROUND_FLECKS = ['#4d5433', '#676d42', '#6e6a42', '#50583a'];
const GRID_LINE = 'rgba(205, 214, 170, 0.2)';
const JUNGLE_SHADE = 'rgba(8, 20, 10, 0.34)';
const JUNGLE_FLOOR = '#0f2d1a';
const JUNGLE_EDGE = '#0a2013';
const CANOPY = [
    ['#113a20', '#1a5230', '#2a6f3e'],
    ['#0f3a26', '#17553a', '#277350'],
    ['#163f1c', '#25602a', '#3d8036'],
    ['#123720', '#1d4f2b', '#336e34'],
];
const DIRT = '#94703f';
const DIRT_DARK = '#775731';
const DIRT_LIGHT = '#ad8a55';

const SHADE_DEPTH = 7; // px the jungle's shadow falls on open ground
const CROWNS_PER_TILE = 6;
const TRACK_RADIUS = 18; // px of each dab; the dabs together cover a track's two tiles
const TRACK_DABS = [[-14, -14], [14, -14], [-14, 14], [14, 14], [0, 0]];
const TRACK_FADE = 8; // tiles over which it thins out at the far end
const LOBES = 5; // a crown is a clump of foliage, not a ball

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

/** Open ground shows its tiles, and the jungle's shadow falls on it along tile edges. */
function paintTileEdges(ctx, terrain, tileSize) {
    const jungle = (col, row) => terrain.kindAt(col, row) === TerrainKind.JUNGLE;
    ctx.strokeStyle = GRID_LINE;
    ctx.lineWidth = 1;
    ctx.fillStyle = JUNGLE_SHADE;
    for (let row = 0; row < terrain.rows; row++) {
        for (let col = 0; col < terrain.cols; col++) {
            if (jungle(col, row)) continue;
            const [x, y] = [col * tileSize, row * tileSize];
            ctx.strokeRect(x, y, tileSize, tileSize);
            if (jungle(col, row - 1)) ctx.fillRect(x, y, tileSize, SHADE_DEPTH);
            if (jungle(col, row + 1)) ctx.fillRect(x, y + tileSize - SHADE_DEPTH / 2, tileSize, SHADE_DEPTH / 2);
            if (jungle(col - 1, row)) ctx.fillRect(x, y, SHADE_DEPTH / 2, tileSize);
            if (jungle(col + 1, row)) ctx.fillRect(x + tileSize - SHADE_DEPTH / 2, y, SHADE_DEPTH / 2, tileSize);
        }
    }
}

/**
 * Overlapping tree crowns, painted row by row so nearer trees cover farther ones.
 * They are clipped to jungle tiles, so the canopy is continuous inside the jungle and
 * ends exactly on the tile that stops building, at any zoom.
 */
function paintCanopy(ctx, rng, terrain, tileSize) {
    const tiles = [];
    for (let row = 0; row < terrain.rows; row++) {
        for (let col = 0; col < terrain.cols; col++) {
            if (terrain.kindAt(col, row) === TerrainKind.JUNGLE) tiles.push({col, row});
        }
    }
    ctx.save();
    ctx.beginPath();
    for (const {col, row} of tiles) ctx.rect(col * tileSize, row * tileSize, tileSize, tileSize);
    ctx.clip();
    ctx.fillStyle = JUNGLE_FLOOR;
    ctx.fillRect(0, 0, terrain.cols * tileSize, terrain.rows * tileSize);
    const circle = (x, y, radius, color) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    };
    for (const {col, row} of tiles) {
        for (let i = 0; i < CROWNS_PER_TILE; i++) {
            const x = (col + rng.next() * 1.2 - 0.1) * tileSize;
            const y = (row + rng.next() * 1.2 - 0.1) * tileSize;
            const radius = 7 + rng.next() * 8;
            const [dark, mid, light] = CANOPY[rng.nextInt(0, CANOPY.length - 1)];
            const lobes = Array.from({length: LOBES}, () => ({
                x: x + (rng.next() - 0.5) * radius * 1.3,
                y: y + (rng.next() - 0.5) * radius * 1.3,
                radius: radius * (0.45 + rng.next() * 0.3),
            }));
            for (const lobe of lobes) circle(lobe.x + 1.5, lobe.y + 2.5, lobe.radius, JUNGLE_EDGE);
            for (const lobe of lobes) circle(lobe.x, lobe.y, lobe.radius, dark);
            for (const lobe of lobes) circle(lobe.x - lobe.radius * 0.18, lobe.y - lobe.radius * 0.22, lobe.radius * 0.7, mid);
            const top = lobes[0];
            circle(top.x - top.radius * 0.3, top.y - top.radius * 0.35, top.radius * 0.36, light);
        }
    }
    ctx.restore();
}

/**
 * The terrain, painted once into a single texture and shown as a single image, so it
 * costs one quad a frame however dense the jungle is, and it cannot drift from the
 * grid, because it is one world object at the grid's origin. The same seed always
 * paints the same picture, and a restart reuses it. Presentation only: the shapes
 * come from its own generator, not the game's.
 */
export class TerrainLayer {
    #image;

    /**
     * @param {Phaser.Scene} scene
     * @param {import('../core/grid.js').Grid} grid
     * @param {import('../core/terrain.js').Terrain} terrain
     */
    constructor(scene, grid, terrain) {
        const key = `terrain-${terrain.cols}x${terrain.rows}-${terrain.seed}`;
        if (!scene.textures.exists(key)) {
            const {tileSize} = grid;
            const [width, height] = [terrain.cols * tileSize, terrain.rows * tileSize];
            const texture = scene.textures.createCanvas(key, width * RESOLUTION, height * RESOLUTION);
            const ctx = texture.getContext();
            const rng = new SeededRandom(mixSeed(terrain.seed + 1));
            ctx.scale(RESOLUTION, RESOLUTION);
            paintGround(ctx, rng, width, height);
            paintPath(ctx, rng, terrain, tileSize);
            paintTileEdges(ctx, terrain, tileSize);
            paintCanopy(ctx, rng, terrain, tileSize);
            texture.refresh();
        }
        this.#image = scene.add.image(grid.originX, grid.originY, key).setOrigin(0, 0).setScale(1 / RESOLUTION).setDepth(DEPTH);
    }

    view() {
        const {x, y, depth, displayWidth: width, displayHeight: height, texture} = this.#image;
        return {x, y, width, height, depth, texture: texture.key};
    }
}
