/**
 * Presentation-only gate animation. Each orientation has its own native sheet
 * (see ART in SpriteArt.js), drawn at rotation 0 so the pixel art keeps its
 * shading and perspective:
 *
 *   gate-horizontal.png  a panelled barrier across the tile, seen face on, whose
 *                        panels fold away to bare posts as it opens.
 *   gate-vertical.png    a north-south barrier between two posts, whose bar slides
 *                        up into the far post as it opens. It stands 48 px tall on
 *                        its one 32 px tile.
 *
 * Both are 8 frames, 0 closed to 7 open. The opening fraction comes from the
 * unchanged core gate state machine, so closing runs back down the same frames.
 */
export const GATE_ART = Object.freeze({
    frames: 8,
    kind: Object.freeze({horizontal: 'gateHorizontal', vertical: 'gateVertical'}),
});

/** Which sheet a gate of this orientation is drawn from. */
export const gateArtKind = (orientation) => GATE_ART.kind[orientation] ?? GATE_ART.kind.horizontal;

/** The sheet frame for `openness` from 0 (closed) to 1 (open). */
export function gateArtFrame(_orientation, openness) {
    const ratio = Number.isFinite(openness) ? Math.max(0, Math.min(1, openness)) : 0;
    return Math.round(ratio * (GATE_ART.frames - 1));
}
