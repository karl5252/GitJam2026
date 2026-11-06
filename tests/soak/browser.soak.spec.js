import {test, expect} from '@playwright/test';
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {boot, body, byAction, clickAction, clickWorld} from '../helpers/canvas.js';
import {hqFlow} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';
import {getBuildingType} from '../../src/core/buildingTypes.js';
import {WAVE, waveSchedule, bruteSlots as bruteSlotsOf, spitterSlots as spitterSlotsOf} from '../../src/core/waves.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {canonicalState, createWorld, digestOf, worldState} from './harness.js';
import {loadLayout} from '../../src/testShadow/layoutSnapshot.js';

/**
 * Browser soak: `npm run test:soak:browser`. One worker, tracing off.
 *
 * Real-time profiling and manually stepped lifecycle checks are separate on
 * purpose. Frame numbers only come from real-time runs, using
 * window.__qa.perf; they are never derived from QA stepTicks().
 *
 * Hard assertions cover correctness and activity. Timing is written to
 * soak-results/ and only reported, except that realistic scenarios must keep
 * the simulation at real time, which is a behaviour check and not a speed
 * target: the clock drops time when frames exceed its 100 ms cap.
 */

const MIN_TICKS_PER_SECOND = 57;
const MIN_TICKS_PER_SECOND_AT_4X = 4 * MIN_TICKS_PER_SECOND;
const NIGHT_SECONDS = 60;
const LATE_NIGHT_TICK = 3500;
const LISTENERS_PER_DOM_ELEMENT = 3; // Phaser's DOMElement: sleep, wake and prerender
const PLANT = {col: 12, row: 8};
const CANNON_A = {col: 12, row: 6};
const CANNON_B = {col: 12, row: 10};

const cellCenter = (grid, {col, row}) => ({
    x: grid.originX + (col + 0.5) * grid.tileSize,
    y: grid.originY + (row + 0.5) * grid.tileSize,
});

function writeResult(name, result) {
    mkdirSync('soak-results', {recursive: true});
    writeFileSync(`soak-results/browser-${name}.json`, JSON.stringify({createdAt: new Date().toISOString(), ...result}, null, 2));
}

/** Fails the test on any page error or console error. */
function watchErrors(page) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    return errors;
}

async function start(page, query) {
    await boot(page, {scene: 'game', waitForQA: true, hq: false, query});
    await clickAction(page, 'start');
    await expect(body(page)).toHaveAttribute('data-phase', 'started');
    return sample(page);
}

async function place(page, state, type, cell) {
    const count = (await sample(page)).buildings.length;
    await clickAction(page, `build-${type}`);
    await clickWorld(page, cellCenter(state.grid, cell), state);
    await expect.poll(async () => (await sample(page)).buildings.length).toBe(count + 1);
    await clickAction(page, 'cancel-placement');
}

async function defendedBase(page, state) {
    await place(page, state, 'powerPlant', PLANT);
    await place(page, state, 'autocannon', CANNON_A);
    await place(page, state, 'autocannon', CANNON_B);
}

const rendererLabel = (name) => (/swiftshader|llvmpipe|software/i.test(name) ? 'software' : 'hardware');

async function beginRealTimeNight(page) {
    const renderer = await page.evaluate(() => window.__qa.perf.renderer());
    await clickAction(page, 'end-day');
    // Started after END DAY: the clock is paused until then, and that time is not ticks lost.
    await page.waitForFunction(() => window.__qa.getState().shiftCycle.shift === 'night');
    await page.evaluate(() => window.__qa.perf.start());
    return {renderer, rendering: rendererLabel(renderer)};
}

const stopProbe = (page) => page.evaluate(() => window.__qa.perf.stop());

/** Wait in real time, cheaply, until the night has nearly finished. */
async function waitForLateNight(page) {
    await page.waitForFunction(
        (tick) => window.__qa.getState().shiftCycle.elapsedNightTicks >= tick,
        LATE_NIGHT_TICK,
        {timeout: (NIGHT_SECONDS + 30) * 1000, polling: 1000},
    );
}

async function waitForDawn(page) {
    await page.waitForFunction(() => window.__qa.getState().shiftCycle.shift === 'day', null, {timeout: 30_000, polling: 250});
}

async function stepExactly(page, total) {
    return page.evaluate((n) => {
        let done = 0;
        while (done < n) {
            const ran = window.__qa.sim.stepTicks(Math.min(240, n - done));
            if (ran === 0) break;
            done += ran;
        }
        return done;
    }, total);
}

async function nightPaused(page) {
    await clickAction(page, 'end-day');
    await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('night');
    await page.evaluate(() => window.__qa.sim.pause());
}

test('real time: an idle night is the reference for instrumentation cost', async ({page}) => {
    const errors = watchErrors(page);
    const state = await start(page, 'mutants=off');
    await defendedBase(page, state);
    const label = await beginRealTimeNight(page);
    await page.waitForTimeout(6000);
    const perf = await stopProbe(page);
    writeResult('idle', {scenario: 'idle night, 0 mutants', ...label, workload: {mutants: 0, buildings: 3}, perf});
    expect(perf.ticksPerSecond).toBeGreaterThanOrEqual(MIN_TICKS_PER_SECOND);
    expect(errors).toEqual([]);
});

test('real time: a defended night at the cap of 40 scheduled mutants', async ({page}) => {
    const errors = watchErrors(page);
    const state = await start(page, 'waveBudget=40');
    await defendedBase(page, state);
    const label = await beginRealTimeNight(page);
    await waitForLateNight(page);
    const late = await sample(page);
    await waitForDawn(page);
    const perf = await stopProbe(page);
    const dawn = await sample(page);

    const killed = 40 - late.mutants.length;
    writeResult('defended-40', {
        scenario: 'defended, waveBudget=40, Plant + 2 Autocannons', ...label,
        workload: {scheduled: 40, killedByLateNight: killed, aliveLate: late.mutants.length, buildingsAtDawn: dawn.buildings.length},
        perf,
    });
    expect(late.waveProgress).toBe(40);
    expect(killed, 'turrets must actually kill').toBeGreaterThan(0);
    expect(dawn.mutants).toEqual([]);
    expect(perf.ticksPerSecond).toBeGreaterThanOrEqual(MIN_TICKS_PER_SECOND);
    expect(errors).toEqual([]);
});

test('real time: 40 mutants in the shortest approved spawn window', async ({page}) => {
    const errors = watchErrors(page);
    const state = await start(page, `waveBudget=40&waveLastTick=${WAVE.minLastTick}`);
    await defendedBase(page, state);
    const label = await beginRealTimeNight(page);

    await page.waitForFunction((tick) => window.__qa.getState().shiftCycle.elapsedNightTicks >= tick, WAVE.minLastTick, {polling: 100});
    const compressed = await sample(page);
    expect(compressed.wave.schedule).toEqual([...waveSchedule(40, WAVE.minLastTick)]);
    expect(new Set(compressed.wave.schedule).size).toBe(40);
    expect(compressed.wave.schedule.at(-1)).toBe(WAVE.minLastTick);
    expect(compressed.waveProgress).toBe(40);
    expect(compressed.mutantViews).toHaveLength(compressed.mutants.length);

    await waitForLateNight(page);
    const late = await sample(page);
    await waitForDawn(page);
    const perf = await stopProbe(page);
    const dawn = await sample(page);

    const killed = 40 - late.mutants.length;
    writeResult('compressed-40', {
        scenario: 'defended, 40 mutants ending on tick 1200, Plant + 2 Autocannons', ...label,
        workload: {scheduled: 40, aliveAtLastSpawn: compressed.mutants.length, killedByLateNight: killed, aliveLate: late.mutants.length, buildingsAtDawn: dawn.buildings.length},
        perf,
    });
    expect(compressed.mutants.length, 'the window must really overlap attackers').toBeGreaterThan(20);
    expect(killed, 'turrets must actually kill').toBeGreaterThan(0);
    expect(dawn.mutants).toEqual([]);
    expect(dawn.mutantViews).toEqual([]);
    expect(dawn.shiftCycle.day).toBe(2);
    expect(perf.ticksPerSecond).toBeGreaterThanOrEqual(MIN_TICKS_PER_SECOND);
    expect(errors).toEqual([]);
});

/** One complete real-time Night at 4x, from the first frames to dawn. */
async function nightAt4x(page, query, onCompressed = async () => {}) {
    const errors = watchErrors(page);
    const state = await start(page, query);
    await defendedBase(page, state);
    const label = await beginRealTimeNight(page);
    await clickAction(page, 'speed-4');
    await onCompressed();
    await page.waitForFunction(() => window.__qa.getState().shiftCycle.shift === 'day', null, {timeout: 30_000, polling: 50});
    const perf = await stopProbe(page);
    const dawn = await sample(page);

    expect(dawn.simulation.speed).toBe(4);
    expect(dawn.simulation.tick).toBe(3600);
    expect(dawn.simulation.stepsExecuted).toBe(3600);
    expect(dawn.settlement.day).toBe(1);
    expect(dawn.shiftCycle.day).toBe(2);
    expect(dawn.mutants).toEqual([]);
    expect(dawn.mutantViews).toEqual([]);
    expect(errors).toEqual([]);
    return {label, perf, dawn};
}

test('real time 4x: an ordinary Night takes about 15 seconds', async ({page}) => {
    const {label, perf, dawn} = await nightAt4x(page, 'waveBudget=4');
    writeResult('speed-4x-normal', {
        scenario: 'defended, waveBudget=4, 4x', ...label,
        workload: {scheduled: 4, buildingsAtDawn: dawn.buildings.length}, perf,
    });
    expect(perf.ticksPerSecond).toBeGreaterThanOrEqual(MIN_TICKS_PER_SECOND_AT_4X);
});

test('real time 4x: 40 mutants in the shortest approved spawn window', async ({page}) => {
    let compressed = null;
    const {label, perf, dawn} = await nightAt4x(page, `waveBudget=40&waveLastTick=${WAVE.minLastTick}`, async () => {
        await page.waitForFunction((tick) => window.__qa.getState().shiftCycle.elapsedNightTicks >= tick, WAVE.minLastTick, {polling: 50});
        compressed = await sample(page);
    });
    writeResult('speed-4x-compressed-40', {
        scenario: 'defended, 40 mutants ending on tick 1200, 4x', ...label,
        workload: {scheduled: 40, aliveNearLastSpawn: compressed.mutants.length, sampledAtTick: compressed.shiftCycle.elapsedNightTicks, buildingsAtDawn: dawn.buildings.length},
        perf,
    });
    expect(compressed.waveProgress).toBe(40);
    expect(compressed.mutants.length, 'the window must really overlap attackers').toBeGreaterThan(20);
    expect(perf.ticksPerSecond).toBeGreaterThanOrEqual(MIN_TICKS_PER_SECOND_AT_4X);
});

test('real time: a defended night of 20 scheduled mutants', async ({page}) => {
    const errors = watchErrors(page);
    const state = await start(page, 'waveBudget=20');
    await defendedBase(page, state);
    const label = await beginRealTimeNight(page);
    await waitForLateNight(page);
    const late = await sample(page);
    await waitForDawn(page);
    const perf = await stopProbe(page);
    const dawn = await sample(page);

    const killed = 20 - late.mutants.length;
    writeResult('defended-20', {
        scenario: 'defended, waveBudget=20, Plant + 2 Autocannons', ...label,
        workload: {scheduled: 20, killedByLateNight: killed, aliveLate: late.mutants.length, buildingsAtDawn: dawn.buildings.length}, perf,
    });
    expect(late.waveProgress).toBe(20);
    expect(killed, 'turrets must actually kill').toBeGreaterThan(0);
    expect(dawn.mutants).toEqual([]);
    expect(dawn.mutantViews).toEqual([]);
    expect(perf.ticksPerSecond).toBeGreaterThanOrEqual(MIN_TICKS_PER_SECOND);
    expect(errors).toEqual([]);
});

test('real time: an undefended night keeps all 20 mutants alive and destroys buildings', async ({page}) => {
    const errors = watchErrors(page);
    const state = await start(page, 'waveBudget=20');
    for (const cell of [{col: 12, row: 8}, {col: 6, row: 4}, {col: 18, row: 12}]) await place(page, state, 'outpost', cell);
    const label = await beginRealTimeNight(page);
    await waitForLateNight(page);
    const late = await sample(page);
    await waitForDawn(page);
    const perf = await stopProbe(page);
    const dawn = await sample(page);

    writeResult('undefended-20', {
        scenario: 'undefended, waveBudget=20, 3 Outposts', ...label,
        workload: {scheduled: 20, aliveLate: late.mutants.length, buildingsAtDawn: dawn.buildings.length}, perf,
    });
    expect(late.mutants).toHaveLength(20);
    expect(late.mutantViews).toHaveLength(20);
    expect(dawn.buildings.length, 'mutants must actually destroy buildings').toBeLessThan(3);
    expect(dawn.mutants).toEqual([]);
    expect(perf.ticksPerSecond).toBeGreaterThanOrEqual(MIN_TICKS_PER_SECOND);
    expect(errors).toEqual([]);
});

test('real time: scaling steps, stopping if a step falls behind', async ({page}) => {
    const errors = watchErrors(page);
    const steps = [[100, 15], [200, 15], [500, 15], [1000, 20]];
    const results = [];
    for (const [mutants, seconds] of steps) {
        const state = await start(page, `stressRamp=${mutants}`);
        await defendedBase(page, state);
        const label = await beginRealTimeNight(page);
        await page.waitForTimeout(seconds * 1000);
        const perf = await stopProbe(page);
        const after = await sample(page);
        const killed = mutants - after.mutants.length;
        results.push({mutants, seconds, ...label, alive: after.mutants.length, killed, tick: after.simulation.tick, perf});
        expect(after.simulation.tick, 'the ramp must have finished').toBeGreaterThanOrEqual(mutants);
        expect(killed, `turrets must fire at ${mutants}`).toBeGreaterThan(0);
        if (perf.ticksPerSecond < MIN_TICKS_PER_SECOND) break; // report it, and go no higher
    }
    writeResult('scaling', {scenario: 'synthetic stressRamp steps, Plant + 2 Autocannons', steps: results});
    expect(errors).toEqual([]);
});

test('stepped: 20 nights of destruction and rebuilding leave nothing behind', async ({page}) => {
    const errors = watchErrors(page);
    const GUARD = {col: 4, row: 6};
    const BAIT = {col: 20, row: 13};
    // No Factory: without roads it earns nothing, and the starting budget covers
    // the Plant, both turrets and one rebuild, which is all this leak check needs.
    const state = await start(page, 'waveBudget=4');
    await place(page, state, 'powerPlant', {col: 2, row: 2});

    let guardId = null;
    let baitId = null;
    let selectionCleared = 0;
    let turretsRebuilt = 0;
    let turretsDestroyed = 0;
    const seen = new Set();
    const dawns = [];

    for (let night = 1; night <= 20; night++) {
        let s = await sample(page);
        const exists = (id) => id !== null && s.buildings.some((b) => b.id === id);
        if (!exists(guardId) && s.resources.credits >= 250) {
            await place(page, state, 'autocannon', GUARD);
            s = await sample(page);
            guardId = s.buildings.at(-1).id;
        }
        if (!exists(baitId) && s.resources.credits >= 250) {
            await place(page, state, 'autocannon', BAIT);
            s = await sample(page);
            baitId = s.buildings.at(-1).id;
            if (seen.size > 0) turretsRebuilt++;
            await clickWorld(page, cellCenter(state.grid, BAIT), state);
            await expect.poll(async () => (await sample(page)).selectedBuilding).toBe(baitId);
            await clickAction(page, 'toggle-power');
            await expect(byAction(page, 'toggle-power')).toHaveAttribute('data-enabled', 'false');
        }
        for (const id of [guardId, baitId]) if (id) seen.add(id);
        const selected = (await sample(page)).selectedBuilding;

        await nightPaused(page);
        await stepExactly(page, 3600);
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('day');

        s = await sample(page);
        if (selected && !s.buildings.some((b) => b.id === selected)) {
            expect(s.selectedBuilding, 'a destroyed selection must clear').toBeNull();
            expect(s.ui.toggleVisible).toBe(false);
            selectionCleared++;
        }
        const counts = await page.evaluate(() => window.__qa.perf.counts());
        const cannons = s.buildings.filter((b) => b.type === 'autocannon');
        const proxiesExpected = 5 + (s.ui.toggleVisible ? 2 : 0); // 4 build buttons, END DAY, toggle and Demolish
        dawns.push({
            night, ...counts, buildings: s.buildings.length, cannons: cannons.length, barrels: s.barrelViews.length,
            hpBars: s.hpBarViews.length, tracers: s.tracerViews.length, buildingViews: s.buildingViews.length,
            staticObjects: counts.gameObjects - s.buildings.length - s.barrelViews.length - s.hpBarViews.length - s.tracerViews.length - counts.proxies,
            // The TEST_MODE toggle proxy comes and goes, so listeners are compared without proxies.
            ownSceneListeners: counts.sceneListeners - LISTENERS_PER_DOM_ELEMENT * counts.proxies,
        });

        expect(s.mutants, `night ${night}`).toEqual([]);
        expect(s.mutantViews).toEqual([]);
        expect(s.wave).toBeNull();
        expect(s.autocannons.map((t) => t.id)).toEqual(cannons.map((b) => b.id));
        expect(s.autocannons.every((t) => t.cooldown === 0 && t.targetId === null)).toBe(true);
        expect(s.barrelViews.map((v) => v.id)).toEqual(cannons.map((b) => b.id));
        const damaged = s.buildings.filter((b) => b.hp < getBuildingType(b.type).maxHp).map((b) => b.id);
        expect(s.hpBarViews.map((v) => v.id).sort()).toEqual(damaged.sort());
        expect(s.tracerViews.length).toBeLessThanOrEqual(cannons.length);
        expect(s.tracerViews.every((v) => !v.visible)).toBe(true);
        expect(s.buildingViews.map((v) => v.id).sort()).toEqual(s.buildings.map((b) => b.id).sort());
        expect(counts.proxies).toBe(proxiesExpected);
        expect(counts.tweens).toBe(0);
    }

    const last = await sample(page);
    turretsDestroyed = [...seen].filter((id) => !last.buildings.some((b) => b.id === id)).length;

    const flat = (key) => new Set(dawns.map((d) => d[key])).size;
    writeResult('lifecycle', {scenario: 'stepped, waveBudget=4, 20 nights, legal commands', turretsDestroyed, turretsRebuilt, selectionCleared, dawns});
    expect(flat('staticObjects'), 'scene objects must not accumulate').toBe(1);
    expect(flat('ownSceneListeners'), 'scene listeners must not accumulate').toBe(1);
    expect(flat('gameListeners'), 'game listeners must not accumulate').toBe(1);
    expect(flat('inputListeners'), 'input listeners must not accumulate').toBe(1);
    expect(turretsDestroyed, 'turrets must actually be destroyed').toBeGreaterThanOrEqual(2);
    expect(turretsRebuilt, 'turrets must actually be rebuilt').toBeGreaterThanOrEqual(1);
    expect(selectionCleared, 'a selected turret must be destroyed at least once').toBeGreaterThanOrEqual(1);
    expect(errors).toEqual([]);
});

test('stepped: Chromium and the Node harness reach identical state', async ({page}) => {
    const errors = watchErrors(page);
    const checkpoints = [700, 1500, 2500, 3599];

    const world = createWorld({schedule: [...waveSchedule(20)]});
    for (const [type, cell] of [['powerPlant', PLANT], ['autocannon', CANNON_A], ['autocannon', CANNON_B]]) {
        expect(world.place(type, cell.col, cell.row).ok).toBe(true);
    }
    world.cycle.endDay();
    const expected = [];
    for (const tick of checkpoints) {
        while (world.cycle.elapsedNightTicks < tick) world.cycle.stepTicks(Math.min(240, tick - world.cycle.elapsedNightTicks), world.tick);
        expect(world.cycle.shift).toBe(Shift.NIGHT);
        expected.push(digestOf(canonicalState(worldState(world))));
    }

    const state = await start(page, 'waveBudget=20');
    await defendedBase(page, state);
    await nightPaused(page);
    const actual = [];
    for (const tick of checkpoints) {
        await stepExactly(page, tick - (await sample(page)).shiftCycle.elapsedNightTicks);
        const s = await sample(page);
        actual.push(digestOf(canonicalState({mutants: s.mutants, buildings: s.buildings, autocannons: s.autocannons, rng: s.simulation.rng, shells: s.shells})));
    }
    writeResult('cross-check', {scenario: 'Node harness against Chromium', checkpoints, expected, actual});
    expect(actual).toEqual(expected);
    expect(new Set(actual).size).toBe(checkpoints.length);
    expect(errors).toEqual([]);
});

test('stepped: with soldiers on the map, Chromium and the Node harness reach identical state', async ({page}) => {
    const errors = watchErrors(page);
    const checkpoints = [100, 700, 1500, 2500, 3599];

    const world = createWorld({schedule: [...waveSchedule(20)], requireHq: true, roads: true});
    expect(loadLayout(world, INFANTRY_FIXTURE).ok).toBe(true);
    world.cycle.endDay();
    const expected = [];
    for (const tick of checkpoints) {
        while (world.cycle.elapsedNightTicks < tick) world.cycle.stepTicks(Math.min(240, tick - world.cycle.elapsedNightTicks), world.tick);
        expect(world.cycle.shift).toBe(Shift.NIGHT);
        expected.push(digestOf(canonicalState(worldState(world))));
    }

    await loadedBase(page, 'waveBudget=20', INFANTRY_FIXTURE);
    await nightPaused(page);
    const actual = [];
    for (const tick of checkpoints) {
        await stepExactly(page, tick - (await sample(page)).shiftCycle.elapsedNightTicks);
        const s = await sample(page);
        expect(s.infantry.soldiers.length).toBeGreaterThan(0);
        actual.push(digestOf(canonicalState({
            mutants: s.mutants, buildings: s.buildings, autocannons: s.autocannons, rng: s.simulation.rng, soldiers: s.infantry.soldiers, shells: s.shells,
        })));
    }
    writeResult('infantry-cross-check', {scenario: 'Node harness against Chromium, with soldiers', checkpoints, expected, actual});
    expect(actual).toEqual(expected);
    expect(new Set(actual).size).toBe(checkpoints.length);
    expect(errors).toEqual([]);
});

test('stepped: with Spitters and shells in the air, Chromium and the Node harness reach identical state', async ({page}) => {
    const errors = watchErrors(page);
    const checkpoints = [700, 1000, 1500, 2100, 2800, 3599];
    const schedule = [...waveSchedule(20)];
    const spitterSlots = [...spitterSlotsOf(20, 6)];

    const world = createWorld({schedule, spitterSlots, requireHq: true, roads: true});
    expect(loadLayout(world, INFANTRY_FIXTURE).ok).toBe(true);
    world.cycle.endDay();
    const expected = [];
    for (const tick of checkpoints) {
        while (world.cycle.elapsedNightTicks < tick) world.cycle.stepTicks(Math.min(240, tick - world.cycle.elapsedNightTicks), world.tick);
        expect(world.cycle.shift).toBe(Shift.NIGHT);
        expected.push(digestOf(canonicalState(worldState(world))));
    }

    await loadedBase(page, 'waveBudget=20&waveSpitters=6', INFANTRY_FIXTURE);
    await nightPaused(page);
    const actual = [];
    let sawSpitter = false;
    for (const tick of checkpoints) {
        await stepExactly(page, tick - (await sample(page)).shiftCycle.elapsedNightTicks);
        const s = await sample(page);
        sawSpitter ||= s.mutants.some(({kind}) => kind === 'spitter');
        actual.push(digestOf(canonicalState({
            mutants: s.mutants, buildings: s.buildings, autocannons: s.autocannons, rng: s.simulation.rng, soldiers: s.infantry.soldiers, shells: s.shells,
        })));
    }
    writeResult('spitter-cross-check', {scenario: 'Node harness against Chromium, with Spitters', checkpoints, expected, actual});
    expect(sawSpitter).toBe(true);
    expect(actual).toEqual(expected);
    expect(errors).toEqual([]);
});

test('stepped: with Brutes on the map, Chromium and the Node harness reach identical state', async ({page}) => {
    const errors = watchErrors(page);
    const checkpoints = [700, 1000, 1500, 2100, 2800, 3599];
    const schedule = [...waveSchedule(20)];
    const spitterSlots = [...spitterSlotsOf(20, 3)];
    const {bruteSlots, absorbedSlots} = bruteSlotsOf(20, spitterSlots, 2);

    const world = createWorld({schedule, spitterSlots, bruteSlots: [...bruteSlots], absorbedSlots: [...absorbedSlots], requireHq: true, roads: true});
    expect(loadLayout(world, INFANTRY_FIXTURE).ok).toBe(true);
    world.cycle.endDay();
    const expected = [];
    for (const tick of checkpoints) {
        while (world.cycle.elapsedNightTicks < tick) world.cycle.stepTicks(Math.min(240, tick - world.cycle.elapsedNightTicks), world.tick);
        expect(world.cycle.shift).toBe(Shift.NIGHT);
        expected.push(digestOf(canonicalState(worldState(world))));
    }

    await loadedBase(page, 'waveBudget=20&waveSpitters=3&waveBrutes=2', INFANTRY_FIXTURE);
    await nightPaused(page);
    const actual = [];
    let sawBrute = false;
    for (const tick of checkpoints) {
        await stepExactly(page, tick - (await sample(page)).shiftCycle.elapsedNightTicks);
        const s = await sample(page);
        sawBrute ||= s.mutants.some(({kind}) => kind === 'brute');
        actual.push(digestOf(canonicalState({
            mutants: s.mutants, buildings: s.buildings, autocannons: s.autocannons, rng: s.simulation.rng, soldiers: s.infantry.soldiers, shells: s.shells,
        })));
    }
    writeResult('brute-cross-check', {scenario: 'Node harness against Chromium, with Brutes', checkpoints, expected, actual});
    expect(sawBrute).toBe(true);
    expect(actual).toEqual(expected);
    expect(errors).toEqual([]);
});

test('stepped: with Siege Cannons and rockets, Chromium and the Node harness reach identical state', async ({page}) => {
    const errors = watchErrors(page);
    const checkpoints = [700, 1000, 1500, 2100, 2800, 3599];
    const schedule = [...waveSchedule(20)];
    const spitterSlots = [...spitterSlotsOf(20, 3)];
    const {bruteSlots, absorbedSlots} = bruteSlotsOf(20, spitterSlots, 2);

    const world = createWorld({schedule, spitterSlots, bruteSlots: [...bruteSlots], absorbedSlots: [...absorbedSlots], requireHq: true, roads: true});
    expect(loadLayout(world, HEAVY_FIXTURE).ok).toBe(true);
    world.cycle.endDay();
    const expected = [];
    for (const tick of checkpoints) {
        while (world.cycle.elapsedNightTicks < tick) world.cycle.stepTicks(Math.min(240, tick - world.cycle.elapsedNightTicks), world.tick);
        expected.push(digestOf(canonicalState(worldState(world))));
    }

    await loadedBase(page, 'waveBudget=20&waveSpitters=3&waveBrutes=2', HEAVY_FIXTURE);
    await nightPaused(page);
    const actual = [];
    for (const tick of checkpoints) {
        await stepExactly(page, tick - (await sample(page)).shiftCycle.elapsedNightTicks);
        const s = await sample(page);
        actual.push(digestOf(canonicalState({
            mutants: s.mutants, buildings: s.buildings, autocannons: s.autocannons, rng: s.simulation.rng, soldiers: s.infantry.soldiers, shells: s.shells,
            siegeCannons: s.siegeCannons, siegeShells: s.siegeShells, rockets: s.rockets,
        })));
    }
    writeResult('heavy-cross-check', {scenario: 'Node harness against Chromium, with Siege Cannons and rockets', checkpoints, expected, actual});
    expect(actual).toEqual(expected);
    expect(errors).toEqual([]);
});

const HEAVY_FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/layouts/golden-fortress-brute-defense-v3.json', import.meta.url), 'utf8'));
const LOGISTICS_FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/layouts/logistics-reference.json', import.meta.url), 'utf8'));
const FORTIFICATION = JSON.parse(readFileSync(new URL('../fixtures/layouts/fortification-reference.json', import.meta.url), 'utf8'));
const INFANTRY_FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/layouts/infantry-reference.json', import.meta.url), 'utf8'));

async function loadedBase(page, query, layout = LOGISTICS_FIXTURE) {
    await boot(page, {scene: 'game', waitForQA: true, query});
    await clickAction(page, 'start');
    await expect(body(page)).toHaveAttribute('data-phase', 'started');
    const result = await page.evaluate((s) => window.__qa.layout.load(s), layout);
    expect(result.ok).toBe(true);
}

test('real time 4x: trucks on the road during the heaviest approved wave', async ({page}) => {
    const errors = watchErrors(page);
    await loadedBase(page, `waveBudget=40&waveLastTick=${WAVE.minLastTick}`);
    const label = await beginRealTimeNight(page);
    await clickAction(page, 'speed-4');
    await page.waitForFunction(() => window.__qa.getState().shiftCycle.shift === 'day', null, {timeout: 30_000, polling: 50});
    const perf = await stopProbe(page);
    const dawn = await sample(page);
    writeResult('speed-4x-logistics', {
        scenario: 'logistics fixture, 2 trucks, 40 mutants ending on tick 1200, 4x', ...label,
        workload: {trucks: dawn.logistics.trucks.length, lastNight: dawn.logistics.lastNight}, perf,
    });
    expect(dawn.simulation.tick).toBe(3600);
    expect(dawn.logistics.lastNight.loads).toBeGreaterThan(0);
    expect(perf.ticksPerSecond).toBeGreaterThanOrEqual(MIN_TICKS_PER_SECOND_AT_4X);
    expect(errors).toEqual([]);
});

test('real time 4x: the heaviest approved wave against about 200 walls', async ({page}) => {
    const errors = watchErrors(page);
    await loadedBase(page, `waveBudget=40&waveLastTick=${WAVE.minLastTick}`, FORTIFICATION);
    const walls = (await sample(page)).buildings.filter((b) => b.type === 'wall').length;
    const label = await beginRealTimeNight(page);
    await clickAction(page, 'speed-4');
    await page.waitForFunction(() => window.__qa.getState().shiftCycle.shift === 'day', null, {timeout: 30_000, polling: 50});
    const perf = await stopProbe(page);
    const dawn = await sample(page);
    writeResult('speed-4x-walls', {
        scenario: 'fortification fixture, 40 mutants ending on tick 1200, 4x', ...label,
        workload: {walls, wallsAtDawn: dawn.buildings.filter((b) => b.type === 'wall').length, lastNight: dawn.logistics.lastNight}, perf,
    });
    expect(walls).toBeGreaterThan(150);
    expect(dawn.simulation.tick).toBe(3600);
    expect(perf.ticksPerSecond).toBeGreaterThanOrEqual(MIN_TICKS_PER_SECOND_AT_4X);
    expect(errors).toEqual([]);
});

test('stepped: trucks, storage pips and repeated restarts leave nothing behind', async ({page}) => {
    const errors = watchErrors(page);
    const flow = hqFlow({pressWorld: clickWorld, pressAction: clickAction});
    const counts = () => page.evaluate(() => window.__qa.perf.counts());
    const loaded = [];
    const titles = [];
    // No cannons, so the base really falls and each run reaches a restart.
    const undefended = {...LOGISTICS_FIXTURE, buildings: LOGISTICS_FIXTURE.buildings.filter((b) => b.type !== 'autocannon')};
    await loadedBase(page, 'waveBudget=20', undefended);
    for (let run = 0; run < 4; run++) {
        if (run > 0) {
            await clickAction(page, 'start');
            await expect(body(page)).toHaveAttribute('data-phase', 'started');
            expect((await page.evaluate((s) => window.__qa.layout.load(s), undefended)).ok).toBe(true);
        }
        await page.waitForTimeout(100); // the first frame draws the trucks
        loaded.push(await counts());
        expect((await sample(page)).truckViews.trucks).toHaveLength(2);
        await flow.stepToDefeat(page, 8);
        await clickAction(page, 'restart');
        await page.waitForFunction(() => window.__qa?.getState().phase === 'ready');
        await page.waitForTimeout(100);
        titles.push(await counts());
    }
    writeResult('logistics-restart', {scenario: 'stepped, logistics fixture without cannons, 4 runs to defeat', loaded, titles});
    for (const count of loaded) expect(count).toEqual(loaded[0]);
    for (const count of titles) expect(count).toEqual(titles[0]);
    expect(errors).toEqual([]);
});

test('stepped: repeated defeat and restart on the real HQ-first flow leave nothing behind', async ({page}) => {
    const errors = watchErrors(page);
    const flow = hqFlow({pressWorld: clickWorld, pressAction: clickAction});
    const counts = () => page.evaluate(() => window.__qa.perf.counts());
    const titles = [];
    const days = [];

    await boot(page, {scene: 'game', waitForQA: true, query: 'waveBudget=20'});
    titles.push(await counts(page));
    for (let run = 0; run < 6; run++) {
        await clickAction(page, 'start');
        await expect(body(page)).toHaveAttribute('data-phase', 'started');
        const state = await sample(page);
        await flow.buildHq(page, state, PLANT);
        await flow.place(page, state, 'autocannon', {col: 12, row: 5}); // just outside the HQ ring
        days.push(await counts(page));

        await flow.stepToDefeat(page, 6);
        const defeated = await sample(page);
        expect(defeated.phase).toBe('defeated');
        expect(defeated.buildings.some((b) => b.type === 'hq')).toBe(false);

        await clickAction(page, 'restart');
        await page.waitForFunction(() => window.__qa?.getState().phase === 'ready');
        await page.waitForTimeout(100);
        titles.push(await counts(page));
    }
    writeResult('defeat-restart', {scenario: 'stepped, waveBudget=20, 6 defeat and restart cycles, real flow', titles, days});
    for (const count of titles) expect(count).toEqual(titles[0]);
    for (const count of days) expect(count).toEqual(days[0]);
    expect(errors).toEqual([]);
});

test('source: the game uses no Phaser timers, tweens or wall-clock timers', () => {
    for (const file of readdirSync('src/scenes')) {
        const source = readFileSync(`src/scenes/${file}`, 'utf8');
        expect(source, file).not.toMatch(/this\.time\.|scene\.time\.|\.tweens\.|setTimeout|setInterval/);
    }
});
