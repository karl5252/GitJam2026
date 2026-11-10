// testShadow/endingQa.js
//
// TASK 036, TEST_MODE only: window.__qa.ending. The Day 100 ending is reached through
// the real rule: trigger() moves the calendar to HUD Day 100 through ShiftCycle.jumpToDay
// (as __qa.sim.setDay does), during a timed Day, and the next frame starts the ending as
// play would. seek(ms) jumps the ceremony's timeline, for pictures and cue checks.
// setSeen/seen read and write the real profile record, for menu and newspaper tests.
// Like the rest of the QA surface it exists only under TEST_MODE.

import {browserStorage} from '../audio/SoundManager.js';
import {ENDING_CALENDAR_DAY} from '../scenes/presidentialEnding.js';
import {endingSeen, setEndingSeen} from '../scenes/profile.js';

export function createEndingQa(scene) {
    return {
        /** HUD Day 100, from a timed Day. Throws outside one, as setDay does. */
        trigger() {
            if (!scene.cycle?.timed || scene.cycle.deployment) throw new Error('The ending needs a timed Day: end Day 0 first');
            const result = scene.cycle.jumpToDay(ENDING_CALENDAR_DAY);
            if (!result.ok) throw new Error(`trigger works during Day Shift only: ${result.reason}`);
            scene.syncShiftUi();
            return scene.cycle.day;
        },
        seek(ms) {
            if (!scene.scene.isActive('ending')) throw new Error('No ending is playing');
            return scene.scene.get('ending').seek(ms);
        },
        seen: () => endingSeen(browserStorage()),
        setSeen: (seen) => setEndingSeen(browserStorage(), seen),
    };
}
