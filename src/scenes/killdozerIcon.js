/**
 * The DESTROY button's icon. Pure data and arithmetic, so it can be tested without
 * Phaser. Presentation only.
 */

/** The Killdozer demolition icon: a 48x48 PNG whose vehicle covers x 3..44, y 5..38. */
export const KILLDOZER = Object.freeze({
    key: 'papi-ui-killdozer',
    path: 'assets/sprites/ui/killdozer.png',
    visible: Object.freeze({x: 3, y: 5, width: 42, height: 34}),
    fit: 40, // the icon's visible bounds inside a 48 px button
});

/** Scale and origin that fit the vehicle, not its transparent padding, into `fit` px, centred. */
export function killdozerPlacement(size = 48) {
    const {visible, fit} = KILLDOZER;
    const scale = fit / Math.max(visible.width, visible.height);
    return {scale, originX: (visible.x + visible.width / 2) / size, originY: (visible.y + visible.height / 2) / size};
}
