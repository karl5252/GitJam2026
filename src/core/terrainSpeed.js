/**
 * How fast people walk on each kind of ground. Pure data and arithmetic: no
 * Phaser, no state.
 *
 * Applies to HQ workers and to rifle and rocket infantry only. Mutants and
 * trucks keep their own speeds: trucks drive on roads anyway, and mutant
 * movement is unchanged.
 *
 * Multipliers of a unit's base speed. Constructed roads and the HQ ring are
 * ROAD (GDD v0.3: x1.2). Open ground, including the jungle map's dirt track,
 * which is not a constructed road, is OPEN. Dense jungle is JUNGLE; its 0.65 is
 * provisional. Change the numbers here and nowhere else.
 */
export const Ground = Object.freeze({OPEN: 0, ROAD: 1, JUNGLE: 2});

export const TERRAIN_SPEED = Object.freeze({
    [Ground.OPEN]: 1.0,
    [Ground.ROAD]: 1.2,
    [Ground.JUNGLE]: 0.65,
});

/**
 * What lies under a tile for walking. Roads win over terrain, but a road is
 * never laid on jungle anyway.
 * @param {{col: number, row: number}} cell
 * @param {{roads?: {has: Function} | null, terrain?: {kindAt: Function} | null}} ground
 */
export function groundAt(cell, {roads = null, terrain = null} = {}) {
    if (roads?.has(cell)) return Ground.ROAD;
    if (terrain?.kindAt(cell.col, cell.row) === 'jungle') return Ground.JUNGLE;
    return Ground.OPEN;
}

/** px per tick on this ground, for a unit whose base speed is `base`. */
export const speedOn = (ground, base) => base * TERRAIN_SPEED[ground];

/**
 * Whole ticks to cross half a tile of this ground at the base speed of 1 px per
 * tick, rounded up, so the walk field is integers. Open ground is exactly 16 for
 * a 32 px tile, so a field over open ground is the old tile count times 32.
 */
export const halfTileTicks = (ground, tileSize) => Math.ceil(tileSize / 2 / TERRAIN_SPEED[ground]);

/**
 * Move a point towards `goal` along one axis at a time, at most `speed` px, and
 * land on the goal exactly. With integer positions and a speed of 1 this is the
 * old whole-pixel step.
 */
export function approach(unit, {x, y}, speed) {
    if (unit.x !== x) unit.x = x > unit.x ? Math.min(x, unit.x + speed) : Math.max(x, unit.x - speed);
    else if (unit.y !== y) unit.y = y > unit.y ? Math.min(y, unit.y + speed) : Math.max(y, unit.y - speed);
}
