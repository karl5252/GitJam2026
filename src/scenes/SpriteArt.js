/**
 * Presentation-only sprite metadata. Source PNG frames are kept at their authored
 * sizes: there is deliberately no shared frame height or canvas-wide resizing.
 * Changes here must never feed collision, movement, targeting or world visibility.
 */
export const ART = Object.freeze({
    worker: {path: 'units/worker.png', frameWidth: 45, frameHeight: 40, scale: 0.5, offsetX: 3.5, originY: 0.95},
    rifleman: {path: 'units/rifleman.png', frameWidth: 45, frameHeight: 40, scale: 0.5, offsetX: 0.5, originY: 0.95},
    rocketman: {path: 'units/rocketman.png', frameWidth: 45, frameHeight: 40, scale: 0.5, offsetX: 3, originY: 0.95},
    runner: {path: 'mutants/runner.png', frameWidth: 32, frameHeight: 39, scale: 0.95, offsetX: 0, originY: 0.95},
    spitter: {path: 'mutants/spitter.png', frameWidth: 32, frameHeight: 39, scale: 1, offsetX: 0, originY: 0.95},
    brute: {path: 'mutants/brute.png', frameWidth: 32, frameHeight: 39, scale: 1, offsetX: 0, originY: 0.95},
    truck: {path: 'vehicles/truck.png', frameWidth: 24, frameHeight: 14, scale: 1, offsetX: 0, originY: 1},
    autocannon: {path: 'turrets/autocannon.png', frameWidth: 32, frameHeight: 32, scale: 1, offsetX: 0, originY: 0.5},
    siegeCannon: {path: 'turrets/siege-cannon.png', frameWidth: 32, frameHeight: 35, scale: 2, offsetX: 0, originY: 0.5},
    // Each building occupies a 3x3 tile footprint (96x96); the art keeps its own ratio.
    hq: {path: 'buildings/hq.png', frameWidth: 32, frameHeight: 40, scale: 2.25, offsetX: 0, originY: 1},
    barracks: {path: 'buildings/barracks.png', frameWidth: 32, frameHeight: 29, scale: 2.7, offsetX: 0, originY: 1},
    factory: {path: 'buildings/factory.png', frameWidth: 32, frameHeight: 32, scale: 2.65, offsetX: 0, originY: 1},
    powerPlant: {path: 'buildings/power-plant.png', frameWidth: 32, frameHeight: 34, scale: 2.55, offsetX: 0, originY: 1},
    wall: {path: 'buildings/walls.png', frameWidth: 32, frameHeight: 32, scale: 1, offsetX: 0, originY: 0.5},
    gate: {path: 'buildings/gate-regular.png', frameWidth: 32, frameHeight: 32, scale: 1, offsetX: 0, originY: 0.5},
});

const PREFIX = 'papi-art-';

export const artKey = (kind) => `${PREFIX}${kind}`;

export function preloadArt(scene) {
    for (const [kind, {path, frameWidth, frameHeight}] of Object.entries(ART)) {
        scene.load.spritesheet(artKey(kind), `assets/sprites/${path}`, {frameWidth, frameHeight});
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
    if (sprite) sprite.setPosition(x + ART[kind].offsetX, y);
}

/** Eight directional turret images: N, NE, E, SE, S, SW, W, NW. */
export function turretFrame(angle) {
    return ((Math.round((angle + Math.PI / 2) / (Math.PI / 4)) % 8) + 8) % 8;
}

export function walkFrame(moving, tick, first = 4) {
    return moving ? first + (Math.floor(tick / 10) % 2) : 0;
}

/** Building art decisions are presentation-only. No time or combat rules change. */
export function buildingFrame(building, shift) {
    if (building.type === 'hq') return shift === 'night' ? 1 : 0;
    if (building.type === 'barracks') return building.role === 'rocket' ? 1 : 0;
    if (building.type === 'powerPlant') return building.enabled ? 1 : 0;
    return 0;
}

/** One gameplay shot triggers four purely visual Aseprite action frames (100 ms each). */
export function infantryActionFrame(firedAt, tick) {
    if (!Number.isFinite(firedAt)) return null;
    const age = tick - firedAt;
    return age >= 0 && age < 24 ? 8 + Math.floor(age / 6) : null;
}
