/**
 * Building definitions — plain frozen data, no Phaser.
 * Footprint sizes are in grid cells. Costs, operations and power are
 * temporary graybox values.
 *
 *   cost:       one-off purchase price
 *   operations: Credits per completed Night Shift (settled at the start of
 *               the next Day): income is added, upkeep is subtracted
 *   power:      supply added to / demand drawn from the single global pool
 *               while the building is enabled (see core/power.js)
 *   pollutionPerNight: added per completed Night Shift while the building is
 *               powered (see core/pollution.js)
 *   maxHp:      starting and maximum hit points
 *   switchable: false means setEnabled rejects it; otherwise it can be toggled
 *
 * HQ comes first, because it is the first thing built. It is an ordinary
 * building to power, settlement and pollution, with extra rules in
 * BuildingPlacement, and losing it ends the run (see ShiftCycle.defeat).
 */
export const HQ_TYPE = 'hq';

export const BUILDING_TYPES = Object.freeze({
    hq: Object.freeze({
        id: HQ_TYPE, name: 'HQ', width: 3, height: 3,
        cost: Object.freeze({credits: 0, ap: 0}),
        operations: Object.freeze({income: 0, upkeep: 0}),
        power: Object.freeze({supply: 20, demand: 0}),
        pollutionPerNight: 0,
        maxHp: 600,
        switchable: false,
    }),
    outpost: Object.freeze({
        id: 'outpost', name: 'Outpost', width: 1, height: 1,
        cost: Object.freeze({credits: 100, ap: 1}),
        operations: Object.freeze({income: 0, upkeep: 20}),
        power: Object.freeze({supply: 0, demand: 10}),
        pollutionPerNight: 0,
        maxHp: 100,
    }),
    factory: Object.freeze({
        id: 'factory', name: 'Factory', width: 3, height: 3,
        cost: Object.freeze({credits: 400, ap: 1}),
        operations: Object.freeze({income: 150, upkeep: 0}),
        power: Object.freeze({supply: 0, demand: 40}),
        pollutionPerNight: 8,
        maxHp: 300,
    }),
    powerPlant: Object.freeze({
        id: 'powerPlant', name: 'Power Plant', width: 3, height: 3,
        cost: Object.freeze({credits: 500, ap: 1}),
        operations: Object.freeze({income: 0, upkeep: 0}),
        power: Object.freeze({supply: 100, demand: 0}),
        pollutionPerNight: 12,
        maxHp: 300,
    }),
    autocannon: Object.freeze({
        id: 'autocannon', name: 'Autocannon', width: 1, height: 1,
        cost: Object.freeze({credits: 250, ap: 1}),
        operations: Object.freeze({income: 0, upkeep: 0}),
        power: Object.freeze({supply: 0, demand: 20}),
        pollutionPerNight: 0,
        maxHp: 150,
    }),
});

/** Definition for a type id, or null if unknown. */
export function getBuildingType(id) {
    return Object.hasOwn(BUILDING_TYPES, id) ? BUILDING_TYPES[id] : null;
}
