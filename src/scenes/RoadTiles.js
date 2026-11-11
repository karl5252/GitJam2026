import {NORTH, EAST, SOUTH, WEST} from './WallTiles.js';

/**
 * Presentation-only road autotiling over `roads_v1.png` (TASK 039): 1024x64, 16
 * cells of 64x64 in one row, drawn at 0.5 so a cell covers its 32 px tile. Roads
 * use the walls' N1|E2|S4|W8 mask, but the sheet is NOT in mask order, so every
 * mask names its source cell here. Nothing here touches RoadNetwork or routing.
 *
 * The sheet as authored (cell: what it shows):
 *   0 lone patch        1 N-S with a patch     2 E stub (1 px short)  3 N-E corner
 *   4 N stub            5 N-S                  6 E-S corner (1 px)    7 N-E-S
 *   8 E-W               9 N-W                 10 E-W (W 1 px short)  11 N-E-W
 *  12 S-W              13 N-S-W (N, W 1 px)   14 E-S-W (W 1 px)      15 crossroads (N 1 px)
 * It has no S or W stub, so those mirror the N and E stubs. Cells 1 and 10 are
 * unused variants.
 */
export const ROAD_SOURCE = Object.freeze({key: 'papi-roads-src', path: 'assets/sprites/buildings/roads_v1.png'});
export const ROAD_TEXTURE = 'papi-roads'; // the 16 cells rebuilt in mask order, frame = mask
export const ROAD_CELL = 64;
export const ROAD_SCALE = 0.5;

/** mask -> source cell, mirrored where the sheet has no such cell. */
export const ROAD_CELLS = Object.freeze([
    {cell: 0}, // 0 isolated
    {cell: 4}, // 1 N
    {cell: 2}, // 2 E
    {cell: 3}, // 3 N+E
    {cell: 4, flipY: true}, // 4 S: the N stub mirrored
    {cell: 5}, // 5 N+S
    {cell: 6}, // 6 E+S
    {cell: 7}, // 7 N+E+S
    {cell: 2, flipX: true}, // 8 W: the E stub mirrored
    {cell: 9}, // 9 N+W
    {cell: 8}, // 10 E+W
    {cell: 11}, // 11 N+E+W
    {cell: 12}, // 12 S+W
    {cell: 13}, // 13 N+S+W
    {cell: 14}, // 14 E+S+W
    {cell: 15}, // 15 all four
].map(Object.freeze));

const STEPS = Object.freeze([[NORTH, 0, -1], [EAST, 1, 0], [SOUTH, 0, 1], [WEST, -1, 0]]);

/** The N/E/S/W mask of a road tile among a set of `col,row` keys. No diagonals. */
export function roadMask({col, row}, keys) {
    let mask = 0;
    for (const [bit, dc, dr] of STEPS) if (keys.has(`${col + dc},${row + dr}`)) mask |= bit;
    return mask;
}

/** Frame (= mask) per road tile, the HQ ring and player roads alike. */
export function roadFrames(tiles) {
    const keys = new Set(tiles.map(({col, row}) => `${col},${row}`));
    return tiles.map((tile) => roadMask(tile, keys));
}

/**
 * Some cells stop 1 px short of an edge they join, and two carry a stray row on an
 * edge they do not. On every joined side an empty edge pixel takes the pixel inside
 * it, so neighbouring tiles meet without a seam; on every open side an edge line
 * with nothing inside it is cleared. Only the outermost line ever changes.
 * @param {Uint8ClampedArray} data RGBA of one size x size cell, changed in place
 */
export function normalizeRoadEdges(data, size, mask) {
    const at = (x, y) => (y * size + x) * 4;
    const sides = [
        [NORTH, (i) => at(i, 0), (i) => at(i, 1)],
        [SOUTH, (i) => at(i, size - 1), (i) => at(i, size - 2)],
        [WEST, (i) => at(0, i), (i) => at(1, i)],
        [EAST, (i) => at(size - 1, i), (i) => at(size - 2, i)],
    ];
    for (const [bit, edge, inner] of sides) {
        if (mask & bit) {
            for (let i = 0; i < size; i++) {
                const [e, n] = [edge(i), inner(i)];
                if (data[e + 3] === 0 && data[n + 3] !== 0) for (let k = 0; k < 4; k++) data[e + k] = data[n + k];
            }
        } else {
            let innerEmpty = true;
            for (let i = 0; i < size && innerEmpty; i++) innerEmpty = data[inner(i) + 3] === 0;
            if (innerEmpty) for (let i = 0; i < size; i++) data[edge(i) + 3] = 0;
        }
    }
    return data;
}

/**
 * Rebuild the sheet in mask order on a canvas texture, once per game: mirrored
 * stubs, normalized edges, nearest filtering. Returns false without the source.
 * @param {Phaser.Scene} scene
 * @param {number} [nearest] Phaser's NEAREST filter mode
 */
export function buildRoadTexture(scene, nearest) {
    if (scene.textures.exists(ROAD_TEXTURE)) return true;
    if (!scene.textures.exists(ROAD_SOURCE.key)) return false;
    const source = scene.textures.get(ROAD_SOURCE.key).getSourceImage();
    const texture = scene.textures.createCanvas(ROAD_TEXTURE, ROAD_CELL * ROAD_CELLS.length, ROAD_CELL);
    const ctx = texture.getContext();
    ctx.imageSmoothingEnabled = false;
    ROAD_CELLS.forEach(({cell, flipX = false, flipY = false}, mask) => {
        const x = mask * ROAD_CELL;
        ctx.save();
        ctx.translate(x + (flipX ? ROAD_CELL : 0), flipY ? ROAD_CELL : 0);
        ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
        ctx.drawImage(source, cell * ROAD_CELL, 0, ROAD_CELL, ROAD_CELL, 0, 0, ROAD_CELL, ROAD_CELL);
        ctx.restore();
        const image = ctx.getImageData(x, 0, ROAD_CELL, ROAD_CELL);
        normalizeRoadEdges(image.data, ROAD_CELL, mask);
        ctx.putImageData(image, x, 0);
        texture.add(mask, 0, x, 0, ROAD_CELL, ROAD_CELL);
    });
    texture.refresh();
    if (nearest !== undefined) texture.setFilter?.(nearest);
    return true;
}
