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
    // Reserved for a future save/progression flag. No automatic portrait swap.
    mutantPortrait: 'portrait-mutant.png',
    globe: 'globe.png',
    bust: 'bust-gold.png',
});

const SHEETS = Object.freeze({
    flag: {path: 'flag-sheet.png', frameWidth: 32, frameHeight: 64}, // 3 frames
    phone: {path: 'phone-sheet.png', frameWidth: 51, frameHeight: 50}, // 8 frames, flying handset
    colonel: {path: 'el-colonel-menu-sheet.png', frameWidth: 64, frameHeight: 56}, // authored 7x4 grid
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
