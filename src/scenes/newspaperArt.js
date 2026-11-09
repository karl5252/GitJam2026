/**
 * TASK 029: the newspaper's photographs. An edition names a photo by asset id
 * (src/content/newspaper.js); this is the only place an id becomes a texture, so a
 * later edition can name another portrait (the bitten one after Night 99) without
 * touching NewspaperLayer. Loaded by BootScene, kept sharp with NEAREST filtering.
 */
export const NEWSPAPER_PHOTOS = Object.freeze({
    'el-papi': Object.freeze({key: 'papi-news-el-papi', path: 'assets/sprites/ui/newspaper_portrait.png'}), // 64x96, grayscale
});

export function preloadNewspaperArt(scene) {
    for (const {key, path} of Object.values(NEWSPAPER_PHOTOS)) scene.load.image(key, path);
}

export function filterNewspaperArt(scene, nearest) {
    if (nearest === undefined) return;
    for (const {key} of Object.values(NEWSPAPER_PHOTOS)) {
        if (scene.textures.exists(key)) scene.textures.get(key).setFilter?.(nearest);
    }
}
