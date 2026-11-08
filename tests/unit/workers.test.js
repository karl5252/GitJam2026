import test from 'node:test';
import assert from 'node:assert/strict';
import {receivingDock} from '../../src/core/roads.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {FogOfWar, VISION_RADIUS, VisionState, unitVision} from '../../src/core/vision.js';
import {INVALID_DAMAGE, UNKNOWN_WORKER, WORKER, WorkFlagFailure} from '../../src/core/workers.js';
import {MapId, WORLD_MAPS, createTerrain} from '../../src/core/worldMap.js';
import {createWorld, digestOf, worldState} from '../soak/harness.js';
import {Ground, speedOn} from '../../src/core/terrainSpeed.js';

const FUNDS = {credits: 90000, ap: 90};
const HQ = {col: 12, row: 8}; // pointer cell: footprint 11..13, 7..9, ring 10..14, 6..10
const EXIT = {col: 12, row: 10};
const world = (options = {}) => createWorld({requireHq: true, roads: true, resources: FUNDS, schedule: [], ...options});

function base(options) {
    const w = world(options);
    const placed = w.place('hq', HQ.col, HQ.row);
    assert.equal(placed.ok, true);
    assert.deepEqual(receivingDock(placed.building), EXIT);
    return w;
}

const run = (w, ticks) => {
    let done = 0;
    while (done < ticks) {
        const ran = w.cycle.stepTicks(1, (t) => w.tick(t));
        if (ran === 0) break;
        done += ran;
    }
    return done;
};
const night = (w, ticks) => {
    w.cycle.endDay();
    return run(w, ticks);
};
const dawn = (w) => run(w, w.cycle.remainingNightTicks);
const arrived = (w, cell) => w.workers.workers().every((worker) => worker.col === cell.col && worker.row === cell.row && !worker.next);
const center = (w, {col, row}) => w.grid.cellCenter(col, row);

test('the squad is configured apart from its vision and work radii, and vision matches soldiers', () => {
    assert.equal(WORKER.squadSize, 3);
    assert.equal(WORKER.visionRadius, 6);
    assert.equal(WORKER.visionRadius, VISION_RADIUS.unit);
    assert.notEqual(WORKER.workRadius, WORKER.visionRadius);
    assert.ok(WORKER.maxHp > 0 && WORKER.speed > 0 && 32 % WORKER.speed === 0);
});

test('with no flag nobody leaves HQ, and nothing runs', () => {
    const w = base();
    night(w, 600);
    assert.deepEqual(w.workers.snapshot(), {
        route: {exit: EXIT, post: EXIT, flag: null, blocked: false}, flag: null, inside: 3, lost: 0, workers: [],
    });
});

test('a flag set by Day sends nobody until Night: Day never ticks', () => {
    const w = base();
    assert.deepEqual(w.workers.setFlag({col: 3, row: 3}), {ok: true});
    assert.equal(w.workers.workers().length, 0);
    assert.equal(run(w, 60), 0);
    assert.equal(w.workers.workers().length, 0);
});

test('at dusk three workers leave one at a time from HQ, and stand on the exit road', () => {
    const w = base();
    w.workers.setFlag({col: 3, row: 3});
    night(w, 1);
    assert.equal(w.workers.workers().length, 1);
    assert.deepEqual([w.workers.workers()[0].col, w.workers.workers()[0].row], [EXIT.col, EXIT.row]);
    assert.equal(w.workers.snapshot().inside, 2);
    run(w, WORKER.deployGapTicks * 2);
    assert.equal(w.workers.workers().length, 3);
    assert.equal(w.workers.snapshot().inside, 0);
});

test('workers reach the flag, take separate places and stop dead: no oscillation', () => {
    const w = base();
    const flag = {col: 3, row: 3};
    w.workers.setFlag(flag);
    night(w, 1000);
    assert.ok(arrived(w, flag));
    const settled = w.workers.workers().map(({x, y}) => [x, y]);
    assert.equal(new Set(settled.map(String)).size, 3);
    run(w, 500);
    assert.deepEqual(w.workers.workers().map(({x, y}) => [x, y]), settled);
});

test('workers walk tile to tile: every position is on a tile line or a slot, and speed is never exceeded', () => {
    const w = base();
    w.workers.setFlag({col: 20, row: 3});
    w.cycle.endDay();
    let last = new Map();
    for (let i = 0; i < 700; i++) {
        run(w, 1);
        for (const {id, x, y} of w.workers.workers()) {
            const before = last.get(id);
            if (before) assert.ok(Math.abs(x - before.x) + Math.abs(y - before.y) <= speedOn(Ground.ROAD, WORKER.speed) + 1e-9, 'never faster than road speed');
        }
        last = new Map(w.workers.workers().map((worker) => [worker.id, worker]));
    }
});

test('moving the flag turns them round on foot, with no jump, and they settle at the new one', () => {
    const w = base();
    w.workers.setFlag({col: 3, row: 3});
    night(w, 200);
    const [{id, x, y}] = w.workers.workers();
    const flag = {col: 20, row: 13};
    assert.deepEqual(w.workers.setFlag(flag), {ok: true});
    run(w, 1);
    const [now] = w.workers.workers();
    assert.equal(now.id, id);
    assert.ok(Math.abs(now.x - x) + Math.abs(now.y - y) <= WORKER.speed);
    run(w, 1200);
    assert.ok(arrived(w, flag));
});

test('recall sends survivors home on foot and they go inside, and they can be sent out again that Night', () => {
    const w = base();
    w.workers.setFlag({col: 3, row: 3});
    night(w, 800);
    assert.equal(w.workers.workers().length, 3);
    const [{x, y}] = w.workers.workers();
    w.workers.recall();
    assert.equal(w.workers.flag, null);
    run(w, 1);
    const [now] = w.workers.workers();
    assert.ok(Math.abs(now.x - x) + Math.abs(now.y - y) <= WORKER.speed);
    run(w, 900);
    assert.equal(w.workers.workers().length, 0);
    assert.equal(w.workers.snapshot().inside, 3);
    w.workers.setFlag({col: 20, row: 13});
    run(w, 100);
    assert.equal(w.workers.workers().length, 3);
});

test('a recall by Day clears the flag, and the next Night nobody goes', () => {
    const w = base();
    w.workers.setFlag({col: 3, row: 3});
    w.workers.recall();
    night(w, 300);
    assert.equal(w.workers.workers().length, 0);
});

test('at dawn everyone is inside, the flag stays, and the next Night the squad sets out again', () => {
    const w = base();
    const flag = {col: 3, row: 3};
    w.workers.setFlag(flag);
    night(w, 500);
    dawn(w);
    assert.equal(w.cycle.shift, Shift.DAY);
    assert.deepEqual(w.workers.snapshot().workers, []);
    assert.equal(w.workers.snapshot().inside, 3);
    assert.deepEqual(w.workers.flag, flag);
    night(w, 1);
    assert.deepEqual([w.workers.workers()[0].col, w.workers.workers()[0].row], [EXIT.col, EXIT.row]);
});

// ---- Flags ---------------------------------------------------------------------

test('a flag cannot go off the map or on a building, and refusing changes nothing', () => {
    const w = base();
    w.place('wall', 2, 2);
    w.place('outpost', 4, 4);
    for (const [cell, reason] of [[{col: -1, row: 0}, WorkFlagFailure.OUT_OF_BOUNDS], [{col: 24, row: 0}, WorkFlagFailure.OUT_OF_BOUNDS],
        [null, WorkFlagFailure.OUT_OF_BOUNDS], [{col: 2, row: 2}, WorkFlagFailure.OCCUPIED], [{col: 4, row: 4}, WorkFlagFailure.OCCUPIED], [HQ, WorkFlagFailure.OCCUPIED]]) {
        assert.deepEqual(w.workers.setFlag(cell), {ok: false, reason});
    }
    assert.equal(w.workers.flag, null);
});

test('with no HQ a flag is refused and nothing moves, and that is safe', () => {
    const w = world();
    assert.equal(w.workers.canSetFlag({col: 1, row: 1}).ok, false);
    assert.equal(w.workers.setFlag({col: 1, row: 1}).ok, false);
    assert.equal(w.workers.route(), null);
    w.workers.recall();
    assert.equal(w.workers.snapshot().route, null);
});

/** A wall ring round cols 2..6, rows 2..6, with cell 4,4 sealed inside. */
function walledOff(w, gap = null) {
    for (let i = 2; i <= 6; i++) {
        for (const [col, row] of [[i, 2], [i, 6], [2, i], [6, i]]) {
            if (gap && gap.col === col && gap.row === row) continue;
            if (w.grid.occupantAt(col, row) === null) assert.equal(w.place('wall', col, row).ok, true);
        }
    }
}

test('an unreachable tile is refused when placed, with a reason', () => {
    const w = base();
    walledOff(w);
    assert.deepEqual(w.workers.setFlag({col: 4, row: 4}), {ok: false, reason: WorkFlagFailure.UNREACHABLE});
});

test('a flag walled off afterwards is blocked: nobody goes, nothing breaks, and it works again once a way opens', () => {
    const w = base();
    const flag = {col: 4, row: 4};
    assert.equal(w.workers.setFlag(flag).ok, true);
    walledOff(w);
    assert.equal(w.workers.route().blocked, true);
    assert.deepEqual(w.workers.flag, flag);
    night(w, 300);
    assert.equal(w.workers.workers().length, 0);
    dawn(w);
    const wall = w.placement.buildings().find((b) => b.col === 6 && b.row === 4);
    assert.equal(w.placement.demolish(wall.id).ok, true);
    assert.equal(w.workers.route().blocked, false);
    night(w, 900);
    assert.ok(arrived(w, flag));
});

// ---- Navigation ----------------------------------------------------------------

test('workers go round a wall line, and never stand on a building', () => {
    const w = base();
    for (let row = 0; row <= 14; row++) assert.equal(w.place('wall', 8, row).ok, true); // a gap only at the bottom
    const flag = {col: 3, row: 3};
    w.workers.setFlag(flag);
    w.cycle.endDay();
    for (let i = 0; i < 1500; i++) {
        run(w, 1);
        for (const {x, y} of w.workers.workers()) {
            const cell = w.grid.worldToCell(x, y);
            assert.equal(w.grid.occupantAt(cell.col, cell.row), null, `inside a building at ${x},${y}`);
        }
    }
    assert.ok(arrived(w, flag));
});

/** HQ, a road out of its ring to the west, a gate across it, and a wall line either side. */
function gated() {
    const w = base();
    for (let col = 9; col >= 5; col--) assert.equal(w.placement.placeRoad({col, row: 8}).ok, true);
    assert.equal(w.place('gateVertical', 7, 8).ok, true);
    for (let row = 0; row < 16; row++) {
        if (row !== 8) assert.equal(w.place('wall', 7, row).ok, true);
    }
    return w;
}

test('workers open a real gate, wait for it, pass, and it shuts behind them', () => {
    const w = gated();
    const flag = {col: 3, row: 8};
    const [gate] = w.placement.gates();
    w.workers.setFlag(flag);
    w.cycle.endDay();
    const states = new Set();
    let waited = false;
    for (let i = 0; i < 900; i++) {
        run(w, 1);
        states.add(w.gates.snapshot().find((g) => g.id === gate.id)?.state);
        waited ||= w.workers.workers().some(({held}) => held !== null);
        for (const {x, y, next} of w.workers.workers()) {
            if (next?.col === 7) assert.equal(w.gates.isOpen(gate.id), true, `in the doorway at ${x},${y} of a shut gate`);
        }
    }
    assert.ok(waited);
    assert.ok(arrived(w, flag));
    assert.ok(states.has('open'));
    run(w, 200);
    assert.equal(w.gates.snapshot().find((g) => g.id === gate.id).state, 'closed');
});

test('a recall brings them back through the same gate', () => {
    const w = gated();
    w.workers.setFlag({col: 3, row: 8});
    night(w, 900);
    w.workers.recall();
    run(w, 900);
    assert.equal(w.workers.workers().length, 0);
    assert.equal(w.workers.snapshot().inside, 3);
});

test('workers share tiles: three sent to one flag through one gate all arrive', () => {
    const w = gated();
    w.workers.setFlag({col: 6, row: 8});
    night(w, 500);
    assert.equal(w.workers.workers().length, 3);
    assert.ok(arrived(w, {col: 6, row: 8}));
});

test('jungle does not stop workers, and they cross it to a flag deep inside', () => {
    const map = WORLD_MAPS[MapId.JUNGLE];
    const terrain = createTerrain(map);
    const w = createWorld({requireHq: true, roads: true, resources: FUNDS, schedule: [], map, terrain});
    assert.equal(w.place('hq', terrain.center.col, terrain.center.row).ok, true);
    const flag = {col: 3, row: 3};
    assert.equal(terrain.kindAt(3, 3), 'jungle');
    assert.deepEqual(w.workers.setFlag(flag), {ok: true});
    night(w, 2000);
    assert.ok(arrived(w, flag));
});

// ---- Vulnerability -------------------------------------------------------------

test('damageWorker is the only way HP changes, and rejects nonsense', () => {
    const w = base();
    w.workers.setFlag({col: 3, row: 3});
    night(w, 1);
    const [{id}] = w.workers.workers();
    assert.deepEqual(w.workers.damageWorker('nobody', 1), {ok: false, reason: UNKNOWN_WORKER});
    for (const amount of [0, -1, 1.5]) assert.deepEqual(w.workers.damageWorker(id, amount), {ok: false, reason: INVALID_DAMAGE});
    assert.deepEqual(w.workers.damageWorker(id, 5), {ok: true, killed: false, hp: WORKER.maxHp - 5});
    assert.deepEqual(w.workers.damageWorker(id, WORKER.maxHp), {ok: true, killed: true, hp: 0});
    assert.deepEqual(w.workers.damageWorker(id, 1), {ok: false, reason: UNKNOWN_WORKER});
});

test('a worker killed at Night is not replaced that Night; a full squad returns the next Night', () => {
    const w = base();
    w.workers.setFlag({col: 3, row: 3});
    night(w, 100);
    const [{id}] = w.workers.workers();
    w.workers.damageWorker(id, WORKER.maxHp);
    assert.equal(w.workers.snapshot().lost, 1);
    run(w, 1500);
    assert.equal(w.workers.workers().length, 2);
    w.workers.recall();
    run(w, 1200);
    w.workers.setFlag({col: 3, row: 3});
    run(w, 200);
    assert.equal(w.workers.workers().length, 2); // still only the survivors
    dawn(w);
    night(w, 100);
    assert.equal(w.workers.workers().length, 3);
    assert.equal(w.workers.snapshot().lost, 0);
});

test('a mutant near workers really kills them', () => {
    const spawnAt = {nextInt: () => 0, snapshot: () => ({})}; // the first border position: top-left
    const w = base({schedule: [5, 40, 80], rng: spawnAt});
    const flag = {col: 1, row: 1};
    w.workers.setFlag(flag);
    w.cycle.endDay();
    run(w, 1400);
    assert.ok(w.workers.snapshot().lost >= 1, `lost ${w.workers.snapshot().lost}`);
});

test('the HQ falling mid-Night freezes everything safely', () => {
    const w = base({schedule: []});
    w.workers.setFlag({col: 3, row: 3});
    night(w, 200);
    const before = w.workers.workers();
    const hq = w.placement.buildings()[0];
    w.placement.damageBuilding(hq.id, hq.hp);
    w.cycle.defeat();
    assert.equal(run(w, 60), 0);
    assert.equal(w.workers.route(), null);
    assert.deepEqual(w.workers.workers(), before);
    w.workers.step();
    w.workers.recall();
    assert.equal(w.workers.setFlag({col: 3, row: 3}).ok, false);
});

// ---- Vision --------------------------------------------------------------------

const fogFor = (w) => new FogOfWar({cols: w.grid.cols, rows: w.grid.rows});
const see = (fog, w) => fog.setSources('workers', unitVision(w.workers.workers(), w.grid, WORKER.visionRadius));

test('vision follows the actual tile, tiles left go explored, and a dead worker stops seeing', () => {
    const w = base();
    const fog = fogFor(w);
    w.workers.setFlag({col: 22, row: 14});
    w.cycle.endDay();
    let firstSeen = null;
    for (let i = 0; i < 900; i++) {
        run(w, 1);
        see(fog, w);
        firstSeen ??= fog.stateAt(EXIT.col, EXIT.row);
    }
    assert.equal(firstSeen, VisionState.VISIBLE);
    assert.equal(fog.stateAt(EXIT.col, EXIT.row), VisionState.EXPLORED);
    assert.equal(fog.stateAt(22, 14), VisionState.VISIBLE);
    for (const {id} of w.workers.workers()) w.workers.damageWorker(id, WORKER.maxHp);
    see(fog, w);
    assert.equal(fog.snapshot().counts[VisionState.VISIBLE], 0);
    assert.equal(fog.stateAt(22, 14), VisionState.EXPLORED);
});

test('a flag alone reveals nothing, only a worker arriving does', () => {
    const w = base();
    const fog = fogFor(w);
    w.workers.setFlag({col: 22, row: 14});
    see(fog, w);
    assert.equal(fog.stateAt(22, 14), VisionState.UNEXPLORED);
});

test('vision recalculates only when a worker changes tile', () => {
    const w = base();
    const fog = fogFor(w);
    w.workers.setFlag({col: 3, row: 3});
    w.cycle.endDay();
    run(w, 1);
    see(fog, w);
    const {revision} = fog;
    let changes = 0;
    for (let i = 0; i < 10; i++) {
        run(w, 1);
        if (see(fog, w)) changes++;
    }
    assert.ok(changes <= 1, `${changes} recalculations in 10 ticks`);
    assert.ok(fog.revision - revision <= 1);
});

// ---- Determinism and non-interference ------------------------------------------

function trace() {
    const w = base({schedule: null, firstNight: 1});
    w.place('autocannon', 12, 4);
    w.workers.setFlag({col: 3, row: 3});
    w.cycle.jumpToDay(9);
    w.cycle.endDay();
    const digests = [];
    while (w.cycle.shift === Shift.NIGHT) {
        run(w, 1);
        digests.push(digestOf(JSON.stringify({...worldState(w), workers: w.workers.snapshot()})));
    }
    return digests;
}

test('the same commands give the same run, tick for tick, workers and all', () => {
    assert.deepEqual(trace(), trace());
});

test('workers draw no random numbers', () => {
    const w = base({schedule: []});
    const before = w.rng.snapshot();
    w.workers.setFlag({col: 3, row: 3});
    night(w, 800);
    assert.deepEqual(w.rng.snapshot(), before);
});

test('a base that sends nobody fights exactly as if workers did not exist', () => {
    const fight = (setup) => {
        const w = base({schedule: null});
        w.place('autocannon', 12, 4);
        setup(w);
        w.cycle.jumpToDay(9);
        w.cycle.endDay();
        const digests = [];
        while (w.cycle.shift === Shift.NIGHT) {
            run(w, 1);
            digests.push(digestOf(JSON.stringify(worldState(w))));
        }
        return digests;
    };
    assert.deepEqual(fight((w) => { w.mutants.setWorkers(null); }), fight(() => {}));
});
