/**
 * Spitter soak. Run with `npm run test:soak:spitters`. Writes
 * soak-results/spitters.json and exits non-zero on a hard failure.
 *
 * Every base runs twice on the real planner, with Spitters and with the same waves
 * of ordinary mutants, so the difference is the Spitter. Nobody plays: no income,
 * no rebuilding and no repairs, which is the worst case for a weapon that wears
 * things down. The established turtles are the ones tests/unit/waves.test.js has
 * always used. `active` runs a stand-in for a player who moves the flag: once a
 * Spitter has fired, the squad's flag goes to it through the real setFlag, and it
 * comes home when no armed Spitter is left.
 *
 * Hard failures: broken invariants, anything left after dawn, or a run that does
 * not repeat exactly. Survival, damage and timing are report-only and never a target.
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {SPITTER} from '../../src/core/mutants.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {loadLayout} from '../../src/testShadow/layoutSnapshot.js';
import {canonicalState, checkInvariants, createWorld, digestOf, worldState} from './harness.js';

const NIGHTS = 30;
const CHECK_EVERY = 60;
const TURTLE_SEEDS = Array.from({length: 30}, (_, i) => i + 1);
const BASE_SEEDS = [731, 98, 1, 7, 42, 11, 23, 58, 77, 90];
const FUNDS = {credits: 20_000, ap: 200};

const must = (result, what) => { if (!result.ok) throw new Error(`${what}: ${result.reason}`); };
const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/layouts/${name}.json`, import.meta.url), 'utf8'));

/** Exactly as tests/unit/waves.test.js builds them, on the 1250-Credit budget. */
const turtle = ({hq, plant, cannons}) => (options) => {
    const w = createWorld({...options, requireHq: true});
    must(w.place('hq', ...hq), 'hq');
    must(w.place('powerPlant', ...plant), 'plant');
    for (const cell of cannons) must(w.place('autocannon', ...cell), 'cannon');
    return {w};
};

/** HQ at 12,8 and a Plant just north of its ring, as in tests/soak/infantry.soak.js. */
const compact = (build) => (options) => {
    const w = createWorld({...options, resources: FUNDS, requireHq: true, roads: true});
    must(w.place('hq', 12, 8), 'hq');
    must(w.place('powerPlant', 12, 3), 'plant');
    const extra = build(w);
    w.economy.adjustCredits(-w.economy.credits); // what was bought is all there is
    return {w, ...extra};
};

const cannons = (w, cells) => {
    for (const [col, row] of cells) must(w.place('autocannon', col, row), 'cannon');
};

function outline(left, top, right, bottom) {
    const cells = [];
    for (let row = top; row <= bottom; row++) {
        for (let col = left; col <= right; col++) {
            if (row === top || row === bottom || col === left || col === right) cells.push([col, row]);
        }
    }
    return cells;
}

const squad = (w, flag) => {
    const {building} = w.place('barracks', 16, 8);
    must(w.placement.setFlag(building.id, {col: flag[0], row: flag[1]}), 'flag');
    return {barracks: building.id, home: {col: flag[0], row: flag[1]}};
};

const SQUAD_BASE = (w) => {
    cannons(w, [[10, 5], [12, 11]]);
    return squad(w, [15, 3]);
};

const BASES = {
    'turtle: centre': {make: turtle({hq: [12, 8], cannons: [[10, 6], [14, 6], [10, 10]], plant: [12, 4]}), seeds: TURTLE_SEEDS},
    'turtle: north-west corner': {make: turtle({hq: [1, 1], cannons: [[3, 3], [1, 3], [3, 1]], plant: [1, 5]}), seeds: TURTLE_SEEDS},
    'turtle: south-east corner': {make: turtle({hq: [22, 14], cannons: [[20, 12], [22, 12], [20, 14]], plant: [22, 10]}), seeds: TURTLE_SEEDS},
    'compact: 3 cannons (750c)': {make: compact((w) => cannons(w, [[10, 5], [14, 5], [12, 11]])), seeds: BASE_SEEDS},
    'compact: 6 cannons (1500c)': {make: compact((w) => cannons(w, [[10, 5], [14, 5], [9, 8], [15, 8], [12, 11], [12, 1]])), seeds: BASE_SEEDS},
    'Barracks-free: 3 cannons + 38 walls (1700c)': {
        make: compact((w) => {
            cannons(w, [[10, 5], [14, 5], [12, 11]]);
            for (const [col, row] of outline(8, 0, 16, 12)) must(w.place('wall', col, row), 'wall');
        }),
        seeds: BASE_SEEDS,
    },
    'squad, static flag: 2 cannons + Barracks (900c)': {make: compact(SQUAD_BASE), seeds: BASE_SEEDS},
    'squad, active flag: 2 cannons + Barracks (900c)': {make: compact(SQUAD_BASE), seeds: BASE_SEEDS, active: true},
    'fortress-checkerboard-v1 (no input)': {
        make: (options) => {
            const w = createWorld({...options, requireHq: true, roads: true});
            must(loadLayout(w, fixture('fortress-checkerboard-v1')), 'layout');
            return {w};
        },
        seeds: BASE_SEEDS,
    },
};

/** The stand-in player. One flag move per change of target, so it is not a free tracking aura. */
function makeFlagPlayer(w, barracks, home, tally) {
    let chasing = null;
    const tileOf = ({x, y}) => w.grid.worldToCell(Math.min(Math.max(x, w.grid.originX), w.grid.originX + 767), Math.min(Math.max(y, w.grid.originY), w.grid.originY + 511));
    const send = (cell) => {
        for (const [dc, dr] of [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
            if (w.placement.setFlag(barracks, {col: cell.col + dc, row: cell.row + dr}).ok) return true;
        }
        return false;
    };
    return () => {
        if (!w.placement.buildings().some((b) => b.id === barracks)) return;
        const armed = w.mutants.snapshot().filter((m) => m.shots > 0 && m.shots < SPITTER.maxShots);
        const target = armed.find((m) => m.id === chasing) ?? armed[0];
        if (target && target.id !== chasing && send(tileOf(target))) {
            chasing = target.id;
            tally.flagMoves++;
        } else if (!target && chasing) {
            chasing = null;
            w.placement.setFlag(barracks, home);
        }
    };
}

function run({make, active = false}, seed, spitters) {
    const {w, barracks, home} = make({seed, spitters, brutes: spitters}); // "ordinary" stays ordinary past Night 30
    const problems = [];
    const tally = {
        spitters: 0, killedArmed: 0, killedByCannon: 0, killedBySquad: 0, shellsLanded: 0, shellDamage: 0, meleeDamage: 0,
        shellHq: 0, shellPlant: 0, shellCannon: 0, shellFortification: 0, shellMisses: 0, shellSoldierHits: 0, flagMoves: 0,
    };
    const plantIds = new Set(w.placement.buildings().filter((b) => b.type === 'powerPlant').map((b) => b.id));
    const armed = new Set();
    const spitterIds = new Set();
    const flagPlayer = active ? makeFlagPlayer(w, barracks, home, tally) : null;
    let allPlantsLost = null;
    let ticks = 0;
    let tickMs = 0;

    const count = (night, {defense, infantryShots, effects}) => {
        const kills = [...defense.shots.filter((s) => s.killed).map((s) => [s.mutantId, 'killedByCannon']),
            ...infantryShots.filter((s) => s.killed).map((s) => [s.mutantId, 'killedBySquad'])];
        for (const [id, by] of kills) {
            if (!spitterIds.has(id)) continue;
            tally[by]++;
            if (armed.has(id)) tally.killedArmed++;
        }
        for (const {buildingId, damage} of effects.attacks) {
            const type = buildingId.split('-')[0];
            if (damage !== SPITTER.damage) {
                tally.meleeDamage += damage;
                continue;
            }
            tally.shellDamage += damage;
            if (type === 'hq') tally.shellHq += damage;
            else if (type === 'powerPlant') tally.shellPlant += damage;
            else if (type === 'autocannon') tally.shellCannon += damage;
            else if (type === 'wall' || type.startsWith('gate')) tally.shellFortification += damage;
        }
        for (const impact of effects.impacts ?? []) {
            tally.shellsLanded++;
            if (impact.soldierId) tally.shellSoldierHits++;
            if (!impact.buildingId && !impact.soldierId) tally.shellMisses++;
        }
        if (effects.destroyed.some((id) => plantIds.has(id)) && !w.placement.buildings().some((b) => plantIds.has(b.id))) allPlantsLost ??= night;
        armed.clear();
        for (const mutant of w.mutants.snapshot()) {
            if (mutant.kind !== SPITTER.kind) continue;
            if (!spitterIds.has(mutant.id)) tally.spitters++;
            spitterIds.add(mutant.id);
            if (mutant.shots > 0) armed.add(mutant.id);
        }
    };

    for (let night = 1; night <= NIGHTS && w.cycle.shift === Shift.DAY; night++) {
        w.cycle.endDay();
        while (w.cycle.shift === Shift.NIGHT) {
            w.cycle.stepTicks(1, (t) => {
                const before = performance.now();
                const result = w.tick(t);
                tickMs += performance.now() - before;
                ticks++;
                count(night, result);
            });
            if (flagPlayer && ticks % 30 === 0 && w.cycle.shift === Shift.NIGHT) flagPlayer();
            if (ticks % CHECK_EVERY === 0) problems.push(...checkInvariants(w));
        }
        if (w.cycle.shift === Shift.DAY && (w.mutants.shells().length > 0 || w.mutants.snapshot().length > 0)) problems.push(`left over after dawn ${night}`);
    }
    return {
        seed,
        fell: w.cycle.defeatReport?.day ?? null,
        allPlantsLost,
        ...tally,
        lost: w.infantry?.snapshot().totals.lost ?? 0,
        msPerTick: tickMs / ticks,
        digest: digestOf(canonicalState(worldState(w))),
        problems: [...new Set(problems)].slice(0, 10),
    };
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

function summary(runs) {
    const nights = runs.map((r) => r.fell ?? NIGHTS + 1);
    const plants = runs.map((r) => r.allPlantsLost).filter((n) => n !== null);
    const sum = (key) => runs.reduce((total, r) => total + r[key], 0);
    const keys = [
        'spitters', 'killedArmed', 'killedByCannon', 'killedBySquad', 'shellsLanded', 'shellDamage', 'meleeDamage', 'shellHq', 'shellPlant',
        'shellCannon', 'shellFortification', 'shellMisses', 'shellSoldierHits', 'flagMoves', 'lost',
    ];
    return {
        medianFell: median(nights), earliest: Math.min(...nights), latest: Math.max(...nights),
        survived: runs.filter((r) => r.fell === null).length,
        plantsLost: plants.length, medianPlantsLost: plants.length ? median(plants) : null,
        ...Object.fromEntries(keys.map((key) => [key, sum(key)])),
        msPerTick: Math.max(...runs.map((r) => r.msPerTick)),
        problems: runs.flatMap((r) => r.problems),
    };
}

const report = {seeds: {turtle: TURTLE_SEEDS.length, other: BASE_SEEDS.length}, nights: NIGHTS, bases: {}};
let failed = false;
for (const [name, base] of Object.entries(BASES)) {
    const on = base.seeds.map((seed) => run(base, seed, true));
    const off = base.seeds.map((seed) => run(base, seed, false));
    const repeats = run(base, base.seeds[0], true).digest === on[0].digest;
    const result = {spitters: summary(on), ordinary: summary(off), repeats};
    report.bases[name] = result;
    if (!repeats || result.spitters.problems.length || result.ordinary.problems.length) failed = true;
    const {medianFell, earliest, latest, survived, medianPlantsLost, plantsLost} = result.spitters;
    console.log(`${name}: fell ${medianFell} (${earliest}-${latest}, ${survived} survived), ordinary ${result.ordinary.medianFell} (${result.ordinary.earliest}-${result.ordinary.latest}, ${result.ordinary.survived} survived); Plants lost in ${plantsLost} runs, median Night ${medianPlantsLost}`);
    console.log('  ', JSON.stringify(result.spitters));
}
mkdirSync('soak-results', {recursive: true});
writeFileSync('soak-results/spitters.json', JSON.stringify(report, null, 2));
console.log(failed ? 'FAILED' : 'passed');
process.exit(failed ? 1 : 0);
