import {NIGHT_TINT, nightTintAlpha} from './nightTint.js';

/**
 * Over terrain, roads, buildings and trucks, and under the fog (2.5), so fogged
 * ground is not darkened twice. Turrets, HP bars, units, shells and muzzle
 * flashes (5 and up) sit above it and keep their colours.
 */
const DEPTH = 2.4;
const MARGIN = 16; // the world rectangle the camera may show: the grid plus 16 px

/**
 * A subtle blue over the world at Night. One rectangle in GameScene's world, so the
 * HUD, which is its own scene, is never touched, and it follows the camera at any
 * zoom. Presentation only.
 */
export class NightTintLayer {
    #view;

    constructor(scene, grid) {
        const rect = grid.footprintRect({col: 0, row: 0, width: grid.cols, height: grid.rows});
        this.#view = scene.add.rectangle(
            rect.x - MARGIN, rect.y - MARGIN, rect.width + 2 * MARGIN, rect.height + 2 * MARGIN, NIGHT_TINT.color, 1,
        ).setOrigin(0, 0).setDepth(DEPTH).setAlpha(0).setVisible(false);
    }

    /** @param {Parameters<typeof nightTintAlpha>[0]} cycle */
    sync(cycle) {
        const alpha = nightTintAlpha(cycle);
        if (alpha === this.#view.alpha && this.#view.visible === alpha > 0) return;
        this.#view.setAlpha(alpha).setVisible(alpha > 0);
    }

    /** For QA. */
    view() {
        return {visible: this.#view.visible, alpha: this.#view.alpha, color: this.#view.fillColor, depth: this.#view.depth};
    }
}
