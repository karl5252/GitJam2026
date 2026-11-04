import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MUTANT, Mutants, SPAWN_SCHEDULE, TARGET_BIAS, blockerAt, borderSpawns, distanceToFootprint, selectTarget,
} from '../../src/core/mutants.js';
import {BUILDING_TYPES} from '../../src/core/buildingTypes.js';
import {BuildingPlacement, UNKNOWN_BUILDING} from '../../src/core/buildingPlacement.js';
import {Economy} from '../../src/core/economy.js';
import {Grid} from '../../src/core/grid.js';
import {Pollution} from '../../src/core/pollution.js';
import {calculatePower} from '../../src/core/power.js';
import {SeededRandom} from '../../src/core/seededRandom.js';
import {settleNight} from '../../src/core/settlement.js';
import {Shift, ShiftCycle} from '../../src/core/shiftCycle.js';
import {SimulationClock} from '../../src/core/simulationClock.js';

const ORIGIN = {x: 256, y: 104};
const newGrid = () => new Grid({cols: 24, rows: 16, tileSize: 32, originX: ORIGIN.x, originY: ORIGIN.y});

/** Index of the top-edge spawn above `col`, and of the left-edge spawn beside `row`. */
const topSpawn = (col) => col;
const leftSpawn = (row) => 79 - row;

/** Returns preset spawn indices in order, and counts draws. */
function fixedRng(...indices) {
    const rng = {
        draws: 0,
        nextInt(min, max) {
            assert.deepEqual([min, max], [0, 79]);
            return indices[rng.draws++ % indices.length];
        },
    };
    return rng;
}

/** The real objects, ticked in the same order as GameScene.stepSimulation. */
function world({schedule = [1], rng = fixedRng(0), credits = 100000, ap = 50} = {}) {
    const clock = new SimulationClock();
    const economy = new Economy({credits, ap});
    const pollution = new Pollution();
    const grid = newGrid();
    let cycle;
    let failSettlement = false;
    const placement = new BuildingPlacement(grid, economy, {isConstructionAllowed: () => cycle.isConstructionAllowed});
    const reports = [];
    cycle = new ShiftCycle({
        clock,
        economy,
        settleNight: (day) => {
            if (failSettlement) throw new Error('settlement failed');
            const report = settleNight({day, buildings: placement.buildings(), economy, pollution});
            reports.push(report);
            return report;
        },
    });
    const mutants = new Mutants({cycle, placement, grid, rng, schedule});
    const log = [];
    const onTick = (tick) => {
        cycle.onTick(tick);
        log.push({night: cycle.elapsedNightTicks, shift: cycle.shift, effects: mutants.step()});
    };
    const step = (total) => {
        let done = 0;
        while (done < total) {
            const n = cycle.stepTicks(Math.min(240, total - done), onTick);
            if (n === 0) break;
            done += n;
        }
        return done;
    };
    const frames = (n, delta = 1000 / 60) => {
        for (let i = 0; i < n; i++) clock.advance(delta, onTick);
    };
    const place = (type, col, row) => {
        placement.select(type);
        const result = placement.placeAt({col, row});
        assert.equal(result.ok, true, `${type} at ${col},${row}`);
        placement.cancel();
        return result.building.id;
    };
    const setFail = (value) => { failSettlement = value; };
    cycle.begin();
    return {clock, economy, pollution, grid, placement, cycle, mutants, rng, log, reports, onTick, step, frames, place, setFail};
}

const effects = (w) => ({
    spawned: w.log.flatMap((l) => l.effects.spawned),
    attacks: w.log.flatMap((l) => l.effects.attacks),
    destroyed: w.log.flatMap((l) => l.effects.destroyed),
});

/** Step one tick at a time; a condition that is never reached fails instead of hanging. */
function stepUntil(w, done, limit = 4000) {
    for (let i = 0; i < limit; i++) {
        if (done()) return;
        w.step(1);
    }
    assert.fail(`condition not reached within ${limit} ticks`);
}

/** Grid occupants must match building records exactly. */
function assertOccupancyMatches(w) {
    const occupants = w.grid.snapshot().occupants.map((o) => o.id).sort();
    assert.deepEqual(occupants, w.placement.buildings().map((b) => b.id).sort());
}

const building = (id, type, col, row, width = 1, height = 1) => ({id, type, col, row, width, height, enabled: true, hp: 100});

// ---- Values and configuration -----------------------------------------------------

test('graybox values are the approved ones', () => {
    assert.deepEqual(MUTANT, {maxHp: 40, speed: 0.5, attackRange: 8, attackDamage: 5, attackCooldownTicks: 60});
    assert.deepEqual(SPAWN_SCHEDULE, [600]);
    assert.deepEqual(TARGET_BIAS, {powerPlant: 256, factory: 128, autocannon: 64, outpost: 0});
    assert.ok(Object.isFrozen(MUTANT) && Object.isFrozen(SPAWN_SCHEDULE) && Object.isFrozen(TARGET_BIAS));
});

test('every building type has an explicit target bias', () => {
    assert.deepEqual(Object.keys(TARGET_BIAS).sort(), Object.keys(BUILDING_TYPES).sort());
});

test('invalid schedules are rejected', () => {
    const w = world();
    const deps = {cycle: w.cycle, placement: w.placement, grid: w.grid, rng: w.rng};
    for (const bad of [null, [0], [3600], [-1], [1.5], [5, 5], [6, 5], ['10']]) {
        assert.throws(() => new Mutants({...deps, schedule: bad}), RangeError, String(bad));
    }
    new Mutants({...deps, schedule: []});
    new Mutants({...deps, schedule: [1, 3599]});
});

// ---- Distance to footprints -------------------------------------------------------

test('distance is measured to the footprint edge, not its centre', () => {
    const rect = {x: 100, y: 100, width: 96, height: 96}; // 3x3
    const cases = [
        [{x: 150, y: 90}, 10], [{x: 150, y: 206}, 10], [{x: 90, y: 150}, 10], [{x: 206, y: 150}, 10], // sides
        [{x: 90, y: 90}, 20], [{x: 206, y: 206}, 20], [{x: 90, y: 206}, 20], [{x: 206, y: 90}, 20], // corners
        [{x: 150, y: 150}, 0], [{x: 100, y: 100}, 0], [{x: 196, y: 196}, 0], // inside and on the edge
    ];
    for (const [point, expected] of cases) assert.equal(distanceToFootprint(point, rect), expected, JSON.stringify(point));
});

// ---- Target selection -------------------------------------------------------------

test('a Power Plant beats a closer Outpost until the Outpost is 8 cells closer', () => {
    const grid = newGrid();
    const point = {x: ORIGIN.x, y: ORIGIN.y + 16}; // left edge, row 0
    const plant = building('powerPlant-1', 'powerPlant', 10, 0, 3, 3); // 320 px away, score 64
    assert.equal(selectTarget(point, [building('outpost-2', 'outpost', 3, 0), plant], grid), 'powerPlant-1'); // 96
    assert.equal(selectTarget(point, [building('outpost-2', 'outpost', 1, 0), plant], grid), 'outpost-2'); // 32
});

test('a Factory sits between a Plant and an Outpost', () => {
    const grid = newGrid();
    const point = {x: ORIGIN.x, y: ORIGIN.y + 16};
    const list = [building('outpost-1', 'outpost', 5, 0), building('factory-2', 'factory', 5, 0, 3, 3), building('powerPlant-3', 'powerPlant', 5, 0, 3, 3)];
    assert.equal(selectTarget(point, list, grid), 'powerPlant-3');
    assert.equal(selectTarget(point, list.slice(0, 2), grid), 'factory-2');
});

test('equal scores prefer the higher bias, whatever the list order', () => {
    const grid = newGrid();
    const point = {x: ORIGIN.x, y: ORIGIN.y + 16};
    const outpost = building('outpost-1', 'outpost', 2, 0); // 64 - 0
    const factory = building('factory-2', 'factory', 6, 0, 3, 3); // 192 - 128
    assert.equal(selectTarget(point, [outpost, factory], grid), 'factory-2');
    assert.equal(selectTarget(point, [factory, outpost], grid), 'factory-2');
});

test('equal score and bias fall back to list order, not id order', () => {
    const grid = newGrid();
    const point = {x: ORIGIN.x + 32 * 12, y: ORIGIN.y}; // top edge, between both
    const a = building('outpost-10', 'outpost', 10, 2);
    const b = building('outpost-2', 'outpost', 13, 2);
    assert.equal(distanceToFootprint(point, grid.footprintRect(a)), distanceToFootprint(point, grid.footprintRect(b)));
    assert.equal(selectTarget(point, [a, b], grid), 'outpost-10');
    assert.equal(selectTarget(point, [b, a], grid), 'outpost-2');
});

test('selectTarget returns null with no buildings and rejects unknown types', () => {
    assert.equal(selectTarget({x: 0, y: 0}, [], newGrid()), null);
    assert.throws(() => selectTarget({x: 0, y: 0}, [building('x', 'tower', 1, 1)], newGrid()), TypeError);
    assert.throws(() => selectTarget({x: 0, y: 0}, [building('x', 'toString', 1, 1)], newGrid()), TypeError);
});

// ---- Spawn positions and timing ---------------------------------------------------

test('there are 80 distinct border positions, all on the grid outline', () => {
    const grid = newGrid();
    const spawns = borderSpawns(grid);
    assert.equal(spawns.length, 80);
    assert.equal(new Set(spawns.map((s) => `${s.x},${s.y}`)).size, 80);
    const [right, bottom] = [ORIGIN.x + 24 * 32, ORIGIN.y + 16 * 32];
    for (const {x, y, col, row} of spawns) {
        assert.ok(x === ORIGIN.x || x === right || y === ORIGIN.y || y === bottom, `${x},${y}`);
        assert.ok(col === 0 || col === 23 || row === 0 || row === 15, `${col},${row}`);
        assert.ok(distanceToFootprint({x, y}, grid.footprintRect({col, row})) === 0, 'touches its border cell');
    }
});

test('a mutant spawns exactly at its scheduled night tick', () => {
    const w = world({schedule: [600]});
    w.place('outpost', 12, 8);
    w.cycle.endDay();
    w.step(599);
    assert.deepEqual(w.mutants.snapshot(), []);
    assert.equal(w.rng.draws, 0);
    w.step(1);
    assert.deepEqual(w.mutants.snapshot(), [{
        id: 'mutant-1', x: ORIGIN.x + 16, y: ORIGIN.y, hp: 40, targetId: 'outpost-1', obstacleId: null, attackTimer: 60,
    }]);
    assert.deepEqual(w.log.at(-1).effects, {spawned: ['mutant-1'], attacks: [], destroyed: []});
    assert.equal(w.rng.draws, 1);
});

test('a new mutant first acts on the tick after it spawns', () => {
    const w = world({schedule: [5]});
    w.place('outpost', 12, 8);
    w.cycle.endDay();
    w.step(5);
    const {x, y} = w.mutants.snapshot()[0];
    w.step(1);
    const after = w.mutants.snapshot()[0];
    assert.equal(Math.abs(after.x - x) + Math.abs(after.y - y), 0.5);
});

test('an empty schedule spawns nothing and never touches the RNG', () => {
    const rng = new SeededRandom(731);
    const w = world({schedule: [], rng});
    const id = w.place('outpost', 12, 8);
    w.cycle.endDay();
    w.step(3600);
    assert.deepEqual(rng.snapshot(), {seed: 731, state: 731});
    assert.equal(w.placement.buildings().find((b) => b.id === id).hp, 100);
});

test('one RNG draw per spawn, on every night, with or without buildings', () => {
    const w = world({schedule: [10, 20], rng: fixedRng(3, 7)});
    w.cycle.endDay();
    w.step(3600);
    assert.equal(w.rng.draws, 2);
    w.cycle.endDay();
    w.step(3600);
    assert.equal(w.rng.draws, 4);
    assert.deepEqual(effects(w).spawned, ['mutant-1', 'mutant-2', 'mutant-3', 'mutant-4']);
});

test('a blocked border cell moves the spawn to the next free position clockwise', () => {
    const w = world({rng: fixedRng(topSpawn(4))});
    w.place('factory', 5, 1); // occupies columns 4-6 of the top row
    w.cycle.endDay();
    w.step(1);
    const [mutant] = w.mutants.snapshot();
    assert.deepEqual([mutant.x, mutant.y], [w.grid.cellCenter(7, 0).x, ORIGIN.y]);
    assert.equal(w.rng.draws, 1);
});

test('the blocked-spawn scan wraps past the last position', () => {
    const w = world({rng: fixedRng(79)}); // left edge, row 0
    w.place('outpost', 0, 0); // also blocks position 0, the top edge of the same cell
    w.cycle.endDay();
    w.step(1);
    const [mutant] = w.mutants.snapshot();
    assert.deepEqual([mutant.x, mutant.y], [w.grid.cellCenter(1, 0).x, ORIGIN.y]);
});

test('a spawn is skipped when every border cell is occupied, and no id is used', () => {
    const w = world({schedule: [1, 2], rng: fixedRng(10)});
    const border = borderSpawns(w.grid);
    const cells = new Map(border.map(({col, row}) => [`${col},${row}`, {col, row}]));
    for (const [key, {col, row}] of cells) {
        assert.equal(w.grid.place(key, {col, row, width: 1, height: 1}).ok, true);
    }
    w.cycle.endDay();
    w.step(1);
    assert.deepEqual(w.mutants.snapshot(), []);
    assert.deepEqual(w.log.at(-1).effects, {spawned: [], attacks: [], destroyed: []});
    assert.equal(w.rng.draws, 1); // the draw still happens

    w.grid.remove('10,0');
    w.step(1);
    assert.equal(w.mutants.snapshot()[0].id, 'mutant-1');
});

test('mutants never spawn on an occupied border cell, for any draw', () => {
    for (let index = 0; index < 80; index++) {
        const w = world({rng: fixedRng(index)});
        w.place('factory', 1, 1); // top-left corner
        w.place('powerPlant', 22, 14); // bottom-right corner
        w.cycle.endDay();
        w.step(1);
        const [mutant] = w.mutants.snapshot();
        assert.equal(blockerAt(mutant, w.placement.buildings(), w.grid), null, `draw ${index}`);
    }
});

// ---- Movement ---------------------------------------------------------------------

test('movement follows the longer axis in exact 0.5 px steps', () => {
    const w = world({rng: fixedRng(topSpawn(2))});
    w.place('outpost', 3, 12); // mostly below, slightly right
    w.cycle.endDay();
    w.step(1);
    const start = w.mutants.snapshot()[0];
    w.step(2);
    const moved = w.mutants.snapshot()[0];
    assert.deepEqual([moved.x - start.x, moved.y - start.y], [0, 1]);
});

test('equal axes step along x first', () => {
    const w = world({rng: fixedRng(leftSpawn(0))});
    w.place('outpost', 4, 4); // from the spawn at (256, 120): dx 128, dy 112
    w.cycle.endDay();
    w.step(1);
    const start = w.mutants.snapshot()[0];
    w.step(32); // dx falls to 112
    const level = w.mutants.snapshot()[0];
    assert.deepEqual([level.x - start.x, level.y - start.y], [16, 0]);
    w.step(1);
    assert.equal(w.mutants.snapshot()[0].x, level.x + 0.5);
});

for (const [name, col, row, spawn, side] of [
    ['top', 12, 1, topSpawn(12), 'y'],
    ['left', 1, 8, leftSpawn(8), 'x'],
]) {
    test(`a mutant stops exactly at attack range: ${name} approach`, () => {
        const w = world({rng: fixedRng(spawn)});
        w.place('powerPlant', col + (side === 'x' ? 6 : 0), row + (side === 'y' ? 6 : 0));
        w.cycle.endDay();
        w.step(400);
        const mutant = w.mutants.snapshot()[0];
        const rect = w.grid.footprintRect(w.placement.buildings()[0]);
        assert.equal(distanceToFootprint(mutant, rect), MUTANT.attackRange);
    });
}

test('a corner approach reaches range by footprint distance, for a 3x3', () => {
    const w = world({rng: fixedRng(topSpawn(0))});
    w.place('powerPlant', 8, 6);
    w.cycle.endDay();
    w.step(1000);
    const mutant = w.mutants.snapshot()[0];
    const rect = w.grid.footprintRect(w.placement.buildings()[0]);
    assert.equal(distanceToFootprint(mutant, rect), MUTANT.attackRange);
    assert.ok(mutant.x < rect.x || mutant.y < rect.y);
});

test('a mutant 8.5 px away keeps moving; at 8 px it stops', () => {
    const w = world({rng: fixedRng(topSpawn(12))});
    w.place('outpost', 12, 3);
    const rect = w.grid.footprintRect(w.placement.buildings()[0]);
    w.cycle.endDay();
    const gap = () => distanceToFootprint(w.mutants.snapshot()[0], rect);
    w.step(1);
    stepUntil(w, () => !(gap() > 8.5));
    w.step(1);
    assert.equal(gap(), 8);
    const position = w.mutants.snapshot()[0];
    w.step(5);
    assert.deepEqual([w.mutants.snapshot()[0].x, w.mutants.snapshot()[0].y], [position.x, position.y]);
});

// ---- Attacks ----------------------------------------------------------------------

test('the first hit lands on the 60th tick in range, then every 60 ticks', () => {
    const w = world({rng: fixedRng(topSpawn(12))});
    const id = w.place('outpost', 12, 3);
    w.cycle.endDay();
    const rect = w.grid.footprintRect(w.placement.buildings()[0]);
    w.step(1);
    stepUntil(w, () => !(distanceToFootprint(w.mutants.snapshot()[0], rect) > 8));
    const arrived = w.cycle.elapsedNightTicks;

    w.step(59);
    assert.equal(w.placement.buildings()[0].hp, 100);
    w.step(1);
    assert.equal(w.placement.buildings()[0].hp, 95);
    assert.deepEqual(w.log.at(-1).effects.attacks, [{mutantId: 'mutant-1', buildingId: id, damage: 5, hp: 95}]);
    assert.equal(w.cycle.elapsedNightTicks, arrived + 60);
    w.step(59);
    assert.equal(w.placement.buildings()[0].hp, 95);
    w.step(1);
    assert.equal(w.placement.buildings()[0].hp, 90);
});

test('an Outpost dies on the 20th hit, exactly once', () => {
    const w = world({rng: fixedRng(topSpawn(12))});
    const id = w.place('outpost', 12, 3);
    w.cycle.endDay();
    w.step(3000);
    assert.deepEqual(effects(w).destroyed, [id]);
    assert.equal(effects(w).attacks.length, 20);
    assert.deepEqual(effects(w).attacks.map((a) => a.hp), Array.from({length: 20}, (_, i) => 95 - 5 * i));
    assert.deepEqual(w.placement.buildings(), []);
    assert.equal(w.grid.occupantAt(12, 3), null);
    assertOccupancyMatches(w);
});

test('one mutant cannot destroy a 3x3 in one night, even starting adjacent', () => {
    const w = world({schedule: [600], rng: fixedRng(topSpawn(12))});
    w.place('powerPlant', 12, 1); // touches the top edge next to the spawn
    w.cycle.endDay();
    w.step(3600);
    const [plant] = w.placement.buildings();
    assert.ok(plant.hp >= 300 - 49 * 5, `hp ${plant.hp}`);
    assert.ok(plant.hp < 300);
});

test('damage persists across nights until the building dies', () => {
    const w = world({schedule: [600], rng: fixedRng(topSpawn(12))});
    w.place('powerPlant', 12, 4);
    const hpAfter = [];
    for (let night = 0; night < 3 && w.placement.buildings().length; night++) {
        w.cycle.endDay();
        w.step(3600);
        hpAfter.push(w.placement.buildings()[0]?.hp ?? 0);
        w.frames(120); // Day: nothing changes
        assert.equal(w.placement.buildings()[0]?.hp ?? 0, hpAfter.at(-1));
    }
    assert.ok(hpAfter[0] < 300 && hpAfter[0] > 0);
    assert.ok(hpAfter[1] < hpAfter[0]);
    assert.equal(hpAfter.at(-1), 0);
});

test('two mutants hitting on the same tick destroy a building exactly once', () => {
    // The farther spawn goes first; the later one starts 16 px closer.
    const w = world({schedule: [1, 33], rng: fixedRng(topSpawn(13), topSpawn(12))});
    const id = w.place('outpost', 12, 5);
    const survivor = w.place('outpost', 20, 12);
    w.cycle.endDay();
    w.step(1200);

    const hits = effects(w).attacks.filter((a) => a.buildingId === id);
    const byTick = new Map();
    for (const {night, effects: e} of w.log) {
        const count = e.attacks.filter((a) => a.buildingId === id).length;
        if (count) byTick.set(night, count);
    }
    assert.ok([...byTick.values()].includes(2), 'both mutants hit on one tick');
    assert.equal(hits.length, 20); // the second hit on the final tick never happens
    assert.deepEqual(effects(w).destroyed, [id]);
    assert.ok(w.mutants.snapshot().every((m) => m.targetId === survivor));
    assertOccupancyMatches(w);
});

test('a mutant retargets after its target is destroyed', () => {
    const w = world({rng: fixedRng(topSpawn(12))});
    const first = w.place('outpost', 12, 3);
    const second = w.place('outpost', 14, 8);
    w.cycle.endDay();
    w.step(1);
    assert.equal(w.mutants.snapshot()[0].targetId, first);
    stepUntil(w, () => !(w.placement.buildings().length === 2));
    assert.equal(w.mutants.snapshot()[0].targetId, first); // updates on its next action
    w.step(1);
    assert.equal(w.mutants.snapshot()[0].targetId, second);
});

test('a preferred target stays locked as the mutant passes nearer ones', () => {
    const w = world({rng: fixedRng(topSpawn(3))});
    const plant = w.place('powerPlant', 12, 5);
    w.place('outpost', 3, 9);
    w.cycle.endDay();
    w.step(1);
    const seen = new Set();
    for (let i = 0; i < 700; i++) {
        w.step(1);
        seen.add(w.mutants.snapshot()[0].targetId);
    }
    assert.deepEqual([...seen], [plant]);
});

// ---- Obstacles --------------------------------------------------------------------

/** Plant at rows 9-11 is preferred; the Outpost at row 5 sits in the straight path. */
function obstacleWorld() {
    const w = world({rng: fixedRng(topSpawn(12))});
    const plant = w.place('powerPlant', 12, 10);
    const outpost = w.place('outpost', 12, 5);
    w.cycle.endDay();
    w.step(1);
    assert.equal(w.mutants.snapshot()[0].targetId, plant);
    return {w, plant, outpost};
}

const untilObstacle = (w) => { stepUntil(w, () => !(!w.mutants.snapshot()[0].obstacleId)); };

test('blockerAt uses closed bounds and returns the earliest building', () => {
    const grid = newGrid();
    const a = building('a', 'outpost', 3, 3);
    const b = building('b', 'outpost', 4, 3); // touching a
    const seam = {x: grid.footprintRect(b).x, y: grid.cellCenter(3, 3).y};
    assert.equal(blockerAt(seam, [a, b], grid), 'a');
    assert.equal(blockerAt(seam, [b, a], grid), 'b');
    assert.equal(blockerAt({x: seam.x - 16, y: seam.y}, [a, b], grid), 'a');
    assert.equal(blockerAt({x: seam.x - 32.5, y: seam.y}, [a, b], grid), null);
    assert.equal(blockerAt({x: seam.x, y: grid.footprintRect(a).y - 0.5}, [a, b], grid), null);
});

test('a building in the way stops the mutant, which keeps its preferred target', () => {
    const {w, plant, outpost} = obstacleWorld();
    untilObstacle(w);
    const mutant = w.mutants.snapshot()[0];
    assert.equal(mutant.obstacleId, outpost);
    assert.equal(mutant.targetId, plant);
    const rect = w.grid.footprintRect(w.placement.buildings()[1]);
    assert.equal(distanceToFootprint(mutant, rect), 0.5); // right up against it, not inside
});

test('an obstacle is attacked on the normal cooldown', () => {
    const {w, outpost} = obstacleWorld();
    untilObstacle(w);
    w.step(59);
    assert.equal(effects(w).attacks.length, 0);
    w.step(1);
    assert.deepEqual(effects(w).attacks, [{mutantId: 'mutant-1', buildingId: outpost, damage: 5, hp: 95}]);
});

test('attacking an obstacle does not jitter: position and both ids hold still', () => {
    const {w, plant, outpost} = obstacleWorld();
    untilObstacle(w);
    const {x, y} = w.mutants.snapshot()[0];
    for (let i = 0; i < 1100; i++) {
        w.step(1);
        const m = w.mutants.snapshot()[0];
        if (!w.placement.buildings().some((b) => b.id === outpost)) break;
        assert.deepEqual([m.x, m.y, m.targetId, m.obstacleId], [x, y, plant, outpost]);
    }
});

test('after destroying an obstacle the mutant resumes toward its target with no further hits on it', () => {
    const {w, plant, outpost} = obstacleWorld();
    untilObstacle(w);
    w.step(1201); // the 20th hit lands on tick 1200; the next action clears the obstacle
    assert.deepEqual(effects(w).destroyed, [outpost]);
    assert.equal(effects(w).attacks.filter((a) => a.buildingId === outpost).length, 20);
    const m = w.mutants.snapshot()[0];
    assert.equal(m.obstacleId, null);
    assert.equal(m.targetId, plant);
    w.step(600);
    const hits = effects(w).attacks.filter((a) => a.buildingId === plant);
    assert.ok(hits.length > 0);
    assertOccupancyMatches(w);
});

test('a destroyed obstacle clears for a second mutant waiting on it, with no stale attack', () => {
    const w = world({schedule: [1, 2], rng: fixedRng(topSpawn(12), topSpawn(12))});
    const plant = w.place('powerPlant', 12, 10);
    const outpost = w.place('outpost', 12, 5);
    w.cycle.endDay();
    w.step(1000);
    assert.deepEqual(effects(w).destroyed, [outpost]);
    assert.equal(effects(w).attacks.filter((a) => a.buildingId === outpost).length, 20);
    assert.ok(w.mutants.snapshot().every((m) => m.obstacleId === null && m.targetId === plant));
});

test('a cooldown cut short by another mutant does not carry over to the next target', () => {
    // mutant-2 lands the killing hit while mutant-1 is halfway through its cooldown.
    const w = world({schedule: [1, 31], rng: fixedRng(topSpawn(12))});
    const plant = w.place('powerPlant', 12, 10);
    const outpost = w.place('outpost', 12, 5);
    w.cycle.endDay();
    w.step(31);
    stepUntil(w, () => !(w.placement.buildings().some((b) => b.id === outpost)));
    const interrupted = w.mutants.snapshot()[0];
    assert.ok(interrupted.attackTimer > 0 && interrupted.attackTimer < 60, `timer ${interrupted.attackTimer}`);

    const rect = w.grid.footprintRect(w.placement.buildings()[0]);
    stepUntil(w, () => !(distanceToFootprint(w.mutants.snapshot()[0], rect) > MUTANT.attackRange));
    const arrived = w.cycle.elapsedNightTicks;
    stepUntil(w, () => !(!w.log.at(-1).effects.attacks.some((a) => a.mutantId === 'mutant-1' && a.buildingId === plant)));
    assert.equal(w.cycle.elapsedNightTicks, arrived + 60);
});

test('touching buildings form a wall with no walkable seam', () => {
    const w = world({rng: fixedRng(topSpawn(12))});
    w.place('powerPlant', 12, 12);
    w.place('outpost', 11, 6);
    const blocker = w.place('outpost', 12, 6);
    w.place('outpost', 13, 6);
    w.cycle.endDay();
    w.step(1);
    untilObstacle(w);
    assert.equal(w.mutants.snapshot()[0].obstacleId, blocker);
});

test('a mutant is never inside a footprint, and occupancy stays consistent', () => {
    for (const seed of [1, 731, 90210]) {
        const w = world({schedule: [100, 300, 700, 1500], rng: new SeededRandom(seed)});
        for (const [type, col, row] of [
            ['powerPlant', 12, 8], ['factory', 8, 8], ['factory', 16, 8], ['outpost', 12, 5], ['outpost', 12, 11], ['outpost', 3, 3],
        ]) w.place(type, col, row);
        for (let night = 0; night < 3; night++) {
            w.cycle.endDay();
            while (w.cycle.shift === Shift.NIGHT) {
                w.step(1);
                for (const mutant of w.mutants.snapshot()) {
                    assert.equal(blockerAt(mutant, w.placement.buildings(), w.grid), null, `${mutant.id} at ${mutant.x},${mutant.y}`);
                }
            }
            assertOccupancyMatches(w);
        }
        const {destroyed} = effects(w);
        assert.equal(new Set(destroyed).size, destroyed.length, 'no building is destroyed twice');
    }
});

// ---- Effects of destruction -------------------------------------------------------

/** Run until `id` is gone, within one night. */
function destroyDuringNight(w, id) {
    while (w.placement.buildings().some((b) => b.id === id)) {
        assert.equal(w.cycle.shift, Shift.NIGHT, `${id} survived the night`);
        w.step(1);
    }
}

test('destruction frees the cells for reuse with a new id', () => {
    const w = world({rng: fixedRng(topSpawn(12))});
    const id = w.place('outpost', 12, 3);
    w.cycle.endDay();
    destroyDuringNight(w, id);
    w.step(w.cycle.remainingNightTicks);
    assert.equal(w.place('outpost', 12, 3), 'outpost-2');
    assertOccupancyMatches(w);
});

test('destroying a Plant changes power immediately, without touching other records', () => {
    const w = world({schedule: [1, 2, 3, 4, 5, 6, 7], rng: fixedRng(topSpawn(12))});
    const plant = w.place('powerPlant', 12, 3);
    const factory = w.place('factory', 12, 9);
    assert.equal(calculatePower(w.placement.buildings()).status, 'normal');
    w.cycle.endDay();
    destroyDuringNight(w, plant);
    const power = calculatePower(w.placement.buildings());
    assert.deepEqual([power.generation, power.demand, power.status], [0, 40, 'blackout']);
    assert.deepEqual(power.buildings, [{id: factory, type: 'factory', enabled: true, powered: false}]);
});

test('settlement and pollution use only the buildings left at the end of the night', () => {
    const w = world({schedule: [1, 2], rng: fixedRng(topSpawn(12))}); // kills the Plant, not the rest
    const plant = w.place('powerPlant', 12, 3);
    w.place('factory', 18, 9);
    w.place('outpost', 3, 13);
    w.cycle.endDay();
    destroyDuringNight(w, plant);
    const before = w.economy.credits;
    w.step(w.cycle.remainingNightTicks);
    const [report] = w.reports;
    assert.equal(report.gross, 0); // blackout: the Factory earns nothing
    assert.equal(report.pollution.emitted, 0); // no Plant, unpowered Factory
    assert.equal(report.power.status, 'blackout');
    assert.equal(report.counts.powerPlant, 0);
    assert.equal(report.counts.outpost + report.counts.factory, w.placement.buildings().length);
    assert.equal(w.economy.credits, before + report.net);
});

test('a destroyed Outpost stops its upkeep; a destroyed Factory stops income and emissions', () => {
    const outpostWorld = world({rng: fixedRng(topSpawn(12))});
    const outpost = outpostWorld.place('outpost', 12, 3);
    outpostWorld.cycle.endDay();
    destroyDuringNight(outpostWorld, outpost);
    outpostWorld.step(outpostWorld.cycle.remainingNightTicks);
    assert.equal(outpostWorld.reports[0].upkeep, 0);

    const factoryWorld = world({schedule: [1, 2], rng: fixedRng(leftSpawn(3))});
    const factory = factoryWorld.place('factory', 2, 3);
    factoryWorld.place('powerPlant', 21, 13); // too far to outweigh the adjacent Factory
    factoryWorld.cycle.endDay();
    factoryWorld.step(1);
    assert.equal(factoryWorld.mutants.snapshot()[0].targetId, factory);
    destroyDuringNight(factoryWorld, factory);
    factoryWorld.step(factoryWorld.cycle.remainingNightTicks);
    const [report] = factoryWorld.reports;
    assert.deepEqual([report.gross, report.pollution.emitted, report.counts.factory], [0, 12, 0]);
});

// ---- No targets, Day and dawn -----------------------------------------------------

test('with no buildings a mutant spawns and waits in place until dawn', () => {
    const w = world();
    w.cycle.endDay();
    w.step(1);
    const start = w.mutants.snapshot()[0];
    assert.equal(start.targetId, null);
    w.step(1000);
    assert.deepEqual(w.mutants.snapshot(), [start]);
    w.step(w.cycle.remainingNightTicks);
    assert.deepEqual(w.mutants.snapshot(), []);
    assert.equal(w.reports.length, 1);
});

test('after the last building dies a mutant waits, and the night still completes', () => {
    const w = world({rng: fixedRng(topSpawn(12))});
    const id = w.place('outpost', 12, 3);
    w.cycle.endDay();
    destroyDuringNight(w, id);
    w.step(1);
    const idle = w.mutants.snapshot()[0];
    assert.equal(idle.targetId, null);
    w.step(100);
    assert.deepEqual(w.mutants.snapshot(), [idle]);
    w.step(w.cycle.remainingNightTicks);
    assert.equal(w.cycle.day, 2);
    assert.equal(w.economy.ap, 5); // the run simply continues: no game over yet
});

test('mutants act through tick 3599, and tick 3600 only settles and clears them', () => {
    const w = world({rng: fixedRng(topSpawn(12))});
    w.place('powerPlant', 12, 3);
    w.cycle.endDay();
    w.step(3599);
    assert.equal(w.cycle.shift, Shift.NIGHT);
    assert.equal(w.mutants.snapshot().length, 1);
    assert.equal(w.reports.length, 0);
    const hp = w.placement.buildings()[0].hp;

    w.step(1);
    assert.equal(w.cycle.shift, Shift.DAY);
    assert.deepEqual(w.mutants.snapshot(), []);
    assert.equal(w.reports.length, 1);
    assert.deepEqual(w.log.at(-1).effects, {spawned: [], attacks: [], destroyed: []});
    assert.equal(w.placement.buildings()[0].hp, hp);
});

test('surviving mutants carry no penalty into the Day', () => {
    const w = world({rng: fixedRng(topSpawn(12))});
    w.place('powerPlant', 12, 3);
    w.cycle.endDay();
    w.step(3600);
    assert.equal(w.reports[0].net, 0);
    assert.equal(w.economy.ap, 5);
    assert.equal(w.pollution.value, 12);
});

test('Day stays untimed: nothing spawns, moves, hits or ticks', () => {
    const w = world({schedule: [1]});
    const id = w.place('outpost', 12, 8);
    const before = w.placement.buildings();
    w.frames(600);
    assert.equal(w.step(100), 0);
    for (let i = 0; i < 1000; i++) assert.deepEqual(w.mutants.step(), {spawned: [], attacks: [], destroyed: []});
    assert.equal(w.clock.tick, 0);
    assert.deepEqual(w.mutants.snapshot(), []);
    assert.equal(w.rng.draws, 0);
    assert.deepEqual(w.placement.buildings(), before);
    assert.equal(before[0].id, id);
});

test('a Night paused between ticks changes nothing', () => {
    const w = world({rng: fixedRng(topSpawn(12))});
    w.place('outpost', 12, 5);
    w.cycle.endDay();
    w.step(100);
    const snapshot = w.mutants.snapshot();
    w.clock.pause();
    w.frames(600);
    assert.deepEqual(w.mutants.snapshot(), snapshot);
});

test('a failed settlement retry applies no double damage or double settlement', () => {
    const w = world({rng: fixedRng(topSpawn(12))});
    const id = w.place('powerPlant', 12, 3);
    w.cycle.endDay();
    w.step(3599);
    const mutants = w.mutants.snapshot();
    const hp = w.placement.buildings()[0].hp;
    const credits = w.economy.credits;

    w.setFail(true);
    assert.throws(() => w.step(1), /settlement failed/);
    assert.equal(w.cycle.shift, Shift.NIGHT);
    assert.deepEqual(w.mutants.snapshot(), mutants); // step() did not run
    assert.equal(w.placement.buildings()[0].hp, hp);
    assert.equal(w.economy.credits, credits);
    assert.equal(w.reports.length, 0);

    w.setFail(false);
    assert.equal(w.step(1), 1);
    assert.equal(w.cycle.shift, Shift.DAY);
    assert.deepEqual(w.mutants.snapshot(), []);
    assert.equal(w.placement.buildings().find((b) => b.id === id).hp, hp);
    assert.equal(w.reports.length, 1);
    assert.equal(w.pollution.value, 12);
});

// ---- Detached state and determinism -----------------------------------------------

test('snapshots are detached from mutant state', () => {
    const w = world({rng: fixedRng(topSpawn(12))});
    w.place('outpost', 12, 8);
    w.cycle.endDay();
    w.step(1);
    const snapshot = w.mutants.snapshot();
    const copy = structuredClone(snapshot);
    snapshot[0].hp = 0;
    snapshot[0].x = -1;
    snapshot.pop();
    assert.deepEqual(w.mutants.snapshot(), copy);
});

function playThree(advance, seed = 731) {
    const rng = new SeededRandom(seed);
    const w = world({schedule: [100, 600, 1500], rng});
    w.place('powerPlant', 12, 8);
    w.place('factory', 7, 8);
    w.place('outpost', 12, 4);
    w.place('outpost', 18, 12);
    const trail = [];
    for (let night = 0; night < 3; night++) {
        w.cycle.endDay();
        advance(w);
        trail.push({buildings: w.placement.buildings(), grid: w.grid.snapshot(), report: w.reports.at(-1), rng: rng.snapshot()});
    }
    return {trail, effects: effects(w), economy: w.economy.snapshot(), pollution: w.pollution.snapshot()};
}

test('the same seed and commands give identical results', () => {
    const steps = (w) => w.step(3600);
    assert.deepEqual(playThree(steps), playThree(steps));
    assert.notDeepEqual(playThree(steps, 731).effects, playThree(steps, 732).effects);
});

test('real frames and manual stepping give identical results, at any frame rate', () => {
    const viaSteps = playThree((w) => w.step(3600));
    const viaFrames = playThree((w) => { while (w.cycle.shift === Shift.NIGHT) w.frames(1); });
    const viaUneven = playThree((w) => {
        for (let i = 0; w.cycle.shift === Shift.NIGHT; i++) w.frames(1, i % 3 ? 7 : 90);
    });
    assert.deepEqual(viaFrames, viaSteps);
    assert.deepEqual(viaUneven, viaSteps);
});

test('damageBuilding rejects a building that is already gone', () => {
    const w = world({rng: fixedRng(topSpawn(12))});
    const id = w.place('outpost', 12, 3);
    w.cycle.endDay();
    destroyDuringNight(w, id);
    assert.deepEqual(w.placement.damageBuilding(id, 5), {ok: false, reason: UNKNOWN_BUILDING});
});
