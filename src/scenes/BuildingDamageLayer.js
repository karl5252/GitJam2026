import {ART, buildingArtKind} from './SpriteArt.js';
import {artDepth} from './BuildingArtLayer.js';
import {BUILDING_FX_SHEETS, buildingFxFrame, buildingFxKinds, speakerLampOn} from './buildingDamage.js';

const PREFIX = 'papi-building-fx-';
const BULB_COLOR = 0xff3434;
const SMALL = 1;
const LARGE = 2;
// Building effects go over the night tint, but under unexplored fog; turret art
// is already at depth 5, so its effects must stay above its barrel.
const BUILDING_FX_DEPTH = 2.45;
const TURRET_FX_DEPTH = 5.3;
const TURRETS = new Set(['autocannon', 'siegeCannon']);

export const buildingFxKey = (kind) => `${PREFIX}${kind}`;

export function preloadBuildingDamageFx(scene) {
    for (const [kind, {path, frameWidth, frameHeight}] of Object.entries(BUILDING_FX_SHEETS)) {
        scene.load.spritesheet(buildingFxKey(kind), `assets/sprites/${path}`, {frameWidth, frameHeight});
    }
}

export function filterBuildingDamageFx(scene, nearest) {
    if (nearest === undefined) return;
    for (const kind of Object.keys(BUILDING_FX_SHEETS)) {
        const key = buildingFxKey(kind);
        if (scene.textures.exists(key)) scene.textures.get(key).setFilter?.(nearest);
    }
}

// Placement inside the rendered sprite, not on simulation tiles. The origin is
// the bottom-centre, and the y fraction measures upward along the sprite.
// Easy to adjust after looking at the effects against the actual artwork.
export const BUILDING_FX_ANCHORS = Object.freeze({
    hq: Object.freeze({electricSparks: [-0.20, 0.65], fire: [0.22, 0.40]}),
    barracks: Object.freeze({fire: [0.15, 0.48]}),
    factory: Object.freeze({weldingSparks: [-0.17, 0.62], fire: [0.23, 0.40]}),
    powerPlant: Object.freeze({electricSparks: [0.21, 0.67], fire: [-0.20, 0.34]}),
    loudspeaker: Object.freeze({weldingSparks: [0.08, 0.76]}),
    outpost: Object.freeze({fire: [0.04, 0.72]}),
    autocannon: Object.freeze({electricSparks: [0, 0.55], fire: [0, 0.55]}),
    siegeCannon: Object.freeze({electricSparks: [0, 0.77], fire: [0, 0.77]}),
});

/** Pure positioning: unit combat and pathfinding never read these coordinates. */
export function buildingFxPosition(building, grid, kind) {
    const {x, y, width, height} = grid.footprintRect(building);
    const turret = TURRETS.has(building.type);
    const art = turret ? null : ART[buildingArtKind(building)];
    const centerX = x + width / 2 + (art?.offsetX ?? 0);
    const bottomY = turret ? y + height : y + height - 2 + (art?.offsetY ?? 0);
    const artWidth = turret ? width : art.frameWidth * art.scale;
    const artHeight = turret ? height : art.frameHeight * art.scale;
    const [fxX, fxY] = BUILDING_FX_ANCHORS[building.type]?.[kind] ?? [0, 0.5];
    return {x: Math.round(centerX + fxX * artWidth), y: Math.round(bottomY - fxY * artHeight)};
}

/** Red bulb under the loudspeaker's central horn, at authored pixel (16, 20). */
export function speakerLampPosition(building, grid) {
    const {x, y, width, height} = grid.footprintRect(building);
    const art = ART.loudspeaker;
    return {x: Math.round(x + width / 2), y: Math.round(y + height - 2 + art.offsetY - art.frameHeight * art.scale + 20)};
}

/**
 * Continuous but purely cosmetic building damage: idle loops run on the fixed
 * simulation tick, stop when paused, and require no save fields or random calls.
 */
export class BuildingDamageLayer {
    #scene;
    #grid;
    #entries = new Map(); // id -> {effects: Map(kind -> sprite), lamp}

    constructor(scene, grid) {
        this.#scene = scene;
        this.#grid = grid;
    }

    sync(buildings, poweredIds, tick) {
        const standing = new Set(buildings.map(({id}) => id));
        for (const id of this.#entries.keys()) if (!standing.has(id)) this.remove(id);

        for (const building of buildings) {
            const wanted = buildingFxKinds(building);
            const lit = speakerLampOn(building, poweredIds);
            if (!wanted.length && !lit) {
                this.remove(building.id);
                continue;
            }
            const entry = this.#entries.get(building.id) ?? {effects: new Map(), lamp: null};
            this.#entries.set(building.id, entry);
            for (const [kind, sprite] of entry.effects) {
                if (wanted.includes(kind)) continue;
                sprite.destroy();
                entry.effects.delete(kind);
            }
            for (const kind of wanted) {
                const key = buildingFxKey(kind);
                if (!this.#scene.textures.exists(key)) continue;
                let sprite = entry.effects.get(kind);
                if (!sprite) {
                    sprite = this.#scene.add.sprite(0, 0, key, 0)
                        .setOrigin(0.5, 0.5)
                        .setScale(TURRETS.has(building.type) || building.width === 1 ? SMALL : LARGE)
                        .setDepth(TURRETS.has(building.type) ? TURRET_FX_DEPTH : BUILDING_FX_DEPTH);
                    entry.effects.set(kind, sprite);
                }
                const {x, y} = buildingFxPosition(building, this.#grid, kind);
                sprite.setPosition(x, y).setFrame(buildingFxFrame(tick, building.id, kind));
            }
            if (lit) {
                if (!entry.lamp) entry.lamp = this.#scene.add.rectangle(0, 0, 3, 3, BULB_COLOR).setDepth(BUILDING_FX_DEPTH);
                const {x, y} = speakerLampPosition(building, this.#grid);
                entry.lamp.setPosition(x, y);
            } else if (entry.lamp) {
                entry.lamp.destroy();
                entry.lamp = null;
            }
        }
    }

    remove(id) {
        const entry = this.#entries.get(id);
        if (!entry) return;
        for (const sprite of entry.effects.values()) sprite.destroy();
        entry.lamp?.destroy();
        this.#entries.delete(id);
    }

    destroy() {
        for (const id of this.#entries.keys()) this.remove(id);
    }

    /** Observability only, so QA can assert HP stages and FX without screenshots. */
    views() {
        return [...this.#entries].map(([id, {effects, lamp}]) => ({
            id, lamp: Boolean(lamp), effects: [...effects].map(([kind, sprite]) => ({
                kind, x: sprite.x, y: sprite.y, frame: Number(sprite.frame.name), depth: sprite.depth,
            })),
        }));
    }
}
