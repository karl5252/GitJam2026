import {test, expect} from '@playwright/test';
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {boot, body, byAction, clickAction, clickWorld} from '../helpers/canvas.js';
import {hqFlow} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';
import {getBuildingType} from '../../src/core/buildingTypes.js';
import {waveSchedule} from '../../src/core/waves.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {canonicalState, createWorld, digestOf, worldState} from './harness.js';

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
    const state = await start(page, 'waveBudget=4');
    await place(page, state, 'powerPlant', {col: 2, row: 2});
    await place(page, state, 'factory', {col: 6, row: 2});

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
        const proxiesExpected = 5 + (s.ui.toggleVisible ? 1 : 0); // 4 build buttons, END DAY, toggle
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
        actual.push(digestOf(canonicalState({mutants: s.mutants, buildings: s.buildings, autocannons: s.autocannons, rng: s.simulation.rng})));
    }
    writeResult('cross-check', {scenario: 'Node harness against Chromium', checkpoints, expected, actual});
    expect(actual).toEqual(expected);
    expect(new Set(actual).size).toBe(checkpoints.length);
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
        await flow.place(page, state, 'autocannon', CANNON_A);
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
