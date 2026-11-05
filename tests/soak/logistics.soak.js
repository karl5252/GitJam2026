/**
 * Logistics soak. Run with `npm run test:soak:logistics`. Writes
 * soak-results/logistics.json and exits non-zero on a hard failure.
 *
 * Several Factories and trucks for a bounded number of Nights, under real waves
 * and repeated forced truck losses. Hard failures: broken invariants, load or
 * Credit accounting that does not add up, state left behind, or a run that
 * does not repeat exactly. Timing is report-only.
 */
import {mkdirSync, writeFileSync} from 'node:fs';
import {checkInvariants, createWorld, digestOf} from './harness.js';
import {LOGISTICS, TruckState} from '../../src/core/logistics.js';
import {Shift} from '../../src/core/shiftCycle.js';

const NIGHTS = 12;
const SEEDS = [731, 98, 1];
const LOSS_EVERY_TICKS = 700;
const MAX_TICKS = NIGHTS * 3600;

/** Four Factories on a shared road, defended, with power to spare. */
function buildBase(world) {
    const must = (result, what) => { if (!result.ok) throw new Error(`${what}: ${result.reason}`); };
    must(world.place('hq', 12, 8), 'hq');
    for (const [col, row] of [[10, 11], [10, 12], [14, 11], [14, 12]]) {
        must(world.placement.placeRoad({col, row}), `road ${col},${row}`);
    }
    for (const [col, row] of [[20, 3], [20, 8], [20, 13]]) must(world.place('powerPlant', col, row), 'plant');
    for (const [col, row] of [[8, 8], [8, 12], [12, 12], [8, 4]]) {
        if (col === 8 && row === 4) for (const [c, r] of [[10, 5], [10, 4]]) must(world.placement.placeRoad({col: c, row: r}), 'road');
        must(world.place('factory', col, row), `factory ${col},${row}`);
    }
    for (const [col, row] of [[15, 3], [15, 5], [15, 9], [6, 6], [6, 10], [16, 12], [18, 5], [18, 10]]) must(world.place('autocannon', col, row), 'cannon');
}

function run(seed) {
    const world = createWorld({seed, resources: {credits: 20_000, ap: 60}, requireHq: true, roads: true});
    buildBase(world);
    const {logistics, economy} = world;
    const start = economy.credits;
    const problems = [];
    const peak = {trucks: 0, factories: 0};
    let forced = 0;
    let ticks = 0;
    let upkeep = 0;

    for (let night = 0; night < NIGHTS && world.cycle.shift === Shift.DAY; night++) {
        world.cycle.endDay();
        while (world.cycle.shift === Shift.NIGHT && ticks < MAX_TICKS) {
            world.cycle.stepTicks(1, world.tick);
            ticks++;
            if (ticks % LOSS_EVERY_TICKS !== 0) continue;
            const state = logistics.snapshot();
            const target = state.trucks.find((truck) => truck.state !== TruckState.RESPAWNING);
            if (target && logistics.damageTruck(target.id, LOGISTICS.truckHp).destroyed) forced++;
            peak.trucks = Math.max(peak.trucks, state.trucks.length);
            peak.factories = Math.max(peak.factories, state.factories.length);
            problems.push(...checkInvariants(world));
            for (const factory of state.factories) {
                if (factory.stored > LOGISTICS.storageLoads) problems.push(`${factory.id} overfull`);
            }
            const owners = new Set(state.factories.map((f) => f.id));
            if (state.trucks.filter((t) => owners.has(t.factoryId)).length !== state.factories.length) problems.push('a Factory has no truck');
        }
        if (world.cycle.lastSettlement) upkeep += world.cycle.lastSettlement.upkeep;
    }
    const final = logistics.snapshot();
    if (economy.credits !== start + final.totals.credits - upkeep) problems.push('Credits do not match deliveries and upkeep');
    if (final.totals.credits !== final.totals.loads * LOGISTICS.creditsPerLoad) problems.push('Credits do not match loads');
    if (world.cycle.shift === Shift.DAY && final.trucks.some((t) => t.state === TruckState.OUTBOUND || t.state === TruckState.RETURNING)) {
        problems.push('a truck is on the road during Day');
    }
    return {
        seed, nights: world.cycle.day - 1, shift: world.cycle.shift, forced, peak, totals: final.totals,
        trucksLeft: final.trucks.length, factoriesLeft: final.factories.length, credits: economy.credits,
        problems: [...new Set(problems)], digest: digestOf(JSON.stringify(final)),
    };
}

const started = performance.now();
const results = SEEDS.map(run);
let failures = 0;
for (const r of results) {
    const again = run(r.seed);
    const hard = [...r.problems];
    if (again.digest !== r.digest) hard.push('the same seed gave a different run');
    if (r.totals.loads === 0) hard.push('nothing was delivered');
    if (r.forced === 0) hard.push('no truck was lost');
    failures += hard.length;
    console.log(`${hard.length ? 'FAIL' : 'ok  '} seed ${String(r.seed).padStart(3)} | nights ${r.nights} ${r.shift} | loads ${r.totals.loads} credits ${r.totals.credits} lost ${r.totals.cargoLost} | forced losses ${r.forced} | peak trucks ${r.peak.trucks} left ${r.trucksLeft}`);
    for (const problem of hard) console.log(`     ${problem}`);
}
mkdirSync('soak-results', {recursive: true});
writeFileSync('soak-results/logistics.json', JSON.stringify({createdAt: new Date().toISOString(), ms: Math.round(performance.now() - started), results}, null, 2));
console.log(`${failures} hard failures in ${Math.round(performance.now() - started)} ms (report-only). See soak-results/logistics.json`);
process.exit(failures ? 1 : 0);
