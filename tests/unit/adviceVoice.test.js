import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ADVICE} from '../../src/content/advice.js';
import {SoundManager} from '../../src/audio/SoundManager.js';
import {SOUND_EVENTS, audioKey} from '../../src/audio/soundMap.js';
import {AdviceNarrator, adviceLineEvent, presidentialLine} from '../../src/audio/adviceNarrator.js';

/** TASK 033.4: El Presidente's voice for Presidential Advice. */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ---- A fake Phaser sound backend, as audio.test.js's ---------------------------------

class FakeSound {
    constructor(key, {volume = 1} = {}) {
        Object.assign(this, {key, volume, isPlaying: false, handlers: {}, manager: {}});
    }
    play() { this.isPlaying = true; }
    stop() { this.isPlaying = false; }
    destroy() { this.destroyed = true; }
    setVolume(v) { this.volume = v; }
    setPan(p) { this.pan = p; }
    once(event, fn) { this.handlers[event] = fn; }
    finish() { this.isPlaying = false; this.handlers.complete?.(); }
}

/** Two stand-in presidential lines, for the manager alone: the game's map has none until the recordings exist. */
const line = (stem) => Object.freeze({channel: 'voices', files: [`sound/VOICES/${stem}`], volume: 1, cooldownMs: 0, maxConcurrent: 1, voice: 'president'});
const EVENTS = Object.freeze({...SOUND_EVENTS, 'advice.papi_hq': line('papi_hq'), 'advice.papi_ap': line('papi_ap')});

function setup({locked = false, events = EVENTS} = {}) {
    let time = 0;
    const data = new Map();
    const backend = {
        locked, sounds: [], listeners: {},
        once(event, fn) { this.listeners[event] = fn; },
        add(key, config) { const s = new FakeSound(key, config); this.sounds.push(s); return s; },
    };
    const manager = new SoundManager({backend, events, storage: {get: (k) => data.get(k) ?? null, set: (k, v) => data.set(k, v)}, now: () => time, random: () => 0.5});
    const sounding = (stem) => backend.sounds.filter((s) => s.key === audioKey(`sound/VOICES/${stem}`) && s.isPlaying);
    return {manager, backend, advance: (ms) => { time += ms; }, sounding};
}

// ---- The catalogue and the assets ------------------------------------------------------

test('every tip names its line, by the agreed file names', () => {
    assert.deepEqual(Object.fromEntries(ADVICE.map((t) => [t.id, t.voice])), {
        'build-hq': 'papi_hq', 'low-power': 'papi_power', 'night-defence': 'papi_defense', ecologists: 'papi_ecologists',
        workers: 'papi_workers', logistics: 'papi_logistics', 'action-points': 'papi_ap', barracks: 'papi_barracks',
        mining: 'papi_mining', pollution: 'papi_pollution',
    });
});

test('a line speaks only once it is a real, mapped recording: none is referenced before its files exist', () => {
    const map = readFileSync(path.join(ROOT, 'audio-src/sound/SOUND_MAP.txt'), 'utf8');
    for (const {id, voice} of ADVICE) {
        const name = adviceLineEvent(voice);
        const event = SOUND_EVENTS[name];
        if (!event) {
            assert.equal(presidentialLine(id), null, `${id}: silent until ${voice} is recorded and mapped`);
            continue;
        }
        assert.equal(presidentialLine(id), name);
        assert.deepEqual([event.channel, event.voice], ['voices', 'president'], name);
        assert.match(map, new RegExp(`^${name.replace('.', '\\.')}\\s+->`, 'm'), `${name} is in SOUND_MAP.txt`);
        for (const ext of ['ogg', 'm4a']) assert.ok(existsSync(path.join(ROOT, 'public', `${event.files[0]}.${ext}`)), `${voice}.${ext}`);
    }
    assert.equal(presidentialLine('build-hq', {events: EVENTS}), 'advice.papi_hq', 'resolves once mapped');
    // The recordings are in: every tip now has its own line, each a single file.
    for (const {id, voice} of ADVICE) {
        assert.equal(presidentialLine(id), adviceLineEvent(voice), `${id} speaks`);
        assert.deepEqual(SOUND_EVENTS[adviceLineEvent(voice)].files, [`sound/VOICES/${voice}`]);
    }
    assert.equal(presidentialLine('no-such-tip', {events: EVENTS}), null);
});

// ---- The presidential voice in SoundManager --------------------------------------------

test('speak: one presidential line on the VOICES channel, at MASTER x VOICES, never through play()', () => {
    const {manager, sounding} = setup();
    assert.equal(manager.play('advice.papi_hq'), false, 'only speak() speaks for the President');
    assert.equal(manager.speak('ui.click'), false, 'speak() is for presidential lines only');
    assert.equal(manager.speak('advice.papi_hq'), true);
    const [sound] = sounding('papi_hq');
    assert.ok(Math.abs(sound.volume - manager.volume('master') * manager.volume('voices')) < 1e-9);
    assert.deepEqual([manager.snapshot().presidentSpeaking, manager.snapshot().presidentLine], [true, 'advice.papi_hq']);
    assert.equal(sound.pan, undefined, 'a broadcast to the nation: no pan');
    manager.setVolume('voices', 0.5);
    assert.ok(Math.abs(sound.volume - manager.volume('master') * 0.5) < 1e-9, 'VOICES follows at once');
    manager.setVolume('master', 0.4);
    assert.ok(Math.abs(sound.volume - 0.4 * 0.5) < 1e-9, 'MASTER too');
    manager.setMuted(true);
    assert.equal(sound.volume, 0, 'MUTE silences it');
});

test('never two lines at once, and nothing queued: a refused line is simply gone', () => {
    const {manager, sounding} = setup();
    assert.equal(manager.speak('advice.papi_hq'), true);
    assert.equal(manager.speak('advice.papi_ap'), false);
    sounding('papi_hq')[0].finish();
    assert.equal(sounding('papi_ap').length, 0, 'not played later');
    assert.equal(manager.speak('advice.papi_ap'), true, 'free once the first ended');
});

test('the President outranks the units: a unit line stops, and none starts while he speaks', () => {
    const {manager, backend, advance, sounding} = setup();
    assert.equal(manager.play('worker.select'), true);
    const unit = backend.sounds.at(-1);
    assert.equal(unit.isPlaying, true);
    assert.equal(manager.speak('advice.papi_hq'), true);
    assert.equal(unit.isPlaying, false, 'cut off');
    advance(5000);
    assert.equal(manager.play('worker.explore'), false, 'no chatter over him');
    sounding('papi_hq')[0].finish();
    assert.equal(manager.play('worker.explore'), true, 'afterwards, as usual');
});

test('locked, muted or disabled audio: nothing speaks, nothing throws', () => {
    assert.equal(setup({locked: true}).manager.speak('advice.papi_hq'), false);
    const muted = setup();
    muted.manager.setMuted(true);
    assert.equal(muted.manager.speak('advice.papi_hq'), false);
    const off = new SoundManager({backend: null, enabled: false, events: EVENTS, storage: {get: () => null, set: () => {}}});
    assert.equal(off.speak('advice.papi_hq'), false);
    off.silence();
});

test('silence and stopTransient end the line; every other sound behaves as before', () => {
    const {manager, sounding} = setup();
    manager.speak('advice.papi_hq');
    manager.silence();
    assert.equal(sounding('papi_hq').length, 0);
    assert.equal(manager.snapshot().presidentSpeaking, false);
    manager.speak('advice.papi_ap');
    manager.stopTransient();
    assert.equal(sounding('papi_ap').length, 0, 'scene shutdown');
    assert.equal(manager.play('ui.click'), true);
});

// ---- The narrator ------------------------------------------------------------------------

function narrator(lines = {'build-hq': 'advice.papi_hq', 'action-points': 'advice.papi_ap'}, {accept = true} = {}) {
    const calls = [];
    const manager = {speak: (name) => { calls.push(['speak', name]); return accept; }, silence: () => calls.push(['silence'])};
    return {n: new AdviceNarrator(manager, {lineFor: (id) => lines[id] ?? null}), calls};
}
const shown = (id) => ({visible: true, tip: {id}});
const hidden = (pending = null) => ({visible: false, tip: null, pending});

test('one line per tip displayed, once: not for tips never shown, nor again after a modal', () => {
    const {n, calls} = narrator();
    n.frame(hidden('build-hq')); // eligible but held back: nothing
    assert.deepEqual(calls, []);
    for (let i = 0; i < 30; i++) n.frame(shown('build-hq')); // thirty frames: one line
    assert.deepEqual(calls, [['speak', 'advice.papi_hq']]);
    n.frame(hidden('build-hq')); // BUILD opened over it
    assert.deepEqual(calls.at(-1), ['silence'], 'stops behind the modal');
    n.frame(shown('build-hq')); // back again
    assert.equal(calls.filter(([c]) => c === 'speak').length, 1, 'not repeated: obsolete narration is never replayed');
    assert.deepEqual(n.view().narrated, ['build-hq']);
});

test('the tip goes (dismissed, stale, switched off, Game Over): the line stops; the next tip has its own', () => {
    const {n, calls} = narrator();
    n.frame(shown('build-hq'));
    n.frame(null); // advice off, or a restart's empty state
    assert.deepEqual(calls, [['speak', 'advice.papi_hq'], ['silence']]);
    n.frame(shown('action-points'));
    assert.deepEqual(calls.at(-1), ['speak', 'advice.papi_ap']);
    n.stop();
    assert.deepEqual(calls.at(-1), ['silence']);
    assert.equal(n.view().speakingFor, null);
});

test('no recording, or the manager refuses (locked, muted, another line): the tip is silent, never retried', () => {
    const {n, calls} = narrator({}, {accept: true});
    n.frame(shown('pollution'));
    n.frame(shown('pollution'));
    assert.deepEqual(calls, [], 'nothing to say');
    const refused = narrator(undefined, {accept: false});
    for (let i = 0; i < 10; i++) refused.n.frame(shown('build-hq'));
    assert.deepEqual(refused.calls, [['speak', 'advice.papi_hq']], 'one chance only');
    refused.n.frame(hidden());
    assert.deepEqual(refused.calls.length, 1, 'nothing to silence: it never spoke');
});
