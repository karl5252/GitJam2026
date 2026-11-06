/**
 * Heavy weapons soak. Run with `npm run test:soak:heavy`. Writes
 * soak-results/heavy.json and exits non-zero on a hard failure.
 *
 * Everything here is synthetic and report-only. Survival, damage and timing are
 * never targets, and none of it is a playtest. Three questions:
 *
 *   kill speed  one Brute walking in from the west, against each defender alone
 *   fortress    golden-fortress-day33-v2 with each configuration of heavy weapons,
 *               on single Nights from a whole base, and in a campaign from Night 28
 *               with nobody playing. Power is real: what does not fit gets a Plant
 *               or loses a cannon, and every configuration starts NORMAL. The script
 *               finds the free spot nearest HQ, which is not where a player would
 *               choose, and an extra Plant ends up outside the walls
 *   spitters    Nights 1-29 on the real planner: does a Siege Cannon take over the
 *               job of Rifle squads and flags?
 *
 * "static" means flags never move. "scripted flag" is a stand-in that sends a squad
 * to its target after the fact, once per target. Neither is what a player does.
 *
 * Hard failures: broken invariants, anything left after dawn, a configuration that
 * starts below NORMAL, or a run that does not repeat exactly.
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {getBuildingType} from '../../src/core/buildingTypes.js';
import {SPITTER} from '../../src/core/mutants.js';
import {PowerStatus, calculatePower} from '../../src/core/power.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {loadLayout} from '../../src/testShadow/layoutSnapshot.js';
import {canonicalState, checkInvariants, createWorld, digestOf, worldState} from './harness.js';

const FUNDS = {credits: 100_000, ap: 300};
const SEEDS = [731, 98, 1, 7, 42, 11, 23, 58, 77, 90];
const LATE_POLLUTION = 1400; // Threat 4, as any base that lasts this long is
const CAMPAIGN_FROM = 28;
const CAMPAIGN_TO = 45;
const SPITTER_NIGHTS = 29;
const WEST = 71; // the spawn at the west end of row 8

const must = (result, what) => { if (!result.ok) throw new Error(`${what}: ${result.reason}`); };
const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/layouts/${name}.json`, import.meta.url), 'utf8'));
const median = (values) => (values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : null);
const sum = (list, key) => list.reduce((total, run) => total + (run[key] ?? 0), 0);

/** Hard failures, and the same check the other soaks make at each dawn. */
function leftovers(w) {
    return w.mutants.snapshot().length + w.mutants.shells().length + w.siegeCannons.shells().length + (w.infantry?.rockets().length ?? 0);
}

/** The nearest spot to HQ that a building of this type can really go. */
function spotFor(w, type) {
    const hq = w.placement.buildings().find((b) => b.type === 'hq');
    const cells = [];
    for (let row = 0; row < w.grid.rows; row++) {
        for (let col = 0; col < w.grid.cols; col++) {
            cells.push({col, row, distance: Math.abs(col - hq.col - 1) + Math.abs(row - hq.row - 1)});
        }
    }
    cells.sort((a, b) => a.distance - b.distance || a.row - b.row || a.col - b.col);
    w.placement.select(type);
    const spot = cells.find((cell) => w.placement.preview(cell).ok);
    w.placement.cancel();
    if (!spot) throw new Error(`no room for ${type}`);
    return spot;
}

const add = (w, type) => {
    const {col, row} = spotFor(w, type);
    must(w.place(type, col, row), type);
};

// ---- Kill speed -------------------------------------------------------------

/** HQ at 12,8. Everything stands east of the Brute's lane, which runs along row 8 from the west. */
const DEFENDERS = {
    '1 Autocannon': (w) => must(w.place('autocannon', 8, 6), 'cannon'),
    '3 Autocannons': (w) => { for (const [c, r] of [[8, 6], [8, 10], [9, 6]]) must(w.place('autocannon', c, r), 'cannon'); },
    '5 Autocannons': (w) => { for (const [c, r] of [[8, 6], [8, 10], [9, 6], [9, 10], [7, 6]]) must(w.place('autocannon', c, r), 'cannon'); },
    '1 Siege Cannon': (w) => must(w.place('siegeCannon', 12, 4), 'siege'),
    '2 Siege Cannons': (w) => { must(w.place('siegeCannon', 12, 4), 'siege'); must(w.place('siegeCannon', 12, 11), 'siege'); },
    'Rifle squad on the lane': (w) => squad(w, {refit: false}),
    'Rocket squad on the lane': (w) => squad(w, {refit: true}),
    'Rocket squad + 1 Siege Cannon': (w) => {
        squad(w, {refit: true});
        must(w.place('siegeCannon', 12, 4), 'siege');
    },
    '3 Autocannons + Rocket squad': (w) => {
        squad(w, {refit: true});
        for (const [c, r] of [[8, 6], [8, 10], [9, 6]]) must(w.place('autocannon', c, r), 'cannon');
    },
};

function squad(w, {refit}) {
    const {building} = w.place('barracks', 16, 8);
    if (refit) must(w.placement.refit(building.id), 'refit');
    must(w.placement.setFlag(building.id, {col: 6, row: 7}), 'flag');
}

function killSpeed(build) {
    const w = createWorld({rng: {nextInt: () => WEST, snapshot: () => ({})}, resources: FUNDS, requireHq: true, roads: true, schedule: [1], bruteSlots: [0]});
    must(w.place('hq', 12, 8), 'hq');
    must(w.place('powerPlant', 20, 3), 'plant');
    must(w.place('powerPlant', 20, 13), 'plant');
    build(w);
    const before = w.placement.buildings().length;
    let killedAt = null;
    let lowestHp = 600;
    w.cycle.endDay();
    while (w.cycle.shift === Shift.NIGHT && killedAt === null) {
        w.cycle.stepTicks(1, (t) => {
            const {siege, defense, infantryShots} = w.tick(t);
            if ([...siege.impacts, ...defense.shots, ...infantryShots].some((hit) => hit.killed)) killedAt = w.cycle.elapsedNightTicks;
            lowestHp = killedAt === null ? Math.min(lowestHp, w.mutants.snapshot()[0]?.hp ?? lowestHp) : 0;
        });
    }
    const hq = w.placement.buildings().find((b) => b.type === 'hq');
    return {killedAt, lowestHp, hqDamage: 600 - (hq?.hp ?? 0), lost: before - w.placement.buildings().length, defeated: w.cycle.shift === Shift.DEFEATED};
}

// ---- Golden fortress --------------------------------------------------------

const refitFirst = (w, count) => {
    for (const {id} of w.placement.barracks().slice(0, count)) must(w.placement.refit(id), 'refit');
};

const demolishCannon = (w) => {
    const cannon = w.placement.buildings().filter((b) => b.type === 'autocannon').at(-1);
    must(w.placement.demolish(cannon.id), 'demolish');
};

const FORTRESS = {
    'as built: 8 cannons, 2 Rifle squads': {build: () => {}, spent: 0},
    '1 Rocket squad': {build: (w) => refitFirst(w, 1), spent: 200},
    '2 Rocket squads': {build: (w) => refitFirst(w, 2), spent: 400},
    'first squad on a scripted flag, Rifles': {build: () => {}, spent: 0, chase: true},
    '1 Rocket squad on a scripted flag': {build: (w) => refitFirst(w, 1), spent: 200, chase: true},
    '1 Siege': {build: (w) => add(w, 'siegeCannon'), spent: 600},
    '1 Siege + 1 Rocket squad': {build: (w) => { add(w, 'siegeCannon'); refitFirst(w, 1); }, spent: 800},
    '1 Siege + 1 Rocket squad on a scripted flag': {build: (w) => { add(w, 'siegeCannon'); refitFirst(w, 1); }, spent: 800, chase: true},
    '2 Siege + Plant': {build: (w) => { add(w, 'powerPlant'); add(w, 'siegeCannon'); add(w, 'siegeCannon'); }, spent: 1700},
    '2 Siege + Plant + 1 Rocket squad': {build: (w) => { add(w, 'powerPlant'); add(w, 'siegeCannon'); add(w, 'siegeCannon'); refitFirst(w, 1); }, spent: 1900},
    '2 Siege, one cannon demolished': {build: (w) => { demolishCannon(w); add(w, 'siegeCannon'); add(w, 'siegeCannon'); }, spent: 1200},
    '1 more cannon (fits the power)': {build: (w) => add(w, 'autocannon'), spent: 250},
    '5 more cannons + Plant (same price as 2 Siege + Plant)': {
        build: (w) => { add(w, 'powerPlant'); for (let i = 0; i < 5; i++) add(w, 'autocannon'); }, spent: 1750,
    },
};

function fortress(config, seed, night, {brutes = true} = {}) {
    const w = createWorld({seed, requireHq: true, roads: true, pollution: LATE_POLLUTION, resources: FUNDS, brutes});
    must(loadLayout(w, fixture('golden-fortress-day33-v2')), 'layout');
    w.economy.adjustCredits(100_000 - w.economy.credits);
    w.economy.restoreAp(60);
    config.build(w);
    w.economy.adjustCredits(-w.economy.credits);
    const power = calculatePower(w.placement.buildings());
    must(w.cycle.jumpToDay(night), 'day');
    return {w, power};
}

function nightRun(config, seed, night, brutes = true) {
    const {w, power} = fortress(config, seed, night, {brutes});
    const problems = power.status === PowerStatus.NORMAL ? [] : [`starts ${power.status}`];
    const [first] = w.placement.barracks();
    const script = config.chase ? flagScript(w, first.id, first.flag, (mutants) => mutants.filter(({kind}) => kind === 'brute')) : null;
    const seen = new Map(); // Brute id -> spawn tick
    const killTicks = [];
    const by = {cannon: 0, squad: 0, siege: 0};
    const lost = {};
    let contact = 0;
    const touched = new Set();
    let cannonShots = 0;
    let cannonShotsAtBrutes = 0;
    let ordinaryDamage = 0;
    w.cycle.endDay();
    while (w.cycle.shift === Shift.NIGHT) {
        w.cycle.stepTicks(1, (t) => {
            const {siege, defense, infantryShots, effects} = w.tick(t);
            const tick = w.cycle.elapsedNightTicks;
            const kill = (id, source) => {
                if (!seen.has(id)) return;
                by[source]++;
                killTicks.push(tick - seen.get(id));
            };
            for (const shot of defense.shots) {
                cannonShots++;
                if (seen.has(shot.mutantId)) cannonShotsAtBrutes++;
                if (shot.killed) kill(shot.mutantId, 'cannon');
            }
            for (const shot of infantryShots) if (shot.killed) kill(shot.mutantId, 'squad');
            for (const impact of siege.impacts) if (impact.killed) kill(impact.mutantId, 'siege');
            for (const {mutantId, damage} of effects.attacks) {
                if (seen.has(mutantId)) {
                    if (!touched.has(mutantId)) contact++;
                    touched.add(mutantId);
                } else ordinaryDamage += damage;
            }
            for (const id of effects.destroyed) {
                const type = id.split('-')[0];
                lost[type] = (lost[type] ?? 0) + 1;
            }
            for (const m of w.mutants.snapshot()) if (m.kind === 'brute' && !seen.has(m.id)) seen.set(m.id, tick);
        });
        if (script && w.clock.tick % 30 === 0 && w.cycle.shift === Shift.NIGHT) script();
        if (w.clock.tick % 60 === 0 && w.cycle.shift === Shift.NIGHT) problems.push(...checkInvariants(w));
    }
    if (w.cycle.shift === Shift.DAY && leftovers(w) > 0) problems.push('left over after dawn');
    const rebuild = Object.entries(lost).reduce((total, [type, n]) => total + n * getBuildingType(type).cost.credits, 0);
    return {
        brutes: seen.size, killed: by.cannon + by.squad + by.siege, ...by, killTicks, reached: contact, lost, rebuild, cannonShots, cannonShotsAtBrutes, ordinaryDamage,
        defeated: w.cycle.shift === Shift.DEFEATED, problems: [...new Set(problems)],
    };
}

function campaign(config, seed) {
    const {w} = fortress(config, seed, CAMPAIGN_FROM);
    const problems = [];
    while (w.cycle.shift === Shift.DAY && w.cycle.day <= CAMPAIGN_TO) {
        const night = w.cycle.day;
        w.cycle.endDay();
        while (w.cycle.shift === Shift.NIGHT) {
            w.cycle.stepTicks(240, w.tick);
            if (w.cycle.shift === Shift.NIGHT) problems.push(...checkInvariants(w));
        }
        if (w.cycle.shift === Shift.DAY && leftovers(w) > 0) problems.push(`left over after dawn ${night}`);
    }
    return {fell: w.cycle.defeatReport?.day ?? null, digest: digestOf(canonicalState(worldState(w))), problems: [...new Set(problems)].slice(0, 5)};
}

// ---- Siege against Spitters -------------------------------------------------

const barracks = (w) => {
    const {building} = w.place('barracks', 16, 8);
    must(w.placement.setFlag(building.id, {col: 15, row: 3}), 'flag');
    return {barracks: building.id, home: {col: 15, row: 3}};
};
const cannons = (w, cells) => { for (const [col, row] of cells) must(w.place('autocannon', col, row), 'cannon'); };
const THREE = [[10, 5], [14, 5], [12, 11]];
const SIEGE_SPOT = [15, 11]; // south-east of the ring: it answers the side the cannons leave open

const SPITTER_BASES = {
    '3 cannons (750c)': {build: (w) => cannons(w, THREE)},
    '5 cannons (1250c)': {build: (w) => cannons(w, [...THREE, [9, 8], [15, 8]])},
    '3 cannons + Rifle squad, static (1150c)': {build: (w) => { cannons(w, THREE); return barracks(w); }},
    '3 cannons + Rifle squad, scripted flag (1150c)': {build: (w) => { cannons(w, THREE); return barracks(w); }, active: true},
    '3 cannons + Siege (1350c)': {build: (w) => { cannons(w, THREE); must(w.place('siegeCannon', ...SIEGE_SPOT), 'siege'); }},
    '3 cannons + Siege + Rifle squad, static (1750c)': {
        build: (w) => { cannons(w, THREE); must(w.place('siegeCannon', ...SIEGE_SPOT), 'siege'); return barracks(w); },
    },
    '3 cannons + Siege + Rifle squad, scripted flag (1750c)': {
        build: (w) => { cannons(w, THREE); must(w.place('siegeCannon', ...SIEGE_SPOT), 'siege'); return barracks(w); }, active: true,
    },
};

const armedSpitters = (mutants) => mutants.filter((m) => m.shots > 0 && m.shots < SPITTER.maxShots);

/** The flag goes to a target, one move per target. Never what a player would exactly do. */
function flagScript(w, id, home, targets) {
    let chasing = null;
    const tileOf = ({x, y}) => ({
        col: Math.min(Math.max(Math.floor((x - w.grid.originX) / w.grid.tileSize), 0), w.grid.cols - 1),
        row: Math.min(Math.max(Math.floor((y - w.grid.originY) / w.grid.tileSize), 0), w.grid.rows - 1),
    });
    const send = ({col, row}) => [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]
        .some(([dc, dr]) => w.placement.setFlag(id, {col: col + dc, row: row + dr}).ok);
    return () => {
        if (!w.placement.barracks().some((b) => b.id === id)) return;
        const wanted = targets(w.mutants.snapshot());
        const target = wanted.find((m) => m.id === chasing) ?? wanted[0];
        if (target && target.id !== chasing && send(tileOf(target))) chasing = target.id;
        else if (!target && chasing) {
            chasing = null;
            w.placement.setFlag(id, home);
        }
    };
}

function spitterRun(base, seed) {
    const w = createWorld({seed, resources: FUNDS, requireHq: true, roads: true});
    must(w.place('hq', 12, 8), 'hq');
    must(w.place('powerPlant', 12, 3), 'plant');
    const extra = base.build(w) ?? {};
    w.economy.adjustCredits(-w.economy.credits);
    const script = base.active ? flagScript(w, extra.barracks, extra.home, armedSpitters) : null;
    const tally = {spitters: 0, shotsUsed: 0, shellsLanded: 0, shellDamage: 0, armedKilledBySiege: 0, armedKilledByCannon: 0, armedKilledBySquad: 0, siegeShots: 0, siegeShotsAtSpitters: 0, siegeKills: 0};
    const problems = [];
    const shots = new Map(); // living Spitter id -> shots left
    let ticks = 0;
    for (let night = 1; night <= SPITTER_NIGHTS && w.cycle.shift === Shift.DAY; night++) {
        w.cycle.endDay();
        while (w.cycle.shift === Shift.NIGHT) {
            w.cycle.stepTicks(1, (t) => {
                const {siege, defense, infantryShots, effects} = w.tick(t);
                ticks++;
                const kill = (id, key) => {
                    if (shots.has(id) && shots.get(id) > 0) tally[key]++;
                };
                for (const shot of defense.shots) if (shot.killed) kill(shot.mutantId, 'armedKilledByCannon');
                for (const shot of infantryShots) if (shot.killed) kill(shot.mutantId, 'armedKilledBySquad');
                for (const impact of siege.impacts) {
                    if (!impact.killed) continue;
                    tally.siegeKills++;
                    kill(impact.mutantId, 'armedKilledBySiege');
                }
                for (const {mutantId} of siege.fired) {
                    tally.siegeShots++;
                    if (shots.has(mutantId)) tally.siegeShotsAtSpitters++;
                }
                tally.shellsLanded += effects.impacts?.length ?? 0;
                tally.shellDamage += effects.attacks.filter(({damage}) => damage === SPITTER.damage).reduce((total, {damage}) => total + damage, 0);
                for (const m of w.mutants.snapshot()) {
                    if (m.kind !== SPITTER.kind) continue;
                    if (!shots.has(m.id)) tally.spitters++;
                    tally.shotsUsed += (shots.get(m.id) ?? SPITTER.maxShots) - m.shots;
                    shots.set(m.id, m.shots);
                }
            });
            if (script && ticks % 30 === 0 && w.cycle.shift === Shift.NIGHT) script();
            if (ticks % 120 === 0) problems.push(...checkInvariants(w));
        }
        shots.clear();
        if (w.cycle.shift === Shift.DAY && leftovers(w) > 0) problems.push(`left over after dawn ${night}`);
    }
    return {fell: w.cycle.defeatReport?.day ?? null, ...tally, problems: [...new Set(problems)].slice(0, 5)};
}

// ---- Report -----------------------------------------------------------------

const report = {note: 'Synthetic, report-only. Not a playtest.', seeds: SEEDS.length, killSpeed: {}, fortressNights: {}, fortressCampaigns: {}, spitters: {}, problems: []};
const note = (problems, where) => {
    if (problems.length === 0) return;
    report.problems.push({where, problems: problems.slice(0, 5)});
    console.log('PROBLEM', where, problems.slice(0, 5));
};

console.log('--- kill speed: one Brute from the west');
for (const [name, build] of Object.entries(DEFENDERS)) {
    report.killSpeed[name] = killSpeed(build);
    console.log(name.padEnd(34), JSON.stringify(report.killSpeed[name]));
}

console.log('--- golden fortress, single Nights from a whole base, flags static (10 seeds)');
for (const [name, config] of Object.entries(FORTRESS)) {
    for (const night of [30, 35, 40]) {
        const runs = SEEDS.map((seed) => nightRun(config, seed, night));
        for (const run of runs) note(run.problems, `${name} night ${night}`);
        const lost = runs.reduce((all, run) => {
            for (const [type, n] of Object.entries(run.lost)) all[type] = (all[type] ?? 0) + n;
            return all;
        }, {});
        const entry = {
            brutes: sum(runs, 'brutes'), killed: sum(runs, 'killed'), byCannon: sum(runs, 'cannon'), bySquad: sum(runs, 'squad'), bySiege: sum(runs, 'siege'),
            reached: sum(runs, 'reached'), medianLifeTicks: median(runs.flatMap((r) => r.killTicks)),
            rebuildPerNight: Math.round(sum(runs, 'rebuild') / runs.length), lost, ordinaryDamage: sum(runs, 'ordinaryDamage'),
            cannonShotsAtBrutes: Math.round(100 * sum(runs, 'cannonShotsAtBrutes') / Math.max(1, sum(runs, 'cannonShots'))), defeats: runs.filter((r) => r.defeated).length,
        };
        report.fortressNights[`${name}: Night ${night}`] = entry;
        console.log(`${name} N${night}`, JSON.stringify(entry));
    }
}

console.log(`--- golden fortress, campaign from Night ${CAMPAIGN_FROM}, nobody playing (10 seeds)`);
for (const [name, config] of Object.entries(FORTRESS).filter(([, {chase}]) => !chase)) {
    const runs = SEEDS.map((seed) => campaign(config, seed));
    for (const run of runs) note(run.problems, `${name} campaign`);
    if (campaign(config, SEEDS[0]).digest !== runs[0].digest) note(['did not repeat'], name);
    const fell = runs.map((r) => r.fell ?? CAMPAIGN_TO + 1);
    const entry = {spent: config.spent, medianFell: median(fell), earliest: Math.min(...fell), survived: runs.filter((r) => r.fell === null).length};
    report.fortressCampaigns[name] = entry;
    console.log(name, JSON.stringify(entry));
}

console.log(`--- Siege against Spitters, Nights 1-${SPITTER_NIGHTS}, no income (10 seeds)`);
for (const [name, base] of Object.entries(SPITTER_BASES)) {
    const runs = SEEDS.map((seed) => spitterRun(base, seed));
    for (const run of runs) note(run.problems, name);
    const spitters = sum(runs, 'spitters');
    const entry = {
        medianFell: median(runs.map((r) => r.fell ?? SPITTER_NIGHTS + 1)), survived: runs.filter((r) => r.fell === null).length, spitters,
        shotsPerSpitter: Math.round(100 * sum(runs, 'shotsUsed') / Math.max(1, spitters)) / 100, shellDamage: sum(runs, 'shellDamage'),
        armedKilledBySiege: sum(runs, 'armedKilledBySiege'), armedKilledByCannon: sum(runs, 'armedKilledByCannon'), armedKilledBySquad: sum(runs, 'armedKilledBySquad'),
        siegeShots: sum(runs, 'siegeShots'), siegeShotsAtSpitters: sum(runs, 'siegeShotsAtSpitters'), siegeKills: sum(runs, 'siegeKills'),
    };
    report.spitters[name] = entry;
    console.log(name, JSON.stringify(entry));
}

mkdirSync('soak-results', {recursive: true});
writeFileSync('soak-results/heavy.json', JSON.stringify(report, null, 2));
const failed = report.problems.length > 0;
console.log(failed ? 'FAILED' : 'passed');
process.exit(failed ? 1 : 0);
