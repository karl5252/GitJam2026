/**
 * PAPI FORTRESS 22, exactly as the player built it before roads existed.
 * Top-left coordinates, in the order listed by the original investigation.
 *
 * Historical combat benchmark only. It breaks the road rules: two Autocannons
 * sit on the HQ ring and one Factory has no road. It is not a layout snapshot,
 * and it only runs in worlds built without a RoadNetwork. Do not change it to
 * satisfy new placement rules; see ../layouts/fortress22-road-legal.json.
 */
export const FORTRESS_22_EXACT = Object.freeze([
    ['hq', 10, 5],
    ['factory', 6, 1], ['factory', 10, 1],
    ['powerPlant', 6, 5], ['powerPlant', 14, 3], ['powerPlant', 14, 6],
    ['autocannon', 9, 0], ['autocannon', 17, 0], ['autocannon', 5, 4], ['autocannon', 9, 4], ['autocannon', 18, 4],
    ['autocannon', 5, 8], ['autocannon', 9, 8], ['autocannon', 13, 9], ['autocannon', 17, 9],
]);

export const FORTRESS_22_STATE = Object.freeze({night: 22, pollution: 656});
