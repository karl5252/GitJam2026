import test from 'node:test';
import assert from 'node:assert/strict';
import {TerrainKind} from '../../src/core/terrain.js';
import {WORLD_MAPS, MapId, createTerrain} from '../../src/core/worldMap.js';
import {PLANTS, footprint, planVegetation, stumpsIn, touched, visible} from '../../src/scenes/vegetation.js';
import {decodePalettePng} from './pngDecode.js';

const TILE = 32;
const sheet = decodePalettePng(new URL('../../public/assets/sprites/environment/tree atlas-0-sheet.png', import.meta.url));
const map = (seed = 731) => createTerrain(WORLD_MAPS[MapId.JUNGLE], seed); // the map a new game gets
const plan = (terrain) => planVegetation({
    cols: terrain.cols, rows: terrain.rows, seed: terrain.seed, tileSize: TILE,
    isJungle: (col, row) => terrain.kindAt(col, row) === TerrainKind.JUNGLE,
});

test('the vegetation sheet is 640x64, and each plant\'s rectangle is exactly its opaque bounds', () => {
    assert.deepEqual([sheet.width, sheet.height], [640, 64]);
    const opaque = (x, y) => sheet.data[(y * sheet.width + x) * 4 + 3] > 0;
    PLANTS.forEach(({name, x, y, w, h}, i) => {
        assert.ok(x >= i * 64 && x + w <= (i + 1) * 64, `${name} stays in cell ${i}`);
        let [minX, minY, maxX, maxY] = [Infinity, Infinity, -1, -1];
        for (let py = 0; py < 64; py++) {
            for (let px = i * 64; px < (i + 1) * 64; px++) {
                if (!opaque(px, py)) continue;
                [minX, minY, maxX, maxY] = [Math.min(minX, px), Math.min(minY, py), Math.max(maxX, px), Math.max(maxY, py)];
            }
        }
        assert.deepEqual({x, y, w, h}, {x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1}, name);
    });
});

test('the same seed plans the same jungle, and another seed another', () => {
    const terrain = map();
    assert.deepEqual(plan(terrain), plan(map()));
    assert.notDeepEqual(plan(terrain), plan(map(732)));
});

test('every plant stands on its own jungle tile, at whole pixels, and only over jungle', () => {
    const terrain = map();
    const plants = plan(terrain);
    assert.ok(plants.length > 1000, `a dense jungle: ${plants.length}`);
    for (const p of plants) {
        assert.equal(terrain.kindAt(p.col, p.row), TerrainKind.JUNGLE);
        assert.deepEqual([Math.floor(p.baseX / TILE), Math.floor(p.baseY / TILE)], [p.col, p.row], 'rooted in its own tile');
        for (const v of [p.x, p.y, p.w, p.h]) assert.ok(Number.isInteger(v));
        assert.ok(p.footprint.every(({col, row}) => terrain.kindAt(col, row) === TerrainKind.JUNGLE));
        assert.ok(p.footprint.some(({col, row}) => col === p.col && row === p.row), 'its own tile is part of it');
    }
    const kinds = new Set(plants.map((p) => PLANTS[p.plant].kind));
    assert.deepEqual([...kinds].sort(), ['palm', 'shrub', 'tree']);
    const big = plants.filter((p) => p.footprint.length >= 4).length;
    assert.ok(big > 100, `large trees overlap several tiles: ${big}`);
});

test('draw order is back to front: further south is drawn later', () => {
    const plants = plan(map());
    for (let i = 1; i < plants.length; i++) assert.ok(plants[i].baseY >= plants[i - 1].baseY);
});

test('a plant reaches no more than the overhang onto a tile outside its footprint', () => {
    const plants = plan(map());
    for (const p of plants) {
        const inside = new Set(p.footprint.map(({col, row}) => `${col},${row}`));
        for (const {col, row} of touched(p, TILE)) {
            if (inside.has(`${col},${row}`)) continue;
            const overlapX = Math.min(p.x + p.w, (col + 1) * TILE) - Math.max(p.x, col * TILE);
            const overlapY = Math.min(p.y + p.h, (row + 1) * TILE) - Math.max(p.y, row * TILE);
            assert.ok(Math.min(overlapX, overlapY) <= 5, `${PLANTS[p.plant].name} over (${col},${row})`);
        }
    }
});

test('footprint: grazing a tile by 5 px or less does not count, 6 px does', () => {
    // x 30..68: 2 px on tile 0, all of tile 1, 5 px on tile 2.
    assert.deepEqual(footprint({x: 30, y: 0, w: 39, h: 32}, TILE), [{col: 1, row: 0}]);
    // x 26..69: 6 px on tile 0 and on tile 2.
    assert.deepEqual(footprint({x: 26, y: 0, w: 44, h: 32}, TILE), [{col: 0, row: 0}, {col: 1, row: 0}, {col: 2, row: 0}]);
});

test('clearing a tile fells every plant over it, and only those; stumps are its own trunks', () => {
    const terrain = map();
    const plants = plan(terrain);
    const target = plants.find((p) => PLANTS[p.plant].kind === 'tree' && p.footprint.length >= 4);
    const cleared = target.footprint.find(({col, row}) => col !== target.col || row !== target.row) ?? target.footprint[0];
    const jungle = (col, row) => terrain.kindAt(col, row) === TerrainKind.JUNGLE;
    const before = plants.map((p) => visible(p, jungle));
    assert.ok(before.every(Boolean), 'the whole generated jungle stands');
    assert.ok(terrain.clear(cleared.col, cleared.row));
    const after = plants.map((p) => visible(p, jungle));
    plants.forEach((p, i) => {
        const over = p.footprint.some(({col, row}) => col === cleared.col && row === cleared.row);
        assert.equal(after[i], !over);
    });
    assert.equal(after[plants.indexOf(target)], false);
    const stumps = stumpsIn(plants, cleared.col, cleared.row);
    const trunks = plants.filter((p) => p.col === cleared.col && p.row === cleared.row && PLANTS[p.plant].kind !== 'shrub');
    assert.equal(stumps.length, trunks.length);
    assert.deepEqual(stumpsIn(plants, cleared.col, cleared.row), stumpsIn(plan(map()), cleared.col, cleared.row), 'deterministic');
});
