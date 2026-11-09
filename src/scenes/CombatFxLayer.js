import {FX_CAPS, FX_SHEETS, IMPACTS, EXPLOSIONS, explosionLayers, fxKey, fxRandom, impactSparks, layerFrame} from './combatFx.js';

const DEPTH = 7.5; // over units and shells (6-7), under the HUD, which is its own scene
const SHAKE_COOLDOWN_MS = 400;

/** BootScene: the three explosion strips, frame rectangles as in their TXT files. */
export function preloadCombatFx(scene) {
    for (const [name, {path, frameWidth, frameHeight}] of Object.entries(FX_SHEETS)) {
        scene.load.spritesheet(fxKey(name), `assets/sprites/${path}`, {frameWidth, frameHeight});
    }
}

/** Pixel art stays sharp at any zoom. */
export function filterCombatFx(scene, nearest) {
    if (nearest === undefined) return;
    for (const name of Object.keys(FX_SHEETS)) {
        if (scene.textures.exists(fxKey(name))) scene.textures.get(fxKey(name)).setFilter?.(nearest);
    }
}

/**
 * TASK 031: bullet impacts and explosions, drawn from what combatFx.js plans.
 * Presentation only. Bullet impacts are a few pixels on one shared Graphics,
 * redrawn each frame; explosions are pooled sprites whose frame comes from the
 * simulation tick, so a paused game freezes them and nothing depends on frame
 * rate. Nothing is interactive. Everything ends by itself, at most FX_CAPS exist
 * at once, and clear() / destroy() leave nothing behind.
 */
export class CombatFxLayer {
    #scene;
    #graphics;
    #impacts = []; // {type, x, y, start, sparks}
    #explosions = []; // {size, x, y, start, layers: [{..., sprite}]}
    #free = new Map(); // sheet -> spare sprites
    #random = fxRandom();
    #lastShake = -Infinity;
    #tick = 0; // the tick last drawn, for QA's ages
    #totals = {impacts: {rifle: 0, autocannon: 0, debris: 0}, explosions: {small: 0, medium: 0, big: 0, acid: 0}, dropped: 0};

    constructor(scene) {
        this.#scene = scene;
        this.#graphics = scene.add.graphics().setDepth(DEPTH);
    }

    /** One tick's plan (combatFx.planEffects), starting on `tick`. */
    spawn({impacts, explosions, splatters = []}, tick) {
        for (const impact of impacts) {
            this.#impacts.push({...impact, start: tick, age: 0, sparks: impactSparks(impact.type, impact, this.#random)});
            this.#totals.impacts[impact.type]++;
        }
        while (this.#impacts.length > FX_CAPS.impacts) {
            this.#impacts.shift();
            this.#totals.dropped++;
        }
        for (const {size, x, y} of [...explosions, ...splatters]) { // a splatter plays like a one-layer explosion
            this.#explosions.push({size, x, y, start: tick, layers: explosionLayers(size, {x, y}, this.#random).map((l) => ({...l, sprite: null}))});
            this.#totals.explosions[size]++;
            this.#shake(size, {x, y});
        }
        while (this.#explosions.length > FX_CAPS.explosions) {
            this.#release(this.#explosions.shift());
            this.#totals.dropped++;
        }
    }

    /**
     * Each frame, at the simulation's tick: advance, draw, and let finished effects go.
     * Explosions follow the tick. Impacts age by real time, but only while the world
     * runs (`running`), so they read the same at any speed and freeze when paused.
     */
    sync(tick, deltaMs = 0, running = true) {
        this.#tick = tick;
        this.#explosions = this.#explosions.filter((explosion) => {
            let alive = false;
            for (const layer of explosion.layers) {
                const frame = layerFrame(layer, tick - explosion.start - layer.delay);
                if (frame === null) {
                    this.#free.get(layer.sheet)?.push(layer.sprite);
                    layer.sprite?.setVisible(false);
                    layer.sprite = null;
                    layer.done = true;
                    continue;
                }
                alive = true;
                if (frame < 0) continue; // not started yet
                layer.sprite ??= this.#sprite(layer);
                layer.sprite?.setFrame(frame).setVisible(true);
            }
            return alive || explosion.layers.some((l) => !l.done);
        });

        const g = this.#graphics.clear();
        const step = running ? Math.min(Math.max(deltaMs, 0), 50) : 0; // a long frame never skips a spark
        for (const impact of this.#impacts) impact.age += step;
        this.#impacts = this.#impacts.filter((impact) => impact.age <= IMPACTS[impact.type].lifeMs);
        for (const impact of this.#impacts) {
            const spec = IMPACTS[impact.type];
            const t = impact.age / spec.lifeMs; // 0 .. 1
            const fade = 1 - t * t; // stays bright, then goes
            if (spec.core && t < 0.55) {
                const glow = spec.glow * (1 - t * 0.4);
                const core = spec.core * (1 - t * 0.4);
                g.fillStyle(0xffd23f, 0.85 * fade).fillRect(impact.x - glow / 2, impact.y - glow / 2, glow, glow);
                g.fillStyle(0xffffff, 1).fillRect(impact.x - core / 2, impact.y - core / 2, core, core);
            }
            const out = 1 - (1 - t) * (1 - t); // eased: quick out, then settling
            for (const spark of impact.sparks) {
                const px = impact.x + spark.dx * spark.reach * out;
                const py = impact.y + spark.dy * spark.reach * out + (impact.type === 'debris' ? 6 * t * t : 0);
                g.fillStyle(spark.color, fade).fillRect(px - spec.spark / 2, py - spec.spark / 2, spec.spark, spec.spark);
                if (spec.streak && t < 0.7) {
                    g.lineStyle(1.5, spark.color, fade).lineBetween(px, py, px - spark.dx * spec.streak, py - spark.dy * spec.streak);
                }
            }
        }
    }

    /** Game Over: nothing carries on. */
    clear() {
        for (const explosion of this.#explosions) this.#release(explosion);
        this.#explosions = [];
        this.#impacts = [];
        this.#graphics.clear();
    }

    destroy() {
        this.clear();
        for (const sprites of this.#free.values()) for (const sprite of sprites) sprite?.destroy();
        this.#free.clear();
        this.#graphics.destroy();
    }

    /** What QA sees. */
    view() {
        return {
            impacts: this.#impacts.map(({type, x, y, start, age}) => ({type, x, y, ticks: this.#tick - start, ageMs: Math.round(age)})),
            explosions: this.#explosions.map(({size, x, y, layers}) => ({
                size, x, y,
                layers: layers.map(({sheet, scale, delay, fps, tint, sprite, done}) => ({
                    sheet, scale, delay, fps, tint, done: Boolean(done),
                    visible: Boolean(sprite?.visible), frame: sprite ? Number(sprite.frame?.name ?? sprite.frame) : null,
                    width: sprite ? sprite.displayWidth : null,
                })),
            })),
            totals: structuredClone(this.#totals),
            pooled: [...this.#free.values()].reduce((n, list) => n + list.length, 0),
        };
    }

    #sprite(layer) {
        const key = fxKey(layer.sheet);
        if (!this.#scene.textures.exists(key)) return null;
        const pool = this.#free.get(layer.sheet) ?? [];
        this.#free.set(layer.sheet, pool);
        const sprite = pool.pop() ?? this.#scene.add.sprite(0, 0, key, 0);
        sprite.setOrigin(0.5, FX_SHEETS[layer.sheet].originY).setPosition(layer.x, layer.y).setScale(layer.scale)
            .setFlipX(layer.flip).setDepth(DEPTH).setVisible(false);
        if (layer.tint) sprite.setTint(layer.tint);
        else sprite.clearTint();
        return sprite;
    }

    #release(explosion) {
        for (const layer of explosion.layers) {
            if (!layer.sprite) continue;
            layer.sprite.setVisible(false);
            this.#free.get(layer.sheet)?.push(layer.sprite);
            layer.sprite = null;
        }
    }

    /** A brief, controlled shake for a big explosion in view, never twice in quick succession. */
    #shake(size, {x, y}) {
        const shake = EXPLOSIONS[size].shake;
        if (!shake) return;
        const camera = this.#scene.cameras?.main;
        const now = this.#scene.time?.now ?? 0;
        if (!camera || now - this.#lastShake < SHAKE_COOLDOWN_MS || !camera.worldView.contains(x, y)) return;
        this.#lastShake = now;
        camera.shake(shake.durationMs, shake.intensity);
    }
}
