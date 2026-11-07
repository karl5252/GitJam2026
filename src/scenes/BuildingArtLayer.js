import {addArt, placeArt, buildingFrame} from './SpriteArt.js';
import {wallAppearance} from './WallTiles.js';

const ART_BUILDINGS = new Set(['hq', 'barracks', 'factory', 'powerPlant', 'wall']);
const ART_DEPTH = 1.1; // above the low-contrast footprint, below FogOfWar (2.5)
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
        const sprite = addArt(this.#scene, building.type, ART_DEPTH);
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
