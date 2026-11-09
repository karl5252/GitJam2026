/**
 * TASK 029, LA VOZ DE SAN PAPI: the edition builder (pure data) and ShiftCycle's
 * exact dawn hold.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {edition, fitLines} from '../../src/content/newspaper.js';
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
    assert.equal(e.figuresTitle, 'CIFRAS OFICIALES · NIGHT 3');
    assert.deepEqual(e.figures.map(({label, value}) => `${label} ${value}`), [
        'Income +360', 'Upkeep 0', 'Net +360', 'Credits 900', 'Power NORMAL', 'Pollution 32 (+12)', 'Threat 2',
    ]);
    assert.ok(Object.isFrozen(e) && Object.isFrozen(e.lead) && Object.isFrozen(e.columns[0]) && Object.isFrozen(e.figures[0]));
    assert.deepEqual(edition({issue: 3, settlement: SETTLEMENT, delivered: 360}), e, 'the same input gives the same edition');
});

test('every editorial slot is placeholder text', () => {
    const e = edition({issue: 1, settlement: SETTLEMENT});
    for (const text of [e.lead.kicker, e.lead.headline, e.lead.subhead, e.advert.headline, e.footer, ...e.columns.map((c) => c.headline)]) {
        assert.match(text, /TBD/, text);
    }
    for (const body of [e.lead.body, ...e.columns.map((c) => c.body)]) assert.match(body, /Lorem|ipsum|dolor|Duis|Excepteur|Ut enim/);
    assert.equal(e.columns.length, 3);
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
