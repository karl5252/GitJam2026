import {VisionState} from '../core/vision.js';

const TEXTURE = 'fog-of-war';
const DEPTH = 2.5; // over buildings and trucks, under every placement preview
const COLOR = {r: 7, g: 13, b: 12};
const OPACITY = {[VisionState.UNEXPLORED]: 255, [VisionState.EXPLORED]: 150, [VisionState.VISIBLE]: 0};

/**
 * The fog: one texel per tile, stretched over the map as a single world image. It
 * costs one quad a frame and stays on the grid through any pan or zoom, and the
 * stretching itself is what softens the edge between tiles. It is only redrawn when
 * the fog has changed. Presentation only.
 */
export class FogLayer {
    #fog;
    #grid;
    #texture;
    #pixels;
    #image;
    #revision = -1;

    /**
     * @param {Phaser.Scene} scene
     * @param {import('../core/grid.js').Grid} grid
     * @param {import('../core/vision.js').FogOfWar} fog
     */
    constructor(scene, grid, fog) {
        this.#fog = fog;
        this.#grid = grid;
        if (scene.textures.exists(TEXTURE)) scene.textures.remove(TEXTURE); // a restart is a new run
        this.#texture = scene.textures.createCanvas(TEXTURE, grid.cols, grid.rows);
        this.#pixels = this.#texture.getContext().createImageData(grid.cols, grid.rows);
        this.#image = scene.add.image(grid.originX, grid.originY, TEXTURE).setOrigin(0, 0).setScale(grid.tileSize).setDepth(DEPTH);
        this.sync();
    }

    sync() {
        if (this.#fog.revision === this.#revision) return;
        this.#revision = this.#fog.revision;
        const {cols, rows} = this.#grid;
        const {data} = this.#pixels;
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const i = (row * cols + col) * 4;
                data[i] = COLOR.r;
                data[i + 1] = COLOR.g;
                data[i + 2] = COLOR.b;
                data[i + 3] = OPACITY[this.#fog.stateAt(col, row)];
            }
        }
        this.#texture.getContext().putImageData(this.#pixels, 0, 0);
        this.#texture.refresh();
    }

    view() {
        const {x, y, depth, displayWidth: width, displayHeight: height} = this.#image;
        return {x, y, width, height, depth, revision: this.#revision};
    }
}
