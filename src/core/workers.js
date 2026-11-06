/**
 * HQ's worker squad. Pure: no Phaser, no wall clock and no randomness.
 *
 * Lifecycle: workers are temporary units, like soldiers. They exist on Night ticks
 * 1..3599 and only while the player has a work flag down. At dawn everyone is back
 * inside, so no unit state crosses a Day and Day edits can never strand one. The flag
 * is the player's order, and it stays from Night to Night until it is recalled.
 *
 * A squad is counted, not rebuilt: `inside` is who can still leave. A worker who dies
 * is gone for the rest of that Night, with no replacement, and a full squad is back
 * the next Night, at no cost. A worker recalled home goes inside and can be sent out
 * again the same Night.
 *
 * Workers walk as soldiers do: tile centre to tile centre, down a walk field from
 * core/walkField.js, always finishing the edge they are on. They leave from HQ's
 * receiving dock, a road tile that is always free. They wait before a gate until it
 * is OPEN and ask for it until they stand beyond it. Jungle does not slow them, and
 * they may share a tile, so they can never block each other.
 *
 * Workers have no weapons. Mutants treat them as they treat soldiers: see Mutants.
 * Nothing here runs without a flag or a worker out, so a base that never sends its
 * workers plays exactly as it did.
 *
 * `workRadius` is reserved for the work they will do. Nothing reads it yet, and it has
 * nothing to do with `visionRadius`, which is how far a worker sees.
 */
import {HQ_TYPE} from './buildingTypes.js';
import {UNKNOWN_BUILDING} from './buildingPlacement.js';
import {receivingDock} from './roads.js';
import {Shift} from './shiftCycle.js';
import {VISION_RADIUS} from './vision.js';
import {isFree, isGate, nextStep, resolvePost, walkMap} from './walkField.js';

export const WORKER = Object.freeze({
    squadSize: 3,
    maxHp: 15,
    speed: 1, // px per tick; must divide the tile size
    deployGapTicks: 30,
    visionRadius: VISION_RADIUS.unit,
    workRadius: 3, // tiles, for the work to come
    bodySize: 12, // px, what a mutant has to reach
});

export const WorkFlagFailure = Object.freeze({
    OUT_OF_BOUNDS: 'work-flag-out-of-bounds',
    OCCUPIED: 'work-flag-occupied',
    UNREACHABLE: 'work-flag-unreachable',
});

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
    #flag = null;
    #workers = []; // leaving order, Night only
    #inside = WORKER.squadSize;
    #lost = 0;
    #deployTimer = 1;
    #nextId = 1;
    #map = null;
    #route = null; // {exit, post, blocked, field}
    #revision = -1;

    /**
     * @param {{cycle: import('./shiftCycle.js').ShiftCycle,
     *          placement: import('./buildingPlacement.js').BuildingPlacement,
     *          grid: import('./grid.js').Grid,
     *          gates: import('./gates.js').Gates}} deps
     */
    constructor({cycle, placement, grid, gates}) {
        this.#cycle = cycle;
        this.#placement = placement;
        this.#grid = grid;
        this.#gates = gates;
    }

    get flag() {
        return this.#flag && {...this.#flag};
    }

    /**
     * Would this work flag be accepted? Never mutates. Jungle and unexplored tiles are
     * fine: going there is what workers are for. Placing a flag reveals nothing.
     * @returns {{ok: true} | {ok: false, reason: string}}
     */
    canSetFlag(cell) {
        const hq = this.#hq();
        if (!hq) return {ok: false, reason: UNKNOWN_BUILDING};
        const {col, row} = cell ?? {};
        const inBounds = Number.isInteger(col) && Number.isInteger(row) && col >= 0 && row >= 0 && col < this.#grid.cols && row < this.#grid.rows;
        if (!inBounds) return {ok: false, reason: WorkFlagFailure.OUT_OF_BOUNDS};
        const map = walkMap(this.#grid, this.#placement.buildings());
        if (!isFree(map, cell)) return {ok: false, reason: WorkFlagFailure.OCCUPIED};
        return resolvePost(map, receivingDock(hq), cell).blocked ? {ok: false, reason: WorkFlagFailure.UNREACHABLE} : {ok: true};
    }

    /** Set or move the work flag, free, in Day or Night. Anyone out simply turns round. */
    setFlag(cell) {
        const check = this.canSetFlag(cell);
        if (!check.ok) return check;
        this.#flag = {col: cell.col, row: cell.row};
        this.#revision = -1;
        return check;
    }

    /** Everyone home, on foot. Free, in Day or Night, and it cannot fail. */
    recall() {
        this.#flag = null;
        this.#revision = -1;
    }

    /**
     * One simulation tick. Runs after Infantry.step() and before Mutants.step().
     */
    step() {
        const shift = this.#cycle.shift;
        if (shift === Shift.DEFEATED) return;
        if (shift !== Shift.NIGHT) {
            this.#standDown();
            return;
        }
        if (this.#flag === null && this.#workers.length === 0) return;
        const hq = this.#hq();
        if (!hq) return; // nowhere to leave from or go home to: anyone out stays put
        this.#refreshNavigation(hq);
        for (const worker of [...this.#workers]) this.#move(worker);
        this.#deploy();
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
        }));
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
        return {route: this.route(), flag: this.flag, inside: this.#inside, lost: this.#lost, workers: this.workers()};
    }

    #hq() {
        return this.#placement.buildings().find((building) => building.type === HQ_TYPE) ?? null;
    }

    #standDown() {
        this.#workers.length = 0;
        this.#inside = WORKER.squadSize;
        this.#lost = 0;
        this.#deployTimer = 1;
    }

    /** Fields are rebuilt only when walking or the flag has changed. */
    #refreshNavigation(hq) {
        if (this.#revision === this.#placement.revision) return;
        this.#revision = this.#placement.revision;
        this.#map = walkMap(this.#grid, this.#placement.buildings());
        const exit = receivingDock(hq);
        this.#route = {exit, ...resolvePost(this.#map, exit, this.#flag)};
    }

    #centerOf({col, row}) {
        return this.#grid.cellCenter(col, row);
    }

    #move(worker) {
        worker.held = null;
        if (worker.next) {
            this.#walkEdge(worker);
            return;
        }
        const {post, field} = this.#route;
        if (sameCell(worker, post)) {
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

    /** At the flag, take a place and stay there. Home with no flag, go in. */
    #settle(worker) {
        const {x, y} = this.#centerOf(this.#route.post);
        if (this.#flag !== null) {
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

    /** Along one axis at a time, within a tile. */
    #walkTo(worker, {x, y}) {
        if (worker.x !== x) worker.x += Math.sign(x - worker.x) * WORKER.speed;
        else if (worker.y !== y) worker.y += Math.sign(y - worker.y) * WORKER.speed;
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
        if (this.#flag === null || this.#route.blocked || this.#inside === 0) return;
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
        });
    }
}
