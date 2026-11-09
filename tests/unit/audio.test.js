/**
 * TASK 030: the sound map against SOUND_MAP.txt and the files on disk, the
 * SoundManager against a fake Phaser sound backend, and the game adapter.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {
    DEFAULT_VOLUMES, DUCK_GAIN, MUSIC_TRACKS, RARE_CHANCE, SOUND_EVENTS, VOICE_GAP_MS, audioKey, audioUrls, effectFiles,
} from '../../src/audio/soundMap.js';
import {STORAGE_KEY, SoundManager} from '../../src/audio/SoundManager.js';
import {GameAudio, musicState, tickEvents} from '../../src/audio/GameAudio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC = path.join(ROOT, 'public');

// ---- A fake Phaser sound backend ------------------------------------------------

class FakeSound {
    constructor(key, {volume = 1, loop = false} = {}) {
        Object.assign(this, {key, volume, loop, isPlaying: false, plays: 0, handlers: {}, manager: {}});
    }
    play() { this.isPlaying = true; this.plays++; }
    stop() { this.isPlaying = false; }
    destroy() { this.destroyed = true; }
    setVolume(v) { this.volume = v; }
    setPan(p) { this.pan = p; }
    once(event, fn) { this.handlers[event] = fn; }
    finish() { this.isPlaying = false; this.handlers.complete?.(); }
}

function setup({locked = false, touch = false, storage = null, random = () => 0.5, loaded = () => true} = {}) {
    let time = 0;
    const store = storage ?? (() => {
        const data = new Map();
        return {get: (k) => data.get(k) ?? null, set: (k, v) => data.set(k, v), data};
    })();
    const backend = {
        locked, sounds: [], listeners: {},
        once(event, fn) { this.listeners[event] = fn; },
        add(key, config) { const s = new FakeSound(key, config); this.sounds.push(s); return s; },
        unlock() { this.locked = false; this.listeners.unlocked?.(); },
    };
    const manager = new SoundManager({backend, storage: store, now: () => time, random, touch, hasAudio: loaded});
    return {manager, backend, store, advance: (ms) => { time += ms; }, played: (event) => backend.sounds.filter((s) => event.files.some((f) => s.key === audioKey(f)))};
}

// ---- The map -------------------------------------------------------------------------

test('every event and track is SOUND_MAP.txt\'s, and every file ships as OGG and AAC', () => {
    const map = readFileSync(path.join(ROOT, 'audio-src/sound/SOUND_MAP.txt'), 'utf8');
    for (const name of Object.keys(SOUND_EVENTS)) assert.match(map, new RegExp(`^${name.replace('.', '\\.')}\\s+->`, 'm'), name);
    assert.match(map, /^menu\s+-> Spanish - Como Versace Loop\.ogg/m);
    assert.match(map, /^active_day\s+-> Spanish - Océano Loop\.ogg/m);
    assert.equal(MUSIC_TRACKS.menu.file, 'sound/MUSIC/Spanish - Como Versace Loop');
    assert.equal(MUSIC_TRACKS.day.file, 'sound/MUSIC/Spanish - Océano Loop');
    for (const file of [...effectFiles(), ...Object.values(MUSIC_TRACKS).map((t) => t.file)]) {
        for (const ext of ['ogg', 'm4a']) assert.ok(existsSync(path.join(PUBLIC, `${file}.${ext}`)), `${file}.${ext}`);
        assert.ok(!/ORIGINAL|\(1\)|\.wav/.test(file), file);
    }
    assert.deepEqual(audioUrls('sound/MUSIC/Spanish - Océano Loop'), [
        'sound/MUSIC/Spanish%20-%20Oc%C3%A9ano%20Loop.ogg', 'sound/MUSIC/Spanish%20-%20Oc%C3%A9ano%20Loop.m4a',
    ]);
});

test('public/sound holds only the audio the game plays, each in two formats', () => {
    const shipped = [];
    const walk = (dir) => {
        for (const e of readdirSync(dir, {withFileTypes: true})) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else shipped.push(path.relative(PUBLIC, p).split(path.sep).join('/'));
        }
    };
    walk(path.join(PUBLIC, 'sound'));
    const expected = [...effectFiles(), ...Object.values(MUSIC_TRACKS).map((t) => t.file)].flatMap((f) => [`${f}.ogg`, `${f}.m4a`]).sort();
    assert.deepEqual(shipped.sort(), expected);
});

// ---- SoundManager --------------------------------------------------------------

test('nothing plays until the first gesture unlocks audio; then it does, and music starts', () => {
    const {manager, backend} = setup({locked: true});
    assert.equal(manager.play('ui.click'), false);
    manager.setMusicState('menu');
    manager.update(100);
    assert.equal(backend.sounds.length, 0, 'nothing queued either');
    backend.unlock();
    assert.equal(manager.play('ui.click'), true);
    manager.update(100);
    assert.ok(backend.sounds.some((s) => s.key === audioKey(MUSIC_TRACKS.menu.file) && s.isPlaying));
});

test('volume is master x channel x event; mute is its own flag and keeps the levels; both persist', () => {
    const {manager, backend, store} = setup();
    manager.play('ui.accept');
    const accept = backend.sounds.at(-1);
    const expected = DEFAULT_VOLUMES.master * DEFAULT_VOLUMES.sfx * SOUND_EVENTS['ui.accept'].volume;
    assert.ok(Math.abs(accept.volume - expected) < 1e-9);
    manager.setVolume('sfx', 0.5);
    assert.ok(Math.abs(accept.volume - DEFAULT_VOLUMES.master * 0.5 * SOUND_EVENTS['ui.accept'].volume) < 1e-9, 'playing sounds follow');
    assert.equal(manager.toggleMute(), true);
    assert.equal(accept.volume, 0);
    assert.equal(manager.play('ui.deny'), false, 'muted plays nothing');
    assert.equal(manager.volume('sfx'), 0.5, 'levels kept');
    const again = new SoundManager({backend, storage: store, now: () => 0});
    assert.equal(again.muted, true);
    assert.equal(again.volume('sfx'), 0.5);
    assert.deepEqual(JSON.parse(store.get(STORAGE_KEY)).muted, true);
});

test('corrupt or blocked storage gives the defaults and never throws', () => {
    const corrupt = setup({storage: {get: () => '{not json', set: () => {}}});
    assert.equal(corrupt.manager.volume('master'), DEFAULT_VOLUMES.master);
    const blocked = setup({storage: {get: () => { throw new Error('denied'); }, set: () => { throw new Error('denied'); }}});
    assert.doesNotThrow(() => blocked.manager.setVolume('music', 0.2));
});

test('cooldowns and caps: a skipped play is free, a pool never repeats at once, hover is desktop only', () => {
    const {manager, backend, advance} = setup({random: () => 0});
    assert.equal(manager.play('ui.hover'), true);
    assert.equal(manager.play('ui.hover'), false, 'within its cooldown');
    advance(SOUND_EVENTS['ui.hover'].cooldownMs);
    assert.equal(manager.play('ui.hover'), false, 'and its one-at-a-time cap');
    backend.sounds.forEach((s) => s.finish());
    assert.equal(manager.play('ui.hover'), true);
    const files = [];
    for (let i = 0; i < 6; i++) {
        advance(1000);
        manager.play('wall.break');
        files.push(backend.sounds.at(-1).key);
        backend.sounds.forEach((s) => s.finish());
    }
    for (let i = 1; i < files.length; i++) assert.notEqual(files[i], files[i - 1]);
    assert.equal(setup({touch: true}).manager.play('ui.hover'), false);
});

test('one unit voice at a time, at least the gap apart; a select line is sometimes the rare one', () => {
    let roll = 0.5;
    const {manager, backend, advance} = setup({random: () => roll});
    assert.equal(manager.play('worker.select'), true);
    assert.equal(manager.play('soldier.order'), false, 'the voice channel is busy');
    backend.sounds.at(-1).finish();
    assert.equal(manager.play('soldier.order'), false, 'and must rest');
    advance(VOICE_GAP_MS);
    assert.equal(manager.play('soldier.order'), true);
    backend.sounds.at(-1).finish();
    advance(VOICE_GAP_MS);
    roll = RARE_CHANCE / 2;
    manager.play('worker.select');
    assert.ok(SOUND_EVENTS['worker.rare'].files.some((f) => backend.sounds.at(-1).key === audioKey(f)));
});

test('the PA is one voice: a line, a pause, the next; no tower stops it; play() cannot speak for it', () => {
    const {manager, backend, advance} = setup();
    assert.equal(manager.play('papi.broadcast'), false);
    manager.broadcast({pan: 0});
    manager.broadcast({pan: 0.5}); // ten towers, one frame: still one line
    const lines = () => backend.sounds.filter((s) => s.key.includes('loudspeeker'));
    assert.equal(lines().length, 1);
    lines()[0].finish();
    advance(19000);
    manager.broadcast({pan: 0});
    assert.equal(lines().length, 1, 'still pausing');
    advance(11000);
    manager.broadcast({pan: 0});
    assert.equal(lines().length, 2);
    manager.broadcast(null);
    assert.equal(lines()[1].isPlaying, false, 'no operating tower: silence');
});

test('engine loops follow the moving trucks, at most two, and stop when they do', () => {
    const {manager, backend} = setup();
    const want = (...ids) => new Map(ids.map((id) => [id, {event: 'vehicle.engine', pan: 0, gain: 1}]));
    manager.syncLoops(want('t1', 't2', 't3'));
    assert.deepEqual(manager.snapshot().loops.map((l) => l.id), ['t1', 't2']);
    assert.ok(backend.sounds.every((s) => s.loop));
    manager.syncLoops(want('t2'));
    assert.deepEqual(manager.snapshot().loops.map((l) => l.id), ['t2']);
    assert.equal(backend.sounds[0].isPlaying, false);
    manager.stopTransient();
    assert.deepEqual(manager.snapshot().loops, []);
});

test('music: the same state never restarts a track; Dusk halves it, Night silences it, the newspaper ducks it', () => {
    const {manager, backend} = setup();
    manager.setMusicState('day');
    manager.update(5000);
    const day = backend.sounds.find((s) => s.key === audioKey(MUSIC_TRACKS.day.file));
    assert.equal(day.plays, 1);
    manager.setMusicState('day');
    manager.update(5000);
    assert.equal(day.plays, 1, 'never restarted');
    const full = day.volume;
    manager.duck(true);
    manager.update(1000);
    assert.ok(Math.abs(day.volume - full * DUCK_GAIN) < 1e-9);
    manager.duck(false);
    manager.update(1000);
    manager.setMusicState('dusk');
    manager.update(10000);
    assert.ok(Math.abs(day.volume - full * 0.5) < 1e-9);
    manager.setMusicState('night');
    manager.update(10000);
    assert.equal(day.isPlaying, false);
    assert.equal(manager.snapshot().music.tracks.day.gain, 0);
    manager.setMusicState('menu');
    manager.update(800);
    const {tracks} = manager.snapshot().music;
    assert.ok(tracks.menu.gain > 0 && tracks.menu.gain < 1, 'a crossfade, not a cut');
});

test('music waits for its files: none until they have loaded', () => {
    let loaded = false;
    const {manager, backend} = setup({loaded: (key) => !key.includes('MUSIC') || loaded});
    manager.setMusicState('menu');
    manager.update(100);
    assert.equal(backend.sounds.length, 0);
    loaded = true;
    manager.update(100);
    assert.equal(backend.sounds.length, 1);
});

// ---- The game adapter ------------------------------------------------------------

const VIEW = {
    positionOf: (id) => ({cannon: {x: 10, y: 10}, gun: {x: 20, y: 20}, wall: {x: 30, y: 30}, factory: {x: 900, y: 900}}[id] ?? null),
    typeOf: (id) => ({wall: 'wall', factory: 'factory'}[id] ?? null),
    mutantAt: (id) => ({m1: {x: 50, y: 50}, m2: {x: 999, y: 999}}[id] ?? null),
    isSeen: ({x}) => x < 500,
};

test('tick results become events; hidden ones are silent, except losing your own building', () => {
    const events = tickEvents({
        siege: {fired: [{gunId: 'gun'}], impacts: [{x: 40, y: 40, killed: true}]},
        defense: {shots: [{turretId: 'cannon', killed: false, x: 60, y: 60}]},
        squads: {shots: [{rocket: true, killed: false, fromX: 1, fromY: 1, x: 70, y: 70}, {killed: true, fromX: 2, fromY: 2, x: 80, y: 80}]},
        effects: {spawned: ['m1', 'm2'], attacks: [{buildingId: 'factory'}], destroyed: ['wall', 'factory']},
    }, VIEW).map(({event}) => event);
    assert.deepEqual(events, [
        'weapon.rocket_alt', 'combat.explosion', 'mutant.hit', 'weapon.machinegun', 'combat.explosion', 'weapon.machinegun_alt', 'mutant.hit',
        'mutant.growl', // m2 is hidden; the attack on the hidden Factory is silent too
        'wall.break', 'building.destroy', // but losing it is always heard
    ]);
});

test('a command\'s result plays accept or deny, never both', () => {
    const {manager, backend} = setup();
    const audio = new GameAudio(manager);
    audio.result(false);
    audio.result(true);
    const keys = backend.sounds.map((s) => s.key);
    assert.deepEqual(keys, [audioKey(SOUND_EVENTS['ui.deny'].files[0]), audioKey(SOUND_EVENTS['ui.accept'].files[0])]);
});

test('the music each moment wants', () => {
    assert.equal(musicState({phase: 'ready'}), 'menu');
    assert.equal(musicState({phase: 'started', shift: 'day'}), 'day');
    assert.equal(musicState({phase: 'started', shift: 'dusk'}), 'dusk');
    assert.equal(musicState({phase: 'started', shift: 'night'}), 'night');
    assert.equal(musicState({phase: 'defeated', shift: 'defeated'}), 'defeat');
});

test('a disabled manager does nothing at all', () => {
    const manager = new SoundManager({backend: null, enabled: false, storage: {get: () => null, set: () => {}}});
    assert.equal(manager.play('ui.click'), false);
    assert.doesNotThrow(() => {
        manager.setMusicState('day');
        manager.update(16);
        manager.broadcast({pan: 0});
        manager.syncLoops(new Map([['t', {event: 'vehicle.engine'}]]));
        manager.stopTransient();
    });
});

test('sound only listens: a Night replays identically whether the audio adapter hears every tick or not', async () => {
    const {createWorld, digestOf, worldState} = await import('../soak/harness.js');
    const night = (withAudio) => {
        const w = createWorld({schedule: [600, 900, 1200, 1500, 1800]});
        w.place('powerPlant', 3, 3);
        w.place('autocannon', 11, 7);
        w.place('outpost', 13, 9);
        const {manager} = setup();
        const audio = new GameAudio(manager);
        w.cycle.endDay();
        const view = {positionOf: () => ({x: 0, y: 0}), typeOf: () => 'outpost', mutantAt: () => ({x: 0, y: 0}), isSeen: () => true};
        for (let i = 0; i < 3600; i++) {
            w.cycle.stepTicks(1, (t) => {
                const results = w.tick(t);
                if (withAudio) audio.tick({defense: results.defense, siege: results.siege, squads: {shots: results.infantryShots}, effects: results.effects}, view);
            });
        }
        return digestOf(JSON.stringify(worldState(w)));
    };
    assert.equal(night(true), night(false));
});

// ---- World audio: suspended while the world is stopped (TASK 030 hotfix) ---------------

/** A frame of GameAudio with one truck and one tower, the world running or not. */
function frameWith(audio, {worldActive = true, truck = 'outbound', newspaperOpen = false, shift = 'day'} = {}) {
    audio.frame({
        phase: 'started', shift, newspaperOpen, worldActive,
        camera: {x: 0, y: 0, width: 1280, height: 720}, isSeen: () => true,
        trucks: truck ? [{id: 'truck-factory-3', state: truck, x: 100, y: 100}] : [],
        towers: [{id: 'loudspeaker-4', operating: true, x: 200, y: 200}],
    }, 16);
}
const engines = (backend) => backend.sounds.filter((s) => s.loop && s.key.includes('ENGINE') && s.isPlaying);
const musicPlaying = (backend) => backend.sounds.filter((s) => s.loop && s.key.includes('MUSIC') && s.isPlaying);
const pa = (backend) => backend.sounds.filter((s) => s.key.includes('loudspeeker') && s.isPlaying);

test('1. a moving truck\'s engine and the PA fall silent the moment the world stops (the newspaper opens)', () => {
    const {manager, backend} = setup();
    const audio = new GameAudio(manager);
    frameWith(audio);
    assert.equal(engines(backend).length, 1);
    assert.equal(pa(backend).length, 1);
    frameWith(audio, {worldActive: false, newspaperOpen: true});
    assert.equal(engines(backend).length, 0);
    assert.equal(pa(backend).length, 0);
    for (let i = 0; i < 30; i++) frameWith(audio, {worldActive: false, newspaperOpen: true});
    assert.equal(engines(backend).length, 0, 'and none starts while it stays stopped');
    assert.equal(manager.snapshot().worldActive, false);
});

test('2-3. when it runs again a moving truck has exactly one engine, however often the newspaper opened', () => {
    const {manager, backend} = setup();
    const audio = new GameAudio(manager);
    for (let cycle = 0; cycle < 5; cycle++) {
        frameWith(audio);
        frameWith(audio);
        assert.equal(engines(backend).length, 1, `open ${cycle}`);
        frameWith(audio, {worldActive: false, newspaperOpen: true});
        assert.equal(engines(backend).length, 0);
    }
    frameWith(audio);
    assert.equal(engines(backend).length, 1);
    assert.equal(backend.sounds.filter((s) => s.key.includes('ENGINE') && s.isPlaying).length, 1, 'no orphaned engine anywhere');
});

test('4. a truck that parked or fell while the world was stopped does not start again', () => {
    const {manager, backend} = setup();
    const audio = new GameAudio(manager);
    frameWith(audio);
    frameWith(audio, {worldActive: false});
    frameWith(audio, {truck: 'idle'}); // parked meanwhile
    assert.equal(engines(backend).length, 0);
    frameWith(audio, {worldActive: false});
    frameWith(audio, {truck: null}); // destroyed or removed
    assert.equal(engines(backend).length, 0);
    assert.deepEqual(manager.snapshot().loops, []);
});

test('5. a newspaper reopened in a Day the player paused leaves the world silent after it closes, until PLAY', () => {
    const {manager, backend} = setup();
    const audio = new GameAudio(manager);
    frameWith(audio);
    frameWith(audio, {worldActive: false}); // PAUSE
    frameWith(audio, {worldActive: false, newspaperOpen: true}); // READ LA VOZ
    frameWith(audio, {worldActive: false}); // CONTINUE: still paused
    assert.equal(engines(backend).length, 0);
    frameWith(audio); // PLAY
    assert.equal(engines(backend).length, 1);
});

test('6. music and UI sounds are not world sounds: they carry on while the world is stopped', () => {
    const {manager, backend} = setup();
    const audio = new GameAudio(manager);
    for (let i = 0; i < 400; i++) frameWith(audio);
    assert.equal(musicPlaying(backend).length, 1);
    for (let i = 0; i < 100; i++) frameWith(audio, {worldActive: false, newspaperOpen: true});
    assert.equal(musicPlaying(backend).length, 1, 'still playing, only ducked');
    assert.ok(manager.snapshot().music.duck < 0.5);
    assert.equal(manager.play('ui.click'), true);
    assert.equal(manager.play('ui.open'), true);
    for (let i = 0; i < 100; i++) frameWith(audio);
    assert.equal(musicPlaying(backend).length, 1, 'one music instance, never two');
    assert.equal(manager.snapshot().music.duck, 1);
});

test('settings saved before version 2 keep their mute but drop their frozen default volumes', () => {
    const old = {get: () => JSON.stringify({volumes: {master: 0.8, music: 0.6, sfx: 0.8, voices: 0.9}, muted: true}), set: () => {}};
    const {manager} = setup({storage: old});
    assert.equal(manager.muted, true);
    assert.equal(manager.volume('music'), DEFAULT_VOLUMES.music);
    const store = new Map();
    const fresh = setup({storage: {get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v)}});
    fresh.manager.toggleMute();
    assert.deepEqual(JSON.parse(store.get(STORAGE_KEY)), {version: 2, volumes: {}, muted: true}, 'a mute saves no volumes');
    fresh.manager.setVolume('music', 0.3);
    assert.deepEqual(JSON.parse(store.get(STORAGE_KEY)).volumes, {music: 0.3}, 'only what the player set');
});

test('music gains put both tracks near -18 dB on average, not near -30', () => {
    const level = (track) => DEFAULT_VOLUMES.master * DEFAULT_VOLUMES.music * MUSIC_TRACKS[track].volume;
    const db = (gain, sourceDb) => sourceDb + 20 * Math.log10(gain);
    assert.ok(db(level('menu'), -13.3) > -20, `menu ${db(level('menu'), -13.3).toFixed(1)} dB`);
    assert.ok(db(level('day'), -15.9) > -20, `day ${db(level('day'), -15.9).toFixed(1)} dB`);
});
