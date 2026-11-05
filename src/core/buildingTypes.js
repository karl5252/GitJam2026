/**
 * Building definitions — plain frozen data, no Phaser.
 * Footprint sizes are in grid cells. Costs, operations and power are
 * temporary graybox values.
 *
 *   cost:       one-off purchase price
 *   operations: Credits per completed Night Shift (settled at the start of
 *               the next Day): income is added, upkeep is subtracted. Factories
 *               earn through deliveries instead (see core/logistics.js)
 *   power:      supply added to / demand drawn from the single global pool
 *               while the building is enabled (see core/power.js)
 *   pollutionPerNight: added per completed Night Shift while the building is
 *               powered (see core/pollution.js)
 *   maxHp:      starting and maximum hit points
 *   switchable: false means setEnabled rejects it; otherwise it can be toggled
 *   fortification: a passive barrier. It blocks mutants, who attack it only when
 *               it is in their way: it is never a target and does not displace
 *               a spawn. It can be demolished during Day.
 *   gate:       {tier, orientation, passageAxis}, on gate types only. A gate
 *               stands on a road. passageAxis is the direction of travel it
 *               lets through ('x' is east-west); core/gates.js runs every gate
 *               with one state machine
 *
 * HQ comes first, because it is the first thing built. It is an ordinary
 * building to power, settlement and pollution, with extra rules in
 * BuildingPlacement, and losing it ends the run (see ShiftCycle.defeat).
 */
export const HQ_TYPE = 'hq';
export const WALL_TYPE = 'wall';

const NO_OPERATIONS = Object.freeze({income: 0, upkeep: 0});
const NO_POWER = Object.freeze({supply: 0, demand: 0});

/** Everything that differs between gate tiers. A new tier is one more row here. */
const GATE_TIERS = Object.freeze({
    standard: Object.freeze({idPrefix: 'gate', namePrefix: '', cost: Object.freeze({credits: 100, ap: 1}), maxHp: 150}),
});

/** A Vertical Gate is a vertical barrier: it crosses an east-west road. */
const GATE_ORIENTATIONS = Object.freeze({
    Vertical: Object.freeze({orientation: 'vertical', passageAxis: 'x'}),
    Horizontal: Object.freeze({orientation: 'horizontal', passageAxis: 'y'}),
});

function gateTypes() {
    const types = {};
    for (const [tier, {idPrefix, namePrefix, cost, maxHp}] of Object.entries(GATE_TIERS)) {
        for (const [suffix, {orientation, passageAxis}] of Object.entries(GATE_ORIENTATIONS)) {
            const id = `${idPrefix}${suffix}`;
            types[id] = Object.freeze({
                id, name: `${namePrefix}${suffix} Gate`, width: 1, height: 1,
                cost,
                operations: NO_OPERATIONS,
                power: NO_POWER,
                pollutionPerNight: 0,
                maxHp,
                switchable: false,
                fortification: true,
                gate: Object.freeze({tier, orientation, passageAxis}),
            });
        }
    }
    return types;
}

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
        operations: Object.freeze({income: 0, upkeep: 0}),
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
    wall: Object.freeze({
        id: WALL_TYPE, name: 'Wall', width: 1, height: 1,
        cost: Object.freeze({credits: 25, ap: 0}),
        operations: NO_OPERATIONS,
        power: NO_POWER,
        pollutionPerNight: 0,
        maxHp: 100,
        switchable: false,
        fortification: true,
    }),
    ...gateTypes(),
});

/** Definition for a type id, or null if unknown. */
export function getBuildingType(id) {
    return Object.hasOwn(BUILDING_TYPES, id) ? BUILDING_TYPES[id] : null;
}
