/**
 * Brute soak. Run with `npm run test:soak:brutes`. Writes soak-results/brutes.json
 * and exits non-zero on a hard failure.
 *
 * Three questions, for review before any counter to the Brute is built:
 *
 *   geometry    one Brute, from a fixed spawn, against a wall, thick wall, funnel,
 *               checkerboard, enclosure and shut gate, with an ordinary mutant on
 *               the same layout to compare
 *   cannons     how many Autocannons one Brute takes, with nothing else about
 *   fortresses  the player-authored layouts on real late Nights, with Brutes and
 *               with the same waves without them, and where cannon fire goes. One
 *               Night from a whole base is what a player who rebuilds each Day
 *               faces. A campaign has nobody playing: no rebuilding, repairs or flag
 *               moves, so damage only ever adds up
 *
 * Hard failures: broken invariants, anything left after dawn, or a run that does
 * not repeat exactly. Survival, damage and timing are report-only, never a target.
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {BRUTE} from '../../src/core/mutants.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {loadLayout} from '../../src/testShadow/layoutSnapshot.js';
import {canonicalState, checkInvariants, createWorld, digestOf, worldState} from './harness.js';

const FUNDS = {credits: 100_000, ap: 300};
const SEEDS = [731, 98, 1, 7, 42, 11, 23, 58, 77, 90];
const LAST_NIGHT = 45;
const FIRST_NIGHT = 28; // reached by moving the calendar, so no Night before it is played
const LATE_POLLUTION = 1400; // Threat 4, as any base that lasts this long is
const TOP = (col) => col;
const LEFT = (row) => 64 + (15 - row);
const LAYOUTS = ['golden-fortress-day33-v2', 'fortress-checkerboard-v1', 'fortress-logistics-v1'];

const must = (result, what) => { if (!result.ok) throw new Error(`${what}: ${result.reason}`); };
const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/layouts/${name}.json`, import.meta.url), 'utf8'));
const median = (values) => (values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : null);
const rng = (index) => ({nextInt: () => index, snapshot: () => ({})});

const wall = (w, cells) => { for (const [col, row] of cells) must(w.place('wall', col, row), `wall ${col},${row}`); };
const line = (row, from = 0, to = 23) => Array.from({length: to - from + 1}, (_, i) => [from + i, row]);

const GEOMETRY = {
    'open ground': {spawn: TOP(12), build: () => {}},
    'one wall in its lane': {spawn: TOP(12), build: (w) => wall(w, [[12, 3]])},
    'wall line with an open end': {spawn: TOP(12), build: (w) => wall(w, line(3, 6, 18))},
    'wall across the map': {spawn: TOP(12), build: (w) => wall(w, line(3))},
    'three layers across the map': {spawn: TOP(12), build: (w) => wall(w, [...line(2), ...line(3), ...line(4)])},
    'funnel to a gap': {
        spawn: TOP(12),
        build: (w) => wall(w, [...line(3, 0, 8), ...line(3, 10, 23)]),
    },
    checkerboard: {
        spawn: TOP(12),
        build: (w) => {
            const cells = [];
            for (let row = 1; row <= 4; row++) for (let col = 0; col < 24; col++) if ((col + row) % 2 === 0) cells.push([col, row]);
            wall(w, cells);
        },
    },
    'enclosed HQ': {
        spawn: TOP(12),
        build: (w) => {
            const cells = [];
            for (let col = 9; col <= 15; col++) cells.push([col, 5], [col, 11]);
            for (let row = 6; row <= 10; row++) cells.push([9, row], [15, row]);
            wall(w, cells);
        },
    },
    'shut gate in a wall across the map': {
        spawn: TOP(12),
        build: (w) => {
            for (const [col, row] of [[12, 5], [12, 4], [12, 3], [12, 2]]) must(w.placement.placeRoad({col, row}), 'road');
            must(w.place('gateHorizontal', 12, 3), 'gate');
            wall(w, [...line(3, 0, 11), ...line(3, 13, 23)]);
        },
    },
    'from the west, across a wall': {spawn: LEFT(8), build: (w) => wall(w, line(2).map(([c]) => [2, c]).filter(([, r]) => r < 16))},
};

/** One mutant, one Night. What it did to the layout. */
function geometry({spawn, build}, kind) {
    const w = createWorld({
        rng: rng(spawn), resources: FUNDS, requireHq: true, roads: true, schedule: [1], bruteSlots: kind === 'brute' ? [0] : [],
    });
    must(w.place('hq', 12, 8), 'hq');
    build(w);
    const walls = () => w.placement.buildings().filter((b) => b.type === 'wall' || b.type.startsWith('gate')).length;
    const before = walls();
    const hqId = w.placement.buildings().find((b) => b.type === 'hq').id;
    let firstBarrierHit = null;
    let firstHqHit = null;
    let detours = 0;
    const problems = [];
    w.cycle.endDay();
    while (w.cycle.shift === Shift.NIGHT) {
        w.cycle.stepTicks(1, (t) => {
            const {effects} = w.tick(t);
            for (const {buildingId} of effects.attacks) {
                if (buildingId === hqId) firstHqHit ??= w.cycle.elapsedNightTicks;
                else firstBarrierHit ??= w.cycle.elapsedNightTicks;
            }
        });
        if (w.clock.tick % 60 === 0) problems.push(...checkInvariants(w));
        if (w.cycle.shift === Shift.NIGHT && w.mutants.detours().length) detours = w.mutants.detours()[0].plans;
    }
    const hq = w.placement.buildings().find((b) => b.id === hqId);
    return {
        firstBarrierHit, firstHqHit, barriersBroken: before - walls(), detours, hqDamage: 600 - (hq?.hp ?? 0),
        problems: [...new Set(problems)],
    };
}

/** Enough Plants to run the cannons, far from the lane so nothing but the cannons matters. */
function cannonWorld(cannons) {
    const w = createWorld({rng: rng(TOP(12)), resources: FUNDS, requireHq: true, roads: true, schedule: [300], bruteSlots: [0]});
    must(w.place('hq', 12, 8), 'hq');
    must(w.place('powerPlant', 21, 13), 'plant');
    must(w.place('powerPlant', 2, 13), 'plant');
    for (const [col, row] of cannons) must(w.place('autocannon', col, row), 'cannon');
    return w;
}

const LANE_CANNONS = [[12, 5], [11, 5], [13, 5], [10, 5], [14, 5], [12, 4], [11, 4], [13, 4]];
const RING_CANNONS = [[10, 5], [14, 5], [9, 8], [15, 8], [12, 11], [9, 5], [15, 5], [9, 11]];

function cannonRun(count, cells) {
    const w = cannonWorld(cells.slice(0, count));
    let killedAt = null;
    let hits = 0;
    w.cycle.endDay();
    while (w.cycle.shift === Shift.NIGHT) {
        w.cycle.stepTicks(1, (t) => {
            const {defense} = w.tick(t);
            hits += defense.shots.length;
            if (defense.shots.some((shot) => shot.killed)) killedAt ??= w.cycle.elapsedNightTicks;
        });
    }
    const standing = w.placement.buildings();
    return {killedAt, hits, cannonsLeft: standing.filter((b) => b.type === 'autocannon').length, hqHp: standing.find((b) => b.type === 'hq')?.hp ?? 0};
}

/** A late Night, on the real planner, starting from the whole fortress. */
function createFortress(name, seed, brutes, night) {
    const w = createWorld({seed, requireHq: true, roads: true, pollution: LATE_POLLUTION, brutes});
    must(loadLayout(w, fixture(name)), name);
    w.economy.adjustCredits(-w.economy.credits);
    must(w.cycle.jumpToDay(night), 'day');
    return w;
}

/** One Night and what it cost, against a whole base. */
function oneNight(name, seed, night, brutes) {
    const w = createFortress(name, seed, brutes, night);
    const ids = new Set();
    const contact = [];
    const seenHit = new Set();
    const lost = {};
    const brutesKilled = {cannon: 0, squad: 0};
    let fortificationHits = 0;
    let buildingHits = 0;
    let cannonShots = 0;
    let shotsAtBrutes = 0;
    let ordinaryKilled = 0;
    let ordinaryDamage = 0;
    const problems = [];
    let spawned = 0;
    w.cycle.endDay();
    while (w.cycle.shift === Shift.NIGHT) {
        w.cycle.stepTicks(1, (t) => {
            const {defense, infantryShots, effects} = w.tick(t);
            spawned += effects.spawned.length;
            for (const {mutantId, buildingId, damage} of effects.attacks) {
                if (!ids.has(mutantId)) {
                    ordinaryDamage += damage;
                    continue;
                }
                const type = buildingId.split('-')[0];
                if (type === 'wall' || type.startsWith('gate')) fortificationHits++;
                else buildingHits++;
                if (!seenHit.has(mutantId)) {
                    seenHit.add(mutantId);
                    contact.push(w.cycle.elapsedNightTicks);
                }
            }
            for (const id of effects.destroyed) {
                const type = id.split('-')[0];
                lost[type] = (lost[type] ?? 0) + 1;
            }
            for (const shot of defense.shots) {
                cannonShots++;
                if (ids.has(shot.mutantId)) shotsAtBrutes++;
                else if (shot.killed) ordinaryKilled++;
                if (shot.killed && ids.has(shot.mutantId)) brutesKilled.cannon++;
            }
            for (const shot of infantryShots) if (shot.killed && ids.has(shot.mutantId)) brutesKilled.squad++;
            for (const m of w.mutants.snapshot()) if (m.kind === BRUTE.kind) ids.add(m.id);
        });
        if (w.clock.tick % 60 === 0 && w.cycle.shift === Shift.NIGHT) problems.push(...checkInvariants(w));
    }
    const survivors = ids.size - brutesKilled.cannon - brutesKilled.squad;
    const hq = w.placement.buildings().find((b) => b.type === 'hq');
    return {
        night, seed, brutes: ids.size, spawned, reached: seenHit.size, contact, killedByCannon: brutesKilled.cannon, killedBySquad: brutesKilled.squad,
        aliveAtDawn: w.cycle.shift === Shift.DEFEATED ? null : survivors, fortificationHits, buildingHits, lost, hqHp: hq?.hp ?? 0,
        cannonShots, shotsAtBrutes, ordinaryKilled, ordinaryDamage,
        defeated: w.cycle.shift === Shift.DEFEATED, problems: [...new Set(problems)],
    };
}

function campaign(name, seed, brutes) {
    const w = createFortress(name, seed, brutes, FIRST_NIGHT);
    const lostByNight = {};
    const problems = [];
    let plantsGone = null;
    let cannonsGone = null;
    while (w.cycle.shift === Shift.DAY && w.cycle.day <= LAST_NIGHT) {
        const night = w.cycle.day;
        w.cycle.endDay();
        while (w.cycle.shift === Shift.NIGHT) {
            w.cycle.stepTicks(1, (t) => {
                const {effects} = w.tick(t);
                for (const id of effects.destroyed) {
                    const type = id.split('-')[0];
                    (lostByNight[type] ??= []).push(night);
                }
            });
            if (w.clock.tick % 240 === 0 && w.cycle.shift === Shift.NIGHT) problems.push(...checkInvariants(w));
        }
        const standing = w.placement.buildings();
        if (!standing.some((b) => b.type === 'powerPlant')) plantsGone ??= night;
        if (!standing.some((b) => b.type === 'autocannon')) cannonsGone ??= night;
        if (w.cycle.shift === Shift.DAY && (w.mutants.snapshot().length || w.mutants.shells().length)) problems.push(`left over after dawn ${night}`);
    }
    return {
        seed, fell: w.cycle.defeatReport?.day ?? null, plantsGone, cannonsGone,
        lost: Object.fromEntries(Object.entries(lostByNight).map(([type, nights]) => [type, nights.length])),
        firstPlantLost: lostByNight.powerPlant?.[0] ?? null,
        digest: digestOf(canonicalState(worldState(w))),
        problems: [...new Set(problems)].slice(0, 10),
    };
}

const report = {seeds: SEEDS.length, geometry: {}, cannons: {}, nights: {}, campaigns: {}, problems: []};
let failed = false;
const note = (problems, where) => {
    if (problems.length === 0) return;
    failed = true;
    report.problems.push({where, problems: problems.slice(0, 5)});
    console.log('PROBLEM', where, problems.slice(0, 5));
};

console.log('--- geometry: one mutant, one Night');
for (const [name, scene] of Object.entries(GEOMETRY)) {
    const brute = geometry(scene, 'brute');
    const ordinary = geometry(scene, 'ordinary');
    report.geometry[name] = {brute, ordinary};
    note([...brute.problems, ...ordinary.problems], name);
    console.log(name.padEnd(36), 'brute', JSON.stringify({...brute, problems: undefined}), '| ordinary', JSON.stringify({...ordinary, problems: undefined}));
}

console.log('--- cannons: one Brute, nothing else');
for (const [label, cells] of [['in its lane', LANE_CANNONS], ['ring round HQ', RING_CANNONS]]) {
    for (const count of [1, 2, 3, 4, 6, 8]) {
        const result = cannonRun(count, cells);
        report.cannons[`${label}: ${count}`] = result;
        console.log(`${label}: ${count}`.padEnd(20), JSON.stringify(result));
    }
}

console.log('--- single Nights from a whole base (10 seeds)');
for (const name of LAYOUTS) {
    for (const night of [30, 35, 40]) {
        const runs = SEEDS.map((seed) => oneNight(name, seed, night, true));
        const plain = SEEDS.map((seed) => oneNight(name, seed, night, false));
        for (const run of [...runs, ...plain]) note(run.problems, `${name} night ${night} seed ${run.seed}`);
        const sum = (list, key) => list.reduce((total, run) => total + (run[key] ?? 0), 0);
        const contacts = runs.flatMap((run) => run.contact);
        const lost = (list) => list.reduce((all, run) => {
            for (const [type, n] of Object.entries(run.lost)) all[type] = (all[type] ?? 0) + n;
            return all;
        }, {});
        const entry = {
            brutes: sum(runs, 'brutes'), reached: sum(runs, 'reached'), medianContactTick: median(contacts), latestContactTick: contacts.length ? Math.max(...contacts) : null,
            killedByCannon: sum(runs, 'killedByCannon'), killedBySquad: sum(runs, 'killedBySquad'), aliveAtDawn: sum(runs, 'aliveAtDawn'),
            fortificationHits: sum(runs, 'fortificationHits'), buildingHits: sum(runs, 'buildingHits'),
            lostWith: lost(runs), lostWithout: lost(plain), defeatsWith: runs.filter((r) => r.defeated).length, defeatsWithout: plain.filter((r) => r.defeated).length,
            medianHqWith: median(runs.map((r) => r.hqHp)), medianHqWithout: median(plain.map((r) => r.hqHp)),
            cannonShotsWith: sum(runs, 'cannonShots'), cannonShotsWithout: sum(plain, 'cannonShots'), cannonShotsAtBrutes: sum(runs, 'shotsAtBrutes'),
            ordinaryKilledWith: sum(runs, 'ordinaryKilled'), ordinaryKilledWithout: sum(plain, 'ordinaryKilled'),
            ordinaryDamageWith: sum(runs, 'ordinaryDamage'), ordinaryDamageWithout: sum(plain, 'ordinaryDamage'),
        };
        report.nights[`${name}: Night ${night}`] = entry;
        console.log(`${name} N${night}`, JSON.stringify(entry));
    }
}

console.log(`--- campaigns: Nights ${FIRST_NIGHT}-${LAST_NIGHT} with nobody playing (10 seeds)`);
for (const name of LAYOUTS) {
    const on = SEEDS.map((seed) => campaign(name, seed, true));
    const off = SEEDS.map((seed) => campaign(name, seed, false));
    const repeats = campaign(name, SEEDS[0], true).digest === on[0].digest;
    if (!repeats) note(['the campaign did not repeat'], name);
    for (const run of [...on, ...off]) note(run.problems, `${name} campaign seed ${run.seed}`);
    const fell = (list) => list.map((r) => r.fell ?? LAST_NIGHT + 1);
    const entry = {
        repeats,
        medianFellWith: median(fell(on)), earliestWith: Math.min(...fell(on)), survivedWith: on.filter((r) => r.fell === null).length,
        medianFellWithout: median(fell(off)), earliestWithout: Math.min(...fell(off)), survivedWithout: off.filter((r) => r.fell === null).length,
        medianFirstPlantWith: median(on.map((r) => r.firstPlantLost).filter(Boolean)), medianFirstPlantWithout: median(off.map((r) => r.firstPlantLost).filter(Boolean)),
        medianCannonsGoneWith: median(on.map((r) => r.cannonsGone).filter(Boolean)),
    };
    report.campaigns[name] = entry;
    console.log(name, JSON.stringify(entry));
}

mkdirSync('soak-results', {recursive: true});
writeFileSync('soak-results/brutes.json', JSON.stringify(report, null, 2));
console.log(failed ? 'FAILED' : 'passed');
process.exit(failed ? 1 : 0);
