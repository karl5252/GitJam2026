import {addArt, placeArt, buildingFrame, doorwayAt} from './SpriteArt.js';
import {gateDepth} from './GateLayer.js';
import {wallAppearance} from './WallTiles.js';

const ART_BUILDINGS = new Set(['hq', 'barracks', 'factory', 'powerPlant', 'mine', 'outpost', 'loudspeaker', 'wall']);
/**
 * Building art sorts by the row its footprint ends on, on the same scale as gates
 * (1.5 + row x 0.001): whatever stands further south draws in front, tower,
 * building or gate alike, so a tall tower's overhang goes behind nothing nearer
 * the viewer. All of it stays over the footprints (1) and under trucks, the
 * selection highlight (2), the night tint (2.4) and the fog (2.5).
 */
export const artDepth = ({row, height}) => gateDepth(row + height - 1);
const DISABLED_ALPHA = 0.35;

/**
 * Cosmetic building sprites. Footprints remain in GameScene's buildingViews,
 * which are the same selectable, QA-visible rectangles as before this patch.
 * No building art position/scale/frame is ever used by placement or simulation.
 */
export class BuildingArtLayer {
    #scene;
    #grid;
    #sprites = new Map();
    #wallSignature = null;

    constructor(scene, grid) {
        this.#scene = scene;
        this.#grid = grid;
    }

    /** Returns true when art exists; otherwise the old colored rectangle stays visible. */
    add(building, shift = 'day') {
        this.remove(building.id);
        if (!ART_BUILDINGS.has(building.type)) return false;
        const sprite = addArt(this.#scene, building.type, artDepth(building));
        if (!sprite) return false;
        const {x, y, width, height} = this.#grid.footprintRect(building);
        // Images are bottom anchored; independent source aspect ratios are retained.
        // Wall graphics now use full 32x32 frames centred on their own tile.
        // Taller building art stays bottom-anchored as before.
        placeArt(sprite, building.type, x + width / 2, building.type === 'wall' ? y + height / 2 : y + height - 2);
        this.#sprites.set(building.id, sprite);
        if (building.type === 'wall') this.#wallSignature = null;
        this.update(building, shift);
        return true;
    }

    has(id) { return this.#sprites.has(id); }

    /** QA: each sprite's position, and its doorway where the art has one. */
    views() {
        return [...this.#sprites.entries()].map(([id, sprite]) => ({
            id, kind: sprite.texture.key.replace('papi-art-', ''), x: sprite.x, y: sprite.y,
            width: sprite.displayWidth, height: sprite.displayHeight, depth: sprite.depth, originY: sprite.originY,
            doorway: doorwayAt(sprite.texture.key.replace('papi-art-', ''), sprite),
        }));
    }

    update(building, shift) {
        const sprite = this.#sprites.get(building.id);
        if (!sprite) return;
        if (building.type === 'wall') return; // neighbor topology and damage handled by syncWalls
        sprite.setFrame(buildingFrame(building, shift))
            .setAlpha(building.enabled ? 1 : DISABLED_ALPHA);
    }

    sync(buildings, shift) {
        const standing = new Set(buildings.map((building) => building.id));
        for (const id of this.#sprites.keys()) {
            if (!standing.has(id)) this.remove(id);
        }
        for (const building of buildings) this.update(building, shift);
        this.syncWalls(buildings);
    }

    /** Runs often but changes frames only when wall geometry or HP actually changes. */
    syncWalls(buildings) {
        const walls = buildings.filter(({type}) => type === 'wall');
        const signature = walls.map(({id, col, row, hp}) => `${id}:${col},${row}:${hp}`).join('|');
        if (signature === this.#wallSignature) return;
        this.#wallSignature = signature;
        const occupied = new Set(walls.map(({col, row}) => `${col},${row}`));
        for (const wall of walls) {
            const sprite = this.#sprites.get(wall.id);
            if (!sprite) continue;
            const {frame, angle} = wallAppearance(wall, occupied);
            sprite.setFrame(frame).setAngle(angle);
        }
    }

    remove(id) {
        this.#sprites.get(id)?.destroy();
        this.#sprites.delete(id);
        this.#wallSignature = null;
    }
}
