/**
 * TASK 027, ECOLOGISTAS!: environmental protesters. Pure: no Phaser.
 *
 * Neutral civilians, drawn by industry and Pollution. On a running timed Day,
 * groups walk in from the dirt path's map-edge end (the road from town) to a
 * player road on an active Factory's or Mine's truck route, gather there, and
 * protest for a while. A protest blocks trucks: one at a tile centre waits while
 * the next tile is a protest site (Logistics.setBlockers), keeping its route and
 * cargo. Each group protests once, then walks back out, so nothing deadlocks.
 *
 * Dusk ends every protest at once, and every ecologist still on the map panics
 * and runs for the exit at twice the walking speed. Nobody is removed because
 * Night has come: survivors keep running through the Night and leave only on the
 * exit tile. A mutant that touches one kills it (1 HP), with no combat of its own:
 * mutants never seek ecologists out, never stop for them and gain nothing.
 *
 * Movement reuses core/walkField.js, with every gate treated as a wall, so walls
 * and gates keep protesters off a lane and nobody ever passes a fortification.
 * Randomness comes from its own stream, so terrain and mutant draws are untouched.
 * None of this exists on a map without terrain, or outside the ACTIVE cycle.
 */
import {HQ_TYPE, WALL_TYPE, getBuildingType} from './buildingTypes.js';
import {calculatePower} from './power.js';
import {ROAD_ACCESS_TYPES, receivingDock, shippingDock} from './roads.js';
import {SeededRandom} from './seededRandom.js';
import {Shift} from './shiftCycle.js';
import {bodyRadius} from './shots.js';
import {mixSeed} from './terrain.js';
import {approach, groundAt, speedOn} from './terrainSpeed.js';
import {UNREACHABLE, isFree, nextStep, walkField, walkMap} from './walkField.js';

/** Provisional playtest values. */
export const ECOLOGIST = Object.freeze({
    pollutionPerGroup: 40, // groups a Day: min(maxGroups, 1 + floor(Pollution / 40))
    maxGroups: 3,
    arrivalTicks: Object.freeze([600, 1500, 2400]), // Day ticks
    size: Object.freeze({min: 3, max: 4}),
    leaveGapTicks: 30, // members set off one at a time
    protestTicks: 900,
    speed: 1, // px per tick on open ground, as workers
    fleeSpeed: 2,
    hp: 1,
    bodyRadius: 6, // a mutant this close (plus its own body) has touched one
    corpseTicks: 120,
    salt: 0x3c0e1a27,
});

export const EcologistState = Object.freeze({
    ARRIVING: 'arriving', // walking to the site
    GATHERING: 'gathering', // at the site, waiting for the rest of the group
    PROTESTING: 'protesting',
    LEAVING: 'leaving', // walking out after the protest
    FLEEING: 'fleeing', // Dusk or Night: running for the exit
    DEAD: 'dead', // a corpse, for the death frames only
});

export const EcologistFailure = Object.freeze({UNIT_IN_THE_WAY: 'unit-in-the-way'});

/** Where members of a group stand on their site, about its centre. */
const SLOTS = Object.freeze([[-8, -8], [8, -8], [-8, 8], [8, 8]]);

const key = ({col, row}) => `${col},${row}`;
const sameCell = (a, b) => a.col === b.col && a.row === b.row;
const ALIVE = (e) => e.state !== EcologistState.DEAD;

/** How many groups a Day brings at this Pollution. */
export const groupsFor = (pollution) => Math.min(ECOLOGIST.maxGroups, 1 + Math.floor(pollution / ECOLOGIST.pollutionPerGroup));

export class Ecologists {
    #cycle;
    #placement;
    #grid;
    #roads;
    #pollution;
    #mutants;
    #rng;
    #ecologists = [];
    #groups = [];
    #nextId = 1;
    #nextGroup = 1;
    #day = null; // the Day whose arrivals are planned
    #arrivals = [];
    #map = null;
    #revision = null;
    #fields = new Map(); // goal key -> walk field
    #totals = {groups: 0, arrived: 0, protests: 0, escaped: 0, killed: 0};

    /**
     * @param {{cycle, placement, grid, roads, pollution, mutants?, seed: number}} deps
     *   mutants - read for contact only: nothing here changes a mutant
     */
    constructor({cycle, placement, grid, roads, pollution, mutants = null, seed}) {
        this.#cycle = cycle;
        this.#placement = placement;
        this.#grid = grid;
        this.#roads = roads;
        this.#pollution = pollution;
        this.#mutants = mutants;
        this.#rng = new SeededRandom(mixSeed((seed ^ ECOLOGIST.salt) >>> 0));
        placement.addGuard?.((question) => this.#guard(question));
    }

    /** Is there anything to do here at all? A map with terrain, in the ACTIVE cycle. */
    get #enabled() {
        return this.#cycle.timed === true && Boolean(this.#grid.terrain?.path?.length) && this.#roads !== null;
    }

    /**
     * One tick, after Mutants.step(), so contact is judged where mutants now stand,
     * and before Logistics.step(), which reads blockedTiles().
     * @returns {{arrived: number, protestsStarted: number, killed: string[], escaped: number}}
     */
    step() {
        const effects = {arrived: 0, protestsStarted: 0, killed: [], escaped: 0};
        const shift = this.#cycle.shift;
        if (!this.#enabled || shift === Shift.DEFEATED) return effects;
        if (shift === Shift.DAY && this.#cycle.deployment) return effects; // Day 0 never ticks anyway
        this.#refreshNavigation();
        if (shift === Shift.DAY) this.#arrive(effects);
        else this.#panic();
        this.#releaseCorpses();
        for (const ecologist of this.#ecologists) {
            if (ecologist.state === EcologistState.DEAD) continue;
            this.#move(ecologist, effects);
        }
        this.#tidyGroups(effects);
        this.#contact(effects);
        return effects;
    }

    /** Road tiles a protest is blocking right now: only standing, protesting ecologists block. */
    blockedTiles() {
        const blocked = new Set();
        for (const group of this.#groups) {
            if (group.state !== EcologistState.PROTESTING) continue;
            const standing = this.#members(group).some((e) => e.state === EcologistState.PROTESTING && sameCell(e, group.site));
            if (standing && this.#roads.has(group.site)) blocked.add(key(group.site));
        }
        return blocked;
    }

    /** Detached state. Reading it changes nothing. */
    snapshot() {
        return {
            ecologists: this.#ecologists.map(({id, group, state, col, row, x, y, hp, next, timer}) => ({
                id, group, state, col, row, x, y, hp, next: next ? {...next} : null, timer,
            })),
            groups: this.#groups.map(({id, site, state, timer, size, members}) => ({id, site: {...site}, state, timer, size, members: [...members]})),
            blocked: [...this.blockedTiles()].map((k) => {
                const [col, row] = k.split(',').map(Number);
                return {col, row};
            }),
            exit: this.#map ? this.#exit() : null,
            totals: {...this.#totals},
        };
    }

    // ---- Arrivals --------------------------------------------------------------

    #arrive(effects) {
        const day = this.#cycle.day;
        if (this.#day !== day) {
            this.#day = day;
            const count = groupsFor(this.#pollution?.value ?? 0);
            this.#arrivals = ECOLOGIST.arrivalTicks.slice(0, count);
        }
        const tick = this.#cycle.elapsedDayTicks;
        if (this.#arrivals.includes(tick)) this.#startGroup();
        for (const group of this.#groups) {
            if (group.pending > 0 && --group.leaveTimer <= 0) {
                group.pending--;
                group.leaveTimer = ECOLOGIST.leaveGapTicks;
                this.#spawn(group);
                effects.arrived++;
            }
        }
    }

    /** A group sets off, if industry is running and a site can be chosen. */
    #startGroup() {
        const exit = this.#exit();
        if (!exit) return;
        const site = this.#chooseSite(exit);
        if (!site) return;
        const size = this.#rng.nextInt(ECOLOGIST.size.min, ECOLOGIST.size.max);
        this.#groups.push({
            id: `protest-${this.#nextGroup++}`, site, state: EcologistState.ARRIVING, timer: 0, size,
            members: [], pending: size, leaveTimer: 1, exit,
        });
        this.#totals.groups++;
    }

    /** The first free tile of the dirt path, from the map edge in: where they come and go. */
    #exit() {
        const path = this.#grid.terrain?.path ?? [];
        return path.find((cell) => isFree(this.#map, cell)) ?? null;
    }

    /**
     * Road tiles on active producers' truck routes to HQ: player roads only, never a
     * dock or a gate. The protest stream picks one the group can reach without
     * crossing a gate. When a lane is walled off, the group goes as close as it can
     * get and blocks nothing. With no active producer, nobody comes.
     */
    #chooseSite(exit) {
        const buildings = this.#placement.buildings();
        const hq = buildings.find((b) => b.type === HQ_TYPE);
        if (!hq) return null;
        const powered = new Set(calculatePower(buildings).buildings.filter((b) => b.powered).map((b) => b.id));
        const producers = buildings.filter((b) => ROAD_ACCESS_TYPES.includes(b.type) && powered.has(b.id));
        const docks = new Set(producers.map((b) => key(shippingDock(b.type, b))));
        const player = new Set(this.#roads.tiles().filter((t) => t.kind === 'player').map(key));
        const candidates = [];
        const seen = new Set();
        for (const producer of producers) {
            const route = this.#roads.route(shippingDock(producer.type, producer), receivingDock(hq));
            for (const cell of route ?? []) {
                const k = key(cell);
                if (seen.has(k) || !player.has(k) || docks.has(k) || this.#roads.gateAt(cell) !== null) continue;
                seen.add(k);
                candidates.push({col: cell.col, row: cell.row});
            }
        }
        if (candidates.length === 0) return null;
        const field = this.#field(exit);
        const reachable = candidates.filter((c) => field[c.row * this.#grid.cols + c.col] !== UNREACHABLE);
        if (reachable.length > 0) return reachable[this.#rng.nextInt(0, reachable.length - 1)];
        return this.#nearestReachable(field, candidates);
    }

    /** The reachable free tile closest to a site they cannot reach: a protest that blocks nothing. */
    #nearestReachable(field, targets) {
        const {cols, rows} = this.#grid;
        let best = null;
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const cost = field[row * cols + col];
                if (cost === UNREACHABLE || this.#roads.has({col, row})) continue;
                const distance = Math.min(...targets.map((t) => Math.max(Math.abs(t.col - col), Math.abs(t.row - row))));
                if (!best || distance < best.distance || (distance === best.distance && cost < best.cost)) best = {col, row, distance, cost};
            }
        }
        return best ? {col: best.col, row: best.row} : null;
    }

    #spawn(group) {
        const {exit} = group;
        const ecologist = {
            id: `ecologist-${this.#nextId++}`, group: group.id, slot: group.members.length, state: EcologistState.ARRIVING,
            col: exit.col, row: exit.row, ...this.#grid.cellCenter(exit.col, exit.row), hp: ECOLOGIST.hp, next: null, timer: 0,
        };
        group.members.push(ecologist.id);
        this.#ecologists.push(ecologist);
        this.#totals.arrived++;
    }

    // ---- Dusk, Night -----------------------------------------------------------

    /** Dusk and Night: every protest is over, and everyone still here runs. */
    #panic() {
        for (const group of this.#groups) {
            group.pending = 0; // nobody else sets off
            if (group.state !== EcologistState.FLEEING) group.state = EcologistState.FLEEING;
        }
        for (const ecologist of this.#ecologists) {
            if (ALIVE(ecologist)) ecologist.state = EcologistState.FLEEING;
        }
    }

    // ---- Movement --------------------------------------------------------------

    #members(group) {
        return this.#ecologists.filter((e) => e.group === group.id && ALIVE(e));
    }

    #move(ecologist, effects) {
        const group = this.#groups.find((g) => g.id === ecologist.group);
        switch (ecologist.state) {
            case EcologistState.ARRIVING:
                if (this.#walk(ecologist, group.site, ECOLOGIST.speed)) ecologist.state = EcologistState.GATHERING;
                return;
            case EcologistState.GATHERING:
                this.#settle(ecologist, group.site);
                return;
            case EcologistState.PROTESTING:
                this.#settle(ecologist, group.site);
                return;
            case EcologistState.LEAVING:
            case EcologistState.FLEEING: {
                const speed = ecologist.state === EcologistState.FLEEING ? ECOLOGIST.fleeSpeed : ECOLOGIST.speed;
                const exit = this.#exit();
                if (exit && this.#walk(ecologist, exit, speed)) {
                    this.#ecologists.splice(this.#ecologists.indexOf(ecologist), 1);
                    this.#totals.escaped++;
                    effects.escaped++;
                }
                return;
            }
            default:
        }
    }

    /**
     * One tick along the quickest way to a tile, finishing any edge first.
     * @returns {boolean} true once standing at the goal tile's centre
     */
    #walk(ecologist, goal, base) {
        if (ecologist.next) {
            this.#walkEdge(ecologist, base);
            return false;
        }
        const centre = this.#grid.cellCenter(ecologist.col, ecologist.row);
        if (ecologist.x !== centre.x || ecologist.y !== centre.y) {
            this.#approach(ecologist, centre, base);
            return false;
        }
        if (sameCell(ecologist, goal)) return true;
        const step = nextStep(this.#map, this.#field(goal), ecologist);
        if (!step) return false; // no way from here: wait, never jump
        ecologist.next = step;
        this.#walkEdge(ecologist, base);
        return false;
    }

    #walkEdge(ecologist, base) {
        const goal = this.#grid.cellCenter(ecologist.next.col, ecologist.next.row);
        this.#approach(ecologist, goal, base);
        if (ecologist.x !== goal.x || ecologist.y !== goal.y) return;
        ecologist.col = ecologist.next.col;
        ecologist.row = ecologist.next.row;
        ecologist.next = null;
    }

    /** At the speed of the ground underfoot, along one axis at a time. */
    #approach(ecologist, goal, base) {
        const {originX, originY, tileSize} = this.#grid;
        const under = {col: Math.floor((ecologist.x - originX) / tileSize), row: Math.floor((ecologist.y - originY) / tileSize)};
        approach(ecologist, goal, speedOn(groundAt(under, {roads: this.#roads, terrain: this.#grid.terrain}), base));
    }

    /** Into the member's place on the site, within the tile. */
    #settle(ecologist, site) {
        const centre = this.#grid.cellCenter(site.col, site.row);
        const [dx, dy] = SLOTS[ecologist.slot % SLOTS.length];
        approach(ecologist, {x: centre.x + dx, y: centre.y + dy}, ECOLOGIST.speed);
    }

    /** Groups move on together: gathered, they protest; done, they leave. */
    #tidyGroups(effects) {
        for (const group of this.#groups) {
            const members = this.#members(group);
            const active = group.state === EcologistState.ARRIVING || group.state === EcologistState.PROTESTING;
            if (active && !isFree(this.#map, group.site)) { // built over before they got there: they give up
                group.state = EcologistState.LEAVING;
                group.pending = 0;
                for (const e of members) e.state = EcologistState.LEAVING;
                continue;
            }
            if (group.state === EcologistState.ARRIVING && group.pending === 0 && members.length > 0
                && members.every((e) => e.state === EcologistState.GATHERING)) {
                group.state = EcologistState.PROTESTING;
                group.timer = ECOLOGIST.protestTicks;
                for (const e of members) e.state = EcologistState.PROTESTING;
                this.#totals.protests++;
                effects.protestsStarted++;
            } else if (group.state === EcologistState.PROTESTING && --group.timer <= 0) {
                group.state = EcologistState.LEAVING;
                for (const e of members) e.state = EcologistState.LEAVING;
            }
        }
        // A group is gone once nobody in it is left, alive or as a corpse.
        this.#groups = this.#groups.filter((g) => g.pending > 0 || this.#ecologists.some((e) => e.group === g.id));
    }

    // ---- Mutants -----------------------------------------------------------------

    /** A mutant touching an ecologist kills it. Mutants are only read. */
    #contact(effects) {
        if (!this.#mutants || this.#cycle.shift !== Shift.NIGHT) return;
        const mutants = this.#mutants.snapshot();
        if (mutants.length === 0) return;
        for (const ecologist of this.#ecologists) {
            if (!ALIVE(ecologist)) continue;
            const touched = mutants.some((m) => {
                const reach = bodyRadius(m) + ECOLOGIST.bodyRadius;
                return (m.x - ecologist.x) ** 2 + (m.y - ecologist.y) ** 2 <= reach * reach;
            });
            if (!touched) continue;
            ecologist.hp = 0;
            ecologist.state = EcologistState.DEAD;
            ecologist.next = null;
            ecologist.timer = ECOLOGIST.corpseTicks;
            this.#totals.killed++;
            effects.killed.push(ecologist.id);
        }
    }

    #releaseCorpses() {
        this.#ecologists = this.#ecologists.filter((e) => e.state !== EcologistState.DEAD || --e.timer > 0);
    }

    // ---- Navigation and guards ------------------------------------------------

    /** Walls are walls and so is every gate: protesters never open or cross one. */
    #refreshNavigation() {
        const revision = `${this.#placement.revision}:${this.#roads.revision}:${this.#grid.terrain?.revision ?? 0}`;
        if (revision === this.#revision) return;
        this.#revision = revision;
        this.#fields.clear();
        const buildings = this.#placement.buildings().map((b) => (getBuildingType(b.type).gate ? {...b, type: WALL_TYPE} : b));
        this.#map = walkMap(this.#grid, buildings, {roads: this.#roads, terrain: this.#grid.terrain});
    }

    #field(goal) {
        const k = key(goal);
        if (!this.#fields.has(k)) this.#fields.set(k, walkField(this.#map, goal));
        return this.#fields.get(k);
    }

    /** Nothing may be built on a tile a living ecologist stands on or is stepping into. */
    #guard({action, footprint}) {
        if (action !== 'place') return null;
        const {col, row, width, height} = footprint;
        const inside = (cell) => cell && cell.col >= col && cell.col < col + width && cell.row >= row && cell.row < row + height;
        const blocked = this.#ecologists.some((e) => ALIVE(e) && (inside(e) || inside(e.next)));
        return blocked ? {ok: false, reason: EcologistFailure.UNIT_IN_THE_WAY} : null;
    }
}
