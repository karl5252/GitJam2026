import {addArt, artKey, buildingArtKind, placeArt, buildingFrame, doorwayAt} from './SpriteArt.js';
import {gateDepth} from './GateLayer.js';
import {wallFrames} from './WallTiles.js';
import {getBuildingType} from '../core/buildingTypes.js';

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
        const kind = buildingArtKind(building);
        const sprite = addArt(this.#scene, kind, artDepth(building));
        if (!sprite) return false;
        const {x, y, width, height} = this.#grid.footprintRect(building);
        // Images are bottom anchored; independent source aspect ratios are retained.
        // Wall frames are centred on their own tile (see ART.wall).
        // Taller building art stays bottom-anchored as before.
        placeArt(sprite, kind, x + width / 2, building.type === 'wall' ? y + height / 2 : y + height - 2);
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
            frame: Number(sprite.frame.name), width: sprite.displayWidth, height: sprite.displayHeight, depth: sprite.depth, originY: sprite.originY,
            doorway: doorwayAt(sprite.texture.key.replace('papi-art-', ''), sprite),
        }));
    }

    update(building, shift) {
        const sprite = this.#sprites.get(building.id);
        if (!sprite) return;
        if (building.type === 'wall') return; // its frame follows its neighbours, in syncWalls
        const wanted = artKey(buildingArtKind(building));
        if (sprite.texture.key !== wanted && this.#scene.textures.exists(wanted)) sprite.setTexture(wanted, 0);
        sprite.setFrame(buildingFrame(building, shift))
            .setAlpha(building.enabled ? 1 : DISABLED_ALPHA);
    }

    /** HP changes during the Night and during repairs, not just on shift transitions. */
    syncDamage(buildings, shift) {
        for (const building of buildings) this.update(building, shift);
    }

    sync(buildings, shift) {
        const standing = new Set(buildings.map((building) => building.id));
        for (const id of this.#sprites.keys()) {
            if (!standing.has(id)) this.remove(id);
        }
        for (const building of buildings) this.update(building, shift);
        this.syncWalls(buildings);
    }

    /**
     * Called from sync(), i.e. on every placement, demolition, destruction and layout
     * load. Wall autotile frames follow neighbours; HP visuals use syncDamage.
     */
    syncWalls(buildings) {
        const linked = buildings.filter(({type}) => type === 'wall' || getBuildingType(type)?.gate);
        const signature = linked.map(({id, col, row}) => `${id}:${col},${row}`).join('|');
        if (signature === this.#wallSignature) return;
        this.#wallSignature = signature;
        for (const [id, frame] of wallFrames(linked)) this.#sprites.get(id)?.setFrame(frame);
    }

    remove(id) {
        this.#sprites.get(id)?.destroy();
        this.#sprites.delete(id);
        this.#wallSignature = null;
    }
}
