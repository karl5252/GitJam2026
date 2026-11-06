// testShadow/dayQa.js
//
// TEST_MODE-only calendar control: window.__qa.sim.setDay(n). A manual testing
// convenience, so a late Night can be reached without playing the ones before
// it. It moves the real day through ShiftCycle.jumpToDay, during a Day only, and
// refreshes the shift UI. Nothing else changes: buildings, flags, Credits, AP,
// power and pollution stay as they are, and skipped Nights earn and spawn nothing.
// The next wave is planned from the real day and the real pollution. Like the
// rest of the QA surface it is added under TEST_MODE, so production builds never
// contain it.

/**
 * @param {{cycle: import('../core/shiftCycle.js').ShiftCycle | null, syncShiftUi: () => void}} scene
 * @returns {(day: number) => number} sets the day and returns it
 */
export function createSetDay(scene) {
    return (day) => {
        if (!scene.cycle) throw new Error('The day exists after Start');
        const result = scene.cycle.jumpToDay(day);
        if (!result.ok) throw new Error(`setDay works during Day Shift only: ${result.reason}`);
        scene.syncShiftUi();
        return scene.cycle.day;
    };
}
