/**
 * Office-only art. Gameplay sprites and their frame indices are deliberately
 * independent of these menu assets. All dimensions are the source PNG sizes.
 */
const ROOT = 'assets/sprites/menu-office/';
const PREFIX = 'papi-office-';

const IMAGES = Object.freeze({
    wallTop: 'wall-top.png',
    wallBottom: 'wall-bottom.png',
    floor: 'floor-parquet.png',
    rug: 'rug.png',
    desk: 'desk.png',
    portrait: 'portrait-colonel.png',
    // TASK 036: after the Day 100 ending (papi_profile), the portrait is this one.
    mutantPortrait: 'portrait-mutant.png',
});

const SHEETS = Object.freeze({
    flag: {path: 'flag-sheet.png', frameWidth: 32, frameHeight: 64}, // 3 frames
    phone: {path: 'phone-sheet.png', frameWidth: 51, frameHeight: 50}, // 8 frames, flying handset
    colonel: {path: 'el-colonel-menu-sheet.png', frameWidth: 64, frameHeight: 56}, // authored 7x4 grid
    // TASK 036: 76x48, two 38x48 frames: 0 intact, 1 bitten (after the Day 100 ending).
    bust: {path: 'bust-gold.png', frameWidth: 38, frameHeight: 48},
    // TASK 036.1: 64x44, two 32x44 frames: 0 the globe, 1 bitten (after the Day 100 ending).
    globe: {path: 'globe.png', frameWidth: 32, frameHeight: 44},
});

/** TASK 036: the menu as the profile has it. The same flag drives all of it, and nothing else. */
export const officeArtFor = (endingSeen) => Object.freeze({
    portrait: endingSeen ? 'mutantPortrait' : 'portrait',
    bustFrame: endingSeen ? 1 : 0,
    globeFrame: endingSeen ? 1 : 0, // TASK 036.1
    colonel: !endingSeen, // El Colonel no longer patrols his office
});

export const OFFICE = Object.freeze(Object.fromEntries(
    [...Object.keys(IMAGES), ...Object.keys(SHEETS)].map((name) => [name, `${PREFIX}${name}`]),
));

export function preloadOfficeArt(scene) {
    for (const [name, filename] of Object.entries(IMAGES)) {
        scene.load.image(OFFICE[name], ROOT + filename);
    }
    for (const [name, {path, frameWidth, frameHeight}] of Object.entries(SHEETS)) {
        scene.load.spritesheet(OFFICE[name], ROOT + path, {frameWidth, frameHeight});
    }
}

/** Keep the supplied pixel art sharp when Phaser's fixed canvas is fitted to a display. */
export function filterOfficeArt(scene, nearest) {
    if (nearest === undefined) return;
    for (const key of Object.values(OFFICE)) {
        if (scene.textures.exists(key)) scene.textures.get(key).setFilter?.(nearest);
    }
}
