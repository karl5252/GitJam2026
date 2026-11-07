# PAPI INDUSTRIES — micro-sprite integration patch

Based on the `src(3).zip` snapshot supplied on 7 Nov 2026 (source timestamps around 6 Nov). **This is an art-only patch; no `src/core` files or simulation rules are changed.**

## Install (from repository root)

1. Extract this ZIP **into the repository root**, preserving the `public/` directory. Only assets and this README/patch are included; no source files are overwritten by extraction.
2. Inspect `git status`, then verify the code patch:
   `git apply --check papi-art-integration.patch`
3. If the check passes, apply it:
   `git apply papi-art-integration.patch`
4. Run your local dev server, check the nine visual assets in-game, and adjust the `scale`/`offsetX` values in `src/scenes/SpriteArt.js` if needed.

**If `git apply --check` fails, stop rather than forcibly replacing newer source.** Your local files may have changed since the supplied snapshot, especially around TASK 025.4A.

## Asset tree

```text
public/
  assets/
    sprites/
      units/
        worker.png            # v2, selected
        rifleman.png
        rocketman.png
      mutants/
        runner.png
        spitter.png
        brute.png
      vehicles/
        truck.png
      turrets/
        autocannon.png
        siege-cannon.png
      characters/
        el-papi.gif            # reserved; not loaded by the game
```

No originals were downscaled, stretched or resampled. Alpha is preserved.

| File group | Frame size | Grid | Indices used |
|---|---:|---:|---|
| Worker / Rifleman / Rocketman | 45×40 | 4×4 | 0 idle, 4–5 walk, 10 fire (infantry), 13 death |
| Runner | 32×39 | 6×4 | 0 idle, 6–7 run |
| Spitter | 32×39 | 6×4 | 0 idle, 6–7 move, 12 aim, 16 spent, 19 death |
| Brute | 32×39 | 6×4 | 0 idle, 6–7 move, 14 smash, 19 death |
| Truck | 24×14 | 2×1 | 0 empty, 1 loaded |
| Turrets | 32×32 / 32×35 | 8×1 | 0 N, 1 NE, 2 E, 3 SE, 4 S, 5 SW, 6 W, 7 NW |

The transparent padding in every frame is intentional. Frame heights **do not need** to match between different sheets. Only cells **within each sheet** must share a rectangle size. Render placement is bottom-aligned for units.

## Code integration

- `BootScene` preloads nine PNG sprite sheets before starting the game.
- `SpriteArt.js` centralizes paths, frames, display scales and alignment; it is presentation-only.
- `WorkerLayer`, `InfantryLayer`, `MutantLayer`, `TruckLayer`, `AutocannonLayer` and `SiegeLayer` display art without changing core entities, collision footprints, combat, movement or economics.
- Existing geometry is retained invisibly for QA view properties and fallbacks if a texture is missing.
- Enemy sprites observe current Fog of War visibility, so art does not leak unseen mutant positions.
- The truck switches empty/loaded art according to its existing cargo state, and turrets use 8-direction images rather than rotated pixels.
- Worker's chopping/repairing frames are **not** triggered yet: TASK 025.4B will add real work actions.
- El Papi is included only as a reserved asset.

## Verification performed

- Node syntax parsing of all changed JS files.
- Manifest/frame-geometry and PNG alpha checks for 9/9 sheets.
- Manifest + turret direction helper sanity checks.
- Diff inspection; no `src/core` changes.

**Not performed:** Phaser/Vite runtime or browser E2E, because the uploaded archive contains `src`, tests and docs but lacks `package.json`, the `public` directory and the project's actual runnable environment. Please run a **targeted visual smoke** after applying the patch, especially art layering, pixel sharpness, correct `flipX`, Fog of War, and camera zoom on mobile. No full regression is needed just for this art swap.
