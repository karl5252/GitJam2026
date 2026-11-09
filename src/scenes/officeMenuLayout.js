/**
 * Office composition in the same 1280x720 logical canvas as HUDScene.
 * Phaser FIT handles the actual device resolution. Mobile landscape deliberately
 * crops the office to the important objects rather than squeezing everything in.
 * This module is pure so its coordinates can be regression tested without Phaser.
 */
/** Source size of a wall tile, and how many rows below the header use WALL A. */
const WALL_TILE = 32;
const WALL_A_ROWS = 2;

export function officeMenuLayout({width = 1280, height = 720, touch = false} = {}) {
    const k = Math.min(width / 1280, height / 720);
    const x = (n) => Math.round((width * n) / 1280);
    const y = (n) => Math.round((height * n) / 720);
    const at = (px, py, scale) => ({x: x(px), y: y(py), scale: scale * k});
    const wallRow = Math.round(WALL_TILE * 4 * k); // one wall tile row, in logical px

    return {
        touch,
        width,
        height,
        tileScale: 4 * k,
        // The wall counts whole tile rows (32 source px at tileScale): the first
        // two below the header are WALL A (wall-top), every row after is WALL B.
        wallTop: {top: y(96), height: WALL_A_ROWS * wallRow},
        wallBottom: {top: y(96) + WALL_A_ROWS * wallRow, height: y(384) - y(96) - WALL_A_ROWS * wallRow},
        floor: {top: y(384), height: height - y(384)},
        headerHeight: y(96),
        portrait: at(640, touch ? 225 : 228, touch ? 1.55 : 1.35),
        // A rug is intentionally a full image, not forced into floor tiling.
        rug: at(640, 640, 4.4),
        desk: at(640, touch ? 552 : 540, touch ? 3.4 : 3.05),
        // The desk image has transparent top rows. Its visible tabletop starts
        // about 49 source px above the bottom, so both tabletop props sit at
        // y~=390 rather than appearing glued to the desk front.
        phone: at(touch ? 543 : 547, touch ? 389 : 390, touch ? 1.65 : 1.55),
        globe: at(390, 525, 3.05),
        bust: at(804, 390, 2.4),
        flags: [at(436, 245, 2.1), at(844, 245, 2.1)],
        colonel: at(640, touch ? 584 : 590, touch ? 2.55 : 2.65),
    };
}
