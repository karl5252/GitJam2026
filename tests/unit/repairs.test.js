/**
 * TASK 025.4C: explicit, paid building repairs by HQ's workers, in the real ACTIVE
 * cycle through the soak harness, in GameScene's tick order.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {getBuildingType} from '../../src/core/buildingTypes.js';
import {GAME_PAUSED} from '../../src/core/buildingPlacement.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {MAX_MANUAL_STEPS} from '../../src/core/simulationClock.js';
import {TerrainKind} from '../../src/core/terrain.js';
import {REPAIR, RepairFailure, WORKER, WorkFlagFailure, repairBlock, repairPrice} from '../../src/core/workers.js';
import {WORLD_MAPS, createTerrain} from '../../src/core/worldMap.js';
import {workerFrame} from '../../src/scenes/WorkerLayer.js';
import {createWorld} from '../soak/harness.js';

const FUNDS = {credits: 9000, ap: 40};

/** HQ, a Plant and two Autocannons, through Day 0 and Night 1 to the first timed Day. */
function base({credits = FUNDS.credits} = {}) {
    const w = createWorld({requireHq: true, roads: true, resources: {credits, ap: 40}, schedule: [], active: true});
    for (const [type, col, row] of [['hq', 12, 8], ['powerPlant', 20, 3], ['autocannon', 16, 8], ['autocannon', 8, 8], ['autocannon', 12, 3]]) {
        assert.equal(w.place(type, col, row).ok, true, type);
    }
    w.cycle.endDay();
    while (w.cycle.shift !== Shift.DAY) w.cycle.stepTicks(1, w.tick);
    w.economy.restoreAp(40);
    return w;
}

const byType = (w, type, n = 0) => w.placement.buildings().filter((b) => b.type === type)[n];
const hpOf = (w, id) => w.placement.buildings().find((b) => b.id === id)?.hp;

function run(w, ticks, onTick = () => {}) {
    for (let i = 0; i < ticks && w.cycle.active; i++) {
        w.cycle.stepTicks(1, w.tick);
        onTick(i);
    }
}

const untilShift = (w, shift) => {
    while (w.cycle.shift !== shift) w.cycle.stepTicks(1, w.tick);
};

// ---- the core path and the price ---------------------------------------------------

test('repairBuilding is the only way HP goes up: capped, never revives, rejects nonsense', () => {
    const w = base();
    const plant = byType(w, 'powerPlant');
    w.placement.damageBuilding(plant.id, 120);
    assert.deepEqual(w.placement.repairBuilding(plant.id, 50), {ok: true, hp: 230, restored: 50});
    assert.deepEqual(w.placement.repairBuilding(plant.id, 500), {ok: true, hp: 300, restored: 70}, 'never above max');
    assert.equal(w.placement.repairBuilding(plant.id, 0).ok, false);
    assert.equal(w.placement.repairBuilding(plant.id, 1.5).ok, false);
    assert.deepEqual(w.placement.repairBuilding('nothing-9', 10), {ok: false, reason: 'unknown-building'});
    const wall = w.place('wall', 2, 2).building;
    w.placement.damageBuilding(wall.id, 100);
    assert.equal(w.placement.repairBuilding(wall.id, 10).reason, 'unknown-building', 'destroyed is gone');
});

test('price: 60% of the build price for full HP, in proportion; HQ 1 Credit per HP; blocks add up exactly', () => {
    const full = (id) => repairPrice(getBuildingType(id), getBuildingType(id).maxHp);
    assert.equal(full('factory'), 240); // 400 x 0.6
    assert.equal(full('powerPlant'), 300);
    assert.equal(full('autocannon'), 150);
    assert.equal(full('wall'), 15);
    assert.equal(full('gateVertical'), 60);
    assert.equal(full('hq'), 600, 'HQ: 1 Credit per HP');
    for (const id of ['factory', 'powerPlant', 'autocannon', 'siegeCannon', 'barracks', 'outpost', 'wall', 'gateHorizontal', 'hq']) {
        const type = getBuildingType(id);
        for (const start of [1, 7, 33, type.maxHp - 1]) {
            let hp = start;
            let paid = 0;
            while (hp < type.maxHp) {
                const {gain, credits} = repairBlock(type, hp);
                assert.ok(gain > 0 && gain <= REPAIR.hpPerBlock && credits >= 0);
                paid += credits;
                hp += gain;
            }
            assert.equal(paid, repairPrice(type, type.maxHp - start), `${id} from ${start}: blocks sum to the rounded whole`);
        }
    }
});

// ---- orders --------------------------------------------------------------------------

test('REPAIR assigns one worker and becomes STOP REPAIR; STOP cancels at once and frees the worker; HP restored stays', () => {
    const w = base();
    const plant = byType(w, 'powerPlant');
    assert.deepEqual(w.workers.canRepair(plant.id), {ok: false, reason: RepairFailure.NOT_DAMAGED});
    w.placement.damageBuilding(plant.id, 100);
    assert.equal(w.workers.repairOrder(plant.id), null);
    assert.equal(w.workers.orderRepair(plant.id).ok, true);
    assert.notEqual(w.workers.repairOrder(plant.id), null);
    assert.deepEqual(w.workers.orderRepair(plant.id), {ok: false, reason: RepairFailure.ALREADY_ORDERED});
    run(w, 600);
    const mended = hpOf(w, plant.id);
    assert.ok(mended > 200, 'it was repairing');
    const [worker] = w.workers.workers().filter((x) => x.repair === plant.id);
    assert.ok(worker);
    assert.deepEqual(w.workers.stopRepair(plant.id), {ok: true});
    assert.equal(w.workers.repairOrder(plant.id), null);
    assert.equal(w.workers.workers().find((x) => x.id === worker.id).repair, null, 'released');
    run(w, 200);
    assert.equal(hpOf(w, plant.id), mended, 'nothing more after STOP; nothing taken back');
    assert.deepEqual(w.workers.stopRepair(plant.id), {ok: false, reason: RepairFailure.NOT_ORDERED});
});

test('at most three orders, one worker each, with no queue; a dead worker means one fewer', () => {
    const w = base();
    const targets = [byType(w, 'powerPlant'), byType(w, 'autocannon', 0), byType(w, 'autocannon', 1), byType(w, 'autocannon', 2)];
    for (const {id} of targets) w.placement.damageBuilding(id, 50);
    for (const {id} of targets.slice(0, 3)) assert.equal(w.workers.orderRepair(id).ok, true);
    assert.deepEqual(w.workers.orderRepair(targets[3].id), {ok: false, reason: RepairFailure.NO_WORKER});
    assert.deepEqual(w.workers.canRepair(targets[3].id, {quick: true}), {ok: false, reason: RepairFailure.NO_WORKER});
    run(w, 60, () => {
        const assigned = w.workers.workers().filter((x) => x.repair).map((x) => x.repair);
        assert.equal(new Set(assigned).size, assigned.length, 'never two workers on one order');
        const workers = w.workers.repairs().orders.map((o) => o.worker).filter(Boolean);
        assert.equal(new Set(workers).size, workers.length, 'never one worker on two orders');
    });
    // One worker dies: with every order stopped, only the two left can take orders today.
    const victim = w.workers.workers()[0];
    assert.equal(w.workers.damageWorker(victim.id, WORKER.maxHp).ok, true);
    for (const {id} of targets.slice(0, 3)) w.workers.stopRepair(id);
    const placed = targets.filter(({id}) => w.workers.orderRepair(id).ok).length;
    assert.equal(placed, 2, 'only living workers can take orders');
});

test('orders are only taken by a running timed Day: not in Day 0, paused, during END DAY, at Dusk or Night', () => {
    const day0 = createWorld({requireHq: true, roads: true, resources: FUNDS, schedule: [], active: true});
    day0.place('hq', 12, 8);
    const hq0 = byType(day0, 'hq');
    day0.placement.damageBuilding(hq0.id, 50);
    assert.equal(day0.workers.orderRepair(hq0.id).reason, WorkFlagFailure.DAY_ONLY);

    const w = base();
    const hq = byType(w, 'hq');
    w.placement.damageBuilding(hq.id, 50);
    w.clock.pause();
    assert.deepEqual(w.workers.orderRepair(hq.id), {ok: false, reason: GAME_PAUSED});
    w.clock.resume();
    w.cycle.endDay();
    assert.equal(w.workers.orderRepair(hq.id).reason, WorkFlagFailure.DAY_ONLY);
    while (w.cycle.fastForwarding) w.cycle.stepTicks(MAX_MANUAL_STEPS, w.tick);
    assert.equal(w.workers.orderRepair(hq.id).reason, WorkFlagFailure.DAY_ONLY, 'Dusk');
});

test('HP only rises on running Day ticks: a pause freezes it; Dusk sends the worker home; the order and its block resume next Day', () => {
    const w = base();
    const plant = byType(w, 'powerPlant');
    w.placement.damageBuilding(plant.id, 250);
    while (w.cycle.remainingDayTicks > 1100) w.cycle.stepTicks(1, w.tick); // late enough that it cannot finish today
    w.workers.orderRepair(plant.id);
    run(w, 700); // the walk from HQ, then the first blocks
    const before = hpOf(w, plant.id);
    assert.ok(before > 50, 'it started');
    w.clock.pause();
    for (let i = 0; i < 50; i++) w.clock.advance(100, w.tick);
    assert.equal(hpOf(w, plant.id), before, 'paused');
    w.clock.resume();
    // Run to Dusk with the order unfinished.
    while (w.cycle.shift === Shift.DAY) w.cycle.stepTicks(1, w.tick);
    const atDusk = {hp: hpOf(w, plant.id), order: w.workers.repairOrder(plant.id)};
    assert.ok(atDusk.order, 'the order survives Dusk');
    untilShift(w, Shift.NIGHT);
    while (w.cycle.shift === Shift.NIGHT) {
        w.cycle.stepTicks(1, w.tick);
        assert.ok(w.workers.workers().every((x) => !x.repairing), 'nobody repairs at Dusk or Night');
    }
    assert.equal(hpOf(w, plant.id), atDusk.hp, 'no HP outside the Day');
    assert.equal(w.workers.repairOrder(plant.id).ticks, atDusk.order.ticks, 'the partial block is kept');
    run(w, 900);
    assert.ok(hpOf(w, plant.id) > atDusk.hp, 'resumed the next Day');
});

test('a block that cannot be paid cancels the order and frees the worker; HP stays; no debt; no automatic resume', () => {
    const w = base({credits: 9000});
    const plant = byType(w, 'powerPlant'); // 1 Credit per HP: 10 a block
    w.placement.damageBuilding(plant.id, 200);
    w.workers.orderRepair(plant.id);
    run(w, 300);
    w.economy.adjustCredits(-w.economy.credits + 15); // one more block, then not another
    const hp = hpOf(w, plant.id);
    let cancelledAt = null;
    for (let i = 0; i < 600 && cancelledAt === null; i++) {
        w.cycle.stepTicks(1, w.tick);
        if (!w.workers.repairOrder(plant.id)) cancelledAt = i;
    }
    assert.notEqual(cancelledAt, null, 'cancelled');
    assert.ok(w.economy.credits >= 0 && w.economy.credits < 10, `${w.economy.credits} Credits left: never debt`);
    assert.ok(hpOf(w, plant.id) >= hp, 'HP restored stays');
    assert.ok(w.workers.workers().every((x) => x.repair === null), 'worker freed');
    w.economy.adjustCredits(1000);
    run(w, 300);
    assert.equal(w.workers.repairOrder(plant.id), null, 'money alone does not bring it back');
});

test('an order ends, and frees its worker, when the building is whole, destroyed or demolished', () => {
    const w = base();
    const [one, two] = [byType(w, 'autocannon', 0), byType(w, 'autocannon', 1)];
    const hq = byType(w, 'hq');
    w.placement.damageBuilding(hq.id, 20);
    w.placement.damageBuilding(one.id, 60);
    w.placement.damageBuilding(two.id, 60);
    for (const id of [hq.id, one.id, two.id]) assert.equal(w.workers.orderRepair(id).ok, true);
    run(w, 300);
    w.placement.damageBuilding(one.id, 1000); // destroyed
    assert.equal(w.placement.demolish(two.id).ok, true);
    run(w, 400);
    assert.equal(hpOf(w, hq.id), getBuildingType('hq').maxHp, 'HQ whole');
    assert.deepEqual(w.workers.repairs().orders, [], 'all three orders over');
    assert.ok(w.workers.workers().every((x) => x.repair === null));
    const {spent, restored} = w.workers.repairs();
    assert.ok(restored >= 20 && spent >= 20, 'HQ alone took 20 HP at 1 Credit each');
});

test('a worker chopping jungle is reassigned to a repair, keeps its tile progress, and goes back to the jungle after', () => {
    const map = WORLD_MAPS.jungle;
    const terrain = createTerrain(map, map.seed);
    const w = createWorld({requireHq: true, roads: true, resources: FUNDS, schedule: [], active: true, map, terrain});
    const {center} = terrain;
    w.place('hq', center.col, center.row);
    w.cycle.endDay();
    while (w.cycle.shift !== Shift.DAY) w.cycle.stepTicks(1, w.tick);
    w.economy.restoreAp(40);
    let col = center.col;
    while (terrain.kindAt(col, center.row) !== TerrainKind.JUNGLE) col--;
    w.workers.setFlag({col, row: center.row});
    run(w, 900);
    const chopping = w.workers.workers().filter((x) => x.working);
    assert.equal(w.workers.workers().length, WORKER.squadSize);
    assert.ok(chopping.length > 0);
    const progress = w.workers.clearing().progress;
    const hq = byType(w, 'hq');
    w.placement.damageBuilding(hq.id, 30);
    const order = w.workers.orderRepair(hq.id);
    assert.equal(order.ok, true);
    assert.ok(order.worker, 'a worker outside takes it: nobody is left in HQ');
    const taken = w.workers.workers().find((x) => x.id === order.worker);
    assert.equal(taken.job, null, 'its jungle job is dropped');
    for (const tile of progress) {
        assert.ok(w.workers.clearing().progress.some((p) => p.col === tile.col && p.row === tile.row && p.ticks >= tile.ticks), 'tile progress kept');
    }
    run(w, 1200);
    assert.equal(hpOf(w, hq.id), getBuildingType('hq').maxHp);
    run(w, 600);
    const back = w.workers.workers().find((x) => x.id === order.worker);
    assert.ok(back && back.repair === null && (back.arrived || back.job), 'back to the jungle');
});

test('the nearest free worker takes an order, deterministically', () => {
    const pick = () => {
        const w = base();
        w.workers.setFlag({col: 4, row: 12});
        run(w, 1200);
        const cannon = byType(w, 'autocannon', 1); // west, near the flag
        w.placement.damageBuilding(cannon.id, 40);
        return {order: w.workers.orderRepair(cannon.id), workers: w.workers.workers()};
    };
    const a = pick();
    assert.deepEqual(pick().order, a.order);
    assert.ok(a.order.worker, 'a worker already outside beats one leaving HQ');
});

test('END DAY fast-forward repairs exactly what waiting would have', () => {
    const play = (skip) => {
        const w = base();
        const plant = byType(w, 'powerPlant');
        w.placement.damageBuilding(plant.id, 280);
        w.workers.orderRepair(plant.id);
        run(w, 100);
        if (skip) {
            w.cycle.endDay();
            while (w.cycle.fastForwarding) w.cycle.stepTicks(MAX_MANUAL_STEPS, w.tick);
        } else {
            while (w.cycle.shift === Shift.DAY) w.cycle.stepTicks(1, w.tick);
        }
        return JSON.stringify([hpOf(w, plant.id), w.economy.credits, w.workers.repairs(), w.workers.workers()]);
    };
    assert.equal(play(true), play(false));
});

test('frames: 10-11 only while repairing, 8-9 only while chopping', () => {
    const frames = (state) => new Set(Array.from({length: 40}, (_, tick) => workerFrame(state, false, tick)));
    assert.deepEqual(frames({repairing: true}), new Set([10, 11]));
    assert.deepEqual(frames({working: true}), new Set([8, 9]));
    assert.ok(![...frames({})].some((frame) => frame >= 8), 'walking and standing use neither');
});

test('the Killdozer icon fits its vehicle, not its transparent padding, into 40 px of a 48 px button', async () => {
    const {KILLDOZER, killdozerPlacement} = await import('../../src/scenes/killdozerIcon.js');
    const {scale, originX, originY} = killdozerPlacement();
    const {visible} = KILLDOZER;
    assert.ok(visible.width * scale <= 40 && visible.height * scale <= 40, 'inside 40x40');
    assert.equal(Math.max(visible.width, visible.height) * scale, 40, 'and filling it on its long side');
    assert.equal(originX * 48, visible.x + visible.width / 2, 'centred on the vehicle');
    assert.equal(originY * 48, visible.y + visible.height / 2);
});
