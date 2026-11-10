/**
 * TASK 032: why the world is not being fed frames right now. Pure, no Phaser.
 *
 * GameScene already stopped feeding the fixed-step clock while a phone was turned to
 * portrait, without touching the clock's speed or pause: the run comes back exactly
 * as it was, no tick skipped and none made up. The AUDIO panel and the BUILD drawer
 * use the same suspension, each as its own named reason, so closing one can never
 * resume what another still holds, and none of them can undo the player's own PAUSE
 * (which is the clock's, and stays untouched). The world runs only with no reason.
 *
 * This is not the paused Day: that one refuses gameplay commands (`game-paused`),
 * and a building chosen from the drawer must still be placeable at once.
 */
export const SuspendReason = Object.freeze({
    ORIENTATION: 'orientation',
    AUDIO: 'audio',
    BUILD: 'build',
    MANUAL: 'manual', // TASK 033.1: THE LITTLE YELLOW BOOK
    CINEMATIC: 'cinematic', // TASK 035: the Presidential helicopter; GameScene's own, never the HUD's
});

const KNOWN = new Set(Object.values(SuspendReason));

export class Suspension {
    #reasons = new Set();

    /** Add or remove one reason. Unknown reasons are ignored. Returns whether anything changed. */
    set(reason, on) {
        if (!KNOWN.has(reason)) return false;
        const had = this.#reasons.has(reason);
        if (on) this.#reasons.add(reason);
        else this.#reasons.delete(reason);
        return had !== Boolean(on);
    }

    has(reason) {
        return this.#reasons.has(reason);
    }

    get active() {
        return this.#reasons.size > 0;
    }

    clear() {
        this.#reasons.clear();
    }

    /** Sorted, so QA reads the same list whatever the order of events. */
    reasons() {
        return [...this.#reasons].sort();
    }
}
