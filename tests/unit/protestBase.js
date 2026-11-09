/**
 * A jungle base for the TASK 027 tests: HQ in the clearing, a Factory west of it
 * whose dock road joins the HQ ring, and a Plant to power it, all bought through
 * the real rules, in the ACTIVE cycle with protesters on.
 */
import assert from 'node:assert/strict';
import {Shift} from '../../src/core/shiftCycle.js';
import {WORLD_MAPS, createTerrain} from '../../src/core/worldMap.js';
import {createWorld} from '../soak/harness.js';

export const MAP = WORLD_MAPS.jungle;

/** Factory at 16..18 x 16..18, dock 19,17, road 19,17 and 20,17 to the HQ ring at 21,17. */
export function protestBase({pollution = 0, schedule = [], rng = null, factory = true, ecologists = true} = {}) {
    const terrain = createTerrain(MAP, MAP.seed);
    const w = createWorld({requireHq: true, roads: true, resources: {credits: 9000, ap: 40}, schedule, rng, active: true, map: MAP, terrain, ecologists, pollution});
    const {center} = terrain;
    assert.equal(w.place('hq', center.col, center.row).ok, true);
    assert.equal(w.place('powerPlant', center.col + 5, center.row).ok, true);
    const road = [{col: center.col - 3, row: center.row}, {col: center.col - 4, row: center.row}];
    for (const cell of road) assert.equal(w.placement.placeRoad(cell).ok, true, JSON.stringify(cell));
    if (factory) assert.equal(w.place('factory', center.col - 6, center.row).ok, true);
    return {w, terrain, site: road[0], dock: road[1]};
}

export function run(w, ticks, onTick = () => {}) {
    for (let i = 0; i < ticks && w.cycle.active; i++) {
        if (w.cycle.stepTicks(1, w.tick) === 0) break;
        if (onTick(i) === true) break;
    }
}

/** Day 0, Dusk and Night 1, to the first tick of the first timed Day. */
export function toFirstDay(w) {
    w.cycle.endDay();
    while (w.cycle.shift !== Shift.DAY) w.cycle.stepTicks(1, w.tick);
}
