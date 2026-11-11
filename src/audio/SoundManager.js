/**
 * TASK 030: the one place sound is played. Adapted from BarrelStorm's SoundManager
 * (one manager per game, channel volumes, persisted settings, guarded sounds), with
 * a separate mute flag, semantic events, cooldowns and caps, one unit voice and one
 * PA broadcast, managed loops, and music states with crossfades and ducking.
 * TASK 033.4: one presidential voice (`voice: 'president'`, through speak() only), which
 * the units never talk over and which never overlaps another presidential line.
 *
 * It needs only a small backend: `locked`, `once('unlocked', fn)` and
 * `add(key, {volume, loop})` returning a sound with `play`, `stop`, `destroy`,
 * `setVolume`, `isPlaying` and `once('complete', fn)`; Phaser's game.sound is one,
 * and unit tests pass a fake. It never touches the simulation: it only hears about
 * things that already happened, so muting or disabling it cannot change an outcome.
 * Its randomness is its own (`random`), never the game's RNG.
 */
import {
    BROADCAST_GAP_MS, CHANNELS, DEFAULT_VOLUMES, DUCK_GAIN, FADE_MS, MUSIC_STATES, MUSIC_TRACKS, RARE_CHANCE,
    SOUND_EVENTS, VOICE_GAP_MS, audioKey,
} from './soundMap.js';

export const STORAGE_KEY = 'papi_audio';
/** 2: only volumes the player set are saved, so better defaults reach everyone else. */
const SETTINGS_VERSION = 2;
const RECENT = 20;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const isLive = (sound) => Boolean(sound) && !sound.pendingRemove && sound.manager !== null;

/** localStorage, or nothing: a private window or blocked storage must never break audio. */
export function browserStorage() {
    return {
        get(key) {
            try {
                return globalThis.localStorage?.getItem(key) ?? null;
            } catch {
                return null;
            }
        },
        /** @returns {boolean} whether it was stored (TASK 043: the campaign save needs to know) */
        set(key, value) {
            try {
                if (!globalThis.localStorage) return false;
                globalThis.localStorage.setItem(key, value);
                return true;
            } catch {
                return false; // the setting simply does not persist
            }
        },
        /** @returns {boolean} whether the key is now absent */
        remove(key) {
            try {
                globalThis.localStorage?.removeItem(key);
                return true;
            } catch {
                return false;
            }
        },
    };
}

export class SoundManager {
    #backend;
    #hasAudio;
    #storage;
    #now;
    #random;
    #touch;
    #volumes;
    #custom = {}; // the volumes the player set: only these are saved
    #muted;
    #debug;
    #active = new Map(); // event -> Set of playing sounds
    #lastAt = new Map(); // event -> when it last played
    #lastFile = new Map(); // event -> the file it last played, so pools never repeat at once
    #voice = {sound: null, freeAt: 0, event: null};
    #president = {sound: null, event: null}; // TASK 033.4: the one presidential line
    #events; // the event map: SOUND_EVENTS, unless a test gives its own
    #broadcast = {sound: null, nextAt: 0, on: false};
    #loops = new Map(); // id -> {event, sound, gain}
    #tracks = new Map(); // track name -> {sound, gain}
    #music = {state: null, duck: 1, duckTarget: 1};
    #recent = [];
    #worldActive = true; // false while the world is stopped: no engines, no PA

    /**
     * @param {{backend: object | null, hasAudio?: (key: string) => boolean, storage?: object,
     *          now?: () => number, random?: () => number, enabled?: boolean, touch?: boolean}} deps
     *   enabled - false makes every call a no-op (TEST_MODE's ?audio=off)
     */
    constructor({backend, hasAudio = () => true, storage = browserStorage(), now = () => performance.now(), random = Math.random, enabled = true, touch = false, debug = null, events = SOUND_EVENTS}) {
        this.#events = events;
        this.#debug = debug ?? (() => {});
        this.#backend = enabled ? backend : null;
        this.#hasAudio = hasAudio;
        this.#storage = storage;
        this.#now = now;
        this.#random = random;
        this.#touch = touch;
        const saved = this.#load();
        this.#custom = saved.volumes;
        this.#volumes = {...DEFAULT_VOLUMES, ...saved.volumes};
        this.#muted = saved.muted === true;
        this.#backend?.once?.('unlocked', () => this.update(0));
    }

    get enabled() {
        return this.#backend !== null;
    }

    /** Browsers keep audio locked until the player first touches or clicks. */
    get unlocked() {
        return this.enabled && !this.#backend.locked;
    }

    get muted() {
        return this.#muted;
    }

    volume(channel) {
        return this.#volumes[channel];
    }

    // ---- Settings ------------------------------------------------------------

    setVolume(channel, value) {
        if (!CHANNELS.includes(channel) || !Number.isFinite(value)) return;
        this.#volumes[channel] = clamp01(value);
        this.#custom[channel] = this.#volumes[channel];
        this.#save();
        this.#applyVolumes();
    }

    setMuted(muted) {
        this.#muted = Boolean(muted);
        this.#save();
        this.#applyVolumes();
    }

    toggleMute() {
        this.setMuted(!this.#muted);
        return this.#muted;
    }

    #level(channel, base) {
        if (this.#muted) return 0;
        return clamp01(this.#volumes.master * this.#volumes[channel] * base);
    }

    #load() {
        try {
            const raw = this.#storage.get(STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : {};
            const volumes = {};
            // Before version 2 every save held every volume, defaults included: keep only the mute.
            if (parsed?.version !== SETTINGS_VERSION) return {volumes, muted: parsed?.muted === true};
            for (const channel of CHANNELS) {
                const value = parsed?.volumes?.[channel];
                if (Number.isFinite(value)) volumes[channel] = clamp01(value);
            }
            return {volumes, muted: parsed?.muted === true};
        } catch {
            return {volumes: {}, muted: false}; // corrupt settings: defaults
        }
    }

    #save() {
        try {
            this.#storage.set(STORAGE_KEY, JSON.stringify({version: SETTINGS_VERSION, volumes: this.#custom, muted: this.#muted}));
        } catch {
            // settings simply do not persist
        }
    }

    #applyVolumes() {
        for (const [name, sounds] of this.#active) {
            const {channel, volume} = this.#events[name];
            for (const sound of sounds) sound.setVolume(this.#level(channel, volume * (sound.papiGain ?? 1)));
        }
        for (const loop of this.#loops.values()) loop.sound.setVolume(this.#level('sfx', this.#events[loop.event].volume * loop.gain));
        this.#applyMusic();
    }

    // ---- One-shots -----------------------------------------------------------

    /**
     * Play a semantic event, if its limits allow. Nothing is queued: a sound that
     * cannot play now is simply skipped, and a skip uses no cooldown.
     * @param {string} name a SOUND_EVENTS key
     * @param {{pan?: number, gain?: number}} [options] gain scales this one play (distance), pan -1..1
     * @returns {boolean} whether it played
     */
    play(name, {pan = 0, gain = 1} = {}) {
        let definition = this.#events[name];
        if (!definition || !this.unlocked || this.#muted || gain <= 0) return false;
        if (definition.desktopOnly && this.#touch) return false;
        if (definition.voice === 'broadcast') return false; // only broadcast() speaks for the PA
        if (definition.voice === 'president') return false; // only speak() speaks for the President
        const now = this.#now();
        if (now - (this.#lastAt.get(name) ?? -Infinity) < definition.cooldownMs) return false;
        if ((this.#active.get(name)?.size ?? 0) >= definition.maxConcurrent) return false;
        if (definition.voice === 'unit' && (this.#speaking() || isLive(this.#voice.sound) && this.#voice.sound.isPlaying || now < this.#voice.freeAt)) return false;
        let played = name;
        if (definition.rare && this.#random() < RARE_CHANCE) {
            played = definition.rare;
            definition = this.#events[played];
        }
        const sound = this.#start(played, definition, {pan, gain});
        if (!sound) return false;
        this.#lastAt.set(name, now);
        if (definition.voice === 'unit') {
            this.#voice.sound = sound;
            this.#voice.event = played;
            this.#voice.freeAt = now + VOICE_GAP_MS;
        }
        return true;
    }

    // ---- TASK 033.4: the presidential voice ---------------------------------------------

    /** Is a presidential line sounding? */
    #speaking() {
        return isLive(this.#president.sound) && this.#president.sound.isPlaying;
    }

    /**
     * A presidential line, global (no pan, no distance), on the VOICES channel. It never
     * overlaps another and is never queued: refused while one speaks, or while audio is
     * locked or muted. It outranks the units: a unit line talking now stops, and none
     * starts until it ends.
     * @param {string} name an event with voice: 'president'
     * @returns {boolean} whether it started
     */
    speak(name) {
        const definition = this.#events[name];
        if (!definition || definition.voice !== 'president' || !this.unlocked || this.#muted) return false;
        if (this.#speaking()) return false;
        const unit = this.#voice.sound;
        if (isLive(unit) && unit.isPlaying) {
            unit.stop();
            this.#release(this.#voice.event, unit);
        }
        const sound = this.#start(name, definition);
        if (!sound) return false;
        this.#president = {sound, event: name};
        this.#voice.freeAt = this.#now() + VOICE_GAP_MS; // and a breath before the units speak again
        return true;
    }

    /**
     * TASK 036: how far into the presidential line `name` playback is, in seconds, while it
     * really plays; otherwise null (never started, ended, stopped, muted or paused).
     */
    presidentPosition(name) {
        const {sound, event} = this.#president;
        if (event !== name || !this.#speaking()) return null;
        return Number.isFinite(sound.seek) ? sound.seek : null;
    }

    /** Stop the presidential line, if one speaks: its tip has gone. */
    silence() {
        const {sound, event} = this.#president;
        if (sound && isLive(sound)) {
            sound.stop();
            this.#release(event, sound);
        }
        this.#president = {sound: null, event: null};
    }

    /** A file from the pool, never the one it played last when there is a choice. */
    #pick(name, files) {
        const last = this.#lastFile.get(name);
        const choices = files.length > 1 ? files.filter((f) => f !== last) : files;
        const file = choices[Math.min(choices.length - 1, Math.floor(this.#random() * choices.length))];
        this.#lastFile.set(name, file);
        return file;
    }

    #start(name, definition, {pan = 0, gain = 1, loop = false} = {}) {
        const file = this.#pick(name, definition.files);
        const key = audioKey(file);
        if (!this.#hasAudio(key)) return null;
        const sound = this.#backend.add(key, {volume: this.#level(definition.channel, definition.volume * gain), loop});
        sound.papiGain = gain;
        if (pan) sound.setPan?.(Math.max(-1, Math.min(1, pan)));
        if (!loop) {
            const playing = this.#active.get(name) ?? new Set();
            playing.add(sound);
            this.#active.set(name, playing);
            sound.once?.('complete', () => this.#release(name, sound));
        }
        sound.play();
        this.#recent.push({event: name, file, at: Math.round(this.#now())});
        if (this.#recent.length > RECENT) this.#recent.shift();
        return sound;
    }

    #release(name, sound) {
        this.#active.get(name)?.delete(sound);
        sound.destroy?.();
    }

    // ---- The world's own sound ----------------------------------------------------

    /**
     * Sounds that belong to the running world (engine loops, the PA) only play while
     * it runs. Stopped (the newspaper, a paused Day, the menu, Game Over), every such
     * loop stops at once and none can start; music and UI sounds are untouched. When
     * it runs again nothing is restored from memory: the next syncLoops() starts what
     * is moving then, so a truck that parked, fell or left stays silent.
     */
    setWorldActive(active) {
        if (this.#worldActive !== Boolean(active)) this.#debug('world-active', {active: Boolean(active)});
        this.#worldActive = Boolean(active);
        if (this.#worldActive) return;
        this.syncLoops(new Map());
        this.broadcast(null);
    }

    get worldActive() {
        return this.#worldActive;
    }

    // ---- Loops (truck engines) ------------------------------------------------

    /**
     * The loops wanted this frame, by id: anything missing stops, anything new
     * starts (within the event's cap), anything kept follows its new pan and gain.
     * @param {Map<string, {event: string, pan?: number, gain?: number}>} wanted
     */
    syncLoops(wanted) {
        if (!this.#worldActive) wanted = new Map();
        for (const [id, loop] of [...this.#loops]) {
            if (wanted.has(id) && this.unlocked) continue;
            loop.sound.stop();
            loop.sound.destroy?.();
            this.#loops.delete(id);
        }
        if (!this.unlocked) return;
        for (const [id, {event, pan = 0, gain = 1}] of wanted) {
            const definition = this.#events[event];
            if (!definition?.loop) continue;
            const existing = this.#loops.get(id);
            if (existing) {
                existing.gain = gain;
                existing.sound.setVolume(this.#level(definition.channel, definition.volume * gain));
                existing.sound.setPan?.(pan);
                continue;
            }
            const count = [...this.#loops.values()].filter((l) => l.event === event).length;
            if (count >= definition.maxConcurrent) continue;
            const sound = this.#start(event, definition, {pan, gain, loop: true});
            if (sound) this.#loops.set(id, {event, sound, gain});
        }
    }

    // ---- The PA broadcast -------------------------------------------------------

    /**
     * One voice for every Loudspeaker: while any tower operates (`source` given),
     * one line at a time, a pause between lines; with none, it stops. Ten towers
     * are still one voice.
     * @param {{pan?: number, gain?: number} | null} source the nearest operating tower, or null
     */
    broadcast(source) {
        const current = this.#broadcast.sound;
        const speaking = isLive(current) && current.isPlaying;
        if (!source || !this.#worldActive) {
            if (speaking) current.stop();
            this.#broadcast.on = false;
            return;
        }
        if (!this.unlocked || this.#muted) return;
        const now = this.#now();
        if (!this.#broadcast.on) {
            this.#broadcast.on = true;
            this.#broadcast.nextAt = Math.max(this.#broadcast.nextAt, now); // a fresh broadcast starts at once
        }
        if (speaking || now < this.#broadcast.nextAt) return;
        const sound = this.#start('papi.broadcast', this.#events['papi.broadcast'], source);
        if (!sound) return;
        this.#broadcast.sound = sound;
        const {min, max} = BROADCAST_GAP_MS;
        this.#broadcast.nextAt = now + min + this.#random() * (max - min);
    }

    // ---- Music --------------------------------------------------------------------

    /** The music for a state: the same state again changes nothing, so a redraw never restarts a track. */
    setMusicState(state) {
        if (!MUSIC_STATES[state] || this.#music.state === state) return;
        this.#debug('music-state', {from: this.#music.state, to: state, track: MUSIC_STATES[state].track});
        this.#music.fadeMs = state === 'dusk' ? FADE_MS.dusk : state === 'defeat' ? FADE_MS.defeat : FADE_MS.crossfade;
        this.#music.state = state;
    }

    /** The newspaper lowers the music while it is open. */
    duck(on) {
        this.#music.duckTarget = on ? DUCK_GAIN : 1;
    }

    /**
     * Once a frame: fades move towards their targets, a track whose gain reaches
     * zero stops, and music starts once audio is unlocked.
     * @param {number} deltaMs real time since the last frame
     */
    update(deltaMs) {
        if (!this.enabled) return;
        const step = (from, to, ms) => {
            if (ms <= 0 || from === to) return to;
            const delta = deltaMs / ms;
            return from < to ? Math.min(to, from + delta) : Math.max(to, from - delta);
        };
        this.#music.duck = step(this.#music.duck, this.#music.duckTarget, FADE_MS.duck);
        const wanted = MUSIC_STATES[this.#music.state] ?? {track: null, gain: 0};
        const fade = this.#music.fadeMs ?? FADE_MS.crossfade;
        for (const name of Object.keys(MUSIC_TRACKS)) {
            const target = name === wanted.track ? wanted.gain : 0;
            let track = this.#tracks.get(name);
            if (!track && target > 0 && this.unlocked) {
                const key = audioKey(MUSIC_TRACKS[name].file);
                if (!this.#hasAudio(key)) { // music arrives after the first gesture
                    this.#debug('music-waiting', {track: name, key});
                    continue;
                }
                track = {sound: this.#backend.add(key, {volume: 0, loop: true}), gain: 0};
                this.#tracks.set(name, track);
                this.#debug('music-created', {track: name, key});
            }
            if (!track) continue;
            track.gain = step(track.gain, target, fade);
            if (track.gain > 0 && !track.sound.isPlaying && this.unlocked) {
                const started = track.sound.play();
                this.#debug(started === false ? 'music-play-failed' : 'music-play', {track: name, state: this.#music.state});
            }
            if (track.gain === 0 && track.sound.isPlaying) {
                track.sound.stop();
                this.#debug('music-stop', {track: name, reason: `faded out for state ${this.#music.state}`});
            }
        }
        this.#applyMusic();
    }

    #applyMusic() {
        for (const [name, track] of this.#tracks) {
            track.sound.setVolume(this.#level('music', MUSIC_TRACKS[name].volume * track.gain * this.#music.duck));
        }
    }

    // ---- Lifecycle ------------------------------------------------------------------

    /** A scene ends: loops, voices, the PA and one-shots stop; music carries on to its next state. */
    stopTransient() {
        this.syncLoops(new Map());
        this.broadcast(null);
        for (const [name, sounds] of this.#active) {
            for (const sound of [...sounds]) {
                sound.stop();
                this.#release(name, sound);
            }
        }
        this.#voice = {sound: null, freeAt: 0, event: null};
        this.#president = {sound: null, event: null};
    }

    /** Detached, for QA. */
    snapshot() {
        const playing = (sound) => isLive(sound) && sound.isPlaying;
        return {
            enabled: this.enabled,
            unlocked: this.unlocked,
            muted: this.#muted,
            volumes: {...this.#volumes},
            music: {
                state: this.#music.state,
                duck: this.#music.duck,
                tracks: Object.fromEntries([...this.#tracks].map(([name, t]) => [name, {gain: t.gain, playing: playing(t.sound)}])),
            },
            voiceBusy: playing(this.#voice.sound),
            presidentSpeaking: playing(this.#president.sound), // TASK 033.4
            presidentLine: playing(this.#president.sound) ? this.#president.event : null,
            presidentVolume: playing(this.#president.sound) ? this.#president.sound.volume : null, // what the line really plays at
            broadcasting: playing(this.#broadcast.sound),
            worldActive: this.#worldActive,
            loops: [...this.#loops].map(([id, {event}]) => ({id, event})),
            // What is really sounding in Phaser, not what is tracked: a leaked engine would show here.
            playingEngines: (this.#backend?.getAllPlaying?.() ?? []).filter((s) => String(s.key).includes('ENGINE')).length,
            playingMusic: (this.#backend?.getAllPlaying?.() ?? []).filter((s) => String(s.key).includes('/MUSIC/')).length,
            recent: this.#recent.map((r) => ({...r})),
        };
    }
}
