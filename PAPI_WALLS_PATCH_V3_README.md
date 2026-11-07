# PAPI Industries — Wall Art Patch v3

**Only wall sprite integration + documentation for future music tracks. No WAV, OGG, or SoundManager code.**

## Requirements

- The PAPI source used for v1/v2, with **Art Integration v1** and **Buildings Art Patch v2** already applied.
- A valid Git working tree. This patch was prepared from the earlier uploaded `src(3).zip` snapshot with both art patches applied, not from your current local repo.

## Install (PowerShell, repository root)

1. Inspect `git status` and protect any local edits.
2. Extract this ZIP into the repository root, retaining the `public/assets/sprites/buildings/` and `docs/` directory layout.
3. Check and apply the source patch:

   ```powershell
   git apply --check .\papi-walls-art-v3.patch
   git apply .\papi-walls-art-v3.patch
   ```

4. Check walls and junctions in a **local playtest**, including a damaged wall and demolition. Avoid a full E2E regression just for wall presentation.

If `git apply --check` fails, do not force the patch: your local source may differ. Compare relevant files first.

## New asset

```
public/assets/sprites/buildings/walls.png
```

The supplied `walls-0-sheet.png` is retained byte-for-byte under a predictable URL. It is a **64×260** sheet with **32×26** frame cells and transparent padding. The second column is empty except for the last damaged frame. `SpriteArt.js` loads it as a regular spritesheet, without runtime JSON dependencies.

## Visual states

- Horizontal / vertical walls, 4 corners, top / bottom T junctions, 4-way intersection.
- Left/right T junctions reuse one T sprite rotated 90°/−90° because the supplied atlas has no dedicated side-T frames. Inspect these two cases: the perspective/shading may look different after rotation.
- At **≤ 66% HP** a wall uses damaged frame 0; at **≤ 33% HP** it uses damaged frame 1. Both damaged images replace the normal connected appearance, rather than preserving connected corners. Destroyed walls are removed by the existing game logic.
- Neighbor connectivity is recalculated on build/demolition and damage appearance on HP changes. Fallback gray rectangles and existing QA-visible building footprints stay present.
- Gate graphics, collision, construction costs, HP/damage, mouse/mobile placement, fog rules and **all `src/core` files** remain untouched.
- The art is centered inside the existing 32×32 tile (source is 32×26). No resampling or forced scaling was applied.

## Future music planning (documentation only)

Read `docs/audio-track-plan.md` for the **provisional** mapping:

- `Spanish - Océano Loop.wav` → `music.day` → future `public/assets/audio/music/oceano-loop.ogg`
- `Spanish - Como Versace Loop.wav` → `music.night` → future `public/assets/audio/music/como-versace-loop.ogg`

No audio assets or playback are installed. SoundManager migration from BarrelStorm is deferred. The exact assignments need approval after listening.

## Verification and limits

- Focused wall/topology and existing sprite-art tests: **6/6 passed**.
- `node --check` of changed JS files: passed.
- Patch checked and applied on a clean copy of the previous v1+v2 baseline.
- PNG confirmed 64×260 and 32×26 cell boundaries.
- **Not run:** Phaser/Vite browser eye check, broad E2E, soaks. The user upload did not include the full runnable repo / `package.json`.

**No commit or push was performed.**
