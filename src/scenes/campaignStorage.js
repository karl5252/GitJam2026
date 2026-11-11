/**
 * TASK 043: the one campaign save slot, in localStorage through browserStorage(), next
 * to and never touching `papi_profile`, `papi_advice` and `papi_audio`. Presentation-side
 * persistence: no Phaser, and the simulation never reads it. The checkpoint itself is
 * core/dawnCheckpoint.js; this module only stores, checks and retires it.
 *
 * `papi_campaign` holds {format, version, campaignId, startedAt, savedAt, world, checkpoint}.
 * A campaign's id and start time are fixed when its New Game starts and carried by every
 * save and every Continue. `papi_campaign_ended` lists the ids of campaigns that ended
 * (HQ fell, or the Day 100 ending finished), so no tab can bring one back.
 *
 * Several tabs: a tab writes only its own campaign, and never an older dawn over a newer
 * one; a campaign started later replaces an earlier one at its first dawn (a New Game);
 * an ended campaign is never written again, and never offered as a save. startedAt and
 * savedAt are wall-clock times, for this bookkeeping only: nothing in the game reads them.
 */
import {checkpointProblem} from '../core/dawnCheckpoint.js';

export const CAMPAIGN_KEY = 'papi_campaign';
export const ENDED_KEY = 'papi_campaign_ended';
export const CAMPAIGN_FORMAT = 'papi-campaign';
export const CAMPAIGN_VERSION = 1;
const ENDED_KEPT = 20;

export const SaveFailure = Object.freeze({
    NONE: 'no-save',
    MALFORMED: 'malformed',
    UNSUPPORTED_VERSION: 'unsupported-version',
    INVALID_CHECKPOINT: 'invalid-checkpoint',
    INCOMPATIBLE_WORLD: 'incompatible-world',
    ENDED: 'campaign-ended',
    SUPERSEDED: 'superseded', // another, newer campaign owns the slot
    OLDER: 'older-dawn', // this campaign has already saved a later dawn
    STORAGE: 'storage-failed',
});

const fail = (reason, detail) => ({ok: false, reason, ...(detail ? {detail} : {})});

/** Storage that throws is storage that failed: nothing here ever throws. */
const get = (storage, key) => {
    try {
        return storage?.get(key) ?? null;
    } catch {
        return null;
    }
};
const set = (storage, key, value) => {
    try {
        return storage?.set(key, value) === true;
    } catch {
        return false;
    }
};
const remove = (storage, key) => {
    try {
        return storage?.remove?.(key) === true;
    } catch {
        return false;
    }
};

/** A campaign's identity, at its New Game. */
export function newCampaign(now = Date.now()) {
    const id = globalThis.crypto?.randomUUID?.() ?? `c-${now.toString(36)}-${Math.floor(Math.random() * 2 ** 32).toString(36)}`;
    return {id, startedAt: now};
}

function parse(raw) {
    try {
        return raw ? JSON.parse(raw) : null;
    } catch {
        return undefined; // present, but not JSON
    }
}

/** Ended campaign ids, newest last. Never throws. */
export function endedCampaigns(storage) {
    const list = parse(get(storage, ENDED_KEY));
    return Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [];
}

/** The world a save belongs to, compared whole: a save never lands on another map or seed. */
export const worldOf = ({map, worldSeed, rngSeed}) => ({map: map.id, cols: map.cols, rows: map.rows, worldSeed, rngSeed});

/**
 * The stored save, checked in full before anything is built from it.
 * @param {{get: Function}} storage
 * @param {object | null} world - worldOf(...) of the game that would continue it, or null to skip that check
 * @returns {{ok: true, save: object} | {ok: false, reason: string, detail?: string}}
 */
export function readCampaign(storage, world = null) {
    const raw = get(storage, CAMPAIGN_KEY);
    if (raw === null) return fail(SaveFailure.NONE);
    const save = parse(raw);
    if (!save || typeof save !== 'object' || Array.isArray(save) || save.format !== CAMPAIGN_FORMAT) return fail(SaveFailure.MALFORMED);
    if (save.version !== CAMPAIGN_VERSION) return fail(SaveFailure.UNSUPPORTED_VERSION, String(save.version));
    const keys = ['format', 'version', 'campaignId', 'startedAt', 'savedAt', 'world', 'checkpoint'];
    if (Object.keys(save).length !== keys.length || !keys.every((k) => Object.hasOwn(save, k))) return fail(SaveFailure.MALFORMED, 'fields');
    if (typeof save.campaignId !== 'string' || save.campaignId.length === 0
        || !Number.isSafeInteger(save.startedAt) || !Number.isSafeInteger(save.savedAt)) return fail(SaveFailure.MALFORMED, 'identity');
    const w = save.world;
    if (!w || typeof w.map !== 'string' || ![w.cols, w.rows, w.worldSeed, w.rngSeed].every(Number.isSafeInteger)) return fail(SaveFailure.MALFORMED, 'world');
    const problem = checkpointProblem(save.checkpoint);
    if (problem) return fail(SaveFailure.INVALID_CHECKPOINT, problem);
    if (endedCampaigns(storage).includes(save.campaignId)) return fail(SaveFailure.ENDED);
    if (world && JSON.stringify(world) !== JSON.stringify(w)) return fail(SaveFailure.INCOMPATIBLE_WORLD);
    return {ok: true, save};
}

/**
 * Write this campaign's dawn, if the slot is its to write. Never throws.
 * @param {{get: Function, set: Function}} storage
 * @param {{campaign: {id: string, startedAt: number}, world: object, checkpoint: object, now?: number}} entry
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function writeCampaign(storage, {campaign, world, checkpoint, now = Date.now()}) {
    if (endedCampaigns(storage).includes(campaign.id)) return fail(SaveFailure.ENDED);
    const stored = parse(get(storage, CAMPAIGN_KEY));
    const current = stored && typeof stored === 'object' && typeof stored.campaignId === 'string' ? stored : null; // a broken save is no owner
    if (current && current.campaignId === campaign.id) {
        if (Number.isSafeInteger(current.checkpoint?.day) && current.checkpoint.day > checkpoint.day) return fail(SaveFailure.OLDER);
    } else if (current && Number.isSafeInteger(current.startedAt) && current.startedAt >= campaign.startedAt) {
        return fail(SaveFailure.SUPERSEDED);
    }
    const save = {format: CAMPAIGN_FORMAT, version: CAMPAIGN_VERSION, campaignId: campaign.id, startedAt: campaign.startedAt, savedAt: now, world, checkpoint};
    return set(storage, CAMPAIGN_KEY, JSON.stringify(save)) ? {ok: true} : fail(SaveFailure.STORAGE);
}

/**
 * The campaign is over (HQ fell, or the ending finished): it is never saved or offered
 * again, and its save goes. Another campaign's save is left alone. Never throws.
 * @returns {{removed: boolean, recorded: boolean}}
 */
export function endCampaign(storage, campaignId) {
    const ended = [...endedCampaigns(storage).filter((id) => id !== campaignId), campaignId].slice(-ENDED_KEPT);
    const recorded = set(storage, ENDED_KEY, JSON.stringify(ended));
    const stored = parse(get(storage, CAMPAIGN_KEY));
    const ours = stored?.campaignId === campaignId;
    const removed = ours ? remove(storage, CAMPAIGN_KEY) : false;
    return {removed, recorded};
}
