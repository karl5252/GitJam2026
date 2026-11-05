const ROAD_COLOR = 0x455a64;
const RING_COLOR = 0x546e7a;
const ROAD_DEPTH = 0.5; // under buildings
const RING_PREVIEW_DEPTH = 3;
const DOCK_INSET = 8;
const FACTORY_DOCK_COLOR = 0xffb300;
const HQ_DOCK_COLOR = 0x66bb6a;
const BARRACKS_EXIT_COLOR = 0x29b6f6;
const DOCK_COLORS = {factory: FACTORY_DOCK_COLOR, hq: HQ_DOCK_COLOR, barracks: BARRACKS_EXIT_COLOR};

/** Road tiles and the HQ ring preview. Presentation only; redrawn on change. */
export class RoadLayer {
    #grid;
    #graphics;
    #ringPreview;
    #dockPreview;
    #views = [];
    #dockViews = [];

    constructor(scene, grid) {
        this.#grid = grid;
        this.#graphics = scene.add.graphics().setDepth(ROAD_DEPTH);
        this.#ringPreview = scene.add.rectangle(0, 0, 1, 1).setOrigin(0, 0).setDepth(RING_PREVIEW_DEPTH).setVisible(false);
        this.#dockPreview = scene.add.rectangle(0, 0, grid.tileSize, grid.tileSize).setOrigin(0, 0).setDepth(RING_PREVIEW_DEPTH).setVisible(false);
    }

    /**
     * @param {Array<{col, row, kind}>} tiles
     * @param {Array<{col, row, kind: 'factory' | 'hq' | 'barracks'}>} docks
     */
    sync(tiles, docks = []) {
        this.#graphics.clear();
        this.#views = tiles.map(({col, row, kind}) => {
            const {x, y, width, height} = this.#grid.footprintRect({col, row});
            this.#graphics.fillStyle(kind === 'hq-ring' ? RING_COLOR : ROAD_COLOR, 1);
            this.#graphics.fillRect(x, y, width, height);
            return {col, row, kind, x, y, width, height};
        });
        this.#dockViews = docks.map(({col, row, kind}) => {
            const {x, y, width, height} = this.#grid.footprintRect({col, row});
            this.#graphics.fillStyle(DOCK_COLORS[kind], 1);
            this.#graphics.fillRect(x + DOCK_INSET, y + DOCK_INSET, width - 2 * DOCK_INSET, height - 2 * DOCK_INSET);
            return {col, row, kind};
        });
    }

    /** The tile a Factory preview needs, or null to hide it. */
    showDock(cell, color) {
        if (!cell) {
            this.#dockPreview.setVisible(false);
            return;
        }
        const {x, y} = this.#grid.footprintRect(cell);
        this.#dockPreview.setPosition(x, y).setStrokeStyle(3, color).setVisible(true);
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

    dockViews() {
        return this.#dockViews.map((view) => ({...view}));
    }

    dockPreviewView() {
        const {visible, x, y} = this.#dockPreview;
        return {visible, x, y};
    }

    ringPreviewView() {
        const {visible, x, y, width, height} = this.#ringPreview;
        return {visible, x, y, width, height};
    }
}
