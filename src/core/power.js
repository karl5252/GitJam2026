/**
 * Global power pool (classic Command & Conquer style). Pure — no Phaser,
 * integers only, never mutates its input.
 *
 * Player intent (`enabled`) lives on the building records owned by
 * BuildingPlacement. Everything here is DERIVED on demand from those
 * records; nothing is stored.
 *
 *   generation = sum of power.supply of enabled buildings
 *   demand     = sum of power.demand of enabled buildings
 *   status     = NORMAL     if generation >= demand   (includes 0 / 0)
 *                LOW_POWER  if 0 < generation < demand
 *                BLACKOUT   if generation == 0 and demand > 0
 *
 * Per building `powered` (= operating):
 *   - consumer (demand > 0): enabled AND status NORMAL. LOW_POWER and
 *     BLACKOUT stop ALL consumers — no priorities, no partial allocation.
 *   - anything else (generators, zero-demand buildings): enabled.
 * Disabled buildings neither generate nor draw power and never operate.
 */
import {getBuildingType} from './buildingTypes.js';

export const PowerStatus = Object.freeze({
    NORMAL: 'normal',
    LOW_POWER: 'low-power',
    BLACKOUT: 'blackout',
});

/**
 * @param {Array<{id: string, type: string, enabled?: boolean}>} buildings
 *   `enabled` defaults to true when omitted.
 * @returns {{generation: number, demand: number, status: string,
 *            buildings: Array<{id: string, type: string, enabled: boolean, powered: boolean}>}}
 */
export function calculatePower(buildings) {
    if (!Array.isArray(buildings)) throw new TypeError('buildings must be an array');

    const entries = buildings.map((building) => {
        const type = getBuildingType(building?.type);
        if (!type) throw new TypeError(`Unknown building type: ${building?.type}`);
        return {id: building.id, type, enabled: building.enabled !== false};
    });

    let generation = 0;
    let demand = 0;
    for (const {type, enabled} of entries) {
        if (!enabled) continue;
        generation += type.power.supply;
        demand += type.power.demand;
    }

    const status = generation >= demand
        ? PowerStatus.NORMAL
        : generation > 0 ? PowerStatus.LOW_POWER : PowerStatus.BLACKOUT;

    return {
        generation,
        demand,
        status,
        buildings: entries.map(({id, type, enabled}) => ({
            id,
            type: type.id,
            enabled,
            powered: enabled && (type.power.demand === 0 || status === PowerStatus.NORMAL),
        })),
    };
}
