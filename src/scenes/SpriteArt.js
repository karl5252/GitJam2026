/**
 * Presentation-only sprite metadata. Source PNG frames are kept at their authored
 * sizes: there is deliberately no shared frame height or canvas-wide resizing.
 * Changes here must never feed collision, movement, targeting or world visibility.
 */
import {damageFrame} from './buildingDamage.js';

export const ART = Object.freeze({
    worker: {path: 'units/worker.png', frameWidth: 45, frameHeight: 40, scale: 0.5, offsetX: 3.5, originY: 0.95},
    rifleman: {path: 'units/rifleman.png', frameWidth: 45, frameHeight: 40, scale: 0.5, offsetX: 0.5, originY: 0.95},
    // 4 x 4 frames with 5 px between them: idle 0-1, walk 4-5, protest 8-11, hit and down 12-13.
    // The figure stands in its frame as a worker's does, so it is drawn as one.
    ecologist: {path: 'units/ecologist.png', frameWidth: 45, frameHeight: 40, spacing: 5, scale: 0.5, offsetX: 3.5, originY: 0.95},
    rocketman: {path: 'units/rocketman.png', frameWidth: 45, frameHeight: 40, scale: 0.5, offsetX: 3, originY: 0.95},
    // TASK 033.2: El Presidente's own small sheet, 4 x 4 frames as the worker's: idle 0-1,
    // walk 4-5, salute 8-11. His figure is centred in its frame (x 7..35), so no offset.
    elcolonel: {path: 'units/elcolonel.png', frameWidth: 45, frameHeight: 40, scale: 0.5, offsetX: 0, originY: 0.95},
    runner: {path: 'mutants/runner.png', frameWidth: 32, frameHeight: 39, scale: 0.95, offsetX: 0, originY: 0.95},
    spitter: {path: 'mutants/spitter.png', frameWidth: 32, frameHeight: 39, scale: 1, offsetX: 0, originY: 0.95},
    brute: {path: 'mutants/brute.png', frameWidth: 32, frameHeight: 39, scale: 1, offsetX: 0, originY: 0.95},
    truck: {path: 'vehicles/truck.png', frameWidth: 24, frameHeight: 14, scale: 1, offsetX: 0, originY: 1},
    autocannon: {path: 'turrets/autocannon.png', frameWidth: 32, frameHeight: 32, scale: 1, offsetX: 0, originY: 0.5},
    siegeCannon: {path: 'turrets/siege-cannon.png', frameWidth: 32, frameHeight: 35, scale: 2, offsetX: 0, originY: 0.5},
    // Separate 64x64 muzzle flashes, authored center-to-center with turret art.
    // Each sheet is 8 directions x 4 action frames, and never loops.
    autocannonFlash: {path: 'turrets/autocannon-flash.png', frameWidth: 64, frameHeight: 64, scale: 1, offsetX: 0, originY: 0.5},
    siegeCannonFlash: {path: 'turrets/siege-cannon-flash.png', frameWidth: 64, frameHeight: 64, scale: 1, offsetX: 0, originY: 0.5},
    // Each building occupies a 3x3 tile footprint (96x96); the art keeps its own ratio.
    hq: {path: 'buildings/hq.png', frameWidth: 32, frameHeight: 40, scale: 2.25, offsetX: 0, originY: 1},
    // Independent three-frame damage strips; the Barracks role chooses the texture.
    barracks: {path: 'buildings/barracks_rifle.png', frameWidth: 32, frameHeight: 29, scale: 2.7, offsetX: 0, originY: 1},
    barracksRocket: {path: 'buildings/barracks_rocket.png', frameWidth: 32, frameHeight: 29, scale: 2.7, offsetX: 0, originY: 1},
    factory: {path: 'buildings/factory.png', frameWidth: 32, frameHeight: 32, scale: 2.65, offsetX: 0, originY: 1},
    powerPlant: {path: 'buildings/power-plant.png', frameWidth: 32, frameHeight: 34, scale: 2.55, offsetX: 0, originY: 1},
    // A 2x2 (64x64) footprint. The 32x32 source has its doorway at columns 9..19
    // (centre 14.5) with its sill at row 26, so at 2x the doorway's centre is 3 px
    // left of the sprite's centre. offsetX 19 puts it over the south dock tile
    // {col + 1, row + 2}, 16 px right of the footprint's centre, and offsetY 14 sets
    // the sill on the footprint's bottom edge. The art overhangs 19 px east and the
    // spoil heap 12 px south: presentation only.
    mine: {path: 'buildings/mine.png', frameWidth: 32, frameHeight: 32, scale: 2, offsetX: 19, offsetY: 14, originY: 1,
        doorway: {x: 14.5, sill: 26}},
    // Tall 1x1 towers: 32 px wide, standing on the bottom edge of their tile and
    // rising 32 and 40 px into the tile above (offsetY 2 undoes the 2 px lift the
    // building layer gives larger art). The footprint stays one tile.
    outpost: {path: 'buildings/outpost.png', frameWidth: 32, frameHeight: 64, scale: 1, offsetX: 0, offsetY: 2, originY: 1},
    loudspeaker: {path: 'buildings/loudspeaker.png', frameWidth: 32, frameHeight: 72, scale: 1, offsetX: 0, offsetY: 2, originY: 1},
    // 16 frames of 64x64 in one row (walls_v3.json), frame = N1|E2|S4|W8 mask. The post
    // is centred in each frame and every arm runs to the frame's edge, so at 0.5 the
    // frame covers exactly its 32 px tile, centred on it, and an arm ends on the tile
    // edge where its neighbour's begins: nothing overlaps. Nearest filtering (BootScene).
    wall: {path: 'buildings/walls_v3.png', frameWidth: 64, frameHeight: 64, scale: 0.5, offsetX: 0, originY: 0.5},
    // One sheet per orientation, 8 frames closed to open, each in a 32x48 cell with
    // 5 px of transparent spacing (291 px wide). The art stands on the cell's bottom
    // edge: a horizontal gate fills the bottom 32 px, a vertical one all 48, rising
    // 16 px above its tile. Both anchor bottom-centre on the bottom of their one tile.
    gateHorizontal: {path: 'buildings/gate-horizontal.png', frameWidth: 32, frameHeight: 48, spacing: 5, scale: 1, offsetX: 0, originY: 1},
    gateVertical: {path: 'buildings/gate-vertical.png', frameWidth: 32, frameHeight: 48, spacing: 5, scale: 1, offsetX: 0, originY: 1},
});

const PREFIX = 'papi-art-';

export const artKey = (kind) => `${PREFIX}${kind}`;

export function preloadArt(scene) {
    for (const [kind, {path, frameWidth, frameHeight, spacing = 0, margin = 0}] of Object.entries(ART)) {
        scene.load.spritesheet(artKey(kind), `assets/sprites/${path}`, {frameWidth, frameHeight, spacing, margin});
    }
}

/** Images are only created when their textures have been loaded. */
export function addArt(scene, kind, depth) {
    const definition = ART[kind];
    if (!definition || !scene.textures.exists(artKey(kind))) return null;
    return scene.add.sprite(0, 0, artKey(kind), 0)
        .setOrigin(0.5, definition.originY)
        .setScale(definition.scale)
        .setDepth(depth);
}

export function placeArt(sprite, kind, x, y) {
    if (sprite) sprite.setPosition(x + ART[kind].offsetX, y + (ART[kind].offsetY ?? 0));
}

/** Where a sprite drawn by placeArt shows its doorway, in world pixels, for art that has one. */
export function doorwayAt(kind, sprite) {
    const {doorway, frameWidth, frameHeight, scale} = ART[kind];
    if (!doorway || !sprite) return null;
    return {x: sprite.x + (doorway.x - frameWidth / 2) * scale, y: sprite.y - (frameHeight - doorway.sill) * scale};
}

/** Eight directional turret images: N, NE, E, SE, S, SW, W, NW. */
export function turretFrame(angle) {
    return ((Math.round((angle + Math.PI / 2) / (Math.PI / 4)) % 8) + 8) % 8;
}

export function walkFrame(moving, tick, first = 4) {
    return moving ? first + (Math.floor(tick / 10) % 2) : 0;
}

/** The mutant sheets' attack row (12-17) loops once per actual melee cooldown. */
export function mutantMeleeFrame(attacking, attackTimer, cooldownTicks) {
    if (!attacking) return null;
    const elapsed = Math.max(0, Math.min(cooldownTicks - 1, cooldownTicks - attackTimer));
    return 12 + Math.min(5, Math.floor(elapsed * 6 / cooldownTicks));
}

/** A Spitter animates 12-15 once during its telegraph, never between shots. */
export function spitterSpitFrame(aim, attackTimer, windupTicks) {
    if (!aim) return null;
    const elapsed = Math.max(0, Math.min(windupTicks - 1, windupTicks - attackTimer));
    return 12 + Math.min(3, Math.floor(elapsed * 4 / windupTicks));
}

/** The Barracks role selects its sheet. All three building frames now mean HP damage. */
export function buildingArtKind(building) {
    return building?.type === 'barracks' && building.role === 'rocket' ? 'barracksRocket' : building?.type;
}

/** Presentation only. Night tint and OFF alpha remain independent. */
export function buildingFrame(building, _shift) {
    return damageFrame(building);
}

/** One gameplay shot triggers four purely visual Aseprite action frames (100 ms each). */
export function infantryActionFrame(firedAt, tick) {
    if (!Number.isFinite(firedAt)) return null;
    const age = tick - firedAt;
    return age >= 0 && age < 24 ? 8 + Math.floor(age / 6) : null;
}
