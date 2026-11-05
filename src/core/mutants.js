/**
 * Night-time mutants. Pure — no Phaser, no timers, no wall clock.
 *
 * Positions are real world pixels from the existing Grid. Speed is 0.5 px per
 * tick, which is exact in binary, so positions never drift. Distances are
 * Manhattan distances to a building's footprint rectangle.
 *
 * step() runs once per executed simulation tick, AFTER ShiftCycle.onTick().
 * Mutants therefore act on night ticks 1..nightTicks-1, the final tick only
 * settles, and a retried final tick cannot apply damage twice. Outside Night
 * step() removes any survivors, which is how dawn cleanup happens.
 *
 * Destroying HQ ends the run on that hit: later mutants do not act and a due
 * spawn is dropped. Survivors stay where they are, frozen, since defeat is
 * final and there is no dawn.
 *
 * Mutant HP is owned here and only changes through damageMutant(). Building
 * HP and occupancy belong to BuildingPlacement; a mutant only holds building
 * ids. `targetId` is the preferred target, locked until destroyed.
 * `obstacleId` is a building that blocked the next step: the mutant stays
 * put and attacks it until destroyed, then resumes toward `targetId`.
 */
import {HQ_TYPE} from './buildingTypes.js';
import {Shift} from './shiftCycle.js';

export const MUTANT = Object.freeze({
    maxHp: 40,
    speed: 0.5, // px per tick; must stay below the smallest footprint size
    attackRange: 8, // px from the footprint edge
    attackDamage: 5,
    attackCooldownTicks: 60,
});

/** Px subtracted from a building's distance: higher is more attractive. */
export const TARGET_BIAS = Object.freeze({hq: 256, powerPlant: 256, factory: 128, autocannon: 64, outpost: 0});

export const UNKNOWN_MUTANT = 'unknown-mutant';
export const INVALID_DAMAGE = 'invalid-damage';

const NO_EFFECTS = Object.freeze({
    spawned: Object.freeze([]),
    attacks: Object.freeze([]),
    destroyed: Object.freeze([]),
});

/** Manhattan distance from a point to a rectangle; 0 on or inside it. */
export function distanceToFootprint({x, y}, rect) {
    const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.width));
    const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.height));
    return dx + dy;
}

/**
 * Preferred target: lowest distance minus bias, then higher bias, then
 * earliest in the list (ids are not compared: 'x-10' sorts before 'x-2').
 * @returns {string|null} building id, or null when there are no buildings
 */
export function selectTarget(point, buildings, grid) {
    let best = null;
    for (const building of buildings) {
        if (!Object.hasOwn(TARGET_BIAS, building.type)) throw new TypeError(`No target bias for building type: ${building.type}`);
        const bias = TARGET_BIAS[building.type];
        const score = distanceToFootprint(point, grid.footprintRect(building)) - bias;
        if (!best || score < best.score || (score === best.score && bias > best.bias)) {
            best = {id: building.id, score, bias};
        }
    }
    return best ? best.id : null;
}

/**
 * First building whose footprint contains the point. Bounds are closed, so
 * two touching buildings leave no walkable seam between them.
 * @returns {string|null} building id
 */
export function blockerAt(point, buildings, grid) {
    const blocker = buildings.find((b) => distanceToFootprint(point, grid.footprintRect(b)) === 0);
    return blocker ? blocker.id : null;
}

/**
 * Every spawn position, clockwise from the top-left: the midpoint of each
 * border cell's outer edge. Corner cells appear once per edge they touch.
 */
export function borderSpawns(grid) {
    const {x: left, y: top, width, height} = grid.footprintRect({col: 0, row: 0, width: grid.cols, height: grid.rows});
    const spawns = [];
    for (let col = 0; col < grid.cols; col++) spawns.push({col, row: 0, x: grid.cellCenter(col, 0).x, y: top});
    for (let row = 0; row < grid.rows; row++) spawns.push({col: grid.cols - 1, row, x: left + width, y: grid.cellCenter(0, row).y});
    for (let col = grid.cols - 1; col >= 0; col--) spawns.push({col, row: grid.rows - 1, x: grid.cellCenter(col, 0).x, y: top + height});
    for (let row = grid.rows - 1; row >= 0; row--) spawns.push({col: 0, row, x: left, y: grid.cellCenter(0, row).y});
    return spawns;
}

/** One movement step toward the nearest footprint point, along the longer axis (x on ties). */
function nextPosition({x, y}, rect) {
    const dx = Math.min(Math.max(x, rect.x), rect.x + rect.width) - x;
    const dy = Math.min(Math.max(y, rect.y), rect.y + rect.height) - y;
    if (Math.abs(dx) >= Math.abs(dy)) return {x: x + Math.sign(dx) * Math.min(MUTANT.speed, Math.abs(dx)), y};
    return {x, y: y + Math.sign(dy) * Math.min(MUTANT.speed, Math.abs(dy))};
}

function assertValidSchedule(schedule, nightTicks) {
    const valid = Array.isArray(schedule) && schedule.every((tick, i) => Number.isInteger(tick)
        && tick >= 1 && tick < nightTicks && (i === 0 || tick > schedule[i - 1]));
    if (!valid) throw new RangeError(`schedule must be strictly increasing ticks in 1..${nightTicks - 1}`);
}

export class Mutants {
    #cycle;
    #placement;
    #grid;
    #rng;
    #schedule;
    #planNight;
    #plan = null; // frozen for the night on tick 1, cleared at dawn
    #logistics;
    #spawns;
    #mutants = [];
    #nextId = 1;

    /**
     * @param {{cycle: import('./shiftCycle.js').ShiftCycle,
     *          placement: import('./buildingPlacement.js').BuildingPlacement,
     *          grid: import('./grid.js').Grid,
     *          rng: import('./seededRandom.js').SeededRandom,
     *          logistics?: import('./logistics.js').Logistics | null,
     *          schedule?: readonly number[],
     *          planNight?: ((day: number) => {schedule: readonly number[]}) | null}} deps
     *   schedule  - fixed spawn ticks, the same every night
     *   planNight - asked once per night, on night tick 1; overrides schedule
     */
    constructor({cycle, placement, grid, rng, schedule = [], planNight = null, logistics = null}) {
        assertValidSchedule(schedule, cycle.nightTicks);
        this.#cycle = cycle;
        this.#placement = placement;
        this.#grid = grid;
        this.#rng = rng;
        this.#schedule = schedule;
        this.#planNight = planNight;
        this.#logistics = logistics;
        this.#spawns = borderSpawns(grid);
    }

    /**
     * One simulation tick. Existing mutants act in spawn order, then any
     * scheduled spawn is added, so a new mutant first acts on the next tick.
     * @returns {{spawned: string[], attacks: Array<{mutantId, buildingId, damage, hp}>, destroyed: string[]}}
     */
    step() {
        if (this.#cycle.shift === Shift.DEFEATED) return NO_EFFECTS;
        if (this.#cycle.shift !== Shift.NIGHT) {
            this.#mutants.length = 0;
            this.#plan = null;
            return NO_EFFECTS;
        }
        this.#plan ??= this.#resolvePlan();
        const spawnDue = this.#plan.schedule.includes(this.#cycle.elapsedNightTicks);
        if (this.#mutants.length === 0 && !spawnDue) return NO_EFFECTS;

        const effects = {spawned: [], attacks: [], destroyed: []};
        const buildings = this.#placement.buildings();
        const trucks = this.#logistics?.attackableTrucks() ?? [];
        for (const mutant of this.#mutants) {
            this.#act(mutant, buildings, effects, trucks);
            if (this.#cycle.shift !== Shift.NIGHT) return effects; // HQ fell: the run ended on that hit
        }
        if (spawnDue) this.#spawn(buildings, effects);
        return effects;
    }

    /** The frozen plan for the current night, or null outside a started Night. */
    plan() {
        return this.#plan;
    }

    /**
     * Apply damage to a living mutant. This is the only way mutant HP changes
     * and the only way a mutant dies. At 0 HP the record is removed, so a
     * mutant dies exactly once and later damage is rejected as unknown.
     * @returns {{ok: true, killed: boolean, hp: number} | {ok: false, reason: 'unknown-mutant' | 'invalid-damage'}}
     */
    damageMutant(id, amount) {
        if (!Number.isSafeInteger(amount) || amount <= 0) return {ok: false, reason: INVALID_DAMAGE};
        const index = this.#mutants.findIndex((mutant) => mutant.id === id);
        if (index === -1) return {ok: false, reason: UNKNOWN_MUTANT};

        const mutant = this.#mutants[index];
        const hp = Math.max(0, mutant.hp - amount);
        mutant.hp = hp;
        if (hp > 0) return {ok: true, killed: false, hp};
        this.#mutants.splice(index, 1);
        return {ok: true, killed: true, hp};
    }

    /** Detached plain data, in spawn order. */
    snapshot() {
        return this.#mutants.map((mutant) => ({...mutant}));
    }

    #resolvePlan() {
        if (!this.#planNight) return Object.freeze({schedule: Object.freeze([...this.#schedule])});
        const plan = this.#planNight(this.#cycle.day);
        assertValidSchedule(plan.schedule, this.#cycle.nightTicks);
        return plan;
    }

    #act(mutant, buildings, effects, trucks) {
        const find = (id) => buildings.find((b) => b.id === id);
        if (mutant.obstacleId && !find(mutant.obstacleId)) mutant.obstacleId = null;
        if (!find(mutant.targetId)) mutant.targetId = selectTarget(mutant, buildings, this.#grid);

        const target = find(mutant.targetId);
        const rect = target ? this.#grid.footprintRect(target) : null;
        const attackId = mutant.obstacleId
            ?? (rect && distanceToFootprint(mutant, rect) <= MUTANT.attackRange ? target.id : null);
        // A truck in melee range holds a mutant's attention, but mutants never
        // seek trucks out, and a moving truck is soon out of reach again.
        const truck = trucks.find((t) => this.#inTruckRange(mutant, t));
        if (truck || attackId) {
            if (--mutant.attackTimer > 0) return;
            if (truck) this.#attackTruck(mutant, truck, trucks);
            else this.#attack(mutant, attackId, buildings, effects);
            return;
        }

        // The attack timer only runs while stationary.
        mutant.attackTimer = MUTANT.attackCooldownTicks;
        if (!rect) return; // no buildings left: wait for dawn
        const next = nextPosition(mutant, rect);
        const blocker = blockerAt(next, buildings, this.#grid);
        if (blocker) {
            mutant.obstacleId = blocker;
            return;
        }
        mutant.x = next.x;
        mutant.y = next.y;
    }

    /** A truck counts as one road tile, so melee range works as it does for a 1x1 building. */
    #inTruckRange(mutant, {x, y}) {
        const {tileSize} = this.#grid;
        const rect = {x: x - tileSize / 2, y: y - tileSize / 2, width: tileSize, height: tileSize};
        return distanceToFootprint(mutant, rect) <= MUTANT.attackRange;
    }

    #attackTruck(mutant, truck, trucks) {
        mutant.attackTimer = MUTANT.attackCooldownTicks;
        const result = this.#logistics.damageTruck(truck.id, MUTANT.attackDamage);
        if (!result.ok) throw new Error(`Mutant ${mutant.id} could not damage ${truck.id}: ${result.reason}`);
        if (result.destroyed) trucks.splice(trucks.indexOf(truck), 1);
    }

    #attack(mutant, buildingId, buildings, effects) {
        mutant.attackTimer = MUTANT.attackCooldownTicks;
        const result = this.#placement.damageBuilding(buildingId, MUTANT.attackDamage);
        if (!result.ok) throw new Error(`Mutant ${mutant.id} could not damage ${buildingId}: ${result.reason}`);
        effects.attacks.push({mutantId: mutant.id, buildingId, damage: MUTANT.attackDamage, hp: result.hp});
        if (result.destroyed) {
            effects.destroyed.push(buildingId);
            const [building] = buildings.splice(buildings.findIndex((b) => b.id === buildingId), 1);
            if (building.type === HQ_TYPE) this.#cycle.defeat();
        }
    }

    /**
     * Exactly one RNG draw picks a border position, whatever the board looks
     * like. If that border cell is occupied the next free position clockwise
     * is used; if every border cell is occupied this spawn is skipped.
     */
    #spawn(buildings, effects) {
        const start = this.#rng.nextInt(0, this.#spawns.length - 1);
        for (let i = 0; i < this.#spawns.length; i++) {
            const {col, row, x, y} = this.#spawns[(start + i) % this.#spawns.length];
            if (this.#grid.occupantAt(col, row) !== null) continue;
            const id = `mutant-${this.#nextId++}`;
            this.#mutants.push({
                id,
                x,
                y,
                hp: MUTANT.maxHp,
                targetId: selectTarget({x, y}, buildings, this.#grid),
                obstacleId: null,
                attackTimer: MUTANT.attackCooldownTicks,
            });
            effects.spawned.push(id);
            return;
        }
    }
}
