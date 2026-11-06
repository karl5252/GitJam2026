/**
 * Fog of War. Pure: no Phaser, no randomness, no clock. Nothing in the simulation
 * reads it, so it cannot change combat, targeting or the RNG.
 *
 * What can be seen is the union of every active vision source. A source is
 * {col, row, width, height, radius}: a footprint in tiles, and how many tiles it sees
 * beyond it, circularly. Sources are held in named groups, so a group of moving units
 * and a group of buildings change independently, and a new kind of unit is one more
 * group: unitVision() turns any list of {x, y} into sources. A group only recalculates
 * when its sources differ, so a unit that stays on its tile costs nothing.
 *
 * A tile ever seen stays EXPLORED for the rest of the run. Losing a source only takes
 * away what it alone made VISIBLE.
 *
 * This is about seeing only. A worker's work radius, when there is one, is a separate
 * property and does not belong here.
 */
import {getBuildingType} from './buildingTypes.js';
import {TerrainKind} from './terrain.js';

export const VisionState = Object.freeze({UNEXPLORED: 'unexplored', EXPLORED: 'explored', VISIBLE: 'visible'});

const STATES = Object.freeze([VisionState.UNEXPLORED, VisionState.EXPLORED, VisionState.VISIBLE]);
const GLYPHS = Object.freeze(['#', '~', 'O']);
const UNEXPLORED = 0;
const EXPLORED = 1;
const VISIBLE = 2;

/** Tiles seen beyond a source's footprint. Provisional values. */
export const VISION_RADIUS = Object.freeze({
    unit: 6, // soldiers, and workers when they exist
    building: 6, // HQ, Factory, Plant, Barracks: enough for HQ to see the clearing's core
    turret: 7,
    outpost: 12,
});

const TURRETS = Object.freeze(['autocannon', 'siegeCannon']);
const OUTPOST = 'outpost';

/** @returns {number|null} how far this type sees; null for walls and gates, which do not */
export function visionRadiusOf(typeId) {
    if (getBuildingType(typeId).fortification) return null;
    if (typeId === OUTPOST) return VISION_RADIUS.outpost;
    return TURRETS.includes(typeId) ? VISION_RADIUS.turret : VISION_RADIUS.building;
}

/**
 * Standing buildings see, powered or not, except an Outpost, which is an instrument:
 * it sees only while it is switched on and powered.
 * @param {Array} buildings placement.buildings()
 * @param {{buildings: Array<{id, powered}>}} power calculatePower(buildings)
 */
export function buildingVision(buildings, power) {
    const powered = new Set(power.buildings.filter((b) => b.powered).map((b) => b.id));
    return buildings.flatMap(({id, type, col, row, width, height}) => {
        const radius = visionRadiusOf(type);
        if (radius === null || (type === OUTPOST && !powered.has(id))) return [];
        return [{col, row, width, height, radius}];
    });
}

/** Moving sources, from anything with a world position. */
export function unitVision(units, grid, radius = VISION_RADIUS.unit) {
    return units.flatMap(({x, y}) => {
        const cell = grid.worldToCell(x, y);
        return cell ? [{...cell, width: 1, height: 1, radius}] : [];
    });
}

/** The tiles of walls and gates, which are known to the player but scout nothing. */
export function fortificationTiles(buildings) {
    return buildings.filter(({type}) => visionRadiusOf(type) === null).map(({col, row}) => ({col, row}));
}

/** The clearing and the trees at its edge: where a run begins, before HQ gives it any vision. */
export function startingKnown(terrain) {
    const known = [];
    for (let row = 0; row < terrain.rows; row++) {
        for (let col = 0; col < terrain.cols; col++) {
            let near = false;
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) near ||= terrain.kindAt(col + dc, row + dr) === TerrainKind.CLEARING;
            }
            if (near) known.push({col, row});
        }
    }
    return known;
}

export class FogOfWar {
    #cols;
    #rows;
    #states;
    #groups = new Map(); // name -> {key, sources}
    #revision = 0;

    /** @param {{cols: number, rows: number, explored?: Array<{col, row}>}} config */
    constructor({cols, rows, explored = []}) {
        this.#cols = cols;
        this.#rows = rows;
        this.#states = new Uint8Array(cols * rows);
        for (const {col, row} of explored) this.#states[row * cols + col] = EXPLORED;
    }

    /** Changes whenever any tile may have. */
    get revision() {
        return this.#revision;
    }

    /**
     * Replace a group's sources. Sources from other groups are untouched.
     * @returns {boolean} whether anything was recalculated
     */
    setSources(group, sources) {
        const key = JSON.stringify(sources);
        if ((this.#groups.get(group)?.key ?? '[]') === key) return false; // a group not yet seen has no sources
        this.#groups.set(group, {key, sources});
        this.#recalculate();
        return true;
    }

    /** Tiles the player knows of without anything seeing them. Never makes a tile VISIBLE. */
    markExplored(cells) {
        for (const {col, row} of cells) {
            const index = row * this.#cols + col;
            if (this.#states[index] !== UNEXPLORED) continue;
            this.#states[index] = EXPLORED;
            this.#revision++;
        }
    }

    /** @returns {string|null} a VisionState, or null off the map */
    stateAt(col, row) {
        if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= this.#cols || row >= this.#rows) return null;
        return STATES[this.#states[row * this.#cols + col]];
    }

    isVisible(col, row) {
        return this.stateAt(col, row) === VisionState.VISIBLE;
    }

    /** Detached. Each row is a string: # unexplored, ~ explored, O visible. */
    snapshot() {
        const rows = [];
        const counts = {[VisionState.UNEXPLORED]: 0, [VisionState.EXPLORED]: 0, [VisionState.VISIBLE]: 0};
        for (let row = 0; row < this.#rows; row++) {
            let line = '';
            for (let col = 0; col < this.#cols; col++) {
                const state = this.#states[row * this.#cols + col];
                line += GLYPHS[state];
                counts[STATES[state]]++;
            }
            rows.push(line);
        }
        return {revision: this.#revision, rows, counts};
    }

    #recalculate() {
        for (let i = 0; i < this.#states.length; i++) {
            if (this.#states[i] === VISIBLE) this.#states[i] = EXPLORED;
        }
        for (const {sources} of this.#groups.values()) {
            for (const source of sources) this.#reveal(source);
        }
        this.#revision++;
    }

    /** Whole numbers only, so no engine can round a tile differently. */
    #reveal({col, row, width, height, radius}) {
        const [right, bottom] = [col + width - 1, row + height - 1];
        const [firstRow, lastRow] = [Math.max(row - radius, 0), Math.min(bottom + radius, this.#rows - 1)];
        const [firstCol, lastCol] = [Math.max(col - radius, 0), Math.min(right + radius, this.#cols - 1)];
        for (let r = firstRow; r <= lastRow; r++) {
            const dy = Math.max(row - r, 0, r - bottom);
            for (let c = firstCol; c <= lastCol; c++) {
                const dx = Math.max(col - c, 0, c - right);
                if (dx * dx + dy * dy <= radius * radius) this.#states[r * this.#cols + c] = VISIBLE;
            }
        }
    }
}
