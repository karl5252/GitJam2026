// testShadow/layoutSnapshot.js
//
// TEST_MODE-only layout fixtures: window.__qa.layout.export() and .load().
// A snapshot is a layout, not a save: no Credits, AP, Day, HP, enemies or RNG.
//
// Building order is data. Target ties, blockers and turret firing all follow
// the building list, so the array keeps creation order and is never sorted.
// Instance ids are left out: only list order affects combat, and ids are only
// ever compared for equality. Roads have no such effect and sort canonically.
//
// Loading replays the snapshot through the real placement and road rules. A
// dry run on throwaway objects catches anything invalid before the live game
// is touched. That cannot prove the live replay succeeds, so its result is
// checked too, and the caller must discard the run if it reports `applied`.

import {HQ_TYPE, getBuildingType} from '../core/buildingTypes.js';
import {BuildingPlacement} from '../core/buildingPlacement.js';
import {Economy} from '../core/economy.js';
import {Grid} from '../core/grid.js';
import {HQ_RING, PLAYER_ROAD, RoadNetwork, hqRingCells} from '../core/roads.js';
import {Shift} from '../core/shiftCycle.js';

export const LAYOUT_FORMAT = 'papi-layout';
export const LAYOUT_VERSION = 1;

export const LayoutFailure = Object.freeze({
    NOT_STARTED: 'not-started',
    ROADS_UNAVAILABLE: 'roads-unavailable',
    NOT_DAY: 'not-day',
    NOT_FRESH: 'not-fresh',
    UNSUPPORTED_SCHEMA: 'unsupported-schema',
    INVALID_SNAPSHOT: 'invalid-snapshot',
    GRID_MISMATCH: 'grid-mismatch',
    UNKNOWN_BUILDING_TYPE: 'unknown-building-type',
    HQ_REQUIRED: 'hq-required',
    INVALID_HQ_RING: 'invalid-hq-ring',
    APPLY_FAILED: 'apply-failed',
});

const TOP_LEVEL = ['format', 'version', 'grid', 'buildings', 'roads'];
const BUILDING_FIELDS = ['type', 'col', 'row', 'enabled'];
const ROAD_FIELDS = ['col', 'row', 'kind'];

const fail = (reason, detail) => ({ok: false, reason, ...(detail ? {detail} : {})});
const hasExactly = (value, fields) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
const isCell = ({col, row}) => Number.isInteger(col) && Number.isInteger(row);
const byCell = (cols) => (a, b) => (a.row * cols + a.col) - (b.row * cols + b.col);

/** A deterministic snapshot of the live layout. */
export function exportLayout({grid, placement, roads}) {
    return {
        format: LAYOUT_FORMAT,
        version: LAYOUT_VERSION,
        grid: {cols: grid.cols, rows: grid.rows},
        buildings: placement.buildings().map(({type, col, row, enabled}) => ({type, col, row, enabled})),
        roads: roads.tiles().map(({col, row, kind}) => ({col, row, kind})),
    };
}

/** Shape checks only. Spatial rules are left to the real placement code. */
function checkShape(snapshot) {
    if (snapshot === null || typeof snapshot !== 'object') return fail(LayoutFailure.INVALID_SNAPSHOT, 'not an object');
    if (snapshot.format !== LAYOUT_FORMAT || snapshot.version !== LAYOUT_VERSION) {
        return fail(LayoutFailure.UNSUPPORTED_SCHEMA, `${snapshot.format} v${snapshot.version}`);
    }
    if (!hasExactly(snapshot, TOP_LEVEL) || !hasExactly(snapshot.grid, ['cols', 'rows'])
        || !Array.isArray(snapshot.buildings) || !Array.isArray(snapshot.roads)) {
        return fail(LayoutFailure.INVALID_SNAPSHOT, 'unexpected fields');
    }
    for (const building of snapshot.buildings) {
        if (!hasExactly(building, BUILDING_FIELDS) || !isCell(building) || typeof building.enabled !== 'boolean') {
            return fail(LayoutFailure.INVALID_SNAPSHOT, `bad building ${JSON.stringify(building)}`);
        }
        if (!getBuildingType(building.type)) return fail(LayoutFailure.UNKNOWN_BUILDING_TYPE, String(building.type));
    }
    for (const road of snapshot.roads) {
        if (!hasExactly(road, ROAD_FIELDS) || !isCell(road) || ![HQ_RING, PLAYER_ROAD].includes(road.kind)) {
            return fail(LayoutFailure.INVALID_SNAPSHOT, `bad road ${JSON.stringify(road)}`);
        }
    }
    return {ok: true};
}

/** The HQ must come first, as it does in real play, with exactly its own ring. */
function checkRing(snapshot) {
    const [first, ...rest] = snapshot.buildings;
    if (first?.type !== HQ_TYPE || rest.some((b) => b.type === HQ_TYPE)) return fail(LayoutFailure.HQ_REQUIRED);
    const {width, height} = getBuildingType(HQ_TYPE);
    const key = ({col, row}) => `${col},${row}`;
    const expected = hqRingCells({col: first.col, row: first.row, width, height}).map(key).sort();
    const actual = snapshot.roads.filter((road) => road.kind === HQ_RING).map(key).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) return fail(LayoutFailure.INVALID_HQ_RING);
    return {ok: true};
}

const pointerCell = ({type, col, row}) => {
    const {width, height} = getBuildingType(type);
    return {col: col + Math.floor((width - 1) / 2), row: row + Math.floor((height - 1) / 2)};
};

/**
 * Replay a checked snapshot through the real rules: HQ, which brings its ring,
 * then player roads, then the other buildings in their original order. The
 * purchases are funded first, so Credits end where they began and AP is put
 * back. `faultAfter` is a QA hook that simulates a failure after N buildings.
 * @returns {{ok: true} | {ok: false, reason: string, detail?: string}}
 */
function replay({placement, roads, economy}, snapshot, faultAfter = null) {
    const cost = snapshot.buildings.reduce((sum, {type}) => {
        const {credits, ap} = getBuildingType(type).cost;
        return {credits: sum.credits + credits, ap: sum.ap + ap};
    }, {credits: 0, ap: 0});
    const startingAp = economy.ap;
    economy.adjustCredits(cost.credits);
    economy.restoreAp(cost.ap);

    const place = (building) => {
        if (!placement.select(building.type)) return fail(LayoutFailure.HQ_REQUIRED, building.type);
        const result = placement.placeAt(pointerCell(building));
        placement.cancel();
        if (!result.ok) return fail(result.reason, `${building.type} at ${building.col},${building.row}`);
        const landed = result.building;
        if (landed.col !== building.col || landed.row !== building.row) throw new Error(`${building.type} moved`);
        if (!building.enabled) {
            const switched = placement.setEnabled(landed.id, false);
            if (!switched.ok) return fail(switched.reason, `${building.type} cannot be disabled`);
        }
        return {ok: true};
    };

    const [hq, ...others] = snapshot.buildings;
    const placedHq = place(hq);
    if (!placedHq.ok) return placedHq;
    for (const road of snapshot.roads.filter(({kind}) => kind === PLAYER_ROAD)) {
        const restored = roads.restoreTile(road);
        if (!restored.ok) return fail(restored.reason, `road at ${road.col},${road.row}`);
    }
    let placed = 1;
    for (const building of others) {
        if (faultAfter === placed) throw new Error('simulated failure during layout load');
        const result = place(building);
        if (!result.ok) return result;
        placed++;
    }
    economy.restoreAp(startingAp);
    return {ok: true};
}

/** Validate against throwaway objects, so nothing live can be touched. */
function dryRun(snapshot, grid) {
    const scratchGrid = new Grid({cols: grid.cols, rows: grid.rows, tileSize: grid.tileSize});
    const economy = new Economy({credits: 0, ap: 0});
    const roads = new RoadNetwork({grid: scratchGrid});
    const placement = new BuildingPlacement(scratchGrid, economy, {requireHq: true, roads});
    return replay({placement, roads, economy}, snapshot);
}

const canonical = (snapshot) => ({
    format: snapshot.format,
    version: snapshot.version,
    grid: {cols: snapshot.grid.cols, rows: snapshot.grid.rows},
    buildings: snapshot.buildings.map(({type, col, row, enabled}) => ({type, col, row, enabled})),
    roads: [...snapshot.roads].sort(byCell(snapshot.grid.cols)).map(({col, row, kind}) => ({col, row, kind})),
});

/**
 * Load a snapshot into a fresh Day. Nothing live changes unless every check
 * and the dry run pass. A result with `applied: true` and `ok: false` means the
 * live replay failed partway, so the caller must discard the run.
 * @returns {{ok: true, buildings: number, roads: number}
 *          | {ok: false, reason: string, detail?: string, applied?: true}}
 */
export function loadLayout(world, snapshot, {faultAfter = null} = {}) {
    const {grid, placement, roads, economy, cycle} = world;
    if (!placement) return fail(LayoutFailure.NOT_STARTED);
    if (!roads) return fail(LayoutFailure.ROADS_UNAVAILABLE);
    if (cycle.shift !== Shift.DAY) return fail(LayoutFailure.NOT_DAY);
    if (placement.hqBuilt || placement.buildings().length > 0) return fail(LayoutFailure.NOT_FRESH);

    const shape = checkShape(snapshot);
    if (!shape.ok) return shape;
    if (snapshot.grid.cols !== grid.cols || snapshot.grid.rows !== grid.rows) return fail(LayoutFailure.GRID_MISMATCH);
    const ring = checkRing(snapshot);
    if (!ring.ok) return ring;
    const rehearsal = dryRun(snapshot, grid);
    if (!rehearsal.ok) return rehearsal;

    const discard = (detail) => ({...fail(LayoutFailure.APPLY_FAILED, detail), applied: true});
    try {
        const result = replay(world, snapshot, faultAfter);
        if (!result.ok) return discard(`${result.reason}: ${result.detail ?? ''}`);
    } catch (error) {
        return discard(error.message);
    }
    if (JSON.stringify(exportLayout(world)) !== JSON.stringify(canonical(snapshot))) return discard('layout differs after load');
    return {ok: true, buildings: snapshot.buildings.length, roads: snapshot.roads.length};
}

/**
 * The window.__qa.layout controls. A failed live load restarts the scene,
 * which is the game's existing full reset, so a partial base can never be
 * played. The restart happens after this call returns.
 */
export function createLayoutQa(scene) {
    const world = () => ({
        grid: scene.grid,
        placement: scene.placement,
        roads: scene.roads,
        economy: scene.economy,
        cycle: scene.cycle,
    });
    return {
        export: () => (scene.roads ? exportLayout(world()) : null),
        load: (snapshot, options) => {
            scene.exitPlacementMode();
            const result = loadLayout(world(), snapshot, options);
            if (result.ok) scene.handleLayoutLoaded();
            else if (result.applied) scene.scene.restart();
            return result;
        },
    };
}
