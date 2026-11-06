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
 *
 * Fortifications are obstacles only: never a target, however close. A step that
 * a fortification blocks triggers one bounded search for an open way round, to a
 * free tile next to the target's footprint. A mutant that finds one follows it;
 * one that does not attacks what is in its way. NO PATH therefore always means
 * ATTACK: searching is never a state a mutant can stay in, it runs once per
 * block, and a mutant has a limited number of plans and extra tiles for its
 * whole life. Everything that blocks can be destroyed, so no mutant waits
 * forever. With no fortifications none of this runs.
 *
 * Soldiers are never targets. One within melee reach stops a mutant, like a truck
 * does. One within LURE_RANGE pulls a walking mutant towards it, but only while
 * the whole way there is clear, which is asked afresh every tick: nothing is
 * remembered, so a blocked mutant walks on as usual and a passage that opens
 * counts at once. The way a mutant walks depends only on where it stands, so
 * every step of a clear way is still clear, and it cannot flip between its
 * target and a soldier. A mutant at its target or at an obstacle is not walking,
 * so a lure never takes it away. With no soldiers none of this runs.
 *
 * A Spitter is a mutant with `kind` and `shots`, and it walks, detours and chooses
 * targets like any other. It stops once its target is in range, and only a
 * destroyed target ever moves it on, so it cannot wander between firing positions.
 * Where it aims is fixed when its telegraph starts: the point, not the thing. A
 * shell is released along that line and stops at the first solid building, which
 * is fixed on release (see core/lineOfFire.js). NO LINE therefore never means NO
 * ATTACK either: whatever is in the way takes the hit. A shell aimed at a soldier
 * hurts only a soldier still on that spot when it lands, so one who has walked off
 * is missed. A shell in flight outlives its Spitter, lands on nothing if what it
 * was going to hit has gone, and is removed at dawn. A Spitter with no shots left
 * has no ranged behaviour at all: it runs the melee code like any other mutant.
 * Ordinary mutant records stay exactly as they were.
 *
 * A Brute is a melee mutant with `kind`: heavier, slower and harder hitting, which
 * statsOf() is the only code that knows. It chooses targets, attacks and is lured
 * like anyone. The one thing it does differently is never go round a fortification:
 * whatever blocks it becomes its obstacle at once, and the breach it leaves is open
 * to everyone behind it. Mutants do not collide, so Brutes can share a wall.
 */
import {HQ_TYPE, getBuildingType} from './buildingTypes.js';
import {INFANTRY} from './infantry.js';
import {firstSolid} from './lineOfFire.js';
import {Shift} from './shiftCycle.js';
import {BRUTE_KIND, flightTicks} from './shots.js';

export const MUTANT = Object.freeze({
    maxHp: 40,
    speed: 0.5, // px per tick; must stay below the smallest footprint size
    attackRange: 8, // px from the footprint edge
    attackDamage: 5,
    attackCooldownTicks: 60,
});

/** Provisional values. It moves at MUTANT.speed, and hits with MUTANT values once out of shots. */
export const SPITTER = Object.freeze({
    kind: 'spitter',
    maxHp: 30,
    range: 192, // px, circular, to the nearest footprint point
    damage: 10,
    cycleTicks: 180, // from one release to the next, telegraph included
    windupTicks: 45, // the telegraph: from fixing the aim to releasing the shell
    maxShots: 5,
    shellSpeed: 8, // px per tick along the longer axis
    retaliationRange: 128, // px, to a soldier it has a clear line to
});

/** Provisional values. Its melee range is MUTANT.attackRange. */
export const BRUTE = Object.freeze({
    kind: BRUTE_KIND,
    maxHp: 600,
    speed: 0.25, // px per tick; must stay below the smallest footprint size
    attackDamage: 25,
    attackCooldownTicks: 120,
});

/** What a mutant walks and hits with. A Spitter out of shots is as ordinary as any. */
const statsOf = ({kind}) => (kind === BRUTE.kind ? BRUTE : MUTANT);

/** A slot that keeps its tick and its random number but spawns nothing, for a Brute's cost. */
const ABSORBED = 'absorbed';

/** Px subtracted from a building's distance: higher is more attractive. */
export const TARGET_BIAS = Object.freeze({hq: 256, powerPlant: 256, factory: 128, autocannon: 64, siegeCannon: 64, barracks: 64, outpost: 0});

/** Px from a walking mutant to a soldier it will turn towards. */
export const LURE_RANGE = 64;

/**
 * Limits on going round a fortification, in tiles beyond the direct distance.
 * maxExtraTiles is the most one detour may add. maxTotalExtraTiles and maxPlans
 * bound a mutant's whole life, so repeated detours cannot use up a Night.
 */
export const DETOUR = Object.freeze({maxExtraTiles: 12, maxTotalExtraTiles: 24, maxPlans: 4});

export const UNKNOWN_MUTANT = 'unknown-mutant';
export const INVALID_DAMAGE = 'invalid-damage';

const NO_EFFECTS = Object.freeze({
    spawned: Object.freeze([]),
    attacks: Object.freeze([]),
    destroyed: Object.freeze([]),
});

const isFortification = ({type}) => getBuildingType(type)?.fortification === true;

/** Manhattan distance from a point to a rectangle; 0 on or inside it. */
export function distanceToFootprint({x, y}, rect) {
    const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.width));
    const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.height));
    return dx + dy;
}

/** The point of a rectangle nearest to a point. */
export function nearestPoint({x, y}, rect) {
    return {x: Math.min(Math.max(x, rect.x), rect.x + rect.width), y: Math.min(Math.max(y, rect.y), rect.y + rect.height)};
}

const squaredDistance = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/**
 * Preferred target: lowest distance minus bias, then higher bias, then
 * earliest in the list (ids are not compared: 'x-10' sorts before 'x-2').
 * @returns {string|null} building id, or null when there are no buildings
 */
export function selectTarget(point, buildings, grid) {
    let best = null;
    for (const building of buildings) {
        if (isFortification(building)) continue;
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
 * two touching buildings leave no walkable seam between them. This is the plain
 * definition; gridBlockerAt gives the same answer faster.
 * @returns {string|null} building id
 */
export function blockerAt(point, buildings, grid) {
    const blocker = buildings.find((b) => distanceToFootprint(point, grid.footprintRect(b)) === 0);
    return blocker ? blocker.id : null;
}

/**
 * blockerAt answered through the grid, for a tick's worth of mutants: its cost
 * does not grow with the number of walls. A point on a tile line touches the
 * tiles either side, hence up to four. `passes` excuses a building, as an open
 * gate is excused for a step along its axis.
 * @param {Map<string, object>} byId the same buildings, by id
 * @returns {object|null} the building
 */
export function gridBlockerAt({x, y}, buildings, byId, grid, passes = () => false) {
    const col = (x - grid.originX) / grid.tileSize;
    const row = (y - grid.originY) / grid.tileSize;
    const cols = Number.isInteger(col) ? [col - 1, col] : [Math.floor(col)];
    const rows = Number.isInteger(row) ? [row - 1, row] : [Math.floor(row)];
    let first = null;
    for (const r of rows) {
        for (const c of cols) {
            const building = byId.get(grid.occupantAt(c, r));
            if (!building || building === first || passes(building)) continue;
            if (!first || buildings.indexOf(building) < buildings.indexOf(first)) first = building;
        }
    }
    return first;
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
function nextPosition({x, y}, rect, speed) {
    const dx = Math.min(Math.max(x, rect.x), rect.x + rect.width) - x;
    const dy = Math.min(Math.max(y, rect.y), rect.y + rect.height) - y;
    if (Math.abs(dx) >= Math.abs(dy)) return {x: x + Math.sign(dx) * Math.min(speed, Math.abs(dx)), y};
    return {x, y: y + Math.sign(dy) * Math.min(speed, Math.abs(dy))};
}

/** What a mutant has to reach to hit a soldier. */
function soldierBody({x, y}) {
    const half = INFANTRY.bodySize / 2;
    return {x: x - half, y: y - half, width: INFANTRY.bodySize, height: INFANTRY.bodySize};
}

/** What a new record gets from its kind: `extra` is only on records that are not ordinary. */
function freshStats(kind) {
    if (kind === SPITTER.kind) return {hp: SPITTER.maxHp, attackTimer: SPITTER.windupTicks, extra: {kind, shots: SPITTER.maxShots, aim: null}};
    if (kind === BRUTE.kind) return {hp: BRUTE.maxHp, attackTimer: BRUTE.attackCooldownTicks, extra: {kind}};
    return {hp: MUTANT.maxHp, attackTimer: MUTANT.attackCooldownTicks, extra: {}};
}

const CELL_STEPS = Object.freeze([[0, -1], [1, 0], [0, 1], [-1, 0]]); // N, E, S, W

function assertValidSchedule(schedule, nightTicks) {
    const valid = Array.isArray(schedule) && schedule.every((tick, i) => Number.isInteger(tick)
        && tick >= 1 && tick < nightTicks && (i === 0 || tick > schedule[i - 1]));
    if (!valid) throw new RangeError(`schedule must be strictly increasing ticks in 1..${nightTicks - 1}`);
}

function assertValidSlots(slots, schedule) {
    const valid = Array.isArray(slots) && slots.every((slot, i) => Number.isInteger(slot)
        && slot >= 0 && slot < schedule.length && (i === 0 || slot > slots[i - 1]));
    if (!valid) throw new RangeError(`slots must be strictly increasing indices into a schedule of ${schedule.length}`);
}

/** Every kind of slot is valid on its own, and no slot is two things at once. */
function assertValidComposition({spitterSlots = [], bruteSlots = [], absorbedSlots = []}, schedule) {
    for (const slots of [spitterSlots, bruteSlots, absorbedSlots]) assertValidSlots(slots, schedule);
    const all = [...spitterSlots, ...bruteSlots, ...absorbedSlots];
    if (new Set(all).size !== all.length) throw new RangeError('a slot cannot be two things at once');
}

export class Mutants {
    #cycle;
    #placement;
    #grid;
    #rng;
    #schedule;
    #composition;
    #planNight;
    #plan = null; // frozen for the night on tick 1, cleared at dawn
    #logistics;
    #gates;
    #infantry = null;
    #spawns;
    #bounds;
    #mutants = [];
    #nextId = 1;
    #shells = []; // in release order, Night only
    #nextShellId = 1;
    #pathing = new WeakMap(); // mutant record -> {cells, index, extraTiles, plans}; dies with it

    /**
     * @param {{cycle: import('./shiftCycle.js').ShiftCycle,
     *          placement: import('./buildingPlacement.js').BuildingPlacement,
     *          grid: import('./grid.js').Grid,
     *          rng: import('./seededRandom.js').SeededRandom,
     *          logistics?: import('./logistics.js').Logistics | null,
     *          gates?: import('./gates.js').Gates | null,
     *          schedule?: readonly number[],
     *          spitterSlots?: readonly number[],
     *          bruteSlots?: readonly number[],
     *          absorbedSlots?: readonly number[],
     *          planNight?: ((day: number) => {schedule: readonly number[], spitterSlots?: readonly number[],
     *                       bruteSlots?: readonly number[], absorbedSlots?: readonly number[]}) | null}} deps
     *   schedule      - fixed spawn ticks, the same every night
     *   spitterSlots  - which of those are Spitters, as indices into schedule
     *   bruteSlots    - which are Brutes
     *   absorbedSlots - which spawn nothing, paying for a Brute
     *   planNight     - asked once per night, on night tick 1; overrides them all
     */
    constructor({cycle, placement, grid, rng, schedule = [], spitterSlots = [], bruteSlots = [], absorbedSlots = [], planNight = null, logistics = null, gates = null}) {
        assertValidSchedule(schedule, cycle.nightTicks);
        this.#composition = {spitterSlots, bruteSlots, absorbedSlots};
        assertValidComposition(this.#composition, schedule);
        this.#cycle = cycle;
        this.#placement = placement;
        this.#grid = grid;
        this.#rng = rng;
        this.#schedule = schedule;
        this.#planNight = planNight;
        this.#logistics = logistics;
        this.#gates = gates;
        this.#spawns = borderSpawns(grid);
        this.#bounds = grid.footprintRect({col: 0, row: 0, width: grid.cols, height: grid.rows});
    }

    /** Soldiers shoot mutants and mutants hit soldiers, so one of the two is connected later. */
    setInfantry(infantry) {
        this.#infantry = infantry;
    }

    /**
     * One simulation tick. Shells land first, then existing mutants act in spawn
     * order, then any scheduled spawn is added, so a new mutant first acts on the
     * next tick. `impacts` is there only on a tick when a shell landed.
     * @returns {{spawned: string[], attacks: Array<{mutantId, buildingId, damage, hp}>, destroyed: string[],
     *            impacts?: Array<{x, y, buildingId, soldierId}>}}
     */
    step() {
        if (this.#cycle.shift === Shift.DEFEATED) return NO_EFFECTS;
        if (this.#cycle.shift !== Shift.NIGHT) {
            this.#mutants.length = 0;
            this.#shells.length = 0;
            this.#plan = null;
            return NO_EFFECTS;
        }
        this.#plan ??= this.#resolvePlan();
        const slot = this.#plan.schedule.indexOf(this.#cycle.elapsedNightTicks);
        const spawnDue = slot !== -1;
        if (this.#mutants.length === 0 && this.#shells.length === 0 && !spawnDue) return NO_EFFECTS;

        const effects = {spawned: [], attacks: [], destroyed: []};
        const buildings = this.#placement.buildings();
        const byId = new Map(buildings.map((building) => [building.id, building]));
        const trucks = this.#logistics?.attackableTrucks() ?? [];
        const soldiers = this.#infantry?.attackableSoldiers() ?? [];
        this.#landShells(buildings, byId, effects, soldiers);
        if (this.#cycle.shift !== Shift.NIGHT) return effects; // HQ fell to a shell
        for (const mutant of this.#mutants) {
            this.#act(mutant, buildings, byId, effects, trucks, soldiers);
            if (this.#cycle.shift !== Shift.NIGHT) return effects; // HQ fell: the run ended on that hit
        }
        if (spawnDue) this.#spawn(buildings, byId, effects, this.#slotKind(slot));
        return effects;
    }

    /** What a schedule slot brings: null for an ordinary mutant. */
    #slotKind(slot) {
        const {spitterSlots, bruteSlots, absorbedSlots} = this.#plan;
        if (absorbedSlots?.includes(slot)) return ABSORBED;
        if (bruteSlots?.includes(slot)) return BRUTE.kind;
        return spitterSlots?.includes(slot) ? SPITTER.kind : null;
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
        return this.#mutants.map((mutant) => (mutant.aim ? {...mutant, aim: {...mutant.aim}} : {...mutant}));
    }

    /** Detached shells in flight, in release order. */
    shells() {
        return this.#shells.map((shell) => ({...shell}));
    }

    /** Detour use per living mutant, in spawn order, for QA and tests. */
    detours() {
        return this.#mutants.map((mutant) => {
            const {cells = null, extraTiles = 0, plans = 0} = this.#pathing.get(mutant) ?? {};
            return {id: mutant.id, following: cells !== null, extraTiles, plans};
        });
    }

    #resolvePlan() {
        if (!this.#planNight) {
            const slots = Object.entries(this.#composition).filter(([, list]) => list.length).map(([name, list]) => [name, Object.freeze([...list])]);
            return Object.freeze({schedule: Object.freeze([...this.#schedule]), ...Object.fromEntries(slots)});
        }
        const plan = this.#planNight(this.#cycle.day);
        assertValidSchedule(plan.schedule, this.#cycle.nightTicks);
        assertValidComposition(plan, plan.schedule);
        return plan;
    }

    #act(mutant, buildings, byId, effects, trucks, soldiers) {
        if (mutant.obstacleId && !byId.has(mutant.obstacleId)) mutant.obstacleId = null;
        if (!byId.has(mutant.targetId)) {
            mutant.targetId = selectTarget(mutant, buildings, this.#grid);
            this.#endDetour(mutant);
        }

        const target = byId.get(mutant.targetId);
        const rect = target ? this.#grid.footprintRect(target) : null;
        if (rect) this.#walkThroughOpenGate(mutant, rect, buildings, byId);
        if (mutant.shots > 0) {
            if (this.#shoot(mutant, rect, buildings, byId, soldiers)) return;
        } else if (this.#melee(mutant, target, rect, buildings, byId, effects, trucks, soldiers)) {
            return;
        }
        if (!rect) return; // no buildings left: wait for dawn
        const next = this.#nextStep(mutant, rect);
        const blocker = this.#blockerOf(mutant, next, buildings, byId);
        if (blocker) {
            this.#endDetour(mutant);
            const breaches = !isFortification(blocker) || mutant.kind === BRUTE.kind;
            if (breaches || !this.#planDetour(mutant, target, byId)) mutant.obstacleId = blocker.id;
            return;
        }
        mutant.x = next.x;
        mutant.y = next.y;
        this.#followDetour(mutant);
    }

    /** @returns {boolean} whether the mutant's tick is spent */
    #melee(mutant, target, rect, buildings, byId, effects, trucks, soldiers) {
        const attackId = mutant.obstacleId
            ?? (rect && distanceToFootprint(mutant, rect) <= MUTANT.attackRange ? target.id : null);
        // A truck in melee range holds a mutant's attention, but mutants never
        // seek trucks out, and a moving truck is soon out of reach again.
        const truck = trucks.find((t) => this.#inTruckRange(mutant, t));
        const soldier = truck ? null : soldiers.find((s) => distanceToFootprint(mutant, soldierBody(s)) <= MUTANT.attackRange);
        if (truck || soldier || attackId) {
            if (--mutant.attackTimer > 0) return true;
            if (truck) this.#attackTruck(mutant, truck, trucks);
            else if (soldier) this.#attackSoldier(mutant, soldier, soldiers);
            else this.#attack(mutant, attackId, buildings, byId, effects);
            return true;
        }

        // The attack timer only runs while stationary.
        const {speed, attackCooldownTicks} = statsOf(mutant);
        mutant.attackTimer = attackCooldownTicks;
        const lure = this.#lure(mutant, soldiers, buildings, byId);
        if (!lure) return false;
        Object.assign(mutant, nextPosition(mutant, lure, speed));
        return true;
    }

    /**
     * A Spitter's tick. A telegraph, once started, always ends in a shell. Before
     * that the timer runs down to the telegraph whether or not the Spitter is
     * walking, so losing a target cannot shorten the firing cycle.
     * @returns {boolean} whether it stays where it is; false means walk
     */
    #shoot(mutant, rect, buildings, byId, soldiers) {
        if (mutant.aim) {
            if (--mutant.attackTimer === 0) this.#release(mutant, buildings, byId);
            return true;
        }
        if (mutant.attackTimer > SPITTER.windupTicks) mutant.attackTimer--;
        const ready = mutant.attackTimer === SPITTER.windupTicks;
        const soldier = ready ? this.#nearestExposedSoldier(mutant, soldiers, buildings, byId) : null;
        const obstacle = byId.get(mutant.obstacleId);
        const structure = obstacle ? this.#grid.footprintRect(obstacle) : this.#inFiringRange(mutant, rect) ? rect : null;
        if (!soldier && !structure) return false;
        this.#endDetour(mutant);
        if (ready) mutant.aim = soldier ? {x: soldier.x, y: soldier.y, soldier: true} : {...nearestPoint(mutant, structure), soldier: false};
        return true;
    }

    #inFiringRange(mutant, rect) {
        return rect !== null && squaredDistance(mutant, nearestPoint(mutant, rect)) <= SPITTER.range ** 2;
    }

    /** The nearest soldier in retaliation range with nothing solid in the way. Ties go to the earliest. */
    #nearestExposedSoldier(mutant, soldiers, buildings, byId) {
        let nearest = null;
        let nearestDistance = SPITTER.retaliationRange ** 2;
        for (const soldier of soldiers) {
            const distance = squaredDistance(mutant, soldier);
            if (distance > nearestDistance || (nearest && distance === nearestDistance)) continue;
            if (this.#solidOnLine(mutant, soldier, buildings, byId)) continue;
            nearest = soldier;
            nearestDistance = distance;
        }
        return nearest;
    }

    #solidOnLine(from, to, buildings, byId) {
        return firstSolid(from, to, {grid: this.#grid, buildings, byId, isOpenGate: (id) => this.#gates?.isOpen(id) ?? false});
    }

    /** The line is judged now, as things stand. What it hits is settled from here on. */
    #release(mutant, buildings, byId) {
        const {x, y, soldier} = mutant.aim;
        const hit = this.#solidOnLine(mutant, mutant.aim, buildings, byId);
        const end = hit ?? {x, y};
        const ticks = flightTicks(mutant, end, SPITTER.shellSpeed);
        this.#shells.push({
            id: `shell-${this.#nextShellId++}`,
            mutantId: mutant.id,
            fromX: mutant.x,
            fromY: mutant.y,
            x: end.x,
            y: end.y,
            buildingId: hit ? hit.building.id : null,
            soldier: soldier && !hit,
            flightTicks: ticks,
            ticksLeft: ticks,
        });
        mutant.aim = null;
        mutant.shots--;
        mutant.attackTimer = mutant.shots > 0 ? SPITTER.cycleTicks : MUTANT.attackCooldownTicks;
    }

    #landShells(buildings, byId, effects, soldiers) {
        for (const shell of this.#shells) shell.ticksLeft--;
        const landing = this.#shells.filter((shell) => shell.ticksLeft === 0);
        if (landing.length === 0) return;
        this.#shells = this.#shells.filter((shell) => shell.ticksLeft > 0);
        for (const shell of landing) {
            this.#land(shell, buildings, byId, effects, soldiers);
            if (this.#cycle.shift !== Shift.NIGHT) return;
        }
    }

    /** What it was going to hit may be gone. That is a miss, and it finds nothing else. */
    #land(shell, buildings, byId, effects, soldiers) {
        const {x, y} = shell;
        const buildingId = byId.has(shell.buildingId) ? shell.buildingId : null;
        const victim = shell.soldier ? soldiers.find((s) => distanceToFootprint(shell, soldierBody(s)) === 0) : null;
        if (victim) this.#hurtSoldier(shell.mutantId, victim, SPITTER.damage, soldiers);
        if (buildingId) this.#hurtBuilding(shell.mutantId, buildingId, SPITTER.damage, buildings, byId, effects);
        (effects.impacts ??= []).push({x, y, buildingId, soldierId: victim?.id ?? null});
    }

    /** A gate attacked as an obstacle stops being one the moment it lets this mutant pass. */
    #walkThroughOpenGate(mutant, rect, buildings, byId) {
        if (!mutant.obstacleId || !this.#gates?.isOpen(mutant.obstacleId)) return;
        if (!this.#blockerOf(mutant, this.#nextStep(mutant, rect), buildings, byId)) mutant.obstacleId = null;
    }

    /** The next step: onto the map, then along a detour if there is one, otherwise straight at the target. */
    #nextStep(mutant, rect) {
        const path = this.#pathing.get(mutant);
        return this.#stepOntoMap(mutant) ?? nextPosition(mutant, path?.cells ? path.cells[path.index] : rect, statsOf(mutant).speed);
    }

    /** Being outside the map is only ever where a spawn left a mutant: its one move is inward. */
    #stepOntoMap({x, y}) {
        const {x: left, y: top, width, height} = this.#bounds;
        const onMap = {x: Math.min(Math.max(x, left), left + width), y: Math.min(Math.max(y, top), top + height)};
        return onMap.x === x && onMap.y === y ? null : onMap;
    }

    /** What stops a step to `next`, unless it is an open gate being walked along its axis. */
    #blockerOf(mutant, next, buildings, byId) {
        const axis = next.x !== mutant.x ? 'x' : 'y';
        return gridBlockerAt(next, buildings, byId, this.#grid, (building) => this.#gates?.allows(building, axis));
    }

    /** The tile a mutant is on. One just outside the map counts as on the edge tile. */
    #cellOf({x, y}) {
        const {originX, originY, tileSize, cols, rows} = this.#grid;
        return {
            col: Math.min(Math.max(Math.floor((x - originX) / tileSize), 0), cols - 1),
            row: Math.min(Math.max(Math.floor((y - originY) / tileSize), 0), rows - 1),
        };
    }

    /** Can a mutant be on this tile for a step along `axis`? Open gates pass their own axis only. */
    #open(col, row, axis, byId) {
        const id = this.#grid.occupantAt(col, row);
        if (id === null) return true;
        const building = byId.get(id);
        return Boolean(building) && Boolean(this.#gates?.allows(building, axis));
    }

    /**
     * Breadth-first search for an open way to a free tile next to the target's
     * footprint, never onto an occupied one, expanding N, E, S, W so that ties
     * always resolve the same way. Depth is limited to the direct distance plus
     * what the mutant may still spend, which keeps the search small. The budget
     * is only charged when a detour is found.
     * @returns {boolean} whether a detour was set
     */
    #planDetour(mutant, target, byId) {
        const path = this.#pathing.get(mutant) ?? {cells: null, index: 0, extraTiles: 0, plans: 0};
        if (path.plans >= DETOUR.maxPlans) return false;
        const start = this.#cellOf(mutant);
        if (this.#grid.occupantAt(start.col, start.row) !== null) return false; // outside the map at a wall, or caught in a gate

        const {col: left, row: top, width, height} = target;
        const gapX = (col) => Math.max(left - col, 0, col - (left + width - 1));
        const gapY = (row) => Math.max(top - row, 0, row - (top + height - 1));
        const direct = gapX(start.col) + gapY(start.row) - 1;
        const limit = direct + Math.min(DETOUR.maxExtraTiles, DETOUR.maxTotalExtraTiles - path.extraTiles);

        const {cols, rows} = this.#grid;
        const startKey = start.row * cols + start.col;
        const cameFrom = new Map([[startKey, -1]]);
        const depth = new Map([[startKey, 0]]);
        const queue = [startKey];
        for (let i = 0; i < queue.length; i++) {
            const key = queue[i];
            const col = key % cols;
            const row = (key - col) / cols;
            const steps = depth.get(key);
            if (gapX(col) + gapY(row) === 1 && this.#grid.occupantAt(col, row) === null) {
                this.#startDetour(mutant, path, cameFrom, key, Math.max(0, steps - direct));
                return true;
            }
            if (steps >= limit) continue;
            for (const [dc, dr] of CELL_STEPS) {
                const nextCol = col + dc;
                const nextRow = row + dr;
                const nextKey = nextRow * cols + nextCol;
                if (nextCol < 0 || nextRow < 0 || nextCol >= cols || nextRow >= rows || cameFrom.has(nextKey)) continue;
                const axis = dc !== 0 ? 'x' : 'y';
                if (!this.#open(nextCol, nextRow, axis, byId) || !this.#open(col, row, axis, byId)) continue;
                cameFrom.set(nextKey, key);
                depth.set(nextKey, steps + 1);
                queue.push(nextKey);
            }
        }
        return false;
    }

    #startDetour(mutant, path, cameFrom, goal, extraTiles) {
        const {cols} = this.#grid;
        const cells = [];
        for (let key = goal; key !== -1; key = cameFrom.get(key)) {
            const col = key % cols;
            const {x, y} = this.#grid.cellCenter(col, (key - col) / cols);
            cells.push({x, y, width: 0, height: 0});
        }
        this.#pathing.set(mutant, {
            cells: cells.reverse(), index: 0, extraTiles: path.extraTiles + extraTiles, plans: path.plans + 1,
        });
    }

    #followDetour(mutant) {
        const path = this.#pathing.get(mutant);
        if (!path?.cells) return;
        const {x, y} = path.cells[path.index];
        if (mutant.x !== x || mutant.y !== y) return;
        if (++path.index === path.cells.length) this.#endDetour(mutant);
    }

    /** What the mutant has spent stays spent. */
    #endDetour(mutant) {
        const path = this.#pathing.get(mutant);
        if (path) path.cells = null;
    }

    /** A truck counts as one road tile, so melee range works as it does for a 1x1 building. */
    #inTruckRange(mutant, {x, y}) {
        const {tileSize} = this.#grid;
        const rect = {x: x - tileSize / 2, y: y - tileSize / 2, width: tileSize, height: tileSize};
        return distanceToFootprint(mutant, rect) <= MUTANT.attackRange;
    }

    #attackTruck(mutant, truck, trucks) {
        const {attackDamage, attackCooldownTicks} = statsOf(mutant);
        mutant.attackTimer = attackCooldownTicks;
        const result = this.#logistics.damageTruck(truck.id, attackDamage);
        if (!result.ok) throw new Error(`Mutant ${mutant.id} could not damage ${truck.id}: ${result.reason}`);
        if (result.destroyed) trucks.splice(trucks.indexOf(truck), 1);
    }

    #attackSoldier(mutant, soldier, soldiers) {
        const {attackDamage, attackCooldownTicks} = statsOf(mutant);
        mutant.attackTimer = attackCooldownTicks;
        this.#hurtSoldier(mutant.id, soldier, attackDamage, soldiers);
    }

    #hurtSoldier(mutantId, soldier, damage, soldiers) {
        const result = this.#infantry.damageSoldier(soldier.id, damage);
        if (!result.ok) throw new Error(`Mutant ${mutantId} could not damage ${soldier.id}: ${result.reason}`);
        if (result.killed) soldiers.splice(soldiers.indexOf(soldier), 1);
    }

    /**
     * The body of the nearest soldier within LURE_RANGE, if the way there is
     * clear. A mutant on a detour keeps to it. Ties go to the earliest soldier.
     * @returns {object|null} a rectangle to walk towards
     */
    #lure(mutant, soldiers, buildings, byId) {
        if (soldiers.length === 0 || this.#pathing.get(mutant)?.cells || this.#stepOntoMap(mutant)) return null;
        let nearest = null;
        let nearestDistance = LURE_RANGE;
        for (const soldier of soldiers) {
            const body = soldierBody(soldier);
            const distance = distanceToFootprint(mutant, body);
            if (distance > nearestDistance || (nearest && distance === nearestDistance)) continue;
            nearest = body;
            nearestDistance = distance;
        }
        return nearest && this.#clearWay(mutant, nearest, buildings, byId) ? nearest : null;
    }

    /** Walk the whole way in advance, step for step. At most LURE_RANGE / speed steps. */
    #clearWay(mutant, body, buildings, byId) {
        const {speed} = statsOf(mutant);
        let at = mutant;
        while (distanceToFootprint(at, body) > MUTANT.attackRange) {
            const next = nextPosition(at, body, speed);
            if (this.#blockerOf(at, next, buildings, byId)) return false;
            at = next;
        }
        return true;
    }

    #attack(mutant, buildingId, buildings, byId, effects) {
        const {attackDamage, attackCooldownTicks} = statsOf(mutant);
        mutant.attackTimer = attackCooldownTicks;
        this.#hurtBuilding(mutant.id, buildingId, attackDamage, buildings, byId, effects);
    }

    #hurtBuilding(mutantId, buildingId, damage, buildings, byId, effects) {
        const result = this.#placement.damageBuilding(buildingId, damage);
        if (!result.ok) throw new Error(`Mutant ${mutantId} could not damage ${buildingId}: ${result.reason}`);
        effects.attacks.push({mutantId, buildingId, damage, hp: result.hp});
        if (result.destroyed) {
            effects.destroyed.push(buildingId);
            const [building] = buildings.splice(buildings.findIndex((b) => b.id === buildingId), 1);
            byId.delete(buildingId);
            if (building.type === HQ_TYPE) this.#cycle.defeat();
        }
    }

    /**
     * Exactly one RNG draw picks a border position, whatever the board looks
     * like. If that border cell holds a building the next position clockwise is
     * used, and if none is left this spawn is skipped. A fortification does not
     * displace a spawn: the mutant arrives outside it instead, so fortifying the
     * border can neither cancel a wave nor funnel it to the cells left open.
     */
    #spawn(buildings, byId, effects, kind) {
        const start = this.#rng.nextInt(0, this.#spawns.length - 1);
        if (kind === ABSORBED) return;
        for (let i = 0; i < this.#spawns.length; i++) {
            const spawn = this.#spawns[(start + i) % this.#spawns.length];
            const occupant = this.#grid.occupantAt(spawn.col, spawn.row);
            const building = byId.get(occupant);
            const fortified = Boolean(building) && isFortification(building);
            if (occupant !== null && !fortified) continue;
            const {x, y} = fortified ? this.#outsideMap(spawn) : spawn;
            const id = `mutant-${this.#nextId++}`;
            const {hp, attackTimer, extra} = freshStats(kind);
            this.#mutants.push({
                id,
                x,
                y,
                hp,
                targetId: selectTarget({x, y}, buildings, this.#grid),
                obstacleId: null,
                attackTimer,
                ...extra,
            });
            effects.spawned.push(id);
            return;
        }
    }

    /**
     * One step beyond a border position. Bounds are closed, so a mutant on the
     * map edge would be touching the fortification; one step out it stands clear
     * of it, and its first step in is an ordinary blocked step.
     */
    #outsideMap({x, y}) {
        const {x: left, y: top, height} = this.#bounds;
        if (y === top) return {x, y: y - MUTANT.speed};
        if (y === top + height) return {x, y: y + MUTANT.speed};
        return {x: x === left ? x - MUTANT.speed : x + MUTANT.speed, y};
    }
}
