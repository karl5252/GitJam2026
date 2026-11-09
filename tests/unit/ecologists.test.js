/**
 * TASK 027, ECOLOGISTAS!: protesters on the real jungle map in the ACTIVE cycle,
 * through the soak harness in GameScene's tick order.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ECOLOGIST, EcologistState, Ecologists, groupsFor} from '../../src/core/ecologists.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {createWorld, digestOf} from '../soak/harness.js';
import {MAP, protestBase, run, toFirstDay} from './protestBase.js';

const states = (w) => w.ecologists.snapshot().ecologists.map((e) => e.state);
const truckOf = (w) => w.logistics.snapshot().trucks[0];

/** Run until the first protest is under way. */
function toProtest(w) {
    run(w, 3600, () => w.ecologists.snapshot().blocked.length > 0);
    assert.equal(w.ecologists.snapshot().blocked.length, 1, 'a protest is blocking');
}

test('the approved provisional values', () => {
    assert.deepEqual({...ECOLOGIST, arrivalTicks: [...ECOLOGIST.arrivalTicks], size: {...ECOLOGIST.size}}, {
        pollutionPerGroup: 40, maxGroups: 3, arrivalTicks: [600, 1500, 2400], size: {min: 3, max: 4}, leaveGapTicks: 30,
        protestTicks: 900, speed: 1, fleeSpeed: 2, hp: 1, bodyRadius: 6, corpseTicks: 120, salt: 0x3c0e1a27,
    });
    assert.deepEqual([0, 39, 40, 79, 80, 500].map(groupsFor), [1, 1, 2, 2, 3, 3]);
});

test('nobody comes in Day 0, without an active producer, on the open map, or in the LEGACY cycle', () => {
    const {w} = protestBase({factory: false});
    assert.equal(w.ecologists.step().arrived, 0); // Day 0
    toFirstDay(w);
    run(w, 3600);
    assert.equal(w.ecologists.snapshot().totals.groups, 0, 'no Factory or Mine');

    const legacy = createWorld({requireHq: true, roads: true, ecologists: true});
    legacy.place('hq', 11, 7);
    legacy.cycle.endDay();
    for (let i = 0; i < 3600; i++) legacy.cycle.stepTicks(1, legacy.tick);
    assert.equal(legacy.ecologists.snapshot().totals.groups, 0);
});

test('one group a Day at low Pollution, three at 80, on Day ticks 600, 1500 and 2400, from the dirt path', () => {
    for (const [pollution, groups] of [[0, 1], [80, 3]]) {
        const {w, terrain} = protestBase({pollution});
        toFirstDay(w);
        const starts = [];
        let seen = 0;
        run(w, 3600, () => {
            const {totals} = w.ecologists.snapshot();
            if (totals.groups > seen) {
                starts.push(w.cycle.elapsedDayTicks);
                seen = totals.groups;
            }
            return w.cycle.shift !== Shift.DAY;
        });
        assert.deepEqual(starts, [600, 1500, 2400].slice(0, groups));
        assert.deepEqual(w.ecologists.snapshot().exit, terrain.path[0]);
    }
});

test('groups are 3 or 4, and the same seed gives the same protests tick for tick', () => {
    const trace = () => {
        const {w} = protestBase({pollution: 80});
        toFirstDay(w);
        const lines = [];
        run(w, 3900, () => {
            lines.push(JSON.stringify(w.ecologists.snapshot()));
        });
        const sizes = w.ecologists.snapshot().groups.map((g) => g.size);
        return {digest: digestOf(lines.join('\n')), sizes};
    };
    const [a, b] = [trace(), trace()];
    assert.equal(a.digest, b.digest);
    for (const size of a.sizes) assert.ok(size >= 3 && size <= 4);
});

test('a protest holds a truck at the tile before it, keeping its route and cargo, for 900 ticks, then it drives on', () => {
    const {w, site} = protestBase();
    toFirstDay(w);
    toProtest(w);
    const {groups} = w.ecologists.snapshot();
    assert.deepEqual(groups[0].site, site);
    assert.ok(groups[0].size >= 3);
    let held = null;
    let heldFor = 0;
    run(w, ECOLOGIST.protestTicks + 10, () => {
        const truck = truckOf(w);
        const blocked = w.ecologists.snapshot().blocked.length > 0;
        if (!blocked) return true;
        if (held && truck.x === held.x && truck.y === held.y && truck.cargo === held.cargo && truck.state === held.state) heldFor++;
        held = truck;
        return false;
    });
    assert.ok(heldFor > 500, `the truck waited (${heldFor} ticks)`);
    const before = truckOf(w);
    run(w, 40);
    const after = truckOf(w);
    assert.notDeepEqual({x: after.x, y: after.y}, {x: before.x, y: before.y}, 'it drove on by itself');
    assert.equal(w.ecologists.snapshot().groups[0].state, EcologistState.LEAVING);
});

test('a gate is never a protest site, and nobody can be built on', () => {
    const {w, site} = protestBase();
    assert.equal(w.place('gateVertical', site.col, site.row).ok, true); // the only player road on the route but the dock
    toFirstDay(w);
    run(w, 3600);
    assert.equal(w.ecologists.snapshot().totals.groups, 0);

    const other = protestBase();
    toFirstDay(other.w);
    run(other.w, 3600, () => other.w.ecologists.snapshot().ecologists.length > 0);
    const [ecologist] = other.w.ecologists.snapshot().ecologists;
    assert.equal(other.w.place('wall', ecologist.col, ecologist.row).reason, 'unit-in-the-way');
});

test('walled off from the road, a group protests as close as it can get and blocks nothing', () => {
    // The open battlefield with a stand-in terrain: a path entering at the west edge,
    // and a wall from top to bottom between it and the base.
    const terrain = {cols: 24, rows: 16, revision: 0, path: [{col: 0, row: 8}, {col: 1, row: 8}], kindAt: () => 'clearing', isBuildable: () => true};
    const w = createWorld({requireHq: true, roads: true, resources: {credits: 9000, ap: 99}, active: true, map: {cols: 24, rows: 16, tileSize: 32}, terrain, ecologists: true});
    assert.equal(w.place('hq', 14, 7).ok, true);
    assert.equal(w.place('powerPlant', 19, 7).ok, true);
    for (const cell of [{col: 11, row: 7}, {col: 10, row: 7}]) assert.equal(w.placement.placeRoad(cell).ok, true);
    assert.equal(w.place('factory', 8, 7).ok, true);
    for (let row = 0; row < 16; row++) assert.equal(w.place('wall', 4, row).ok, true, `wall ${row}`);
    toFirstDay(w);
    let blocked = 0;
    run(w, 3600, () => {
        blocked += w.ecologists.snapshot().blocked.length;
    });
    const {groups, totals} = w.ecologists.snapshot();
    assert.equal(totals.protests, 1);
    assert.equal(blocked, 0);
    assert.equal(groups.length === 0 || groups[0].site.col < 4, true, 'their side of the wall');
});

test('Dusk ends every protest at once, and everyone runs for the path at twice the speed', () => {
    const {w} = protestBase({pollution: 80});
    toFirstDay(w);
    run(w, 3700, () => w.cycle.shift !== Shift.DAY);
    assert.equal(w.cycle.shift, Shift.DUSK);
    const s = w.ecologists.snapshot();
    assert.ok(s.ecologists.length > 0, 'protesters were out at Dusk');
    assert.deepEqual(s.blocked, []);
    assert.ok(states(w).every((state) => state === EcologistState.FLEEING));
    assert.ok(s.groups.every((g) => g.state === EcologistState.FLEEING));
    // Twice a walk: in 20 ticks a walker covers at most 24 px (1.2 px a tick on a road).
    const before = new Map(s.ecologists.map((e) => [e.id, e]));
    run(w, 20);
    const covered = w.ecologists.snapshot().ecologists.map((e) => Math.abs(e.x - before.get(e.id).x) + Math.abs(e.y - before.get(e.id).y));
    assert.ok(Math.max(...covered) > 36, `ran ${Math.max(...covered)} px in 20 ticks`);
});

test('survivors are still running at Night, never protest or block, and leave on the exit tile', () => {
    const {w} = protestBase({pollution: 80});
    toFirstDay(w);
    run(w, 4000, () => w.cycle.shift === Shift.NIGHT);
    assert.equal(w.cycle.shift, Shift.NIGHT);
    const atNight = w.ecologists.snapshot();
    assert.ok(atNight.ecologists.length > 0, 'nobody was removed because Night came');
    const escapedBefore = atNight.totals.escaped;
    let blocked = 0;
    let lastSeen = null;
    run(w, 3000, () => {
        const s = w.ecologists.snapshot();
        blocked += s.blocked.length;
        assert.ok(s.ecologists.every((e) => e.state === EcologistState.FLEEING));
        if (s.ecologists.length) lastSeen = s.ecologists.at(-1);
        return s.ecologists.length === 0;
    });
    const after = w.ecologists.snapshot();
    assert.equal(blocked, 0);
    assert.equal(after.ecologists.length, 0);
    assert.equal(after.totals.escaped - escapedBefore, atNight.ecologists.length);
    assert.deepEqual({col: lastSeen.col, row: lastSeen.row}, after.exit, 'it left from the exit tile');
});

/** A mutant from the frame's east edge on the path's row, on Night tick 1, into the runners. */
function nightWithMutant({ecologists = true} = {}) {
    const row = 20;
    const index = MAP.spawnFrame.cols + (row - MAP.spawnFrame.row); // the east edge, top to bottom
    const rng = {nextInt: () => index, next: () => 0, snapshot: () => ({})};
    const {w} = protestBase({pollution: 80, schedule: [1], rng});
    if (!ecologists) w.ecologists.step = () => ({arrived: 0, protestsStarted: 0, killed: [], escaped: 0});
    toFirstDay(w);
    run(w, 4000, () => w.cycle.shift === Shift.NIGHT);
    return w;
}

test('a mutant touching an ecologist kills it at once; the corpse blocks nothing and goes', () => {
    // Runners usually leave the spawn frame during Dusk, so here a stand-in mutant
    // walks up to a real runner at Night. Only the contact rule is under test.
    const {w} = protestBase({pollution: 80, ecologists: false});
    let mutant = null;
    const mutants = {snapshot: () => (mutant ? [{...mutant}] : [])};
    const ecologists = new Ecologists({cycle: w.cycle, placement: w.placement, grid: w.grid, roads: w.roads, pollution: w.pollution, mutants, seed: 731});
    w.logistics.setBlockers(() => ecologists.blockedTiles());
    const step = (n, until = () => false) => {
        for (let i = 0; i < n; i++) {
            w.cycle.stepTicks(1, (t) => {
                w.tick(t);
                ecologists.step();
            });
            if (until()) return;
        }
    };
    toFirstDay(w);
    step(4000, () => w.cycle.shift === Shift.NIGHT);
    const [runner] = ecologists.snapshot().ecologists;
    assert.ok(runner, 'a survivor is still running at Night');
    const reach = 8 + ECOLOGIST.bodyRadius;
    mutant = {x: runner.x + reach + 30, y: runner.y}; // not yet touching
    step(1);
    assert.equal(ecologists.snapshot().totals.killed, 0);
    const now = ecologists.snapshot().ecologists.find((e) => e.id === runner.id);
    mutant = {x: now.x + reach, y: now.y}; // touching
    step(1);
    const corpse = ecologists.snapshot().ecologists.find((e) => e.id === runner.id);
    assert.deepEqual({state: corpse.state, hp: corpse.hp}, {state: EcologistState.DEAD, hp: 0});
    assert.ok(ecologists.snapshot().totals.killed >= 1); // the group runs together: one touch may take several
    mutant = null;
    step(ECOLOGIST.corpseTicks - 5, () => {
        const c = ecologists.snapshot().ecologists.find((e) => e.id === runner.id);
        assert.deepEqual({x: c.x, y: c.y, state: c.state}, {x: corpse.x, y: corpse.y, state: EcologistState.DEAD}, 'a corpse does not move');
        assert.deepEqual(ecologists.blockedTiles().size, 0);
        return false;
    });
    step(10);
    assert.equal(ecologists.snapshot().ecologists.some((e) => e.id === runner.id), false, 'and then it is gone');
});

test('ecologists change nothing about mutants: the same mutant, tick for tick, with or without them', () => {
    const trace = (ecologists) => {
        const w = nightWithMutant({ecologists});
        const lines = [];
        run(w, 1500, () => {
            lines.push(JSON.stringify(w.mutants.snapshot()));
        });
        return digestOf(lines.join('\n'));
    };
    assert.equal(trace(true), trace(false));
});

test('the sheet\'s frames: walk 4-5, a faster walk when fleeing, protest 8-11, hit 12 then down 13', async () => {
    const {ecologistFrame} = await import('../../src/scenes/EcologistLayer.js');
    const frames = (state, moving, ticks) => [...new Set(ticks.map((t) => ecologistFrame({state}, moving, t, ECOLOGIST.corpseTicks)))].sort((a, b) => a - b);
    const ticks = Array.from({length: 120}, (_, i) => i);
    assert.deepEqual(frames('arriving', true, ticks), [4, 5]);
    assert.deepEqual(frames('arriving', false, ticks), [0, 1]);
    assert.deepEqual(frames('protesting', false, ticks), [8, 9, 10, 11]);
    assert.deepEqual(frames('fleeing', true, ticks), [4, 5]);
    const changes = (state) => ticks.filter((t) => t > 0 && ecologistFrame({state}, true, t, 0) !== ecologistFrame({state}, true, t - 1, 0)).length;
    assert.ok(changes('fleeing') > 2 * changes('leaving'), 'the panic walk is frantic');
    const dead = (timer) => ecologistFrame({state: 'dead', timer}, false, 0, ECOLOGIST.corpseTicks);
    assert.equal(dead(ECOLOGIST.corpseTicks), 12);
    assert.equal(dead(ECOLOGIST.corpseTicks - 17), 12);
    assert.equal(dead(ECOLOGIST.corpseTicks - 18), 13);
    assert.equal(dead(1), 13);
});
