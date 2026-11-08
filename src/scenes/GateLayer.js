import {addArt, placeArt} from './SpriteArt.js';
import {gateArtFrame, gateArtKind} from './GateFrames.js';
import {GateState, GATE} from '../core/gates.js';

const BAR_COLOR = 0xffb300;
const POST_COLOR = 0xeceff1;
const BAR_THICKNESS = 8;
const POST_LENGTH = 5;
const GATE_DEPTH = 1.5; // over the building tile, under HP bars
const ROW_DEPTH = 0.001; // a gate further south draws over one further north: 32 rows stay below 1.6
const PREVIEW_DEPTH = 4;
const GHOST_ALPHA = 0.75;

/** Depth from the tile a gate stands on, never from the top of its art. */
export const gateDepth = (row) => GATE_DEPTH + row * ROW_DEPTH;

/** What QA sees of a gate sprite: sheet, frame, rotation and the rectangle it covers. */
function spriteView(art, kind) {
    if (!art) return {kind: null, frame: null, angle: null};
    const frame = typeof art.frame === 'object' ? Number(art.frame.name) : art.frame;
    return {
        kind, frame, angle: art.angle, x: art.x, y: art.y, width: art.displayWidth, height: art.displayHeight,
        originX: art.originX, originY: art.originY, depth: art.depth,
    };
}

/** 0 is shut and 1 is fully open, so a moving barrier reads as moving. */
function openness({state, timer}) {
    if (state === GateState.OPEN) return 1;
    if (state === GateState.OPENING) return 1 - timer / GATE.openTicks;
    if (state === GateState.CLOSING) return timer / GATE.closeTicks;
    return 0;
}

/**
 * Gate barrier art follows the existing core gate state machine. Each orientation
 * draws its own sheet, unrotated, anchored bottom-centre on the bottom edge of the
 * one tile the gate stands on: a vertical gate's art rises 16 px into the tile above
 * without occupying it. Depth comes from the gate's own row. Sprites are never
 * interactive, so a press on the overhang is a press on the tile under it, as the
 * grid decides. The procedural barrier is the fallback when art is missing. None of
 * this affects footprints, roads or pathing.
 */
export class GateLayer {
    #scene;
    #grid;
    #graphics;
    #sprites = new Map(); // gate id -> presentation-only sprite
    #preview;
    #views = [];
    #key = '';
    #previewView = {visible: false, col: null, row: null, orientation: null};
    #ghosts = new Map(); // orientation -> placement ghost sprite, made on first use
    #ghostView = null;

    constructor(scene, grid) {
        this.#scene = scene;
        this.#grid = grid;
        this.#graphics = scene.add.graphics().setDepth(GATE_DEPTH);
        this.#preview = scene.add.graphics().setDepth(PREVIEW_DEPTH);
    }

    /** @param {Array<{id, col, row, orientation, state, timer}>} gates */
    sync(gates) {
        const key = gates.map(({id, col, row, orientation, state, timer}) => `${id}:${col},${row}:${orientation}:${state}:${timer}`).join('|');
        if (key === this.#key) return;
        this.#key = key;
        this.#graphics.clear();
        const standing = new Set(gates.map(({id}) => id));
        for (const [id, sprite] of this.#sprites) {
            if (standing.has(id)) continue;
            sprite.destroy();
            this.#sprites.delete(id);
        }
        this.#views = gates.map((gate) => {
            const open = openness(gate);
            let art = this.#sprites.get(gate.id);
            const kind = gateArtKind(gate.orientation);
            if (!art) {
                art = addArt(this.#scene, kind, gateDepth(gate.row));
                if (art) this.#sprites.set(gate.id, art);
            }
            if (art) {
                this.#stand(art, kind, gate);
                art.setFrame(gateArtFrame(gate.orientation, open)).setAngle(0); // each orientation has its own native sheet
            } else {
                // Missing textures should not leave a completely invisible gate.
                this.#draw(this.#graphics, gate, open, BAR_COLOR);
            }
            // QA: which sheet frame and rotation the gate is drawn with, or null on the graphics fallback.
            return {id: gate.id, col: gate.col, row: gate.row, orientation: gate.orientation, state: gate.state, open, ...spriteView(art, kind)};
        });
    }

    /** The barrier a gate would have here, with the way traffic would pass. Null hides it. */
    showPreview(cell, orientation, color) {
        this.#preview.clear();
        this.#previewView = {visible: Boolean(cell), col: cell?.col ?? null, row: cell?.row ?? null, orientation: cell ? orientation : null};
        for (const ghost of this.#ghosts.values()) ghost.setVisible(false);
        this.#ghostView = null;
        if (!cell) return;
        // The gate as it would stand, closed, at its real size; tinted by the verdict.
        const ghost = this.#ghost(orientation);
        if (ghost) {
            this.#stand(ghost, gateArtKind(orientation), cell);
            ghost.setFrame(0).setAngle(0).setTint(color).setAlpha(GHOST_ALPHA).setVisible(true);
            this.#ghostView = spriteView(ghost, gateArtKind(orientation));
        } else {
            this.#draw(this.#preview, {...cell, orientation}, 0, color);
        }
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
        return {...this.#previewView, ghost: this.#ghostView && {...this.#ghostView}};
    }

    /** Bottom-centre on the bottom edge of the gate's one tile. */
    #stand(sprite, kind, {col, row}) {
        const {x, y} = this.#grid.cellCenter(col, row);
        placeArt(sprite, kind, x, y + this.#grid.tileSize / 2);
    }

    #ghost(orientation) {
        if (!this.#ghosts.has(orientation)) {
            const art = addArt(this.#scene, gateArtKind(orientation), PREVIEW_DEPTH);
            if (!art) return null;
            this.#ghosts.set(orientation, art.setVisible(false));
        }
        return this.#ghosts.get(orientation);
    }
}
