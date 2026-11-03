/**
 * Building definitions — plain frozen data, no Phaser.
 * Footprint sizes are in grid cells. Costs are temporary graybox values.
 */
export const BUILDING_TYPES = Object.freeze({
    outpost: Object.freeze({
        id: 'outpost', name: 'Outpost', width: 1, height: 1,
        cost: Object.freeze({credits: 100, ap: 1}),
    }),
    factory: Object.freeze({
        id: 'factory', name: 'Factory', width: 3, height: 3,
        cost: Object.freeze({credits: 400, ap: 1}),
    }),
});

/** Definition for a type id, or null if unknown. */
export function getBuildingType(id) {
    return Object.hasOwn(BUILDING_TYPES, id) ? BUILDING_TYPES[id] : null;
}
