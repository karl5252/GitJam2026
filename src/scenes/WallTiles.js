/**
 * Presentation-only wall autotiling over the nine authored junction frames.
 * Frame indices reflect the original 64x260 PNG with 32x26 cells (2 columns).
 * The second column is blank except for the last damaged frame.
 */
export const WALL_FRAME = Object.freeze({
    horizontal: 0,
    vertical: 2,
    upperLeft: 4,       // east + south
    upperRight: 6,      // west + south
    lowerRight: 8,      // west + north
    lowerLeft: 10,      // east + north
    reverseT: 12,       // west + north + east
    tee: 14,            // west + south + east
    cross: 16,
    damaged: 18,
    rubble: 19,
});

/** Returns the visual frame/angle; never participates in gameplay occupancy. */
export function wallAppearance({col, row, hp = 100}, occupied, maxHp = 100) {
    const ratio = maxHp > 0 ? hp / maxHp : 1;
    if (ratio <= 1 / 3) return {frame: WALL_FRAME.rubble, angle: 0};
    if (ratio <= 2 / 3) return {frame: WALL_FRAME.damaged, angle: 0};

    const has = (c, r) => occupied.has(`${c},${r}`);
    const n = has(col, row - 1), e = has(col + 1, row);
    const s = has(col, row + 1), w = has(col - 1, row);
    const count = Number(n) + Number(e) + Number(s) + Number(w);

    if (count === 4) return {frame: WALL_FRAME.cross, angle: 0};
    if (count === 3) {
        if (!n) return {frame: WALL_FRAME.tee, angle: 0};
        if (!s) return {frame: WALL_FRAME.reverseT, angle: 0};
        // Only top/bottom T images were supplied. Rotation covers the other two.
        if (!w) return {frame: WALL_FRAME.reverseT, angle: 90};
        return {frame: WALL_FRAME.reverseT, angle: -90};
    }
    if (count === 2) {
        if (n && s) return {frame: WALL_FRAME.vertical, angle: 0};
        if (e && w) return {frame: WALL_FRAME.horizontal, angle: 0};
        if (n && e) return {frame: WALL_FRAME.lowerLeft, angle: 0};
        if (e && s) return {frame: WALL_FRAME.upperLeft, angle: 0};
        if (s && w) return {frame: WALL_FRAME.upperRight, angle: 0};
        return {frame: WALL_FRAME.lowerRight, angle: 0};
    }
    if (n || s) return {frame: WALL_FRAME.vertical, angle: 0};
    return {frame: WALL_FRAME.horizontal, angle: 0};
}
