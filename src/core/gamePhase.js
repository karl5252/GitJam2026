/**
 * Top-level game phase. Pure — no Phaser — so it is unit-testable in Node.
 */
export const GamePhase = Object.freeze({
    READY: 'ready',
    STARTED: 'started',
});

/**
 * Transition triggered by the Start button. Idempotent: only READY moves
 * to STARTED; any other phase is returned unchanged.
 */
export function startGame(phase) {
    return phase === GamePhase.READY ? GamePhase.STARTED : phase;
}
