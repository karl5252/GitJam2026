/**
 * TASK 025.4B: HQ's workers clear jungle round their work flag. The real ACTIVE cycle
 * on the jungle map at its default seed, through the soak harness in GameScene's tick
 * order. Nothing here runs the LEGACY cycle.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Shift} from '../../src/core/shiftCycle.js';
import {MAX_MANUAL_STEPS} from '../../src/core/simulationClock.js';
import {TerrainKind} from '../../src/core/terrain.js';
import {Ground, groundAt} from '../../src/core/terrainSpeed.js';
import {walkMap} from '../../src/core/walkField.js';
import {CLEARING, WORKER} from '../../src/core/workers.js';
import {WORLD_MAPS, createTerrain} from '../../src/core/worldMap.js';
import {FogOfWar, startingKnown} from '../../src/core/vision.js';
import {createWorld} from '../soak/harness.js';

const MAP = WORLD_MAPS.jungle;

/** HQ in the middle of the clearing, through Day 0 and Night 1 to the first timed Day. */
function jungleBase({credits = 9000} = {}) {
    const terrain = createTerrain(MAP, MAP.seed);
    const w = createWorld({requireHq: true, roads: true, resources: {credits, ap: 40}, schedule: [], active: true, map: MAP, terrain});
    const {center} = terrain;
    assert.equal(w.place('hq', center.col, center.row).ok, true);
    w.cycle.endDay();
    while (w.cycle.shift !== Shift.DAY) w.cycle.stepTicks(1, w.tick);
    w.economy.restoreAp(40);
    return {w, terrain};
}

/** The jungle tile beside the clearing on HQ's row, west, then `inward` tiles further in. */
function edgeOfJungle(terrain, inward = 1) {
    let col = terrain.center.col;
    while (terrain.kindAt(col, terrain.center.row) !== TerrainKind.JUNGLE) col--;
    return {col: col - inward, row: terrain.center.row};
}

function run(w, ticks, onTick = () => {}) {
    for (let i = 0; i < ticks && w.cycle.active; i++) {
        if (w.cycle.stepTicks(1, w.tick) === 0) break;
        onTick(i);
    }
}

const kinds = (terrain) => terrain.snapshot().rows.join('\n');
const clearedTiles = (terrain) => {
    const out = [];
    terrain.snapshot().rows.forEach((line, row) => [...line].forEach((glyph, col) => glyph === ',' && out.push(`${col},${row}`)));
    return out;
};
const within = (flag, {col, row}) => (col - flag.col) ** 2 + (row - flag.row) ** 2 <= CLEARING.radius ** 2;

test('the provisional values live in one place', () => {
    assert.deepEqual({...CLEARING}, {radius: 3, ticksPerTile: 300, pollutionPerTile: 1});
    assert.equal(CLEARING.radius, WORKER.workRadius);
});

test('1. nobody works before reaching the flag, and work only advances on a worker standing on its tile', () => {
    const {w, terrain} = jungleBase();
    const flag = edgeOfJungle(terrain);
    w.workers.setFlag(flag);
    let before = new Map();
    let firstWork = null;
    run(w, 2000, (tick) => {
        const workers = w.workers.workers();
        for (const worker of workers) {
            if (worker.job) assert.equal(worker.arrived, true, `${worker.id} took a job before reaching the flag`);
        }
        const now = new Map(w.workers.clearing().progress.map(({col, row, ticks}) => [`${col},${row}`, ticks]));
        for (const [key, ticks] of now) {
            if (ticks === before.get(key)) continue;
            firstWork ??= tick;
            const [col, row] = key.split(',').map(Number);
            const centre = w.grid.cellCenter(col, row);
            assert.ok(workers.some((worker) => worker.working && worker.x === centre.x && worker.y === centre.y), `progress on ${key} with nobody there`);
        }
        before = now;
    });
    assert.ok(firstWork > 100, `work began at tick ${firstWork}, after the walk out`);
});

test('2. only jungle inside the circular 3-tile radius is cleared; nothing else changes', () => {
    const {w, terrain} = jungleBase();
    const flag = edgeOfJungle(terrain, 2);
    const original = terrain.snapshot().rows;
    w.workers.setFlag(flag);
    run(w, 3400);
    const cleared = clearedTiles(terrain).map((key) => key.split(',').map(Number));
    assert.ok(cleared.length > 5);
    for (const [col, row] of cleared) {
        assert.equal(original[row][col], '#', `${col},${row} was jungle`);
        assert.ok(within(flag, {col, row}), `${col},${row} is inside the radius`);
    }
    const now = terrain.snapshot().rows;
    original.forEach((line, row) => [...line].forEach((glyph, col) => {
        if (glyph !== '#') assert.equal(now[row][col], glyph, 'clearing, path and open ground are untouched');
    }));
});

test('3. assignment is deterministic: each worker takes the tile it reaches soonest, ties by row then column', () => {
    const jobs = () => {
        const {w, terrain} = jungleBase();
        w.workers.setFlag(edgeOfJungle(terrain));
        const seen = [];
        run(w, 2500, () => {
            for (const {id, job} of w.workers.workers()) {
                const last = seen.findLast((entry) => entry.id === id);
                if (job && (!last || last.col !== job.col || last.row !== job.row)) seen.push({id, ...job});
            }
        });
        return seen;
    };
    const a = jobs();
    assert.ok(a.length >= 6);
    assert.deepEqual(jobs(), a);
    const flag = edgeOfJungle(createTerrain(MAP, MAP.seed));
    assert.deepEqual(a[0], {id: 'worker-1', ...flag}, 'the first worker stands on jungle at the flag: nothing is sooner');
});

test('4. no two workers ever hold the same tile', () => {
    const {w, terrain} = jungleBase();
    w.workers.setFlag(edgeOfJungle(terrain));
    run(w, 3400, () => {
        const held = w.workers.workers().filter(({job}) => job).map(({job}) => `${job.col},${job.row}`);
        assert.equal(new Set(held).size, held.length);
    });
});

test('5. a tile takes exactly 300 ticks of work, and the bar never passes it', () => {
    const {w, terrain} = jungleBase();
    const flag = edgeOfJungle(terrain);
    w.workers.setFlag(flag);
    let worked = 0;
    let cleared = false;
    run(w, 1500, () => {
        if (cleared) return;
        const one = w.workers.workers().find(({id}) => id === 'worker-1');
        if (one?.working) worked++;
        for (const {ticks} of w.workers.clearing().progress) assert.ok(ticks < CLEARING.ticksPerTile);
        if (terrain.kindAt(flag.col, flag.row) === TerrainKind.CLEARED) cleared = true;
    });
    assert.ok(cleared);
    assert.equal(worked, CLEARING.ticksPerTile, 'worker-1 chopped the flag tile for exactly 300 ticks');
});

test('6. each tile changes the terrain once and adds Pollution once, even when two finish on the same tick', () => {
    const {w, terrain} = jungleBase();
    w.workers.setFlag(edgeOfJungle(terrain));
    // A recall and a send-again that lines two workers up: found by search, fixed by the seed.
    run(w, 530);
    w.workers.recall();
    run(w, 60);
    assert.deepEqual(w.workers.dispatch(), {ok: true});
    let pollution = w.pollution.value;
    let cleared = clearedTiles(terrain);
    let together = 0;
    run(w, 2400, () => {
        const now = clearedTiles(terrain);
        const fresh = now.filter((key) => !cleared.includes(key));
        assert.equal(w.pollution.value - pollution, fresh.length * CLEARING.pollutionPerTile, 'one Pollution per new tile');
        assert.equal(now.length, w.workers.clearing().cleared);
        if (fresh.length > 1) together++;
        pollution = w.pollution.value;
        cleared = now;
    });
    assert.ok(together >= 1, 'two tiles really finished on one tick');
    assert.equal(w.pollution.value, cleared.length);
    const [col, row] = cleared[0].split(',').map(Number);
    assert.equal(terrain.clear(col, row), false, 'a cleared tile can never be cleared, or charged, again');
});

test('7. partial work survives a recall and Dusk, and is finished later from where it stopped', () => {
    const {w, terrain} = jungleBase();
    const flag = edgeOfJungle(terrain);
    w.workers.setFlag(flag);
    run(w, 2000, () => {});
    w.workers.recall();
    run(w, 1);
    const kept = w.workers.clearing().progress;
    assert.ok(kept.length > 0 && kept.every(({ticks}) => ticks > 0 && ticks < CLEARING.ticksPerTile));
    run(w, 400);
    assert.deepEqual(w.workers.clearing().progress, kept, 'nothing advances while they are away');
    while (w.cycle.shift === Shift.DAY) w.cycle.stepTicks(MAX_MANUAL_STEPS, w.tick); // to Dusk
    while (w.cycle.shift !== Shift.DAY) w.cycle.stepTicks(MAX_MANUAL_STEPS, w.tick); // through Night
    assert.deepEqual(w.workers.clearing().progress, kept, 'and nothing through Dusk and Night');
    assert.deepEqual(w.workers.flag, flag, 'the flag is still there');
    w.workers.dispatch();
    const [first] = kept;
    let resumedAt = null;
    run(w, 1500, () => {
        const now = w.workers.clearing().progress.find(({col, row}) => col === first.col && row === first.row);
        if (resumedAt === null && now && now.ticks === first.ticks + 1) resumedAt = now.ticks;
    });
    assert.equal(resumedAt, first.ticks + 1, 'resumed from the kept progress, not from zero');
});

test('8. no work in Day 0, while paused, at Dusk or at Night', () => {
    const terrain = createTerrain(MAP, MAP.seed);
    const day0 = createWorld({requireHq: true, roads: true, resources: {credits: 9000, ap: 40}, schedule: [], active: true, map: MAP, terrain});
    day0.place('hq', terrain.center.col, terrain.center.row);
    assert.equal(day0.workers.setFlag(edgeOfJungle(terrain)).ok, false, 'Day 0 takes no worker orders');
    for (let i = 0; i < 100; i++) day0.clock.advance(100, day0.tick);
    assert.deepEqual(day0.workers.clearing(), {progress: [], cleared: 0, ticksPerTile: 300});

    const {w, terrain: t2} = jungleBase();
    w.workers.setFlag(edgeOfJungle(t2));
    run(w, 1000);
    const snapshot = JSON.stringify([w.workers.clearing(), kinds(t2), w.pollution.value]);
    w.clock.pause();
    for (let i = 0; i < 100; i++) w.clock.advance(100, w.tick);
    assert.equal(JSON.stringify([w.workers.clearing(), kinds(t2), w.pollution.value]), snapshot, 'paused');
    w.clock.resume();
    while (w.cycle.shift === Shift.DAY) w.cycle.stepTicks(MAX_MANUAL_STEPS, w.tick);
    const atDusk = JSON.stringify([w.workers.clearing(), kinds(t2), w.pollution.value]);
    while (w.cycle.shift !== Shift.DAY) {
        w.cycle.stepTicks(1, w.tick);
        assert.ok(w.workers.workers().every(({working, job}) => !working && !job), `nobody works at ${w.cycle.shift}`);
    }
    const [clearing, , pollution] = JSON.parse(atDusk);
    assert.deepEqual(w.workers.clearing(), clearing, 'Dusk and Night cleared nothing');
    assert.equal(w.pollution.value, pollution + 0, 'and added no clearing Pollution (no industry here)');
});

test('9. END DAY fast-forward clears exactly what waiting would have', () => {
    const play = (skip) => {
        const {w, terrain} = jungleBase();
        w.workers.setFlag(edgeOfJungle(terrain));
        run(w, 500);
        if (skip) {
            w.cycle.endDay();
            while (w.cycle.fastForwarding) w.cycle.stepTicks(MAX_MANUAL_STEPS, w.tick);
        } else {
            while (w.cycle.shift === Shift.DAY) w.cycle.stepTicks(1, w.tick);
        }
        return JSON.stringify([w.workers.clearing(), kinds(terrain), w.pollution.value, w.workers.workers()]);
    };
    assert.equal(play(true), play(false));
});

test('10. cleared ground takes buildings and roads like open ground', () => {
    const {w, terrain} = jungleBase({credits: 50_000});
    const flag = edgeOfJungle(terrain);
    assert.equal(w.grid.isBuildable(flag.col, flag.row), false);
    assert.equal(w.roads.canAdd(flag).reason, 'terrain-blocked');
    w.placement.select('wall');
    assert.equal(w.placement.preview(flag).reason, 'terrain-blocked');
    w.placement.cancel();
    w.workers.setFlag(flag);
    run(w, 1500);
    assert.equal(terrain.kindAt(flag.col, flag.row), TerrainKind.CLEARED);
    assert.equal(w.grid.isBuildable(flag.col, flag.row), true);
    w.workers.recall();
    run(w, 400); // nobody stands on it now
    assert.equal(w.roads.canAdd(flag).reason, 'not-connected', 'the ground takes a road now; it only needs to join the network');
    w.placement.select('wall');
    assert.equal(w.placement.placeAt(flag).ok, true, 'and a wall stands on it');
    w.placement.cancel();
});

test('11. walking follows the new ground: cleared tiles walk at open-ground speed, and navigation is rebuilt', () => {
    const {w, terrain} = jungleBase();
    const flag = edgeOfJungle(terrain);
    const ground = {roads: w.roads, terrain};
    assert.equal(groundAt(flag, ground), Ground.JUNGLE);
    const before = walkMap(w.grid, w.placement.buildings(), ground).half[flag.row * w.grid.cols + flag.col];
    w.workers.setFlag(flag);
    run(w, 1500);
    assert.equal(groundAt(flag, ground), Ground.OPEN, 'x1.0 until a road is laid');
    const after = walkMap(w.grid, w.placement.buildings(), ground).half[flag.row * w.grid.cols + flag.col];
    assert.deepEqual([before, after], [25, 16]);
    // Workers really move at open-ground speed on cleared tiles now: one px a tick.
    w.workers.recall();
    let fastest = 0;
    let last = new Map();
    run(w, 600, () => {
        for (const worker of w.workers.workers()) {
            const was = last.get(worker.id);
            if (was) {
                const under = w.grid.worldToCell(was.x, was.y);
                if (terrain.kindAt(under.col, under.row) === TerrainKind.CLEARED) {
                    fastest = Math.max(fastest, Math.abs(worker.x - was.x) + Math.abs(worker.y - was.y));
                }
            }
        }
        last = new Map(w.workers.workers().map((worker) => [worker.id, worker]));
    });
    assert.ok(Math.abs(fastest - 1) < 1e-9, `crossed the cleared tile at ${fastest} px a tick`);
});

test('12. the terrain snapshot shows cleared ground, and the fog is untouched by clearing', () => {
    const {w, terrain} = jungleBase();
    const fog = new FogOfWar({cols: terrain.cols, rows: terrain.rows, explored: startingKnown(createTerrain(MAP, MAP.seed))});
    const fogBefore = fog.snapshot();
    const revision = terrain.revision;
    const flag = edgeOfJungle(terrain);
    w.workers.setFlag(flag);
    run(w, 1500);
    assert.equal(terrain.snapshot().rows[flag.row][flag.col], ',');
    assert.equal(terrain.revision - revision, w.workers.clearing().cleared, 'one revision per cleared tile');
    assert.deepEqual(fog.snapshot(), fogBefore, 'clearing changes no fog state');
    assert.deepEqual(w.workers.snapshot().clearing, w.workers.clearing());
});

test('a new run starts from the generated jungle, whatever the last one cleared', () => {
    const {w, terrain} = jungleBase();
    w.workers.setFlag(edgeOfJungle(terrain));
    run(w, 2000);
    assert.ok(clearedTiles(terrain).length > 0);
    const fresh = createTerrain(MAP, MAP.seed);
    assert.equal(clearedTiles(fresh).length, 0);
    assert.equal(fresh.revision, 0);
});

test('chopping loops the ACTION row\'s frames 8 and 9 only, 8 ticks each; 10-11 are kept for repairs', async () => {
    const {chopFrame} = await import('../../src/scenes/WorkerLayer.js');
    const frames = Array.from({length: 64}, (_, tick) => chopFrame(tick));
    assert.deepEqual(new Set(frames), new Set([8, 9]));
    assert.deepEqual(frames.slice(0, 17), [...Array(8).fill(8), ...Array(8).fill(9), 8]);
});
