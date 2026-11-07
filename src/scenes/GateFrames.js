/**
 * Presentation-only gate animation. The supplied source has 16 horizontal
 * opening frames; its eight "vertical" cells are byte-identical to horizontal
 * frames 8..15, so they cannot depict a *closed* vertical gate.
 * Until vertical art is completed we rotate the full horizontal 16-frame cycle.
 * The opening fraction comes from the unchanged core gate state machine.
 */
export const GATE_ART = Object.freeze({frames: 16, verticalAngle: 90});

export function gateArtFrame(_orientation, openness) {
    const ratio = Number.isFinite(openness) ? Math.max(0, Math.min(1, openness)) : 0;
    return Math.round(ratio * (GATE_ART.frames - 1));
}

export function gateArtAngle(orientation) {
    return orientation === 'vertical' ? GATE_ART.verticalAngle : 0;
}
