/**
 * What a run is played on. Pure data, plus the one call that makes its terrain.
 *
 *   open    the original 24x16 battlefield, with no terrain. Layout fixtures, the
 *           soak suites and the older E2E suites all live here, and it is only
 *           reachable in TEST_MODE.
 *   jungle  a 48x32 world: a clearing, a dirt path and dense jungle. New games.
 *
 * `spawnFrame` is the preferred perimeter for jungle mutant entrances. Walking
 * speed and the Night's length were set for the open map: from the border of a
 * map this size late waves may not arrive. The preferred frame is the size of
 * the open map, at the same world pixels. As the colony clears it, entrances
 * move outward into connected jungle; with no jungle left, mutants enter from
 * outside the real map. Null keeps the original open-map border spawning.
 */
import {DEFAULT_SEED} from './seededRandom.js';
import {generateJungle} from './terrain.js';

export const TILE_SIZE = 32;

export const MapId = Object.freeze({OPEN: 'open', JUNGLE: 'jungle'});

export const DEFAULT_MAP = MapId.JUNGLE;

export const WORLD_MAPS = Object.freeze({
    [MapId.OPEN]: Object.freeze({id: MapId.OPEN, cols: 24, rows: 16, tileSize: TILE_SIZE, spawnFrame: null, seed: null}),
    [MapId.JUNGLE]: Object.freeze({
        id: MapId.JUNGLE,
        cols: 48,
        rows: 32,
        tileSize: TILE_SIZE,
        spawnFrame: Object.freeze({col: 12, row: 8, cols: 24, rows: 16}),
        seed: DEFAULT_SEED,
    }),
});

/** @returns {object|null} the map, or null for an unknown id */
export const getWorldMap = (id) => (Object.hasOwn(WORLD_MAPS, id) ? WORLD_MAPS[id] : null);

/** @returns {import('./terrain.js').Terrain|null} the map's terrain; the open map has none */
export function createTerrain(map, seed = map.seed) {
    if (map.id !== MapId.JUNGLE) return null;
    return generateJungle({cols: map.cols, rows: map.rows, seed, spawnFrame: map.spawnFrame});
}
