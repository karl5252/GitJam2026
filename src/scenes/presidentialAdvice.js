/**
 * TASK 033.3: Presidential Advice, the controller. Pure: no Phaser, no simulation, no
 * game RNG, no wall clock. GameScene feeds it presentation milliseconds, whether anything
 * blocks it (the menu, a held world, La Voz, END DAY's fast-forward, Game Over), and a way
 * to read the facts; it says which tip, if any, shows. It never changes the game.
 *
 *   one at a time    the applicable unseen tip of highest priority
 *   cooldown         ADVICE_TIMING.cooldownMs between tips, urgentMs for an urgent one
 *   settling         a short wait after Start, after anything that blocked it, and after a
 *                    change of shift, so nothing floods in on top of a transition
 *   while blocked    hidden; no time passes for it, and a tip that shows waits behind
 *   stale            a tip no longer applying before it shows is simply not shown; one
 *                    showing goes, counted as seen, because the player has done it
 *   seen             dismissed, BOOK, read for readMs, or done: never before it was shown.
 *                    Kept in localStorage (`papi_advice`, version 1) across restarts.
 */
import {ADVICE} from '../content/advice.js';

export const ADVICE_TIMING = Object.freeze({
    firstMs: 800, // after Start
    settleMs: 1500, // after a block lifts or the shift changes
    cooldownMs: 25000,
    urgentMs: 6000,
    readMs: 6000, // shown this long, it counts as seen even if never dismissed
    showMs: 30000, // and this long, it goes by itself
    evaluateMs: 250, // the facts are read at most this often
    maxStepMs: 250, // a long frame counts as no more than this
});

export const ADVICE_STORAGE_KEY = 'papi_advice';
export const ADVICE_STORAGE_VERSION = 1;

const DEFAULTS = Object.freeze({enabled: true, seen: Object.freeze([])});

/** A saved setting, if it is one: anything else, corrupt or from another version, is ignored. */
export function parseAdviceSettings(raw) {
    try {
        const data = JSON.parse(raw);
        if (data?.version !== ADVICE_STORAGE_VERSION || typeof data.enabled !== 'boolean' || !Array.isArray(data.seen)) return null;
        return {enabled: data.enabled, seen: data.seen.filter((id) => typeof id === 'string')};
    } catch {
        return null;
    }
}

export class PresidentialAdvice {
    #catalogue;
    #storage;
    #forcedOff;
    #timing;
    #enabled = DEFAULTS.enabled;
    #seen = new Set();
    #done = new Set(); // shown this run, whether or not storage keeps it
    #current = null; // {tip, shownMs}
    #blocked = true;
    #unblocked = false; // the first time anything lets it run (Start), it waits firstMs; after that, settleMs
    #settle = 0;
    #sinceLast = Infinity; // unblocked ms since the last tip went
    #sinceRead = Infinity;
    #facts = null;
    #phase = null; // Day 0, Day, Dusk or Night: Day 0 and the first Day differ, though both are 'day'

    /**
     * @param {{catalogue?, storage?: {get(key), set(key, value)} | null, forcedOff?: boolean, timing?}} options
     *   forcedOff - TEST_MODE's ?tips=off: no tips this session, and nothing saved changes
     */
    constructor({catalogue = ADVICE, storage = null, forcedOff = false, timing = ADVICE_TIMING} = {}) {
        this.#catalogue = catalogue;
        this.#storage = storage;
        this.#forcedOff = forcedOff;
        this.#timing = timing;
        const saved = parseAdviceSettings(this.#read());
        if (saved) {
            this.#enabled = saved.enabled;
            this.#seen = new Set(saved.seen);
        }
    }

    /** Tips show this session: the player's setting, unless a test switched them off. */
    get enabled() {
        return this.#enabled && !this.#forcedOff;
    }

    get visible() {
        return this.enabled && this.#current !== null && !this.#blocked;
    }

    /**
     * One presentation frame.
     * @param {number} deltaMs
     * @param {{blocked: boolean, facts: () => object}} world facts is called only when needed
     */
    update(deltaMs, {blocked, facts}) {
        if (!this.enabled) return;
        const dt = Math.min(Math.max(0, deltaMs), this.#timing.maxStepMs);
        if (blocked) {
            this.#blocked = true;
            return;
        }
        if (this.#blocked) { // back from the menu, a modal, La Voz or the fast-forward
            this.#blocked = false;
            this.#settle = Math.max(this.#settle, this.#unblocked ? this.#timing.settleMs : this.#timing.firstMs);
            this.#unblocked = true;
            this.#sinceRead = Infinity;
        }
        this.#sinceRead += dt;
        if (this.#facts === null || this.#sinceRead >= this.#timing.evaluateMs) {
            this.#facts = facts();
            this.#sinceRead = 0;
            const phase = this.#facts.deployment ? 'deployment' : this.#facts.shift;
            if (phase !== this.#phase) {
                if (this.#phase !== null) this.#settle = Math.max(this.#settle, this.#timing.settleMs);
                this.#phase = phase;
            }
        }
        if (this.#current) {
            this.#current.shownMs += dt;
            if (!this.#current.tip.when(this.#facts)) this.#end(); // done by the player
            else if (this.#current.shownMs >= this.#timing.showMs) this.#end();
            else if (this.#current.shownMs >= this.#timing.readMs) this.#markSeen(this.#current.tip.id);
            return;
        }
        this.#sinceLast += dt;
        this.#settle = Math.max(0, this.#settle - dt);
        if (this.#settle > 0) return;
        const next = this.#catalogue
            .filter((tip) => !this.#seen.has(tip.id) && !this.#done.has(tip.id) && tip.when(this.#facts))
            .sort((a, b) => b.priority - a.priority)
            .find((tip) => this.#sinceLast >= (tip.urgent ? this.#timing.urgentMs : this.#timing.cooldownMs));
        if (next) this.#current = {tip: next, shownMs: 0};
    }

    /** The player closed the tip. @returns {boolean} there was one */
    dismiss() {
        if (!this.visible) return false;
        this.#end();
        return true;
    }

    /** BOOK: the tip goes, as seen, and says which page to open. @returns {string | null} the page heading */
    more() {
        if (!this.visible) return null;
        const {book} = this.#current.tip;
        this.#end();
        return book;
    }

    setEnabled(on) {
        this.#enabled = Boolean(on);
        if (!this.#enabled) this.#current = null; // hidden, and not counted as read
        this.#write();
    }

    /** SHOW TIPS AGAIN: everything may show again, this run too, after the usual settling. */
    reset() {
        this.#seen.clear();
        this.#done.clear();
        if (this.#current) this.#current = null;
        this.#sinceLast = Infinity;
        this.#settle = Math.max(this.#settle, this.#timing.settleMs);
        this.#write();
    }

    #end() {
        this.#markSeen(this.#current.tip.id);
        this.#done.add(this.#current.tip.id);
        this.#current = null;
        this.#sinceLast = 0;
    }

    #markSeen(id) {
        if (this.#seen.has(id)) return;
        this.#seen.add(id);
        this.#write();
    }

    #read() {
        try {
            return this.#storage?.get(ADVICE_STORAGE_KEY) ?? null;
        } catch {
            return null;
        }
    }

    #write() {
        if (this.#forcedOff) return; // a test session never changes what a player keeps
        try {
            this.#storage?.set(ADVICE_STORAGE_KEY, JSON.stringify({version: ADVICE_STORAGE_VERSION, enabled: this.#enabled, seen: [...this.#seen]}));
        } catch {
            // blocked storage: the setting lasts for this session only
        }
    }

    /** What the HUD draws and QA reads. */
    view() {
        const tip = this.visible ? this.#current.tip : null;
        return {
            enabled: this.enabled,
            setting: this.#enabled,
            forcedOff: this.#forcedOff,
            visible: tip !== null,
            suppressed: this.#blocked,
            tip: tip ? {id: tip.id, title: tip.title, text: tip.text, book: tip.book, urgent: Boolean(tip.urgent)} : null,
            pending: this.#current && !tip ? this.#current.tip.id : null,
            seen: [...this.#seen],
        };
    }
}
