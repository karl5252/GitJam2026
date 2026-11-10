import {HELI_SHEET} from './presidentialHeli.js';

const DEPTH = 8; // over everything in the world: buildings, units, the fog, combat effects
const SHADOW_DEPTH = 2.2; // on the ground and roofs, under the night tint and the fog
const SHADOW = 0x000000;

/** TASK 035: the helicopter's sheet, loaded once by BootScene. */
export function preloadHeli(scene) {
    const {key, path, frameWidth, frameHeight} = HELI_SHEET;
    scene.load.spritesheet(key, path, {frameWidth, frameHeight});
}

/** Pixel art stays sharp at any zoom. */
export function filterHeli(scene, nearest) {
    if (nearest !== undefined && scene.textures.exists(HELI_SHEET.key)) scene.textures.get(HELI_SHEET.key).setFilter?.(nearest);
}

/**
 * TASK 035: draws the Presidential helicopter from a view of presidentialHeli.js (a sprite
 * at its altitude and a shadow under it). Presentation only, never interactive. Made when
 * a flight begins and destroyed when it ends or the scene shuts down; TASK 036 reuses it.
 */
export class HeliLayer {
    #sprite;
    #shadow;

    constructor(scene) {
        this.#sprite = scene.textures.exists(HELI_SHEET.key)
            ? scene.add.sprite(0, 0, HELI_SHEET.key, 0).setOrigin(0.5, HELI_SHEET.originY).setScale(HELI_SHEET.scale).setDepth(DEPTH).setVisible(false)
            : null;
        this.#shadow = scene.add.graphics().setDepth(SHADOW_DEPTH);
    }

    sync({visible, x, y, ground, altitude, frame, flip}) {
        this.#shadow.clear();
        if (this.#sprite) {
            this.#sprite.setVisible(visible);
            if (visible) this.#sprite.setPosition(Math.round(x), Math.round(y)).setFrame(frame).setFlipX(flip);
        }
        if (visible) {
            const lift = Math.min(1, altitude / 120); // higher: smaller and fainter
            this.#shadow.fillStyle(SHADOW, 0.32 * (1 - 0.5 * lift)).fillEllipse(ground.x, ground.y, 64 * (1 - 0.3 * lift), 22 * (1 - 0.3 * lift));
        }
    }

    /** What is really drawn. */
    view() {
        return {
            visible: Boolean(this.#sprite?.visible),
            texture: this.#sprite?.texture.key ?? null,
            frame: this.#sprite ? Number(this.#sprite.frame.name) : null,
            flip: Boolean(this.#sprite?.flipX),
            x: this.#sprite?.x ?? null,
            y: this.#sprite?.y ?? null,
            depth: this.#sprite?.depth ?? null,
        };
    }

    destroy() {
        this.#sprite?.destroy();
        this.#shadow.destroy();
        this.#sprite = null;
    }
}
