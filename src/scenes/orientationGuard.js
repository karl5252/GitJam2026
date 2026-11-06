/**
 * Landscape only, on touch devices. Portrait play is not supported.
 *
 * The screen is a DOM element, so it stays responsive whatever the game is doing.
 * While it shows, GameScene stops feeding frames to the clock and ignores input.
 * That is all suspension is: the clock's own speed and pause state are never
 * touched, so a run that was paused comes back paused. No fullscreen or orientation
 * lock is needed, and a desktop window can be any shape.
 */

/** Pure, so it can be tested without a browser. */
export const isPortraitBlocked = ({coarsePointer, width, height}) => coarsePointer && height > width;

let blocked = false;

/** Is the game waiting for the device to turn? */
export const isOrientationBlocked = () => blocked;

function refresh(game) {
    const next = isPortraitBlocked({
        coarsePointer: window.matchMedia('(pointer: coarse)').matches,
        width: window.innerWidth,
        height: window.innerHeight,
    });
    const screen = document.getElementById('orientation-guard');
    if (screen) screen.hidden = !next;
    document.body.dataset.orientation = next ? 'blocked' : 'ok';
    if (next === blocked) return;
    blocked = next;
    if (!next) game.scale.refresh();
}

/** Browsers report turning and toolbar changes in different ways, so listen to all of them. */
export function installOrientationGuard(game) {
    const update = () => refresh(game);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.visualViewport?.addEventListener('resize', update);
    update();
}
