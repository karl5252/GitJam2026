/**
 * TASK 035: the Presidential helicopter. Pure presentation: no Phaser, no simulation, no
 * random numbers at all. It is fed presentation milliseconds and says where the helicopter
 * is, which frame shows and how far the camera has moved, nothing else.
 *
 * Day 1 (`HeliVisit`): once the first timed Day after Night 1 is free to show (La Voz
 * closed, nothing else holding the world), GameScene holds the world (the `cinematic`
 * suspension reason), the camera eases onto HQ, the helicopter flies in from beyond the
 * view, slows to hover over HQ's roof, dips once (El Presidente is collected, unseen), and
 * flies off nose first beyond the view; the camera eases back and the world is released.
 * Nothing ever comes out of HQ, and no other actor exists.
 *
 * Shared with TASK 036 (the Day 100 return): the sheet and its animation states, the
 * rotor clock, `pickupPoint` (HQ-relative), `offscreenPoint`, `flightPose` (approach,
 * hover, depart), `cameraTarget`/`blendPose` and the layer's lifetime (HeliLayer.js).
 */

/**
 * units/heli.png as it really is: 360 x 55, 8 frames of 45 x 55 in one row, no spacing.
 * The machine faces down-left (nose bottom-left, tail top-right). Frame 0 rotor still;
 * frame 1 the blades starting; frames 2-7 the rotor a blur, alternating two drawings
 * (2 = 4 = 6, 3 = 5 = 7). Skids end on row 53, so the feet are the frame's row 54.
 */
export const HELI_SHEET = Object.freeze({
    key: 'papi-heli',
    path: 'assets/sprites/units/heli.png',
    frameWidth: 45,
    frameHeight: 55,
    frameCount: 8,
    scale: 2, // whole-number, so the pixels stay square under nearest filtering
    originY: 54 / 55, // the skids
    facesLeft: true,
});

/**
 * The animation states, by the developer's mapping. The mapping named flight frames 2-8,
 * but the sheet ends at frame 7: flying is every flight frame the sheet has, 2-7.
 */
export const HELI_ANIMS = Object.freeze({
    idle: Object.freeze({frames: Object.freeze([0]), frameMs: 1000}),
    startup: Object.freeze({frames: Object.freeze([0, 1]), frameMs: 160}), // looped
    flying: Object.freeze({frames: Object.freeze([2, 3, 4, 5, 6, 7]), frameMs: 50}), // looped, 20 fps
});

/** The frame an animation shows after `ms` of rotor time. Every state loops. */
export function rotorFrame(anim, ms) {
    const {frames, frameMs} = HELI_ANIMS[anim];
    return frames[Math.floor(Math.max(0, ms) / frameMs) % frames.length];
}

export const HELI = Object.freeze({
    cameraMs: 700, // easing onto HQ, and back
    approachMs: 2400,
    hoverMs: 1500,
    departMs: 2000,
    cruiseAltitude: 72, // px the skids fly above their shadow
    hoverAltitude: 26, // over the roof
    dip: 8, // the pickup: a little lower for a moment
    roofLift: 6, // px above the footprint's centre that counts as the roof
    from: Object.freeze({x: 1, y: -0.55}), // arrives from the upper right, nose first
    to: Object.freeze({x: -1, y: 0.45}), // leaves to the lower left, nose first
    beyond: 160, // px past the view's diagonal: wholly out of sight, sprite and altitude included
    cameraZoom: Object.freeze({min: 1.5, max: 2.25}), // close enough to read the pickup
    maxStepMs: 100, // a long frame (a tab coming back) moves it no further than this
});

const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeIn = (t) => t ** 3;
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.min(1, Math.max(0, t));

/** Where the helicopter's shadow sits for the pickup: HQ's roof, from its footprint in world px. */
export const pickupPoint = (hq) => ({x: hq.x + hq.width / 2, y: hq.y + hq.height / 2 - HELI.roofLift});

/** A point along `dir` from `from`, far enough to be out of the view rectangle `view`. */
export function offscreenPoint(from, dir, view) {
    const length = Math.hypot(dir.x, dir.y);
    const distance = Math.hypot(view.width, view.height) + HELI.beyond;
    return {x: from.x + dir.x / length * distance, y: from.y + dir.y / length * distance};
}

/** The whole flight, from HQ's footprint and the view the camera will hold for it. */
export function flightRoute(hq, view) {
    const pickup = pickupPoint(hq);
    return {start: offscreenPoint(pickup, HELI.from, view), pickup, end: offscreenPoint(pickup, HELI.to, view)};
}

/**
 * Where the helicopter is, `t` (0..1) through one leg of the flight. `ground` is its
 * shadow; the sprite's skids are `altitude` px above it. Deterministic, no state.
 * `heights` (TASK 036.1) lets a flight hover lower or climb higher than Day 1's; by default HELI's.
 */
export function flightPose(leg, t, {start, pickup, end}, {cruiseAltitude = HELI.cruiseAltitude, hoverAltitude = HELI.hoverAltitude} = {}) {
    const u = clamp01(t);
    if (leg === 'approach') { // fast at first, slowing into the hover
        const k = easeOut(u);
        return {ground: {x: lerp(start.x, pickup.x, k), y: lerp(start.y, pickup.y, k)}, altitude: lerp(cruiseAltitude, hoverAltitude, k), dx: pickup.x - start.x};
    }
    if (leg === 'hover') { // one slow dip over the roof
        return {ground: {...pickup}, altitude: hoverAltitude - HELI.dip * Math.sin(Math.PI * u), dx: 0};
    }
    // depart: climbing at once, gathering speed
    const k = easeIn(u);
    return {ground: {x: lerp(pickup.x, end.x, k), y: lerp(pickup.y, end.y, k)}, altitude: lerp(hoverAltitude, cruiseAltitude, easeOut(u)), dx: end.x - pickup.x};
}

/** The camera pose to watch the pickup from: centred on HQ, closer in only if need be. */
export function cameraTarget(saved, focus) {
    return {zoom: Math.min(HELI.cameraZoom.max, Math.max(saved.zoom, HELI.cameraZoom.min)), x: focus.x, y: focus.y};
}

/** Part of the way from one camera pose to another. */
export function blendPose(from, to, t) {
    const k = smooth(clamp01(t));
    return {zoom: lerp(from.zoom, to.zoom, k), x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k)};
}

const LEGS = ['camera-in', 'approach', 'hover', 'depart', 'camera-out'];
const LENGTH = {
    'camera-in': HELI.cameraMs, approach: HELI.approachMs, hover: HELI.hoverMs, depart: HELI.departMs, 'camera-out': HELI.cameraMs,
};

/**
 * The Day 1 visit, once per run. States: waiting -> camera-in -> approach -> hover ->
 * depart -> camera-out -> done; or waiting -> skipped (the chance passed); or off.
 */
export class HeliVisit {
    #state;
    #elapsed = 0; // ms into the current leg
    #rotorMs = 0;
    #route = null;
    #collected = false;
    #timeScale;

    /** @param {{enabled?: boolean, timeScale?: number}} options timeScale: TEST_MODE only, faster flights */
    constructor({enabled = true, timeScale = 1} = {}) {
        this.#state = enabled ? 'waiting' : 'off';
        this.#timeScale = timeScale > 0 ? timeScale : 1;
    }

    get state() {
        return this.#state;
    }

    /** Between taking the world and giving it back. */
    get active() {
        return LEGS.includes(this.#state);
    }

    get waiting() {
        return this.#state === 'waiting';
    }

    /** Begin, from HQ's footprint and the view rectangle the camera will hold. Only once. */
    start(hq, view) {
        if (this.#state !== 'waiting') return false;
        this.#route = flightRoute(hq, view);
        this.#state = 'camera-in';
        this.#elapsed = 0;
        return true;
    }

    /** The moment passed without it (END DAY, a Dusk, a defeat): it never comes this run. */
    skip() {
        if (this.#state === 'waiting') this.#state = 'skipped';
    }

    /**
     * One presentation frame. `flightMs` moves the flight (0 while anything else holds the
     * world); `rotorMs` always turns the rotor, so it never stops while airborne.
     */
    update(flightMs, rotorMs = flightMs) {
        if (!this.active) return;
        this.#rotorMs += Math.max(0, rotorMs);
        let dt = Math.min(Math.max(0, flightMs), HELI.maxStepMs) * this.#timeScale;
        while (dt > 0 && this.active) {
            const left = LENGTH[this.#state] - this.#elapsed;
            if (dt < left) {
                this.#elapsed += dt;
                dt = 0;
            } else {
                dt -= left;
                if (this.#state === 'hover') this.#collected = true;
                const next = LEGS.indexOf(this.#state) + 1;
                this.#state = next < LEGS.length ? LEGS[next] : 'done';
                this.#elapsed = 0;
            }
        }
        if (this.#state === 'hover' && this.#elapsed >= HELI.hoverMs / 2) this.#collected = true; // at the bottom of the dip
    }

    /** What to draw, and what QA reads. */
    view() {
        const flying = this.#state === 'approach' || this.#state === 'hover' || this.#state === 'depart';
        const t = this.active ? this.#elapsed / LENGTH[this.#state] : 0;
        const pose = flying ? flightPose(this.#state, t, this.#route) : null;
        const cameraBlend = this.#state === 'camera-in' ? t : this.#state === 'camera-out' ? 1 - t : flying ? 1 : 0;
        return {
            state: this.#state,
            active: this.active,
            visible: flying,
            progress: t,
            ground: pose ? pose.ground : null,
            altitude: pose ? pose.altitude : null,
            x: pose ? pose.ground.x : null,
            y: pose ? pose.ground.y - pose.altitude : null, // the skids
            flip: pose ? pose.dx > 0 && HELI_SHEET.facesLeft : false, // the sheet faces left
            anim: 'flying', // airborne the whole time it is seen: never idle, never startup
            frame: rotorFrame('flying', this.#rotorMs),
            cameraBlend,
            collected: this.#collected,
            route: this.#route ? {start: {...this.#route.start}, pickup: {...this.#route.pickup}, end: {...this.#route.end}} : null,
        };
    }
}
