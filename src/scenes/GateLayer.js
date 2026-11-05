import {GateState, GATE} from '../core/gates.js';

const BAR_COLOR = 0xffb300;
const POST_COLOR = 0xeceff1;
const BAR_THICKNESS = 8;
const POST_LENGTH = 5;
const GATE_DEPTH = 1.5; // over the building tile, under HP bars
const PREVIEW_DEPTH = 4;

/** 0 is shut and 1 is fully open, so a moving barrier reads as moving. */
function openness({state, timer}) {
    if (state === GateState.OPEN) return 1;
    if (state === GateState.OPENING) return 1 - timer / GATE.openTicks;
    if (state === GateState.CLOSING) return timer / GATE.closeTicks;
    return 0;
}

/**
 * Gate barriers. Presentation only. A shut gate shows one bar across the road;
 * as it opens the bar parts towards two posts, so state reads from shape as well
 * as colour. All gates share one Graphics object, redrawn only when one changes,
 * so a destroyed gate leaves nothing behind.
 */
export class GateLayer {
    #grid;
    #graphics;
    #preview;
    #views = [];
    #key = '';
    #previewView = {visible: false, col: null, row: null, orientation: null};

    constructor(scene, grid) {
        this.#grid = grid;
        this.#graphics = scene.add.graphics().setDepth(GATE_DEPTH);
        this.#preview = scene.add.graphics().setDepth(PREVIEW_DEPTH);
    }

    /** @param {Array<{id, col, row, orientation, state, timer}>} gates */
    sync(gates) {
        const key = gates.map(({id, state, timer}) => `${id}:${state}:${timer}`).join();
        if (key === this.#key) return;
        this.#key = key;
        this.#graphics.clear();
        this.#views = gates.map((gate) => {
            const open = openness(gate);
            this.#draw(this.#graphics, gate, open, BAR_COLOR);
            return {id: gate.id, col: gate.col, row: gate.row, orientation: gate.orientation, state: gate.state, open};
        });
    }

    /** The barrier a gate would have here, with the way traffic would pass. Null hides it. */
    showPreview(cell, orientation, color) {
        this.#preview.clear();
        this.#previewView = {visible: Boolean(cell), col: cell?.col ?? null, row: cell?.row ?? null, orientation: cell ? orientation : null};
        if (!cell) return;
        this.#draw(this.#preview, {...cell, orientation}, 0, color);
        const {x, y} = this.#grid.cellCenter(cell.col, cell.row);
        const half = this.#grid.tileSize / 2 - 2;
        const [dx, dy] = orientation === 'vertical' ? [1, 0] : [0, 1];
        this.#preview.fillStyle(color, 1);
        for (const side of [-1, 1]) {
            const tipX = x + dx * half * side;
            const tipY = y + dy * half * side;
            const baseX = x + dx * (half - 7) * side;
            const baseY = y + dy * (half - 7) * side;
            this.#preview.fillTriangle(tipX, tipY, baseX + dy * 5, baseY + dx * 5, baseX - dy * 5, baseY - dx * 5);
        }
    }

    #draw(graphics, {col, row, orientation}, open, color) {
        const {tileSize} = this.#grid;
        const {x, y} = this.#grid.cellCenter(col, row);
        const half = tileSize / 2;
        const leaf = (half - POST_LENGTH) * (1 - open); // each half of the bar, beyond its post
        const reach = POST_LENGTH + leaf;
        const vertical = orientation === 'vertical';
        const segment = (from, length, fill) => {
            graphics.fillStyle(fill, 1);
            if (vertical) graphics.fillRect(x - BAR_THICKNESS / 2, y + from, BAR_THICKNESS, length);
            else graphics.fillRect(x + from, y - BAR_THICKNESS / 2, length, BAR_THICKNESS);
        };
        segment(-half, reach, color);
        segment(half - reach, reach, color);
        segment(-half, POST_LENGTH, POST_COLOR);
        segment(half - POST_LENGTH, POST_LENGTH, POST_COLOR);
    }

    /** The rendered gates, for QA. */
    views() {
        return this.#views.map((view) => ({...view}));
    }

    previewView() {
        return {...this.#previewView};
    }
}
