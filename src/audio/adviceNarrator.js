/**
 * TASK 033.4: El Presidente reads his Presidential Advice aloud. Presentation only.
 *
 * It follows the tip on screen and nothing else: the advice controller (TASK 033.3) has
 * already decided what shows, when, and whether anything blocks it, so this adds no
 * trigger of its own and the tips never wait for it.
 *
 *   a tip appears      its line, once: one chance per tip a run, never queued. If audio is
 *                      locked, muted or missing, or another presidential line still speaks,
 *                      that chance is simply gone; the written tip is the instruction.
 *   the tip goes       dismissed, BOOK, stale, timed out, switched off, or hidden behind a
 *                      modal, La Voz, Game Over or a restart: its line stops at once.
 *
 * A line is the advice tip's `voice` stem, as the event `advice.<stem>`, which speaks only
 * once that event is in the sound map (soundMap.js), with `voice: 'president'`, on the
 * VOICES channel, its files in public/sound/VOICES as OGG and AAC and listed in
 * audio-src/sound/SOUND_MAP.txt. Until then a tip is simply silent.
 */
import {ADVICE} from '../content/advice.js';
import {SOUND_EVENTS} from './soundMap.js';

export const adviceLineEvent = (stem) => `advice.${stem}`;

/** The sound event for a tip's line, or null while its recording is not in the sound map. */
export function presidentialLine(tipId, {catalogue = ADVICE, events = SOUND_EVENTS} = {}) {
    const stem = catalogue.find((tip) => tip.id === tipId)?.voice ?? null;
    if (!stem) return null;
    const name = adviceLineEvent(stem);
    return events[name]?.voice === 'president' ? name : null;
}

export class AdviceNarrator {
    #manager;
    #lineFor;
    #narrated = new Set(); // tips that have had their one chance this run
    #speakingFor = null; // the tip whose line was started, until that tip goes

    /** @param {{speak(name): boolean, silence(): void}} manager the SoundManager */
    constructor(manager, {lineFor = presidentialLine} = {}) {
        this.#manager = manager;
        this.#lineFor = lineFor;
    }

    /** Each frame, with the advice as the controller sees it (`visible`, `tip`). */
    frame(advice) {
        const id = advice?.visible ? advice.tip?.id ?? null : null;
        if (this.#speakingFor !== null && this.#speakingFor !== id) {
            this.#manager.silence();
            this.#speakingFor = null;
        }
        if (id === null || this.#narrated.has(id)) return;
        this.#narrated.add(id);
        const line = this.#lineFor(id);
        if (line && this.#manager.speak(line)) this.#speakingFor = id;
    }

    /** The scene ends: nothing more is said. */
    stop() {
        if (this.#speakingFor !== null) this.#manager.silence();
        this.#speakingFor = null;
    }

    view() {
        return {narrated: [...this.#narrated], speakingFor: this.#speakingFor};
    }
}
