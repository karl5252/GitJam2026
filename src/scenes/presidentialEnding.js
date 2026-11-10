/**
 * TASK 036: THE PRESIDENTIAL VISIT, the Day 100 ending. Pure presentation: no Phaser, no
 * simulation, no random numbers. Everything on the ceremonial grounds is a function of
 * one time, `t` in ms on the ending's timeline, so the scene is the same at any frame
 * rate, can be sought to any moment, and a muted or blocked speech plays the same scene.
 *
 *   arrival     the Presidential helicopter (TASK 035's flight) comes in over HQ and hovers
 *   emergence   El Presidente, then his two guards, walk out of HQ's door to the podium,
 *               while the helicopter leaves; the crowd is already gathered
 *   speech      papi_final.ogg, its cue table below driving the President, the crowd and
 *               the Brute; the Brute eats him on PRESIDENT_CONSUMED and the crowd scatters
 *   fade        to black after ENDING_COMPLETE; then the run ends and the menu shows
 *
 * The speech's own time (`speechMs`) comes from the recording's playback position while it
 * plays, otherwise from the scene's clock: EndingScene decides which, this module does not.
 */
import {HELI, flightPose, flightRoute, pickupPoint, rotorFrame} from './presidentialHeli.js';
import {PRESIDENT_FRAMES} from './presidentCameo.js';

/** The HUD shows a timed Day as `day - 1`: HUD Day 100 is calendar day 101, after Night 100. */
export const ENDING_HUD_DAY = 100;
export const ENDING_CALENDAR_DAY = ENDING_HUD_DAY + 1;

/** The ending is due on the first tick of the timed Day the HUD calls Day 100, and only then. */
export function endingDue({timed, deployment, shift, day}) {
    return Boolean(timed) && !deployment && shift === 'day' && day === ENDING_CALENDAR_DAY;
}

/** The recording: audio-src/sound/VOICES/papi_final.ogg, Vorbis mono 44.1 kHz. */
export const SPEECH = Object.freeze({event: 'papi.final', durationS: 57.42});

/**
 * Named cue points in the recording, in seconds. PROVISIONAL: found from its loudness
 * and pauses, not yet checked by ear. Every timed thing in the speech reads this table.
 */
export const ENDING_CUES = Object.freeze({
    SPEECH_START: 0.0,
    PRESIDENTIAL_TRIUMPH: 38.5, // "ME! EL COLONEL PAPI!"
    BRUTE_REVEAL: 46.5, // "Oh! Que maravilha! Look at this big fellow!"
    BRUTE_APPROACH: 48.5, // "Tremendous! Such beautiful teeth! Ven aquí, amigo!"
    BRUTE_LUNGE: 51.6, // "Give your El Colonel a big—"
    PRESIDENT_CONSUMED: 54.0, // the scream into the crunch
    CHEWING: 55.5,
    ENDING_COMPLETE: SPEECH.durationS,
});
export const CUE_ORDER = Object.freeze(Object.keys(ENDING_CUES));

/**
 * The spoken words, for when the recording cannot be heard. PROVISIONAL times, set
 * between the recording's pauses (3.0, 11.4, 16.1, 23.5, 28.3, 35.6, 40.7, 51.3 s).
 */
export const SUBTITLES = Object.freeze([
    [3.3, 7.9, 'My beautiful people! ¡Mi gente! Meu povo maravilhoso!'],
    [8.0, 11.4, 'ONE HUNDRED DAYS! ¡Cien días!'],
    [12.1, 16.0, 'They said we wouldn’t survive. Terrible people! Very wrong!'],
    [16.4, 20.4, 'We built factories! Fábricas enormes! TREMENDOUS factories!'],
    [20.5, 23.4, 'We make bananas WITHOUT TREES!'],
    [23.9, 28.3, 'Even Mother Nature owes us RENT! ¡Muchos dineros! Muito dinheiro!'],
    [28.7, 32.4, 'And the mutantes? DEFEATED! ¡Derrotados! Total victory!'],
    [32.5, 35.5, 'Nobody wins like San Papi!'],
    [35.9, 38.4, 'And who made it possible? One man. A handsome man. Um gênio!'],
    [38.5, 40.7, 'ME! EL COLONEL PAPI!'],
    [46.5, 48.4, 'Oh! Que maravilha! Look at this big fellow!'],
    [48.5, 51.3, 'Tremendous! Such beautiful teeth! Ven aquí, amigo!'],
    [51.6, 53.9, 'Give your El Colonel a big—'],
].map(([from, to, text]) => Object.freeze({from, to, text})));

/** The ceremony's own clock, in ms, before and after the speech. */
export const ENDING_TIMING = Object.freeze({
    fadeInMs: 700,
    // TASK 036.1: the Day 100 helicopter lands low on HQ's roof, its engine stops (frame 0)
    // while the President and La Guardia Royal come out of HQ, then it lifts off and leaves,
    // all before the speech. Day 1's flight (TASK 035) keeps HELI's own heights and times.
    heli: Object.freeze({
        approachMs: 2400,
        landedMs: 1800, // frame 0, the rotor still
        takeoffMs: 700, // straight up, rotor spinning
        departMs: 1600,
        landAltitude: HELI.hoverAltitude / 2, // half Day 1's clearance over the roof: 13 px, not 26
        liftAltitude: HELI.hoverAltitude * 2, // where it climbs to before it leaves
    }),
    presidentOutMs: 2900, // he leaves the door once the engine has stopped
    guardOutMs: Object.freeze([3150, 3350]),
    walkOutMs: 1100,
    guardSaluteFrameMs: 150, // each action frame, once, at the start of the speech
    speechStartMs: 6600, // the helicopter has gone (lands, waits, lifts off, leaves)
    fadeOutMs: 1000,
});

/** The intro and the speech on one timeline. */
export const speechStartMs = () => ENDING_TIMING.speechStartMs;
export const endingLengthMs = () => ENDING_TIMING.speechStartMs + SPEECH.durationS * 1000 + ENDING_TIMING.fadeOutMs;

/**
 * The ceremonial grounds: a small jungle generated from its own seed (never the run's),
 * every tree in view felled to stumps, and one HQ. World px, tiles of 32.
 */
export const STAGE = Object.freeze({
    cols: 40,
    rows: 24,
    tileSize: 32,
    seed: 7, // chosen: the old dirt track misses the ceremony, and most of the view is felled
    spawnFrame: Object.freeze({col: 8, row: 4, cols: 24, rows: 16}),
    hq: Object.freeze({col: 18, row: 5, width: 3, height: 3}),
    // A few trees left standing in view, so the felled ones read as felled (cols, rows).
    survivors: Object.freeze([[9, 6], [29, 5], [10, 14], [28, 13], [27, 15]]),
    zoom: 2, // the ceremony; the helicopter's arrival starts a little wider
    arrivalZoom: 1.8,
    lungeZoom: 2.3,
});

export const CROWD = Object.freeze({
    workers: 14,
    ecologists: 10,
    rows: Object.freeze([{radius: 92, count: 10}, {radius: 128, count: 14}]),
    arc: Object.freeze({from: 18, to: 162}), // degrees round the podium, 90 = straight south
    aisle: 15, // degrees each side of south left clear for the Brute
    // Slots (row by row, west to east) that ecologists hold: mixed in, never a faction.
    ecologistSlots: Object.freeze([1, 4, 6, 9, 11, 14, 16, 19, 21, 23]),
});

/**
 * TASK 036.1: La Guardia Royal, the Presidential honour guard: units/security.png, 195 x 175,
 * a 4-wide grid of 45 x 40 cells with 5 px between them (as the ecologist's sheet). Its eight
 * frames: idle in cells 0-1, move 4-5, the salute 8-11 (ENDING_FRAMES.guard). Drawn like a
 * worker: half scale, standing on its feet. EndingScene loads it.
 */
export const LA_GUARDIA = Object.freeze({key: 'papi-laGuardia', path: 'assets/sprites/units/security.png', frameWidth: 45, frameHeight: 40, spacing: 5, scale: 0.5, originY: 0.95});

/** Frames the ending uses, from each sheet's real layout. */
export const ENDING_FRAMES = Object.freeze({
    president: PRESIDENT_FRAMES, // idle 0-1, walk 4-5, salute 8-11 (units/elcolonel.png)
    // La Guardia Royal (units/security.png): 8 frames in a 4-wide grid of 45 x 40 cells with 5 px gaps,
    // so idle (0-1) is cells 0-1, move (2-3) cells 4-5, the salute (4-7) cells 8-11.
    guard: Object.freeze({idle: Object.freeze([0, 1]), walk: Object.freeze([4, 5]), salute: Object.freeze([8, 9, 10, 11])}),
    worker: Object.freeze({idle: Object.freeze([0, 1]), walk: Object.freeze([4, 5])}),
    ecologist: Object.freeze({idle: Object.freeze([0, 1]), walk: Object.freeze([4, 5]), protest: Object.freeze([8, 9, 10, 11])}),
    brute: Object.freeze({walk: Object.freeze([6, 7]), strike: 14}),
});

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => {
    const u = clamp01(t);
    return u * u * (3 - 2 * u);
};
const loop = (frames, ms, every) => frames[Math.floor(Math.max(0, ms) / every) % frames.length];
const toRad = (deg) => deg * Math.PI / 180;

/** A fixed number in [0, 1) for actor `i`: the crowd's variety, never the game's generator. */
export function hash01(i, salt = 0) {
    let h = Math.imul((i + 1) ^ Math.imul(salt + 0x9e37, 0x85ebca6b), 0xc2b2ae35) >>> 0;
    h ^= h >>> 15;
    h = Math.imul(h, 0x27d4eb2f) >>> 0;
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
}

/** Where everything stands, from HQ's footprint in world px. */
export function stageLayout(hq) {
    const door = {x: hq.x + hq.width / 2, y: hq.y + hq.height};
    const podium = {x: door.x, y: door.y + 64};
    const guards = [{x: podium.x - 34, y: podium.y - 4}, {x: podium.x + 34, y: podium.y - 4}];
    const crowd = [];
    for (const {radius, count} of CROWD.rows) {
        const perSide = count / 2;
        const sides = [[CROWD.arc.to, 90 + CROWD.aisle], [90 - CROWD.aisle, CROWD.arc.from]]; // west half, then east
        for (const [from, to] of sides) {
            for (let k = 0; k < perSide; k++) {
                const i = crowd.length;
                const angle = lerp(from, to, perSide === 1 ? 0.5 : k / (perSide - 1)) + (hash01(i, 1) - 0.5) * 6;
                const r = radius + (hash01(i, 2) - 0.5) * 12;
                crowd.push({
                    i,
                    kind: CROWD.ecologistSlots.includes(i) ? 'ecologist' : 'worker',
                    x: podium.x + Math.cos(toRad(angle)) * r,
                    y: podium.y + Math.sin(toRad(angle)) * r * 0.8, // a little flattened: the ground is seen from above
                });
            }
        }
    }
    const brute = {from: {x: podium.x, y: podium.y + 240}, near: {x: podium.x, y: podium.y + 150}, stop: {x: podium.x, y: podium.y + 26}, bite: {x: podium.x, y: podium.y + 4}};
    const crowdBottom = Math.max(...crowd.map((a) => a.y));
    const ceremony = {x: podium.x, y: (hq.y + crowdBottom) / 2};
    return {hq: {...hq}, door, podium, guards, crowd, brute, ceremony};
}

/** The cue the speech is in at `speechS` seconds, or null before it starts. */
export function cueAt(speechS) {
    let current = null;
    for (const name of CUE_ORDER) if (speechS >= ENDING_CUES[name]) current = name;
    return current;
}

export function subtitleAt(speechS) {
    return SUBTITLES.find(({from, to}) => speechS >= from && speechS < to)?.text ?? null;
}

/** Walking from `a` to `b` between `start` and `start + ms`. */
function walk(a, b, t, start, ms) {
    const u = clamp01((t - start) / ms);
    return {x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), moving: u > 0 && u < 1};
}

function presidentPose(t, s, L) {
    const {door, podium} = L;
    const T = ENDING_TIMING;
    const F = ENDING_FRAMES.president;
    if (t < T.presidentOutMs || (s !== null && s >= ENDING_CUES.PRESIDENT_CONSUMED)) return {visible: false, x: podium.x, y: podium.y, frame: F.idle[0], flip: false};
    const p = walk({x: door.x, y: door.y - 6}, podium, t, T.presidentOutMs, T.walkOutMs);
    let frame;
    if (p.moving) frame = loop(F.walk, t, 180);
    else if (s === null) frame = loop(F.idle, t, 520);
    else if (s >= ENDING_CUES.BRUTE_REVEAL) frame = loop([F.salute[0], F.salute[1]], t, 300); // arm up, waving his new friend in
    else if (s >= ENDING_CUES.PRESIDENTIAL_TRIUMPH && s < ENDING_CUES.PRESIDENTIAL_TRIUMPH + 3) {
        const into = (s - ENDING_CUES.PRESIDENTIAL_TRIUMPH) * 1000;
        frame = into < 140 ? F.salute[0] : into < 280 ? F.salute[1] : loop([F.salute[2], F.salute[3]], into, 520);
    } else {
        const cycle = (s * 1000) % 7000; // a salute every seven seconds of oratory
        frame = cycle < 140 ? F.salute[0] : cycle < 280 ? F.salute[1] : cycle < 1320 ? loop([F.salute[2], F.salute[3]], cycle, 520) : loop(F.idle, t, 520);
    }
    return {visible: true, x: p.x, y: p.y, frame, flip: false};
}

function guardPoses(t, s, L) {
    const {door, guards} = L;
    const T = ENDING_TIMING;
    const F = ENDING_FRAMES.guard;
    return guards.map((post, side) => {
        const out = T.guardOutMs[side];
        if (t < out) return {visible: false, x: door.x, y: door.y - 6, frame: F.idle[0], flip: side === 1, state: 'inside'};
        let p = walk({x: door.x, y: door.y - 6}, post, t, out, T.walkOutMs);
        const facing = side === 1; // each faces the President: the east guard looks west
        if (s !== null && s >= ENDING_CUES.PRESIDENT_CONSUMED + 0.2) { // they back away from the Brute
            const away = {x: post.x + (side === 0 ? -30 : 30), y: post.y - 14};
            p = walk(post, away, s * 1000, (ENDING_CUES.PRESIDENT_CONSUMED + 0.2) * 1000, 1000); // on the speech's own time
            return {visible: true, x: p.x, y: p.y, frame: p.moving ? loop(F.walk, t, 120) : loop(F.idle, t + side * 260, 520), flip: !facing, state: p.moving ? 'retreating' : 'retreated'};
        }
        if (p.moving) return {visible: true, x: p.x, y: p.y, frame: loop(F.walk, t, 180), flip: facing, state: 'marching'};
        if (s === null) return {visible: true, x: p.x, y: p.y, frame: loop(F.idle, t + side * 260, 600), flip: facing, state: 'attention'};
        // The speech begins: one salute, frames 4-7 once, and the last held, until the Brute.
        const n = Math.floor(s * 1000 / T.guardSaluteFrameMs);
        const frame = F.salute[Math.min(n, F.salute.length - 1)];
        return {visible: true, x: p.x, y: p.y, frame, flip: facing, state: n < F.salute.length - 1 ? 'saluting' : 'holding-salute'};
    });
}

function crowdPoses(t, s, L) {
    const {podium} = L;
    return L.crowd.map((a) => {
        const F = ENDING_FRAMES[a.kind];
        const offset = hash01(a.i, 3) * 1000;
        const period = 440 + hash01(a.i, 4) * 320;
        let x = a.x;
        let y = a.y;
        let flip = a.x > podium.x; // facing the podium; the sheets face right
        let frame = loop(F.idle, t + offset, period);
        if (s === null) return {i: a.i, kind: a.kind, x, y, frame, flip, state: 'gathered'};
        let state = 'listening';
        const triumph = s >= ENDING_CUES.PRESIDENTIAL_TRIUMPH && s < ENDING_CUES.BRUTE_REVEAL;
        if (triumph && a.kind === 'ecologist') {
            frame = loop(F.protest, t + offset, 150 + hash01(a.i, 5) * 60); // signs up for the applause
            state = 'cheering';
        }
        if (s >= ENDING_CUES.BRUTE_APPROACH && Math.abs(a.x - podium.x) < 60) { // the Brute's neighbours make room
            const step = walk({x: a.x, y: a.y}, {x: a.x + Math.sign(a.x - podium.x || 1) * 16, y: a.y + 4}, s * 1000, ENDING_CUES.BRUTE_APPROACH * 1000 + hash01(a.i, 6) * 400, 600);
            x = step.x;
            y = step.y;
            if (step.moving) frame = loop(F.walk, t, 140);
            state = 'stepping-back';
        }
        if (s >= ENDING_CUES.PRESIDENT_CONSUMED) { // everyone runs, outwards, each a little differently
            const delay = hash01(a.i, 7) * 300;
            const since = (s - ENDING_CUES.PRESIDENT_CONSUMED) * 1000 - delay;
            if (since > 0) {
                const angle = Math.atan2(y - podium.y, x - podium.x) + (hash01(a.i, 8) - 0.5) * 0.9;
                const speed = 0.09 + hash01(a.i, 9) * 0.06; // px per ms
                x += Math.cos(angle) * speed * since;
                y += Math.sin(angle) * speed * since;
                flip = Math.cos(angle) < 0;
                frame = loop(F.walk, t + offset, 90);
                state = 'scattering';
            }
        }
        return {i: a.i, kind: a.kind, x, y, frame, flip, state};
    });
}

function brutePose(t, s, L) {
    const {from, near, stop, bite} = L.brute;
    const F = ENDING_FRAMES.brute;
    const hidden = {visible: false, x: from.x, y: from.y, frame: F.walk[0], flip: false, state: 'absent'};
    if (s === null || s < ENDING_CUES.BRUTE_REVEAL) return hidden;
    const C = ENDING_CUES;
    if (s < C.BRUTE_APPROACH) {
        const u = (s - C.BRUTE_REVEAL) / (C.BRUTE_APPROACH - C.BRUTE_REVEAL);
        return {visible: true, x: from.x, y: lerp(from.y, near.y, u), frame: loop(F.walk, t, 200), flip: false, state: 'revealed'};
    }
    if (s < C.BRUTE_LUNGE) {
        const u = (s - C.BRUTE_APPROACH) / (C.BRUTE_LUNGE - C.BRUTE_APPROACH);
        return {visible: true, x: near.x, y: lerp(near.y, stop.y, u), frame: loop(F.walk, t, 200), flip: false, state: 'approaching'};
    }
    if (s < C.PRESIDENT_CONSUMED) {
        const u = smooth((s - C.BRUTE_LUNGE) / 0.25);
        const shake = u >= 1 ? Math.round(Math.sin(t / 30)) : 0;
        return {visible: true, x: bite.x + shake, y: lerp(stop.y, bite.y, u), frame: F.strike, flip: false, state: 'lunging'};
    }
    const chewing = s >= C.CHEWING;
    return {
        visible: true, x: bite.x, y: bite.y - (Math.floor(t / 240) % 2), // a slow, satisfied bob
        frame: Math.floor(t / 240) % 2 === 0 ? F.strike : F.walk[0], flip: false, state: chewing ? 'chewing' : 'eating',
    };
}

function heliPose(t, L, view) {
    const route = flightRoute(L.hq, view);
    const H = ENDING_TIMING.heli;
    const landed = H.approachMs;
    const lift = landed + H.landedMs;
    const away = lift + H.takeoffMs;
    const gone = away + H.departMs;
    const pose = (leg, ground, altitude, anim) => ({
        visible: true, leg, ground, altitude, x: ground.x, y: ground.y - altitude, frame: rotorFrame(anim, t), flip: false, anim,
    });
    if (t < landed) { // in from beyond the view, slowing and coming down low over the roof
        const p = flightPose('approach', t / H.approachMs, route, {hoverAltitude: H.landAltitude});
        return pose('approach', p.ground, p.altitude, 'flying');
    }
    if (t < lift) return pose('landed', {...route.pickup}, H.landAltitude, 'idle'); // engine off: frame 0
    if (t < away) return pose('takeoff', {...route.pickup}, H.landAltitude + (H.liftAltitude - H.landAltitude) * smooth((t - lift) / H.takeoffMs), 'flying');
    if (t < gone) {
        const p = flightPose('depart', (t - away) / H.departMs, route, {hoverAltitude: H.liftAltitude});
        return pose('depart', p.ground, p.altitude, 'flying');
    }
    return {visible: false, leg: 'gone', ground: null, altitude: null, x: null, y: null, frame: rotorFrame('flying', t), flip: false, anim: 'flying'};
}

/** TASK 036.1: where the Day 100 helicopter lands: HQ's roof, at half Day 1's clearance. */
export function landingPoint(hq) {
    const ground = pickupPoint(hq);
    return {ground, skids: {x: ground.x, y: ground.y - ENDING_TIMING.heli.landAltitude}};
}

/** The camera's pose: wider for the arrival, the ceremony, closer for the bite. */
/** The camera for the helicopter's arrival: a little wider, on HQ's roof. */
export const arrivalPose = (L) => ({zoom: STAGE.arrivalZoom, x: L.hq.x + L.hq.width / 2, y: L.hq.y + L.hq.height / 2 + 40});

export function cameraPose(t, s, L) {
    const arrival = arrivalPose(L);
    const ceremony = {zoom: STAGE.zoom, ...L.ceremony};
    const H = ENDING_TIMING.heli;
    const settle = smooth((t - (H.approachMs + H.landedMs)) / (H.takeoffMs + H.departMs)); // as the helicopter leaves
    let pose = {zoom: lerp(arrival.zoom, ceremony.zoom, settle), x: lerp(arrival.x, ceremony.x, settle), y: lerp(arrival.y, ceremony.y, settle)};
    if (s !== null && s >= ENDING_CUES.BRUTE_LUNGE) {
        const push = smooth((s - ENDING_CUES.BRUTE_LUNGE) / 0.4);
        pose = {zoom: lerp(pose.zoom, STAGE.lungeZoom, push), x: lerp(pose.x, L.podium.x, push), y: lerp(pose.y, L.podium.y, push)};
    }
    return pose;
}

/** The world rectangle a camera pose shows on a 1280 x 720 screen. */
export const viewOf = ({zoom, x, y}, screen = {width: 1280, height: 720}) => ({
    x: x - screen.width / zoom / 2, y: y - screen.height / zoom / 2, width: screen.width / zoom, height: screen.height / zoom,
});

/**
 * Everything at time `t` (ms on the ending's timeline). `speechMs` is how far into the
 * recording the speech is (null before it starts); by default the timeline's own.
 */
export function endingFrame(t, L, speechMs = t >= speechStartMs() ? t - speechStartMs() : null) {
    const s = speechMs === null ? null : speechMs / 1000;
    const T = ENDING_TIMING;
    const over = s !== null && s >= SPEECH.durationS;
    const fadeOut = over ? clamp01((speechMs - SPEECH.durationS * 1000) / T.fadeOutMs) : 0;
    const fade = Math.max(1 - clamp01(t / T.fadeInMs), fadeOut);
    const camera = cameraPose(t, s, L);
    const phase = s === null ? (t < T.presidentOutMs ? 'arrival' : 'emergence') : over ? (fadeOut >= 1 ? 'done' : 'fade') : 'speech';
    return {
        t,
        speechMs,
        phase,
        cue: s === null ? null : cueAt(s),
        fade,
        camera,
        heli: heliPose(t, L, viewOf(arrivalPose(L))), // one fixed view: the route never moves under it
        president: presidentPose(t, s, L),
        guards: guardPoses(t, s, L),
        crowd: crowdPoses(t, s, L),
        brute: brutePose(t, s, L),
        subtitle: s === null ? null : subtitleAt(s),
    };
}
