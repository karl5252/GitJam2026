/**
 * Fortress combat benchmarks. Run with `npm run test:soak:fortress`. Writes
 * soak-results/fortress.json and exits non-zero on a hard failure.
 *
 * Two separate references, starting at Night 22 at full HP with no player input:
 *   exact      - the original FORTRESS 22, historical, in a world with no roads
 *   road-legal - the fixture snapshot, through the real road rules and loader
 *
 * Hard failures: the layout cannot be built, or no real combat happened. How
 * long a base survives is REPORT ONLY. These are measurements, not targets.
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {checkInvariants, createWorld} from './harness.js';
import {FORTRESS_22_EXACT, FORTRESS_22_STATE} from '../fixtures/legacy/fortress22-exact.js';
import {getBuildingType} from '../../src/core/buildingTypes.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {loadLayout} from '../../src/testShadow/layoutSnapshot.js';

const NIGHTS = 20;
const SEEDS = [731, 98, 1, 195, 2232];
const RESOURCES = {credits: 10_000, ap: 50};
const ROAD_LEGAL = JSON.parse(readFileSync(new URL('../fixtures/layouts/fortress22-road-legal.json', import.meta.url), 'utf8'));

function buildExact(world) {
    for (const [typeId, col, row] of FORTRESS_22_EXACT) {
        const {width, height} = getBuildingType(typeId);
        const result = world.place(typeId, col + Math.floor((width - 1) / 2), row + Math.floor((height - 1) / 2));
        if (!result.ok) throw new Error(`${typeId} at ${col},${row}: ${result.reason}`);
    }
}

function buildRoadLegal(world) {
    const result = loadLayout(world, ROAD_LEGAL);
    if (!result.ok) throw new Error(`road-legal fixture: ${result.reason} ${result.detail ?? ''}`);
}

function run({build, roads}, seed) {
    const world = createWorld({
        seed, resources: RESOURCES, requireHq: true, roads, pollution: FORTRESS_22_STATE.pollution, firstNight: FORTRESS_22_STATE.night,
    });
    build(world);
    while (world.cycle.day < FORTRESS_22_STATE.night) {
        world.cycle.endDay();
        while (world.cycle.shift === Shift.NIGHT) world.cycle.stepTicks(240, world.tick);
    }
    const tally = {spawned: 0, shots: 0, attacks: 0, destroyed: 0};
    const problems = [];
    for (let night = 0; night < NIGHTS && world.cycle.shift === Shift.DAY; night++) {
        world.cycle.endDay();
        while (world.cycle.shift === Shift.NIGHT) {
            world.cycle.stepTicks(240, (tick) => {
                const {defense, effects} = world.tick(tick);
                tally.spawned += effects.spawned.length;
                tally.shots += defense.shots.length;
                tally.attacks += effects.attacks.length;
                tally.destroyed += effects.destroyed.length;
            });
            problems.push(...checkInvariants(world));
        }
    }
    return {seed, ...tally, defeat: world.cycle.defeatReport, buildingsLeft: world.placement.buildings().length, problems};
}

const results = {};
let failures = 0;
for (const [name, benchmark] of Object.entries({
    exact: {build: buildExact, roads: false},
    'road-legal': {build: buildRoadLegal, roads: true},
})) {
    results[name] = SEEDS.map((seed) => run(benchmark, seed));
    for (const r of results[name]) {
        const hard = [...r.problems];
        if (r.spawned < 40 || r.shots === 0) hard.push('no real combat');
        failures += hard.length;
        console.log(`${hard.length ? 'FAIL' : 'ok  '} ${name.padEnd(11)} seed ${String(r.seed).padStart(4)} | spawned ${r.spawned} shots ${r.shots} hits ${r.attacks} destroyed ${r.destroyed} buildings left ${r.buildingsLeft} | defeat ${r.defeat ? `night ${r.defeat.day}` : 'none'}`);
        for (const problem of new Set(hard)) console.log(`     ${problem}`);
    }
}
mkdirSync('soak-results', {recursive: true});
writeFileSync('soak-results/fortress.json', JSON.stringify({createdAt: new Date().toISOString(), nights: NIGHTS, results}, null, 2));
console.log(`${failures} hard failures. Survival is report-only. See soak-results/fortress.json`);
process.exit(failures ? 1 : 0);
