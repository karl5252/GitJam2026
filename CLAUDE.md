# CLAUDE.md

This file provides project context, architectural constraints, and working rules for Claude Code.

## 1. Project

**PAPI Industries: The Green Shift** is an industrial survival tower-defense game developed for GitHub Game Off 2026.

**Technology:**
- Phaser 4 (ESM)
- JavaScript (no TypeScript)
- Vite
- Node.js built-in test runner
- Playwright for E2E testing

**Target platforms:** Desktop browsers and mobile browsers in landscape orientation.

**Current status:** Bootstrap complete.

The project was initialized from the Wee Games Starter Kit Basic. The original demo applications have been removed.

Currently, `GameScene` displays the game title and a functional Start button. No gameplay systems have been implemented yet.

### Game concept

The player manages an industrial facility in San Papi.

During the **Day Shift**, the player builds infrastructure, manages resources, allocates power, and prepares defenses.

During the **Night Shift**, automated defenses protect the facility from mutant creatures emerging from the surrounding jungle.

Industrial expansion increases pollution, which contributes to escalating threats.

The game combines economic decisions, tower defense, environmental consequences, and satirical corporate propaganda.

**Primary design goal:** Create a small, complete, enjoyable game. Avoid unnecessary complexity.

The Game Design Document is the source of truth for gameplay requirements. This file defines implementation constraints and development practices.

---

## 2. Development Principles

### Small, testable increments

- Implement only the explicitly requested task.
- Work in small, independently testable increments.
- Prefer simple implementations over speculative abstractions.
- Reuse existing infrastructure whenever appropriate.
- Do not refactor unrelated modules.
- Do not introduce dependencies without explicit approval.
- Do not create generic frameworks unless there is a demonstrated requirement.
- Avoid implementing future features prematurely.
- Preserve existing behavior unless the task explicitly requires changing it.

### Human-controlled development

The human developer is responsible for:
- Game design decisions
- Architecture approval
- Feature prioritization
- Gameplay evaluation
- Final code review
- Git commits and publishing

Claude is responsible for:
- Analyzing requested changes
- Proposing minimal implementations
- Implementing approved tasks
- Writing and running relevant tests
- Reporting results and limitations

**Never commit, push, merge, or publish without explicit approval.**

Stop after completing the assigned task.

### Planning

For architectural changes, destructive cleanup, or changes affecting several systems:

1. Inspect the existing implementation.
2. Present a concise plan.
3. Identify affected files and risks.
4. Wait for approval before implementation.

For small, clearly specified tasks, implement directly unless the user requests planning first.

Do not repeatedly ask for decisions already documented in the GDD, this file, or the current task.

---

## 3. Commands

```bash
npm run dev
npm run build
npm run preview
npm run test
npm run test:e2e
npx playwright install chromium
```

- `npm run dev`: Vite development server on port 5173.
- `npm run build`: Production build to `dist/`.
- `npm run preview`: Preview production build.
- `npm run test`: Node unit tests.
- `npm run test:e2e`: Playwright E2E tests. The dev server starts automatically and is reused outside CI.
- `npx playwright install chromium`: Install the Chromium browser.

### Run individual tests

```bash
node --test tests/unit/gamePhase.test.js
npx playwright test tests/e2e/start-button.spec.js
npx playwright test -g "partial test name"
```

Do not assume a command passed. Execute it and report the actual result.

---

## 4. Architecture

### Separation of concerns

Keep game rules independent of rendering.

**`src/core/`**

Pure domain logic:
- Game phases
- Economy
- Building placement rules
- Grid occupancy
- Energy management
- Combat calculations
- Simulation state

Core modules must not import Phaser.

**`src/scenes/`**

Phaser presentation and scene orchestration:
- Rendering
- Player input
- Visual feedback
- Camera
- UI integration
- Connecting domain state to visual objects

Avoid implementing gameplay rules directly inside Phaser scenes.

### Current implementation

- `src/core/gamePhase.js`: Bootstrap game phase logic.
- `src/core/grid.js`: `Grid` class (Phaser-free). Configurable `cols`/`rows`/`tileSize` with an origin offset (`originX`/`originY`). World↔cell conversion (`worldToCell`, `cellToWorld`, `cellCenter`, `footprintRect`). NxM footprints `{col, row, width, height}`, anchored at the top-left cell. `canPlace`/`place` are atomic and return `{ok}` or `{ok: false, reason}`, where reason is one of `PlacementFailure`: `invalid-footprint`, `out-of-bounds`, `occupied` (plus `blockers`), `duplicate-id`. Also `remove`, `occupantAt` and `snapshot()`, which returns detached JSON data for QASurface. Not yet rendered or connected to pointer input.
- `src/scenes/BootScene.js`: Starts the game scene.
- `src/scenes/GameScene.js`: Placeholder scene with Start button.

Do not assume that planned gameplay systems already exist.

### Rendering

The logical game resolution is **1280×720**.

Phaser uses:
- `Scale.FIT`
- `CENTER_BOTH`

The application must support desktop and mobile landscape layouts.

The initial mobile E2E viewport is **844×390**.

Avoid assumptions that screen coordinates equal world coordinates. Coordinate conversion must account for camera positioning, zoom, and canvas scaling.

---

## 5. Simulation Architecture

Gameplay-critical simulation must use a **fixed timestep of 60 Hz**.

### Requirements

- Use a dedicated simulation clock.
- Use seeded random number generation.
- Keep gameplay simulation independent of rendering FPS.
- Avoid Phaser timers for gameplay-critical behavior.
- Avoid `Math.random()` for gameplay decisions requiring reproducibility.
- Avoid `Date.now()` or wall-clock timing for gameplay outcomes.
- Support deterministic state inspection and controlled tick advancement for testing.

The simulation clock and seeded RNG have not yet been integrated.

When assigned, inspect the existing implementations from Steel Abyss: Refit or BarrelStorm before introducing replacements.

### Day Shift

Day Shift is an untimed planning phase.

Gameplay actions are discrete commands, such as:
- Place building
- Change building power state
- Repair building
- End day

The player must not be forced to make planning decisions under a real-time countdown.

### Night Shift

Night Shift is a real-time defense phase.

Target duration: **60 seconds / 3600 simulation ticks**.

The gameplay simulation owns:
- Enemy movement
- Target selection
- Weapon cooldowns
- Damage resolution
- Wave progression
- Gameplay timers

Phaser owns the visual presentation.

The domain simulation must not depend on animations completing to resolve gameplay outcomes.

---

## 6. Grid and Construction

The game uses a square logical grid.

Requirements:
- Configurable grid dimensions and tile size
- Consistent grid/world coordinate conversion
- Support for NxM building footprints
- Boundary validation
- Occupancy validation
- Deterministic placement rules
- Separation of placement validation from rendering

Reuse the existing WGS Grid Generator add-on when integrated.

Do not implement a replacement grid system without first reviewing the available implementation.

Placement rules must remain unit-testable without Phaser.

Playwright must additionally verify actual canvas interaction.

---

## 7. Test Shadow

The project retains the original Starter Kit Test Shadow infrastructure in `src/testShadow/`.

It has three responsibilities.

### 7.1 TestProxy

`addProxy(scene, gameObject, 'action-id')`

Use for elements a player actually clicks.

The proxy creates a transparent DOM element with `pointer-events: none`, allowing real pointer input to pass through to Phaser.

Tests interact through:
- `byAction`
- `clickAction`

Both are available from `tests/helpers/canvas.js`.

**Never call Phaser click handlers directly from E2E tests.**

### 7.2 Scene and UI state

Use:
- `markScene`
- `setBodyState`
- `markModal`
- `markOverlay`

These expose a small number of coarse state indicators through DOM attributes.

Use `markModal(this, 'Name')` for modal overlays so the underlying scene marker is preserved.

`markOverlay('id')` returns a close function.

Do not expose large state snapshots through DOM attributes.

### 7.3 QASurface

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

## 8. TEST_MODE

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

Playwright runs against the normal development server, not a separate test build.

Preserve these guarantees when modifying the bootstrap or test infrastructure.

---

## 9. Testing Strategy

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

---

## 10. Phaser 4 Conventions

Phaser 4 ESM does not provide a global `window.Phaser`.

Files using Phaser APIs must explicitly import Phaser:

```js
import Phaser from 'phaser';
```

The project currently has one HTML entry point: `index.html`.

Additional HTML entry points require corresponding Vite build configuration.

Do not introduce additional entry points without a clear requirement.

No Arcade Physics dependency is currently configured.

Do not reintroduce physics systems unless a gameplay requirement justifies them.

---

## 11. Scope Control

PAPI Industries is a time-limited game-jam project.

**Prioritize a playable core loop over feature quantity.**

Initial implementation priorities:

1. Bootstrap
2. Grid integration
3. Building placement
4. Credits and Action Points
5. Simulation clock and RNG
6. Day/Night state machine
7. Basic enemies and defenses
8. Repeatable survival loop

Advanced systems, additional content, and visual polish must not be introduced ahead of their assigned tasks.

When a reusable feature could become a WGS Starter Kit add-on, implement only what PAPI requires.

Do not refactor the current project into a general-purpose engine.

---

## 12. Definition of Done

A task is complete when:

- The requested functionality is implemented.
- Relevant unit tests pass.
- Relevant Playwright tests pass, where applicable.
- Production build succeeds.
- Existing functionality remains intact.
- No unrelated files are modified unnecessarily.
- Known limitations are documented.
- No unapproved dependencies are introduced.
- No Git commit or push is performed without authorization.

### Required completion report

At the end of each task, report:

1. Summary of changes
2. Files added, modified, or removed
3. Tests executed and results
4. Build result
5. Remaining limitations or risks
6. Any decisions requiring developer approval

**Stop after the report. Do not begin the next task automatically.**