# PAPI Industries - Office Menu v5.1 hotfix

**Requires the existing v5 Office Menu patch.** This is an incremental fix, not a replacement for the original v5 archive.

## Fixes

1. Crops the original `ElColonelOfficeTiles.png` (32x104) correctly. There are three opaque 32x32 cells at y=0, y=36 and y=72. The 4 fully transparent pixel rows between cells must not be included in the exported textures.
2. Removes the incorrect fake `wall-trim.png` crop, and lets the wall-bottom area meet the parquet without a gap.
3. Uses only Aseprite `walk` animation for a moving Colonel. The source JSON has a 7-column (64x56) PNG grid: Aseprite's logical `walk` frames 4..7 are Phaser spritesheet indices **7,8,9,10**; `idle` remains 0..3, and `action` is 14..20.
4. Mirrors (`flipX`) the left-facing source sprite only during rightward movement. Leftward walking uses the unflipped original.
5. Moves the 51x50 telephone and 38x48 golden bust up to the visible desk surface. Both retain their native frames and scale.
6. Leaves portrait switching disabled. Mutant portrait remains available for a later progression flag.

## Install (from repository root)

```bash
git apply --check papi-office-menu-v5.1.patch
git apply papi-office-menu-v5.1.patch
```

The patch includes **binary PNG changes** and removal of `wall-trim.png`. Use `git apply`, not copy/paste. If your installed v5 differs locally, review and reconcile before applying.

Alternatively, manually copy changed files from `overlay/` and delete `public/assets/sprites/menu-office/wall-trim.png` if desired. Copying does not automatically delete files.

## Verify

```bash
node --test tests/unit/office-menu.test.js tests/unit/office-menu-layer.test.js
```

The patch was checked against the v5 baseline reconstructed from the supplied `game.zip` and `menu_asets.zip`, and 9/9 focused Node tests pass. Original 32x104 source tiles were also checked for opaque content after cropping.

Not verified: a live Phaser 4 browser session (the supplied `game.zip` had no `index.html` or installed dependencies). Preview PNGs are static compositions assembled from the supplied assets.

No changes to `src/core` or game simulation/QA contracts.
