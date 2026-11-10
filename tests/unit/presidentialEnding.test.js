import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {
    CROWD, CUE_ORDER, ENDING_CALENDAR_DAY, ENDING_CUES, ENDING_FRAMES, ENDING_HUD_DAY, ENDING_TIMING, SPEECH, STAGE, SUBTITLES,
    cueAt, endingDue, endingFrame, endingLengthMs, hash01, speechStartMs, stageLayout, subtitleAt,
} from '../../src/scenes/presidentialEnding.js';
import {PROFILE_KEY, endingSeen, loadProfile, setEndingSeen} from '../../src/scenes/profile.js';
import {officeArtFor} from '../../src/scenes/OfficeMenuArt.js';
import {NEWSPAPER_PHOTOS, printedPhoto} from '../../src/scenes/newspaperArt.js';
import {SOUND_EVENTS, audioUrls} from '../../src/audio/soundMap.js';
import {musicState} from '../../src/audio/GameAudio.js';

/** TASK 036: THE PRESIDENTIAL VISIT, the Day 100 ending. */

const HQ = {x: 576, y: 160, width: 96, height: 96};
const L = stageLayout(HQ);
const at = (speechS) => speechStartMs() + speechS * 1000;
const day = (d, extra = {}) => ({timed: true, deployment: false, shift: 'day', day: d, ...extra});
const memory = () => {
    const data = new Map();
    return {data, get: (k) => data.get(k) ?? null, set: (k, v) => data.set(k, v)};
};

test('Day 100 is the HUD\'s: calendar day 101, a timed Day after Night 100, and only that', () => {
    assert.equal(ENDING_HUD_DAY, 100);
    assert.equal(ENDING_CALENDAR_DAY, 101, 'the HUD labels a timed Day as day - 1');
    assert.equal(endingDue(day(101)), true);
    for (const d of [1, 2, 99, 100, 102]) assert.equal(endingDue(day(d)), false, `calendar day ${d}`);
    assert.equal(endingDue(day(101, {shift: 'night'})), false, 'never in a Night');
    assert.equal(endingDue(day(101, {shift: 'dusk'})), false);
    assert.equal(endingDue(day(101, {deployment: true})), false, 'never Day 0');
    assert.equal(endingDue(day(101, {timed: false})), false, 'never the LEGACY cycle');
});

test('the cue table: every named cue, in order, inside the 57.42 s recording', () => {
    assert.deepEqual(CUE_ORDER, ['SPEECH_START', 'PRESIDENTIAL_TRIUMPH', 'BRUTE_REVEAL', 'BRUTE_APPROACH', 'BRUTE_LUNGE', 'PRESIDENT_CONSUMED', 'CHEWING', 'ENDING_COMPLETE']);
    const times = CUE_ORDER.map((c) => ENDING_CUES[c]);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1], CUE_ORDER[i]);
    assert.equal(ENDING_CUES.SPEECH_START, 0);
    assert.equal(ENDING_CUES.ENDING_COMPLETE, SPEECH.durationS);
    assert.equal(SPEECH.durationS, 57.42);
    assert.equal(cueAt(-1), null);
    assert.equal(cueAt(50), 'BRUTE_APPROACH');
    assert.equal(cueAt(60), 'ENDING_COMPLETE');
    for (const {from, to, text} of SUBTITLES) {
        assert.ok(from < to && to <= SPEECH.durationS);
        assert.ok(!/\[/.test(text), 'spoken words only, no sound effects');
    }
    assert.equal(subtitleAt(39), 'ME! EL COLONEL PAPI!');
    assert.equal(subtitleAt(55), null, 'the scream needs no words');
});

test('papi_final is registered as the presidential voice, shipped as OGG and M4A, its original kept', () => {
    const e = SOUND_EVENTS[SPEECH.event];
    assert.ok(e);
    assert.equal(e.voice, 'president');
    assert.equal(e.channel, 'voices');
    assert.deepEqual(e.files, ['sound/VOICES/papi_final']);
    for (const url of audioUrls(e.files[0])) assert.ok(existsSync(new URL(`../../public/${url}`, import.meta.url)), url);
    assert.ok(existsSync(new URL('../../audio-src/sound/VOICES/papi_final.ogg', import.meta.url)));
    const map = readFileSync(new URL('../../audio-src/sound/SOUND_MAP.txt', import.meta.url), 'utf8');
    assert.match(map, /papi\.final\s+-> papi_final\.ogg/);
    assert.equal(musicState({phase: 'started', shift: 'day', ending: true}), 'night', 'no music under the speech');
});

test('the ceremony: 14 workers and 10 ecologists mixed in a semicircle, an aisle for the Brute, two guards beside the President', () => {
    assert.equal(L.crowd.length, 24);
    assert.equal(L.crowd.filter((a) => a.kind === 'worker').length, CROWD.workers);
    assert.equal(L.crowd.filter((a) => a.kind === 'ecologist').length, CROWD.ecologists);
    const kinds = L.crowd.map((a) => a.kind).join(',');
    assert.ok(!kinds.includes('ecologist,ecologist,ecologist'), 'mixed, never a faction');
    for (const a of L.crowd) {
        assert.ok(a.y > L.podium.y, 'in front of the podium, facing it');
        assert.ok(Math.abs(a.x - L.podium.x) > 18, 'the aisle stays clear');
        assert.ok(Math.hypot(a.x - L.podium.x, a.y - L.podium.y) > 60, 'never on the President');
    }
    assert.equal(L.guards.length, 2);
    assert.ok(L.guards[0].x < L.podium.x && L.guards[1].x > L.podium.x);
    assert.equal(L.door.y, HQ.y + HQ.height);
    assert.equal(L.brute.from.x, L.podium.x, 'the Brute comes up the aisle');
});

test('choreography: helicopter first, then the President and guards out of HQ\'s door, never out of the helicopter', () => {
    const arrival = endingFrame(1000, L);
    assert.equal(arrival.phase, 'arrival');
    assert.equal(arrival.heli.visible, true);
    assert.ok(ENDING_FRAMES.president.idle.length && [2, 3, 4, 5, 6, 7].includes(arrival.heli.frame), 'flying frames 2-7');
    assert.equal(arrival.president.visible, false);
    assert.ok(arrival.guards.every((g) => !g.visible));
    assert.ok(endingFrame(300, L).fade > 0 && arrival.fade === 0, 'faded in from black');

    const out = endingFrame(ENDING_TIMING.presidentOutMs + 50, L);
    assert.equal(out.president.visible, true);
    assert.ok(Math.abs(out.president.x - L.door.x) < 1 && out.president.y < L.door.y, 'at the door');
    assert.equal(out.heli.leg, 'landed', 'while the helicopter waits on the roof (TASK 036.1)');
    const set = endingFrame(speechStartMs(), L);
    assert.deepEqual([set.president.x, set.president.y], [L.podium.x, L.podium.y]);
    assert.deepEqual(set.guards.map((g) => [g.x, g.y]), L.guards.map((g) => [g.x, g.y]));
    assert.equal(set.heli.visible, false, 'the helicopter has gone before the speech (TASK 036.1)');
    assert.equal(endingFrame(at(5), L).heli.visible, false, 'gone for the speech');
    for (const t of [0, 3000, at(10), at(40), at(55)]) {
        const f = endingFrame(t, L);
        assert.ok(f.guards.every((g) => [...ENDING_FRAMES.guard.idle, ...ENDING_FRAMES.guard.walk, ...ENDING_FRAMES.guard.salute].includes(g.frame)), 'only La Guardia Royal frames (TASK 036.1)');
    }
});

test('the Brute: absent, revealed up the aisle, approaching, lunging, then alone where the President stood', () => {
    assert.equal(endingFrame(at(40), L).brute.visible, false);
    const reveal = endingFrame(at(47), L);
    assert.equal(reveal.brute.state, 'revealed');
    assert.ok(ENDING_FRAMES.brute.walk.includes(reveal.brute.frame));
    const approach = endingFrame(at(50), L);
    assert.equal(approach.brute.state, 'approaching');
    assert.ok(approach.brute.y < reveal.brute.y);
    assert.equal(approach.president.visible, true);
    const lunge = endingFrame(at(52.5), L);
    assert.equal(lunge.brute.state, 'lunging');
    assert.equal(lunge.brute.frame, ENDING_FRAMES.brute.strike);
    assert.equal(lunge.president.visible, true, 'still there until the scream');
    const eaten = endingFrame(at(54.1), L);
    assert.equal(eaten.president.visible, false);
    assert.ok(Math.hypot(eaten.brute.x - L.podium.x, eaten.brute.y - L.podium.y) < 8);
    const chew = endingFrame(at(56), L);
    assert.equal(chew.brute.state, 'chewing');
    assert.ok([ENDING_FRAMES.brute.strike, ...ENDING_FRAMES.brute.walk].includes(chew.brute.frame));
});

test('the crowd: listening, ecologists\' signs up for the applause, neighbours step back, everyone scatters, nobody stays on the Brute', () => {
    const states = (t) => new Set(endingFrame(t, L).crowd.map((a) => a.state));
    assert.deepEqual([...states(2000)], ['gathered']);
    assert.ok(states(at(39)).has('cheering'));
    const cheering = endingFrame(at(39), L).crowd.filter((a) => a.state === 'cheering');
    assert.ok(cheering.every((a) => a.kind === 'ecologist' && ENDING_FRAMES.ecologist.protest.includes(a.frame)));
    assert.ok(states(at(50)).has('stepping-back'));
    const late = endingFrame(at(56.5), L).crowd;
    assert.ok(late.every((a) => a.state === 'scattering'));
    for (const [a, home] of late.map((x, i) => [x, L.crowd[i]])) {
        assert.ok(Math.hypot(a.x - L.podium.x, a.y - L.podium.y) > Math.hypot(home.x - L.podium.x, home.y - L.podium.y), 'outwards');
    }
    const timing = new Set(endingFrame(at(20), L).crowd.map((a) => a.frame));
    assert.ok(timing.size > 1, 'not in step');
});

test('the end: fade to black after ENDING_COMPLETE, then done; deterministic with no random numbers', () => {
    assert.equal(endingFrame(at(57.42) + 500, L).phase, 'fade');
    const done = endingFrame(endingLengthMs(), L);
    assert.equal(done.phase, 'done');
    assert.equal(done.fade, 1);
    const random = Math.random;
    Math.random = () => {
        throw new Error('Math.random must not be used');
    };
    try {
        for (const t of [0, 3000, at(20), at(50), at(55)]) assert.deepEqual(endingFrame(t, stageLayout(HQ)), endingFrame(t, L));
        assert.deepEqual(stageLayout(HQ), L);
        assert.equal(hash01(3, 4), hash01(3, 4));
    } finally {
        Math.random = random;
    }
    // The recording leads: the same speech time is the same scene, whatever the timeline's clock says.
    assert.deepEqual(endingFrame(at(50), L, 50000).brute, endingFrame(at(50), L).brute);
});

test('the profile: papi_profile, versioned, set only by asking, kept across reads, harmless when storage fails', () => {
    const store = memory();
    store.set('papi_audio', '{"keep":1}');
    assert.equal(endingSeen(store), false);
    assert.equal(setEndingSeen(store, true), true);
    assert.equal(endingSeen(store), true);
    assert.deepEqual(JSON.parse(store.get(PROFILE_KEY)), {version: 1, presidentialEndingSeen: true});
    assert.equal(store.get('papi_audio'), '{"keep":1}', 'other keys untouched');
    setEndingSeen(store, false);
    assert.equal(endingSeen(store), false);
    store.set(PROFILE_KEY, 'not json');
    assert.equal(endingSeen(store), false);
    store.set(PROFILE_KEY, JSON.stringify({version: 99, presidentialEndingSeen: true}));
    assert.equal(loadProfile(store).presidentialEndingSeen, false, 'an unknown version is a new player');
    const broken = {get: () => { throw new Error('blocked'); }, set: () => { throw new Error('blocked'); }};
    assert.equal(endingSeen(broken), false);
    assert.equal(setEndingSeen(broken, true), false);
    assert.equal(endingSeen(null), false);
});

test('one flag, four pictures: bust frame, menu portrait, El Colonel, La Voz\'s photograph', () => {
    assert.deepEqual({...officeArtFor(false)}, {portrait: 'portrait', bustFrame: 0, globeFrame: 0, colonel: true});
    assert.deepEqual({...officeArtFor(true)}, {portrait: 'mutantPortrait', bustFrame: 1, globeFrame: 1, colonel: false});
    assert.equal(printedPhoto('el-papi', false), 'el-papi');
    assert.equal(printedPhoto('el-papi', true), 'el-papi-2');
    assert.equal(printedPhoto('someone-else', true), 'someone-else', 'only El Papi\'s photograph changes');
    assert.equal(NEWSPAPER_PHOTOS['el-papi-2'].path, 'assets/sprites/ui/newspaper_portrait_2.png');
    assert.deepEqual({...NEWSPAPER_PHOTOS['el-papi-2'].frame}, {width: 64, height: 96}, 'the original\'s frame');
    const png = (p) => {
        const b = readFileSync(new URL(`../../public/assets/sprites/${p}`, import.meta.url));
        return [b.readUInt32BE(16), b.readUInt32BE(20)];
    };
    assert.deepEqual(png('ui/newspaper_portrait_2.png'), [41, 69]);
    assert.deepEqual(png('menu-office/bust-gold.png'), [76, 48], 'two 38 x 48 frames');
    assert.deepEqual(png('menu-office/portrait-mutant.png'), [64, 96]);
    assert.deepEqual(png('units/security.png'), [195, 175], 'La Guardia Royal: a 4-wide grid of 45 x 40 cells, 5 px apart');
    assert.ok(!existsSync(new URL('../../public/assets/sprites/units/secuity.png', import.meta.url)), 'the misspelt placeholder is gone');
    assert.deepEqual(png('menu-office/globe.png'), [64, 44], 'two 32 x 44 frames');
    assert.equal(STAGE.hq.width, 3);
});
