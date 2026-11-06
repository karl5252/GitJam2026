/**
 * Barracks squads. Pure: no Phaser, no wall clock and no randomness.
 *
 * step() runs once per tick, after Gates.step() and before Mutants.step(), so a
 * mutant shot dead cannot act on that tick, and every gate has its record before
 * a soldier asks about it. Soldiers act on Night ticks 1..3599. Outside Night
 * nothing exists: everyone goes back inside at dawn and a full squad musters the
 * next Night, so no unit state crosses a Day and Day edits can never strand one.
 *
 * Deployment counts powered ticks. A squad leaves on its Barracks' powered ticks
 * 1, 31, 61 and 91. After that, while below strength, one replacement arrives per
 * 600 powered ticks, free of charge. Losing power pauses both, and soldiers
 * already out fight on. A destroyed Barracks sends nobody else: its survivors hold
 * their last post until they die or dawn comes.
 *
 * Movement ignores roads. A soldier walks from tile centre to tile centre, down
 * the walk field its squad shares, so it cannot clip a footprint. It always
 * finishes the edge it is on. Fields are rebuilt only when placement.revision
 * changes, and no building appears at Night, so regions only ever merge: a
 * soldier always has a way to its post.
 *
 * Gates work as they do for trucks. A soldier waits at the tile centre before a
 * gate until it is OPEN, and asks for every gate on the tile it stands on, is
 * entering or is waiting for. Only standing on the far tile releases it, so
 * nothing a soldier does in the doorway can let the gate close on it: on a gate
 * tile it ignores combat and keeps walking. Soldiers never attack anything of
 * yours.
 *
 * A soldier fires at whatever is in range, even on the march, and shots pass over
 * walls and buildings, like Autocannon fire. It picks targets near its POST, so
 * it defends a place. Within leashTiles of the post it stops to fight, or closes
 * on a target that is out of range; beyond that it keeps walking home.
 *
 * A Barracks refitted for rockets musters a squad of two, who do all of this the
 * same way with a different weapon. They pick the nearest Brute they can, over
 * anything else and any lock. A rocket is a real projectile: it flies over walls to
 * the point its target stood on and hits only a mutant whose body covers that point
 * when it lands, so a slow Brute is hit and a walking mutant can be missed. It
 * outlives its soldier and goes at dawn. Rifle soldiers have no role on their
 * records, so a base without rockets is exactly what it was.
 */
import {BarracksRole} from './buildingTypes.js';
import {calculatePower} from './power.js';
import {barracksExit} from './roads.js';
import {Shift} from './shiftCycle.js';
import {bodyRadius, flightTicks, isBrute, mutantAt} from './shots.js';
import {isGate, nextStep, openNeighbors, resolvePost, walkMap} from './walkField.js';

export const INFANTRY = Object.freeze({
    squadSize: 4,
    maxHp: 30,
    speed: 1, // px per tick; must divide the tile size
    weaponRange: 96, // px, from the soldier
    damage: 5,
    cooldownTicks: 90,
    defendRadius: 160, // px from the post: a mutant this close gets attention
    releaseRadius: 192, // px from the post: a locked target this far away is let go
    leashTiles: 4, // walking tiles from the post
    deployGapTicks: 30,
    replaceTicks: 600,
    bodySize: 12, // px, what a mutant has to reach
});

/** What a rocket squad changes. Everything else is INFANTRY. */
export const ROCKET = Object.freeze({
    role: BarracksRole.ROCKET,
    squadSize: 2,
    weaponRange: 128, // px, from the soldier
    damage: 120,
    cooldownTicks: 480,
    rocketSpeed: 5, // px per tick along the longer axis
});

const weaponOf = ({role}) => (role === ROCKET.role ? ROCKET : INFANTRY);

/** Where each squad member stands on its post, in px from the tile centre. */
const SLOTS = Object.freeze([[-8, -8], [8, -8], [-8, 8], [8, 8]]);

export const UNKNOWN_SOLDIER = 'unknown-soldier';
export const INVALID_DAMAGE = 'invalid-damage';

const NO_EFFECTS = Object.freeze({shots: Object.freeze([])});
const squaredDistance = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const sameCell = (a, b) => a.col === b.col && a.row === b.row;
const emptyTally = () => ({deployed: 0, lost: 0, shots: 0, kills: 0});

/**
 * Nearest eligible mutant, ties going to the earliest in the list, which is spawn
 * order. A mutant in weapon range is always nearer than one that is not.
 * @param {{x, y}} soldier
 * @param {{x, y}} post the centre of the post
 * @param {number} [weaponRange]
 * @returns {object|null}
 */
export function selectInfantryTarget(soldier, post, mutants, weaponRange = INFANTRY.weaponRange) {
    let best = null;
    for (const mutant of mutants) {
        if (squaredDistance(soldier, mutant) > weaponRange ** 2
            && squaredDistance(post, mutant) > INFANTRY.defendRadius ** 2) continue;
        if (!best || squaredDistance(soldier, mutant) < squaredDistance(soldier, best)) best = mutant;
    }
    return best;
}

export class Infantry {
    #cycle;
    #placement;
    #grid;
    #gates;
    #mutants;
    #squads = new Map(); // Barracks id -> squad, Night only
    #soldiers = []; // creation order, Night only
    #rockets = []; // in firing order, Night only
    #nextRocketId = 1;
    #map = null;
    #revision = -1;
    #nextId = 1;
    #living = [];
    #night = emptyTally();
    #totals = emptyTally();

    /**
     * @param {{cycle: import('./shiftCycle.js').ShiftCycle,
     *          placement: import('./buildingPlacement.js').BuildingPlacement,
     *          grid: import('./grid.js').Grid,
     *          gates: import('./gates.js').Gates,
     *          mutants: import('./mutants.js').Mutants}} deps
     */
    constructor({cycle, placement, grid, gates, mutants}) {
        this.#cycle = cycle;
        this.#placement = placement;
        this.#grid = grid;
        this.#gates = gates;
        this.#mutants = mutants;
    }

    /**
     * One simulation tick.
     * A rocket appears in `shots` when it hits, marked `rocket`, and in `impacts`,
     * which is there only on a tick when one landed.
     * @returns {{shots: Array<{soldierId, mutantId, damage, hp, killed, fromX, fromY, x, y, rocket?: true}>,
     *            impacts?: Array<{x, y, mutantId: string|null}>}}
     */
    step() {
        const shift = this.#cycle.shift;
        if (shift === Shift.DEFEATED) return NO_EFFECTS;
        if (shift !== Shift.NIGHT) {
            this.#standDown();
            return NO_EFFECTS;
        }
        const barracks = this.#placement.barracks();
        if (barracks.length === 0 && this.#squads.size === 0 && this.#rockets.length === 0) return NO_EFFECTS;
        const shots = [];
        const impacts = this.#landRockets(shots);
        this.#sync(barracks);
        this.#refreshNavigation(barracks);

        this.#living = this.#mutants.snapshot();
        for (const soldier of this.#soldiers) this.#act(soldier, shots);
        this.#deploy();
        if (impacts.length) return {shots, impacts};
        return shots.length ? {shots} : NO_EFFECTS;
    }

    /** Detached rockets in flight, in firing order. */
    rockets() {
        return this.#rockets.map((rocket) => ({...rocket}));
    }

    /**
     * Add the gates soldiers need to `wanted`. Called before Gates.step(), from
     * where soldiers ended the last tick. Reads the grid and the building's type
     * rather than the gate records, which do not exist until the first gate step.
     * @param {Set<string>} wanted
     */
    addGateDemands(wanted) {
        for (const {col, row, next, held} of this.#soldiers) {
            for (const cell of [{col, row}, next, held]) {
                if (!cell || !isGate(this.#map, cell)) continue;
                const id = this.#grid.occupantAt(cell.col, cell.row);
                if (id !== null) wanted.add(id); // a destroyed gate stays on the map until the next rebuild
            }
        }
    }

    /**
     * Apply damage to a soldier. This is the only way soldier HP changes.
     * @returns {{ok: true, killed: boolean, hp: number} | {ok: false, reason: string}}
     */
    damageSoldier(id, amount) {
        if (!Number.isSafeInteger(amount) || amount <= 0) return {ok: false, reason: INVALID_DAMAGE};
        const index = this.#soldiers.findIndex((soldier) => soldier.id === id);
        if (index === -1) return {ok: false, reason: UNKNOWN_SOLDIER};
        const soldier = this.#soldiers[index];
        soldier.hp = Math.max(0, soldier.hp - amount);
        if (soldier.hp > 0) return {ok: true, killed: false, hp: soldier.hp};
        this.#soldiers.splice(index, 1);
        this.#squads.get(soldier.barracksId).slots[soldier.slot] = false;
        for (const tally of [this.#night, this.#totals]) tally.lost++;
        return {ok: true, killed: true, hp: 0};
    }

    /** Soldiers within reach of a mutant, in creation order. */
    attackableSoldiers() {
        return this.#soldiers.map(({id, x, y}) => ({id, x, y}));
    }

    /** Detached soldier records, in creation order. */
    soldiers() {
        return this.#soldiers.map((soldier) => ({
            ...soldier,
            next: soldier.next && {...soldier.next},
            held: soldier.held && {...soldier.held},
        }));
    }

    /**
     * Where every standing Barracks' squad belongs, derived from the buildings.
     * @returns {Array<{id, exit, flag, post, blocked}>}
     */
    posts() {
        const barracks = this.#placement.barracks();
        if (barracks.length === 0) return [];
        const map = walkMap(this.#grid, this.#placement.buildings());
        return barracks.map((building) => {
            const exit = barracksExit(building);
            const {post, blocked} = resolvePost(map, exit, building.flag);
            return {id: building.id, exit, flag: building.flag, post, blocked};
        });
    }

    /** Detached, JSON-serializable state. Reading it changes nothing. */
    snapshot() {
        return {
            posts: this.posts(),
            squads: [...this.#squads.values()].map(({id, pending, deployTimer, replaceTimer, orphaned, post, blocked, role}) => ({
                id, pending, deployTimer, replaceTimer, orphaned, post: {...post}, blocked, ...(role ? {role} : {}),
                living: this.#soldiers.filter((soldier) => soldier.barracksId === id).length,
            })),
            soldiers: this.soldiers(),
            night: {...this.#night},
            totals: {...this.#totals},
        };
    }

    #standDown() {
        if (this.#squads.size === 0 && this.#rockets.length === 0) return;
        this.#squads.clear();
        this.#soldiers.length = 0;
        this.#rockets.length = 0;
        this.#living = [];
        this.#night = emptyTally();
    }

    /** Squads follow the Barracks, except that one with soldiers left outlives its building. */
    #sync(barracks) {
        const standing = new Set(barracks.map((building) => building.id));
        for (const [id, squad] of this.#squads) {
            if (standing.has(id)) continue;
            squad.orphaned = true;
            if (!this.#soldiers.some((soldier) => soldier.barracksId === id)) this.#squads.delete(id);
        }
        for (const building of barracks) {
            if (this.#squads.has(building.id)) continue;
            const {squadSize} = weaponOf(building);
            this.#squads.set(building.id, {
                id: building.id,
                role: building.role ?? null,
                exit: barracksExit(building),
                pending: squadSize,
                deployTimer: 1,
                replaceTimer: 0,
                slots: new Array(squadSize).fill(false),
                orphaned: false,
                post: null,
                blocked: false,
                field: null,
            });
            this.#revision = -1;
        }
    }

    /** Anything that changes walking changes the revision, so nothing is rebuilt in between. */
    #refreshNavigation(barracks) {
        if (this.#revision === this.#placement.revision) return;
        this.#revision = this.#placement.revision;
        this.#map = walkMap(this.#grid, this.#placement.buildings());
        const flags = new Map(barracks.map((building) => [building.id, building.flag]));
        for (const squad of this.#squads.values()) {
            const flag = squad.orphaned ? squad.post : flags.get(squad.id);
            Object.assign(squad, resolvePost(this.#map, squad.exit, flag));
        }
    }

    #centerOf({col, row}) {
        return this.#grid.cellCenter(col, row);
    }

    #act(soldier, shots) {
        const squad = this.#squads.get(soldier.barracksId);
        if (soldier.cooldown > 0) soldier.cooldown--;
        let target = this.#aim(soldier, squad);
        if (target && soldier.cooldown === 0 && this.#inWeaponRange(soldier, target) && this.#fire(soldier, target, shots)) {
            target = null;
        }
        this.#move(soldier, squad, target);
    }

    #inWeaponRange(soldier, mutant) {
        return squaredDistance(soldier, mutant) <= weaponOf(soldier).weaponRange ** 2;
    }

    /** Keep a lock until the target dies or leaves both the gun and the defended area. */
    #aim(soldier, squad) {
        const post = this.#centerOf(squad.post);
        const {weaponRange} = weaponOf(soldier);
        const heavy = soldier.role ? selectInfantryTarget(soldier, post, this.#living.filter(isBrute), weaponRange) : null;
        const locked = this.#living.find((mutant) => mutant.id === soldier.targetId);
        const keep = locked && (this.#inWeaponRange(soldier, locked) || squaredDistance(post, locked) <= INFANTRY.releaseRadius ** 2);
        const target = heavy ?? (keep ? locked : selectInfantryTarget(soldier, post, this.#living, weaponRange));
        soldier.targetId = target ? target.id : null;
        return target;
    }

    /** @returns {boolean} whether the target died */
    #fire(soldier, target, shots) {
        if (soldier.role) {
            this.#launch(soldier, target);
            return false;
        }
        soldier.cooldown = INFANTRY.cooldownTicks;
        const result = this.#mutants.damageMutant(target.id, INFANTRY.damage);
        if (!result.ok) throw new Error(`${soldier.id} could not damage ${target.id}: ${result.reason}`);
        for (const tally of [this.#night, this.#totals]) {
            tally.shots++;
            if (result.killed) tally.kills++;
        }
        shots.push({
            soldierId: soldier.id, mutantId: target.id, damage: INFANTRY.damage, hp: result.hp, killed: result.killed,
            fromX: soldier.x, fromY: soldier.y, x: target.x, y: target.y,
        });
        if (result.killed) {
            this.#living = this.#mutants.snapshot();
            soldier.targetId = null;
        }
        return result.killed;
    }

    /** Aimed at where the target stands now. What it hits is settled when it lands. */
    #launch(soldier, {x, y}) {
        soldier.cooldown = ROCKET.cooldownTicks;
        const ticks = flightTicks(soldier, {x, y}, ROCKET.rocketSpeed);
        this.#rockets.push({
            id: `rocket-${this.#nextRocketId++}`, soldierId: soldier.id, fromX: soldier.x, fromY: soldier.y, x, y, flightTicks: ticks, ticksLeft: ticks,
        });
        for (const tally of [this.#night, this.#totals]) tally.shots++;
    }

    /** Oldest first, each seeing what the one before it left. */
    #landRockets(shots) {
        if (this.#rockets.length === 0) return [];
        for (const rocket of this.#rockets) rocket.ticksLeft--;
        const landing = this.#rockets.filter((rocket) => rocket.ticksLeft === 0);
        if (landing.length === 0) return [];
        this.#rockets = this.#rockets.filter((rocket) => rocket.ticksLeft > 0);
        return landing.map((rocket) => {
            const {soldierId, fromX, fromY, x, y} = rocket;
            const victim = mutantAt(rocket, this.#mutants.snapshot(), bodyRadius);
            if (!victim) return {x, y, mutantId: null};
            const result = this.#mutants.damageMutant(victim.id, ROCKET.damage);
            if (!result.ok) throw new Error(`A rocket could not damage ${victim.id}: ${result.reason}`);
            if (result.killed) for (const tally of [this.#night, this.#totals]) tally.kills++;
            shots.push({
                soldierId, mutantId: victim.id, damage: ROCKET.damage, hp: result.hp, killed: result.killed, fromX, fromY, x, y, rocket: true,
            });
            return {x, y, mutantId: victim.id};
        });
    }

    #move(soldier, squad, target) {
        soldier.held = null;
        if (soldier.next) {
            this.#walkEdge(soldier);
            return;
        }
        // In a doorway nothing matters but getting out of it.
        const inDoorway = isGate(this.#map, soldier);
        if (target && !inDoorway && this.#withinLeash(soldier, squad)) {
            if (!this.#inWeaponRange(soldier, target)) this.#close(soldier, squad, target);
            return;
        }
        this.#march(soldier, squad);
    }

    #withinLeash(cell, squad) {
        return squad.field[cell.row * this.#grid.cols + cell.col] <= INFANTRY.leashTiles;
    }

    /** One tile closer to a target out of range, if the leash allows. Never into a gate. */
    #close(soldier, squad, target) {
        if (!this.#atCentre(soldier)) {
            this.#walkTo(soldier, this.#centerOf(soldier));
            return;
        }
        let best = null;
        let bestDistance = squaredDistance(soldier, target);
        for (const cell of openNeighbors(this.#map, soldier)) {
            const distance = squaredDistance(this.#centerOf(cell), target);
            if (distance >= bestDistance || !this.#withinLeash(cell, squad)) continue;
            best = cell;
            bestDistance = distance;
        }
        if (!best) return;
        soldier.next = best;
        this.#walkEdge(soldier);
    }

    #march(soldier, squad) {
        if (sameCell(soldier, squad.post)) {
            const {x, y} = this.#centerOf(squad.post);
            const [dx, dy] = SLOTS[soldier.slot];
            this.#walkTo(soldier, {x: x + dx, y: y + dy});
            return;
        }
        if (!this.#atCentre(soldier)) {
            this.#walkTo(soldier, this.#centerOf(soldier));
            return;
        }
        const step = nextStep(this.#map, squad.field, soldier);
        if (!step) return;
        if (isGate(this.#map, step) && !this.#gateIsPassable(step)) {
            soldier.held = step;
            return;
        }
        soldier.next = step;
        this.#walkEdge(soldier);
    }

    /** A gate that has fallen since the map was built is no longer in the way. */
    #gateIsPassable({col, row}) {
        const id = this.#grid.occupantAt(col, row);
        return id === null || this.#gates.isOpen(id);
    }

    #atCentre(soldier) {
        const {x, y} = this.#centerOf(soldier);
        return soldier.x === x && soldier.y === y;
    }

    /** Along one axis at a time, within a tile. */
    #walkTo(soldier, {x, y}) {
        if (soldier.x !== x) soldier.x += Math.sign(x - soldier.x) * INFANTRY.speed;
        else if (soldier.y !== y) soldier.y += Math.sign(y - soldier.y) * INFANTRY.speed;
    }

    /** Only reaching the far tile's centre ends an edge, and with it the demand on a gate behind. */
    #walkEdge(soldier) {
        const goal = this.#centerOf(soldier.next);
        this.#walkTo(soldier, goal);
        if (soldier.x !== goal.x || soldier.y !== goal.y) return;
        soldier.col = soldier.next.col;
        soldier.row = soldier.next.row;
        soldier.next = null;
    }

    #deploy() {
        let powered = null;
        for (const squad of this.#squads.values()) {
            if (squad.orphaned) continue;
            const living = squad.slots.filter(Boolean).length;
            if (squad.pending === 0 && living === squad.slots.length) continue;
            powered ??= this.#poweredIds();
            if (!powered.has(squad.id)) continue;
            if (squad.pending > 0) {
                if (--squad.deployTimer > 0) continue;
                squad.pending--;
                squad.deployTimer = INFANTRY.deployGapTicks;
                this.#muster(squad);
            } else if (++squad.replaceTimer >= INFANTRY.replaceTicks) {
                squad.replaceTimer = 0;
                this.#muster(squad);
            }
        }
    }

    #poweredIds() {
        return new Set(calculatePower(this.#placement.buildings()).buildings.filter((b) => b.powered).map((b) => b.id));
    }

    #muster(squad) {
        const slot = squad.slots.indexOf(false);
        squad.slots[slot] = true;
        const {col, row} = squad.exit;
        this.#soldiers.push({
            id: `soldier-${this.#nextId++}`,
            barracksId: squad.id,
            slot,
            col,
            row,
            ...this.#centerOf(squad.exit),
            hp: INFANTRY.maxHp,
            cooldown: 0,
            targetId: null,
            next: null,
            held: null,
            ...(squad.role ? {role: squad.role} : {}),
        });
        for (const tally of [this.#night, this.#totals]) tally.deployed++;
    }
}
