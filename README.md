# PAPI INDUSTRIES — Fortifications Art Patch v3.1

An incremental correction **after** Art Integration v1, Buildings Art v2, and Walls Art v3.
It changes only rendering assets and presentation code. No simulation/core changes.

## What this patch does

- Replaces `public/assets/sprites/buildings/walls.png` with the newest **64x320** (32x32 cells, 2 columns x 10 rows) wall spritesheet.
- Updates the wall loader metadata from 32x26 to **32x32**. Existing neighbor-aware wall autotiling, damage frames (18 and 19), and tile-center placement stay intact. No scale or Y offsets.
- Adds `public/assets/sprites/buildings/gate-regular.png`, a compact 512x32 Phaser spritesheet repacked without resampling from the supplied Aseprite sheet.
- Links the gate art to the **existing** closed/opening/open/closing state machine, with one visual frame per calculated opening fraction. All collision, pathing, and delays remain in core.
- Retains the procedural gate renderer as a fallback and the existing touch/mouse placement preview.
- Adds focused unit tests for wall dimensions, frame mapping, gate sprite lifetime, and fallback behavior.

**Important note about the supplied gate atlas:** the eight frames marked `vertical` are pixel-identical to horizontal frames 8..15 (the already-open portion). They cannot render a fully closed vertical gate. This patch temporarily uses the full horizontal opening sequence and rotates it 90 degrees for a vertical gate, until a distinct vertical animation is authored. No frames are fabricated. Check orientation visually in Phaser.

## Installation (Windows PowerShell, repo root)

Prerequisite: your repo already includes v1, v2 and v3. Make a backup/commit of local changes first.

1. Extract this ZIP into any temporary folder, not directly into the repo.
2. Copy only the two PNGs from its `public/assets/sprites/buildings/` tree into the equivalent repo tree, overwriting `walls.png`.
3. Copy `papi-fortifications-v3.1.patch` to the repo root.
4. Check and apply:

```powershell
git apply --check .\papi-fortifications-v3.1.patch
git apply .\papi-fortifications-v3.1.patch
```

> Note: `git apply` patches may contain PNG binary changes as well. This ZIP already contains both resulting PNGs in `public/`; because the patch was exported as **code only** (no binary assets), follow steps 2–4 in that order.

## Targeted smoke check

- Create a wall line, corner, T and cross. Check junction textures at 1x and zoomed out.
- Damage a wall to <= 66% and <= 33% HP; observe the two damaged frames.
- Create both horizontal and vertical gate types. Check CLOSED, OPENING, OPEN and CLOSING states during truck passage.
- Remove a gate and confirm its texture disappears; check old preview behaves as before.
- Verify that wall and gate art does not affect unit pathing, HP, movement or test-mode QA.

## Verification

- Focused unit tests and JavaScript syntax checks were executed on a local reconstruction of the uploaded `src(3).zip` with v1+v2+v3 applied.
- Patch tested with `git apply --check` on that reconstructed baseline.
- **Not tested:** running Phaser/Vite in a browser. The uploaded source snapshot does not include the complete runnable repo (package.json, index.html, dependencies).

## Deliberately deferred

- Orange gate warning beacon lights
- Jungle trees and chopping graphics
- EL COLONEL menu art/animations
- Music files and SoundManager

The previously added `docs/audio-track-plan.md` remains unchanged and continues to describe the two provisional tracks; this patch contains no audio.
