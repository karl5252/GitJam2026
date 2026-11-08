/**
 * Shared soak harness. It builds the REAL domain objects and ticks them in the
 * same order as GameScene.stepSimulation; there is no second combat simulation.
 * browser.soak.spec.js compares digests from this harness against Chromium,
 * which is what guards the copied tick order against drift.
 *
 * `openConstruction` is a SYNTHETIC workload setting: it opens the harness's
 * own construction gate so destroyed buildings can be rebuilt mid-night through
 * the real placeAt(). It keeps combat going under load. It says nothing about
 * normal Day/Night construction rules or the economy, and must never be used
 * to validate them.
 */
import {createHash} from 'node:crypto';
import {Autocannons} from '../../src/core/autocannons.js';
import {BuildingPlacement} from '../../src/core/buildingPlacement.js';
import {getBuildingType} from '../../src/core/buildingTypes.js';
import {Economy, STARTING_RESOURCES} from '../../src/core/economy.js';
import {Gates} from '../../src/core/gates.js';
import {Grid} from '../../src/core/grid.js';
import {Infantry} from '../../src/core/infantry.js';
import {Logistics} from '../../src/core/logistics.js';
import {BRUTE, Mutants, MUTANT, SPITTER, distanceToFootprint} from '../../src/core/mutants.js';
import {Pollution} from '../../src/core/pollution.js';
import {RoadNetwork} from '../../src/core/roads.js';
import {SeededRandom} from '../../src/core/seededRandom.js';
import {settleNight} from '../../src/core/settlement.js';
import {DAY_TICKS, DUSK_TICKS, ShiftCycle} from '../../src/core/shiftCycle.js';
import {SimulationClock} from '../../src/core/simulationClock.js';
import {AUTOCANNON} from '../../src/core/autocannons.js';
import {SiegeCannons, SIEGE} from '../../src/core/siegeCannons.js';
import {Workers} from '../../src/core/workers.js';
import {nightPlan} from '../../src/core/waves.js';

const GRID = {cols: 24, rows: 16, tileSize: 32, originX: 256, originY: 104};
const CANVAS = {width: 1280, height: 720};

/** The Grid settings GameScene gives a map. */
const gridFor = ({cols, rows, tileSize}, terrain) => ({
    cols,
    rows,
    tileSize,
    originX: (CANVAS.width - cols * tileSize) / 2,
    originY: (CANVAS.height - rows * tileSize) / 2,
    terrain,
});

/**
 * @param {{seed?: number, schedule?: readonly number[]|null, resources?: {credits: number, ap: number},
 *          openConstruction?: boolean, requireHq?: boolean, roads?: boolean, pollution?: number,
 *          firstNight?: number, rng?: {nextInt: Function, snapshot: Function},
 *          spitterSlots?: readonly number[], bruteSlots?: readonly number[], absorbedSlots?: readonly number[],
 *          spitters?: boolean, brutes?: boolean}} options
 *   schedule - fixed spawn ticks; null uses the real nightPlan
 *   spitterSlots, bruteSlots, absorbedSlots - what a fixed schedule's slots hold
 *   spitters, brutes - false takes them out of the real nightPlan, which leaves
 *   the same waves of ordinary mutants, as a comparison. Nothing a player can do.
 *   requireHq - the real HQ-first rules, as GameScene uses them
 *   roads - the real road rules, as GameScene uses them. Off by default, which
 *   is how the historical combat benchmarks keep a layout that predates them.
 *   pollution - the starting value
 *   firstNight - earlier nights spawn nothing and settle nothing, so a benchmark
 *   can start late on the real calendar
 *   rng - replaces the seeded RNG, so a test can choose spawn positions
 *   map, terrain - a map from core/worldMap.js and its terrain, as GameScene uses
 *   them. Without one, the world is the original 24x16 battlefield.
 *   active - the real ACTIVE cycle GameScene plays: a timed Day, Dusk, then Night.
 *   Off by default, which keeps the untimed Day every older test was written for.
 */
export function createWorld({seed = 731, schedule = null, resources = STARTING_RESOURCES, openConstruction = false, requireHq = false, roads: useRoads = false, pollution: startingPollution = 0, firstNight = 1, rng: fixedRng = null, spitterSlots = [], bruteSlots = [], absorbedSlots = [], spitters = true, brutes = true, map = null, terrain = null, active = false} = {}) {
    const clock = new SimulationClock();
    const economy = new Economy(resources);
    const pollution = new Pollution(startingPollution);
    const grid = new Grid(map ? gridFor(map, terrain) : GRID);
    const rng = fixedRng ?? new SeededRandom(seed);
    const roads = useRoads ? new RoadNetwork({grid}) : null;
    let cycle;
    const placement = new BuildingPlacement(grid, economy, openConstruction ? {requireHq, roads} : {isConstructionAllowed: () => cycle.isConstructionAllowed, isPaused: () => cycle.pausedDay, requireHq, roads});
    cycle = new ShiftCycle({
        clock,
        economy,
        dayTicks: active ? DAY_TICKS : null,
        duskTicks: DUSK_TICKS,
        canEndDay: () => !requireHq || placement.hqBuilt,
        settleNight: (day) => (day < firstNight ? null : settleNight({day, buildings: placement.buildings(), economy, pollution})),
    });
    const gates = new Gates({cycle, placement, grid});
    const logistics = roads ? new Logistics({cycle, placement, grid, roads, economy, gates}) : null;
    const mutants = new Mutants({
        cycle,
        placement,
        grid,
        rng,
        logistics,
        gates,
        schedule: schedule ?? [],
        spawnFrame: map?.spawnFrame ?? null,
        spitterSlots,
        bruteSlots,
        absorbedSlots,
        planNight: schedule ? null : (day) => {
            if (day < firstNight) return {schedule: []};
            const plan = nightPlan({day, pollution: pollution.value, buildings: placement.buildings()});
            return {
                ...plan,
                ...(spitters ? {} : {spitters: 0, spitterSlots: []}),
                ...(brutes ? {} : {brutes: 0, bruteSlots: [], absorbedSlots: []}),
            };
        },
    });
    const autocannons = new Autocannons({cycle, placement, grid, mutants});
    const siegeCannons = new SiegeCannons({cycle, placement, grid, mutants});
    const infantry = roads ? new Infantry({cycle, placement, grid, gates, mutants, roads}) : null;
    mutants.setInfantry(infantry);
    const workers = roads ? new Workers({cycle, placement, grid, gates, economy, roads, pollution}) : null;
    mutants.setWorkers(workers);
    cycle.begin();

    const soldierKills = new Set(); // this tick's: a turret that had one locked has not stepped since

    /** Same order as GameScene.stepSimulation. */
    const tick = (t) => {
        cycle.onTick(t);
        const siege = siegeCannons.step();
        const defense = autocannons.step();
        const wanted = logistics?.gateDemands();
        if (wanted) {
            infantry.addGateDemands(wanted);
            workers.addGateDemands(wanted);
        }
        gates.step(wanted);
        const infantryShots = infantry?.step().shots ?? [];
        workers?.step();
        soldierKills.clear();
        for (const {killed, mutantId} of infantryShots) if (killed) soldierKills.add(mutantId);
        const effects = mutants.step();
        const deliveries = logistics?.step().deliveries ?? 0;
        return {siege, defense, infantryShots, effects, deliveries};
    };

    /** A legal command: the real placement path, with its real validation. */
    const place = (type, col, row) => {
        placement.select(type);
        const result = placement.placeAt({col, row});
        placement.cancel();
        return result;
    };

    return {clock, economy, pollution, grid, rng, placement, roads, logistics, gates, cycle, mutants, autocannons, siegeCannons, infantry, workers, soldierKills, tick, place};
}

/** The state compared between runs and between Node and Chromium. */
export function canonicalState({mutants, buildings, autocannons, rng, soldiers = [], shells = [], siegeCannons = [], siegeShells = [], rockets = []}) {
    // Anything a base does not have stays out, so it keeps the digests it has always had.
    const optional = Object.entries({soldiers, shells, siegeCannons, siegeShells, rockets}).filter(([, list]) => list.length);
    return JSON.stringify({mutants, buildings, autocannons, rng, ...Object.fromEntries(optional)});
}

export const digestOf = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

export function worldState(world) {
    return {
        mutants: world.mutants.snapshot(),
        buildings: world.placement.buildings(),
        autocannons: world.autocannons.snapshot(),
        rng: world.rng.snapshot(),
        soldiers: world.infantry?.soldiers() ?? [],
        shells: world.mutants.shells(),
        siegeCannons: world.siegeCannons.snapshot(),
        siegeShells: world.siegeCannons.shells(),
        rockets: world.infantry?.rockets() ?? [],
    };
}

/**
 * Simulation invariants at a tick boundary.
 * @returns {string[]} violations; empty when consistent
 */
export function checkInvariants(world) {
    const problems = [];
    const {grid, placement, mutants, autocannons} = world;
    const buildings = placement.buildings();
    const living = mutants.snapshot();

    const occupants = grid.snapshot().occupants.map((o) => o.id).sort();
    const records = buildings.map((b) => b.id).sort();
    if (JSON.stringify(occupants) !== JSON.stringify(records)) problems.push('grid occupants do not match building records');

    for (const building of buildings) {
        if (!Number.isInteger(building.hp) || building.hp <= 0) problems.push(`${building.id} has hp ${building.hp}`);
    }

    const bounds = grid.footprintRect({col: 0, row: 0, width: grid.cols, height: grid.rows});
    // A gate can close on a mutant in the doorway, so only gates are exempt.
    const rects = buildings.filter((b) => !getBuildingType(b.type).gate).map((b) => [b.id, grid.footprintRect(b)]);
    if (new Set(living.map((m) => m.id)).size !== living.length) problems.push('duplicate mutant ids');
    for (const mutant of living) {
        const spitter = mutant.kind === SPITTER.kind;
        const brute = mutant.kind === BRUTE.kind;
        const maxHp = brute ? BRUTE.maxHp : spitter ? SPITTER.maxHp : MUTANT.maxHp;
        const maxTimer = brute ? BRUTE.attackCooldownTicks : mutant.shots > 0 ? SPITTER.cycleTicks : MUTANT.attackCooldownTicks;
        if (!Number.isInteger(mutant.hp) || mutant.hp < 1 || mutant.hp > maxHp) problems.push(`${mutant.id} has hp ${mutant.hp}`);
        if (mutant.attackTimer < 1 || mutant.attackTimer > maxTimer) problems.push(`${mutant.id} has attackTimer ${mutant.attackTimer}`);
        if (spitter && (mutant.shots < 0 || mutant.shots > SPITTER.maxShots)) problems.push(`${mutant.id} has ${mutant.shots} shots`);
        if (mutant.aim && mutant.attackTimer > SPITTER.windupTicks) problems.push(`${mutant.id} aims outside its telegraph`);
        // One step outside is where a mutant arrives at a fortified border cell.
        if (distanceToFootprint(mutant, bounds) > MUTANT.speed) problems.push(`${mutant.id} left the grid at ${mutant.x},${mutant.y}`);
        for (const [id, rect] of rects) {
            if (distanceToFootprint(mutant, rect) === 0) problems.push(`${mutant.id} is inside ${id}`);
        }
    }

    const alive = new Set(living.map((m) => m.id));
    const turrets = autocannons.snapshot();
    const cannonIds = buildings.filter((b) => b.type === 'autocannon').map((b) => b.id);
    if (JSON.stringify(turrets.map((t) => t.id)) !== JSON.stringify(cannonIds)) problems.push('turret state does not match Autocannons');
    for (const turret of turrets) {
        if (turret.cooldown < 0 || turret.cooldown > AUTOCANNON.cooldownTicks) problems.push(`${turret.id} has cooldown ${turret.cooldown}`);
        // Infantry steps after turrets, so only a soldier's kill on this very tick can leave a lock behind.
        if (turret.targetId !== null && !alive.has(turret.targetId) && !world.soldierKills.has(turret.targetId)) problems.push(`${turret.id} targets dead ${turret.targetId}`);
    }
    for (const {id, cooldown} of world.siegeCannons.snapshot()) {
        if (cooldown < 0 || cooldown > SIEGE.reloadTicks) problems.push(`${id} has cooldown ${cooldown}`);
    }
    return problems;
}

/** Nearest-rank percentiles of a list of numbers. */
export function percentiles(values) {
    if (values.length === 0) return {count: 0, p50: 0, p95: 0, p99: 0, max: 0};
    const sorted = [...values].sort((a, b) => a - b);
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    const round = (n) => Math.round(n * 1000) / 1000;
    return {count: sorted.length, p50: round(at(0.5)), p95: round(at(0.95)), p99: round(at(0.99)), max: round(sorted.at(-1))};
}
