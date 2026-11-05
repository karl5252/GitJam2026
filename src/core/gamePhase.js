/**
 * Top-level game phase. Pure — no Phaser — so it is unit-testable in Node.
 */
export const GamePhase = Object.freeze({
    READY: 'ready',
    STARTED: 'started',
    DEFEATED: 'defeated',
});

/**
 * Transition triggered by the Start button. Idempotent: only READY moves
 * to STARTED; any other phase is returned unchanged.
 */
export function startGame(phase) {
    return phase === GamePhase.READY ? GamePhase.STARTED : phase;
}

/** HQ was destroyed. Only a started run can be lost; restart begins a new READY. */
export function defeatGame(phase) {
    return phase === GamePhase.STARTED ? GamePhase.DEFEATED : phase;
}
