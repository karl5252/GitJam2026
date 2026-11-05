import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILDING_TYPES, getBuildingType} from '../../src/core/buildingTypes.js';
import {CONSTRUCTION_DISABLED, INVALID_STATE, UNKNOWN_BUILDING} from '../../src/core/buildingPlacement.js';
import {calculateEmissions} from '../../src/core/pollution.js';
import {calculatePower} from '../../src/core/power.js';
import {calculateSettlement} from '../../src/core/settlement.js';
import {DETOUR, MUTANT, blockerAt, borderSpawns, distanceToFootprint, gridBlockerAt, selectTarget} from '../../src/core/mutants.js';
import {RoadFailure} from '../../src/core/roads.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {canonicalState, checkInvariants, createWorld, digestOf, worldState} from '../soak/harness.js';

/**
 * Walls, spawning at fortified borders, and how mutants deal with barriers. The
 * rule under test everywhere here: NO PATH never means NO ATTACK.
 *
 * HQ at pointer 12,8 has its footprint on 11-13, 7-9 and its ring on 10-14, 6-10.
 */

const NIGHT = 3600;
const FUNDS = {credits: 100_000, ap: 200};
const HQ_FOOTPRINT = {col: 11, row: 7, width: 3, height: 3};
const TOP = (col) => col; // spawn indices, clockwise from the top-left
const RIGHT = (row) => 24 + row;
const BOTTOM = (col) => 40 + (23 - col);
const LEFT = (row) => 64 + (15 - row);

/** Returns preset spawn positions in order, like the real RNG returns draws. */
const spawnsAt = (...indices) => {
    let draws = 0;
    return {nextInt: () => indices[draws++ % indices.length], snapshot: () => ({draws})};
};

function world({schedule = [], rng, seed = 731, roads = true, hq = true, ...options} = {}) {
    const w = createWorld({seed, rng, resources: FUNDS, requireHq: hq, roads, schedule, ...options});
    if (hq) assert.equal(w.place('hq', 12, 8).ok, true);
    return w;
}

const wall = (w, col, row) => {
    const result = w.place('wall', col, row);
    assert.equal(result.ok, true, `wall ${col},${row}: ${result.reason}`);
    return result.building.id;
};

/** The outline of a rectangle, from corner to corner, with some tiles left out. */
function outline(left, top, right, bottom, skip = []) {
    const cells = [];
    for (let row = top; row <= bottom; row++) {
        for (let col = left; col <= right; col++) {
            const edge = row === top || row === bottom || col === left || col === right;
            if (edge && !skip.some(([c, r]) => c === col && r === row)) cells.push([col, row]);
        }
    }
    return cells;
}

const walls = (w, cells) => cells.map(([col, row]) => wall(w, col, row));
const hp = (w, id) => w.placement.buildings().find((b) => b.id === id)?.hp ?? 0;
const isWall = (w, id) => w.placement.buildings().find((b) => b.id === id)?.type === 'wall';

/**
 * Run ticks with the checks every barrier scenario needs: the invariants (no
 * mutant ever inside a wall or a building), no step longer than a mutant can
 * take, and no mutant standing idle. A mutant must each tick either move or
 * run its attack timer. Searching may cost it one tick, never two.
 */
function run(w, ticks, watch = () => {}) {
    const last = new Map();
    const report = {attacks: [], destroyed: [], firstAttackTick: null, maxIdle: 0};
    for (let i = 0; i < ticks && w.cycle.shift === Shift.NIGHT; i++) {
        w.cycle.stepTicks(1, (tick) => {
            const {effects} = w.tick(tick);
            const at = w.cycle.elapsedNightTicks;
            for (const attack of effects.attacks) {
                report.attacks.push({...attack, tick: at});
                report.firstAttackTick ??= at;
            }
            report.destroyed.push(...effects.destroyed);
        });
        if (w.cycle.shift !== Shift.NIGHT) break;
        assert.deepEqual(checkInvariants(w), []);
        const seen = new Set();
        for (const mutant of w.mutants.snapshot()) {
            seen.add(mutant.id);
            const before = last.get(mutant.id);
            if (before) {
                const moved = Math.abs(mutant.x - before.x) + Math.abs(mutant.y - before.y);
                assert.ok(moved <= MUTANT.speed, `${mutant.id} jumped ${moved} px`);
                const idle = moved === 0 && mutant.attackTimer === before.attackTimer ? before.idle + 1 : 0;
                report.maxIdle = Math.max(report.maxIdle, idle);
                last.set(mutant.id, {...mutant, idle});
            } else {
                last.set(mutant.id, {...mutant, idle: 0});
            }
        }
        for (const id of last.keys()) if (!seen.has(id)) last.delete(id);
        watch(w.cycle.elapsedNightTicks);
    }
    return report;
}

const night = (w, watch) => {
    w.cycle.endDay();
    return run(w, NIGHT, watch);
};

/** Damage that landed on walls and gates, as opposed to anything else. */
const barrierDamage = (w, report, ids) => report.attacks.filter((a) => ids.includes(a.buildingId)).reduce((sum, a) => sum + a.damage, 0);

const EIGHT_FROM_EVERY_SIDE = [TOP(12), RIGHT(8), BOTTOM(12), LEFT(8), TOP(5), RIGHT(3), BOTTOM(18), LEFT(12)];
const EARLY_WAVE = [100, 150, 200, 250, 300, 350, 400, 450];
const RING_7 = outline(9, 5, 15, 11); // just outside the HQ ring

// ---- Values ---------------------------------------------------------------------

test('wall and gate values are the approved ones', () => {
    assert.deepEqual(BUILDING_TYPES.wall, {
        id: 'wall', name: 'Wall', width: 1, height: 1,
        cost: {credits: 25, ap: 0}, operations: {income: 0, upkeep: 0}, power: {supply: 0, demand: 0},
        pollutionPerNight: 0, maxHp: 100, switchable: false, fortification: true,
    });
    for (const [id, orientation, passageAxis] of [['gateVertical', 'vertical', 'x'], ['gateHorizontal', 'horizontal', 'y']]) {
        const type = getBuildingType(id);
        assert.deepEqual(type.cost, {credits: 100, ap: 1});
        assert.deepEqual([type.maxHp, type.width, type.height, type.fortification, type.switchable], [150, 1, 1, true, false]);
        assert.deepEqual(type.gate, {tier: 'standard', orientation, passageAxis});
    }
    assert.equal(getBuildingType('reinforcedGateVertical'), null);
    assert.equal(DETOUR.maxExtraTiles, 12);
});

test('fortifications draw no power, cost no upkeep and emit nothing', () => {
    const w = world();
    const before = calculatePower(w.placement.buildings());
    walls(w, [[2, 2], [3, 2]]);
    const buildings = w.placement.buildings();
    const after = calculatePower(buildings);
    assert.deepEqual([after.generation, after.demand, after.status], [before.generation, before.demand, before.status]);
    assert.equal(calculateEmissions(buildings), 0);
    assert.deepEqual([calculateSettlement(buildings).upkeep, calculateSettlement(buildings).counts.wall], [0, 2]);
    assert.equal(w.placement.setEnabled('wall-2', false).reason, INVALID_STATE);
});

// ---- Placement and demolition ---------------------------------------------------

test('a wall costs Credits and no AP, and needs HQ first', () => {
    const w = createWorld({resources: {credits: 100, ap: 0}, requireHq: true, roads: true});
    assert.equal(w.placement.canBuild('wall').reason, 'hq-required');
    assert.equal(w.place('hq', 12, 8).ok, true);
    for (let i = 0; i < 4; i++) assert.equal(w.place('wall', 3 + i, 3).ok, true);
    assert.deepEqual(w.economy.snapshot(), {credits: 0, ap: 0});
    assert.equal(w.place('wall', 8, 3).reason, 'insufficient-credits');
});

test('a wall cannot overlap a road, a building or another wall', () => {
    const w = world();
    assert.equal(w.place('wall', 10, 6).reason, RoadFailure.ROAD_OCCUPIED);
    assert.equal(w.place('wall', 12, 8).reason, 'occupied');
    wall(w, 3, 3);
    assert.equal(w.place('wall', 3, 3).reason, 'occupied');
    assert.equal(w.place('wall', 24, 3).reason, 'out-of-bounds');
    assert.equal(w.placement.placeRoad({col: 3, row: 3}).ok, false);
});

test('a wall cannot be built at Night', () => {
    const w = world();
    w.cycle.endDay();
    assert.equal(w.place('wall', 3, 3).ok, false);
    assert.deepEqual(w.placement.buildings().map((b) => b.type), ['hq']);
});

test('demolition is free, gives no refund, and is for fortifications during Day', () => {
    const w = world();
    const id = wall(w, 3, 3);
    const {credits, ap} = w.economy.snapshot();
    assert.deepEqual(w.placement.demolish(id), {ok: true});
    assert.deepEqual(w.economy.snapshot(), {credits, ap});
    assert.equal(w.grid.occupantAt(3, 3), null);
    assert.equal(w.placement.demolish(id).reason, UNKNOWN_BUILDING);
    assert.equal(w.placement.demolish('hq-1').reason, INVALID_STATE);

    const standing = wall(w, 4, 3);
    w.cycle.endDay();
    assert.equal(w.placement.demolish(standing).reason, CONSTRUCTION_DISABLED);
    assert.equal(w.grid.occupantAt(4, 3), standing);
});

test('a demolished wall frees its tile for a road or a new wall', () => {
    const w = world();
    const id = wall(w, 10, 5);
    assert.equal(w.placement.placeRoad({col: 10, row: 5}).reason, 'occupied');
    w.placement.demolish(id);
    assert.equal(w.placement.placeRoad({col: 10, row: 5}).ok, true);
});

test('walls are never targets, however close they are', () => {
    const w = world();
    walls(w, [[11, 5], [12, 5], [13, 5]]);
    const point = w.grid.cellCenter(12, 4);
    assert.equal(selectTarget(point, w.placement.buildings(), w.grid), 'hq-1');
    const onlyWalls = w.placement.buildings().filter((b) => b.type === 'wall');
    assert.equal(selectTarget(point, onlyWalls, w.grid), null);
});

test('the grid lookup agrees with the plain definition, on every seam and corner, in any list order', () => {
    const w = world();
    walls(w, [[3, 3], [4, 3], [5, 4], [4, 5], [4, 4]]);
    assert.equal(w.place('outpost', 6, 4).ok, true);
    const placed = w.placement.buildings();
    const {x: left, y: top} = w.grid.cellToWorld(1, 1);
    let touching = 0;
    for (const buildings of [placed, [...placed].reverse()]) {
        const byId = new Map(buildings.map((b) => [b.id, b]));
        for (let x = left; x <= left + 8 * 32; x += 0.5) {
            for (let y = top; y <= top + 8 * 32; y += x % 32 === 0 ? 0.5 : 8) {
                const plain = blockerAt({x, y}, buildings, w.grid);
                assert.equal(gridBlockerAt({x, y}, buildings, byId, w.grid)?.id ?? null, plain, `at ${x},${y}`);
                if (plain) touching++;
            }
        }
    }
    assert.ok(touching > 1000, 'the sweep really met buildings');
});

test('the grid lookup skips what passes, and finds what stands behind it on a seam', () => {
    const w = world();
    const [a, b] = walls(w, [[3, 3], [4, 3]]);
    const buildings = w.placement.buildings();
    const byId = new Map(buildings.map((building) => [building.id, building]));
    const {x, y} = w.grid.cellToWorld(4, 3);
    const seam = {x, y: y + 16};
    assert.equal(gridBlockerAt(seam, buildings, byId, w.grid).id, a);
    assert.equal(gridBlockerAt(seam, buildings, byId, w.grid, (building) => building.id === a).id, b);
    assert.equal(gridBlockerAt(seam, buildings, byId, w.grid, () => true), null);
});

// ---- Border spawning ------------------------------------------------------------

const SPAWN_CASES = {
    'top edge': {index: TOP(8), cell: [8, 0], dx: 0, dy: -1},
    'right edge': {index: RIGHT(5), cell: [23, 5], dx: 1, dy: 0},
    'bottom edge': {index: BOTTOM(8), cell: [8, 15], dx: 0, dy: 1},
    'left edge': {index: LEFT(5), cell: [0, 5], dx: -1, dy: 0},
    'top-left corner, top side': {index: TOP(0), cell: [0, 0], dx: 0, dy: -1},
    'top-left corner, left side': {index: LEFT(0), cell: [0, 0], dx: -1, dy: 0},
    'top-right corner, top side': {index: TOP(23), cell: [23, 0], dx: 0, dy: -1},
    'top-right corner, right side': {index: RIGHT(0), cell: [23, 0], dx: 1, dy: 0},
    'bottom-right corner, right side': {index: RIGHT(15), cell: [23, 15], dx: 1, dy: 0},
    'bottom-right corner, bottom side': {index: BOTTOM(23), cell: [23, 15], dx: 0, dy: 1},
    'bottom-left corner, bottom side': {index: BOTTOM(0), cell: [0, 15], dx: 0, dy: 1},
    'bottom-left corner, left side': {index: LEFT(15), cell: [0, 15], dx: -1, dy: 0},
};

for (const [name, {index, cell: [col, row], dx, dy}] of Object.entries(SPAWN_CASES)) {
    test(`a fortified border cell: the mutant arrives outside it, then breaks in (${name})`, () => {
        const w = world({schedule: [1], rng: spawnsAt(index)});
        const id = wall(w, col, row);
        const spawn = borderSpawns(w.grid)[index];
        assert.deepEqual([spawn.col, spawn.row], [col, row]);

        w.cycle.endDay();
        run(w, 1);
        const [mutant] = w.mutants.snapshot();
        assert.deepEqual([mutant.x, mutant.y], [spawn.x + dx * MUTANT.speed, spawn.y + dy * MUTANT.speed]);
        assert.ok(distanceToFootprint(mutant, w.grid.footprintRect({col, row})) > 0, 'not embedded in the wall');

        // The rest of the Night: it never leaves the map further than that, and it
        // is never inside the wall (both checked by run), and it does not stop.
        const report = run(w, 3000);
        assert.ok(report.attacks.length > 0, 'it reached something to attack');
        assert.ok(report.maxIdle <= 1, `idle for ${report.maxIdle} ticks`);
        assert.equal(w.mutants.snapshot().length, 1);
        assert.ok(report.attacks.some((a) => a.buildingId === id) && hp(w, id) < 100, 'the wall took the hits');
    });
}

test('outside the map a mutant only ever moves inward: it never walks along the edge', () => {
    // HQ is far to the right, so a free mutant would walk sideways first.
    const w = world({schedule: [1], rng: spawnsAt(TOP(1))});
    const id = wall(w, 1, 0);
    w.cycle.endDay();
    run(w, 1);
    const [{x, y}] = w.mutants.snapshot();
    run(w, 1100, () => {
        const [mutant] = w.mutants.snapshot();
        if (hp(w, id) > 0) assert.deepEqual([mutant.x, mutant.y], [x, y], 'held outside the wall until it fell');
    });
    assert.ok(hp(w, id) < 100);
});

test('once on the map a mutant never goes outside it again', () => {
    const w = world({schedule: [1], rng: spawnsAt(TOP(1))});
    const id = wall(w, 1, 0);
    const bounds = w.grid.footprintRect({col: 0, row: 0, width: 24, height: 16});
    w.cycle.endDay();
    let inside = false;
    run(w, 2500, () => {
        const here = distanceToFootprint(w.mutants.snapshot()[0], bounds) === 0;
        assert.ok(here || !inside, 'it left the map');
        inside ||= here;
    });
    assert.equal(hp(w, id), 0, 'it breached the wall');
    assert.ok(inside);
});

test('a mutant out of plans and budget goes on attacking what blocks it', () => {
    const w = world({schedule: [1], rng: spawnsAt(LEFT(8))});
    const ids = walls(w, lineCol(6, 1, 15));
    w.cycle.endDay();
    const report = run(w, NIGHT - 1);
    assert.ok(report.maxIdle <= 1);
    assert.equal(report.attacks.filter((a) => ids.includes(a.buildingId)).length, 20, 'every hit of a whole wall');
});

test('a border wall in the way of the first step is attacked, with no way round from outside', () => {
    const w = world({schedule: [1], rng: spawnsAt(TOP(12))});
    const id = wall(w, 12, 0);
    w.cycle.endDay();
    const report = run(w, 1400);
    assert.equal(report.attacks[0].buildingId, id);
    assert.ok(report.destroyed.includes(id), 'the wall was breached');
    assert.equal(w.grid.occupantAt(12, 0), null);
    assert.ok(w.mutants.snapshot()[0].y > w.grid.cellCenter(12, 0).y - 16, 'and the mutant came through');
});

test('a fully fortified perimeter loses no spawn and funnels nobody', () => {
    const schedule = [100, 200, 300, 400, 500, 600, 700, 800];
    const w = world({schedule, rng: spawnsAt(...EIGHT_FROM_EVERY_SIDE)});
    const perimeter = walls(w, outline(0, 0, 23, 15));
    assert.equal(perimeter.length, 76);

    w.cycle.endDay();
    const report = run(w, 900);
    const living = w.mutants.snapshot();
    assert.equal(living.length, schedule.length, 'every scheduled mutant spawned');
    const bounds = w.grid.footprintRect({col: 0, row: 0, width: 24, height: 16});
    for (const mutant of living) {
        const outside = distanceToFootprint(mutant, bounds) > 0;
        const clear = w.placement.buildings().every((b) => distanceToFootprint(mutant, w.grid.footprintRect(b)) > 0);
        assert.ok(outside && clear, `${mutant.id} at ${mutant.x},${mutant.y}`);
    }
    assert.equal(new Set(living.map((m) => `${m.x},${m.y}`)).size, schedule.length, 'still spread out');
    assert.ok(report.attacks.length > 0);
    assert.ok(report.attacks.every((a) => isWall(w, a.buildingId)));
});

test('a fully fortified perimeter is breached, and HQ is attacked, within the Night', () => {
    const w = world({schedule: EARLY_WAVE, rng: spawnsAt(...EIGHT_FROM_EVERY_SIDE)});
    const perimeter = walls(w, outline(0, 0, 23, 15));
    w.cycle.endDay();
    const report = run(w, NIGHT - 1);
    assert.ok(barrierDamage(w, report, perimeter) >= 100, 'real damage on the walls');
    assert.ok(report.destroyed.length >= 1, 'at least one breach');
    assert.ok(hp(w, 'hq-1') < 600, 'and HQ took damage');
});

test('a perimeter of walls and ordinary buildings still loses no spawn', () => {
    const w = world({schedule: [1], rng: spawnsAt(TOP(0))});
    const skip = [[0, 0], [1, 0], [2, 0]];
    walls(w, outline(0, 0, 23, 15, skip));
    for (const [col, row] of skip) assert.equal(w.place('outpost', col, row).ok, true);
    w.cycle.endDay();
    run(w, 1);
    const [mutant] = w.mutants.snapshot();
    assert.equal(mutant.x, w.grid.cellCenter(3, 0).x, 'the next fortified cell clockwise');
    assert.equal(mutant.y, w.grid.cellToWorld(3, 0).y - MUTANT.speed);
});

test('border walls do not change the one RNG draw per spawn', () => {
    const draws = (fortify) => {
        const w = world({schedule: [100, 200, 300]});
        if (fortify) walls(w, outline(0, 0, 23, 15));
        w.cycle.endDay();
        run(w, 400);
        return w.rng.snapshot().state;
    };
    assert.equal(draws(true), draws(false));
});

// ---- Going round, and when not to ------------------------------------------------

const lineCol = (col, fromRow, toRow) => Array.from({length: toRow - fromRow + 1}, (_, i) => [col, fromRow + i]);

test('a single wall stub is walked around, with no damage to it', () => {
    const w = world({schedule: [1], rng: spawnsAt(LEFT(8))});
    const [id] = walls(w, [[5, 8]]);
    w.cycle.endDay();
    const report = run(w, 1500);
    assert.equal(hp(w, id), 100);
    assert.equal(report.attacks[0].buildingId, 'hq-1');
    assert.equal(w.mutants.detours()[0].plans, 1);
    assert.equal(w.mutants.detours()[0].extraTiles, 1, 'HQ is three tall, so one tile aside is enough');
});

test('scenario 4: a long wall with a gap inside the detour limit is walked around, not attacked', () => {
    const w = world({schedule: [1], rng: spawnsAt(LEFT(8))});
    // Rows 3-15, leaving 0-2 open: from row 8, the way through row 2 and back adds 2 x 5 tiles.
    const ids = walls(w, lineCol(6, 3, 15));
    w.cycle.endDay();
    const report = run(w, 2500);
    assert.ok(ids.every((id) => hp(w, id) === 100), 'no wall was touched');
    assert.equal(report.attacks[0].buildingId, 'hq-1');
    assert.equal(w.mutants.detours()[0].plans, 1);
    assert.ok(w.mutants.detours()[0].extraTiles <= DETOUR.maxExtraTiles);
});

test('a gap beyond the detour limit is not used: the wall in the way is attacked', () => {
    const w = world({schedule: [1], rng: spawnsAt(LEFT(8))});
    const ids = walls(w, lineCol(6, 1, 15)); // only row 0 is open: 2 x 8 extra tiles
    w.cycle.endDay();
    const report = run(w, 2500);
    assert.deepEqual(w.mutants.detours()[0].plans, 0);
    assert.ok(ids.includes(report.attacks[0].buildingId));
    assert.equal(report.destroyed.length, 1);
    assert.ok(report.attacks.some((a) => a.buildingId === 'hq-1'), 'it resumed and reached HQ');
});

test('a detour ends beside the target, never on an occupied tile', () => {
    const w = world({schedule: [1], rng: spawnsAt(TOP(12))});
    walls(w, outline(9, 5, 15, 11, [[9, 8]])); // one gap, on the far side from the mutant
    w.cycle.endDay();
    const report = run(w, 3000, () => {
        for (const mutant of w.mutants.snapshot()) {
            const {col, row} = w.grid.worldToCell(mutant.x, Math.max(mutant.y, 104)) ?? {};
            if (col !== undefined) assert.equal(w.grid.occupantAt(col, row), null);
        }
    });
    assert.equal(report.attacks[0].buildingId, 'hq-1', 'it walked in through the gap');
    const [mutant] = w.mutants.snapshot();
    assert.ok(distanceToFootprint(mutant, w.grid.footprintRect(HQ_FOOTPRINT)) <= MUTANT.attackRange);
});

test('a target with no free tile beside it cannot be a detour goal', () => {
    const w = world({schedule: [1], rng: spawnsAt(LEFT(2)), roads: false, hq: false});
    assert.equal(w.place('outpost', 12, 2).ok, true);
    const box = walls(w, [[11, 2], [13, 2], [12, 1], [12, 3]]);
    w.cycle.endDay();
    const report = run(w, 2500);
    assert.equal(w.mutants.detours()[0].plans, 0);
    assert.equal(report.attacks[0].buildingId, box[0], 'the wall facing it');
});

test('a closed diamond of purely diagonal walls seals as well as a straight ring', () => {
    const diamond = [];
    for (let dc = -5; dc <= 5; dc++) {
        const dr = 5 - Math.abs(dc);
        diamond.push([12 + dc, 8 - dr]);
        if (dr !== 0) diamond.push([12 + dc, 8 + dr]);
    }
    const w = world({schedule: EARLY_WAVE, rng: spawnsAt(...EIGHT_FROM_EVERY_SIDE)});
    const ids = walls(w, diamond);
    assert.equal(ids.length, 20);
    w.cycle.endDay();
    const report = run(w, 1500);
    assert.ok(report.attacks.length > 0);
    assert.ok(report.attacks.every((a) => ids.includes(a.buildingId)), 'nobody slipped between two corners');
    assert.ok(w.mutants.detours().every((d) => d.plans === 0), 'and no search found a way');
});

// ---- Enclosed bases: the required regressions ------------------------------------

test('scenario 1: an HQ inside a continuous ring: walls take real damage, the ring is breached, HQ is hit', () => {
    const w = world({schedule: [100, 200, 300], rng: spawnsAt(TOP(12), RIGHT(8), LEFT(8))});
    const ring = walls(w, RING_7);
    assert.equal(ring.length, 24);

    w.cycle.endDay();
    const report = run(w, NIGHT - 1);
    assert.ok(report.maxIdle <= 1, `a mutant stood idle for ${report.maxIdle} ticks`);
    assert.ok(ring.includes(report.attacks[0].buildingId), 'the first hit was on the ring');
    assert.ok(barrierDamage(w, report, ring) >= 100, `only ${barrierDamage(w, report, ring)} damage on the ring`);
    assert.ok(report.destroyed.some((id) => ring.includes(id)), 'a wall fell');
    assert.ok(hp(w, 'hq-1') < 600, 'mutants got through and hit HQ');
    assert.equal(w.mutants.snapshot().length, 3, 'all three survived to dawn');

    w.cycle.stepTicks(1, w.tick); // tick 3600: dawn
    assert.equal(w.cycle.shift, Shift.DAY);
    assert.deepEqual(w.mutants.snapshot(), [], 'survivors are gone at dawn');
});

test('scenario 1: a bigger wave takes the enclosed HQ down inside one Night', () => {
    const w = world({schedule: EARLY_WAVE, rng: spawnsAt(...EIGHT_FROM_EVERY_SIDE)});
    const ring = walls(w, RING_7);
    w.cycle.endDay();
    const report = run(w, NIGHT - 1);
    assert.ok(report.maxIdle <= 1);
    assert.ok(barrierDamage(w, report, ring) >= 100);
    assert.equal(w.cycle.shift, Shift.DEFEATED);
});

test('scenario 2: buildings behind successive rings: each ring is breached in turn', () => {
    const w = world({schedule: EARLY_WAVE, rng: spawnsAt(...EIGHT_FROM_EVERY_SIDE)});
    const inner = walls(w, RING_7);
    const outer = walls(w, outline(6, 2, 18, 14));
    assert.equal(w.place('outpost', 12, 3).ok, true); // between the rings

    w.cycle.endDay();
    const report = run(w, NIGHT - 1);
    assert.ok(report.maxIdle <= 1);
    assert.ok(report.destroyed.some((id) => outer.includes(id)), 'the outer ring was breached');
    assert.ok(barrierDamage(w, report, inner) > 0, 'and they moved on to the inner ring');
    const firstOuter = report.attacks.findIndex((a) => outer.includes(a.buildingId));
    const firstInner = report.attacks.findIndex((a) => inner.includes(a.buildingId));
    assert.ok(firstOuter < firstInner, 'outer first');
});

test('scenario 2: successive rings are not a permanent shield over several Nights', () => {
    const w = world({schedule: EARLY_WAVE, rng: spawnsAt(...EIGHT_FROM_EVERY_SIDE)});
    walls(w, RING_7);
    walls(w, outline(6, 2, 18, 14));
    let nights = 0;
    while (w.cycle.shift === Shift.DAY && nights < 12) {
        nights++;
        night(w);
    }
    assert.equal(w.cycle.shift, Shift.DEFEATED, `HQ survived ${nights} Nights`);
});

test('scenario 3: a sealed perimeter whose only road crosses a closed gate: the gate is attacked and falls', () => {
    const w = world({schedule: [1], rng: spawnsAt(RIGHT(8))});
    for (const col of [15, 16, 17]) assert.equal(w.placement.placeRoad({col, row: 8}).ok, true);
    const ring = walls(w, outline(9, 5, 15, 11, [[15, 8]]));
    const gate = w.place('gateVertical', 15, 8);
    assert.equal(gate.ok, true, gate.reason);
    const {id} = gate.building;

    w.cycle.endDay();
    const report = run(w, NIGHT - 1);
    assert.equal(report.attacks[0].buildingId, id, 'the gate is the barrier in its way');
    assert.ok(barrierDamage(w, report, [id]) === 150, 'all of it was earned hit by hit');
    assert.ok(report.destroyed.includes(id));
    assert.equal(w.mutants.detours()[0].plans, 0, 'a closed gate offers no route');
    assert.ok(report.attacks.some((a) => a.buildingId === 'hq-1'), 'then on to HQ');
    assert.equal(barrierDamage(w, report, ring), 0);
    assert.equal(w.roads.has({col: 15, row: 8}), true, 'the road is still there');
});

test('scenario 6: a fully enclosed base with nothing outside, under the real wave planner', () => {
    for (const seed of [731, 98, 1]) {
        const w = createWorld({seed, resources: FUNDS, requireHq: true, roads: true, pollution: 120, firstNight: 12});
        assert.equal(w.place('hq', 12, 8).ok, true);
        assert.equal(w.place('powerPlant', 12, 3).ok, true);
        const ring = walls(w, outline(8, 0, 16, 12));
        while (w.cycle.day < 12) {
            w.cycle.endDay();
            while (w.cycle.shift === Shift.NIGHT) w.cycle.stepTicks(240, w.tick);
        }
        const report = night(w);
        assert.ok(report.maxIdle <= 1, `seed ${seed}: idle ${report.maxIdle}`);
        assert.ok(barrierDamage(w, report, ring) >= 100, `seed ${seed}: ${barrierDamage(w, report, ring)} damage`);
        assert.ok(report.destroyed.some((id) => ring.includes(id)), `seed ${seed}: no breach`);
        if (w.cycle.shift === Shift.DAY) assert.deepEqual(w.mutants.snapshot(), [], 'survivors are gone at dawn');
        else assert.equal(w.cycle.shift, Shift.DEFEATED);
    }
});

test('a walled-in base is never invulnerable: real waves take HQ down', (t) => {
    const w = createWorld({seed: 731, resources: FUNDS, requireHq: true, roads: true});
    assert.equal(w.place('hq', 12, 8).ok, true);
    walls(w, RING_7);
    walls(w, outline(8, 4, 16, 12));
    let nights = 0;
    while (w.cycle.shift === Shift.DAY && nights < 40) {
        nights++;
        w.cycle.endDay();
        while (w.cycle.shift === Shift.NIGHT) w.cycle.stepTicks(240, w.tick);
    }
    t.diagnostic(JSON.stringify({walls: 56, noTurrets: true, defeatedOnNight: nights}));
    assert.equal(w.cycle.shift, Shift.DEFEATED, `HQ survived ${nights} Nights`);
});

test('after a breach mutants go through the gap they made, and later ones use it too', () => {
    const w = world({schedule: [1, 1500], rng: spawnsAt(TOP(12), TOP(4))});
    const ring = walls(w, RING_7);
    w.cycle.endDay();
    const report = run(w, NIGHT - 1);
    assert.equal(report.destroyed.filter((id) => ring.includes(id)).length, 1, 'one breach serves both');
    assert.equal(w.mutants.detours()[1].plans, 1, 'the second mutant found the way in');
    const [, second] = w.mutants.snapshot();
    assert.ok(distanceToFootprint(second, w.grid.footprintRect(HQ_FOOTPRINT)) <= MUTANT.attackRange);
});

// ---- Mazes ------------------------------------------------------------------------

/** Vertical walls with alternating gaps, between the left edge and HQ. */
function serpentine(cols) {
    return cols.flatMap((col, i) => lineCol(col, i % 2 === 0 ? 1 : 0, i % 2 === 0 ? 15 : 14));
}

const MAZES = {
    'serpentine, 3 lanes': serpentine([3, 5, 7]),
    'serpentine, 4 lanes': serpentine([2, 4, 6, 8]),
    'nested rings with opposite gaps': [
        ...outline(9, 5, 15, 11, [[15, 8]]),
        ...outline(7, 3, 17, 13, [[7, 8]]),
        ...outline(5, 1, 19, 15, [[19, 8]]),
    ],
    'staggered stubs, all inside the detour limit': [
        ...lineCol(3, 5, 11), ...lineCol(5, 2, 8), ...lineCol(7, 8, 14),
    ],
    'comb of dead ends': [
        ...lineCol(8, 3, 13),
        ...[3, 5, 7, 9, 11, 13].flatMap((row) => [[5, row], [6, row], [7, row]]),
    ],
};

for (const [name, cells] of Object.entries(MAZES)) {
    test(`scenario 5: a maze does not use up the Night without an attack (${name})`, (t) => {
        const w = world({schedule: [1], rng: spawnsAt(LEFT(8))});
        const ids = walls(w, cells);
        w.cycle.endDay();
        const report = run(w, NIGHT - 1);
        const [use] = w.mutants.detours();
        const firstHit = report.attacks[0];
        t.diagnostic(JSON.stringify({
            name, walls: ids.length, firstAttackTick: report.firstAttackTick, firstHit: firstHit?.buildingId, plans: use.plans,
            extraTiles: use.extraTiles, wallDamage: barrierDamage(w, report, ids), breaches: report.destroyed.length,
            hqDamage: 600 - hp(w, 'hq-1'),
        }));
        assert.ok(report.maxIdle <= 1, `idle for ${report.maxIdle} ticks`);
        assert.ok(use.plans <= DETOUR.maxPlans);
        assert.ok(use.extraTiles <= DETOUR.maxTotalExtraTiles);
        assert.ok(firstHit, 'it attacked something');
        // A straight walk is at most 38 tiles, plus what it may spend, at 64 ticks a tile.
        const longestWalk = (38 + DETOUR.maxTotalExtraTiles) * 64;
        assert.ok(report.firstAttackTick <= longestWalk + MUTANT.attackCooldownTicks, `first hit on tick ${report.firstAttackTick}`);
    });
}

test('repeated planning cannot postpone attacks: gates that keep changing run out its plans', (t) => {
    // Two gates in a sealed ring. Whichever one the mutant reaches slams shut while
    // the other stands open: a worst case no real truck produces.
    const w = world({schedule: [1], rng: spawnsAt(TOP(12))});
    for (const [col, row] of [[10, 5], [10, 4], [14, 5], [14, 4]]) assert.equal(w.placement.placeRoad({col, row}).ok, true);
    const ring = walls(w, outline(9, 5, 15, 11, [[10, 5], [14, 5]]));
    const west = w.place('gateHorizontal', 10, 5).building.id;
    const east = w.place('gateHorizontal', 14, 5).building.id;
    const near = (id) => {
        const gate = w.placement.buildings().find((b) => b.id === id);
        const rect = gate && w.grid.footprintRect(gate);
        return rect ? w.mutants.snapshot().some((m) => distanceToFootprint(m, rect) <= 32) : false;
    };

    const attacks = [];
    const tick = (n) => {
        w.cycle.onTick(n);
        w.gates.step(new Set([east, west].filter((id) => !near(id))));
        attacks.push(...w.mutants.step().attacks);
    };
    w.cycle.endDay();
    for (let i = 0; i < NIGHT - 1 && attacks.length === 0; i++) w.cycle.stepTicks(1, tick);

    const [use] = w.mutants.detours();
    t.diagnostic(JSON.stringify({plans: use.plans, extraTiles: use.extraTiles, firstAttackTick: w.cycle.elapsedNightTicks, hit: attacks[0]?.buildingId}));
    assert.ok(attacks.length > 0, 'the mutant attacked before dawn');
    assert.equal(use.plans, DETOUR.maxPlans, 'it was sent back and forth until its plans ran out');
    assert.ok(use.extraTiles <= DETOUR.maxTotalExtraTiles);
    assert.ok([...ring, west, east, 'hq-1'].includes(attacks[0].buildingId));
});

// ---- Determinism ------------------------------------------------------------------

test('the same seed and layout give the same fight, wall by wall', () => {
    const digest = () => {
        const w = world({schedule: EARLY_WAVE, seed: 98});
        walls(w, outline(9, 5, 15, 11, [[9, 8]]));
        walls(w, serpentine([3, 5]));
        w.cycle.endDay();
        run(w, NIGHT - 1);
        return digestOf(canonicalState(worldState(w)));
    };
    assert.equal(digest(), digest());
});

test('different seeds fight differently around the same walls', () => {
    const digest = (seed) => {
        const w = world({schedule: EARLY_WAVE, seed});
        walls(w, RING_7);
        w.cycle.endDay();
        run(w, 1500);
        return digestOf(canonicalState(worldState(w)));
    };
    assert.notEqual(digest(731), digest(98));
});

test('a destroyed wall leaves its tile passable at once, and is destroyed exactly once', () => {
    const w = world({schedule: [1], rng: spawnsAt(TOP(12))});
    const [id] = walls(w, [[12, 4]]);
    assert.equal(w.placement.damageBuilding(id, 95).hp, 5);
    assert.equal(w.placement.damageBuilding(id, 5).destroyed, true);
    assert.equal(w.grid.occupantAt(12, 4), null);
    assert.equal(w.placement.damageBuilding(id, 5).reason, UNKNOWN_BUILDING);
});
