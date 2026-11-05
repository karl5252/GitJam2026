/**
 * Fortification soak. Run with `npm run test:soak:fortification`. Writes
 * soak-results/fortification.json and exits non-zero on a hard failure.
 *
 * A base inside about 200 walls under the heaviest approved wave, compared with
 * the same base without walls, to show what walls cost per tick at 4x. Then
 * enclosed bases under the real planner, to show they fall.
 *
 * Hard failures: broken invariants, a run that does not repeat exactly, or a
 * walled base where no barrier was damaged. Timing and survival are REPORT ONLY.
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {percentiles, checkInvariants, canonicalState, createWorld, digestOf, worldState} from './harness.js';
import {getBuildingType} from '../../src/core/buildingTypes.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {WAVE, waveSchedule} from '../../src/core/waves.js';
import {loadLayout} from '../../src/testShadow/layoutSnapshot.js';

const SEEDS = [731, 98, 1];
const RESOURCES = {credits: 100_000, ap: 200};
const TICKS_PER_FRAME_AT_4X = 24;
const MAX_NIGHTS = 40;
const FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/layouts/fortification-reference.json', import.meta.url), 'utf8'));
const fortified = (building) => getBuildingType(building.type).fortification === true;
const withoutWalls = {...FIXTURE, buildings: FIXTURE.buildings.filter((b) => b.type !== 'wall')};
/** One wall in nine gone: the search runs all the time, because gaps exist. */
const withGaps = {...FIXTURE, buildings: FIXTURE.buildings.filter((b, i) => b.type !== 'wall' || i % 9 !== 0)};

function load(layout, options) {
    const world = createWorld({resources: RESOURCES, requireHq: true, roads: true, ...options});
    const result = loadLayout(world, layout);
    if (!result.ok) throw new Error(`layout: ${result.reason} ${result.detail ?? ''}`);
    return world;
}

function heavyNight(name, layout, seed) {
    const schedule = [...waveSchedule(40, WAVE.minLastTick)];
    const world = load(layout, {seed, schedule});
    const tickMs = [];
    const problems = [];
    const tally = {attacks: 0, barrierDamage: 0, destroyed: 0};
    const barriers = new Set(world.placement.buildings().filter(fortified).map((b) => b.id));
    const started = performance.now();
    world.cycle.endDay();
    while (world.cycle.shift === Shift.NIGHT) {
        const before = performance.now();
        let effects = null;
        world.cycle.stepTicks(1, (tick) => { effects = world.tick(tick).effects; });
        tickMs.push(performance.now() - before);
        tally.attacks += effects.attacks.length;
        tally.destroyed += effects.destroyed.length;
        for (const {buildingId, damage} of effects.attacks) if (barriers.has(buildingId)) tally.barrierDamage += damage;
        if (world.cycle.elapsedNightTicks % 60 === 0) problems.push(...checkInvariants(world));
    }
    const timing = percentiles(tickMs);
    const digest = digestOf(canonicalState({...worldState(world), gates: world.gates.snapshot()}));
    return {
        name, seed, walls: barriers.size, digest, tally, problems, wallSeconds: (performance.now() - started) / 1000,
        tickMs: timing, worstFrameAt4xMs: Math.round(timing.p99 * TICKS_PER_FRAME_AT_4X * 100) / 100,
    };
}

function untilDefeat(seed) {
    const layout = {...FIXTURE, buildings: FIXTURE.buildings.filter((b) => b.type !== 'autocannon')};
    const world = load(layout, {seed});
    let nights = 0;
    while (world.cycle.shift === Shift.DAY && nights < MAX_NIGHTS) {
        nights++;
        world.cycle.endDay();
        while (world.cycle.shift === Shift.NIGHT) world.cycle.stepTicks(240, world.tick);
    }
    const defeated = world.cycle.shift === Shift.DEFEATED;
    return {seed, nights, defeated, wallsLeft: world.placement.buildings().filter((b) => b.type === 'wall').length};
}

const started = performance.now();
const failures = [];
const heavy = [];
for (const seed of SEEDS) {
    for (const [name, layout] of [['no-walls', withoutWalls], ['walled', FIXTURE], ['walled-with-gaps', withGaps]]) {
        const row = heavyNight(name, layout, seed);
        const repeat = heavyNight(name, layout, seed);
        if (row.digest !== repeat.digest) failures.push(`${name} seed ${seed}: run did not repeat`);
        if (row.problems.length) failures.push(...row.problems.map((p) => `${name} seed ${seed}: ${p}`));
        if (name === 'walled' && row.tally.barrierDamage === 0) failures.push(`${name} seed ${seed}: no barrier was damaged`);
        heavy.push(row);
        console.log(`${row.problems.length ? 'FAIL' : 'ok  '} ${name.padEnd(17)} seed ${String(seed).padStart(4)} | walls ${String(row.walls).padStart(3)} barrier damage ${String(row.tally.barrierDamage).padStart(5)} destroyed ${String(row.tally.destroyed).padStart(3)} | tick p50/p99/max ${row.tickMs.p50}/${row.tickMs.p99}/${row.tickMs.max} ms | 24 ticks at p99 ${row.worstFrameAt4xMs} ms`);
    }
}

const enclosed = SEEDS.map(untilDefeat);
for (const {seed, nights, defeated, wallsLeft} of enclosed) {
    console.log(`     enclosed, no cannons, seed ${String(seed).padStart(4)} | ${defeated ? `HQ fell on Night ${nights}` : `HQ alive after ${nights} Nights`} | walls left ${wallsLeft}`);
    if (!defeated) failures.push(`seed ${seed}: an enclosed base with no cannons survived ${nights} Nights`);
}

mkdirSync(new URL('../../soak-results/', import.meta.url), {recursive: true});
writeFileSync(new URL('../../soak-results/fortification.json', import.meta.url), `${JSON.stringify({
    createdAt: new Date().toISOString(), ms: Math.round(performance.now() - started), heavy, enclosed,
}, null, 2)}\n`);
for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`\n${failures.length} hard failures. Timing and survival are report-only. See soak-results/fortification.json`);
process.exitCode = failures.length ? 1 : 0;
