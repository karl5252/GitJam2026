/**
 * Headless combat soak. Run with `npm run test:soak`; add `-- --quick` for a
 * short subset. Writes soak-results/domain.json and exits non-zero on any hard
 * failure.
 *
 * Hard failures: invariants, determinism, combat activity, dawn cleanup and
 * accounting. Timing is REPORT ONLY and never fails the run.
 *
 * Two workload classes, labelled in the report:
 *   synthetic - test-only spawn schedules, resources and mid-night rebuilding
 *               through the real placeAt(). Not evidence about normal rules.
 *   legal     - the real planner, starting resources, construction gate and
 *               settlement, using only commands a player can issue.
 */
import {execSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {cpus} from 'node:os';
import {PerformanceObserver} from 'node:perf_hooks';
import {canonicalState, checkInvariants, createWorld, digestOf, percentiles, worldState} from './harness.js';
import {calculatePower} from '../../src/core/power.js';
import {distanceToFootprint} from '../../src/core/mutants.js';
import {Shift} from '../../src/core/shiftCycle.js';

const QUICK = process.argv.includes('--quick');
const SCENARIO_WALL_LIMIT_MS = 90_000;
const CHECK_EVERY_TICKS = 30;
const DIGEST_EVERY_TICKS = 60;
const CHUNK_TICKS = 60;
const SYNTHETIC_RESOURCES = {credits: 1_000_000_000, ap: 1_000_000};

let gcCount = 0;
let gcMs = 0;
new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
        gcCount++;
        gcMs += entry.duration;
    }
}).observe({entryTypes: ['gc']});

const yieldToLoop = () => new Promise((resolve) => { setImmediate(resolve); });

/** Plants and cannons near the centre, Outposts exposed around the edge. */
function syntheticLayout({cannons, plants}) {
    const layout = [];
    for (let i = 0; i < plants; i++) layout.push({type: 'powerPlant', col: 4 + (i % 4) * 5, row: i < 4 ? 8 : 3});
    for (let i = 0; i < cannons; i++) layout.push({type: 'autocannon', col: 2 + (i % 20), row: i < 20 ? 6 : 11});
    for (const [col, row] of [[1, 1], [11, 1], [22, 1], [1, 14], [11, 14], [22, 14]]) layout.push({type: 'outpost', col, row});
    return layout.map((slot) => ({...slot, id: null}));
}

/** Synthetic reinforcement: rebuild what is missing, unless a mutant stands there. */
function reinforce(world, slots) {
    const standing = new Set(world.placement.buildings().map((b) => b.id));
    const mutants = world.mutants.snapshot();
    let rebuilt = 0;
    for (const slot of slots) {
        if (slot.id && standing.has(slot.id)) continue;
        world.placement.select(slot.type);
        const preview = world.placement.preview({col: slot.col, row: slot.row});
        const rect = preview.ok ? world.grid.footprintRect(preview.footprint) : null;
        const free = rect && !mutants.some((mutant) => distanceToFootprint(mutant, rect) === 0);
        if (free) {
            slot.id = world.placement.placeAt({col: slot.col, row: slot.row}).building.id;
            rebuilt++;
        }
        world.placement.cancel();
    }
    return rebuilt;
}

/** Legal command script: Plant + Factory, then cannons, Plants and Factories as affordable. */
function legalSteady(world, cells, night) {
    const count = (type) => world.placement.buildings().filter((b) => b.type === type).length;
    const build = (type, list) => {
        while (cells[list].length) {
            const [col, row] = cells[list].shift();
            const result = world.place(type, col, row);
            if (result.ok) return true;
            if (result.reason !== 'occupied') {
                cells[list].unshift([col, row]);
                return false;
            }
        }
        return false;
    };
    if (night === 1) {
        build('powerPlant', 'plants');
        build('factory', 'factories');
        return;
    }
    for (let i = 0; i < 5; i++) {
        const {generation, demand} = calculatePower(world.placement.buildings());
        const spare = generation - demand;
        const credits = world.economy.credits;
        if (count('powerPlant') === 0 && credits >= 500) { if (build('powerPlant', 'plants')) continue; break; }
        if (spare >= 20 && credits >= 250 && count('autocannon') < 2 + Math.floor(night / 3)) { if (build('autocannon', 'cannons')) continue; break; }
        if (spare < 20 && credits >= 500) { if (build('powerPlant', 'plants')) continue; break; }
        if (spare >= 40 && credits >= 400 && count('factory') < count('autocannon')) { if (build('factory', 'factories')) continue; break; }
        break;
    }
}

const legalCells = () => ({
    plants: [[12, 8], [12, 4], [12, 12]],
    factories: [[8, 8], [16, 8], [8, 4], [16, 4], [8, 12], [16, 12]],
    cannons: [[10, 6], [14, 6], [10, 10], [14, 10], [10, 8], [14, 8], [12, 6], [12, 10], [6, 6], [18, 6], [6, 10], [18, 10]],
});

function legalDay(strategy) {
    const cells = legalCells();
    return (world, night) => {
        if (strategy === 'steady') legalSteady(world, cells, night);
        else if (night === 1) {
            world.place('powerPlant', 12, 8);
            world.place('factory', 8, 8);
        }
    };
}

const synthetic = (name, mutants, cannons, plants, extra = {}) => ({
    name, workload: 'synthetic', gate: true, mutants, cannons, plants, nights: 1, ...extra,
});

const SCENARIOS = [
    synthetic('synthetic-20-mutants', 20, 4, 2, {expect: ['shots', 'kills', 'attacks', 'destroyed']}),
    synthetic('synthetic-100-mutants', 100, 12, 3, {expect: ['shots', 'kills', 'attacks', 'destroyed']}),
    synthetic('synthetic-500-mutants', 500, 12, 3, {expect: ['shots', 'kills', 'attacks', 'destroyed']}),
    synthetic('synthetic-500-many-turrets', 500, 36, 8, {expect: ['shots', 'kills', 'attacks', 'destroyed']}),
    synthetic('synthetic-2000-mutants', 2000, 12, 3, {extreme: true, expect: ['shots', 'kills', 'attacks', 'destroyed']}),
    synthetic('synthetic-2000-many-turrets', 2000, 36, 8, {extreme: true, expect: ['shots', 'kills', 'attacks', 'destroyed']}),
    synthetic('synthetic-20-mutants-20-nights', 20, 4, 2, {nights: 20, expect: ['shots', 'kills', 'attacks', 'destroyed']}),
    // Scripted openings split into two groups. On seed 98 the base survives all 20
    // nights and fights; on seed 1 its Plant falls early and it collapses. Seed 731
    // is also in the fragile group, so neither scenario uses the default seed.
    {name: 'legal-survives-20-nights', workload: 'legal', nights: 20, strategy: 'steady', seed: 98, expect: ['shots', 'kills', 'attacks'], atLeast: {shots: 500, kills: 100}},
    {name: 'legal-collapses-20-nights', workload: 'legal', nights: 20, strategy: 'steady', seed: 1, expect: ['attacks', 'destroyed']},
    {name: 'legal-no-defense-20-nights', workload: 'legal', nights: 20, strategy: 'none', expect: ['attacks', 'destroyed']},
];

/** Uneven frames, for comparing real-frame driving with manual stepping. */
function* frameDeltas() {
    for (let i = 0; ; i++) yield i % 3 ? 7 : 90;
}

async function runScenario(scenario, {seed, driver}) {
    const started = performance.now();
    const isSynthetic = scenario.workload === 'synthetic';
    const world = createWorld({
        seed,
        schedule: isSynthetic ? Array.from({length: scenario.mutants}, (_, i) => i + 1) : null,
        resources: isSynthetic ? SYNTHETIC_RESOURCES : undefined,
        openConstruction: isSynthetic,
    });
    const slots = isSynthetic ? syntheticLayout(scenario) : null;
    const planDay = isSynthetic ? null : legalDay(scenario.strategy); // fresh command script per run
    const digest = [];
    const problems = [];
    const tally = {spawned: 0, kills: 0, shots: 0, attacks: 0, destroyed: 0, clearedAtDawn: 0, rebuilt: 0, peakAlive: 0, nights: 0};
    const killed = new Set();
    const lost = new Set();
    const phases = {ramp: [], loaded: []};
    const costs = {turrets: 0, mutants: 0, ticks: 0};
    let startingPower = null;
    let aliveBefore = 0;
    const deltas = frameDeltas();
    const gc0 = {count: gcCount, ms: gcMs};
    if (globalThis.gc) globalThis.gc();
    let allocatedBytes = 0;
    let heapMark = process.memoryUsage().heapUsed;

    const onTick = (tickNumber) => {
        const a = performance.now();
        world.cycle.onTick(tickNumber);
        const b = performance.now();
        const defense = world.autocannons.step();
        const c = performance.now();
        const effects = world.mutants.step();
        const d = performance.now();

        const alive = world.mutants.snapshot().length;
        const load = isSynthetic && alive >= scenario.mutants * 0.5 ? 'loaded' : 'ramp';
        phases[load].push(d - a);
        costs.turrets += c - b;
        costs.mutants += d - c;
        costs.ticks++;

        tally.shots += defense.shots.length;
        for (const shot of defense.shots) {
            if (killed.has(shot.mutantId)) problems.push(`${shot.mutantId} was shot after dying`);
            if (shot.killed) { killed.add(shot.mutantId); tally.kills++; }
        }
        tally.attacks += effects.attacks.length;
        for (const attack of effects.attacks) {
            if (lost.has(attack.buildingId)) problems.push(`${attack.buildingId} was hit after being destroyed`);
        }
        for (const id of effects.destroyed) {
            if (lost.has(id)) problems.push(`${id} was destroyed twice`);
            lost.add(id);
            tally.destroyed++;
        }
        tally.spawned += effects.spawned.length;
        tally.peakAlive = Math.max(tally.peakAlive, alive);

        if (world.cycle.shift === Shift.NIGHT) {
            aliveBefore = alive;
            if (isSynthetic) tally.rebuilt += reinforce(world, slots);
            const elapsed = world.cycle.elapsedNightTicks;
            if (elapsed % CHECK_EVERY_TICKS === 0) problems.push(...checkInvariants(world));
            if (elapsed % DIGEST_EVERY_TICKS === 0) digest.push(digestOf(canonicalState(worldState(world))));
        } else {
            tally.clearedAtDawn += aliveBefore;
            aliveBefore = 0;
        }
    };

    for (let night = 1; night <= scenario.nights; night++) {
        if (isSynthetic) {
            if (night === 1) reinforce(world, slots);
        } else {
            planDay(world, night);
        }
        if (isSynthetic && night === 1) startingPower = calculatePower(world.placement.buildings()).status;
        world.cycle.endDay();
        while (world.cycle.shift === Shift.NIGHT) {
            if (performance.now() - started > SCENARIO_WALL_LIMIT_MS) throw new Error(`${scenario.name} exceeded its wall limit`);
            if (driver === 'frames') for (let i = 0; i < CHUNK_TICKS && world.cycle.shift === Shift.NIGHT; i++) world.clock.advance(deltas.next().value, onTick);
            else world.cycle.stepTicks(CHUNK_TICKS, onTick);
            const heap = process.memoryUsage().heapUsed;
            if (heap > heapMark) allocatedBytes += heap - heapMark;
            heapMark = heap;
            await yieldToLoop(); // lets GC observer entries arrive
        }
        tally.nights++;
        if (world.mutants.snapshot().length !== 0) problems.push(`mutants survived dawn ${night}`);
        if (world.mutants.plan() !== null) problems.push(`plan survived dawn ${night}`);
        if (world.autocannons.snapshot().some((t) => t.cooldown !== 0 || t.targetId !== null)) problems.push(`turret state survived dawn ${night}`);
        problems.push(...checkInvariants(world));
        digest.push(digestOf(canonicalState(worldState(world))));
    }

    if (tally.spawned !== tally.kills + tally.clearedAtDawn) {
        problems.push(`accounting: ${tally.spawned} spawned, ${tally.kills} killed, ${tally.clearedAtDawn} cleared at dawn`);
    }
    if (isSynthetic && startingPower !== 'normal') problems.push(`starting power was ${startingPower}`);
    for (const key of scenario.expect) {
        if (tally[key] === 0) problems.push(`no combat activity: ${key} was 0`);
    }
    for (const [key, minimum] of Object.entries(scenario.atLeast ?? {})) {
        if (tally[key] < minimum) problems.push(`too little combat: ${key} was ${tally[key]}, expected at least ${minimum}`);
    }

    await yieldToLoop();
    const total = phases.ramp.concat(phases.loaded);
    return {
        digest: digestOf(digest.join()),
        problems: [...new Set(problems)],
        tally,
        startingPower,
        timing: {
            reportOnly: true,
            wallSeconds: Math.round(performance.now() - started) / 1000,
            allTicksMs: percentiles(total),
            loadedTicksMs: percentiles(phases.loaded),
            turretMsPerTick: Math.round(costs.turrets / costs.ticks * 1000) / 1000,
            mutantMsPerTick: Math.round(costs.mutants / costs.ticks * 1000) / 1000,
            approxAllocatedBytesPerTick: Math.round(allocatedBytes / costs.ticks),
            gcEvents: gcCount - gc0.count,
            gcMs: Math.round((gcMs - gc0.ms) * 10) / 10,
        },
    };
}

function gitCommit() {
    try {
        return execSync('git rev-parse --short HEAD', {encoding: 'utf8'}).trim();
    } catch {
        return 'unknown';
    }
}

const repeats = QUICK ? 2 : 3;
const scenarios = SCENARIOS.filter((s) => !(QUICK && s.extreme));
const failures = [];
const results = [];
for (const scenario of scenarios) {
    const baseSeed = scenario.seed ?? 731;
    const runs = [];
    for (let i = 0; i < repeats; i++) runs.push(await runScenario(scenario, {seed: baseSeed, driver: 'steps'}));
    const framesRun = await runScenario(scenario, {seed: baseSeed, driver: 'frames'});
    const otherSeed = await runScenario({...scenario, expect: [], atLeast: {}}, {seed: baseSeed + 1, driver: 'steps'});

    const problems = runs.concat(framesRun, otherSeed).flatMap((run) => run.problems);
    if (new Set(runs.map((run) => run.digest)).size !== 1) problems.push('same seed gave different digests');
    if (framesRun.digest !== runs[0].digest) problems.push('real frames and stepping gave different digests');
    if (otherSeed.digest === runs[0].digest) problems.push('a different seed gave the same digest');

    const [run] = runs;
    const row = {
        name: scenario.name, workload: scenario.workload, mutants: scenario.mutants ?? 'planner', cannons: scenario.cannons ?? 'scripted',
        plants: scenario.plants ?? 'scripted', nights: scenario.nights, digest: run.digest, tally: run.tally, startingPower: run.startingPower,
        timing: run.timing, problems: [...new Set(problems)],
    };
    results.push(row);
    if (row.problems.length) failures.push(...row.problems.map((p) => `${scenario.name}: ${p}`));
    const t = run.timing;
    console.log(`${row.problems.length ? 'FAIL' : 'ok  '} ${scenario.name.padEnd(32)} spawned ${String(run.tally.spawned).padStart(5)} shots ${String(run.tally.shots).padStart(5)} kills ${String(run.tally.kills).padStart(4)} attacks ${String(run.tally.attacks).padStart(6)} destroyed ${String(run.tally.destroyed).padStart(4)} | tick p50/p95/p99/max ${t.allTicksMs.p50}/${t.allTicksMs.p95}/${t.allTicksMs.p99}/${t.allTicksMs.max} ms`);
}

mkdirSync('soak-results', {recursive: true});
writeFileSync('soak-results/domain.json', JSON.stringify({
    createdAt: new Date().toISOString(),
    commit: gitCommit(),
    quick: QUICK,
    node: process.version,
    cpu: cpus()[0]?.model ?? 'unknown',
    results,
}, null, 2));

console.log(`\n${results.length} scenarios, ${failures.length} hard failures. Timing is report-only. See soak-results/domain.json`);
for (const failure of failures.slice(0, 40)) console.log(`  ${failure}`);
process.exit(failures.length ? 1 : 0);
