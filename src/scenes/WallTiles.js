import {getBuildingType} from '../core/buildingTypes.js';

/**
 * Presentation-only wall autotiling over `walls_v3.png`: 16 frames of 64x64, one
 * per cardinal connection mask, so the mask is the frame index. Every frame holds
 * its own post, centred at (32, 32), and its arms run to the frame's edges.
 * Nothing here participates in gameplay occupancy, walking or combat.
 */
export const NORTH = 1;
export const EAST = 2;
export const SOUTH = 4;
export const WEST = 8;

const SIDES = Object.freeze([
    {bit: NORTH, dc: 0, dr: -1, axis: 'y'},
    {bit: EAST, dc: 1, dr: 0, axis: 'x'},
    {bit: SOUTH, dc: 0, dr: 1, axis: 'y'},
    {bit: WEST, dc: -1, dr: 0, axis: 'x'},
]);

const key = (col, row) => `${col},${row}`;

/**
 * What each wall or gate tile offers a neighbouring wall: a wall joins on every
 * side; a gate joins only along its barrier, which runs across its passage axis.
 * A Vertical Gate (passage `x`) joins walls north and south, a Horizontal Gate
 * (passage `y`) walls east and west.
 */
export function wallLinks(buildings) {
    const links = new Map();
    for (const {type, col, row} of buildings) {
        if (type === 'wall') links.set(key(col, row), 'wall');
        else {
            const gate = getBuildingType(type)?.gate;
            if (gate) links.set(key(col, row), gate.passageAxis === 'x' ? 'y' : 'x');
        }
    }
    return links;
}

/** The 4-bit N/E/S/W mask, which is the frame index. No diagonals. */
export function wallFrame({col, row}, links) {
    let mask = 0;
    for (const {bit, dc, dr, axis} of SIDES) {
        const link = links.get(key(col + dc, row + dr));
        if (link === 'wall' || link === axis) mask |= bit;
    }
    return mask;
}

/** Frame per wall id for a whole building list. */
export function wallFrames(buildings) {
    const links = wallLinks(buildings);
    const frames = new Map();
    for (const building of buildings) {
        if (building.type === 'wall') frames.set(building.id, wallFrame(building, links));
    }
    return frames;
}
