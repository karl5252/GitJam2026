/**
 * TASK 029, LA VOZ DE SAN PAPI: the edition builder (pure data) and ShiftCycle's
 * exact dawn hold.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {edition, fitLines, stories} from '../../src/content/newspaper.js';
import {CONTEXT_COLUMNS, LEADS, NOTICES, WORLD_COLUMNS, noticeForIssue} from '../../src/content/newspaperStories.js';
import {Economy} from '../../src/core/economy.js';
import {DAY_TICKS, DUSK_TICKS, Shift, ShiftCycle} from '../../src/core/shiftCycle.js';
import {SimulationClock} from '../../src/core/simulationClock.js';

const SETTLEMENT = Object.freeze({
    day: 3, gross: 0, upkeep: 0, net: 0, creditsBefore: 900, creditsAfter: 900,
    counts: {}, power: {generation: 120, demand: 55, status: 'normal'},
    pollution: {before: 20, emitted: 12, after: 32, threatLevel: 2},
});

test('an edition is plain frozen data: the new Day\'s issue, the completed Night\'s period and its real figures', () => {
    const e = edition({issue: 3, settlement: SETTLEMENT, delivered: 360});
    assert.equal(e.masthead, 'LA VOZ DE SAN PAPI');
    assert.equal(e.issue, 3);
    assert.equal(e.night, 3);
    assert.match(e.dateLine, /No\. 3 · Día 3 · Reporting Night 3/);
    assert.equal(e.figuresTitle, 'CIFRAS OFICIALES · NIGHT\u00A03'); // a non-breaking space: the number stays with NIGHT
    assert.deepEqual(e.figures.map(({label, value}) => `${label} ${value}`), [
        'Income +360', 'Upkeep 0', 'Net +360', 'Credits 900', 'Power NORMAL', 'Pollution 32 (+12)', 'Threat 2',
    ]);
    assert.ok(Object.isFrozen(e) && Object.isFrozen(e.lead) && Object.isFrozen(e.columns[0]) && Object.isFrozen(e.figures[0]));
    assert.deepEqual(edition({issue: 3, settlement: SETTLEMENT, delivered: 360}), e, 'the same input gives the same edition');
});

// ---- TASK 034: Presidential Decrees and the wider Republic ------------------------------

const PLACEHOLDER = /TBD|Lorem|ipsum|placeholder/i;
const allStories = () => [...LEADS, ...WORLD_COLUMNS, ...CONTEXT_COLUMNS];
const settlementWith = ({power = 'normal', emitted = 0, threat = 1, factory = 0, mine = 0} = {}) => ({
    ...SETTLEMENT, power: {...SETTLEMENT.power, status: power}, pollution: {...SETTLEMENT.pollution, emitted, threatLevel: threat}, counts: {factory, mine},
});

test('the pool: every story has an id unique across all three kinds, every slot written, no placeholder left anywhere in an edition', () => {
    const ids = allStories().map((s) => s.id);
    // The content contract, not a fixed total: a lead for every issue, three world columns for the
    // desktop's three slots, and context stories for what really happened.
    assert.ok(LEADS.length >= 1, 'at least one lead');
    assert.ok(WORLD_COLUMNS.length >= 3, 'enough world news to fill three columns');
    assert.ok(CONTEXT_COLUMNS.length >= 1, 'at least one context story');
    for (const id of ids) assert.ok(typeof id === 'string' && id.length > 0, `id: ${id}`);
    assert.equal(new Set(ids).size, ids.length, 'ids are unique');
    for (const lead of LEADS) {
        for (const field of ['kicker', 'headline', 'subhead', 'body', 'brief']) assert.ok(typeof lead[field] === 'string' && lead[field].length > 0, `${lead.id}.${field}`);
    }
    for (const column of [...WORLD_COLUMNS, ...CONTEXT_COLUMNS]) assert.ok(column.headline && column.body, column.id);
    for (let issue = 1; issue <= LEADS.length * 2; issue++) {
        const e = edition({issue, settlement: SETTLEMENT});
        const words = [e.lead.kicker, e.lead.headline, e.lead.subhead, e.lead.body, e.lead.brief, e.advert.headline, e.advert.body, e.footer,
            ...e.columns.flatMap((c) => [c.headline, c.body])];
        for (const text of words) assert.doesNotMatch(text, PLACEHOLDER, `issue ${issue}: ${text}`);
        assert.equal(e.columns.length, 3);
    }
});

test('every story fits its slot as the layouts cut it: nothing would end in an ellipsis', () => {
    // NewspaperLayer's templates: desktop lead 6 x 74, phone lead 4 x 43, phone subhead 1 x 43, desktop column 4 x 30.
    const fits = (text, chars, lines) => !fitLines(text, chars, lines).includes('…');
    for (const lead of LEADS) {
        assert.ok(fits(lead.body, 74, 6), `${lead.id} body`);
        assert.ok(fits(lead.brief, 43, 4), `${lead.id} brief`);
        assert.ok(fits(lead.subhead, 43, 1), `${lead.id} subhead`);
        assert.ok(lead.brief.length < lead.body.length, `${lead.id}: the brief is the shorter`);
    }
    for (const column of [...WORLD_COLUMNS, ...CONTEXT_COLUMNS]) {
        assert.ok(fits(column.body, 30, 4), `${column.id} body`);
        assert.ok(column.headline.length <= 18, `${column.id} headline`); // bold 18 px Georgia: at most about 240 px of a 244 px column
    }
    for (const notice of NOTICES) assert.ok(fits(notice.body, 30, 2), `notice: ${notice.body}`);
});

test('the public notice turns once per issue through all twelve, then round again; the same issue always prints the same', () => {
    const notices = Array.from({length: NOTICES.length * 2}, (_, i) => edition({issue: i + 1, settlement: SETTLEMENT}).advert.body);
    assert.equal(NOTICES.length, 12);
    assert.deepEqual(notices.slice(0, NOTICES.length), NOTICES.map((n) => n.body), 'every notice once, in order');
    assert.deepEqual(notices.slice(NOTICES.length), notices.slice(0, NOTICES.length), 'then the same round again');
    assert.deepEqual(edition({issue: 7, settlement: SETTLEMENT}).advert, edition({issue: 7, settlement: SETTLEMENT}).advert);
    assert.deepEqual(edition({issue: 1, settlement: SETTLEMENT}).advert, {...NOTICES[0]}, 'issue 1 prints what it always printed');
    assert.deepEqual(noticeForIssue(0), NOTICES[0], 'an issue before the first never breaks');
});

test('one lead per issue in order, round again; the artillery is dismantled before it returns; the ketchup runs once a round', () => {
    const leads = Array.from({length: LEADS.length * 2}, (_, i) => edition({issue: i + 1, settlement: SETTLEMENT}).lead.id);
    assert.deepEqual(leads.slice(0, LEADS.length), LEADS.map((l) => l.id), 'every lead once before any repeats');
    assert.deepEqual(leads.slice(LEADS.length), leads.slice(0, LEADS.length));
    assert.ok(leads.indexOf('great-disarmament') < leads.indexOf('defense-restoration'));
    assert.equal(leads.slice(0, LEADS.length).filter((id) => id === 'banana-ketchup').length, 1);
    assert.equal(stories({issue: 1, settlement: SETTLEMENT}).lead.id, 'maintenance-ban');
});

test('columns: three different ones, neighbours differ, and a story about the outpost runs only when it really happened', () => {
    for (let issue = 1; issue <= 30; issue++) {
        const ids = stories({issue, settlement: SETTLEMENT}).columns.map((c) => c.id);
        assert.equal(new Set(ids).size, 3, `issue ${issue}`);
        const next = stories({issue: issue + 1, settlement: SETTLEMENT}).columns.map((c) => c.id);
        assert.notDeepEqual(ids, next, `issues ${issue} and ${issue + 1}`);
    }
    const calm = settlementWith();
    for (let issue = 1; issue <= 20; issue++) {
        assert.deepEqual(stories({issue, settlement: calm, delivered: 60}).columns.filter((c) => CONTEXT_COLUMNS.includes(c)), [], `nothing happened: ${issue}`);
    }
    const cases = {
        'grid-thrift': settlementWith({power: 'low-power'}),
        'rich-air': settlementWith({emitted: 24}),
        'patient-trucks': settlementWith({factory: 1}),
        'night-visitors': settlementWith({threat: 3}),
    };
    for (const [id, settlement] of Object.entries(cases)) {
        assert.equal(stories({issue: 2, settlement, delivered: 0}).columns[0].id, id, `${id} on an even issue`);
        assert.equal(stories({issue: 3, settlement, delivered: 0}).columns.some((c) => c.id === id), false, `${id}: not every issue`);
    }
    assert.equal(stories({issue: 2, settlement: settlementWith({factory: 1}), delivered: 30}).columns[0].id === 'patient-trucks', false, 'it did deliver');
    assert.equal(stories({issue: 2, settlement: settlementWith(), delivered: 0}).columns.some((c) => c.id === 'patient-trucks'), false, 'nothing to deliver');
});

test('the figures stay the settlement\'s own, whatever the stories; and choosing never asks Math.random', () => {
    const real = Math.random;
    Math.random = () => { throw new Error('Math.random asked'); };
    try {
        for (let issue = 1; issue <= 12; issue++) {
            const e = edition({issue, settlement: SETTLEMENT, delivered: 360});
            assert.deepEqual(e.figures.map(({label, value}) => `${label} ${value}`), [
                'Income +360', 'Upkeep 0', 'Net +360', 'Credits 900', 'Power NORMAL', 'Pollution 32 (+12)', 'Threat 2',
            ]);
            assert.deepEqual(edition({issue, settlement: SETTLEMENT, delivered: 360}), e, 'the same issue, the same paper');
        }
    } finally {
        Math.random = real;
    }
});

test('the decrees are news about the Republic, never orders to the player', () => {
    for (const lead of LEADS) {
        for (const text of [lead.headline, lead.subhead, lead.body, lead.brief]) {
            assert.doesNotMatch(text, /\byou\b|\byour\b|player|press |build an? |must now build|objective|reward|penalt/i, `${lead.id}: ${text}`);
        }
    }
    const ketchup = LEADS.find((l) => l.id === 'banana-ketchup');
    assert.match(ketchup.body, /EL PAPI™ Banana Ketchup/);
    assert.match(ketchup.body, /shortage of independent inspectors/);
});

test('the lead photograph is named by asset id, with its caption: the layout looks the asset up', async () => {
    const e = edition({issue: 1, settlement: SETTLEMENT});
    assert.deepEqual({...e.lead.photo}, {asset: 'el-papi', caption: 'HIS EXCELLENCY, EL PAPI'});
    assert.ok(Object.isFrozen(e.lead.photo));
    const {NEWSPAPER_PHOTOS} = await import('../../src/scenes/newspaperArt.js');
    assert.deepEqual({...NEWSPAPER_PHOTOS['el-papi']}, {key: 'papi-news-el-papi', path: 'assets/sprites/ui/newspaper_portrait.png'});
});

test('fitLines keeps text to its lines and marks what it cut', () => {
    assert.equal(fitLines('short text', 20, 2), 'short text');
    const cut = fitLines('one two three four five six seven eight nine ten', 10, 2);
    assert.equal(cut.split('\n').length, 2);
    assert.ok(cut.endsWith('…'));
    for (const line of fitLines('alpha beta gamma delta epsilon zeta eta theta', 12, 9).split('\n')) assert.ok(line.length <= 12, line);
});

/** Day 0, END DAY, then frames of 100 ms at 4x (24 ticks each) until the new Day. */
function dawnAt4x(holdDawn) {
    const clock = new SimulationClock();
    const economy = new Economy({credits: 1000, ap: 0});
    let settled = 0;
    const cycle = new ShiftCycle({
        clock, economy, dayTicks: DAY_TICKS, duskTicks: DUSK_TICKS, holdDawn,
        settleNight: (day) => {
            settled++;
            return {day};
        },
    });
    const onTick = (tick) => cycle.onTick(tick);
    cycle.begin();
    cycle.endDay();
    clock.setSpeed(4);
    let frames = 0;
    let crossing = null;
    while (cycle.shift !== Shift.DAY && frames < 1000) {
        const before = clock.tick;
        clock.advance(100, onTick);
        frames++;
        if (cycle.shift === Shift.DAY) crossing = clock.tick - before;
    }
    return {clock, cycle, economy, settled, crossing};
}

test('held, the new Day waits at tick 0 even when the dawn falls inside a 24-tick frame at 4x', () => {
    const held = dawnAt4x(() => true);
    assert.equal(held.cycle.shift, Shift.DAY);
    assert.equal(held.cycle.day, 2);
    assert.equal(held.settled, 1);
    assert.equal(held.economy.ap, 5, 'AP restored');
    assert.equal(held.cycle.elapsedDayTicks, 0);
    assert.equal(held.clock.paused, true);
    assert.equal(held.clock.speed, 1, 'the Day will start at 1x');
    assert.ok(held.crossing < 24, 'the frame stopped at the dawn tick');
    const tick = held.clock.tick;
    held.clock.advance(100, (t) => held.cycle.onTick(t));
    assert.equal(held.clock.tick, tick, 'no Day tick runs while it is held');
    assert.equal(held.cycle.pausedDay, true, 'an ordinary paused Day');

    const free = dawnAt4x(null);
    assert.equal(free.settled, 1);
    assert.ok(free.cycle.elapsedDayTicks > 0, 'without the hold the rest of the frame runs the Day');
    held.cycle.resume();
    held.clock.advance(100, (t) => held.cycle.onTick(t));
    assert.ok(held.cycle.elapsedDayTicks > 0, 'resumed, the Day runs');
});

test('LEGACY ignores the hold: its untimed Day pauses as it always did', () => {
    const clock = new SimulationClock();
    const cycle = new ShiftCycle({clock, economy: new Economy({credits: 0, ap: 0}), holdDawn: () => true});
    cycle.begin();
    cycle.endDay();
    while (cycle.shift !== Shift.DAY) cycle.stepTicks(240, (t) => cycle.onTick(t));
    assert.equal(cycle.timed, false);
    assert.equal(clock.paused, true);
});
