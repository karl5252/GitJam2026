/**
 * Cosmetic damage rules for Green Shift. HP is owned by the domain; this module
 * only selects a sprite frame and the small looping FX played above it.
 * 0 = pristine, 1 = damaged, 2 = critical. Both thresholds are easy to tune.
 */
import {getBuildingType} from '../core/buildingTypes.js';

export const DAMAGE_THRESHOLDS = Object.freeze({damaged: 0.70, critical: 0.35});

export function damageFrame(building) {
    const maxHp = getBuildingType(building?.type)?.maxHp;
    if (!Number.isFinite(building?.hp) || !Number.isFinite(maxHp) || maxHp <= 0) return 0;
    const share = building.hp / maxHp;
    if (share <= DAMAGE_THRESHOLDS.critical) return 2;
    if (share <= DAMAGE_THRESHOLDS.damaged) return 1;
    return 0;
}

/** Eight 16-pixel-wide frames, in a single row, at the supplied native sizes. */
export const BUILDING_FX_SHEETS = Object.freeze({
    weldingSparks: Object.freeze({path: 'effects/welding-sparks.png', frameWidth: 16, frameHeight: 16}),
    electricSparks: Object.freeze({path: 'effects/electric-sparks.png', frameWidth: 16, frameHeight: 18}),
    fire: Object.freeze({path: 'effects/fire.png', frameWidth: 16, frameHeight: 16}),
});
export const BUILDING_FX_FRAMES = 8;
export const BUILDING_FX_TICKS_PER_FRAME = 6; // 10 fps at the fixed 60 Hz tick rate

const NONE = Object.freeze([]);
const FX_BY_TYPE = Object.freeze({
    barracks: Object.freeze({1: Object.freeze(['fire']), 2: Object.freeze(['fire'])}),
    factory: Object.freeze({1: Object.freeze(['weldingSparks']), 2: Object.freeze(['weldingSparks', 'fire'])}),
    powerPlant: Object.freeze({1: Object.freeze(['electricSparks']), 2: Object.freeze(['electricSparks', 'fire'])}),
    hq: Object.freeze({1: Object.freeze(['electricSparks']), 2: Object.freeze(['electricSparks', 'fire'])}),
    loudspeaker: Object.freeze({1: Object.freeze(['weldingSparks']), 2: Object.freeze(['weldingSparks'])}),
    outpost: Object.freeze({1: Object.freeze(['fire']), 2: Object.freeze(['fire'])}),
    autocannon: Object.freeze({1: Object.freeze(['electricSparks']), 2: Object.freeze(['fire'])}),
    siegeCannon: Object.freeze({1: Object.freeze(['electricSparks']), 2: Object.freeze(['fire'])}),
    // Mine, walls and gates have damage frames or their existing art only, until
    // their own visual treatment has been chosen. No speculative flames here.
});

export function buildingFxKinds(building) {
    return FX_BY_TYPE[building?.type]?.[damageFrame(building)] ?? NONE;
}

/** The loudspeaker's red bulb is lit only if it is intact, ON and powered. */
export function speakerLampOn(building, poweredIds) {
    return building?.type === 'loudspeaker' && building.enabled === true &&
        damageFrame(building) === 0 && Boolean(poweredIds?.has(building.id));
}

/** Per-id offset avoids every damaged building pulsing in perfect synchrony. */
export function buildingFxFrame(tick, buildingId, kind) {
    const seed = `${buildingId}:${kind}`;
    let offset = 0;
    for (let i = 0; i < seed.length; i++) offset = (offset * 31 + seed.charCodeAt(i)) % (BUILDING_FX_FRAMES * BUILDING_FX_TICKS_PER_FRAME);
    return Math.floor((Math.max(0, tick) + offset) / BUILDING_FX_TICKS_PER_FRAME) % BUILDING_FX_FRAMES;
}
