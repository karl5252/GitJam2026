/**
 * Infantry soak. Run with `npm run test:soak:infantry`. Writes
 * soak-results/infantry.json and exits non-zero on a hard failure.
 *
 * Bases of about the same price, on the real planner, with no income and no
 * player input, so the only difference is what the money bought. Then four
 * Barracks against the heaviest wave, for timing. Hard failures: broken
 * invariants, a squad over strength, a soldier inside something solid, anything
 * left after dawn, or a run that does not repeat exactly. Survival and timing are
 * report-only and never a target.
 */
import {mkdirSync, writeFileSync} from 'node:fs';
import {getBuildingType} from '../../src/core/buildingTypes.js';
import {INFANTRY} from '../../src/core/infantry.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {waveSchedule} from '../../src/core/waves.js';
import {canonicalState, checkInvariants, createWorld, digestOf, worldState} from './harness.js';

const NIGHTS = 30;
const SEEDS = [731, 98, 1, 7, 42];
const CHECK_EVERY = 60;
const NORTH_ROAD = [[14, 5], [14, 4]];
const SOUTH_ROAD = [[14, 11], [14, 12], [14, 13]];
const SQUADS = [[16, 7, [18, 6]], [16, 10, [18, 11]], [16, 13, [8, 13]], [5, 5, [8, 3]]]; // pointer, then flag

const must = (result, what) => { if (!result.ok) throw new Error(`${what}: ${result.reason}`); };

/**
 * Each base starts from HQ at 12,8 and a Plant just north of its ring, at 12,3,
 * which mutants want most and which must be covered: losing it silences every
 * cannon and stops every Barracks.
 */
const barracks = (w, col, row, flag) => {
    const result = w.place('barracks', col, row);
    must(result, 'barracks');
    must(w.placement.setFlag(result.building.id, {col: flag[0], row: flag[1]}), 'flag');
};
const cannons = (w, cells) => {
    for (const [col, row] of cells) must(w.place('autocannon', col, row), 'cannon');
};

const BASES = {
    '3 cannons (750c, 60 power)': (w) => cannons(w, [[10, 5], [14, 5], [12, 11]]),
    '1 Barracks + 1 cannon (650c, 50 power)': (w) => {
        barracks(w, 16, 8, [15, 3]);
        cannons(w, [[10, 5]]);
    },
    '2 cannons + 1 Barracks (900c, 70 power)': (w) => {
        barracks(w, 16, 8, [15, 3]);
        cannons(w, [[10, 5], [12, 11]]);
    },
    '2 Barracks, both north (800c, 60 power)': (w) => {
        barracks(w, 16, 8, [15, 3]);
        barracks(w, 16, 12, [9, 3]);
    },
    '2 Barracks, north and south (800c, 60 power)': (w) => {
        barracks(w, 16, 8, [12, 5]);
        barracks(w, 16, 12, [12, 12]);
    },
};

function soldierProblems(w) {
    const problems = [];
    const buildings = new Map(w.placement.buildings().map((b) => [b.id, b]));
    const perSquad = new Map();
    for (const soldier of w.infantry.soldiers()) {
        perSquad.set(soldier.barracksId, (perSquad.get(soldier.barracksId) ?? 0) + 1);
        if (!Number.isInteger(soldier.hp) || soldier.hp < 1 || soldier.hp > INFANTRY.maxHp) problems.push(`${soldier.id} has hp ${soldier.hp}`);
        const building = buildings.get(w.grid.occupantAt(soldier.col, soldier.row));
        if (building && !getBuildingType(building.type).gate) problems.push(`${soldier.id} is inside ${building.id}`);
    }
    for (const [id, count] of perSquad) if (count > INFANTRY.squadSize) problems.push(`${id} has ${count} soldiers`);
    return problems;
}

function runBase(buildBase, seed) {
    const w = createWorld({seed, resources: {credits: 20_000, ap: 60}, requireHq: true, roads: true});
    must(w.place('hq', 12, 8), 'hq');
    must(w.placement.placeRoad({col: 14, row: 11}), 'road');
    must(w.placement.placeRoad({col: 14, row: 12}), 'road');
    must(w.place('powerPlant', 12, 3), 'plant');
    buildBase(w);
    w.economy.adjustCredits(-w.economy.credits); // what was bought is all there is
    const problems = [];
    const tally = {cannonShots: 0, cannonKills: 0, infantryShots: 0, infantryKills: 0, spawned: 0};
    let tickMs = 0;
    let ticks = 0;

    for (let night = 1; night <= NIGHTS && w.cycle.shift === Shift.DAY; night++) {
        w.cycle.endDay();
        while (w.cycle.shift === Shift.NIGHT) {
            w.cycle.stepTicks(1, (t) => {
                const before = performance.now();
                const {defense, infantryShots, effects} = w.tick(t);
                tickMs += performance.now() - before;
                ticks++;
                tally.spawned += effects.spawned.length;
                tally.cannonShots += defense.shots.length;
                tally.cannonKills += defense.shots.filter((s) => s.killed).length;
                tally.infantryShots += infantryShots.length;
                tally.infantryKills += infantryShots.filter((s) => s.killed).length;
            });
            if (ticks % CHECK_EVERY === 0) problems.push(...checkInvariants(w), ...soldierProblems(w));
        }
        if (w.cycle.shift === Shift.DAY && w.infantry.soldiers().length > 0) problems.push(`soldiers left after dawn ${night}`);
    }
    const {totals} = w.infantry.snapshot();
    return {
        seed,
        fell: w.cycle.defeatReport?.day ?? null,
        ...tally,
        deployed: totals.deployed,
        lost: totals.lost,
        msPerTick: tickMs / ticks,
        digest: digestOf(canonicalState(worldState(w))),
        problems: [...new Set(problems)].slice(0, 10),
    };
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Four full squads against the heaviest approved wave. Timing is the point. */
function heaviest() {
    const w = createWorld({
        seed: 731, resources: {credits: 20_000, ap: 60}, requireHq: true, roads: true, schedule: [...waveSchedule(40, 1200)],
    });
    must(w.place('hq', 12, 8), 'hq');
    for (const [col, row] of [[20, 3], [20, 13]]) must(w.place('powerPlant', col, row), 'plant');
    for (const [col, row] of [...NORTH_ROAD, ...SOUTH_ROAD, [9, 8], [8, 8], [7, 8], [6, 8], [5, 8], [4, 8], [3, 8], [3, 7], [3, 6], [3, 5]]) {
        must(w.placement.placeRoad({col, row}), 'road');
    }
    for (const [col, row, flag] of SQUADS) barracks(w, col, row, flag);
    w.cycle.endDay();
    const times = [];
    const problems = [];
    let peak = 0;
    while (w.cycle.shift === Shift.NIGHT) {
        w.cycle.stepTicks(1, (t) => {
            const before = performance.now();
            w.tick(t);
            times.push(performance.now() - before);
        });
        peak = Math.max(peak, w.infantry.soldiers().length);
        problems.push(...soldierProblems(w));
    }
    times.sort((a, b) => a - b);
    return {
        peakSoldiers: peak,
        p50: times[Math.floor(times.length / 2)],
        p99: times[Math.floor(times.length * 0.99)],
        max: times.at(-1),
        totals: w.infantry.snapshot().totals,
        problems: [...new Set(problems)].slice(0, 10),
    };
}

const report = {bases: {}, heaviest: heaviest()};
let failed = report.heaviest.problems.length > 0 || report.heaviest.peakSoldiers !== 16;
for (const [name, buildBase] of Object.entries(BASES)) {
    const runs = SEEDS.map((seed) => runBase(buildBase, seed));
    const repeat = runBase(buildBase, SEEDS[0]);
    const repeats = repeat.digest === runs[0].digest;
    const nights = runs.map((run) => run.fell ?? NIGHTS + 1);
    const sum = (key) => runs.reduce((total, run) => total + run[key], 0);
    report.bases[name] = {
        medianFell: median(nights), earliest: Math.min(...nights), latest: Math.max(...nights),
        survived: runs.filter((run) => run.fell === null).length,
        spawned: sum('spawned'), cannonKills: sum('cannonKills'), infantryKills: sum('infantryKills'),
        deployed: sum('deployed'), lost: sum('lost'),
        msPerTick: Math.max(...runs.map((run) => run.msPerTick)),
        repeats,
        problems: runs.flatMap((run) => run.problems),
    };
    if (!repeats || report.bases[name].problems.length > 0) failed = true;
    console.log(name, JSON.stringify(report.bases[name]));
}
console.log('heaviest', JSON.stringify(report.heaviest));
mkdirSync('soak-results', {recursive: true});
writeFileSync('soak-results/infantry.json', JSON.stringify(report, null, 2));
console.log(failed ? 'FAILED' : 'passed');
process.exit(failed ? 1 : 0);
