import test from 'node:test';
import assert from 'node:assert/strict';
import {ADVICE} from '../../src/content/advice.js';
import {manualPages} from '../../src/content/fieldManual.js';
import {ADVICE_STORAGE_KEY, ADVICE_TIMING, PresidentialAdvice, parseAdviceSettings} from '../../src/scenes/presidentialAdvice.js';

/** TASK 033.3: Presidential Advice. The catalogue and the controller, without Phaser. */

/** A Day 0 with nothing built, and how each later moment differs from it. */
const BASE = Object.freeze({
    shift: 'day', deployment: true, activeDay: false, day: true, hqBuilt: false, defences: 0, factories: 0, mines: 0,
    barracksWithoutFlag: 0, workFlag: false, ap: 5, power: 'normal', powerWarning: false, pollution: 0, deliveries: 0,
    protest: false, depositRevealed: false, minePlacing: false,
});
const facts = (changes = {}) => ({...BASE, ...changes});
const ACTIVE_DAY = {deployment: false, activeDay: true, hqBuilt: true, defences: 1};

function memoryStorage(initial = {}) {
    const data = {...initial};
    return {data, get: (key) => data[key] ?? null, set: (key, value) => { data[key] = value; }};
}

/** Run the controller for `ms` of unblocked presentation time. */
function run(advice, ms, world, step = 50) {
    for (let t = 0; t < ms; t += step) advice.update(step, {blocked: false, facts: () => world});
    return advice.view();
}

const eligible = (f) => ADVICE.filter((tip) => tip.when(f)).map((tip) => tip.id);

test('the catalogue: unique ids, a title and words, and a BOOK page that exists in the Little Yellow Book', () => {
    const headings = new Set(manualPages().map((p) => p.heading));
    assert.equal(new Set(ADVICE.map((t) => t.id)).size, ADVICE.length);
    for (const tip of ADVICE) {
        assert.ok(tip.title && tip.text, tip.id);
        assert.ok(headings.has(tip.book), `${tip.id}: ${tip.book} is a page`);
        assert.ok('voice' in tip, `${tip.id} keeps a place for a recorded line`);
    }
    assert.match(ADVICE.find((t) => t.id === 'barracks').commentary, /COUNTRY STROKE/);
});

test('Day 0: build HQ first; then defences; never workers, which cannot go out in Day 0', () => {
    assert.deepEqual(eligible(facts()), ['build-hq']);
    assert.deepEqual(eligible(facts({hqBuilt: true})), ['night-defence']);
    assert.deepEqual(eligible(facts({hqBuilt: true, defences: 1})), []);
    for (const f of [facts(), facts({hqBuilt: true}), facts({hqBuilt: true, defences: 2, ap: 0})]) {
        assert.equal(eligible(f).includes('workers'), false, 'no work flag tip in Day 0');
    }
    assert.ok(eligible(facts(ACTIVE_DAY)).includes('workers'), 'it comes on the first active Day');
    assert.equal(eligible(facts({...ACTIVE_DAY, workFlag: true})).includes('workers'), false, 'not once a flag is down');
});

test('each trigger answers its own facts', () => {
    const day = {...ACTIVE_DAY, workFlag: true};
    const cases = {
        'low-power': {power: 'low-power'},
        logistics: {factories: 1},
        'action-points': {ap: 0},
        barracks: {barracksWithoutFlag: 1},
        mining: {depositRevealed: true},
        pollution: {pollution: 3},
        ecologists: {protest: true},
    };
    for (const [id, change] of Object.entries(cases)) assert.deepEqual(eligible(facts({...day, ...change})), [id], id);
    assert.deepEqual(eligible(facts({...day, power: 'low-power', powerWarning: true})), [], 'the LOW POWER placement warning already says it');
    assert.deepEqual(eligible(facts({...day, factories: 1, deliveries: 2})), [], 'deliveries already work');
    assert.deepEqual(eligible(facts({...day, minePlacing: true})), ['mining'], 'choosing a Mine');
    assert.deepEqual(eligible(facts({...day, depositRevealed: true, mines: 1})), [], 'a Mine stands');
    assert.deepEqual(eligible(facts({...day, shift: 'night', day: false, ap: 0, pollution: 5})), [], 'no Day-only tips at Night');
});

test('one tip at a time, the highest priority first, after the first short wait', () => {
    const advice = new PresidentialAdvice({storage: memoryStorage()});
    const world = facts({...ACTIVE_DAY, power: 'low-power', factories: 1});
    assert.equal(run(advice, ADVICE_TIMING.firstMs - 100, world).visible, false, 'not before the first wait');
    const view = run(advice, 400, world);
    assert.equal(view.tip.id, 'low-power');
    assert.equal(view.visible, true);
});

test('dismissing ends it as seen; the next waits for the cooldown, an urgent one only for the short gap', () => {
    const advice = new PresidentialAdvice({storage: memoryStorage()});
    const world = facts({...ACTIVE_DAY, factories: 1}); // workers and logistics both apply
    assert.equal(run(advice, 1000, world).tip.id, 'workers');
    assert.equal(advice.dismiss(), true);
    assert.equal(advice.view().visible, false);
    assert.ok(advice.view().seen.includes('workers'));
    assert.equal(run(advice, ADVICE_TIMING.cooldownMs - 500, world).visible, false, 'cooldown');
    assert.equal(run(advice, 1000, world).tip.id, 'logistics');
    advice.dismiss();
    const urgent = facts({...ACTIVE_DAY, factories: 1, power: 'low-power'});
    assert.equal(run(advice, ADVICE_TIMING.urgentMs - 300, urgent).visible, false);
    assert.equal(run(advice, 600, urgent).tip.id, 'low-power', 'urgent after the short gap');
    assert.equal(advice.dismiss(), true);
    assert.equal(advice.dismiss(), false, 'nothing left to dismiss');
});

test('stale: a tip that stops applying before it shows never shows; one showing goes when the player does it, as seen', () => {
    const advice = new PresidentialAdvice({storage: memoryStorage()});
    advice.update(100, {blocked: false, facts: () => facts()}); // HQ tip still waiting for its first wait
    let view = run(advice, 2000, facts({hqBuilt: true, defences: 1})); // HQ and a cannon built quickly
    assert.equal(view.visible, false, 'nothing stale shows');
    assert.deepEqual(view.seen, [], 'and nothing unseen is marked seen');

    const second = new PresidentialAdvice({storage: memoryStorage()});
    assert.equal(run(second, 1000, facts()).tip.id, 'build-hq');
    view = run(second, 300, facts({hqBuilt: true}));
    assert.notEqual(view.tip?.id, 'build-hq', 'gone once HQ stands');
    assert.ok(view.seen.includes('build-hq'), 'the player did it');
});

test('read for long enough counts as seen; left alone it goes by itself', () => {
    const advice = new PresidentialAdvice({storage: memoryStorage()});
    run(advice, 1000, facts());
    assert.deepEqual(run(advice, ADVICE_TIMING.readMs - 500, facts()).seen, []);
    assert.deepEqual(run(advice, 1000, facts()).seen, ['build-hq']);
    assert.equal(run(advice, ADVICE_TIMING.showMs, facts()).visible, false);
});

test('blocked (a modal, the menu, La Voz): hidden, its time stands still, and it settles before showing again', () => {
    const advice = new PresidentialAdvice({storage: memoryStorage()});
    run(advice, 1000, facts());
    assert.equal(advice.visible, true);
    for (let i = 0; i < 100; i++) advice.update(100, {blocked: true, facts: () => facts()});
    let view = advice.view();
    assert.deepEqual([view.visible, view.suppressed, view.pending], [false, true, 'build-hq']);
    assert.deepEqual(view.seen, [], 'ten blocked seconds read nothing');
    assert.equal(advice.dismiss(), false, 'nothing to dismiss while hidden');
    view = run(advice, 100, facts());
    assert.equal(view.visible, true, 'the same tip comes back');

    const fresh = new PresidentialAdvice({storage: memoryStorage()});
    for (let i = 0; i < 50; i++) fresh.update(100, {blocked: true, facts: () => { throw new Error('facts read while blocked'); }});
    assert.equal(run(fresh, ADVICE_TIMING.firstMs + 100, facts()).visible, true, 'after Start, only the first short wait');
    fresh.dismiss();
    const later = facts({hqBuilt: true}); // night-defence would apply, after the cooldown
    run(fresh, ADVICE_TIMING.cooldownMs - 1000, later);
    for (let i = 0; i < 50; i++) fresh.update(100, {blocked: true, facts: () => later});
    assert.equal(run(fresh, ADVICE_TIMING.settleMs - 200, later).visible, false, 'back from a modal: it settles first');
    assert.equal(run(fresh, 1200, later).tip.id, 'night-defence');
});

test('a change of shift settles too, so nothing lands on top of it', () => {
    const advice = new PresidentialAdvice({storage: memoryStorage()});
    run(advice, 1000, facts());
    advice.dismiss();
    run(advice, ADVICE_TIMING.cooldownMs, facts({hqBuilt: true, defences: 1}));
    const dawn = facts({...ACTIVE_DAY});
    assert.equal(run(advice, ADVICE_TIMING.settleMs - 200, dawn).visible, false);
    assert.equal(run(advice, 400, dawn).tip.id, 'workers');
});

test('seen tips are remembered across restarts; storage is versioned', () => {
    const storage = memoryStorage();
    const first = new PresidentialAdvice({storage});
    run(first, 1000, facts());
    first.dismiss();
    assert.deepEqual(JSON.parse(storage.data[ADVICE_STORAGE_KEY]), {version: 1, enabled: true, seen: ['build-hq']});
    const restarted = new PresidentialAdvice({storage});
    assert.equal(run(restarted, 5000, facts()).visible, false, 'not again after a restart');
    assert.deepEqual(restarted.view().seen, ['build-hq']);
});

test('OFF hides tips and is saved; ON brings them back; RESET shows them again', () => {
    const storage = memoryStorage();
    const advice = new PresidentialAdvice({storage});
    run(advice, 1000, facts());
    advice.setEnabled(false);
    assert.deepEqual([advice.view().enabled, advice.view().visible], [false, false]);
    assert.deepEqual(advice.view().seen, [], 'switching off reads nothing');
    assert.equal(new PresidentialAdvice({storage}).enabled, false, 'saved');
    assert.equal(run(advice, 5000, facts()).visible, false);
    advice.setEnabled(true);
    assert.equal(run(advice, 2000, facts()).tip.id, 'build-hq');
    advice.dismiss();
    advice.reset();
    assert.deepEqual(advice.view().seen, []);
    assert.equal(run(advice, ADVICE_TIMING.settleMs + 100, facts()).tip.id, 'build-hq', 'shown again, this run too');
});

test('storage that is blocked, missing or corrupt never breaks advice', () => {
    const throwing = {get() { throw new Error('blocked'); }, set() { throw new Error('blocked'); }};
    const advice = new PresidentialAdvice({storage: throwing});
    assert.equal(run(advice, 1000, facts()).tip.id, 'build-hq');
    assert.equal(advice.dismiss(), true);
    advice.setEnabled(false);
    assert.equal(new PresidentialAdvice({storage: null}).enabled, true);
    for (const raw of ['not json', '{"version":2,"enabled":false,"seen":[]}', '{"version":1,"enabled":"no","seen":[]}', null]) {
        assert.equal(parseAdviceSettings(raw), null, String(raw));
        assert.equal(new PresidentialAdvice({storage: memoryStorage({[ADVICE_STORAGE_KEY]: raw})}).enabled, true, 'defaults');
    }
});

test('?tips=off: no tips this session, and nothing a player saved is changed', () => {
    const storage = memoryStorage({[ADVICE_STORAGE_KEY]: JSON.stringify({version: 1, enabled: true, seen: ['workers']})});
    const before = storage.data[ADVICE_STORAGE_KEY];
    const advice = new PresidentialAdvice({storage, forcedOff: true});
    assert.equal(run(advice, 5000, facts()).visible, false);
    advice.setEnabled(false);
    advice.reset();
    assert.deepEqual([advice.view().enabled, advice.view().forcedOff], [false, true]);
    assert.equal(storage.data[ADVICE_STORAGE_KEY], before);
});

test('the facts are read at most every evaluateMs, and Math.random is never asked', () => {
    const real = Math.random;
    Math.random = () => { throw new Error('Math.random asked'); };
    try {
        let reads = 0;
        const advice = new PresidentialAdvice({storage: memoryStorage()});
        for (let i = 0; i < 100; i++) advice.update(10, {blocked: false, facts: () => { reads++; return facts(); }});
        assert.ok(reads <= Math.ceil(1000 / ADVICE_TIMING.evaluateMs) + 1, `${reads} reads in a second`);
    } finally {
        Math.random = real;
    }
});
