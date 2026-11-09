/**
 * TASK 027.1, WORKER DISPERSE: two of HQ's workers break up a protest. The real
 * ACTIVE cycle on the jungle map, through the soak harness in GameScene's order.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {EcologistState} from '../../src/core/ecologists.js';
import {GAME_PAUSED} from '../../src/core/buildingPlacement.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {TerrainKind} from '../../src/core/terrain.js';
import {DISPERSE, DisperseFailure, WorkFlagFailure} from '../../src/core/workers.js';
import {digestOf} from '../soak/harness.js';
import {protestBase, run, toFirstDay} from './protestBase.js';

const group = (w) => w.ecologists.snapshot().groups[0];
const workerById = (w, id) => w.workers.workers().find((worker) => worker.id === id);

/** The first timed Day, run until the first protest is blocking its road. */
function protesting(options = {}) {
    const base = protestBase(options);
    toFirstDay(base.w);
    options.before?.(base.w);
    run(base.w, 3600, () => base.w.ecologists.snapshot().blocked.length > 0);
    assert.equal(group(base.w).state, EcologistState.PROTESTING);
    return base;
}

/** West of HQ's row, the first jungle tile beside the clearing. */
function jungleEdge(terrain) {
    let col = terrain.center.col;
    while (terrain.kindAt(col, terrain.center.row) !== TerrainKind.JUNGLE) col--;
    return {col, row: terrain.center.row};
}

test('the provisional values', () => {
    assert.deepEqual({...DISPERSE}, {workers: 2, ticks: 120});
});

test('refusals: Day 0, a paused Day, Dusk, not a protest, already ordered, and one at a time', () => {
    const day0 = protestBase();
    assert.equal(day0.w.workers.canDisperse('protest-1').reason, WorkFlagFailure.DAY_ONLY);

    const {w} = protesting();
    const id = group(w).id;
    assert.equal(w.workers.canDisperse('protest-99').reason, DisperseFailure.NOT_A_PROTEST);
    w.clock.pause();
    assert.equal(w.workers.canDisperse(id).reason, GAME_PAUSED);
    assert.equal(w.workers.orderDisperse(id).reason, GAME_PAUSED);
    w.clock.resume();
    assert.equal(w.workers.orderDisperse(id).ok, true);
    assert.equal(w.workers.canDisperse(id).reason, DisperseFailure.ALREADY_ORDERED);
    w.clock.pause();
    assert.equal(w.workers.cancelDisperse(id).reason, GAME_PAUSED, 'a paused Day changes nothing');
    w.clock.resume();
    assert.equal(w.workers.cancelDisperse(id).ok, true);
    assert.equal(w.workers.cancelDisperse(id).reason, DisperseFailure.NOT_ORDERED);

    const dusk = protesting({pollution: 80});
    run(dusk.w, 3700, () => dusk.w.cycle.shift === Shift.DUSK);
    assert.equal(dusk.w.workers.canDisperse('protest-3').reason, WorkFlagFailure.DAY_ONLY);
});

test('repairing workers are never taken: with two on repairs there are not two free', () => {
    const {w} = protesting();
    const [hq, plant] = w.placement.buildings();
    w.placement.damageBuilding(hq.id, 50);
    w.placement.damageBuilding(plant.id, 50);
    assert.equal(w.workers.orderRepair(hq.id).ok, true);
    assert.equal(w.workers.canDisperse(group(w).id).ok, true, 'one repair leaves two free');
    assert.equal(w.workers.orderRepair(plant.id).ok, true);
    assert.equal(w.workers.canDisperse(group(w).id).reason, DisperseFailure.NO_WORKERS);
});

test('two workers, each to its own tile beside the site, never the site; nothing counts until both are there', () => {
    const {w, site} = protesting();
    const id = group(w).id;
    assert.deepEqual(w.workers.orderDisperse(id), {ok: true, workers: [null, null]}); // both still in HQ
    const [order] = w.workers.dispersals();
    const [a, b] = order.tiles;
    for (const tile of order.tiles) assert.equal(Math.abs(tile.col - site.col) + Math.abs(tile.row - site.row), 1);
    assert.notDeepEqual(a, b);
    let first = null;
    run(w, 600, () => {
        const now = w.workers.dispersals()[0];
        if (!now) return true;
        const there = now.workers.map((wid, i) => {
            const worker = wid && workerById(w, wid);
            return Boolean(worker) && worker.col === now.tiles[i].col && worker.row === now.tiles[i].row;
        });
        if (there.some(Boolean) && !there.every(Boolean)) {
            first ??= w.cycle.elapsedDayTicks;
            assert.equal(now.ticks, 0, 'one alone does not count');
        }
        return false;
    });
    assert.equal(w.workers.dispersals().length, 0);
    assert.equal(group(w).state, EcologistState.FLEEING);
});

test('after 120 ticks the group flees at once, the block goes that tick, the truck drives on, and no protest follows', () => {
    const {w} = protesting();
    const id = group(w).id;
    w.workers.orderDisperse(id);
    let dispersedAt = null;
    run(w, 1000, () => {
        const order = w.workers.dispersals()[0];
        if (order && order.ticks === DISPERSE.ticks - 1) dispersedAt = w.cycle.elapsedDayTicks + 1;
        return !order;
    });
    assert.equal(w.cycle.elapsedDayTicks, dispersedAt, 'it ended on the 120th tick together');
    assert.deepEqual(w.ecologists.snapshot().blocked, [], 'the road is clear on that tick');
    assert.ok(w.ecologists.snapshot().ecologists.every((e) => e.state === EcologistState.FLEEING));
    assert.equal(w.ecologists.snapshot().totals.dispersed, 1);
    const truck = w.logistics.snapshot().trucks[0];
    run(w, 60);
    const moved = w.logistics.snapshot().trucks[0];
    assert.ok(truck.state === 'idle' || moved.x !== truck.x || moved.y !== truck.y, 'the truck is free');
    let blocked = 0;
    run(w, 2000, () => {
        blocked += w.ecologists.snapshot().blocked.length;
        return w.cycle.shift !== Shift.DAY;
    });
    assert.equal(blocked, 0);
    assert.equal(w.ecologists.snapshot().totals.protests, 1, 'never again that Day');
});

test('workers go back to the jungle tile they left, whose progress the order never touched', () => {
    const {w} = protesting({
        before: (world) => {
            const {terrain} = world.grid;
            assert.equal(world.workers.setFlag(jungleEdge(terrain)).ok, true);
        },
    });
    const jobs = new Map(w.workers.workers().filter((x) => x.job).map((x) => [x.id, x.job]));
    assert.ok(jobs.size >= 2, 'workers were chopping');
    const progress = () => JSON.stringify(w.workers.clearing().progress);
    w.workers.orderDisperse(group(w).id);
    const taken = w.workers.dispersals()[0].workers.filter((id) => id && jobs.has(id));
    assert.ok(taken.length > 0, 'a chopping worker was taken');
    const before = progress();
    run(w, 30);
    for (const id of taken) assert.equal(workerById(w, id).job, null, 'off the jungle while dispersing');
    const untouched = (key) => JSON.parse(progress()).filter((p) => taken.some((id) => jobs.get(id).col === p.col && jobs.get(id).row === p.row));
    assert.deepEqual(untouched(), JSON.parse(before).filter((p) => taken.some((id) => jobs.get(id).col === p.col && jobs.get(id).row === p.row)));
    assert.equal(w.workers.cancelDisperse(group(w).id).ok, true);
    for (const id of taken) assert.deepEqual(workerById(w, id).job, jobs.get(id), `${id} back on its tile`);
});

test('a protest that ends while the workers are on their way ends the order cleanly', () => {
    const {w} = protesting({
        before: (world) => assert.equal(world.workers.setFlag(jungleEdge(world.grid.terrain)).ok, true),
    });
    const id = group(w).id;
    w.workers.orderDisperse(id);
    w.ecologists.disperse(id); // as if it ended before they got there
    run(w, 1);
    assert.deepEqual(w.workers.dispersals(), []);
    assert.equal(w.ecologists.snapshot().totals.dispersed, 1, 'only that once');
    assert.ok(w.workers.workers().some((x) => x.job), 'back to work');
});

test('no two free tiles beside the site: refused, and nothing changes', () => {
    // A longer delivery road with a gate in it: dock 17, road 18, gate 19, road 20, HQ ring 21.
    // Either site (18 or 20) has the gate on one side and walls north and south, so one free side.
    const {w, terrain} = protestBase({factory: false});
    const row = terrain.center.row;
    for (const col of [18, 17]) assert.equal(w.placement.placeRoad({col, row}).ok, true);
    assert.equal(w.place('factory', 15, row).ok, true);
    assert.equal(w.place('gateVertical', 19, row).ok, true);
    for (const col of [18, 20]) for (const r of [row - 1, row + 1]) assert.equal(w.place('wall', col, r).ok, true);
    toFirstDay(w);
    run(w, 3600, () => w.ecologists.snapshot().blocked.length > 0);
    const {id, site} = group(w);
    assert.ok([18, 20].includes(site.col));
    const before = JSON.stringify([w.workers.snapshot(), w.ecologists.snapshot()]);
    assert.equal(w.workers.canDisperse(id).reason, DisperseFailure.UNREACHABLE);
    assert.equal(w.workers.orderDisperse(id).reason, DisperseFailure.UNREACHABLE);
    assert.equal(JSON.stringify([w.workers.snapshot(), w.ecologists.snapshot()]), before);
});

test('Dusk cancels an unfinished order, and the workers go home as usual', () => {
    const {w} = protesting({pollution: 80});
    run(w, 3600, () => w.cycle.elapsedDayTicks >= 3300 && w.ecologists.snapshot().groups.some((g) => g.state === 'protesting'));
    const live = w.ecologists.snapshot().groups.find((g) => g.state === 'protesting');
    assert.ok(live, 'a protest late in the Day');
    assert.equal(w.workers.orderDisperse(live.id).ok, true);
    run(w, 400, () => w.cycle.shift === Shift.DUSK);
    run(w, 1);
    assert.deepEqual(w.workers.dispersals(), []);
    assert.equal(w.workers.snapshot().sent, false);
});

test('the same orders on the same seed give the same Day, tick for tick', () => {
    const trace = () => {
        const {w} = protesting();
        w.workers.orderDisperse(group(w).id);
        const lines = [];
        run(w, 1500, () => {
            lines.push(JSON.stringify([w.workers.snapshot(), w.ecologists.snapshot()]));
        });
        return digestOf(lines.join('\n'));
    };
    assert.equal(trace(), trace());
});
