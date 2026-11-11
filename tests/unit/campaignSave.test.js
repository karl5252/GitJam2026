/**
 * TASK 043: the campaign save slot (src/scenes/campaignStorage.js) over the dawn
 * checkpoint (src/core/dawnCheckpoint.js). Real checkpoints from the soak harness on
 * the jungle map; storage is a stand-in here, and the browser's own localStorage is
 * exercised in tests/e2e/campaignSave.spec.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {atDawnHold, captureDawn, checkpointProblem, restoreDawn} from '../../src/core/dawnCheckpoint.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {FogOfWar, startingKnown} from '../../src/core/vision.js';
import {WORLD_MAPS, createTerrain} from '../../src/core/worldMap.js';
import {endingDue} from '../../src/scenes/presidentialEnding.js';
import {
    CAMPAIGN_KEY, CAMPAIGN_VERSION, ENDED_KEY, SaveFailure, endCampaign, endedCampaigns, newCampaign, readCampaign, worldOf, writeCampaign,
} from '../../src/scenes/campaignStorage.js';
import {loadLayout} from '../../src/testShadow/layoutSnapshot.js';
import {checkInvariants, createWorld} from '../soak/harness.js';

const MAP = WORLD_MAPS.jungle;
const WORLD = worldOf({map: MAP, worldSeed: MAP.seed, rngSeed: 731});
const OTHER_KEYS = {papi_profile: '{"version":1,"presidentialEndingSeen":true}', papi_advice: '{"version":1,"enabled":true,"seen":["x"]}', papi_audio: '{"version":2}'};

/** localStorage's contract, in memory; `refuse` makes writes fail as a full or blocked store does. */
function memoryStorage(initial = {}) {
    const data = new Map(Object.entries(initial));
    const storage = {
        data, refuse: false, throws: false,
        get: (key) => (storage.throws ? (() => { throw new Error('blocked'); })() : data.get(key) ?? null),
        set: (key, value) => {
            if (storage.throws) throw new Error('QuotaExceededError');
            if (storage.refuse) return false;
            data.set(key, value);
            return true;
        },
        remove: (key) => data.delete(key) || true,
    };
    return storage;
}

function build({begin = true, schedule = []} = {}) {
    const terrain = createTerrain(MAP, MAP.seed);
    const w = createWorld({requireHq: true, roads: true, resources: {credits: 9000, ap: 40}, schedule, active: true, map: MAP, terrain, ecologists: true, pollution: 20, begin});
    w.fog = new FogOfWar({cols: MAP.cols, rows: MAP.rows, explored: startingKnown(terrain)});
    return w;
}

const run = (w, ticks) => {
    for (let i = 0; i < ticks && w.cycle.active; i++) if (w.cycle.stepTicks(1, w.tick) === 0) break;
};

function toDawn(w) {
    const day = w.cycle.day;
    for (let guard = 0; !(w.cycle.shift === Shift.DAY && w.cycle.day > day) && guard < 20_000; guard++) run(w, 1);
}

/** A small base at its first saved dawn: HQ, Plant and a Factory on a road. */
function dawnCheckpoint() {
    const w = build();
    const {center} = w.grid.terrain;
    w.place('hq', center.col, center.row);
    w.place('powerPlant', center.col + 5, center.row);
    for (const col of [center.col - 3, center.col - 4]) w.placement.placeRoad({col, row: center.row});
    w.place('factory', center.col - 6, center.row);
    w.cycle.endDay();
    toDawn(w);
    return {w, checkpoint: captureDawn(w)};
}

const CHECKPOINT = dawnCheckpoint().checkpoint;
const campaignA = {id: 'campaign-a', startedAt: 1000};
const write = (storage, campaign = campaignA, checkpoint = CHECKPOINT, now = 5000) => writeCampaign(storage, {campaign, world: WORLD, checkpoint, now});
const stored = (storage) => JSON.parse(storage.data.get(CAMPAIGN_KEY));

test('a dawn is saved whole under papi_campaign and read back exactly; profile, advice and audio are never touched', () => {
    const storage = memoryStorage(OTHER_KEYS);
    assert.deepEqual(write(storage), {ok: true});
    const save = stored(storage);
    assert.deepEqual({...save, checkpoint: null}, {
        format: 'papi-campaign', version: CAMPAIGN_VERSION, campaignId: 'campaign-a', startedAt: 1000, savedAt: 5000, world: WORLD, checkpoint: null,
    });
    const read = readCampaign(storage, WORLD);
    assert.equal(read.ok, true);
    assert.deepEqual(read.save.checkpoint, CHECKPOINT);
    for (const [key, value] of Object.entries(OTHER_KEYS)) assert.equal(storage.data.get(key), value, key);
    endCampaign(storage, campaignA.id);
    for (const [key, value] of Object.entries(OTHER_KEYS)) assert.equal(storage.data.get(key), value, `${key} after the campaign ended`);
    assert.equal(JSON.stringify(CHECKPOINT).length < 50_000, true, 'small enough for localStorage many times over');
});

test('every malformed, unsupported, invalid or foreign save is refused, and nothing is changed by reading it', () => {
    const cases = [
        [null, SaveFailure.NONE],
        ['{not json', SaveFailure.MALFORMED],
        [JSON.stringify([1, 2]), SaveFailure.MALFORMED],
        [JSON.stringify({format: 'something-else'}), SaveFailure.MALFORMED],
    ];
    for (const [raw, reason] of cases) {
        const storage = memoryStorage(raw === null ? {} : {[CAMPAIGN_KEY]: raw});
        assert.equal(readCampaign(storage, WORLD).reason, reason, String(raw));
        assert.equal(storage.data.get(CAMPAIGN_KEY) ?? null, raw, 'reading never rewrites');
    }
    const good = memoryStorage();
    write(good);
    const tampered = (edit) => {
        const save = stored(good);
        edit(save);
        return readCampaign(memoryStorage({[CAMPAIGN_KEY]: JSON.stringify(save)}), WORLD);
    };
    assert.equal(tampered((s) => { s.version = 2; }).reason, SaveFailure.UNSUPPORTED_VERSION);
    assert.equal(tampered((s) => { delete s.savedAt; }).reason, SaveFailure.MALFORMED);
    assert.equal(tampered((s) => { s.extra = 1; }).reason, SaveFailure.MALFORMED);
    assert.equal(tampered((s) => { s.campaignId = ''; }).reason, SaveFailure.MALFORMED);
    assert.equal(tampered((s) => { s.checkpoint.logistics.trucks[0].cargo = -1; }).reason, SaveFailure.INVALID_CHECKPOINT);
    assert.equal(tampered((s) => { s.checkpoint.placement = null; }).reason, SaveFailure.INVALID_CHECKPOINT);
    assert.equal(tampered((s) => { s.checkpoint.day = 1; }).reason, SaveFailure.INVALID_CHECKPOINT);
    assert.equal(tampered((s) => { s.world.worldSeed += 1; }).reason, SaveFailure.INCOMPATIBLE_WORLD);
    assert.equal(tampered((s) => { s.world.rngSeed += 1; }).reason, SaveFailure.INCOMPATIBLE_WORLD);
});

test('checkpointProblem names the broken section, and restoreDawn refuses before touching the world', () => {
    assert.equal(checkpointProblem(CHECKPOINT), null);
    const broken = (edit) => {
        const c = structuredClone(CHECKPOINT);
        edit(c);
        return checkpointProblem(c);
    };
    assert.equal(broken((c) => { c.economy.ap = -1; }), 'economy');
    assert.equal(broken((c) => { c.rng.state = 2 ** 33; }), 'rng');
    assert.equal(broken((c) => { c.terrain.cleared.push({col: 'x'}); }), 'terrain');
    assert.equal(broken((c) => { c.workers.orders.push({buildingId: 7, ticks: 0}); }), 'workers work');
    assert.equal(broken((c) => { delete c.mutants; }), 'mutants');
    const r = build({begin: false});
    assert.throws(() => restoreDawn(r, {...CHECKPOINT, economy: null}), /invalid checkpoint: economy/);
    assert.equal(r.cycle.started, false);
    assert.equal(r.placement.buildings().length, 0);
});

test('a failed write never throws and never damages the last good save', () => {
    const storage = memoryStorage();
    write(storage);
    const before = storage.data.get(CAMPAIGN_KEY);
    storage.refuse = true; // full, or blocked
    assert.deepEqual(write(storage, campaignA, {...CHECKPOINT, day: CHECKPOINT.day + 1}), {ok: false, reason: SaveFailure.STORAGE});
    assert.equal(storage.data.get(CAMPAIGN_KEY), before);
    storage.refuse = false;
    storage.throws = true; // a storage that throws, as a quota error does
    assert.deepEqual(write(storage, campaignA, {...CHECKPOINT, day: CHECKPOINT.day + 1}), {ok: false, reason: SaveFailure.STORAGE});
    assert.deepEqual(endCampaign(storage, campaignA.id), {removed: false, recorded: false});
    assert.equal(readCampaign(storage).reason, SaveFailure.NONE, 'unreadable storage reads as no save');
    storage.throws = false;
    assert.equal(storage.data.get(CAMPAIGN_KEY), before);
});

test('several tabs: a campaign never overwrites a later dawn of its own, nor a newer campaign; a New Game replaces an older one', () => {
    const storage = memoryStorage();
    const later = {...CHECKPOINT, day: CHECKPOINT.day + 3};
    assert.equal(write(storage, campaignA, later).ok, true);
    assert.deepEqual(write(storage, campaignA, CHECKPOINT), {ok: false, reason: SaveFailure.OLDER}, 'a stale tab of the same campaign');
    assert.equal(stored(storage).checkpoint.day, later.day);
    assert.equal(write(storage, campaignA, later).ok, true, 'the same dawn again is harmless');

    const campaignB = {id: 'campaign-b', startedAt: 2000}; // a New Game started after A
    assert.equal(write(storage, campaignB).ok, true, 'B replaces A at its first dawn');
    assert.equal(stored(storage).campaignId, 'campaign-b');
    assert.deepEqual(write(storage, campaignA, {...later, day: later.day + 1}), {ok: false, reason: SaveFailure.SUPERSEDED}, 'A\'s old tab cannot take the slot back');
    assert.equal(stored(storage).campaignId, 'campaign-b');
    const id = newCampaign(3000);
    assert.equal(typeof id.id, 'string');
    assert.notEqual(newCampaign(3000).id, id.id, 'every New Game is a campaign of its own');
});

test('an ended campaign is gone for every tab: its save is removed, never written or offered again; another campaign\'s save stays', () => {
    const storage = memoryStorage(OTHER_KEYS);
    write(storage);
    assert.deepEqual(endCampaign(storage, campaignA.id), {removed: true, recorded: true});
    assert.equal(storage.data.has(CAMPAIGN_KEY), false);
    assert.deepEqual(endedCampaigns(storage), ['campaign-a']);
    assert.deepEqual(write(storage, campaignA, {...CHECKPOINT, day: CHECKPOINT.day + 1}), {ok: false, reason: SaveFailure.ENDED}, 'a stale tab cannot bring it back');
    assert.equal(storage.data.has(CAMPAIGN_KEY), false);

    // A save that slipped in anyway (an older build, a hand edit) is still not offered.
    storage.data.set(CAMPAIGN_KEY, JSON.stringify({format: 'papi-campaign', version: 1, campaignId: 'campaign-a', startedAt: 1000, savedAt: 1, world: WORLD, checkpoint: CHECKPOINT}));
    assert.equal(readCampaign(storage, WORLD).reason, SaveFailure.ENDED);

    const other = memoryStorage();
    write(other, {id: 'campaign-b', startedAt: 2000});
    assert.deepEqual(endCampaign(other, campaignA.id), {removed: false, recorded: true}, 'ending A leaves B\'s save alone');
    assert.equal(stored(other).campaignId, 'campaign-b');
    for (let i = 0; i < 30; i++) endCampaign(other, `old-${i}`);
    assert.equal(endedCampaigns(other).length, 20, 'the list stays short');
    assert.equal(other.data.get(ENDED_KEY).includes('old-29'), true);
});

test('restoring the same save again and again creates nothing: the same buildings, Credits, cargo and counters every time', () => {
    const storage = memoryStorage();
    write(storage);
    let checkpoint = readCampaign(storage, WORLD).save.checkpoint;
    for (let i = 0; i < 3; i++) {
        const r = build({begin: false});
        restoreDawn(r, checkpoint);
        const again = captureDawn(r);
        assert.deepEqual(again, CHECKPOINT, `restore ${i + 1}`);
        assert.deepEqual(checkInvariants(r), []);
        write(storage, campaignA, again);
        checkpoint = readCampaign(storage, WORLD).save.checkpoint;
    }
});

test('a mature colony, saved and continued, plays on for several days with its whole base, and saves again each dawn', () => {
    const fixture = JSON.parse(readFileSync(new URL('../fixtures/layouts/golden-fortress-jungle-v3.json', import.meta.url), 'utf8'));
    const w = build({schedule: null});
    assert.equal(loadLayout(w, fixture).ok, true);
    w.cycle.endDay();
    toDawn(w);
    toDawn(w);
    const storage = memoryStorage();
    assert.equal(writeCampaign(storage, {campaign: campaignA, world: WORLD, checkpoint: captureDawn(w)}).ok, true);

    const r = build({begin: false, schedule: null});
    restoreDawn(r, readCampaign(storage, WORLD).save.checkpoint);
    r.cycle.resume();
    assert.deepEqual(r.placement.buildings(), w.placement.buildings());
    assert.equal(r.placement.buildings().length, fixture.buildings.length);
    for (let day = 0; day < 3 && r.cycle.shift !== Shift.DEFEATED; day++) {
        toDawn(r);
        if (r.cycle.shift === Shift.DEFEATED) break;
        assert.equal(atDawnHold(r.cycle), true);
        assert.deepEqual(checkInvariants(r), [], `dawn of day ${r.cycle.day}`);
        const next = captureDawn(r);
        assert.equal(writeCampaign(storage, {campaign: campaignA, world: WORLD, checkpoint: next}).ok, true);
        assert.equal(readCampaign(storage, WORLD).save.checkpoint.day, r.cycle.day);
        assert.equal(new Set(r.placement.buildings().map((b) => b.id)).size, r.placement.buildings().length, 'no duplicate building');
    }
    assert.ok(r.cycle.day >= w.cycle.day + 2, `played on to day ${r.cycle.day}`);
});

test('a save at Day 100\'s dawn restores to the ending\'s own dawn; the clock tick restarts at 0 and nothing reads it', () => {
    const late = {...structuredClone(CHECKPOINT), day: 101};
    const r = build({begin: false});
    restoreDawn(r, late);
    assert.equal(atDawnHold(r.cycle), true);
    assert.equal(endingDue({timed: r.cycle.timed, deployment: r.cycle.deployment, shift: r.cycle.shift, day: r.cycle.day}), true);
    assert.equal(r.clock.tick, 0, 'the absolute tick is not part of a campaign');
    r.cycle.resume();
    run(r, 120);
    assert.deepEqual([r.cycle.day, r.cycle.elapsedDayTicks], [101, 120], 'the Day runs by its own counters');
});
