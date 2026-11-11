# Testing, QA and TEST_MODE

Relocated from the root `CLAUDE.md` (TASK 038). The **mandatory risk-based testing policy in the root
`CLAUDE.md` takes precedence** over everything here: nothing below authorises a broad run by itself.
Read this before running unfamiliar suites or changing the QA harness, Test Shadow, fixtures or helpers.

## Commands

```bash
npm run dev
npm run build
npm run preview
npm run test
npm run test:e2e
npm run test:smoke
npm run test:full
npm run test:soak
npm run test:soak:browser
npm run test:soak:fortress
npm run test:soak:logistics
npm run test:soak:fortification
npm run test:soak:infantry
npm run test:soak:spitters
npm run test:soak:brutes
npm run test:soak:heavy
npx playwright install chromium
```

- `npm run dev`: Vite development server on port 5173.
- `npm run build`: Production build to `dist/`.
- `npm run preview`: Preview production build.
- `npm run test`: Node unit tests.
- `npm run test:e2e`: Playwright E2E tests, with 3 workers and tracing off by default. The dev server starts automatically and is reused outside CI.
- `npm run test:smoke`: the 22 tests tagged `@smoke`. It takes about 15 seconds and is for the development inner loop. It never replaces final verification.
- `npm run test:full`: the full unit suite, then the full regular E2E suite.
- `npm run test:soak`: Headless combat soak (`tests/soak/domain.soak.js`). Add `-- --quick` for a short subset. Writes `soak-results/domain.json`.
- `npm run test:soak:browser`: Browser soak (`playwright.soak.config.js`, one worker, own port 5175, no server reuse). Takes a few minutes. Writes `soak-results/browser-*.json`.
- `npm run test:soak:fortress`: The fortress combat benchmarks (`tests/soak/fortress.soak.js`): both FORTRESS 22 variants, historical in worlds with no roads, and the logistics reference. Survival is report-only and never a target. Writes `soak-results/fortress.json`.
- `npm run test:soak:logistics`: Bounded multi-Factory soak with repeated truck losses (`tests/soak/logistics.soak.js`). Writes `soak-results/logistics.json`.
- `npm run test:soak:fortification`: Optional and bounded, and not part of any automatic workflow. About 200 walls under the heaviest wave, with and without gaps, and enclosed bases under the real planner (`tests/soak/fortification.soak.js`). Survival and timing are report-only. Writes `soak-results/fortification.json`.
- `npm run test:soak:infantry`: Bounded. Similar-priced bases on the real planner with no income or input, then four squads against the heaviest wave (`tests/soak/infantry.soak.js`). Survival and timing are report-only. Writes `soak-results/infantry.json`.
- `npm run test:soak:spitters`: Bounded, about 3 minutes. The established turtles over 30 seeds, then compact, Barracks-free, static and active flag bases and `fortress-checkerboard-v1` over 10, each with Spitters and with the same waves of ordinary mutants (`tests/soak/spitter.soak.js`). Survival and damage are report-only. Writes `soak-results/spitters.json`.
- `npm run test:soak:brutes`: Bounded, about 90 seconds. One Brute against wall, funnel, checkerboard, enclosure and gate layouts, against 1 to 8 Autocannons, then the player-authored fortresses on Nights 30, 35 and 40 and in campaigns from Night 28 with nobody playing, each with and without Brutes (`tests/soak/brute.soak.js`). Survival and damage are report-only. Writes `soak-results/brutes.json`.
- `npm run test:soak:heavy`: Bounded, about 4 minutes, synthetic and report-only. One Brute against each defender, `golden-fortress-day33-v2` with each heavy configuration on Nights 30, 35 and 40 and in a campaign from Night 28, and Siege against Spitters on Nights 1 to 29 (`tests/soak/heavy.soak.js`). "Static" flags never move and a "scripted flag" is a stand-in, so neither is a playtest. Writes `soak-results/heavy.json`.
- `npx playwright install chromium`: Install the Chromium browser.

The soak suites are separate from `npm run test` and `npm run test:e2e`. See `docs/performance-baseline.md`.

### Run individual tests

```bash
npm run test -- hq.test.js
npm run test:e2e -- tests/e2e/hq.spec.js
npm run test:e2e -- -g "partial test name"
npm run test:e2e -- --grep @smoke
```

Do not assume a command passed. Execute it and report the actual result.

---

## Test Shadow

The project retains the original Starter Kit Test Shadow infrastructure in `src/testShadow/`.

It has three responsibilities.

### TestProxy

`addProxy(scene, gameObject, 'action-id')`

Use for elements a player actually clicks.

The proxy creates a transparent DOM element with `pointer-events: none`, allowing real pointer input to pass through to Phaser.

Tests interact through:
- `byAction`
- `clickAction`

Both are available from `tests/helpers/canvas.js`.

**Never call Phaser click handlers directly from E2E tests.**

### Scene and UI state

Use:
- `markScene`
- `setBodyState`
- `markModal`
- `markOverlay`

These expose a small number of coarse state indicators through DOM attributes.

Use `markModal(this, 'Name')` for modal overlays so the underlying scene marker is preserved.

`markOverlay('id')` returns a close function.

Do not expose large state snapshots through DOM attributes.

### QASurface

`QASurface` exposes:

```js
window.__qa.getState()
```

Use it for detailed state inspection:
- Entity positions
- Building states
- Resource values
- Simulation ticks
- Entity counts
- Gameplay state

Tests read snapshots through `sample(page)` from `tests/helpers/qa.js`.

Create QASurface before calling `markScene`, ensuring that QA state is available when the test detects scene readiness.

**Tracked entities belong in QASurface, not DOM proxies.**

### Testability contract

QA interfaces must observe or control the real gameplay implementation.

Do not introduce parallel gameplay logic exclusively for testing.

A QA helper must never bypass validation rules that apply to normal player actions.

When testing player interaction, prefer actual canvas events.

---

## TEST_MODE

The QA harness is enabled only when both conditions are true:

1. `import.meta.env.DEV` is true.
2. The URL contains `?testMode`.

`src/testMode.js` defines this behavior.

Production builds must not expose the QA harness, even when `?testMode` is supplied.

Test Shadow functions already no-op outside test mode.

`main.js` creates the Phaser DOM container only in TEST_MODE because `addProxy` requires it.

### E2E startup

`boot()` in `tests/helpers/canvas.js`:
- Adds `?testMode`
- Waits for `body[data-scene]`
- Optionally waits for `window.__qa` when `waitForQA: true`
- Uses the real HQ-first flow by default. New tests must use it, with the helpers in `tests/helpers/hq.js`.
- Adds `&audio=off` by default (TASK 030); `{audio: true}` loads and plays sound (`tests/e2e/audio.spec.js`).
- Adds `&tips=off` by default (TASK 033.3), so no suite gains a Presidential Advice card it did not ask for; `{tips: true}` shows them (`tests/e2e/advice.spec.js`). Production ignores it, and players get tips by default.
- Adds `&news=off` by default (TASK 029), so suites that step through a dawn and press the map are unchanged; `{news: true}` shows the newspaper (`tests/e2e/newspaper.spec.js`). Production ignores the parameter.
- Adds `?cycle=legacy` by default, which keeps the untimed Day older suites were written for. `{cycle: null}` plays the real ACTIVE cycle (Day 0, timed Days, Dusk). Evidence about the ACTIVE cycle must come from tests that pass `cycle: null` (`tests/e2e/active-cycle.spec.js`) or from `createWorld({active: true})` in the soak harness (`tests/unit/activeCycle.test.js`), never from LEGACY results.
- `{hq: false}` adds `?hq=off`, a compatibility mode for tests written before HQ existed, or for states real play cannot reach. Each use carries a comment saying why. `power` and `settlement` stay isolated on purpose, because they test BLACKOUT and exact generation, which HQ makes unreachable. `autocannons`, `building-placement`, `economy`, `mutants` and `waves` stay isolated until a justified migration, and one `pollution` test stays isolated because it asserts blackout.
- Records failure-only diagnostics (`tests/helpers/bootDiagnostics.js`). A failed boot attaches `boot-diagnostics.json` and rethrows the original error. A successful boot adds no output and no waits.

Playwright runs against the normal development server, not a separate test build.

Preserve these guarantees when modifying the bootstrap or test infrastructure.

---

## QASurface and TEST_MODE controls exposed by GameScene

  - QASurface exposes:
    - `grid`, `selectedCell`, `highlight`
    - `map` (`{id, cols, rows, seed, spawnFrame}`), `terrain` (`Terrain.snapshot()`, `null` before Start and on the open map) and `terrainView` (the rendered image), `fog` (`FogOfWar.snapshot()`) and `fogView` (the rendered image), both `null` on the open map
    - `ui` (title, Start, Cancel, END DAY, build menu and power toggle visibility)
    - `power` (the domain `calculatePower` result, including per-building `enabled` and `powered`), `powerView` (the actual summary text) and `selectedBuilding`
    - `placement` (`selectedType`, the domain `preview` result, and `lastResult` from the last placement attempt)
    - `resources` (`economy.snapshot()`), `hudView` (the actual HUD text), `menuLabels` (the actual button labels)
    - `shiftCycle` (`{day, shift, elapsedNightTicks, remainingNightTicks}`, `null` before Start) and `shiftView` (the actual shift-line text)
    - `settlement` (the latest report, or `null`) and `settlementView` (the actual panel text and visibility)
    - `siegeCannons`, `siegeShells`, `siegeViews` (rendered guns, shells, impacts), `rockets` and `powerWarning`; `infantryViews` adds `rockets`, `impacts` and `roofs`, and `buildingControlsView` adds `resetVisible`, `refitVisible`, `refitLabel` and `refitArmed`
    - `mutants` (domain records), `mutantViews` (rendered circles, and triangles with `kind`, `spent`, `inverted` and `aiming`), `shells`, `spitterEffectViews` (`aimLines`, `shells`, `impacts`, `deaths`) and `hpBarViews` (rendered HP bars), all `null` before Start
    - `wave` (the frozen night plan, `null` outside a started Night), `waveProgress` (slots reached, or `null`) and `waveView` (the actual HUD text and visibility)
    - `menuState` (`available`, `locked` or `built` per type), `ui.endDayEnabled`, `defeat` (the defeat report, or `null`) and `gameOverView` (the actual overlay text)
    - `autocannons` (`{id, cooldown, targetId}` per turret), `barrelViews` and `tracerViews` (rendered views), all `null` before Start
    - `pollution` (`{value, threatLevel, emissionsPerNight}`, `null` before Start; `emissionsPerNight` is derived from the current buildings, and the amount actually emitted is `settlement.pollution.emitted`) and `pollutionView` (the actual HUD text and visibility)
    - `simulation`: `{running, paused, tick, timeSeconds, speed, stepsExecuted, rng: {seed, state}}`
    - `speedView` (the rendered speed buttons: `{visible, selected, labels}`, `null` before Start)
    - `gates` (`Gates.snapshot()`), `gateViews` (rendered barriers, with `open` from 0 to 1) and `gatePreviewView`
    - `workers` (`Workers.snapshot()`) and `workerViews` (rendered `workers`, `deaths` and `flag`), both `null` before Start and under `?hq=off`
    - `infantry` (`Infantry.snapshot()`, `null` before Start and under `?hq=off`), `infantryViews` (rendered `soldiers`, `tracers`, `deaths`, `flags` and `pips`), `buildingControlsView` and `flagMode` (the Barracks id, or `null`)
    - `roads` (`{tiles, connected}`, `null` before Start and under `?hq=off`), `roadViews` (rendered tiles), `dockViews`, `dockPreviewView`, `roadMode`, `ringPreviewView` and `placementHint` (the actual hint text)
    - `logistics` (`Logistics.snapshot()`: `factories`, `trucks`, `night`, `lastNight`, `totals`) and `truckViews` (rendered trucks and storage), `logistics` is `null` before Start and under `?hq=off`
    - `previewView` (the rendered preview: visibility, rect, colors)
    - `buildings` (domain records, including `enabled`) and `buildingViews` (the rendered rectangles, including `alpha` and `strokeColor`)

### TEST_MODE URL parameters handled by GameScene

    - The RNG seed is `DEFAULT_SEED`. In TEST_MODE only, `?seed=N` overrides it.
    - In TEST_MODE only, `?waveBudget=N` (optionally with `&waveLastTick=T`) and `?stressRamp=N` (`src/testShadow/stressParams.js`) give the real `Mutants` a fixed schedule for the soak suites. With `waveBudget`, `&waveSpitters=K` makes K of them Spitters, in the real `spitterSlots`, and `&waveBrutes=K` makes K of them Brutes, in the real `bruteSlots`.
    - In TEST_MODE only, `?hq=off` is a compatibility mode for legacy suites written before HQ existed: no HQ button, no HQ rule, and END DAY is always allowed. Production ignores it.
    - In TEST_MODE only, `?mutants=off` gives the real `Mutants` an empty schedule instead of `nightPlan`. `boot(page, {mutants: false})` uses it for suites about power, economy and pollution. Combat tests must not use it, and production ignores it.

  - **TEST_MODE-only controls:** `window.__qa.sim` provides:
    - `pause()` → `clock.pause()` then `syncShiftUi()`
    - `resume()` → `cycle.resume()`: Night only in LEGACY, any phase that ticks in ACTIVE
    - `stepTicks(n)` → `cycle.stepTicks(n, stepSimulation)` then `syncShiftUi()`. It uses the same callback as `update` and drives real shift transitions, and does nothing in an untimed Day (LEGACY, or Day 0).
    - `setDay(n)` → `cycle.jumpToDay(n)` then `syncShiftUi()` (`src/testShadow/dayQa.js`), Day only. A manual testing aid to reach a late Night: it throws on bad input or outside Day, and skipped Nights earn, emit and spawn nothing. Buildings, flags, Credits, AP, power and pollution stay as they are, so the next wave is planned from the selected day and the real pollution.

    `window.__qa.layout` (`src/testShadow/layoutSnapshot.js`) provides `export()` and `load(snapshot, {faultAfter?})`. A snapshot is `{format: 'papi-layout', version: 1, grid, buildings, roads}`: a layout fixture, not a save, with no Credits, AP, Day, HP, enemies or RNG.
      - **Building order is data:** target ties, blockers and turret firing follow the building list, so `buildings` keeps creation order and must never be sorted. Instance ids are omitted, because ids are only compared for equality. Roads sort canonically.
      - `load` works only on a fresh Day, and replays through the real rules: HQ with its ring, player roads, then the other buildings. It funds its own purchases, so Credits and AP end unchanged, and normal placement gets no bypass.
      - A dry run on throwaway objects rejects anything invalid before the live game is touched. If the live replay still fails, or its export differs from the snapshot, the result has `applied: true` and the scene restarts, so a partial base can never be played. `faultAfter` simulates that failure for tests.
      - The same seed, commands and starting state give identical combat, including when the original ids have gaps. Historical HP, active combat and RNG state are not reconstructed.
      - Walls and gates are ordinary `buildings` entries, so they need no new version. Gates load CLOSED at full HP.
      - **Version 2** exists only because of Barracks, whose entries add `flag: {col, row} | null`. A layout with no Barracks exports as version 1, byte for byte as before. The version must match the contents, so a version 1 snapshot holding a Barracks, or a version 2 one holding none, is `unsupported-schema`. Flags load after all buildings, through `restoreFlag`. Soldiers are never saved.
      - **Version 3** exists only because of rocket squads: every Barracks entry then adds `role` (`rifle` or `rocket`). A layout with no rockets exports as version 2, byte for byte, and the version must match the contents. Loading restores roles through `restoreRole`, at no cost.
      - **Maps:** the format has no map field and needs none. Every fixture is 24×16, so on `jungle` it is refused with `grid-mismatch` and nothing is moved or resized. A jungle layout exports in the same format, with `grid: {cols: 48, rows: 32}`, and terrain is one more rule the replay and its dry run meet, so a layout that fits one world seed may be refused with `terrain-blocked` on another. The seed is not saved. Cleared jungle is not saved either (accepted limitation of TASK 025.4B): a layout with buildings or roads on cleared tiles is refused with `terrain-blocked` in a fresh run.
      - **Fixtures:** schema compatibility does not mean a layout is still legal, and rules are never relaxed to admit an old one. `tests/unit/gates.test.js` declares every file in `tests/fixtures/layouts/`: `logistics-reference`, `fortress-logistics-v1`, `fortress-checkerboard-v1`, `fortification-reference` and `infantry-reference` and the player-exported `golden-fortress-day33-v2` (both version 2) and `golden-fortress-brute-defense-v3` (version 3) load, and `golden-fortress-jungle-v3` (48×32, version 3) loads on the jungle map at the default seed; `fortress-corner-v1` and `fortress22-road-legal` are stale and are rejected with `no-road-access`. `tests/fixtures/legacy/fortress22-exact.js` is a combat benchmark that only builds with no roads.

    `window.__qa.perf` (`src/testShadow/PerfProbe.js`) provides `start()`, `stop()`, `counts()` and `renderer()` for the browser soak. It reports simulation, scene update, render callbacks and frame time separately, and classifies the rest as unattributed. Use it for real-time runs only; never derive frame rates from `stepTicks`.

    `window.__qa.busListeners()` counts subscribers per event, for the lifecycle test. QASurface also exposes `nightTint` (`{visible, alpha, color, depth}`), `dayTimeView` (`{visible, pause, speed}`), `camera` (`WorldCamera.snapshot()`), `orientation` and `ghost` (`{active, cell, footprint, segment, ok, revision, last}`, the touch proposal), and `ui` adds `drawerOpen` and `layout`.

    `window.__qa.economy` (`src/testShadow/economyQa.js`) provides `setCredits(amount)` and `addCredits(delta)`: a manual testing aid that moves the real balance through `Economy.adjustCredits`, refreshes the HUD and returns the balance. Amounts must be safe integers, otherwise it throws `RangeError`. Negative balances are supported on purpose, to test debt. It touches nothing else.

    Apart from `__qa.economy`, they can't place or spend. `GameScene` adds them; Test Shadow internals are unchanged. END DAY always resumes the clock, even after a QA pause.
  - Grid cells have no DOM proxies. E2E tests press real canvas points with `clickWorld`/`tapWorld`, and press buttons through their proxies with `clickAction`/`tapAction` (`tests/helpers/canvas.js`). `worldToScreen` goes through the real camera. On touch, `tapOnce` is one real tap and presses FIT first if a tile is out of view, `tapWorld` is what a player does to act on a tile, which while placing is both taps, and it leaves a LOW_POWER warning for the caller to answer, `tapAction` opens the drawer for a `build-*` proxy, and `showBuildMenu` opens it to measure what is in it. A closed drawer keeps its proxies, hidden.

Do not assume that planned gameplay systems already exist.

## Testing strategy

### Unit tests

Use Node's built-in test runner for pure domain logic.

Unit-test:
- State transitions
- Coordinate conversion
- Boundary conditions
- Building occupancy
- Resource transactions
- Energy allocation
- Simulation determinism

Tests must validate expected behavior, including invalid input and failure cases.

### Playwright E2E

Use E2E tests to validate:
- Scene startup
- Actual pointer interactions
- Desktop layouts
- Mobile landscape layouts
- Canvas scaling
- QA exposure
- Production TEST_MODE restrictions

Add E2E coverage for new player-facing functionality.

### Deterministic tests

Once the simulation system exists, test:
- Identical seed and commands produce identical gameplay outcomes.
- Simulation results do not depend on rendering FPS.
- Manual tick advancement produces the expected state.
- Pausing does not advance gameplay time.
- Restarting resets simulation state correctly.

### Test integrity

- Do not delete tests merely because they fail.
- Do not weaken assertions to accommodate incorrect behavior.
- Do not alter acceptance criteria without approval.
- Do not replace real input tests with direct internal method calls.
- Do not claim deterministic behavior without verifying it.

### Efficient test execution

The mandatory risk-based testing policy at the top of this file takes precedence over this section. Anything broader than targeted tests below needs the user's explicit authorization first.

**Risk-based regression:**

Do not run the full E2E suite automatically after every change. Use the smallest scope that gives meaningful confidence:

1. Local UI changes: the affected unit tests and targeted E2E specs.
2. Shared input or camera changes: the affected E2E plus a small desktop and mobile smoke set.
3. Simulation or core architecture changes: broader regression, justified by the specific dependencies affected.

Before launching the full E2E suite, state explicitly:

- Which changed files introduce cross-system regression risk?
- Why are targeted tests insufficient?
- Which failures could only be detected by the full suite?

Do not run the full suite unless that justification exists. Do not rerun tests that already passed unless relevant code changed afterward.

**The rules:**

- Run targeted tests during development.
- Do not run a full verification pass at task completion unless the user authorizes it.
- After test-only fixes, rerun the affected tests only.
- Run long browser soaks only when justified by major changes or release verification.
- Never repeat expensive test suites automatically, including to obtain a clean report.

**During implementation:**

- Run only the unit tests directly relevant to the changed modules.
- Run only the affected Playwright spec files or targeted tests.
- When changing a shared fixture/helper, validate it with a representative desktop and mobile smoke subset before expanding coverage.
- Run targeted tests after each fix, not the entire suite.
- Do not repeatedly run full E2E, soak suites, builds, or mutation checks after minor edits.
- Do not run performance soak suites unless the change affects their contracts, lifecycle behavior, or measured performance.
- Use existing test selection mechanisms. Do not build a new test runner or introduce dependencies.

**Final verification, only when the user authorizes it:**

1. Run the complete unit test suite.
2. Run the Playwright scope the risk-based rules above call for. Run the complete regular suite, with 3 workers and tracing disabled, only with the justification they require.
3. Run the production build and TEST_MODE isolation gate.
4. Run bounded, targeted mutation checks for new behavior.
5. Run the headless soak suites when justified by the changes. Run the long browser soak only for major gameplay changes or release verification.
6. Check for orphaned processes and verify `git diff --check`.

**The smoke suite:**

The `@smoke` tag marks 22 existing tests covering boot, Start, a new game on the jungle map, mobile layout, HQ-first construction, placement, power and toggling, nightly settlement, combat, Game Over, restart, a truck crossing a gate and a squad deploying to its flag. Keep it small. Add a tag only for a whole area that is not covered, not to raise a mutation score. Smoke is a fast signal, and it deliberately misses detail, so run it together with the unit suite: `npm run test && npm run test:smoke` takes about 17 seconds. See `docs/performance-baseline.md`.

**When a final gate fails:**

- Diagnose and fix the failure.
- Rerun the affected subset first.
- Repeat only the final gates potentially invalidated by that fix. A test-only fix invalidates only the tests it changed, so report any full run that was not repeated.
- Never hide failures, weaken assertions, or skip required final verification.

**Reporting:**

- Summarize which targeted tests were run during development.
- Report the final verification separately.
- Explain any skipped or deferred soak checks.

---

