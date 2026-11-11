/**
 * TASK 042: a campaign at its dawn hold, as plain data, and back. Pure: no Phaser,
 * no storage, no format version (TASK 042 stage 2 wraps this for persistence).
 *
 * A checkpoint is taken only at the dawn hold of the ACTIVE cycle: Day N at tick 0,
 * the Night settled, every Night-only system already cleared in that same tick.
 * It keeps what the campaign is (calendar, resources, ground, buildings, roads,
 * production, work in progress, random streams and id counters) and not what was
 * moving. Restoring it is Continue's normalization (TASK 041B, approach B), which
 * uninterrupted play never sees:
 *   - trucks are parked at their docks with no route; cargo they carried is
 *     discarded and counted lost, never refunded or paid (Logistics.restoreDawn);
 *   - the worker squad is whole and inside HQ; tile progress and repair orders stay;
 *   - protesters still running for the exit are gone; gates start closed.
 * Everything else is derived again by the systems themselves: routes, walk fields,
 * the HQ ring, power, the Night's wave plan and the Day's protest arrivals.
 */
import {PLAYER_ROAD} from './roads.js';
import {Shift} from './shiftCycle.js';
import {TerrainKind} from './terrain.js';
import {VisionState} from './vision.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;
const isUint32 = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const isCell = (v) => isObject(v) && Number.isInteger(v.col) && Number.isInteger(v.row);
const hasKeys = (v, keys) => isObject(v) && keys.every((k) => Object.hasOwn(v, k));
const isTally = (v, keys) => hasKeys(v, keys) && keys.every((k) => isCount(v[k]));
const LOGISTICS_TALLY = ['loads', 'credits', 'cargoLost'];

/**
 * TASK 043: the shape of a whole checkpoint, before any world is touched. Every
 * section, field type and count. What only a world can judge (a building on
 * jungle, an order for a building that does not stand) is left to the restore
 * methods, which throw; the caller then discards the world.
 * @returns {string | null} what is wrong, or null
 */
export function checkpointProblem(c) {
    if (!isObject(c)) return 'not an object';
    if (!Number.isSafeInteger(c.day) || c.day < 2) return 'day';
    if (c.lastSettlement !== null && !isObject(c.lastSettlement)) return 'lastSettlement';
    if (!isObject(c.economy) || !Number.isSafeInteger(c.economy.credits) || !isCount(c.economy.ap)) return 'economy';
    if (!isCount(c.pollution)) return 'pollution';
    if (!isObject(c.rng) || !isUint32(c.rng.seed) || !isUint32(c.rng.state)) return 'rng';
    if (c.terrain !== null && !(isObject(c.terrain) && isUint32(c.terrain.seed) && Array.isArray(c.terrain.cleared) && c.terrain.cleared.every(isCell))) return 'terrain';
    if (c.explored !== null && !(Array.isArray(c.explored) && c.explored.every(isCell))) return 'explored';
    const p = c.placement;
    if (!hasKeys(p, ['buildings', 'roads', 'nextId', 'loudspeakerNetwork']) || !Array.isArray(p.buildings) || !p.buildings.every(isObject)
        || !Array.isArray(p.roads) || !p.roads.every(isCell) || !Number.isSafeInteger(p.nextId) || typeof p.loudspeakerNetwork !== 'boolean') return 'placement';
    const l = c.logistics;
    if (!hasKeys(l, ['factories', 'trucks', 'night', 'lastNight', 'totals']) || !Array.isArray(l.factories) || !Array.isArray(l.trucks)) return 'logistics';
    if (!l.factories.every((f) => hasKeys(f, ['id', 'progress', 'stored', 'noRoute']) && typeof f.id === 'string' && isCount(f.progress) && isCount(f.stored))) return 'logistics factories';
    if (!l.trucks.every((t) => hasKeys(t, ['factoryId', 'respawning', 'hp', 'respawn', 'cargo', 'orphaned'])
        && typeof t.factoryId === 'string' && typeof t.respawning === 'boolean' && isCount(t.hp) && isCount(t.respawn) && isCount(t.cargo))) return 'logistics trucks';
    if (!isTally(l.night, LOGISTICS_TALLY) || !isTally(l.totals, LOGISTICS_TALLY) || (l.lastNight !== null && !isTally(l.lastNight, LOGISTICS_TALLY))) return 'logistics tallies';
    const w = c.workers;
    if (!hasKeys(w, ['flag', 'sent', 'progress', 'cleared', 'orders', 'repairSpent', 'repairRestored', 'nextId'])
        || (w.flag !== null && !isCell(w.flag)) || typeof w.sent !== 'boolean' || !Array.isArray(w.progress) || !Array.isArray(w.orders)
        || ![w.cleared, w.repairSpent, w.repairRestored, w.nextId].every(isCount)) return 'workers';
    if (!w.progress.every((t) => isCell(t) && isCount(t.ticks)) || !w.orders.every((o) => isObject(o) && typeof o.buildingId === 'string' && isCount(o.ticks))) return 'workers work';
    if (c.ecologists !== null && !(hasKeys(c.ecologists, ['rng', 'nextId', 'nextGroup', 'totals']) && isObject(c.ecologists.rng) && isObject(c.ecologists.totals))) return 'ecologists';
    if (!hasKeys(c.mutants, ['nextId', 'nextShellId'])) return 'mutants';
    if (!hasKeys(c.infantry, ['nextId', 'nextRocketId', 'totals'])) return 'infantry';
    if (!hasKeys(c.siegeCannons, ['nextShellId'])) return 'siegeCannons';
    return null;
}

/** Is the cycle at the dawn hold, the one moment a checkpoint may be taken? */
export function atDawnHold(cycle) {
    return cycle.timed && cycle.shift === Shift.DAY && !cycle.deployment && !cycle.fastForwarding
        && cycle.elapsedDayTicks === 0 && cycle.day >= 2;
}

/**
 * @param {object} world - cycle, economy, pollution, rng, grid, placement, roads, logistics,
 *   workers, mutants, infantry, siegeCannons; fog and ecologists where the map has them
 *   (terrain is the grid's, unless the world names its own)
 * @returns {object} detached, JSON-serializable
 */
export function captureDawn(world) {
    const {cycle, economy, pollution, rng, grid, fog = null, placement, roads, logistics, workers, ecologists = null, mutants, infantry, siegeCannons} = world;
    const terrain = world.terrain ?? grid.terrain ?? null;
    if (!atDawnHold(cycle)) throw new Error('a checkpoint is taken only at the dawn hold');
    const cleared = [];
    const explored = [];
    for (let row = 0; row < grid.rows; row++) {
        for (let col = 0; col < grid.cols; col++) {
            if (terrain?.kindAt(col, row) === TerrainKind.CLEARED) cleared.push({col, row});
            if (fog && fog.stateAt(col, row) !== VisionState.UNEXPLORED) explored.push({col, row});
        }
    }
    const data = {
        day: cycle.day,
        lastSettlement: cycle.lastSettlement,
        economy: economy.snapshot(),
        pollution: pollution.value,
        rng: rng.snapshot(),
        terrain: terrain ? {seed: terrain.seed, cleared} : null,
        explored: fog ? explored : null,
        placement: {...placement.checkpoint(), roads: roads.tiles().filter(({kind}) => kind === PLAYER_ROAD).map(({col, row}) => ({col, row}))},
        logistics: logistics.checkpoint(),
        workers: workers.checkpoint(),
        ecologists: ecologists ? ecologists.checkpoint() : null,
        mutants: mutants.checkpoint(),
        infantry: infantry.checkpoint(),
        siegeCannons: siegeCannons.checkpoint(),
    };
    return JSON.parse(JSON.stringify(data)); // detached, and exactly what storage would give back
}

/**
 * Put a checkpoint into a freshly built world whose cycle has not begun: in place
 * of cycle.begin(). Order matters: ground before anything stands on it, HQ and
 * roads before what needs them, buildings before what follows them. Any refusal
 * throws, and the caller must discard the world.
 */
export function restoreDawn(world, checkpoint) {
    const {cycle, economy, pollution, rng, grid, fog = null, placement, logistics, workers, ecologists = null, mutants, infantry, siegeCannons} = world;
    const terrain = world.terrain ?? grid.terrain ?? null;
    const c = checkpoint;
    const problem = checkpointProblem(c);
    if (problem) throw new TypeError(`invalid checkpoint: ${problem}`);
    if (Boolean(terrain) !== Boolean(c.terrain)) throw new Error('the checkpoint is for another kind of map');
    if (terrain) {
        if (c.terrain.seed !== terrain.seed) throw new Error(`the checkpoint is for world seed ${c.terrain.seed}, not ${terrain.seed}`);
        for (const {col, row} of c.terrain.cleared) {
            if (!terrain.clear(col, row)) throw new Error(`${col},${row} was never jungle`);
        }
    }
    if (fog && c.explored) fog.markExplored(c.explored);
    if (Boolean(ecologists) !== Boolean(c.ecologists)) throw new Error('the checkpoint does not match this world\'s protesters');

    placement.restoreCheckpoint(c.placement);
    cycle.restoreDawn({day: c.day, lastSettlement: c.lastSettlement}); // also gives the Day its AP
    economy.adjustCredits(c.economy.credits - economy.credits);
    economy.restoreAp(c.economy.ap);
    if (!Number.isSafeInteger(c.pollution) || c.pollution < pollution.value) throw new RangeError(`pollution ${c.pollution}`);
    pollution.add(c.pollution - pollution.value);
    rng.restore(c.rng);
    logistics.restoreDawn({day: c.day, ...c.logistics});
    workers.restoreDawn({day: c.day, ...c.workers});
    ecologists?.restoreDawn(c.ecologists);
    mutants.restoreDawn(c.mutants);
    infantry.restoreDawn(c.infantry);
    siegeCannons.restoreDawn(c.siegeCannons);
}
