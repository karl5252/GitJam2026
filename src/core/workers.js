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
 * REPAIR ORDERS (ACTIVE cycle, timed Day only). The player orders a repair on a
 * damaged building; it is not tied to the flag or its area. Each order takes one
 * worker, the nearest that is free by travel time (a worker outside, ties to id
 * order, before one leaving HQ), and an order outranks clearing: a worker chopping
 * drops its tile, whose progress stays with the tile. There is no queue: at most one
 * order per living worker, three at most. The worker walks to the free tile beside
 * the building it reaches soonest and works from its centre. Every REPAIR.ticksPerBlock
 * ticks there it pays for and restores REPAIR.hpPerBlock (less at the top), charged
 * before the HP goes on. A block it cannot pay for cancels the order and frees the
 * worker; HP already restored stays. An order ends when the building is whole,
 * destroyed or demolished, or on STOP REPAIR. Dusk calls the worker home as usual
 * and the order waits, with its partial block, for the next running Day: a worker
 * who reached HQ, or died, is replaced from HQ then.
 *
 * Price: an ordinary building costs REPAIR.share of its construction Credits to
 * restore all its HP, in proportion to the HP restored; HQ, which costs nothing to
 * build, costs REPAIR.hqCreditsPerHp. A block costs the difference between the price
 * of the HP missing before and after it, rounded half up, so the blocks of a whole
 * repair add up to the exact rounded total, never a Credit more.
 *
 * `visionRadius` is how far a worker sees; `CLEARING.radius` is how far it works.
 */
import {HQ_TYPE, getBuildingType} from './buildingTypes.js';
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

/** Repairs, all provisional. Tune here and nowhere else. */
export const REPAIR = Object.freeze({
    hpPerBlock: 10,
    ticksPerBlock: 60,
    share: Object.freeze({numerator: 3, denominator: 5}), // 60% of the build price restores full HP
    hqCreditsPerHp: 1,
});

/** TASK 027.1: two workers break up a protest. Provisional. */
export const DISPERSE = Object.freeze({workers: 2, ticks: 120});

export const DisperseFailure = Object.freeze({
    NOT_A_PROTEST: 'disperse-not-a-protest',
    ALREADY_ORDERED: 'disperse-already-ordered',
    NOT_ORDERED: 'disperse-not-ordered',
    BUSY: 'disperse-busy', // one dispersal at a time
    NO_WORKERS: 'disperse-no-workers',
    UNREACHABLE: 'disperse-unreachable',
});

/** The four tiles beside a site, in N, E, S, W order. */
const CARDINALS = Object.freeze([[0, -1], [1, 0], [0, 1], [-1, 0]]);

export const RepairFailure = Object.freeze({
    NOT_DAMAGED: 'repair-not-damaged',
    ALREADY_ORDERED: 'repair-already-ordered',
    NOT_ORDERED: 'repair-not-ordered',
    NO_WORKER: 'repair-no-worker',
    NO_CREDITS: 'repair-no-credits',
    UNREACHABLE: 'repair-unreachable',
});

/** Credits to restore `missing` HP to a building of this type. Integers only, rounded half up. */
export function repairPrice(type, missing) {
    if (type.id === HQ_TYPE) return missing * REPAIR.hqCreditsPerHp;
    const {numerator, denominator} = REPAIR.share;
    const scaled = type.cost.credits * numerator * missing;
    const whole = denominator * type.maxHp;
    return Math.floor((2 * scaled + whole) / (2 * whole));
}

/** The next block for a building at `hp`: what it restores and what it costs. */
export function repairBlock(type, hp) {
    const missing = type.maxHp - hp;
    const gain = Math.min(REPAIR.hpPerBlock, missing);
    return {gain, credits: repairPrice(type, missing) - repairPrice(type, missing - gain)};
}

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
    #orders = new Map(); // building id -> {worker: id | null, ticks, tile}, in the order given
    #repairSpent = 0;
    #repairRestored = 0;
    #notices = []; // this tick's cancelled orders, for the HUD
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
    #ecologists = null;
    #dispersals = new Map(); // protest group id -> {workers: [id | null, id | null], tiles, ticks}
    #assigned = new Map(); // worker id -> {group, tile, resume: {job, flag} | null}: kept off the worker record

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

    /** Protesters are created after workers, and DISPERSE needs to read and break up their protests. */
    setEcologists(ecologists) {
        this.#ecologists = ecologists;
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

    /** The repair order on a building, or null. */
    repairOrder(buildingId) {
        const order = this.#orders.get(buildingId);
        return order ? {buildingId, worker: order.worker, ticks: order.ticks} : null;
    }

    /**
     * Could the player order a repair here now? Never mutates. `quick` skips the walk
     * fields that check a worker can reach the building, for a button drawn every
     * frame; the order itself always checks.
     * @returns {{ok: true} | {ok: false, reason: string}}
     */
    canRepair(buildingId, {quick = false} = {}) {
        if (!this.#cycle.timed || !this.#economy) return {ok: false, reason: WorkFlagFailure.DAY_ONLY};
        const hq = this.#hq();
        if (!hq) return {ok: false, reason: UNKNOWN_BUILDING};
        if (this.#cycle.pausedDay) return {ok: false, reason: GAME_PAUSED};
        if (!this.#mayDispatch()) return {ok: false, reason: WorkFlagFailure.DAY_ONLY};
        const building = this.#placement.buildings().find(({id}) => id === buildingId);
        if (!building) return {ok: false, reason: UNKNOWN_BUILDING};
        if (this.#orders.has(buildingId)) return {ok: false, reason: RepairFailure.ALREADY_ORDERED};
        if (building.hp >= getBuildingType(building.type).maxHp) return {ok: false, reason: RepairFailure.NOT_DAMAGED};
        if (quick) return this.#freeRepairers() > 0 ? {ok: true} : {ok: false, reason: RepairFailure.NO_WORKER};
        this.#refreshNavigation(hq);
        const choice = this.#chooseRepairer(building, hq);
        return choice.ok ? {ok: true} : choice;
    }

    /** REPAIR: one worker for this building. Free to order; each block is paid as it is done. */
    orderRepair(buildingId) {
        const check = this.canRepair(buildingId);
        if (!check.ok) return check;
        const building = this.#placement.buildings().find(({id}) => id === buildingId);
        const {worker} = this.#chooseRepairer(building, this.#hq());
        if (worker) {
            worker.repair = buildingId;
            worker.job = null; // a jungle tile keeps its progress for later
            worker.arrived = false;
        }
        this.#orders.set(buildingId, {worker: worker?.id ?? null, ticks: 0, tile: null});
        return {ok: true, worker: worker?.id ?? null};
    }

    /** STOP REPAIR: cancel at once and free the worker. HP restored so far stays. */
    stopRepair(buildingId) {
        if (this.#cycle.pausedDay) return {ok: false, reason: GAME_PAUSED};
        if (!this.#orders.has(buildingId)) return {ok: false, reason: RepairFailure.NOT_ORDERED};
        this.#endOrder(buildingId);
        return {ok: true};
    }

    /** The DISPERSE order on a protest group, or null. */
    disperseOrder(groupId) {
        const order = this.#dispersals.get(groupId);
        return order ? {groupId, workers: [...order.workers], ticks: order.ticks} : null;
    }

    /**
     * Could the player order DISPERSE on this protest now? Never mutates. Two free
     * workers and two distinct reachable tiles beside the site, one each, are needed:
     * a worker on a repair is never free. `quick` skips the walk fields, for a button
     * drawn every frame; the order itself always checks.
     * @returns {{ok: true} | {ok: false, reason: string}}
     */
    canDisperse(groupId, {quick = false} = {}) {
        if (!this.#cycle.timed || !this.#ecologists) return {ok: false, reason: WorkFlagFailure.DAY_ONLY};
        const hq = this.#hq();
        if (!hq) return {ok: false, reason: UNKNOWN_BUILDING};
        if (this.#cycle.pausedDay) return {ok: false, reason: GAME_PAUSED};
        if (!this.#mayDispatch()) return {ok: false, reason: WorkFlagFailure.DAY_ONLY};
        if (this.#dispersals.has(groupId)) return {ok: false, reason: DisperseFailure.ALREADY_ORDERED};
        const protest = this.#ecologists.protest(groupId);
        if (!protest) return {ok: false, reason: DisperseFailure.NOT_A_PROTEST};
        if (this.#dispersals.size > 0) return {ok: false, reason: DisperseFailure.BUSY};
        if (quick) return this.#freeRepairers() >= DISPERSE.workers ? {ok: true} : {ok: false, reason: DisperseFailure.NO_WORKERS};
        this.#refreshNavigation(hq);
        const plan = this.#planDispersal(protest.site, hq);
        return plan.ok ? {ok: true} : plan;
    }

    /** DISPERSE: two workers to the protest. Free: no Credits, no AP. */
    orderDisperse(groupId) {
        const check = this.canDisperse(groupId);
        if (!check.ok) return check;
        const {site} = this.#ecologists.protest(groupId);
        const {picks} = this.#planDispersal(site, this.#hq());
        const order = {workers: [], tiles: [], ticks: 0};
        for (const {worker, tile} of picks) {
            order.tiles.push(tile);
            order.workers.push(worker?.id ?? null);
            if (worker) this.#assign(worker, groupId, tile);
        }
        this.#dispersals.set(groupId, order);
        return {ok: true, workers: [...order.workers]};
    }

    /** CANCEL DISPERSE: at once, free; both workers go back to what they were doing. */
    cancelDisperse(groupId) {
        if (this.#cycle.pausedDay) return {ok: false, reason: GAME_PAUSED};
        if (!this.#dispersals.has(groupId)) return {ok: false, reason: DisperseFailure.NOT_ORDERED};
        this.#endDispersal(groupId);
        return {ok: true};
    }

    /** Detached DISPERSE orders. */
    dispersals() {
        return [...this.#dispersals].map(([groupId, {workers, tiles, ticks}]) => ({
            groupId, workers: [...workers], tiles: tiles.map((t) => ({...t})), ticks,
        }));
    }

    /** Detached repair state: orders in the order given, and what repairs have cost and restored. */
    repairs() {
        return {
            orders: [...this.#orders].map(([buildingId, {worker, ticks, tile}]) => ({buildingId, worker, ticks, tile: tile && {...tile}})),
            spent: this.#repairSpent,
            restored: this.#repairRestored,
        };
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
        this.#notices = [];
        const shift = this.#cycle.shift;
        if (shift === Shift.DEFEATED) return {cancelled: this.#notices};
        if (this.#cycle.timed) {
            this.#followCycle(shift);
            this.#tidyOrders();
            this.#tidyDispersals();
        } else if (shift !== Shift.NIGHT) {
            this.#standDown();
            return {cancelled: this.#notices};
        }
        if (this.#target() === null && this.#workers.length === 0 && this.#orders.size === 0 && this.#dispersals.size === 0) return {cancelled: this.#notices};
        const hq = this.#hq();
        if (!hq) return {cancelled: this.#notices}; // nowhere to leave from or go home to: anyone out stays put
        this.#refreshNavigation(hq);
        if (this.#repairTime()) this.#deployRepairers();
        if (this.#repairTime()) this.#deployDispersers();
        for (const worker of [...this.#workers]) this.#move(worker);
        if (this.#repairTime()) this.#countDispersals();
        if (!this.#cycle.timed || shift === Shift.DAY) this.#deploy();
        return {cancelled: this.#notices};
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
        const order = worker.repair ? this.#orders.get(worker.repair) : null;
        if (order) order.worker = null; // the order waits for another worker
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

    /** ACTIVE: HP goes up only on a running timed Day: ticks never run in Day 0 or while paused. */
    #repairTime() {
        return this.#cycle.timed === true && this.#cycle.shift === Shift.DAY;
    }

    /** Orders follow the buildings and the workers: a building gone or whole ends one; a worker gone frees it. */
    #tidyOrders() {
        if (this.#orders.size === 0) return;
        const byId = new Map(this.#placement.buildings().map((building) => [building.id, building]));
        const out = new Set(this.#workers.map(({id}) => id));
        for (const [buildingId, order] of [...this.#orders]) {
            const building = byId.get(buildingId);
            if (!building || building.hp >= getBuildingType(building.type).maxHp) {
                this.#endOrder(buildingId);
                continue;
            }
            if (order.worker !== null && !out.has(order.worker)) order.worker = null; // went inside, or died
        }
    }

    #endOrder(buildingId, reason = null) {
        const order = this.#orders.get(buildingId);
        if (!order) return;
        const worker = this.#workers.find(({id}) => id === order.worker);
        if (worker) {
            worker.repair = null;
            worker.repairing = false;
        }
        this.#orders.delete(buildingId);
        if (reason) this.#notices.push({buildingId, reason});
    }

    /**
     * Who takes a new order: the free worker who reaches the building soonest, a
     * worker outside before one leaving HQ on equal time, then id order.
     * @returns {{ok: true, worker: object | null} | {ok: false, reason: string}}
     */
    #chooseRepairer(building, hq) {
        if (this.#orders.size + this.#dispersingCount() >= WORKER.squadSize) return {ok: false, reason: RepairFailure.NO_WORKER};
        const pending = [...this.#orders.values()].filter(({worker}) => worker === null).length + this.#pendingDispersers();
        const candidates = this.#workers.filter((worker) => !worker.repair && !this.#assigned.has(worker.id)).map((worker) => ({worker, from: worker}));
        if (this.#inside - pending > 0) candidates.push({worker: null, from: receivingDock(hq)});
        if (candidates.length === 0) return {ok: false, reason: RepairFailure.NO_WORKER};
        const stands = this.#standTiles(building);
        let best = null;
        let bestTime = UNREACHABLE;
        for (const candidate of candidates) {
            const reach = isFree(this.#map, candidate.from) ? walkField(this.#map, {col: candidate.from.col, row: candidate.from.row}) : null;
            if (!reach) continue;
            const time = Math.min(...stands.map(({col, row}) => reach[row * this.#grid.cols + col]));
            if (time < bestTime) {
                best = candidate;
                bestTime = time;
            }
        }
        return best ? {ok: true, worker: best.worker} : {ok: false, reason: RepairFailure.UNREACHABLE};
    }

    /** Free tiles touching a building's footprint, row by row. */
    #standTiles({col, row, width, height}) {
        const tiles = [];
        for (let r = row - 1; r <= row + height; r++) {
            for (let c = col - 1; c <= col + width; c++) {
                const inside = c >= col && c < col + width && r >= row && r < row + height;
                const corner = (c === col - 1 || c === col + width) && (r === row - 1 || r === row + height);
                if (inside || corner || c < 0 || r < 0 || c >= this.#grid.cols || r >= this.#grid.rows) continue;
                if (isFree(this.#map, {col: c, row: r})) tiles.push({col: c, row: r});
            }
        }
        return tiles;
    }

    /** Workers who could take a new order: outside and unordered, or inside and not promised. */
    #freeRepairers() {
        if (this.#orders.size + this.#dispersingCount() >= WORKER.squadSize) return 0;
        const pending = [...this.#orders.values()].filter(({worker}) => worker === null).length + this.#pendingDispersers();
        return this.#workers.filter((worker) => !worker.repair && !this.#assigned.has(worker.id)).length + Math.max(0, this.#inside - pending);
    }

    // ---- DISPERSE (TASK 027.1) ------------------------------------------------

    /** Workers a dispersal holds, sent or still to leave HQ. */
    #dispersingCount() {
        return this.#dispersals.size * DISPERSE.workers;
    }

    #pendingDispersers() {
        let pending = 0;
        for (const {workers} of this.#dispersals.values()) pending += workers.filter((id) => id === null).length;
        return pending;
    }

    /**
     * Who goes where: two distinct free tiles beside the site (N, E, S, W, never the
     * site), and two free workers, each to its own tile. Pairs are taken quickest
     * first; ties go to a worker outside before one leaving HQ, then id order, then
     * tile order. Never mutates.
     * @returns {{ok: true, picks: Array<{worker: object | null, tile: {col, row}}>} | {ok: false, reason: string}}
     */
    #planDispersal(site, hq) {
        if (this.#orders.size + DISPERSE.workers > WORKER.squadSize) return {ok: false, reason: DisperseFailure.NO_WORKERS};
        const pendingRepairs = [...this.#orders.values()].filter(({worker}) => worker === null).length;
        const candidates = this.#workers.filter((w) => !w.repair && !this.#assigned.has(w.id)).map((worker) => ({worker, from: worker}));
        const fromHq = Math.max(0, this.#inside - pendingRepairs);
        for (let i = 0; i < Math.min(fromHq, DISPERSE.workers); i++) candidates.push({worker: null, from: receivingDock(hq)});
        if (candidates.length < DISPERSE.workers) return {ok: false, reason: DisperseFailure.NO_WORKERS};
        const tiles = CARDINALS.map(([dc, dr]) => ({col: site.col + dc, row: site.row + dr}))
            .filter(({col, row}) => col >= 0 && row >= 0 && col < this.#grid.cols && row < this.#grid.rows && isFree(this.#map, {col, row}));
        const times = candidates.map(({from}) => {
            const reach = isFree(this.#map, from) ? walkField(this.#map, {col: from.col, row: from.row}) : null;
            return tiles.map(({col, row}) => (reach ? reach[row * this.#grid.cols + col] : UNREACHABLE));
        });
        const picks = [];
        const used = {candidates: new Set(), tiles: new Set()};
        for (let n = 0; n < DISPERSE.workers; n++) {
            let best = null;
            candidates.forEach((candidate, c) => {
                if (used.candidates.has(c)) return;
                tiles.forEach((tile, t) => {
                    if (used.tiles.has(t) || times[c][t] === UNREACHABLE) return;
                    if (!best || times[c][t] < best.time) best = {c, t, time: times[c][t]};
                });
            });
            if (!best) return {ok: false, reason: DisperseFailure.UNREACHABLE};
            used.candidates.add(best.c);
            used.tiles.add(best.t);
            picks.push({worker: candidates[best.c].worker, tile: tiles[best.t]});
        }
        return {ok: true, picks};
    }

    /** Off clearing for now, remembering the jungle tile it was on, whose progress stays with the tile. */
    #assign(worker, groupId, tile) {
        const resume = worker.job && this.#flag ? {job: {...worker.job}, flag: {...this.#flag}} : null;
        this.#assigned.set(worker.id, {group: groupId, tile, resume});
        worker.job = null;
        worker.arrived = false;
    }

    /** Workers still to leave HQ for a dispersal set off. */
    #deployDispersers() {
        for (const [groupId, order] of this.#dispersals) {
            order.workers.forEach((id, i) => {
                if (id !== null || this.#inside === 0) return;
                const worker = this.#spawn();
                order.workers[i] = worker.id;
                this.#assigned.set(worker.id, {group: groupId, tile: order.tiles[i], resume: null});
            });
        }
    }

    /** An order ends when its protest has gone, fled or left, or a worker it holds is no longer outside. */
    #tidyDispersals() {
        if (this.#dispersals.size === 0) return;
        const out = new Set(this.#workers.map(({id}) => id));
        for (const [groupId, order] of [...this.#dispersals]) {
            if (!this.#ecologists?.protest(groupId)) {
                this.#endDispersal(groupId);
                continue;
            }
            const lost = order.workers.some((id) => id !== null && !out.has(id));
            const blocked = this.#map !== null && order.tiles.some((tile) => !isFree(this.#map, tile));
            if (lost || blocked) this.#endDispersal(groupId, {reason: DisperseFailure.UNREACHABLE});
        }
    }

    /** Both at their tiles: count; the last tick breaks the protest up. */
    #countDispersals() {
        for (const [groupId, order] of [...this.#dispersals]) {
            const ready = order.workers.every((id, i) => {
                const worker = this.#workers.find((w) => w.id === id);
                if (!worker || !sameCell(worker, order.tiles[i]) || worker.next) return false;
                const centre = this.#centerOf(order.tiles[i]);
                return worker.x === centre.x && worker.y === centre.y;
            });
            if (!ready || ++order.ticks < DISPERSE.ticks) continue;
            this.#ecologists.disperse(groupId);
            this.#endDispersal(groupId);
        }
    }

    /**
     * Release both workers. Each goes back to the jungle tile it left if it is still
     * jungle, the flag has not moved and nobody else holds it; otherwise the usual
     * flag rules apply. Dusk releases without that: everyone is going home.
     */
    #endDispersal(groupId, {reason = null, resume = true} = {}) {
        const order = this.#dispersals.get(groupId);
        if (!order) return;
        this.#dispersals.delete(groupId);
        for (const id of order.workers) {
            if (id === null) continue;
            const assignment = this.#assigned.get(id);
            this.#assigned.delete(id);
            const worker = this.#workers.find((w) => w.id === id);
            if (!worker || !resume || !assignment?.resume) continue;
            const {job, flag} = assignment.resume;
            const held = this.#workers.some((w) => w !== worker && w.job && sameCell(w.job, job));
            const stillJungle = this.#grid.terrain?.kindAt(job.col, job.row) === TerrainKind.JUNGLE;
            if (stillJungle && !held && this.#flag && sameCell(this.#flag, flag) && this.#atWork()) {
                worker.job = {...job};
                worker.arrived = true; // it was in the work area on this flag already
            }
        }
        if (reason) this.#notices.push({groupId, reason});
    }

    /**
     * One tick towards a dispersal tile, then wait there at its centre.
     * Mirrors a repair's walk; a way cut off since ends the order.
     */
    #toDispersal(worker, tile) {
        if (sameCell(worker, tile)) {
            const centre = this.#centerOf(tile);
            if (worker.x !== centre.x || worker.y !== centre.y) this.#walkTo(worker, centre);
            return;
        }
        if (!this.#atCentre(worker)) {
            this.#walkTo(worker, this.#centerOf(worker));
            return;
        }
        const step = nextStep(this.#map, this.#jobField(tile), worker);
        if (!step) {
            this.#endDispersal(this.#assigned.get(worker.id).group, {reason: DisperseFailure.UNREACHABLE});
            return;
        }
        if (isGate(this.#map, step) && !this.#gateIsPassable(step)) {
            worker.held = step;
            return;
        }
        worker.next = step;
        this.#walkEdge(worker);
    }

    /** An order waiting for a worker gets one from HQ, if one is inside. */
    #deployRepairers() {
        for (const [buildingId, order] of this.#orders) {
            if (order.worker !== null || this.#inside === 0) continue;
            const worker = this.#spawn();
            worker.repair = buildingId;
            order.worker = worker.id;
        }
    }

    /**
     * A worker with an order on a Day: walk to the stand tile and work there.
     * @returns {boolean} whether its tick is spent on the order
     */
    #repair(worker) {
        const order = this.#orders.get(worker.repair);
        const building = order && this.#placement.buildings().find(({id}) => id === worker.repair);
        if (!building) {
            worker.repair = null;
            return false;
        }
        if (!order.tile || !isFree(this.#map, order.tile)) order.tile = this.#chooseStand(worker, building);
        if (!order.tile) {
            this.#endOrder(building.id, RepairFailure.UNREACHABLE);
            return false;
        }
        if (sameCell(worker, order.tile)) {
            const centre = this.#centerOf(order.tile);
            if (worker.x !== centre.x || worker.y !== centre.y) this.#walkTo(worker, centre);
            else this.#mend(worker, order, building);
            return true;
        }
        if (!this.#atCentre(worker)) {
            this.#walkTo(worker, this.#centerOf(worker));
            return true;
        }
        const step = nextStep(this.#map, this.#jobField(order.tile), worker);
        if (!step) {
            order.tile = null; // walled off since: choose again next tick
            return true;
        }
        if (isGate(this.#map, step) && !this.#gateIsPassable(step)) {
            worker.held = step;
            return true;
        }
        worker.next = step;
        this.#walkEdge(worker);
        return true;
    }

    /** The free tile beside the building this worker reaches soonest, ties by row then column. */
    #chooseStand(worker, building) {
        if (!isFree(this.#map, worker)) return null;
        const reach = walkField(this.#map, {col: worker.col, row: worker.row});
        let best = null;
        let bestTime = UNREACHABLE;
        for (const tile of this.#standTiles(building)) {
            const time = reach[tile.row * this.#grid.cols + tile.col];
            if (time < bestTime) {
                best = tile;
                bestTime = time;
            }
        }
        return best;
    }

    /** One tick of repair. Each finished block is paid first, then restored; one it cannot pay ends the order. */
    #mend(worker, order, building) {
        worker.repairing = true;
        if (++order.ticks < REPAIR.ticksPerBlock) return;
        const type = getBuildingType(building.type);
        const {gain, credits} = repairBlock(type, building.hp);
        const cost = {credits, ap: 0};
        if (!this.#economy.canAfford(cost).ok) {
            this.#endOrder(building.id, RepairFailure.NO_CREDITS);
            return;
        }
        this.#economy.spend(cost);
        const repaired = this.#placement.repairBuilding(building.id, gain);
        this.#repairSpent += credits;
        this.#repairRestored += repaired.restored;
        order.ticks = 0;
        if (repaired.hp >= type.maxHp) this.#endOrder(building.id);
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
        if (!this.#cycle.timed) return state; // LEGACY keeps its old shape
        const active = {...state, sent: this.#sent, clearing: this.clearing(), repairs: this.repairs()};
        return this.#ecologists ? {...active, dispersals: this.dispersals()} : active; // only where protesters exist
    }

    /**
     * TASK 042: what a saved dawn keeps. Work belongs to tiles and buildings, not to
     * workers, so the squad itself is not kept: where its members stand and walk.
     */
    checkpoint() {
        return {
            flag: this.flag,
            sent: this.#sent,
            progress: this.clearing().progress,
            cleared: this.#cleared,
            orders: [...this.#orders].map(([buildingId, {ticks}]) => ({buildingId, ticks})),
            repairSpent: this.#repairSpent,
            repairRestored: this.#repairRestored,
            nextId: this.#nextId,
        };
    }

    /**
     * TASK 042: on Continue only. A saved dawn's squad is whole and inside HQ, as each
     * dawn makes it up: a survivor still walking home is simply home, and the next
     * to leave walks out at full HP, as one who went in would. Tile progress, repair
     * orders with their partial block, the flag and the counters are kept, so no
     * work is lost and no repair is free. Dusk has already ended every dispersal.
     * @param {{day: number, flag: object | null, sent: boolean, progress: object[], cleared: number,
     *          orders: object[], repairSpent: number, repairRestored: number, nextId: number}} checkpoint
     */
    restoreDawn({day, flag, sent, progress, cleared, orders, repairSpent, repairRestored, nextId}) {
        if (this.#workers.length > 0 || this.#orders.size > 0 || this.#progress.size > 0) throw new Error('restoreDawn needs a fresh squad');
        const count = (value, name) => {
            if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} ${value}`);
            return value;
        };
        if (flag !== null && !(Number.isInteger(flag?.col) && Number.isInteger(flag?.row))) throw new TypeError(`flag ${JSON.stringify(flag)}`);
        if (typeof sent !== 'boolean') throw new TypeError('sent');
        const standing = new Set(this.#placement.buildings().map((b) => b.id));
        this.#progress.clear();
        for (const {col, row, ticks} of progress) {
            if (!Number.isInteger(col) || !Number.isInteger(row) || ticks < 1 || ticks >= CLEARING.ticksPerTile || !Number.isSafeInteger(ticks)) {
                throw new RangeError(`clearing progress ${JSON.stringify({col, row, ticks})}`);
            }
            this.#progress.set(tileKey({col, row}), ticks);
        }
        this.#orders.clear();
        for (const {buildingId, ticks} of orders) {
            if (!standing.has(buildingId)) throw new Error(`repair order for ${buildingId}, which does not stand`);
            if (!Number.isSafeInteger(ticks) || ticks < 0 || ticks >= REPAIR.ticksPerBlock) throw new RangeError(`repair ticks ${ticks}`);
            this.#orders.set(buildingId, {worker: null, ticks, tile: null});
        }
        this.#flag = flag && {col: flag.col, row: flag.row};
        this.#sent = sent;
        this.#cleared = count(cleared, 'cleared');
        this.#repairSpent = count(repairSpent, 'repairSpent');
        this.#repairRestored = count(repairRestored, 'repairRestored');
        this.#nextId = count(nextId, 'nextId');
        this.#workers.length = 0;
        this.#inside = WORKER.squadSize;
        this.#lost = 0;
        this.#deployTimer = 1;
        this.#dawnDay = day;
        this.#lastShift = Shift.DAY;
        this.#dispersals.clear();
        this.#assigned.clear();
        this.#notices = [];
        this.#jobFields.clear();
        this.#map = null;
        this.#route = null;
        this.#revision = -1;
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
        if (shift === Shift.DUSK && this.#lastShift !== Shift.DUSK) {
            this.#callHome();
            for (const groupId of [...this.#dispersals.keys()]) this.#endDispersal(groupId, {resume: false}); // unfinished: Dusk cancels
        }
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
        worker.repairing = false;
        if (worker.next) {
            this.#walkEdge(worker);
            return;
        }
        const assignment = this.#assigned.get(worker.id);
        if (assignment && this.#repairTime()) {
            this.#toDispersal(worker, assignment.tile);
            return;
        }
        if (worker.repair && this.#repairTime() && this.#repair(worker)) return;
        if (!this.#atWork() || worker.repair) this.#leaveWork(worker);
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

    /** Is the squad at work on the jungle: ACTIVE, sent to a reachable flag, on a running Day? */
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
        const pending = [...this.#orders.values()].filter(({worker}) => worker === null).length;
        if (this.#target() === null || this.#route.blocked || this.#inside - pending <= 0) return;
        if (--this.#deployTimer > 0) return;
        this.#deployTimer = WORKER.deployGapTicks;
        this.#spawn();
    }

    /** One worker out of HQ, onto its exit road. */
    #spawn() {
        this.#inside--;
        const {exit} = this.#route;
        const worker = {
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
            repair: null,
            repairing: false,
        };
        this.#workers.push(worker);
        return worker;
    }
}
