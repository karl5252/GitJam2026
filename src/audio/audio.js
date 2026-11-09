/**
 * TASK 030: the game's SoundManager and its loading. One manager per Phaser game
 * (as BarrelStorm): scenes come and go and share it; a new game gets a new one.
 *
 * Effects and voices (about 2 MB) load with the boot; the music (about 6 MB in
 * either format) loads only after the first gesture, so Start is never delayed.
 * Every file is offered as OGG and AAC; Phaser takes the one the browser plays.
 *
 * TEST_MODE's ?audio=off (boot() adds it unless a test asks for audio) disables
 * the manager and loads nothing. A shipped game always has audio.
 */
import {TEST_MODE} from '../testMode.js';
import {currentLayout} from '../scenes/hudLayout.js';
import {SoundManager} from './SoundManager.js';
import {MUSIC_TRACKS, audioKey, audioUrls, effectFiles} from './soundMap.js';

const managers = new WeakMap();
const debuggers = new WeakMap();

export const audioEnabled = () => !(TEST_MODE && new URLSearchParams(window.location.search).get('audio') === 'off');

/** ?audioDebug=1, in any session (TEST_MODE or not): diagnostics, not a feature. */
export const audioDebugOn = () => new URLSearchParams(window.location.search).get('audioDebug') === '1';

const ERRORS = new Set(['load-error', 'music-play-failed']);

/**
 * The audio debug log: each decision once, in the console and in a small panel
 * at the bottom left, with the live state twice a second. Errors in red.
 */
function audioDebugger(game) {
    if (!audioDebugOn() || typeof document === 'undefined') return null;
    const last = new Map();
    const events = [];
    const panel = document.createElement('pre');
    panel.id = 'audio-debug';
    Object.assign(panel.style, {
        position: 'fixed', left: '4px', bottom: '4px', zIndex: 9999, margin: 0, padding: '6px 8px', maxWidth: '48vw',
        font: '11px/1.35 monospace', color: '#b9f6ca', background: 'rgba(0,0,0,0.78)', pointerEvents: 'none', whiteSpace: 'pre-wrap',
    });
    document.body.appendChild(panel);
    const log = (kind, detail = {}) => {
        const text = `${kind} ${JSON.stringify(detail)}`;
        if (last.get(kind) === text) return; // a decision once, not every frame
        last.set(kind, text);
        (ERRORS.has(kind) ? console.warn : console.info)('[audio]', kind, detail);
        events.push({text: `${(performance.now() / 1000).toFixed(1)}s ${text}`, error: ERRORS.has(kind)});
        if (events.length > 14) events.shift();
    };
    log.render = (manager) => {
        const s = manager.snapshot();
        const context = game.sound?.context;
        let saved = null;
        try {
            saved = localStorage.getItem('papi_audio');
        } catch {
            saved = '(storage blocked)';
        }
        const tracks = Object.entries(s.music.tracks).map(([name, t]) => `${name}: gain ${t.gain.toFixed(2)} ${t.playing ? 'PLAYING' : 'stopped'}`).join(', ') || 'none created';
        panel.innerHTML = [
            '<b>AUDIO DEBUG</b>',
            `context ${context?.state ?? 'none'} · locked ${game.sound?.locked} · enabled ${s.enabled} · muted ${s.muted}`,
            `volumes ${JSON.stringify(s.volumes)} · saved ${saved}`,
            `music state ${s.music.state} · duck ${s.music.duck.toFixed(2)} · ${tracks}`,
            `world ${s.worldActive ? 'active' : 'suspended'} · engines ${s.playingEngines} · music instances ${s.playingMusic}`,
            ...events.map(({text, error}) => (error ? `<span style="color:#ff8a80">${text}</span>` : text)),
        ].join(String.fromCharCode(10));
    };
    return log;
}

/** @returns {SoundManager} */
export function audioFor(game) {
    let manager = managers.get(game);
    if (!manager) {
        const debug = audioDebugger(game);
        manager = new SoundManager({
            backend: game.sound,
            hasAudio: (key) => game.cache.audio.exists(key),
            enabled: audioEnabled(),
            touch: currentLayout().touch,
            debug,
        });
        managers.set(game, manager);
        if (debug) {
            debuggers.set(game, debug);
            debug('created', {enabled: manager.enabled, locked: game.sound?.locked, context: game.sound?.context?.state ?? null});
            game.sound?.once?.('unlocked', () => debug('unlocked', {context: game.sound?.context?.state ?? null}));
            const timer = setInterval(() => debug.render(manager), 500);
            game.events.once('destroy', () => clearInterval(timer));
        }
        game.events.once('destroy', () => managers.delete(game));
    }
    return manager;
}

/** BootScene: every effect and voice. */
export function preloadEffects(scene) {
    if (!audioEnabled()) return;
    for (const file of effectFiles()) scene.load.audio(audioKey(file), audioUrls(file));
}

/** After the first gesture (or at once if audio is already unlocked): the music, in the background. */
export function loadMusicWhenUnlocked(scene) {
    if (!audioEnabled()) return;
    const load = () => {
        // Audio can already be unlocked when the scene is still being created (a browser
        // that allows autoplay on this site): the loader then waits for the scene's first
        // update. Returning here instead was why music was never requested at all.
        if (!scene.sys?.isActive()) {
            debuggers.get(scene.game)?.('music-load-deferred', {reason: 'scene not running yet'});
            scene.events.once('update', load);
            return;
        }
        const missing = Object.values(MUSIC_TRACKS).filter(({file}) => !scene.cache.audio.exists(audioKey(file)));
        if (missing.length === 0) return;
        const debug = debuggers.get(scene.game);
        for (const {file} of missing) {
            scene.load.audio(audioKey(file), audioUrls(file));
            debug?.(`music-request ${file.split('/').pop()}`, {urls: audioUrls(file)});
        }
        if (debug) {
            const keys = new Set(missing.map(({file}) => audioKey(file)));
            scene.load.on('filecomplete', (key) => {
                if (keys.has(key)) debug(`load-ok ${key.split('/').pop()}`, {cached: scene.cache.audio.exists(key)});
            });
            scene.load.on('loaderror', (file) => debug('load-error', {key: file.key, url: file.url, status: file.xhrLoader?.status ?? null}));
        }
        scene.load.start();
    };
    debuggers.get(scene.game)?.('music-load-scheduled', {afterUnlock: Boolean(scene.sound.locked)});
    if (scene.sound.locked) scene.sound.once('unlocked', load);
    else load();
}
