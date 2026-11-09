/**
 * A jungle base with a Mine on the default seed's first deposit, for the TASK 026
 * tests. Everything goes through the real rules: the jungle under the Mine, its
 * dock and its road is cleared with Terrain.clear, the call HQ's workers make, and
 * roads and buildings are bought through BuildingPlacement.
 */
import assert from 'node:assert/strict';
import {Shift} from '../../src/core/shiftCycle.js';
import {TerrainKind} from '../../src/core/terrain.js';
import {WORLD_MAPS, createTerrain} from '../../src/core/worldMap.js';
import {createWorld} from '../soak/harness.js';

export const MAP = WORLD_MAPS.jungle;

const STEPS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Clear the jungle on these tiles, as workers would. */
export function clearAll(terrain, cells) {
    for (const {col, row} of cells) if (terrain.kindAt(col, row) === TerrainKind.JUNGLE) terrain.clear(col, row);
}

/** The Mine's footprint tiles for a core anchor. */
export const footprintTiles = ({col, row}) => [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dc, dr]) => ({col: col + dc, row: row + dr}));

/**
 * Lay a road from the connected network to `dock`, clearing jungle on the way:
 * the shortest way over tiles no building stands on, avoiding `avoid`.
 */
export function roadTo(w, terrain, dock, avoid = []) {
    const skip = new Set(avoid.map(({col, row}) => `${col},${row}`));
    const connected = new Set(w.roads.connectedTiles().map(({col, row}) => `${col},${row}`));
    const from = new Map([[`${dock.col},${dock.row}`, null]]);
    const queue = [dock];
    let end = null;
    for (let i = 0; i < queue.length && !end; i++) {
        const cell = queue[i];
        for (const [dc, dr] of STEPS) {
            const next = {col: cell.col + dc, row: cell.row + dr};
            const key = `${next.col},${next.row}`;
            if (from.has(key) || skip.has(key) || next.col < 0 || next.row < 0 || next.col >= w.grid.cols || next.row >= w.grid.rows) continue;
            if (connected.has(key)) {
                end = cell;
                from.set(key, cell);
                break;
            }
            if (w.grid.occupantAt(next.col, next.row) !== null) continue;
            from.set(key, cell);
            queue.push(next);
        }
    }
    assert.ok(end, 'a way for the road');
    const path = [];
    for (let cell = end; cell; cell = from.get(`${cell.col},${cell.row}`)) path.push(cell);
    clearAll(terrain, path);
    for (const cell of path) assert.equal(w.placement.placeRoad(cell).ok, true, `road at ${cell.col},${cell.row}`);
    return path;
}

/**
 * HQ in the middle of the clearing, a Plant beside it, and (unless `mine` is false)
 * a Mine on deposit-1 with its road, all in Day 0 of the ACTIVE cycle unless
 * `legacy`. Returns the world, the terrain and the deposit.
 */
export function mineBase({credits = 9000, mine = true, active = true, schedule = [], rng = null, plant = true} = {}) {
    const terrain = createTerrain(MAP, MAP.seed);
    const w = createWorld({requireHq: true, roads: true, resources: {credits, ap: 40}, schedule, rng, active, map: MAP, terrain});
    const {center} = terrain;
    assert.equal(w.place('hq', center.col, center.row).ok, true);
    if (plant) assert.equal(w.place('powerPlant', center.col - 4, center.row).ok, true); // supplies the Mine's 30
    const deposit = terrain.deposits[0];
    if (mine) {
        clearAll(terrain, [...footprintTiles(deposit.core), deposit.dock]);
        roadTo(w, terrain, deposit.dock, footprintTiles(deposit.core));
        const placed = w.place('mine', deposit.core.col, deposit.core.row);
        assert.equal(placed.ok, true, JSON.stringify(placed));
    }
    return {w, terrain, deposit};
}

/** Step whole ticks through the real cycle. */
export function run(w, ticks, onTick = () => {}) {
    for (let i = 0; i < ticks && w.cycle.active; i++) {
        if (w.cycle.stepTicks(1, w.tick) === 0) break;
        if (onTick(i) === true) break;
    }
}

/** From Day 0 to the first tick of Night 1, through Dusk. */
export function toNight(w) {
    if (w.cycle.shift === Shift.DAY) w.cycle.endDay();
    while (w.cycle.shift !== Shift.NIGHT) w.cycle.stepTicks(1, w.tick);
}
