// testShadow/economyQa.js
//
// TEST_MODE-only Credits controls: window.__qa.economy. A manual testing
// convenience, so a base can be built without playing Nights to fund it. It
// moves the real balance through Economy.adjustCredits and refreshes the HUD.
// AP, buildings, power and production are untouched. Like the rest of the QA
// surface it is added under TEST_MODE, so production builds never contain it.

function assertAmount(name, amount) {
    if (!Number.isSafeInteger(amount)) throw new RangeError(`${name} needs a safe integer, got ${amount}`);
}

/** @param {{economy: import('../core/economy.js').Economy | null, updateHud: () => void}} scene */
export function createEconomyQa(scene) {
    const adjust = (delta) => {
        const {economy} = scene;
        if (!economy) throw new Error('The economy exists after Start');
        if (!Number.isSafeInteger(economy.credits + delta)) throw new RangeError(`Credits would leave the safe range: ${economy.credits} + ${delta}`);
        economy.adjustCredits(delta);
        scene.updateHud();
        return economy.credits;
    };
    return {
        /** Debt is a real game state, so a negative balance is allowed. @returns {number} the new balance */
        setCredits(amount) {
            assertAmount('setCredits', amount);
            if (!scene.economy) throw new Error('The economy exists after Start');
            return adjust(amount - scene.economy.credits);
        },
        /** @returns {number} the new balance */
        addCredits(delta) {
            assertAmount('addCredits', delta);
            return adjust(delta);
        },
    };
}
