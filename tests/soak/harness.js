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
import {Economy, STARTING_RESOURCES} from '../../src/core/economy.js';
import {Grid} from '../../src/core/grid.js';
import {Logistics} from '../../src/core/logistics.js';
import {Mutants, MUTANT, distanceToFootprint} from '../../src/core/mutants.js';
import {Pollution} from '../../src/core/pollution.js';
import {RoadNetwork} from '../../src/core/roads.js';
import {SeededRandom} from '../../src/core/seededRandom.js';
import {settleNight} from '../../src/core/settlement.js';
import {ShiftCycle} from '../../src/core/shiftCycle.js';
import {SimulationClock} from '../../src/core/simulationClock.js';
import {AUTOCANNON} from '../../src/core/autocannons.js';
import {nightPlan} from '../../src/core/waves.js';

const GRID = {cols: 24, rows: 16, tileSize: 32, originX: 256, originY: 104};

/**
 * @param {{seed?: number, schedule?: readonly number[]|null, resources?: {credits: number, ap: number},
 *          openConstruction?: boolean, requireHq?: boolean, roads?: boolean, pollution?: number,
 *          firstNight?: number}} options
 *   schedule - fixed spawn ticks; null uses the real nightPlan
 *   requireHq - the real HQ-first rules, as GameScene uses them
 *   roads - the real road rules, as GameScene uses them. Off by default, which
 *   is how the historical combat benchmarks keep a layout that predates them.
 *   pollution - the starting value
 *   firstNight - earlier nights spawn nothing and settle nothing, so a benchmark
 *   can start late on the real calendar
 */
export function createWorld({seed = 731, schedule = null, resources = STARTING_RESOURCES, openConstruction = false, requireHq = false, roads: useRoads = false, pollution: startingPollution = 0, firstNight = 1} = {}) {
    const clock = new SimulationClock();
    const economy = new Economy(resources);
    const pollution = new Pollution(startingPollution);
    const grid = new Grid(GRID);
    const rng = new SeededRandom(seed);
    const roads = useRoads ? new RoadNetwork({grid}) : null;
    let cycle;
    const placement = new BuildingPlacement(grid, economy, openConstruction ? {requireHq, roads} : {isConstructionAllowed: () => cycle.isConstructionAllowed, requireHq, roads});
    cycle = new ShiftCycle({
        clock,
        economy,
        canEndDay: () => !requireHq || placement.hqBuilt,
        settleNight: (day) => (day < firstNight ? null : settleNight({day, buildings: placement.buildings(), economy, pollution})),
    });
    const logistics = roads ? new Logistics({cycle, placement, grid, roads, economy}) : null;
    const mutants = new Mutants({
        cycle,
        placement,
        grid,
        rng,
        logistics,
        schedule: schedule ?? [],
        planNight: schedule ? null : (day) => (day < firstNight
            ? {schedule: []}
            : nightPlan({day, pollution: pollution.value, buildings: placement.buildings()})),
    });
    const autocannons = new Autocannons({cycle, placement, grid, mutants});
    cycle.begin();

    /** Same order as GameScene.stepSimulation. */
    const tick = (t) => {
        cycle.onTick(t);
        const defense = autocannons.step();
        const effects = mutants.step();
        const deliveries = logistics?.step().deliveries ?? 0;
        return {defense, effects, deliveries};
    };

    /** A legal command: the real placement path, with its real validation. */
    const place = (type, col, row) => {
        placement.select(type);
        const result = placement.placeAt({col, row});
        placement.cancel();
        return result;
    };

    return {clock, economy, pollution, grid, rng, placement, roads, logistics, cycle, mutants, autocannons, tick, place};
}

/** The state compared between runs and between Node and Chromium. */
export function canonicalState({mutants, buildings, autocannons, rng}) {
    return JSON.stringify({mutants, buildings, autocannons, rng});
}

export const digestOf = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

export function worldState(world) {
    return {
        mutants: world.mutants.snapshot(),
        buildings: world.placement.buildings(),
        autocannons: world.autocannons.snapshot(),
        rng: world.rng.snapshot(),
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
    const rects = buildings.map((b) => [b.id, grid.footprintRect(b)]);
    if (new Set(living.map((m) => m.id)).size !== living.length) problems.push('duplicate mutant ids');
    for (const mutant of living) {
        if (!Number.isInteger(mutant.hp) || mutant.hp < 1 || mutant.hp > MUTANT.maxHp) problems.push(`${mutant.id} has hp ${mutant.hp}`);
        if (mutant.attackTimer < 1 || mutant.attackTimer > MUTANT.attackCooldownTicks) problems.push(`${mutant.id} has attackTimer ${mutant.attackTimer}`);
        if (distanceToFootprint(mutant, bounds) !== 0) problems.push(`${mutant.id} left the grid at ${mutant.x},${mutant.y}`);
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
        if (turret.targetId !== null && !alive.has(turret.targetId)) problems.push(`${turret.id} targets dead ${turret.targetId}`);
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
