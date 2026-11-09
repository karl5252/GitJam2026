/**
 * TASK 031: combat visual effects, as data and pure decisions. No Phaser here;
 * CombatFxLayer draws what this module plans.
 *
 * Presentation only. It reads what a tick already did (shots, impacts,
 * destroyed buildings) and never touches the simulation. Its randomness is its
 * own small generator, never the game's RNG. Every timing is in simulation
 * ticks, as the existing tracers are, so effects freeze when the game is paused
 * and follow its speed.
 */

/**
 * The three supplied sheets: separate horizontal strips, frame rectangles as in
 * their TXT metadata. Every explosion rises from the bottom of its frame (frame 0
 * is a small flash at the bottom centre), so sprites anchor near the bottom.
 * `visible` is the widest visible content in source pixels, measured per frame.
 */
export const FX_SHEETS = Object.freeze({
    yellowA: Object.freeze({path: 'effects/epic_explosion_A_large_yellow.png', frameWidth: 96, frameHeight: 96, frames: 14, visible: 95, originY: 0.95}),
    stylizedC: Object.freeze({path: 'effects/stylized_explosion_C_large_yellow.png', frameWidth: 128, frameHeight: 96, frames: 14, visible: 126, originY: 0.93}),
    orangeC: Object.freeze({path: 'effects/epic_explosion_C_large_orange.png', frameWidth: 192, frameHeight: 192, frames: 15, visible: 191, originY: 0.94}),
    // A Spitter's acid: it spreads outward from the frame's centre (frame 0 is a blob at
    // 16,16), so it is anchored at its centre on the ground where the shell landed.
    splatterViolet: Object.freeze({path: 'effects/splatter_small_violet.png', frameWidth: 32, frameHeight: 32, frames: 10, visible: 32, originY: 0.5}),
});

export const fxKey = (sheet) => `papi-fx-${sheet}`;

/** Ticks are 60 a second. */
const ms = (milliseconds) => Math.round((milliseconds * 60) / 1000);

/**
 * Explosion presets: layers of the sheets above, each with a start delay, a
 * target width in world px, a frame rate, an offset and an optional tint. The
 * sheets are layered, not assigned one per size.
 */
export const EXPLOSIONS = Object.freeze({
    small: Object.freeze({
        layers: Object.freeze([
            Object.freeze({sheet: 'yellowA', delay: 0, width: 30, fps: 22}),
        ]),
        shake: null,
    }),
    medium: Object.freeze({
        layers: Object.freeze([
            Object.freeze({sheet: 'yellowA', delay: 0, width: 56, fps: 22}), // the fireball
            Object.freeze({sheet: 'stylizedC', delay: ms(50), width: 66, fps: 18, dy: 2}), // the blast behind it
        ]),
        shake: null,
    }),
    big: Object.freeze({
        layers: Object.freeze([
            Object.freeze({sheet: 'yellowA', delay: 0, width: 72, fps: 24}), // a fast, bright blast
            Object.freeze({sheet: 'orangeC', delay: ms(60), width: 116, fps: 20, dy: 4}), // the expanding fireball
            Object.freeze({sheet: 'stylizedC', delay: ms(130), width: 104, fps: 14, dy: -6, tint: 0x8a6f5c}), // the darker trailing phase
        ]),
        shake: Object.freeze({durationMs: 140, intensity: 0.0025}),
    }),
    // Not an explosion: a Spitter shell's acid splatter, once, at its native 32x32.
    acid: Object.freeze({
        layers: Object.freeze([
            Object.freeze({sheet: 'splatterViolet', delay: 0, width: 32, fps: 18, exact: true}),
        ]),
        shake: null,
    }),
});

/**
 * Procedural impacts: no textures. Sizes in world px. Lifetimes are REAL milliseconds
 * that only pass while the world runs: counted in ticks, a spark lasted two frames
 * at 4x and none at all for a rifle, which is why nobody saw them. Paused, they
 * still freeze. `core` is the white flash, `glow` the yellow halo round it.
 */
export const IMPACTS = Object.freeze({
    rifle: Object.freeze({lifeMs: 120, core: 3, glow: 6, spark: 2, streak: 4, sparks: Object.freeze([2, 2]), reach: 7, colors: Object.freeze([0xffe45c, 0xffb12e])}),
    autocannon: Object.freeze({lifeMs: 150, core: 5, glow: 9, spark: 2, streak: 5, sparks: Object.freeze([3, 4]), reach: 10, colors: Object.freeze([0xfff176, 0xffb02e, 0xff8a1f])}),
    debris: Object.freeze({lifeMs: 260, core: 0, glow: 0, spark: 2, streak: 0, sparks: Object.freeze([5, 7]), reach: 10, colors: Object.freeze([0x9e9e9e, 0x757575, 0x5d4037])}),
});

/**
 * Where a mutant's body is drawn: its art stands on the hit position (origin y 0.95
 * of a 39 px frame, row 37), so the logical hit point is its feet. Visible rows,
 * measured from the sheets: runner 21-37, spitter 20-37, brute 12-37. The impact is
 * drawn this many px above the position, at the middle of the body. Presentation only.
 */
const above = (top, bottom, scale) => Math.round((39 * 0.95 - (top + bottom + 1) / 2) * scale); // anchor at px 37.05
export const BODY_CENTRE_ABOVE = Object.freeze({
    runner: above(21, 37, 0.95), // 7
    spitter: above(20, 37, 1), // 8
    brute: above(12, 37, 1), // 12
});
export const bodyCentreAbove = (kind) => BODY_CENTRE_ABOVE[kind] ?? BODY_CENTRE_ABOVE.runner;

/** At most this many of each at once; the oldest give way. */
export const FX_CAPS = Object.freeze({impacts: 48, explosions: 12});
/** Two explosions this close, on the same tick: the smaller one is not drawn. */
export const MERGE_RADIUS = 28;
const RANK = Object.freeze({small: 1, medium: 2, big: 3}); // acid is not an explosion and never merges

const FORTIFICATIONS = new Set(['wall', 'gateVertical', 'gateHorizontal']);

/** A small seeded generator of its own (LCG), so effects vary without touching the game's RNG. */
export function fxRandom(seed = 0x2c1b3c6d) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

/** The destruction effect for a building, from its footprint: 3 wide is major. */
export function destructionFor(type, {width}) {
    if (FORTIFICATIONS.has(type)) return {kind: 'debris'};
    if (width >= 3) return {kind: 'explosion', size: 'big'};
    if (width === 2) return {kind: 'explosion', size: 'medium'};
    return {kind: 'explosion', size: 'small'};
}

/**
 * One tick's results as effects. Pure.
 *   Rifle and Autocannon hits: procedural impacts, never explosions.
 *   Rocket landings: medium. Siege Cannon landings: big.
 *   Destroyed buildings: by footprint (walls and gates only throw debris).
 * Nothing on a tile the player cannot see. Explosions on the same tick and spot
 * merge into the largest.
 * @param {{defense?, squads?, siege?, effects?}} results
 * @param {{isSeen: ({x, y}) => boolean, buildingAt: (id) => {type, x, y, width, height} | null,
 *          turretAt: (id) => {x, y} | null}} view
 *   Spitter shells: an acid splatter where each one lands (`splatters`), never merged.
 * @returns {{impacts: Array<{type, x, y, fromX, fromY}>, explosions: Array<{size, x, y}>, splatters: Array<{size: 'acid', x, y}>}}
 */
export function planEffects({defense = null, squads = null, siege = null, effects = null}, view) {
    const impacts = [];
    const explosions = [];
    const seen = (p) => Boolean(p) && view.isSeen(p);
    // Every Autocannon and rifle shot is a hit: both damage their target on the tick they
    // fire. The spark goes on the visible body, a few px above the logical position.
    const lift = (mutantId) => view.bodyAbove?.(mutantId) ?? 0;
    for (const {turretId, mutantId, x, y} of defense?.shots ?? []) {
        const from = view.turretAt(turretId) ?? {x, y};
        if (seen({x, y})) impacts.push({type: 'autocannon', x, y: y - lift(mutantId), fromX: from.x, fromY: from.y});
    }
    for (const shot of squads?.shots ?? []) {
        if (shot.rocket) continue; // a rocket's hit is its landing, below
        if (seen(shot)) impacts.push({type: 'rifle', x: shot.x, y: shot.y - lift(shot.mutantId), fromX: shot.fromX, fromY: shot.fromY});
    }
    for (const {x, y} of squads?.impacts ?? []) if (seen({x, y})) explosions.push({size: 'medium', x, y});
    for (const {x, y} of siege?.impacts ?? []) if (seen({x, y})) explosions.push({size: 'big', x, y});
    for (const id of effects?.destroyed ?? []) {
        const building = view.buildingAt(id);
        if (!building || !seen(building)) continue;
        const effect = destructionFor(building.type, building);
        // From the lower half of the footprint, so the blast rises over the building.
        const at = {x: building.x, y: building.y + building.height * 0.2};
        if (effect.kind === 'debris') impacts.push({type: 'debris', ...at, fromX: at.x, fromY: at.y + 8});
        else explosions.push({size: effect.size, ...at});
    }
    // Biggest first, then any that overlap a kept one go.
    const kept = [];
    for (const e of explosions.sort((a, b) => RANK[b.size] - RANK[a.size])) {
        if (kept.some((k) => Math.hypot(k.x - e.x, k.y - e.y) <= MERGE_RADIUS)) continue;
        kept.push(e);
    }
    // Where each Spitter shell actually landed, hit or miss: the acid splashes there.
    const splatters = (effects?.impacts ?? []).filter((p) => seen(p)).map(({x, y}) => ({size: 'acid', x, y}));
    return {impacts, explosions: kept, splatters};
}

/**
 * A procedural impact's sparks: a few pixels thrown back from the hit, scattered
 * about the direction away from the shooter. Pure.
 */
export function impactSparks(type, {x, y, fromX, fromY}, random) {
    const spec = IMPACTS[type];
    const [min, max] = spec.sparks;
    const count = min + Math.floor(random() * (max - min + 1));
    const back = Math.atan2(fromY - y, fromX - x); // ricochets fly back towards the shooter's side
    return Array.from({length: count}, () => {
        const angle = back + (random() - 0.5) * (type === 'debris' ? Math.PI * 1.6 : 1.4);
        return {
            dx: Math.cos(angle), dy: Math.sin(angle),
            reach: spec.reach * (0.5 + random() * 0.5),
            color: spec.colors[Math.floor(random() * spec.colors.length)],
            streak: type === 'autocannon' && random() < 0.35, // the odd ricochet leaves a short line
        };
    });
}

/** The layers an explosion plays, with their cosmetic variation. Pure. */
export function explosionLayers(size, {x, y}, random) {
    return EXPLOSIONS[size].layers.map((layer) => {
        const sheet = FX_SHEETS[layer.sheet];
        const variation = layer.exact ? 1 : 0.92 + random() * 0.16; // exact: native size, on the very spot
        const jitter = layer.exact ? 0 : 1;
        return {
            sheet: layer.sheet,
            x: x + (random() - 0.5) * 6 * jitter,
            y: y + (layer.dy ?? 0) + (random() - 0.5) * 4 * jitter,
            scale: (layer.width / sheet.visible) * variation,
            delay: layer.delay,
            fps: layer.fps,
            flip: random() < 0.5,
            tint: layer.tint ?? null,
            ticks: Math.ceil((sheet.frames * 60) / layer.fps), // its whole animation, in ticks
        };
    });
}

/** Which frame a layer shows `elapsed` ticks after it starts, or null once finished. */
export function layerFrame(layer, elapsed) {
    if (elapsed < 0) return -1; // not started
    const frame = Math.floor((elapsed * layer.fps) / 60);
    return frame < FX_SHEETS[layer.sheet].frames ? frame : null;
}
