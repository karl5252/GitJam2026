/**
 * TASK 030: semantic sound events and the files behind them. Pure data, no Phaser.
 *
 * The authoritative mapping is audio-src/sound/SOUND_MAP.txt, whose sounds were
 * auditioned and approved: every entry here is taken from it, unchanged. Gameplay
 * and UI code only ever name an event; only this module knows a filename.
 *
 * Every file ships as `<base>.ogg` and an AAC `<base>.m4a` (for Safari and iOS);
 * Phaser loads whichever the browser can play. Paths are relative to public/.
 *
 * Channels: master scales everything; music, sfx (UI included) and voices scale
 * their own. `voice: 'unit'` lines share one channel, so units never talk over
 * each other; `voice: 'broadcast'` is the Loudspeakers' single PA voice.
 *
 * Limits are in real milliseconds: audio is presentation, and must never be timed
 * by simulation ticks it cannot change.
 */

const UI = 'sound/SFX/UI/';
const SFX = 'sound/SFX/';
const V = 'sound/VOICES/';
const M = 'sound/MUSIC/';

export const CHANNELS = Object.freeze(['master', 'music', 'sfx', 'voices']);
export const DEFAULT_VOLUMES = Object.freeze({master: 0.8, music: 0.8, sfx: 0.8, voices: 0.9});

const pool = (base, suffixes) => suffixes.map((s) => `${base}${s}`);
const event = (channel, files, options = {}) => Object.freeze({channel, files: Object.freeze(files), volume: 1, cooldownMs: 0, maxConcurrent: 4, ...options});

export const SOUND_EVENTS = Object.freeze({
    // UI [SFX/UI/]
    'ui.hover': event('sfx', [`${UI}Hover Subtle Foley 001`], {volume: 0.35, cooldownMs: 80, maxConcurrent: 1, desktopOnly: true}),
    'ui.click': event('sfx', [`${UI}Click Foley 002`], {volume: 0.6, cooldownMs: 40, maxConcurrent: 2}),
    'ui.select': event('sfx', [`${UI}Select Foley 001`], {volume: 0.55, cooldownMs: 120, maxConcurrent: 1}),
    'ui.accept': event('sfx', [`${UI}Signals Positive Foley 001`], {volume: 0.5, cooldownMs: 120, maxConcurrent: 1}),
    'ui.deny': event('sfx', [`${UI}Signals Negative Foley 001`], {volume: 0.5, cooldownMs: 250, maxConcurrent: 1}),
    'ui.update': event('sfx', [`${UI}Signals Update Foley 001`], {volume: 0.5, cooldownMs: 500, maxConcurrent: 1}),
    'ui.toggle': event('sfx', [`${UI}Misc Toggle Foley 001`], {volume: 0.55, cooldownMs: 80, maxConcurrent: 1}),
    'ui.back': event('sfx', [`${UI}Misc Back Foley 001`], {volume: 0.55, cooldownMs: 80, maxConcurrent: 1}),
    'ui.open': event('sfx', [`${UI}Misc Popup Foley 001`], {volume: 0.6, cooldownMs: 150, maxConcurrent: 1}),
    'ui.close': event('sfx', [`${UI}Misc Back Foley 002`], {volume: 0.6, cooldownMs: 150, maxConcurrent: 1}),
    // ui.scroll (Scroll Foley Single 002) is mapped but nothing scrolls yet: kept in audio-src/.

    // GAME SFX [SFX/]
    'vehicle.engine': event('sfx', [`${SFX}ENGINE Motor Small Loop 02`], {volume: 0.22, loop: true, maxConcurrent: 2}),
    'machinery.power_up': event('sfx', [`${SFX}MECH Servo Motor Power Up Long 02`], {volume: 0.5, cooldownMs: 800, maxConcurrent: 1}),
    'machinery.power_down': event('sfx', [`${SFX}MECH Servo Motor Power Down Long 05`], {volume: 0.5, cooldownMs: 800, maxConcurrent: 1}),
    'weapon.machinegun': event('sfx', [`${SFX}WEAPON GUNSHOT MachineGun Repeater 06`], {volume: 0.35, cooldownMs: 60, maxConcurrent: 4}),
    'weapon.machinegun_alt': event('sfx', [`${SFX}WEAPON GUNSHOT MachineGun Spray 04`], {volume: 0.3, cooldownMs: 60, maxConcurrent: 4}),
    'weapon.rocket': event('sfx', [`${SFX}WEAPON GUNSHOT Rocket Launcher 02`], {volume: 0.45, cooldownMs: 120, maxConcurrent: 3}),
    'weapon.rocket_alt': event('sfx', [`${SFX}WEAPON GUNSHOT Rocket Launcher 03`], {volume: 0.5, cooldownMs: 120, maxConcurrent: 3}),
    'combat.explosion': event('sfx', [`${SFX}EXPLOSION Bang Blast 02`], {volume: 0.5, cooldownMs: 80, maxConcurrent: 3}),
    'building.destroy': event('sfx', [`${SFX}DESTRUCTION Break Impact 02`], {volume: 0.7, cooldownMs: 150, maxConcurrent: 2}),
    'wall.break': event('sfx', pool(`${SFX}Wall Break Stone `, ['A', 'B', 'C', 'D', 'E']), {volume: 0.55, cooldownMs: 100, maxConcurrent: 3}),
    'mutant.growl': event('sfx', pool(`${SFX}VOCAL EVIL Growl Grunt `, ['01', '02', '03']), {volume: 0.45, cooldownMs: 1500, maxConcurrent: 2}),
    'mutant.attack': event('sfx', pool(`${SFX}VOCAL EVIL Grunt Chomp `, ['01', '02', '03']), {volume: 0.4, cooldownMs: 400, maxConcurrent: 2}),
    'mutant.hit': event('sfx', pool(`${SFX}VOCAL EVIL Impact Hit AHHH `, ['01', '02', '03']), {volume: 0.4, cooldownMs: 150, maxConcurrent: 3}),

    // VOICES [VOICES/]: one unit voice at a time, at least VOICE_GAP_MS apart
    'worker.select': event('voices', pool(`${V}worker_select_`, ['01', '02', '03']), {voice: 'unit', rare: 'worker.rare'}),
    'worker.explore': event('voices', pool(`${V}worker_explore_`, ['01', '02', '03']), {voice: 'unit'}),
    'worker.lumber': event('voices', pool(`${V}worker_lumber_`, ['01', '02']), {voice: 'unit', cooldownMs: 30000}),
    'worker.mining': event('voices', pool(`${V}worker_mining_`, ['01', '02']), {voice: 'unit'}),
    'worker.return': event('voices', pool(`${V}worker_return_`, ['01', '02']), {voice: 'unit'}),
    'worker.complete': event('voices', [`${V}worker_complete_01`], {voice: 'unit', cooldownMs: 10000}),
    'worker.danger': event('voices', pool(`${V}worker_danger_`, ['01', '02']), {voice: 'unit', cooldownMs: 15000}),
    'worker.rare': event('voices', pool(`${V}worker_rare_`, ['01', '02']), {voice: 'unit'}),
    'soldier.select': event('voices', pool(`${V}soldier_select_`, ['01', '02', '03']), {voice: 'unit', rare: 'soldier.rare'}),
    'soldier.order': event('voices', pool(`${V}soldier_order_`, ['01', '02', '03']), {voice: 'unit'}),
    'soldier.attack': event('voices', pool(`${V}soldier_attack_`, ['01', '02', '03']), {voice: 'unit', cooldownMs: 20000}),
    'soldier.danger': event('voices', pool(`${V}soldier_danger_`, ['01', '02']), {voice: 'unit', cooldownMs: 15000}),
    'soldier.retreat': event('voices', [`${V}soldier_retreat_01`], {voice: 'unit'}),
    'soldier.victory': event('voices', pool(`${V}soldier_victory_`, ['01', '02']), {voice: 'unit'}),
    'soldier.rare': event('voices', pool(`${V}soldier_rare_`, ['01', '02']), {voice: 'unit'}),
    'papi.broadcast': event('voices', pool(`${V}loudspeeker_`, ['01', '02', '03', '04', '05']), {voice: 'broadcast', volume: 0.8}),
    // TASK 033.4: El Presidente reads his Presidential Advice, one line per tip (src/content/advice.js's
    // `voice`). Only SoundManager.speak() plays them: never two at once, and no unit talks over him.
    'advice.papi_hq': event('voices', [`${V}papi_hq`], {voice: 'president', maxConcurrent: 1}),
    'advice.papi_power': event('voices', [`${V}papi_power`], {voice: 'president', maxConcurrent: 1}),
    'advice.papi_defense': event('voices', [`${V}papi_defense`], {voice: 'president', maxConcurrent: 1}),
    'advice.papi_ecologists': event('voices', [`${V}papi_ecologists`], {voice: 'president', maxConcurrent: 1}),
    'advice.papi_workers': event('voices', [`${V}papi_workers`], {voice: 'president', maxConcurrent: 1}),
    'advice.papi_logistics': event('voices', [`${V}papi_logistics`], {voice: 'president', maxConcurrent: 1}),
    'advice.papi_ap': event('voices', [`${V}papi_ap`], {voice: 'president', maxConcurrent: 1}),
    'advice.papi_barracks': event('voices', [`${V}papi_barracks`], {voice: 'president', maxConcurrent: 1}),
    'advice.papi_mining': event('voices', [`${V}papi_mining`], {voice: 'president', maxConcurrent: 1}),
    'advice.papi_pollution': event('voices', [`${V}papi_pollution`], {voice: 'president', maxConcurrent: 1}),
    // TASK 036: the Day 100 speech, the whole ending's soundtrack (drumroll, crowd, scream and chewing are in it).
    // The presidential voice, so it never overlaps a tip's line and silences the units. Ending only.
    'papi.final': event('voices', [`${V}papi_final`], {voice: 'president', maxConcurrent: 1}),
});

/** How often a select line is replaced by the pool's rare line. */
export const RARE_CHANCE = 0.1;
/** The least time between two unit voice lines. */
export const VOICE_GAP_MS = 1500;
/** The PA speaks one line at a time, waiting this long (ms) between lines. */
export const BROADCAST_GAP_MS = Object.freeze({min: 20000, max: 30000});

/**
 * Music [MUSIC/]. The Night has none for now (D3). Measured with ffmpeg: Como
 * Versace averages -13.3 dB and Océano -15.9 dB, but Océano opens near -27 dB; at
 * the first values (0.55, 0.5, music 0.6) its opening reached the speakers near
 * -40 dBFS, which is silence in practice. These put both near -18 dB on average.
 */
export const MUSIC_TRACKS = Object.freeze({
    menu: Object.freeze({file: `${M}Spanish - Como Versace Loop`, volume: 0.75}),
    day: Object.freeze({file: `${M}Spanish - Océano Loop`, volume: 1}),
});

/** Which track each state wants, and at what share of its volume. */
export const MUSIC_STATES = Object.freeze({
    menu: Object.freeze({track: 'menu', gain: 1}),
    day: Object.freeze({track: 'day', gain: 1}),
    dusk: Object.freeze({track: 'day', gain: 0.5}), // fading through Dusk
    night: Object.freeze({track: null, gain: 0}),
    defeat: Object.freeze({track: null, gain: 0}),
});

export const FADE_MS = Object.freeze({crossfade: 1500, dusk: 5000, defeat: 2000, duck: 400});
/** The newspaper lowers whatever is playing to this share. */
export const DUCK_GAIN = 0.35;

/** The loader key of a file, and the URLs of its two formats. */
export const audioKey = (file) => `papi-audio:${file}`;
export const audioUrls = (file) => [`${encodeURI(file)}.ogg`, `${encodeURI(file)}.m4a`];

/** Every file a non-music event needs, once each. */
export const effectFiles = () => [...new Set(Object.values(SOUND_EVENTS).flatMap(({files}) => files))];
