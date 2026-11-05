const ROAD_COLOR = 0x455a64;
const RING_COLOR = 0x546e7a;
const ROAD_DEPTH = 0.5; // under buildings
const RING_PREVIEW_DEPTH = 3;

/** Road tiles and the HQ ring preview. Presentation only; redrawn on change. */
export class RoadLayer {
    #grid;
    #graphics;
    #ringPreview;
    #views = [];

    constructor(scene, grid) {
        this.#grid = grid;
        this.#graphics = scene.add.graphics().setDepth(ROAD_DEPTH);
        this.#ringPreview = scene.add.rectangle(0, 0, 1, 1).setOrigin(0, 0).setDepth(RING_PREVIEW_DEPTH).setVisible(false);
    }

    /** @param {Array<{col, row, kind}>} tiles */
    sync(tiles) {
        this.#graphics.clear();
        this.#views = tiles.map(({col, row, kind}) => {
            const {x, y, width, height} = this.#grid.footprintRect({col, row});
            this.#graphics.fillStyle(kind === 'hq-ring' ? RING_COLOR : ROAD_COLOR, 1);
            this.#graphics.fillRect(x, y, width, height);
            return {col, row, kind, x, y, width, height};
        });
    }

    /** The 5x5 outline around an HQ preview, or null to hide it. */
    showRing(footprint, color) {
        if (!footprint) {
            this.#ringPreview.setVisible(false);
            return;
        }
        const {x, y, width, height} = this.#grid.footprintRect({
            col: footprint.col - 1,
            row: footprint.row - 1,
            width: footprint.width + 2,
            height: footprint.height + 2,
        });
        this.#ringPreview.setPosition(x, y).setSize(width, height).setStrokeStyle(2, color).setVisible(true);
    }

    /** The rendered tiles, for QA. */
    views() {
        return this.#views.map((view) => ({...view}));
    }

    ringPreviewView() {
        const {visible, x, y, width, height} = this.#ringPreview;
        return {visible, x, y, width, height};
    }
}
