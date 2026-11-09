import {addArt, placeArt} from './SpriteArt.js';
import {CAMEO} from './presidentCameo.js';

const DEPTH = 6; // with the workers: over buildings, the night tint and the fog
const DUST_DEPTH = 5.9; // under his boots
const DUST = 0xc8b48a;

/**
 * TASK 033.2: draws El Presidente from PresidentCameo's view, and his dust. Presentation
 * only, never interactive, so a press on him is a press on the tile under him.
 */
export class PresidentLayer {
    #art;
    #dust;

    constructor(scene) {
        this.#art = addArt(scene, 'elcolonel', DEPTH)?.setVisible(false) ?? null;
        this.#dust = scene.add.graphics().setDepth(DUST_DEPTH);
    }

    sync({visible, x, y, frame, flip, dust}) {
        if (this.#art) {
            this.#art.setVisible(visible);
            if (visible) {
                placeArt(this.#art, 'elcolonel', x, y);
                this.#art.setFrame(frame).setFlipX(flip);
            }
        }
        this.#dust.clear();
        for (const {x: px, y: py, age, drift} of dust) {
            const t = age / CAMEO.dustMs;
            this.#dust.fillStyle(DUST, 0.55 * (1 - t)).fillCircle(px + drift * 6 * t, py - 1 - 5 * t, 2 + 4 * t);
        }
    }

    /** What is really drawn. */
    view() {
        return {
            visible: Boolean(this.#art?.visible),
            frame: this.#art ? Number(this.#art.frame.name) : null,
            texture: this.#art?.texture.key ?? null,
            flip: Boolean(this.#art?.flipX),
            x: this.#art?.x ?? null,
            y: this.#art?.y ?? null,
        };
    }

    destroy() {
        this.#art?.destroy();
        this.#dust.destroy();
        this.#art = null;
    }
}
