/**
 * TASK 036: the player's profile, one small versioned record in localStorage under
 * `papi_profile`, through SoundManager's browserStorage() like `papi_audio` and
 * `papi_advice`. It holds one fact so far: the Day 100 ending has been seen. Nothing in
 * the simulation reads it; only presentation does (the menu's bust, portrait and El
 * Colonel, and La Voz's photograph). Blocked or corrupt storage reads as a new player
 * and only costs persistence.
 */
export const PROFILE_KEY = 'papi_profile';
export const PROFILE_VERSION = 1;

const FRESH = Object.freeze({version: PROFILE_VERSION, presidentialEndingSeen: false});

/** The profile as stored, or a new player's. Never throws. */
export function loadProfile(storage) {
    try {
        const raw = storage?.get(PROFILE_KEY);
        if (!raw) return {...FRESH};
        const data = JSON.parse(raw);
        if (!data || data.version !== PROFILE_VERSION) return {...FRESH};
        return {...data, version: PROFILE_VERSION, presidentialEndingSeen: data.presidentialEndingSeen === true};
    } catch {
        return {...FRESH};
    }
}

/** Is the ending seen? The one question presentation asks. */
export const endingSeen = (storage) => loadProfile(storage).presidentialEndingSeen;

/**
 * Set or clear the flag, keeping anything else in the record and touching no other key.
 * @returns {boolean} whether it was stored
 */
export function setEndingSeen(storage, seen) {
    try {
        if (!storage) return false;
        storage.set(PROFILE_KEY, JSON.stringify({...loadProfile(storage), presidentialEndingSeen: Boolean(seen)}));
        return true;
    } catch {
        return false;
    }
}
