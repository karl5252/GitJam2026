# PAPI Industries: The Green Shift

A Phaser 4 industrial survival tower defense game, built with Vite (plain
JS, ESM). The repository was initialized from the Wee Games Starter Kit
(Basic) and keeps its **Test Shadow** harness, which lets Playwright
observe and click into the game's real runtime state instead of
pixel-diffing a canvas.

Current state: bootstrap only — a placeholder `GameScene` with a title and
a Start button. No gameplay yet.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173/
```

Run the tests:

```bash
npm run test                       # unit tests (node --test, tests/unit/)
npx playwright install chromium    # first time only
npm run test:e2e                   # Playwright E2E (tests/e2e/)
```

Single tests:

```bash
node --test tests/unit/gamePhase.test.js
npx playwright test tests/e2e/start-button.spec.js
npx playwright test -g "partial test name"
```

Build:

```bash
npm run build        # dist/
npm run preview
```

The game renders at 1280×720 and scales to fit (`Scale.FIT`, centered)
for desktop and mobile landscape.

To inspect the QA layer manually, append `?testMode` to the URL, then
inspect `<body data-*>` or run `window.__qa.getState()` in the console.

---

## Why Test Shadow exists

Canvas is a black box to Playwright (and to any browser automation tool).
Whatever Phaser draws has **no DOM underneath it** — nothing to select, no
attributes to read, nothing for a real click to land on except the canvas
itself.

Test Shadow is **three purpose-built tools, not one generic mirror** — pick
the one that matches what the state actually needs:

1. **`addProxy`** (`src/testShadow/TestProxy.js`) — for anything a player
   genuinely *clicks*: a button, a tile, a build slot. Creates a
   transparent DOM proxy positioned over the clickable area,
   `pointer-events: none`, so a click dispatched at its position *passes
   through* to the canvas and Phaser's real `pointerdown` handler runs. A
   test-only hook that calls your click handler directly never proves the
   handler is wired up to anything a player could actually click — never
   use that shortcut.
2. **`markScene` / `setBodyState`** (same file) — a FEW coarse, HUD-level
   scalars written straight onto `<body data-*>`: scene identity, phase.
   Cheap to assert on with `toHaveAttribute()`. For overlays use
   `markModal(this, 'Name')` (doesn't stomp `data-scene`) or
   `markOverlay('id')` (returns a close function).
3. **`QASurface`** (`src/testShadow/QASurface.js`) — for anything more
   detailed that's never clicked: positions, per-entity state, counts. One
   `window.__qa.getState()` function, computed **on demand** when a test
   calls it — never written to the DOM every frame.

If it's clickable, it needs a real DOM node for click-passthrough, so
`addProxy` earns its cost. If it's only ever *tracked*, put it in
`QASurface` instead.

Test helpers: `tests/helpers/canvas.js` (`boot`, `body`, `byAction`,
`clickAction`) and `tests/helpers/qa.js` (`sample`).

## TEST_MODE

`src/testMode.js`:
`import.meta.env.DEV && new URLSearchParams(location.search).has('testMode')`.

Requires *both* dev mode *and* the query param. A production build
(`npm run build` + `npm run preview`) with `?testMode` on the URL still
produces `document.body.dataset.scene === undefined` and no `window.__qa` —
**no test surface is exposed in a shipped build.**

That's a runtime safety guarantee, not a bundle-size one: with Vite's
default (esbuild) minifier the dead `if (TEST_MODE) {...}` branches may
remain in the bundle, unreachable. `build.minify: 'terser'` strips more
aggressively if size matters.

## Testing layers

1. Pure `src/core/` logic — no Phaser, runs in plain Node (`tests/unit/`).
2. Playwright E2E against the real running canvas game (`tests/e2e/`),
   using the Test Shadow helpers above. Playwright starts the normal dev
   server; `boot()` appends `?testMode` and waits for `body[data-scene]`.
