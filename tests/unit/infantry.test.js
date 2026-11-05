import test from 'node:test';
import assert from 'node:assert/strict';
import {BARRACKS_LIMIT, FlagFailure, MAX_BARRACKS} from '../../src/core/buildingPlacement.js';
import {GATE, GateState} from '../../src/core/gates.js';
import {INFANTRY, Infantry, selectInfantryTarget} from '../../src/core/infantry.js';
import {LURE_RANGE, MUTANT, borderSpawns} from '../../src/core/mutants.js';
import {RoadFailure, barracksExit} from '../../src/core/roads.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {GATE_TILE_COST, UNREACHABLE, canStep, nextStep, resolvePost, walkField, walkMap} from '../../src/core/walkField.js';
import {LAYOUT_VERSION, LAYOUT_VERSION_BARRACKS, LayoutFailure, exportLayout, loadLayout} from '../../src/testShadow/layoutSnapshot.js';
import {stackOffsets} from '../../src/scenes/InfantryLayer.js';
import {canonicalState, createWorld, digestOf, worldState} from '../soak/harness.js';

/**
 * Barracks, flags, walking, squads, gates and combat.
 *
 * HQ at pointer 12,8 has its ring on 10-14, 6-10. A Barracks at pointer 16,8
 * covers 15-17, 7-9, with its exit on the ring at 14,8. The Plant stands at
 * pointer 20,3. Combat tests that need a mutant in an exact place give Infantry a
 * stand-in for Mutants; tests of what mutants do give Mutants a stand-in soldier.
 */

const FUNDS = {credits: 100_000, ap: 200};
const ids = (list) => list.map(({id}) => id);

function world({schedule = [], rng, seed = 731, plant = true} = {}) {
    const w = createWorld({seed, rng, resources: FUNDS, requireHq: true, roads: true, schedule});
    assert.equal(w.place('hq', 12, 8).ok, true);
    if (plant) assert.equal(w.place('powerPlant', 20, 3).ok, true);
    return w;
}

const road = (w, cells) => {
    for (const [col, row] of cells) assert.equal(w.placement.placeRoad({col, row}).ok, true, `road ${col},${row}`);
};

const build = (w, type, col, row) => {
    const result = w.place(type, col, row);
    assert.equal(result.ok, true, `${type} ${col},${row}: ${result.reason}`);
    return result.building.id;
};

const flag = (w, id, col, row) => {
    const result = w.placement.setFlag(id, {col, row});
    assert.equal(result.ok, true, `flag ${col},${row}: ${result.reason}`);
};

const step = (w, ticks, watch = () => {}) => {
    for (let i = 0; i < ticks && w.cycle.shift === Shift.NIGHT; i++) {
        w.cycle.stepTicks(1, w.tick);
        watch(w.cycle.elapsedNightTicks);
    }
};

/** Step until something is true. One that never comes fails, rather than hanging. */
const until = (w, condition, limit = 3000) => {
    for (let i = 0; i < limit; i++) {
        if (condition()) return;
        assert.equal(w.cycle.shift, Shift.NIGHT, 'the Night ended first');
        w.cycle.stepTicks(1, w.tick);
    }
    assert.fail(`not reached in ${limit} ticks`);
};

function barracksWorld(options) {
    const w = world(options);
    return {w, id: build(w, 'barracks', 16, 8)};
}

const soldiers = (w) => w.infantry.soldiers();
const center = (w, col, row) => w.grid.cellCenter(col, row);
const gateOf = (w, id) => w.gates.snapshot().find((g) => g.id === id);
const spawnIndex = (w, col, row) => borderSpawns(w.grid).findIndex((s) => s.col === col && s.row === row);

// ---- Barracks ---------------------------------------------------------------

test('the exit is the middle of the left side', () => {
    assert.deepEqual(barracksExit({col: 15, row: 7, width: 3, height: 3}), {col: 14, row: 8});
});

test('a Barracks needs a connected road on its exit tile, and on no other', () => {
    const w = world();
    w.placement.select('barracks');
    const away = w.placement.preview({col: 18, row: 8});
    assert.deepEqual([away.ok, away.reason, away.dock], [false, RoadFailure.NO_EXIT_ACCESS, {col: 16, row: 8}]);
    assert.equal(w.placement.preview({col: 16, row: 7}).ok, true, 'exit 14,7 is on the ring');
    w.placement.cancel();

    assert.equal(w.place('barracks', 16, 12).reason, RoadFailure.NO_EXIT_ACCESS, 'next to nothing');
    build(w, 'barracks', 16, 8);
    assert.equal(w.economy.credits, FUNDS.credits - 500 - 400);
});

test('a Barracks at the left map edge has no exit, and it cannot go on a road', () => {
    const w = world();
    assert.equal(w.place('barracks', 1, 8).reason, RoadFailure.NO_EXIT_ACCESS);
    road(w, [[15, 8]]);
    assert.equal(w.place('barracks', 16, 8).reason, RoadFailure.ROAD_OCCUPIED);
});

test('with no road network a Barracks cannot be built', () => {
    const w = createWorld({resources: FUNDS});
    assert.equal(w.place('barracks', 16, 8).reason, RoadFailure.NO_EXIT_ACCESS);
});

test('a Barracks gets no truck and earns nothing', () => {
    const {w} = barracksWorld();
    w.cycle.endDay();
    step(w, 3600);
    const {trucks, factories} = w.logistics.snapshot();
    assert.deepEqual([trucks, factories], [[], []]);
    assert.equal(w.cycle.lastSettlement.net, 0);
    assert.equal(w.cycle.lastSettlement.pollution.emitted, 12, 'the Plant only');
});

test('the exit road cannot be removed, gated or built on, so it can never be blocked', () => {
    const w = world();
    road(w, [[15, 8], [16, 8]]);
    build(w, 'barracks', 18, 8);
    assert.equal(w.placement.removeRoad({col: 16, row: 8}).reason, RoadFailure.EXIT_REQUIRED);
    assert.equal(w.placement.removeRoad({col: 15, row: 8}).reason, RoadFailure.EXIT_REQUIRED);
    assert.equal(w.place('wall', 16, 8).reason, RoadFailure.ROAD_OCCUPIED);
    assert.equal(w.roads.has({col: 16, row: 8}), true);
});

test('a Factory and a Barracks can share a tile, and the road then names the Factory', () => {
    const w = world();
    road(w, [[14, 11], [14, 12], [14, 13]]);
    build(w, 'factory', 12, 13); // dock 14,13
    build(w, 'barracks', 16, 13); // exit 14,13
    assert.equal(w.placement.removeRoad({col: 14, row: 13}).reason, RoadFailure.ROAD_REQUIRED);
});

test('no gate goes on an exit, and none may cut an exit off', () => {
    const w = world();
    road(w, [[15, 8], [16, 8], [17, 8], [16, 9], [16, 10], [16, 11], [16, 12]]);
    build(w, 'barracks', 18, 11); // exit 16,11
    assert.equal(w.place('gateHorizontal', 16, 11).reason, RoadFailure.GATE_ON_DOCK);
    assert.equal(w.place('gateVertical', 16, 8).reason, RoadFailure.EXIT_REQUIRED, 'it would cut the branch');
    build(w, 'gateHorizontal', 16, 10);
    assert.equal(w.roads.isConnected({col: 16, row: 11}), true);
});

function fourBarracks() {
    const w = world();
    road(w, [[14, 5], [14, 4], [14, 3], [14, 11], [14, 12], [14, 13]]);
    road(w, [[9, 8], [8, 8], [7, 8], [6, 8], [5, 8], [4, 8], [3, 8], [3, 7], [3, 6], [3, 5]]);
    return {w, list: [[16, 8], [16, 3], [16, 13], [5, 5]].map(([col, row]) => build(w, 'barracks', col, row))};
}

test('no more than four Barracks stand at once; losing one frees a place', () => {
    const {w, list} = fourBarracks();
    assert.equal(MAX_BARRACKS, 4);
    road(w, [[3, 9], [3, 10], [3, 11]]);
    assert.deepEqual(w.placement.canBuild('barracks'), {ok: false, reason: BARRACKS_LIMIT});
    assert.equal(w.placement.select('barracks'), false);
    assert.equal(w.placement.demolish(list[3]).ok, true);
    assert.deepEqual(w.placement.canBuild('barracks'), {ok: true});
    build(w, 'barracks', 5, 11);
    assert.deepEqual(w.placement.canBuild('barracks'), {ok: false, reason: BARRACKS_LIMIT});
});

test('a Barracks can be demolished during Day only, with no refund', () => {
    const {w, id} = barracksWorld();
    const credits = w.economy.credits;
    w.cycle.endDay();
    assert.equal(w.placement.demolish(id).reason, 'construction-disabled');
    step(w, 3600);
    assert.deepEqual(w.placement.demolish(id), {ok: true});
    assert.equal(w.economy.credits, credits);
    assert.equal(w.grid.occupantAt(16, 8), null);
    assert.deepEqual(w.placement.barracks(), []);
});

// ---- Walking ----------------------------------------------------------------

const map = (buildings) => walkMap({cols: 5, rows: 5}, buildings.map((b) => ({width: 1, height: 1, ...b})));
const barrier = (gate) => [0, 1, 3, 4].map((col) => ({type: 'wall', col, row: 2})).concat({type: gate, col: 2, row: 2});
const fieldKey = (col, row) => row * 5 + col;

test('a gate can be crossed along its passage axis and costs the wait for it', () => {
    const m = map(barrier('gateHorizontal'));
    const field = walkField(m, {col: 2, row: 4});
    assert.equal(GATE_TILE_COST, 5);
    assert.equal(field[fieldKey(2, 3)], 1);
    assert.equal(field[fieldKey(2, 2)], 2);
    assert.equal(field[fieldKey(2, 1)], 3 + GATE_TILE_COST);
});

test('a gate is solid across its passage axis', () => {
    const m = map(barrier('gateVertical'));
    const field = walkField(m, {col: 2, row: 4});
    assert.equal(field[fieldKey(2, 2)], UNREACHABLE);
    assert.equal(field[fieldKey(2, 1)], UNREACHABLE);
    assert.equal(canStep(m, {col: 2, row: 1}, {col: 2, row: 2}), false);
    assert.equal(canStep(m, {col: 2, row: 2}, {col: 2, row: 3}), false);
});

test('a gate cannot be left or entered sideways, even with open ground beside it', () => {
    const m = map([{type: 'gateHorizontal', col: 2, row: 2}]);
    assert.equal(canStep(m, {col: 1, row: 2}, {col: 2, row: 2}), false);
    assert.equal(canStep(m, {col: 2, row: 2}, {col: 3, row: 2}), false);
    assert.equal(canStep(m, {col: 2, row: 1}, {col: 2, row: 2}), true);
    assert.equal(canStep(m, {col: 2, row: 2}, {col: 2, row: 3}), true);
});

test('walls are never walked through, and a short walk round beats a gate', () => {
    const m = map([{type: 'wall', col: 2, row: 1}, {type: 'wall', col: 2, row: 2}, {type: 'gateVertical', col: 2, row: 3}]);
    const goal = {col: 3, row: 3};
    const field = walkField(m, goal);
    let cell = {col: 1, row: 3};
    const walked = [];
    while (cell && walked.length < 50) {
        walked.push(`${cell.col},${cell.row}`);
        assert.notEqual(`${cell.col},${cell.row}`, '2,2');
        cell = nextStep(m, field, cell);
    }
    assert.deepEqual(walked, ['1,3', '1,4', '2,4', '3,4', '3,3']);
});

test('following a field always ends at its goal, and every step lowers the cost', () => {
    const m = map(barrier('gateHorizontal'));
    const field = walkField(m, {col: 4, row: 4});
    let cell = {col: 0, row: 0};
    let cost = field[fieldKey(0, 0)];
    for (let i = 0; i < 50; i++) {
        const next = nextStep(m, field, cell);
        if (!next) break;
        assert.ok(field[fieldKey(next.col, next.row)] < cost);
        cost = field[fieldKey(next.col, next.row)];
        cell = next;
    }
    assert.deepEqual(cell, {col: 4, row: 4});
});

test('a goal under a building is reached from nowhere, and a flag there falls back to the exit', () => {
    const m = map([{type: 'wall', col: 2, row: 2}]);
    assert.ok(walkField(m, {col: 2, row: 2}).every((cost) => cost === UNREACHABLE));
    const {post, blocked} = resolvePost(m, {col: 0, row: 0}, {col: 2, row: 2});
    assert.deepEqual([post, blocked], [{col: 0, row: 0}, true]);
    assert.deepEqual(resolvePost(m, {col: 0, row: 0}, null).blocked, false);
});

test('revision changes on every change to walking, and on nothing else', () => {
    const {w, id} = barracksWorld();
    const changes = (act) => {
        const before = w.placement.revision;
        act();
        return w.placement.revision !== before;
    };
    assert.equal(changes(() => build(w, 'wall', 3, 3)), true, 'wall');
    assert.equal(changes(() => build(w, 'outpost', 3, 4)), true, 'building');
    assert.equal(changes(() => flag(w, id, 5, 5)), true, 'flag');
    assert.equal(changes(() => w.placement.demolish(w.grid.occupantAt(3, 3))), true, 'demolition');
    assert.equal(changes(() => w.placement.damageBuilding(w.grid.occupantAt(3, 4), 100)), true, 'destruction');
    road(w, [[15, 6], [16, 6], [17, 6]]);
    assert.equal(changes(() => build(w, 'gateVertical', 16, 6)), true, 'gate');
    assert.equal(changes(() => w.place('wall', 16, 8)), false, 'a rejected placement');
    assert.equal(changes(() => w.placement.setFlag(id, {col: 16, row: 8})), false, 'a rejected flag');
    assert.equal(changes(() => w.placement.damageBuilding(id, 1)), false, 'damage alone');
    assert.equal(changes(() => w.placement.setEnabled(id, false)), false, 'power');
    assert.equal(changes(() => road(w, [[18, 6]])), false, 'a road');
});

test('a gate opening and closing does not touch the revision', () => {
    const w = world();
    road(w, [[9, 8], [8, 8], [7, 8]]);
    const gate = build(w, 'gateVertical', 8, 8);
    const before = w.placement.revision;
    w.cycle.endDay();
    w.cycle.stepTicks(1, (t) => { w.cycle.onTick(t); w.gates.step(new Set([gate])); });
    step(w, GATE.openTicks + 5);
    assert.equal(w.placement.revision, before);
});

// ---- Flags ------------------------------------------------------------------

test('a flag goes on open ground or a road, in Day or Night, free of charge', () => {
    const {w, id} = barracksWorld();
    const resources = w.economy.snapshot();
    flag(w, id, 5, 2);
    assert.deepEqual(w.placement.barracks()[0].flag, {col: 5, row: 2});
    flag(w, id, 12, 6);
    w.cycle.endDay();
    flag(w, id, 20, 12);
    assert.deepEqual(w.placement.barracks()[0].flag, {col: 20, row: 12});
    assert.deepEqual(w.economy.snapshot(), resources);
});

test('a detached Barracks record cannot move a flag', () => {
    const {w, id} = barracksWorld();
    flag(w, id, 5, 2);
    w.placement.barracks()[0].flag.col = 0;
    w.placement.buildings().find((b) => b.id === id).flag.row = 0;
    assert.deepEqual(w.placement.barracks()[0].flag, {col: 5, row: 2});
});

test('a flag cannot go on a building, gate, off the map or on another squad', () => {
    const w = world();
    road(w, [[14, 5], [14, 4], [14, 3], [9, 8], [8, 8], [7, 8]]);
    const a = build(w, 'barracks', 16, 8);
    const b = build(w, 'barracks', 16, 3);
    build(w, 'gateVertical', 8, 8);
    const reason = (id, col, row) => w.placement.setFlag(id, {col, row}).reason;
    assert.equal(reason(b, 14, 8), FlagFailure.TAKEN, 'the other exit, while its squad stands there');
    flag(w, a, 5, 2);
    assert.equal(reason(b, 12, 8), FlagFailure.OCCUPIED, 'HQ');
    assert.equal(reason(b, 16, 8), FlagFailure.OCCUPIED, 'a Barracks');
    assert.equal(reason(b, 8, 8), FlagFailure.OCCUPIED, 'a gate');
    assert.equal(reason(b, -1, 2), FlagFailure.OUT_OF_BOUNDS);
    assert.equal(reason(b, 24, 2), FlagFailure.OUT_OF_BOUNDS);
    assert.equal(reason(b, 1.5, 2), FlagFailure.OUT_OF_BOUNDS);
    assert.equal(reason(b, 5, 2), FlagFailure.TAKEN, 'the other flag');
    assert.equal(reason('hq-1', 5, 2), 'unknown-building');
    assert.equal(reason('barracks-99', 5, 2), 'unknown-building');
    assert.equal(w.placement.barracks()[1].flag, null);
});

/** Walls all round 3,3, with a Horizontal Gate on its east side, on the col 4 road. */
function sealedTile({wrongGate = true} = {}) {
    const w = world();
    road(w, [[9, 8], [8, 8], [7, 8], [6, 8], [5, 8], [4, 8], [4, 7], [4, 6], [4, 5], [4, 4], [4, 3], [4, 2]]);
    const id = build(w, 'barracks', 16, 8);
    const walls = [[3, 2], [3, 4], [2, 3]].map(([col, row]) => build(w, 'wall', col, row));
    const gate = wrongGate ? build(w, 'gateHorizontal', 4, 3) : null;
    return {w, id, walls, gate};
}

test('a flag behind a wrong-axis gate is unreachable', () => {
    const {w, id} = sealedTile();
    assert.equal(w.placement.setFlag(id, {col: 3, row: 3}).reason, FlagFailure.UNREACHABLE);
    assert.equal(w.placement.barracks()[0].flag, null);
});

test('a flag walled off afterwards is kept, and the squad falls back to the exit, not into a loop', () => {
    const {w, id, walls} = sealedTile({wrongGate: false});
    flag(w, id, 3, 3);
    build(w, 'gateHorizontal', 4, 3);
    assert.deepEqual(w.infantry.posts()[0], {id, exit: {col: 14, row: 8}, flag: {col: 3, row: 3}, post: {col: 14, row: 8}, blocked: true});
    w.cycle.endDay();
    step(w, 400);
    assert.deepEqual(soldiers(w).map(({col, row}) => [col, row]), new Array(4).fill([14, 8]));

    // A breach makes the flag good again, at once and with nothing remembered.
    w.placement.damageBuilding(walls[2], 100);
    step(w, 1);
    assert.equal(w.infantry.snapshot().squads[0].blocked, false);
    step(w, 900);
    assert.deepEqual(soldiers(w).map(({col, row}) => [col, row]), new Array(4).fill([3, 3]));
});

test('a flag built over is blocked until the building goes', () => {
    const {w, id} = barracksWorld();
    flag(w, id, 5, 2);
    const wall = build(w, 'wall', 5, 2);
    assert.equal(w.infantry.posts()[0].blocked, true);
    assert.deepEqual(w.infantry.posts()[0].post, {col: 14, row: 8});
    w.placement.demolish(wall);
    assert.equal(w.infantry.posts()[0].blocked, false);
});

// ---- Deployment -------------------------------------------------------------

/** The tick each soldier first appeared. */
function arrivals(w, ticks) {
    const seen = new Map();
    step(w, ticks, (at) => {
        for (const {id} of soldiers(w)) if (!seen.has(id)) seen.set(id, at);
    });
    return [...seen.values()];
}

test('a squad leaves on ticks 1, 31, 61 and 91, from the exit, and stops at four', () => {
    const {w} = barracksWorld();
    w.cycle.endDay();
    assert.deepEqual(arrivals(w, 2000), [1, 31, 61, 91]);
    assert.equal(soldiers(w).length, INFANTRY.squadSize);
    assert.deepEqual(soldiers(w).map((s) => s.slot), [0, 1, 2, 3]);
});

test('a soldier appears on the exit tile and first moves on the next tick', () => {
    const {w, id} = barracksWorld();
    flag(w, id, 20, 13);
    w.cycle.endDay();
    step(w, 1);
    const [first] = soldiers(w);
    const {x, y} = center(w, 14, 8);
    assert.deepEqual([first.col, first.row, first.x, first.y, first.hp], [14, 8, x, y, INFANTRY.maxHp]);
    step(w, 1);
    assert.equal(Math.abs(soldiers(w)[0].x - x) + Math.abs(soldiers(w)[0].y - y), INFANTRY.speed);
});

test('a replacement arrives 600 powered ticks after a death, and no sooner', () => {
    const {w} = barracksWorld();
    w.cycle.endDay();
    step(w, 700);
    const [victim] = soldiers(w);
    assert.equal(w.infantry.damageSoldier(victim.id, INFANTRY.maxHp).killed, true);
    step(w, 599);
    assert.equal(soldiers(w).length, 3);
    step(w, 1);
    assert.equal(soldiers(w).length, 4);
    assert.equal(soldiers(w).at(-1).slot, victim.slot, 'it takes the empty place');
});

test('several losses come back one per 600 ticks, never above four', () => {
    const {w} = barracksWorld();
    w.cycle.endDay();
    step(w, 700);
    for (const {id} of soldiers(w).slice(0, 3)) w.infantry.damageSoldier(id, INFANTRY.maxHp);
    assert.equal(soldiers(w).length, 1);
    const counts = [];
    for (let i = 0; i < 4; i++) {
        step(w, 600);
        counts.push(soldiers(w).length);
    }
    assert.deepEqual(counts, [2, 3, 4, 4]);
});

test('a timer does not run at full strength, so an early death earns no credit', () => {
    const {w} = barracksWorld();
    w.cycle.endDay();
    step(w, 1500);
    assert.equal(w.infantry.snapshot().squads[0].replaceTimer, 0);
    w.infantry.damageSoldier(soldiers(w)[0].id, INFANTRY.maxHp);
    step(w, 10);
    assert.equal(w.infantry.snapshot().squads[0].replaceTimer, 10);
});

test('a soldier lost during the muster does not stop the rest, and only then does the timer start', () => {
    const {w} = barracksWorld();
    w.cycle.endDay();
    step(w, 40);
    w.infantry.damageSoldier(soldiers(w)[0].id, INFANTRY.maxHp);
    step(w, 51);
    const squad = w.infantry.snapshot().squads[0];
    assert.deepEqual([squad.pending, squad.living, squad.replaceTimer], [0, 3, 0]);
    step(w, 599);
    assert.equal(soldiers(w).length, 3);
    step(w, 1);
    assert.equal(soldiers(w).length, 4);
});

test('with no power nobody leaves, and the muster counts powered ticks once power returns', () => {
    const {w, id} = barracksWorld();
    w.placement.setEnabled(id, false);
    w.cycle.endDay();
    step(w, 100);
    assert.deepEqual(soldiers(w), []);
    w.placement.setEnabled(id, true);
    assert.deepEqual(arrivals(w, 100), [101, 131, 161, 191]);
});

test('low power stops deployment: a Barracks on HQ power alone sends nobody', () => {
    const w = world({plant: false});
    build(w, 'barracks', 16, 8);
    w.cycle.endDay();
    step(w, 200);
    assert.deepEqual(soldiers(w), []);
});

test('a power outage pauses replacement, and soldiers already out fight on', () => {
    const {w, id} = barracksWorld();
    w.cycle.endDay();
    step(w, 700);
    w.infantry.damageSoldier(soldiers(w)[0].id, INFANTRY.maxHp);
    step(w, 300);
    w.placement.setEnabled(id, false);
    step(w, 1000);
    assert.equal(soldiers(w).length, 3, 'still out');
    assert.equal(w.infantry.snapshot().squads[0].replaceTimer, 300, 'paused');
    w.placement.setEnabled(id, true);
    step(w, 299);
    assert.equal(soldiers(w).length, 3);
    step(w, 1);
    assert.equal(soldiers(w).length, 4);
});

test('a destroyed Barracks sends nobody else; survivors hold their post until dawn', () => {
    const {w, id} = barracksWorld();
    flag(w, id, 20, 12);
    w.cycle.endDay();
    step(w, 45); // two out, two to come
    assert.equal(w.placement.damageBuilding(id, 300).destroyed, true);
    step(w, 800);
    const out = soldiers(w);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map(({col, row}) => [col, row]), [[20, 12], [20, 12]]);
    w.infantry.damageSoldier(out[0].id, INFANTRY.maxHp);
    step(w, 1000);
    assert.equal(soldiers(w).length, 1, 'no replacement');
    w.infantry.damageSoldier(soldiers(w)[0].id, INFANTRY.maxHp);
    step(w, 1);
    assert.deepEqual(w.infantry.snapshot().squads, []);
});

test('everyone goes home at dawn and a full, unhurt squad musters the next Night', () => {
    const {w} = barracksWorld();
    w.cycle.endDay();
    step(w, 700);
    w.infantry.damageSoldier(soldiers(w)[0].id, 10);
    w.infantry.damageSoldier(soldiers(w)[1].id, INFANTRY.maxHp);
    step(w, 3600);
    assert.equal(w.cycle.shift, Shift.DAY);
    assert.deepEqual(soldiers(w), []);
    assert.deepEqual(w.infantry.snapshot().squads, []);
    w.cycle.endDay();
    const ticks = arrivals(w, 100);
    assert.deepEqual(ticks, [1, 31, 61, 91]);
    assert.ok(soldiers(w).every((s) => s.hp === INFANTRY.maxHp));
});

test('a soldier acts on ticks up to 3599 and the settling tick does nothing', () => {
    const {w} = barracksWorld();
    w.cycle.endDay();
    step(w, 3599);
    assert.equal(soldiers(w).length, 4);
    step(w, 1);
    assert.deepEqual(soldiers(w), []);
});

test('defeat freezes the squad', () => {
    const {w} = barracksWorld();
    w.cycle.endDay();
    step(w, 50);
    const before = soldiers(w);
    w.cycle.defeat();
    for (let i = 0; i < 100; i++) assert.deepEqual(w.infantry.step(), {shots: []});
    assert.deepEqual(soldiers(w), before);
});

test('damage must be a positive integer, and a dead soldier is gone for good', () => {
    const {w} = barracksWorld();
    w.cycle.endDay();
    step(w, 1);
    const [{id}] = soldiers(w);
    assert.equal(w.infantry.damageSoldier(id, 0).reason, 'invalid-damage');
    assert.equal(w.infantry.damageSoldier(id, 1.5).reason, 'invalid-damage');
    assert.deepEqual(w.infantry.damageSoldier(id, 5), {ok: true, killed: false, hp: 25});
    assert.deepEqual(w.infantry.damageSoldier(id, 25), {ok: true, killed: true, hp: 0});
    assert.equal(w.infantry.damageSoldier(id, 5).reason, 'unknown-soldier');
});

test('soldier ids are never reused and reading state changes nothing', () => {
    const {w} = barracksWorld();
    w.cycle.endDay();
    step(w, 100);
    const first = JSON.stringify(w.infantry.snapshot());
    for (let i = 0; i < 5; i++) w.infantry.snapshot();
    assert.equal(JSON.stringify(w.infantry.snapshot()), first);
    w.infantry.soldiers()[0].hp = 1;
    assert.equal(soldiers(w)[0].hp, INFANTRY.maxHp);
    const ids1 = ids(soldiers(w));
    step(w, 3600);
    w.cycle.endDay();
    step(w, 100);
    assert.equal(ids(soldiers(w)).filter((id) => ids1.includes(id)).length, 0);
});

test('four Barracks field sixteen soldiers at most', () => {
    const {w} = fourBarracks();
    build(w, 'powerPlant', 20, 8);
    w.cycle.endDay();
    step(w, 3000);
    assert.equal(soldiers(w).length, 16);
    assert.equal(new Set(soldiers(w).map((s) => s.barracksId)).size, 4);
});

// ---- Movement ---------------------------------------------------------------

/** Every soldier stands on open ground or in a gate it may use. */
function assertNoClipping(w) {
    const buildings = new Map(w.placement.buildings().map((b) => [b.id, b]));
    for (const soldier of soldiers(w)) {
        const cell = w.grid.worldToCell(soldier.x, soldier.y);
        for (const tile of [cell, {col: soldier.col, row: soldier.row}]) {
            const building = buildings.get(w.grid.occupantAt(tile.col, tile.row));
            assert.ok(!building || building.type.startsWith('gate'), `${soldier.id} inside ${building?.id}`);
        }
    }
}

test('soldiers leave the road, cross open ground and stand apart on the flag', () => {
    const {w, id} = barracksWorld();
    flag(w, id, 20, 13);
    w.cycle.endDay();
    let offRoad = false;
    step(w, 900, () => {
        assertNoClipping(w);
        offRoad ||= soldiers(w).some((s) => !w.roads.has({col: s.col, row: s.row}));
    });
    assert.equal(offRoad, true);
    const {x, y} = center(w, 20, 13);
    assert.deepEqual(soldiers(w).map((s) => [s.x - x, s.y - y]), [[-8, -8], [8, -8], [-8, 8], [8, 8]]);
});

test('with no flag the squad guards the exit', () => {
    const {w} = barracksWorld();
    w.cycle.endDay();
    step(w, 200);
    assert.deepEqual(soldiers(w).map(({col, row}) => [col, row]), new Array(4).fill([14, 8]));
});

test('soldiers walk round a wall, and straight through the gap a destroyed wall leaves', () => {
    const {w, id} = barracksWorld();
    const line = [];
    for (let row = 0; row < 15; row++) line.push(build(w, 'wall', 8, row));
    flag(w, id, 4, 8);
    w.cycle.endDay();
    const outer = [];
    step(w, 250, () => { assertNoClipping(w); outer.push(soldiers(w)[0].row); });
    assert.ok(Math.max(...outer) >= 10, 'heading for the gap at the bottom of the wall');

    const [first] = soldiers(w);
    w.placement.damageBuilding(line[first.row] ?? line[14], 100);
    step(w, 1200, () => assertNoClipping(w));
    assert.deepEqual(soldiers(w).map(({col, row}) => [col, row]), new Array(4).fill([4, 8]));
});

test('moving the flag at Night turns the squad round from wherever it is', () => {
    const {w, id} = barracksWorld();
    flag(w, id, 20, 13);
    w.cycle.endDay();
    step(w, 150);
    flag(w, id, 5, 2);
    step(w, 900, () => assertNoClipping(w));
    assert.deepEqual(soldiers(w).map(({col, row}) => [col, row]), new Array(4).fill([5, 2]));
});

// ---- Gates ------------------------------------------------------------------

/** A wall down col 6 from top to bottom, broken only by a gate on the row 8 road. */
function gatedWest({schedule = [], rng} = {}) {
    const w = world({schedule, rng});
    road(w, [[9, 8], [8, 8], [7, 8], [6, 8], [5, 8]]);
    const id = build(w, 'barracks', 16, 8);
    for (let row = 0; row < 16; row++) if (row !== 8) build(w, 'wall', 6, row);
    const gate = build(w, 'gateVertical', 6, 8);
    flag(w, id, 3, 8);
    return {w, id, gate};
}

/** Anyone in a doorway, or stepping into one, must find the gate OPEN. */
function assertGateHolds(w, gate, list = soldiers(w)) {
    const {col, row, state} = gateOf(w, gate) ?? {};
    if (!state) return;
    for (const soldier of list) {
        const inside = (soldier.col === col && soldier.row === row) || (soldier.next?.col === col && soldier.next?.row === row);
        assert.ok(!inside || state === GateState.OPEN, `${soldier.id} in a ${state} gate`);
    }
}

const inDoorway = (w, gate, soldier) => {
    const {col, row} = gateOf(w, gate);
    return soldier.col === col && soldier.row === row;
};

test('a soldier waits for OPEN, the gate holds for the last of several, then closes', () => {
    const {w, gate} = gatedWest();
    w.cycle.endDay();
    const held = new Set();
    let opened = 0;
    let wasOpen = false;
    step(w, 1500, () => {
        assertNoClipping(w);
        assertGateHolds(w, gate);
        for (const soldier of soldiers(w)) if (soldier.held) held.add(soldier.id);
        const isOpen = gateOf(w, gate).state === GateState.OPEN;
        if (isOpen && !wasOpen) opened++;
        wasOpen = isOpen;
    });
    assert.ok(held.size >= 1, 'somebody had to wait');
    assert.ok(opened >= 1);
    assert.deepEqual(soldiers(w).map(({col, row}) => [col, row]), new Array(4).fill([3, 8]));
    assert.equal(gateOf(w, gate).state, GateState.CLOSED);
});

test('a gate next to the exit is safe on tick one, before any gate has been stepped', () => {
    const w = world();
    road(w, [[15, 8], [16, 8]]);
    const id = build(w, 'barracks', 18, 8); // exit 16,8
    build(w, 'wall', 16, 7);
    build(w, 'wall', 16, 9);
    const gate = build(w, 'gateVertical', 15, 8);
    flag(w, id, 13, 5);
    assert.deepEqual(w.infantry.posts()[0].blocked, false);
    w.cycle.endDay();

    // The soldier's first move would be into the gate. It must not be taken.
    w.cycle.stepTicks(1, w.tick);
    const [first] = soldiers(w);
    assert.deepEqual([first.col, first.row, first.next], [16, 8, null]);
    w.cycle.stepTicks(1, w.tick);
    assert.deepEqual(soldiers(w)[0].held, {col: 15, row: 8});
    assert.equal(soldiers(w)[0].x, center(w, 16, 8).x, 'waiting at the centre');
    assert.equal(gateOf(w, gate).state, GateState.CLOSED, 'asked for on the next tick');
    w.cycle.stepTicks(1, w.tick);
    assert.equal(gateOf(w, gate).state, GateState.OPENING);
    step(w, 800, () => assertGateHolds(w, gate));
    assert.deepEqual(soldiers(w).map(({col, row}) => [col, row]), new Array(4).fill([13, 5]));
});

test('gate demand does not depend on gate records', () => {
    const {w, gate} = gatedWest();
    w.cycle.endDay();
    const wanted = new Set();
    w.infantry.addGateDemands(wanted);
    assert.equal(wanted.size, 0, 'nobody is out yet');
    step(w, 700, () => {
        const now = new Set();
        w.infantry.addGateDemands(now);
        for (const id of now) assert.equal(id, gate);
    });
});

test('a mutant in range never stops a soldier in the doorway', () => {
    const {w, gate} = gatedWest();
    const {x, y} = center(w, 5, 8);
    const fake = standIn([{id: 'mutant-1', x, y, hp: 100_000}]);
    const infantry = new Infantry({cycle: w.cycle, placement: w.placement, grid: w.grid, gates: w.gates, mutants: fake.mutants});
    const tick = standInTick(w, infantry);
    w.cycle.endDay();
    const stay = new Map();
    let fought = false;
    for (let i = 0; i < 1200; i++) {
        w.cycle.stepTicks(1, tick);
        assertGateHolds(w, gate, infantry.soldiers());
        for (const soldier of infantry.soldiers()) {
            if (!inDoorway(w, gate, soldier)) continue;
            fought ||= soldier.targetId !== null;
            stay.set(soldier.id, (stay.get(soldier.id) ?? 0) + 1);
        }
    }
    assert.equal(fought, true, 'the scenario must put a soldier in the doorway with a target');
    assert.equal(stay.size, 4, 'all four came through');
    for (const ticks of stay.values()) assert.equal(ticks, w.grid.tileSize, 'through without stopping');
});

test('an enemy does not take a soldier off a gate it is waiting for: its post lies beyond', () => {
    const {w, gate} = gatedWest();
    const fake = standIn([]);
    const infantry = new Infantry({cycle: w.cycle, placement: w.placement, grid: w.grid, gates: w.gates, mutants: fake.mutants});
    const shots = [];
    const tick = standInTick(w, infantry, shots);
    w.cycle.endDay();
    for (let i = 0; i < 1500 && !infantry.soldiers()[0]?.held; i++) w.cycle.stepTicks(1, tick);
    const waiting = infantry.soldiers()[0];
    assert.deepEqual(waiting.held, {col: 6, row: 8});

    fake.list.push({id: 'mutant-1', x: waiting.x, y: waiting.y + 40, hp: 100_000});
    for (let i = 0; i < 20; i++) w.cycle.stepTicks(1, tick);
    assert.deepEqual(infantry.soldiers()[0].held, {col: 6, row: 8}, 'still asking');
    assert.ok(shots.length > 0, 'and shooting while it waits');
    assert.equal(gateOf(w, gate).state, GateState.OPENING);
});

test('a soldier waiting for a gate it no longer needs stops asking, and the gate closes', () => {
    const {w, id, gate} = gatedWest();
    w.cycle.endDay();
    until(w, () => soldiers(w)[0]?.held);
    step(w, 10);
    assert.equal(gateOf(w, gate).state, GateState.OPENING);
    flag(w, id, 9, 4);
    step(w, 700);
    assert.equal(gateOf(w, gate).state, GateState.CLOSED);
    assert.deepEqual(soldiers(w).map(({col, row}) => [col, row]), new Array(4).fill([9, 4]));
});

test('a flag change in the doorway does not let the gate close on the soldier', () => {
    const {w, gate, id} = gatedWest();
    w.cycle.endDay();
    until(w, () => soldiers(w).some((s) => inDoorway(w, gate, s)));
    flag(w, id, 20, 13);
    step(w, 1500, () => { assertGateHolds(w, gate); assertNoClipping(w); });
    assert.deepEqual(soldiers(w).map(({col, row}) => [col, row]), new Array(4).fill([20, 13]));
    assert.equal(gateOf(w, gate).state, GateState.CLOSED);
});

test('injury in the doorway does not release the gate; only leaving does', () => {
    const {w, gate} = gatedWest();
    w.cycle.endDay();
    until(w, () => soldiers(w).some((s) => inDoorway(w, gate, s)));
    const hurt = soldiers(w).find((s) => inDoorway(w, gate, s));
    w.infantry.damageSoldier(hurt.id, 5);
    const wanted = new Set();
    w.infantry.addGateDemands(wanted);
    assert.equal(wanted.has(gate), true);
    step(w, 5, () => assertGateHolds(w, gate));
});

test('a soldier dying in the doorway stops asking, and the gate closes behind the last one', () => {
    const {w, gate} = gatedWest();
    w.cycle.endDay();
    until(w, () => soldiers(w).some((s) => inDoorway(w, gate, s)));
    for (const {id} of soldiers(w)) w.infantry.damageSoldier(id, INFANTRY.maxHp);
    const wanted = new Set();
    w.infantry.addGateDemands(wanted);
    assert.equal(wanted.size, 0);
    step(w, 1);
    assert.equal(gateOf(w, gate).state, GateState.CLOSING);
    step(w, GATE.closeTicks);
    assert.equal(gateOf(w, gate).state, GateState.CLOSED);
});

test('a gate destroyed mid-crossing is simply gone: the crossing finishes', () => {
    const {w, gate} = gatedWest();
    w.cycle.endDay();
    until(w, () => soldiers(w).some((s) => s.next?.col === 6 && s.next?.row === 8));
    assert.equal(w.placement.damageBuilding(gate, 150).destroyed, true);
    const wanted = new Set();
    w.infantry.addGateDemands(wanted);
    assert.equal(wanted.size, 0, 'the map still says gate until the next rebuild');
    step(w, 1000, () => assertNoClipping(w));
    assert.deepEqual(soldiers(w).map(({col, row}) => [col, row]), new Array(4).fill([3, 8]));
});

test('soldiers never damage their own walls or gates', () => {
    const {w} = gatedWest();
    const hp = () => w.placement.buildings().map((b) => b.hp);
    const before = hp();
    w.cycle.endDay();
    step(w, 3000);
    assert.deepEqual(hp(), before);
});

// ---- Combat -----------------------------------------------------------------

/** Stands in for Mutants, so a target can be put in an exact place and kept alive. */
function standIn(list) {
    const hits = [];
    return {
        list,
        hits,
        mutants: {
            snapshot: () => list.map((m) => ({...m})),
            damageMutant: (id, amount) => {
                const mutant = list.find((m) => m.id === id);
                if (!mutant) return {ok: false, reason: 'unknown-mutant'};
                hits.push({id, amount});
                mutant.hp -= amount;
                if (mutant.hp > 0) return {ok: true, killed: false, hp: mutant.hp};
                list.splice(list.indexOf(mutant), 1);
                return {ok: true, killed: true, hp: 0};
            },
        },
    };
}

/** Same order as the game, with Infantry in place of the harness's own. */
const standInTick = (w, infantry, shots = []) => (t) => {
    w.cycle.onTick(t);
    const wanted = new Set();
    infantry.addGateDemands(wanted);
    w.gates.step(wanted);
    shots.push(...infantry.step().shots);
};

function fight(list, setUp = () => {}) {
    const {w, id} = barracksWorld();
    flag(w, id, 20, 13);
    setUp(w, id);
    const fake = standIn(list);
    const infantry = new Infantry({cycle: w.cycle, placement: w.placement, grid: w.grid, gates: w.gates, mutants: fake.mutants});
    const shots = [];
    const tick = standInTick(w, infantry, shots);
    w.cycle.endDay();
    return {w, id, fake, infantry, shots, run: (ticks, watch = () => {}) => {
        for (let i = 0; i < ticks; i++) {
            w.cycle.stepTicks(1, tick);
            watch();
        }
    }};
}

const POST = {x: 256 + 20.5 * 32, y: 104 + 13.5 * 32};
const nearest = (at, mutants) => selectInfantryTarget(at, POST, mutants)?.id ?? null;

test('values are the approved ones', () => {
    assert.deepEqual(INFANTRY, {
        squadSize: 4, maxHp: 30, speed: 1, weaponRange: 96, damage: 5, cooldownTicks: 90, defendRadius: 160,
        releaseRadius: 192, leashTiles: 4, deployGapTicks: 30, replaceTicks: 600, bodySize: 12,
    });
    assert.equal(LURE_RANGE, 64);
    assert.ok(Object.isFrozen(INFANTRY));
});

test('targets are near the soldier or near the post, nearest first, ties to the earliest', () => {
    const at = {x: POST.x, y: POST.y};
    assert.equal(nearest(at, []), null);
    assert.equal(nearest(at, [{id: 'far', x: POST.x + 161, y: POST.y}]), null);
    assert.equal(nearest(at, [{id: 'edge', x: POST.x + 160, y: POST.y}]), 'edge');
    assert.equal(nearest({x: 0, y: 0}, [{id: 'by-soldier', x: 96, y: 0}]), 'by-soldier');
    assert.equal(nearest(at, [{id: 'a', x: POST.x + 50, y: POST.y}, {id: 'b', x: POST.x - 50, y: POST.y}]), 'a');
    assert.equal(nearest(at, [{id: 'a', x: POST.x + 90, y: POST.y}, {id: 'b', x: POST.x + 50, y: POST.y}]), 'b');
});

test('a soldier hits for 5 every 90 ticks, and no faster', () => {
    const {shots, run, infantry} = fight([{id: 'mutant-1', x: POST.x, y: POST.y - 80, hp: 100_000}]);
    let ticks = 0;
    const times = {};
    run(1500, () => {
        ticks++;
        for (const shot of shots.splice(0)) {
            assert.equal(shot.damage, 5);
            (times[shot.soldierId] ??= []).push(ticks);
        }
    });
    const list = Object.values(times);
    assert.equal(list.length, 4);
    assert.ok(infantry.soldiers().length === 4);
    for (const fired of list) {
        for (let i = 1; i < fired.length; i++) assert.equal(fired[i] - fired[i - 1], INFANTRY.cooldownTicks);
    }
});

test('shots pass over walls and buildings, and never touch them', () => {
    const walled = (w) => {
        for (let col = 18; col <= 23; col++) build(w, 'wall', col, 11);
    };
    const {w, run, fake} = fight([{id: 'mutant-1', x: POST.x, y: POST.y - 90, hp: 100_000}], walled);
    const before = w.placement.buildings().map((b) => b.hp);
    run(1200);
    assert.ok(fake.hits.length > 0);
    assert.deepEqual(w.placement.buildings().map((b) => b.hp), before);
});

test('a soldier fires on the march without stopping, and a kill frees every lock', () => {
    const start = {x: 256 + 17 * 32, y: 104 + 11 * 32};
    const {infantry, run, fake} = fight([{id: 'mutant-1', x: start.x, y: start.y, hp: 40}]);
    run(400);
    assert.equal(fake.list.length, 0);
    assert.ok(infantry.soldiers().every((s) => s.targetId === null));
    run(600);
    assert.deepEqual(infantry.soldiers().map(({col, row}) => [col, row]), new Array(4).fill([20, 13]));
});

test('soldiers close on a mutant in the defended area, up to the pursuit limit and no further', () => {
    const {w, infantry, run, fake} = fight([]);
    run(600); // on post
    fake.list.push({id: 'mutant-1', x: POST.x - 158, y: POST.y, hp: 100_000});
    const map2 = walkMap(w.grid, w.placement.buildings());
    const field = walkField(map2, {col: 20, row: 13});
    let furthest = 0;
    run(800, () => {
        for (const {col, row} of infantry.soldiers()) furthest = Math.max(furthest, field[row * 24 + col]);
    });
    assert.ok(furthest >= 1, 'they moved');
    assert.ok(furthest <= INFANTRY.leashTiles, `went ${furthest} tiles`);
});

test('the pursuit limit holds even with a target that could be reached one tile further', () => {
    const {w, infantry, run, fake} = fight([]);
    run(600);
    const field = walkField(walkMap(w.grid, w.placement.buildings()), {col: 20, row: 13});
    // Inside the area, then off on the diagonal: still locked, 5 walking tiles to get in range.
    fake.list.push({id: 'mutant-1', x: POST.x - 112, y: POST.y - 112, hp: 100_000});
    run(30);
    Object.assign(fake.list[0], {x: POST.x - 135, y: POST.y - 135});
    let furthest = 0;
    run(600, () => {
        for (const {col, row} of infantry.soldiers()) furthest = Math.max(furthest, field[row * 24 + col]);
    });
    assert.ok(infantry.soldiers().every((s) => s.targetId === 'mutant-1'), 'still locked');
    assert.equal(furthest, INFANTRY.leashTiles);
});

test('a target that leaves the area is let go, and the squad returns to its places', () => {
    const {infantry, run, fake} = fight([]);
    run(600);
    const home = infantry.soldiers().map(({x, y}) => [x, y]);
    fake.list.push({id: 'mutant-1', x: POST.x - 158, y: POST.y, hp: 100_000});
    run(300);
    assert.notDeepEqual(infantry.soldiers().map(({x, y}) => [x, y]), home);
    fake.list[0].x = POST.x - 400;
    run(400);
    assert.ok(infantry.soldiers().every((s) => s.targetId === null));
    assert.deepEqual(infantry.soldiers().map(({x, y}) => [x, y]), home);
});

test('a mutant beyond the area is ignored, however long it stays', () => {
    const {infantry, run, fake} = fight([]);
    run(600);
    fake.list.push({id: 'mutant-1', x: POST.x - 200, y: POST.y, hp: 100_000});
    const home = infantry.soldiers().map(({x, y}) => [x, y]);
    run(500);
    assert.deepEqual(fake.hits, []);
    assert.deepEqual(infantry.soldiers().map(({x, y}) => [x, y]), home);
});

test('real mutants die to soldiers, and damage and kills are tallied', () => {
    const {w, id} = barracksWorld({schedule: [700], rng: {nextInt: () => 47, snapshot: () => ({})}});
    flag(w, id, 16, 13);
    w.cycle.endDay();
    let alive = 0;
    step(w, 1600, () => { alive = Math.max(alive, w.mutants.snapshot().length); });
    assert.equal(alive, 1);
    assert.equal(w.mutants.snapshot().length, 0);
    const {night} = w.infantry.snapshot();
    assert.equal(night.kills, 1);
    assert.equal(night.shots, 8, '40 HP at 5 a hit');
});

// ---- Mutants against soldiers -------------------------------------------------

/** A stand-in soldier, so a mutant's choices can be tested on their own. */
function standInSoldier(w, ...positions) {
    const list = positions.map(({x, y}, i) => ({id: `soldier-${i + 1}`, x, y, hp: 30}));
    const hits = [];
    w.mutants.setInfantry({
        attackableSoldiers: () => list.filter((s) => s.hp > 0).map((s) => ({...s})),
        damageSoldier: (id, amount) => {
            const soldier = list.find((s) => s.id === id);
            soldier.hp -= amount;
            hits.push({id, tick: w.cycle.elapsedNightTicks});
            return {ok: true, killed: soldier.hp <= 0, hp: Math.max(0, soldier.hp)};
        },
    });
    return {list, hits};
}

/** A mutant walking north up col 12 from the bottom edge towards HQ. */
function walker() {
    const w = world({schedule: [1], rng: {nextInt: () => 51, snapshot: () => ({})}});
    assert.equal(spawnIndex(w, 12, 15), 51);
    return w;
}

test('a soldier in melee reach stops a mutant, which kills it in six hits, 60 ticks apart', () => {
    const w = walker();
    const {x, y} = center(w, 12, 13);
    const {hits} = standInSoldier(w, {x, y});
    w.cycle.endDay();
    step(w, 600);
    assert.equal(hits.length, 6);
    for (let i = 1; i < hits.length; i++) assert.equal(hits[i].tick - hits[i - 1].tick, MUTANT.attackCooldownTicks);
    assert.deepEqual(w.placement.buildings().map((b) => b.hp), [600, 300], 'buildings wait their turn');
});

test('a soldier off to the side pulls a walking mutant within 64 px, and it fights', () => {
    const w = walker();
    const {x, y} = center(w, 12, 13);
    const {hits} = standInSoldier(w, {x: x + 50, y});
    w.cycle.endDay();
    step(w, 600);
    assert.ok(hits.length > 0);
    assert.notEqual(w.mutants.snapshot()[0].x, x);
});

test('beyond 64 px a soldier has no pull', () => {
    const w = walker();
    const {x, y} = center(w, 12, 13);
    const {hits} = standInSoldier(w, {x: x + 90, y});
    w.cycle.endDay();
    step(w, 500);
    assert.deepEqual(hits, []);
    assert.equal(w.mutants.snapshot()[0].x, x);
});

/** Walls all round 14,13, beside the mutant's way up col 12. */
function boxedSoldier(w) {
    const box = {};
    for (let col = 13; col <= 15; col++) {
        for (let row = 12; row <= 14; row++) {
            if (col !== 14 || row !== 13) box[`${col},${row}`] = build(w, 'wall', col, row);
        }
    }
    return box;
}

/** Where the mutant was on every tick of a Night, with or without a soldier in the box. */
function pathPast(withSoldier) {
    const w = walker();
    boxedSoldier(w);
    const soldier = withSoldier ? standInSoldier(w, center(w, 14, 13)) : {hits: []};
    const path = [];
    w.cycle.endDay();
    step(w, 900, () => path.push(w.mutants.snapshot().map(({x, y, targetId}) => [x, y, targetId])));
    return {w, path, hits: soldier.hits};
}

test('a soldier behind a wall is never acquired: the mutant walks on exactly as if it were not there', () => {
    const {w, path, hits} = pathPast(true);
    assert.deepEqual(hits, []);
    assert.deepEqual(path, pathPast(false).path);
    assert.ok(w.placement.buildings()[0].hp < 600, 'it reached its objective');
});

test('a lure half blocked by walls cannot make a mutant jitter', () => {
    const w = walker();
    for (const col of [12, 13, 14]) build(w, 'wall', col, 12);
    build(w, 'wall', 13, 13);
    standInSoldier(w, center(w, 14, 13));
    const ys = [];
    const xs = [];
    w.cycle.endDay();
    step(w, 900, () => {
        const [mutant] = w.mutants.snapshot();
        if (!mutant) return;
        xs.push(mutant.x);
        ys.push(mutant.y);
    });
    const reversals = (values) => {
        const moves = values.slice(1).map((v, i) => Math.sign(v - values[i])).filter(Boolean);
        return moves.slice(1).filter((move, i) => move !== moves[i]).length;
    };
    assert.ok(reversals(xs) <= 4, `${reversals(xs)} turns in x`);
    assert.ok(reversals(ys) <= 4, `${reversals(ys)} turns in y`);
});

test('a blocked lure comes back the moment the wall falls: nothing is remembered', () => {
    const w = walker();
    const box = boxedSoldier(w);
    const {x, y} = center(w, 14, 13);
    const {hits} = standInSoldier(w, {x, y});
    w.cycle.endDay();
    until(w, () => w.mutants.snapshot()[0]?.y <= y);
    assert.deepEqual(hits, []);
    w.placement.damageBuilding(box['13,13'], 100);
    step(w, 200);
    assert.ok(hits.length > 0, 'the mutant came in through the breach');
});

test('a lure opens through an open gate and closes with it', () => {
    const w = world({schedule: [1], rng: {nextInt: () => 71, snapshot: () => ({})}});
    road(w, [[9, 8], [8, 8], [7, 8], [6, 8], [5, 8], [4, 8], [3, 8], [2, 8]]);
    const gate = w.place('gateVertical', 3, 8).building.id;
    for (let row = 0; row < 16; row++) if (row !== 8) w.place('wall', 3, row);
    const {x, y} = center(w, 4, 8);
    const {hits} = standInSoldier(w, {x, y: y + 20});
    w.cycle.endDay();
    const held = (t) => { w.cycle.onTick(t); w.gates.step(new Set([gate])); w.mutants.step(); };
    for (let i = 0; i < GATE.openTicks + 400; i++) w.cycle.stepTicks(1, held);
    assert.ok(hits.length > 0, 'the mutant came through to the soldier');
});

test('a mutant attacking an obstacle is not pulled away from it', () => {
    const w = walker();
    for (let col = 0; col < 24; col++) build(w, 'wall', col, 12); // too long to walk round
    w.cycle.endDay();
    until(w, () => w.mutants.snapshot()[0]?.obstacleId);
    const {x, y, obstacleId} = w.mutants.snapshot()[0];
    const {hits} = standInSoldier(w, {x: x + 40, y});
    step(w, 240);
    const [mutant] = w.mutants.snapshot();
    assert.deepEqual([mutant.x, mutant.y, mutant.obstacleId], [x, y, obstacleId]);
    assert.ok(w.placement.buildings().find((b) => b.id === obstacleId).hp < 100, 'it kept hitting the wall');
    assert.deepEqual(hits, []);
});

test('a mutant at its objective is not pulled away from it', () => {
    const w = walker();
    w.cycle.endDay();
    until(w, () => w.placement.buildings()[0].hp < 600);
    const {x, y} = w.mutants.snapshot()[0];
    standInSoldier(w, {x: x + 40, y: y + 20});
    step(w, 120);
    assert.deepEqual([w.mutants.snapshot()[0].x, w.mutants.snapshot()[0].y], [x, y]);
});

test('a dead soldier releases the mutant, whose strategic target never changed', () => {
    const w = walker();
    const {x, y} = center(w, 12, 13);
    standInSoldier(w, {x, y});
    w.cycle.endDay();
    step(w, 2);
    const {targetId} = w.mutants.snapshot()[0];
    step(w, 800);
    assert.equal(w.mutants.snapshot()[0].targetId, targetId);
    step(w, 800);
    assert.ok(w.mutants.snapshot()[0].y < y, 'moved on');
});

test('a real squad takes real damage and a real replacement follows', () => {
    const rng = {nextInt: () => 47, snapshot: () => ({})};
    const {w, id} = barracksWorld({schedule: [700, 720, 740, 760, 780, 800, 820, 840, 860, 880], rng});
    flag(w, id, 16, 14);
    w.cycle.endDay();
    let hurt = false;
    step(w, 2400, () => { hurt ||= soldiers(w).some((s) => s.hp < INFANTRY.maxHp); });
    assert.equal(hurt, true);
    assert.ok(w.infantry.snapshot().totals.lost > 0);
    assert.ok(w.infantry.snapshot().totals.deployed > 4, 'replacements arrived');
});

test('with no soldiers mutants behave exactly as before, down to the RNG', () => {
    const run = (withBarracks) => {
        const w = createWorld({seed: 98, resources: FUNDS, requireHq: true, roads: true, schedule: [100, 200, 300]});
        w.place('hq', 12, 8);
        w.place('powerPlant', 20, 3);
        const id = withBarracks ? w.place('barracks', 16, 8).building.id : null;
        if (withBarracks) w.placement.setEnabled(id, false); // standing, but sends nobody
        w.cycle.endDay();
        step(w, 3000);
        return w.mutants.snapshot().map(({id: mutant, x, y}) => [mutant, x, y]);
    };
    assert.equal(run(false).length, 3);
    assert.deepEqual(run(true).map(([id]) => id), run(false).map(([id]) => id));
});

// ---- Determinism --------------------------------------------------------------

/** A full Night with a flag move at a fixed tick, by step or by frame. */
function scripted(seed, advance) {
    const w = createWorld({seed, resources: FUNDS, requireHq: true, roads: true, schedule: [100, 300, 500, 700, 900, 1100, 1300]});
    w.place('hq', 12, 8);
    w.place('powerPlant', 20, 3);
    const id = w.place('barracks', 16, 8).building.id;
    w.placement.setFlag(id, {col: 20, row: 13});
    w.cycle.endDay();
    const onTick = (t) => {
        w.tick(t);
        if (w.cycle.elapsedNightTicks === 1000) w.placement.setFlag(id, {col: 5, row: 2});
    };
    advance(w, onTick);
    return digestOf(canonicalState(worldState(w)));
}

const byStep = (w, onTick) => {
    for (let i = 0; i < 2000; i++) w.cycle.stepTicks(1, onTick);
};

const byFrames = (speed, frameMs) => (w, onTick) => {
    w.clock.setSpeed(speed);
    for (let frame = 0; frame < 20_000 && w.cycle.elapsedNightTicks < 2000; frame++) {
        w.clock.advance(frameMs, (t) => {
            if (w.cycle.elapsedNightTicks < 2000) onTick(t);
        });
    }
};

test('the same seed and commands give the same soldiers', () => {
    assert.equal(scripted(731, byStep), scripted(731, byStep));
    assert.notEqual(scripted(731, byStep), scripted(98, byStep));
});

test('1x, 2x and 4x give identical results, with a Night flag move, at any frame rate', () => {
    const expected = scripted(731, byStep);
    for (const speed of [1, 2, 4]) {
        for (const frameMs of [1000 / 60, 1000 / 30, 37]) {
            assert.equal(scripted(731, byFrames(speed, frameMs)), expected, `${speed}x at ${frameMs} ms`);
        }
    }
});

test('soldiers draw nothing from the RNG', () => {
    const {w} = barracksWorld();
    const before = w.rng.snapshot();
    w.cycle.endDay();
    step(w, 3000);
    assert.deepEqual(w.rng.snapshot(), before);
});

// ---- Presentation ---------------------------------------------------------------

test('soldiers stacked on one point are drawn apart, and others are drawn where they are', () => {
    const at = (x, y) => ({x, y});
    assert.deepEqual(stackOffsets([at(1, 1), at(2, 2), at(3, 3)]), [[0, 0], [0, 0], [0, 0]]);
    const stacked = stackOffsets([at(1, 1), at(1, 1), at(1, 1), at(1, 1), at(2, 2)]);
    assert.equal(new Set(stacked.slice(0, 4).map(String)).size, 4);
    assert.deepEqual(stacked[4], [0, 0]);
});

// ---- Layouts ------------------------------------------------------------------

function fresh() {
    return createWorld({resources: FUNDS, requireHq: true, roads: true});
}

test('a layout with no Barracks stays version 1, with no trace of flags', () => {
    const w = world();
    const snapshot = exportLayout(w);
    assert.equal(snapshot.version, LAYOUT_VERSION);
    assert.equal(JSON.stringify(snapshot).includes('flag'), false);
});

test('a Barracks makes a layout version 2, and flags round trip exactly', () => {
    const w = world();
    road(w, [[14, 5], [14, 4], [14, 3]]);
    const a = build(w, 'barracks', 16, 8);
    build(w, 'barracks', 16, 3);
    build(w, 'wall', 3, 3);
    flag(w, a, 5, 2);
    w.placement.setEnabled(a, false);
    const snapshot = exportLayout(w);
    assert.equal(snapshot.version, LAYOUT_VERSION_BARRACKS);
    assert.deepEqual(snapshot.buildings.filter((b) => b.type === 'barracks').map((b) => b.flag), [{col: 5, row: 2}, null]);

    const copy = fresh();
    assert.equal(loadLayout(copy, snapshot).ok, true);
    assert.deepEqual(exportLayout(copy), snapshot);
    assert.deepEqual(copy.economy.snapshot(), FUNDS);
});

test('a flag walled off before export still loads, blocked, as it was', () => {
    const {w, id} = barracksWorld();
    flag(w, id, 5, 2);
    build(w, 'wall', 5, 2);
    const snapshot = exportLayout(w);
    const copy = fresh();
    const result = loadLayout(copy, snapshot);
    assert.equal(result.ok, true, result.detail);
    assert.deepEqual(exportLayout(copy), snapshot);
    assert.equal(copy.infantry.posts()[0].blocked, true);
});

test('a loaded layout fights exactly like the original', () => {
    const digest = (w) => {
        w.cycle.endDay();
        step(w, 1500);
        return digestOf(canonicalState(worldState(w)).replaceAll(/"id":"[^"]*"|"(targetId|barracksId)":"[^"]*"/g, ''));
    };
    const {w, id} = barracksWorld({schedule: [100, 400]});
    flag(w, id, 20, 13);
    const snapshot = exportLayout(w);
    const copy = createWorld({resources: FUNDS, requireHq: true, roads: true, schedule: [100, 400]});
    assert.equal(loadLayout(copy, snapshot).ok, true);
    assert.equal(digest(copy), digest(w));
});

const v2 = () => {
    const {w, id} = barracksWorld();
    flag(w, id, 5, 2);
    return exportLayout(w);
};

const REJECTED = {
    'version 1 cannot hold a Barracks': [LayoutFailure.UNSUPPORTED_SCHEMA, (s) => { s.version = 1; }],
    'version 2 needs a Barracks': [LayoutFailure.UNSUPPORTED_SCHEMA, (s) => { s.buildings = s.buildings.filter((b) => b.type !== 'barracks'); }],
    'version 3 does not exist': [LayoutFailure.UNSUPPORTED_SCHEMA, (s) => { s.version = 3; }],
    'a Barracks with no flag field': [LayoutFailure.INVALID_SNAPSHOT, (s) => { delete s.buildings.at(-1).flag; }],
    'a flag on another building': [LayoutFailure.INVALID_SNAPSHOT, (s) => { s.buildings[0].flag = null; }],
    'a malformed flag': [LayoutFailure.INVALID_SNAPSHOT, (s) => { s.buildings.at(-1).flag = {col: 1}; }],
    'a fractional flag': [LayoutFailure.INVALID_SNAPSHOT, (s) => { s.buildings.at(-1).flag = {col: 1.5, row: 2}; }],
    'a flag off the map': [FlagFailure.OUT_OF_BOUNDS, (s) => { s.buildings.at(-1).flag = {col: 99, row: 2}; }],
};

for (const [name, [reason, spoil]] of Object.entries(REJECTED)) {
    test(`layout rejected: ${name}`, () => {
        const snapshot = v2();
        spoil(snapshot);
        const w = fresh();
        const result = loadLayout(w, snapshot);
        assert.equal(result.reason, reason, result.detail);
        assert.notEqual(result.applied, true);
        assert.deepEqual(w.placement.buildings(), []);
    });
}

test('a layout cannot smuggle in a fifth Barracks', () => {
    const {w} = fourBarracks();
    const snapshot = exportLayout(w);
    snapshot.roads.push({col: 3, row: 9, kind: 'player'}, {col: 3, row: 10, kind: 'player'}, {col: 3, row: 11, kind: 'player'});
    snapshot.buildings.push({type: 'barracks', col: 4, row: 10, enabled: true, flag: null});
    assert.equal(loadLayout(fresh(), snapshot).reason, BARRACKS_LIMIT);
});
