/**
 * HQ's worker squad. Pure: no Phaser, no wall clock and no randomness.
 *
 * ACTIVE cycle (ShiftCycle.timed, what the game plays). Workers are people, not
 * tokens: a worker outside HQ keeps its identity, HP and position across every
 * change of phase, and nobody is ever moved except by walking.
 *   - The work flag and whether the squad is sent are two things. The flag stays
 *     where it was put, across Dusk, Night and dawn, until the player moves it.
 *   - Putting a flag down, or moving it to a different tile, costs 1 AP each time
 *     and sends the squad. The same tile again costs nothing.
 *   - Sending them to the flag that is already down (SEND WORKERS) is free, as is
 *     recalling them, which leaves the flag where it is.
 *   - Placing, moving and sending are Day only, while the Day's clock runs: not in
 *     Day 0, not while the player has paused, and not during END DAY's fast-forward.
 *     Recall works at any time and cannot fail.
 *   - Workers leave HQ one at a time only by Day.
 *   - Dusk recalls them on foot and keeps the flag. A worker who has not reached
 *     HQ when Night falls is still outside, still walking home, and still a target.
 *   - Dawn (the tick a Day starts): who can leave is three, less anyone still
 *     outside. A worker who died is replaced then; a survivor still walking home
 *     is not, so the squad never exceeds three and nobody is duplicated.
 *
 * LEGACY cycle (an untimed Day, for older scenarios): workers exist on Night ticks
 * 1..3599 only, while a flag is down, and are all back inside at dawn. A flag can
 * be set by Day or Night, free.
 *
 * Workers walk as soldiers do: tile centre to tile centre, down a walk field from
 * core/walkField.js, always finishing the edge they are on. The field is in ticks,
 * so they take the quickest way, and their speed depends on the ground under them
 * (core/terrainSpeed.js): roads are quicker, jungle slower. They leave from HQ's
 * receiving dock, a road tile that is always free. They wait before a gate until it
 * is OPEN and ask for it until they stand beyond it. They may share a tile, so they
 * can never block each other, and nothing can be built on a tile they stand on or
 * are entering.
 *
 * Workers have no weapons. Mutants treat them as they treat soldiers: see Mutants.
 * Nothing here runs without a flag or a worker out, so a base that never sends its
 * workers plays exactly as it did.
 *
 * JUNGLE CLEARING (ACTIVE cycle, timed Day only). The flag is the centre of a work
 * area: jungle tiles within CLEARING.radius of it, measured as Fog of War measures,
 * circularly in whole tiles. A worker first walks to the flag; only then does it take
 * jobs. Workers choose in leaving order, which is id order: each takes the eligible
 * tile it can reach soonest from where it stands (the terrain-aware walk field), ties
 * by row then column, never a tile another worker holds, and keeps it until done. It
 * walks onto the tile and works from its centre; each tick there on a running Day adds
 * one to that tile's progress. CLEARING.ticksPerTile completes it: the terrain turns
 * to cleared ground, once, and Pollution rises by CLEARING.pollutionPerTile, once.
 * Progress belongs to the tile, so a recall, Dusk or a death keeps it for whoever
 * comes back; nothing advances without a worker on the tile. With nothing left to
 * clear, workers wait at the flag. The area never grows and the flag never moves.
 *
 * `visionRadius` is how far a worker sees; `CLEARING.radius` is how far it works.
 */
import {HQ_TYPE} from './buildingTypes.js';
import {GAME_PAUSED, UNKNOWN_BUILDING} from './buildingPlacement.js';
import {receivingDock} from './roads.js';
import {Shift} from './shiftCycle.js';
import {approach, groundAt, speedOn} from './terrainSpeed.js';
import {VISION_RADIUS} from './vision.js';
import {TerrainKind} from './terrain.js';
import {UNREACHABLE, isFree, isGate, nextStep, resolvePost, walkField, walkMap} from './walkField.js';

export const WORKER = Object.freeze({
    squadSize: 3,
    maxHp: 15,
    speed: 1, // px per tick on open ground; terrain multiplies it
    deployGapTicks: 30,
    flagCost: Object.freeze({credits: 0, ap: 1}), // a new flag, or the flag moved to another tile
    visionRadius: VISION_RADIUS.unit,
    workRadius: 3, // tiles round the flag, circular as Fog of War measures
    bodySize: 12, // px, what a mutant has to reach
});

/** Jungle clearing, all provisional. Tune here and nowhere else. */
export const CLEARING = Object.freeze({
    radius: WORKER.workRadius,
    ticksPerTile: 300,
    pollutionPerTile: 1,
});

const tileKey = ({col, row}) => `${col},${row}`;

export const WorkFlagFailure = Object.freeze({
    OUT_OF_BOUNDS: 'work-flag-out-of-bounds',
    OCCUPIED: 'work-flag-occupied',
    UNREACHABLE: 'work-flag-unreachable',
    DAY_ONLY: 'work-flag-day-only',
    NO_FLAG: 'work-flag-missing',
});

export const WorkerFailure = Object.freeze({UNIT_IN_THE_WAY: 'unit-in-the-way'});

export const UNKNOWN_WORKER = 'unknown-worker';
export const INVALID_DAMAGE = 'invalid-damage';

/** Where each worker stands at the flag, in px from the tile centre, so they settle and stay. */
const SLOTS = Object.freeze([[-8, -8], [8, -8], [0, 8]]);

const sameCell = (a, b) => a.col === b.col && a.row === b.row;

export class Workers {
    #cycle;
    #placement;
    #grid;
    #gates;
    #economy;
    #roads;
    #pollution;
    #progress = new Map(); // tile key -> ticks of work done, for tiles not yet cleared
    #cleared = 0;
    #jobFields = new Map(); // tile key -> walk field to it, for the current map
    #flag = null;
    #workers = []; // leaving order
    #inside = WORKER.squadSize;
    #lost = 0;
    #deployTimer = 1;
    #nextId = 1;
    #map = null;
    #route = null; // {exit, post, blocked, field}
    #revision = -1;
    #sent = false; // ACTIVE: the squad is sent to the flag; LEGACY uses the flag alone
    #dawnDay = null; // ACTIVE: the Day whose dawn has been handled
    #lastShift = null;

    /**
     * @param {{cycle: import('./shiftCycle.js').ShiftCycle,
     *          placement: import('./buildingPlacement.js').BuildingPlacement,
     *          grid: import('./grid.js').Grid,
     *          gates: import('./gates.js').Gates,
     *          economy?: import('./economy.js').Economy | null,
     *          roads?: import('./roads.js').RoadNetwork | null,
     *          pollution?: import('./pollution.js').Pollution | null}} deps
     *   economy pays for the flag; roads speed walkers up; pollution takes what clearing emits
     */
    constructor({cycle, placement, grid, gates, economy = null, roads = null, pollution = null}) {
        this.#cycle = cycle;
        this.#placement = placement;
        this.#grid = grid;
        this.#gates = gates;
        this.#economy = economy;
        this.#roads = roads;
        this.#pollution = pollution;
        placement.addGuard?.((question) => this.#guard(question));
    }

    get flag() {
        return this.#flag && {...this.#flag};
    }

    /** Is the squad sent to the flag? ACTIVE keeps it apart from the flag; LEGACY sends whenever a flag is down. */
    get sent() {
        return this.#cycle.timed ? this.#sent : this.#flag !== null;
    }

    /** Would putting the flag on this tile cost the flag price? Only a new tile does. */
    flagCostsAp(cell) {
        return this.#cycle.timed === true && !(this.#flag && sameCell(this.#flag, cell));
    }

    /** ACTIVE: placing and sending happen in a Day whose clock runs, never in Day 0, paused or fast-forwarding. */
    #mayDispatch() {
        if (!this.#cycle.timed) return true;
        return this.#cycle.shift === Shift.DAY && this.#cycle.isConstructionAllowed && !this.#cycle.deployment && this.#cycle.running;
    }

    /**
     * Would this work flag be accepted? Never mutates. Jungle and unexplored tiles are
     * fine: going there is what workers are for. Placing a flag reveals nothing.
     * @returns {{ok: true} | {ok: false, reason: string}}
     */
    canSetFlag(cell) {
        const hq = this.#hq();
        if (!hq) return {ok: false, reason: UNKNOWN_BUILDING};
        if (this.#cycle.pausedDay) return {ok: false, reason: GAME_PAUSED};
        if (!this.#mayDispatch()) return {ok: false, reason: WorkFlagFailure.DAY_ONLY};
        const {col, row} = cell ?? {};
        const inBounds = Number.isInteger(col) && Number.isInteger(row) && col >= 0 && row >= 0 && col < this.#grid.cols && row < this.#grid.rows;
        if (!inBounds) return {ok: false, reason: WorkFlagFailure.OUT_OF_BOUNDS};
        const map = walkMap(this.#grid, this.#placement.buildings());
        if (!isFree(map, cell)) return {ok: false, reason: WorkFlagFailure.OCCUPIED};
        if (resolvePost(map, receivingDock(hq), cell).blocked) return {ok: false, reason: WorkFlagFailure.UNREACHABLE};
        return this.flagCostsAp(cell) && this.#economy ? this.#economy.canAfford(WORKER.flagCost) : {ok: true};
    }

    /**
     * Put the flag down, or move it, and send the squad. Anyone out simply turns round.
     * ACTIVE: 1 AP for a new tile; the tile it is already on costs nothing.
     */
    setFlag(cell) {
        const check = this.canSetFlag(cell);
        if (!check.ok) return check;
        if (this.flagCostsAp(cell)) {
            this.#economy?.spend(WORKER.flagCost); // affordable: just checked
            for (const worker of this.#workers) this.#leaveWork(worker); // a new area: walk to it first
        }
        this.#flag = {col: cell.col, row: cell.row};
        this.#sent = true;
        this.#revision = -1;
        return {ok: true};
    }

    /** ACTIVE: send the squad to the flag already down. Free, on the same terms as placing one. */
    canDispatch() {
        if (!this.#cycle.timed) return {ok: false, reason: WorkFlagFailure.DAY_ONLY};
        if (this.#flag === null) return {ok: false, reason: WorkFlagFailure.NO_FLAG};
        if (!this.#hq()) return {ok: false, reason: UNKNOWN_BUILDING};
        if (this.#cycle.pausedDay) return {ok: false, reason: GAME_PAUSED};
        return this.#mayDispatch() ? {ok: true} : {ok: false, reason: WorkFlagFailure.DAY_ONLY};
    }

    dispatch() {
        const check = this.canDispatch();
        if (!check.ok) return check;
        this.#sent = true;
        this.#revision = -1;
        return check;
    }

    /**
     * Everyone home, on foot. Free, and at any time except a paused Day, where no
     * order changes anything until PLAY. ACTIVE: the flag stays where it is, ready
     * for the next SEND WORKERS. LEGACY: the flag goes.
     * @returns {{ok: true} | {ok: false, reason: string}}
     */
    recall() {
        if (this.#cycle.pausedDay) return {ok: false, reason: GAME_PAUSED};
        this.#callHome();
        return {ok: true};
    }

    /** Dusk's recall, which the simulation makes and no pause can refuse. */
    #callHome() {
        if (this.#cycle.timed) this.#sent = false;
        else this.#flag = null;
        this.#revision = -1;
    }

    /** Where the squad is heading: the flag while sent, otherwise home. */
    #target() {
        return this.sent ? this.#flag : null;
    }

    /**
     * One simulation tick. Runs after Infantry.step() and before Mutants.step().
     */
    step() {
        const shift = this.#cycle.shift;
        if (shift === Shift.DEFEATED) return;
        if (this.#cycle.timed) {
            this.#followCycle(shift);
        } else if (shift !== Shift.NIGHT) {
            this.#standDown();
            return;
        }
        if (this.#target() === null && this.#workers.length === 0) return;
        const hq = this.#hq();
        if (!hq) return; // nowhere to leave from or go home to: anyone out stays put
        this.#refreshNavigation(hq);
        for (const worker of [...this.#workers]) this.#move(worker);
        if (!this.#cycle.timed || shift === Shift.DAY) this.#deploy();
    }

    /**
     * Add the gates workers need to `wanted`. Called before Gates.step(), from where
     * workers ended the last tick.
     * @param {Set<string>} wanted
     */
    addGateDemands(wanted) {
        for (const {col, row, next, held} of this.#workers) {
            for (const cell of [{col, row}, next, held]) {
                if (!cell || !isGate(this.#map, cell)) continue;
                const id = this.#grid.occupantAt(cell.col, cell.row);
                if (id !== null) wanted.add(id); // a destroyed gate stays on the map until the next rebuild
            }
        }
    }

    /** What a mutant can reach, in leaving order. */
    attackable() {
        return this.#workers.map(({id, x, y}) => ({id, x, y, worker: true}));
    }

    /**
     * Apply damage to a worker. This is the only way worker HP changes.
     * @returns {{ok: true, killed: boolean, hp: number} | {ok: false, reason: string}}
     */
    damageWorker(id, amount) {
        if (!Number.isSafeInteger(amount) || amount <= 0) return {ok: false, reason: INVALID_DAMAGE};
        const index = this.#workers.findIndex((worker) => worker.id === id);
        if (index === -1) return {ok: false, reason: UNKNOWN_WORKER};
        const worker = this.#workers[index];
        worker.hp = Math.max(0, worker.hp - amount);
        if (worker.hp > 0) return {ok: true, killed: false, hp: worker.hp};
        this.#workers.splice(index, 1);
        this.#lost++;
        return {ok: true, killed: true, hp: 0};
    }

    /** Detached worker records, in leaving order. */
    workers() {
        return this.#workers.map((worker) => ({
            ...worker,
            next: worker.next && {...worker.next},
            held: worker.held && {...worker.held},
            job: worker.job && {...worker.job},
        }));
    }

    /** Clearing work: progress on unfinished tiles, in row-major order, and tiles cleared this run. */
    clearing() {
        const progress = [...this.#progress].map(([key, ticks]) => {
            const [col, row] = key.split(',').map(Number);
            return {col, row, ticks};
        }).sort((a, b) => a.row - b.row || a.col - b.col);
        return {progress, cleared: this.#cleared, ticksPerTile: CLEARING.ticksPerTile};
    }

    /**
     * Where the squad leaves from and is going, derived from the buildings, by Day too.
     * A flag walled off since it was set is `blocked`, and nobody goes.
     * @returns {{exit: {col, row}, post: {col, row}, flag: {col, row}|null, blocked: boolean} | null}
     */
    route() {
        const hq = this.#hq();
        if (!hq) return null;
        const exit = receivingDock(hq);
        const {post, blocked} = resolvePost(walkMap(this.#grid, this.#placement.buildings()), exit, this.#flag);
        return {exit, post, flag: this.flag, blocked};
    }

    /** Detached, JSON-serializable state. Reading it changes nothing. */
    snapshot() {
        const state = {route: this.route(), flag: this.flag, inside: this.#inside, lost: this.#lost, workers: this.workers()};
        return this.#cycle.timed ? {...state, sent: this.#sent, clearing: this.clearing()} : state; // LEGACY keeps its old shape
    }

    #hq() {
        return this.#placement.buildings().find((building) => building.type === HQ_TYPE) ?? null;
    }

    /** LEGACY dawn: everyone is simply back inside. */
    #standDown() {
        this.#workers.length = 0;
        this.#inside = WORKER.squadSize;
        this.#lost = 0;
        this.#deployTimer = 1;
    }

    /** ACTIVE: Dusk recalls, and each dawn makes up the squad without duplicating anyone. */
    #followCycle(shift) {
        if (shift === Shift.DUSK && this.#lastShift !== Shift.DUSK) this.#callHome();
        this.#lastShift = shift;
        if (shift !== Shift.DAY || this.#dawnDay === this.#cycle.day) return;
        this.#dawnDay = this.#cycle.day;
        this.#inside = WORKER.squadSize - this.#workers.length;
        this.#lost = 0;
        this.#deployTimer = 1;
    }

    /** Nothing may be built on a tile a worker stands on or is stepping into. */
    #guard({action, footprint}) {
        if (action !== 'place') return null;
        const {col, row, width, height} = footprint;
        const inside = (cell) => cell && cell.col >= col && cell.col < col + width && cell.row >= row && cell.row < row + height;
        const blocked = this.#workers.some((worker) => inside(worker) || inside(worker.next));
        return blocked ? {ok: false, reason: WorkerFailure.UNIT_IN_THE_WAY} : null;
    }

    /**
     * Fields are rebuilt only when walking, roads, terrain or the flag have changed:
     * once on the next tick however many trees fell on this one.
     */
    #refreshNavigation(hq) {
        const revision = `${this.#placement.revision}:${this.#roads?.revision ?? 0}:${this.#grid.terrain?.revision ?? 0}`;
        if (this.#revision === revision) return;
        this.#revision = revision;
        this.#jobFields.clear();
        this.#map = walkMap(this.#grid, this.#placement.buildings(), this.#ground());
        const exit = receivingDock(hq);
        this.#route = {exit, ...resolvePost(this.#map, exit, this.#target())};
    }

    #ground() {
        return {roads: this.#roads, terrain: this.#grid.terrain ?? null};
    }

    #centerOf({col, row}) {
        return this.#grid.cellCenter(col, row);
    }

    #move(worker) {
        worker.held = null;
        worker.working = false;
        if (worker.next) {
            this.#walkEdge(worker);
            return;
        }
        if (!this.#atWork()) this.#leaveWork(worker);
        else if (worker.arrived && this.#work(worker)) return;
        const {post, field} = this.#route;
        if (sameCell(worker, post)) {
            if (this.#atWork() && !worker.arrived) {
                worker.arrived = true; // in the work area: jobs from the next tick
                return;
            }
            this.#settle(worker);
            return;
        }
        if (!this.#atCentre(worker)) {
            this.#walkTo(worker, this.#centerOf(worker));
            return;
        }
        const step = nextStep(this.#map, field, worker);
        if (!step) return; // no way from here: wait, rather than wander
        if (isGate(this.#map, step) && !this.#gateIsPassable(step)) {
            worker.held = step;
            return;
        }
        worker.next = step;
        this.#walkEdge(worker);
    }

    /** Is the squad at work: ACTIVE, sent to a reachable flag, on a running Day? */
    #atWork() {
        return this.#cycle.timed === true && this.#cycle.shift === Shift.DAY && this.#target() !== null && !this.#route.blocked;
    }

    /** Off the job, out of the area. A tile's progress stays with the tile. */
    #leaveWork(worker) {
        worker.arrived = false;
        worker.job = null;
    }

    /**
     * A worker in the work area: keep its job, or take one, then walk to it or work it.
     * @returns {boolean} whether its tick is spent on the job
     */
    #work(worker) {
        if (worker.job && this.#grid.terrain?.kindAt(worker.job.col, worker.job.row) !== TerrainKind.JUNGLE) worker.job = null;
        worker.job ??= this.#chooseJob(worker);
        if (!worker.job) return false; // nothing left: wait at the flag
        if (sameCell(worker, worker.job)) {
            const centre = this.#centerOf(worker.job);
            if (worker.x !== centre.x || worker.y !== centre.y) {
                this.#walkTo(worker, centre);
                return true;
            }
            this.#chop(worker);
            return true;
        }
        if (!this.#atCentre(worker)) {
            this.#walkTo(worker, this.#centerOf(worker));
            return true;
        }
        const step = nextStep(this.#map, this.#jobField(worker.job), worker);
        if (!step) {
            worker.job = null; // walled off since: let it go, and the tile keeps its progress
            return false;
        }
        if (isGate(this.#map, step) && !this.#gateIsPassable(step)) {
            worker.held = step;
            return true;
        }
        worker.next = step;
        this.#walkEdge(worker);
        return true;
    }

    /** One tick of work on the tile underfoot. The last one clears it, once, and pollutes, once. */
    #chop(worker) {
        worker.working = true;
        const key = tileKey(worker.job);
        const done = (this.#progress.get(key) ?? 0) + 1;
        if (done < CLEARING.ticksPerTile) {
            this.#progress.set(key, done);
            return;
        }
        this.#progress.delete(key);
        const {col, row} = worker.job;
        worker.job = null;
        if (!this.#grid.terrain.clear(col, row)) return;
        this.#cleared++;
        this.#pollution?.add(CLEARING.pollutionPerTile);
    }

    /** The jungle this worker reaches soonest, inside the area and held by nobody else. */
    #chooseJob(worker) {
        const terrain = this.#grid.terrain;
        if (!terrain) return null;
        const flag = this.#flag;
        const held = new Set(this.#workers.filter((other) => other !== worker && other.job).map((other) => tileKey(other.job)));
        const reach = walkField(this.#map, {col: worker.col, row: worker.row}); // time to the worker = time from it
        const radius = CLEARING.radius;
        let best = null;
        let bestTime = UNREACHABLE;
        for (let row = flag.row - radius; row <= flag.row + radius; row++) {
            for (let col = flag.col - radius; col <= flag.col + radius; col++) {
                const [dc, dr] = [col - flag.col, row - flag.row];
                if (dc * dc + dr * dr > radius * radius) continue;
                if (terrain.kindAt(col, row) !== TerrainKind.JUNGLE || held.has(`${col},${row}`)) continue;
                if (!isFree(this.#map, {col, row})) continue;
                const time = reach[row * this.#grid.cols + col];
                if (time < bestTime) { // rows then columns ascend, so the first of equals wins
                    best = {col, row};
                    bestTime = time;
                }
            }
        }
        return best;
    }

    #jobField(job) {
        const key = tileKey(job);
        if (!this.#jobFields.has(key)) this.#jobFields.set(key, walkField(this.#map, job));
        return this.#jobFields.get(key);
    }

    /** At the flag, take a place and stay there. Home with no flag, go in. */
    #settle(worker) {
        const {x, y} = this.#centerOf(this.#route.post);
        if (this.#target() !== null) {
            const [dx, dy] = SLOTS[worker.slot];
            this.#walkTo(worker, {x: x + dx, y: y + dy});
            return;
        }
        this.#walkTo(worker, {x, y});
        if (worker.x !== x || worker.y !== y) return;
        this.#workers.splice(this.#workers.indexOf(worker), 1);
        this.#inside++;
    }

    /** A gate that has fallen since the map was built is no longer in the way. */
    #gateIsPassable({col, row}) {
        const id = this.#grid.occupantAt(col, row);
        return id === null || this.#gates.isOpen(id);
    }

    #atCentre(worker) {
        const {x, y} = this.#centerOf(worker);
        return worker.x === x && worker.y === y;
    }

    /** Along one axis at a time, within a tile, at the speed of the ground underfoot. */
    #walkTo(worker, goal) {
        const {originX, originY, tileSize} = this.#grid;
        const under = {col: Math.floor((worker.x - originX) / tileSize), row: Math.floor((worker.y - originY) / tileSize)};
        approach(worker, goal, speedOn(groundAt(under, this.#ground()), WORKER.speed));
    }

    /** Only reaching the far tile's centre ends an edge, and with it the demand on a gate behind. */
    #walkEdge(worker) {
        const goal = this.#centerOf(worker.next);
        this.#walkTo(worker, goal);
        if (worker.x !== goal.x || worker.y !== goal.y) return;
        worker.col = worker.next.col;
        worker.row = worker.next.row;
        worker.next = null;
    }

    #deploy() {
        if (this.#target() === null || this.#route.blocked || this.#inside === 0) return;
        if (--this.#deployTimer > 0) return;
        this.#deployTimer = WORKER.deployGapTicks;
        this.#inside--;
        const {exit} = this.#route;
        this.#workers.push({
            id: `worker-${this.#nextId++}`,
            slot: SLOTS.findIndex((_, slot) => !this.#workers.some((worker) => worker.slot === slot)),
            col: exit.col,
            row: exit.row,
            ...this.#centerOf(exit),
            hp: WORKER.maxHp,
            next: null,
            held: null,
            arrived: false,
            job: null,
            working: false,
        });
    }
}
