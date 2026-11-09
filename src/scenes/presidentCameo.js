/**
 * TASK 033.2: El Presidente Colonel's Day 0 cameo. Pure presentation: no Phaser, no
 * simulation, no game RNG. It is fed presentation milliseconds (none while the world is
 * suspended) and a description of the world, and says where he is and which frame shows.
 *
 *   wander   Day 0: idle, a short stroll to a nearby point, or a salute, with pauses,
 *            within RADIUS of the clearing's centre, then of HQ's door once HQ stands,
 *            never on HQ's footprint. HQ placed on top of him: he steps out to the door.
 *   retreat  Dusk: he turns to HQ at once and runs for its door, round its footprint,
 *            far faster than he walks, kicking up dust, and is gone on arrival.
 *   gone     Night, or anything else: hidden for the rest of the run. Whatever he was
 *            doing when Dusk ended, Night never waits for him.
 *
 * His choices come from his own tiny generator, so the game's random numbers, its ticks
 * and everything it simulates are exactly what they would be without him.
 */

/** The sheet: units/elcolonel.png, 4 x 4 frames of 45 x 40, as the worker's. Row 3 is empty. */
export const PRESIDENT_FRAMES = Object.freeze({
    idle: Object.freeze([0, 1]),
    walk: Object.freeze([4, 5]),
    salute: Object.freeze([8, 9, 10, 11]), // arm up (8, 9), then the salute (10, 11)
});

export const CAMEO = Object.freeze({
    radius: 80, // px from his anchor: two and a half tiles
    walkSpeed: 0.03, // px per ms: a stroll
    runSpeed: 0.3, // px per ms: ten times that, a very rapid strategic withdrawal
    pause: Object.freeze({min: 1200, max: 3400}), // ms between strolls
    saluteChance: 0.3,
    idleFrameMs: 520,
    walkFrameMs: 180,
    runFrameMs: 70,
    salute: Object.freeze([140, 140, 520, 520]), // ms per salute frame
    turnMs: 160, // the moment he notices Dusk, facing HQ
    margin: 10, // px his feet keep from HQ's footprint
    body: 20, // px his sprite rises above his feet (40 px frames at half scale)
    dustEveryMs: 55,
    dustMs: 420,
    maxStepMs: 100, // a long frame (a tab coming back) moves him no further than this
    seed: 0x50a9a,
});

const near = (a, b, d = 0.5) => Math.abs(a.x - b.x) <= d && Math.abs(a.y - b.y) <= d;

/** Is a point inside a rectangle grown by `m` on every side? */
const inside = ({x, y}, r, m) => x > r.x - m && x < r.x + r.width + m && y > r.y - m && y < r.y + r.height + m;

/** Does the segment a-b pass through the rectangle grown by m? Sampled: the strolls are short. */
function crosses(a, b, r, m) {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4));
    for (let i = 0; i <= steps; i++) {
        if (inside({x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps}, r, m)) return true;
    }
    return false;
}

/**
 * Where his feet may not go near HQ: the footprint grown by the margin, and below it by his
 * height too, so no part of him is ever drawn over HQ.
 */
export const keepOut = (hq) => ({
    x: hq.x - CAMEO.margin, y: hq.y - CAMEO.margin,
    width: hq.width + 2 * CAMEO.margin, height: hq.height + CAMEO.margin + CAMEO.body,
});

/** HQ's door: the middle of its bottom edge, where its road ring's dock is. */
export const doorOf = (hq) => ({x: hq.x + hq.width / 2, y: hq.y + hq.height});

/**
 * The way from `from` to HQ's door, round the footprint: down the nearer side first when
 * he is not already below it. Never through it.
 */
export function retreatRoute(from, hq, margin = CAMEO.margin) {
    const door = doorOf(hq);
    const below = hq.y + hq.height + margin;
    if (from.y >= below || !crosses(from, {x: door.x, y: below}, hq, margin - 1)) return [{x: door.x, y: below}, door];
    const left = hq.x - margin;
    const right = hq.x + hq.width + margin;
    const clear = from.x <= left || from.x >= right;
    const side = clear ? from.x : (from.x - left <= right - from.x ? left : right);
    return [{x: side, y: from.y}, {x: side, y: below}, {x: door.x, y: below}, door];
}

export class PresidentCameo {
    #seed;
    #state = 'hidden'; // hidden | wander | retreat | gone
    #activity = null; // wander: {kind: 'idle' | 'walk' | 'salute', ...}
    #pos = null;
    #flip = false;
    #frame = 0;
    #clock = 0; // presentation ms since he appeared
    #anchor = null;
    #hq = null;
    #route = [];
    #dust = [];
    #nextDust = 0;

    constructor({seed = CAMEO.seed} = {}) {
        this.#seed = seed >>> 0;
    }

    /** His own numbers, in [0, 1): the game's generator is never asked. */
    #random() {
        this.#seed = (Math.imul(this.#seed, 1664525) + 1013904223) >>> 0;
        return this.#seed / 4294967296;
    }

    /**
     * One presentation frame.
     * @param {number} deltaMs presentation time: 0 while the world is suspended
     * @param {{phase: 'deployment' | 'dusk' | 'other', centre: {x, y}, hq: {x, y, width, height} | null}} world
     *   phase - Day 0, Dusk, or anything else; centre - the clearing's middle, in world px;
     *   hq - HQ's footprint in world px, once it stands
     */
    update(deltaMs, {phase, centre, hq}) {
        const dt = Math.min(Math.max(0, deltaMs), CAMEO.maxStepMs);
        if (this.#state === 'gone') {
            if (phase === 'other') this.#dust = []; // Night: nothing of him is left
            else this.#ageDust(dt); // through the door: his dust settles without him
            return;
        }
        if (this.#state === 'hidden') {
            if (phase === 'deployment') this.#appear(centre);
            else { // a run with no Day 0 (the LEGACY cycle): he never comes, and is never asked again
                this.#leave();
                return;
            }
        }
        if (phase === 'other' || (phase === 'dusk' && !hq)) {
            this.#leave(); // Night, a defeat, or no HQ to run to: gone at once
            return;
        }
        this.#hq = hq;
        if (phase === 'dusk' && this.#state !== 'retreat') this.#startRetreat();
        this.#clock += dt;
        this.#ageDust(dt);
        if (dt === 0) return;
        if (this.#state === 'retreat') this.#retreat(dt);
        else this.#wander(dt, centre);
    }

    #appear(centre) {
        this.#state = 'wander';
        this.#pos = {...centre};
        this.#anchor = {...centre};
        this.#activity = {kind: 'idle', left: this.#pause()};
    }

    #leave() {
        this.#state = 'gone';
        this.#activity = null;
        this.#route = [];
        this.#dust = [];
    }

    #pause() {
        return CAMEO.pause.min + this.#random() * (CAMEO.pause.max - CAMEO.pause.min);
    }

    // ---- Day 0 -----------------------------------------------------------------------

    #wander(dt, centre) {
        const hq = this.#hq;
        if (hq) {
            const door = doorOf(hq);
            this.#anchor = {x: door.x, y: door.y + CAMEO.body + CAMEO.radius / 2}; // in front of the new HQ
            const zone = keepOut(hq);
            if (inside(this.#pos, zone, 0)) { // HQ went up on top of him: out of the door, saluting it
                this.#pos = {x: door.x, y: zone.y + zone.height + 1};
                this.#beginSalute();
            } else if (this.#activity.kind === 'walk' && crosses(this.#pos, this.#activity.to, zone, 0)) {
                this.#activity = {kind: 'idle', left: this.#pause()};
            }
        } else this.#anchor = {...centre};
        const a = this.#activity;
        if (a.kind === 'idle') {
            this.#frame = PRESIDENT_FRAMES.idle[Math.floor(this.#clock / CAMEO.idleFrameMs) % 2];
            a.left -= dt;
            if (a.left <= 0) this.#choose();
        } else if (a.kind === 'walk') {
            this.#frame = PRESIDENT_FRAMES.walk[Math.floor(this.#clock / CAMEO.walkFrameMs) % 2];
            if (this.#moveTowards(a.to, CAMEO.walkSpeed * dt)) this.#activity = {kind: 'idle', left: this.#pause()};
        } else {
            a.elapsed += dt;
            let t = a.elapsed;
            const i = CAMEO.salute.findIndex((ms) => (t -= ms) < 0);
            if (i === -1) this.#activity = {kind: 'idle', left: this.#pause()};
            else this.#frame = PRESIDENT_FRAMES.salute[i];
        }
    }

    #beginSalute() {
        this.#activity = {kind: 'salute', elapsed: 0};
        this.#frame = PRESIDENT_FRAMES.salute[0];
    }

    /** A stroll to a nearby point clear of HQ, or a salute; or, failing a clear point, another pause. */
    #choose() {
        if (this.#random() < CAMEO.saluteChance) {
            this.#beginSalute();
            return;
        }
        for (let attempt = 0; attempt < 8; attempt++) {
            const angle = this.#random() * Math.PI * 2;
            const distance = CAMEO.radius * Math.sqrt(this.#random());
            const to = {x: Math.round(this.#anchor.x + Math.cos(angle) * distance), y: Math.round(this.#anchor.y + Math.sin(angle) * distance)};
            const zone = this.#hq && keepOut(this.#hq);
            if (zone && (inside(to, zone, 0) || crosses(this.#pos, to, zone, 0))) continue;
            this.#activity = {kind: 'walk', to};
            return;
        }
        this.#activity = {kind: 'idle', left: this.#pause()};
    }

    /** @returns {boolean} arrived */
    #moveTowards(to, step) {
        const dx = to.x - this.#pos.x;
        const dy = to.y - this.#pos.y;
        const length = Math.hypot(dx, dy);
        if (Math.abs(dx) > 0.01) this.#flip = dx < 0; // the sheet faces right
        if (length <= step) {
            this.#pos = {...to};
            return true;
        }
        this.#pos = {x: this.#pos.x + dx / length * step, y: this.#pos.y + dy / length * step};
        return false;
    }

    // ---- Dusk ------------------------------------------------------------------------

    #startRetreat() {
        this.#state = 'retreat';
        this.#route = retreatRoute(this.#pos, this.#hq);
        this.#flip = doorOf(this.#hq).x < this.#pos.x; // he turns to HQ at once
        this.#activity = {kind: 'turn', left: CAMEO.turnMs};
        this.#frame = PRESIDENT_FRAMES.idle[0];
        this.#nextDust = 0;
    }

    #retreat(dt) {
        if (this.#activity.kind === 'turn') {
            this.#activity.left -= dt;
            if (this.#activity.left > 0) return;
            this.#activity = {kind: 'run'};
        }
        this.#frame = PRESIDENT_FRAMES.walk[Math.floor(this.#clock / CAMEO.runFrameMs) % 2];
        let step = CAMEO.runSpeed * dt;
        while (step > 0 && this.#route.length > 0) {
            const before = {...this.#pos};
            if (this.#moveTowards(this.#route[0], step)) this.#route.shift();
            step -= Math.hypot(this.#pos.x - before.x, this.#pos.y - before.y);
            if (near(this.#pos, before, 1e-6)) break;
        }
        this.#nextDust -= dt;
        if (this.#nextDust <= 0) {
            this.#dust.push({x: this.#pos.x, y: this.#pos.y, age: 0, drift: this.#random() * 2 - 1});
            this.#nextDust = CAMEO.dustEveryMs;
        }
        if (this.#route.length === 0) {
            this.#state = 'gone'; // through the door; his dust settles without him
            this.#activity = null;
        }
    }

    #ageDust(dt) {
        for (const puff of this.#dust) puff.age += dt;
        this.#dust = this.#dust.filter((puff) => puff.age < CAMEO.dustMs);
    }

    /** Gone, and his dust settled: nothing more to do or draw this run. */
    get finished() {
        return this.#state === 'gone' && this.#dust.length === 0;
    }

    /** What to draw, and what QA reads. */
    view() {
        const shown = this.#state === 'wander' || this.#state === 'retreat';
        return {
            state: this.#state,
            visible: shown,
            activity: this.#activity?.kind ?? null,
            x: this.#pos?.x ?? null,
            y: this.#pos?.y ?? null,
            frame: this.#frame,
            flip: this.#flip,
            anchor: this.#anchor ? {...this.#anchor} : null,
            route: this.#route.map((p) => ({...p})),
            dust: this.#dust.map(({x, y, age, drift}) => ({x, y, age, drift})),
        };
    }
}
