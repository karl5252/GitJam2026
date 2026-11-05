# CLAUDE.md

This file provides project context, architectural constraints, and working rules for Claude Code.

## Task Selection and Session Resumption

- The repository roadmap is informational, not permission to begin tasks.
- Never select or begin the next roadmap item automatically.
- Only work on tasks explicitly assigned by the human developer.
- A message such as "continue", "resume", or "go on" means:
    1. Resume the previously approved, unfinished task if one exists.
    2. If the previous task is complete or the working tree is clean, report the last completed task and ask which task to work on.
    3. Do not infer the next task from the roadmap or begin planning an unassigned feature.
- If no task is active, do not scan unrelated repositories or execute the full test suite just to determine what to do next.
- The current task's explicitly approved requirements take precedence over older roadmap descriptions.
- Gameplay design decisions must come from the GDD or explicit developer instructions, not assumptions.
- Do not repurpose an existing building type without approval.
- Keep task IDs consistent with the current development sequence.
- A clean Git working tree does not imply that the next roadmap task has been authorized.
- 
## 1. Project

**PAPI Industries: The Green Shift** is an industrial survival tower-defense game developed for GitHub Game Off 2026.

**Technology:**
- Phaser 4 (ESM)
- JavaScript (no TypeScript)
- Vite
- Node.js built-in test runner
- Playwright for E2E testing

**Target platforms:** Desktop browsers and mobile browsers in landscape orientation.

**Current status:** TASK 014 (Efficient Test Execution) complete. No next task is approved: only work on tasks the developer explicitly assigns.

The project was initialized from the Wee Games Starter Kit Basic. The original demo applications have been removed.

Implemented so far: grid placement, Credits and AP, the Day/Night cycle, global power, nightly settlement, pollution and derived threat, one basic mutant type that damages and destroys buildings, the Autocannon, which kills mutants, and nightly waves that scale with the night, Threat Level and Autocannon count, and a player-built HQ whose destruction ends the run. There are no repairs yet.

### Game concept

The player manages an industrial facility in San Papi.

During the **Day Shift**, the player builds infrastructure, manages resources, allocates power, and prepares defenses.

During the **Night Shift**, automated defenses protect the facility from mutant creatures emerging from the surrounding jungle.

Industrial expansion increases pollution, which contributes to escalating threats.

The game combines economic decisions, tower defense, environmental consequences, and satirical corporate propaganda.

**Primary design goal:** Create a small, complete, enjoyable game. Avoid unnecessary complexity.

The Game Design Document, `PAPI_Industries_GDD_v0.2.md` in the repository root, is the source of truth for gameplay requirements. This file defines implementation constraints and development practices.

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
npm run test:smoke
npm run test:full
npm run test:soak
npm run test:soak:browser
npx playwright install chromium
```

- `npm run dev`: Vite development server on port 5173.
- `npm run build`: Production build to `dist/`.
- `npm run preview`: Preview production build.
- `npm run test`: Node unit tests.
- `npm run test:e2e`: Playwright E2E tests, with 3 workers and tracing off by default. The dev server starts automatically and is reused outside CI.
- `npm run test:smoke`: the 13 tests tagged `@smoke`. It takes about 15 seconds and is for the development inner loop. It never replaces final verification.
- `npm run test:full`: the full unit suite, then the full regular E2E suite.
- `npm run test:soak`: Headless combat soak (`tests/soak/domain.soak.js`). Add `-- --quick` for a short subset. Writes `soak-results/domain.json`.
- `npm run test:soak:browser`: Browser soak (`playwright.soak.config.js`, one worker, own port 5175, no server reuse). Takes a few minutes. Writes `soak-results/browser-*.json`.
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
- `src/core/grid.js`: `Grid` class (Phaser-free). Configurable `cols`/`rows`/`tileSize` with an origin offset (`originX`/`originY`). World↔cell conversion (`worldToCell`, `cellToWorld`, `cellCenter`, `footprintRect`). NxM footprints `{col, row, width, height}`, anchored at the top-left cell. `canPlace`/`place` are atomic and return `{ok}` or `{ok: false, reason}`, where reason is one of `PlacementFailure`: `invalid-footprint`, `out-of-bounds`, `occupied` (plus `blockers`), `duplicate-id`. Also `remove`, `occupantAt` and `snapshot()`, which returns detached JSON data. The grid is the source of truth for occupancy and validity.
- `src/core/buildingTypes.js`: frozen plain data, with temporary graybox values. `getBuildingType(id)` returns the type or `null`.
  - `hq`: 3×3, costs `{credits: 0, ap: 0}`, operations `{income: 0, upkeep: 0}`, power `{supply: 20, demand: 0}`, `pollutionPerNight: 0`, `maxHp: 600`, `switchable: false`. Its power joins the global pool, so `power.js` has no special case. Generation never reaches 0 while HQ stands, so BLACKOUT does not occur in normal play.
  - `outpost`: 1×1, costs `{credits: 100, ap: 1}`, operations `{income: 0, upkeep: 20}` per completed night, power `{supply: 0, demand: 10}`, `pollutionPerNight: 0`, `maxHp: 100`.
  - `factory`: 3×3, costs `{credits: 400, ap: 1}`, operations `{income: 150, upkeep: 0}` per completed night, power `{supply: 0, demand: 40}`, `pollutionPerNight: 8`, `maxHp: 300`.
  - `powerPlant`: 3×3, costs `{credits: 500, ap: 1}`, operations `{income: 0, upkeep: 0}`, power `{supply: 100, demand: 0}`, `pollutionPerNight: 12`, `maxHp: 300`.
  - `autocannon`: 1×1, costs `{credits: 250, ap: 1}`, operations `{income: 0, upkeep: 0}`, power `{supply: 0, demand: 20}`, `pollutionPerNight: 0`, `maxHp: 150`. It is a separate defensive building; Outpost is not a turret.
- `src/core/power.js`: `calculatePower(buildings)` → `{generation, demand, status, buildings: [{id, type, enabled, powered}]}`.
  - One global pool, derived on demand from the building records and never stored. It is pure and does not mutate its input.
  - Generation and demand count **enabled** buildings only.
  - `PowerStatus`:
    - `normal`: generation ≥ demand, including 0/0.
    - `low-power`: 0 < generation < demand.
    - `blackout`: generation is 0 and demand > 0.
  - A consumer is `powered` only when it is enabled and the status is `normal`. Low power and blackout stop **all** consumers; there is no priority or partial allocation. A generator is powered when enabled.
- `src/core/pollution.js`:
  - `threatLevel(pollution)` is pure and is the only source of threat, which is never stored: 0-24 = 1, 25-49 = 2, 50-99 = 3, 100+ = 4.
  - `calculateEmissions(buildings)` is pure and sums `pollutionPerNight` over buildings that `calculatePower` reports as `powered`. Disabled buildings and unpowered consumers emit nothing.
  - `Pollution(value = 0)` has a private value, read through `value` or `snapshot()` → `{value}`. `add(amount)` validates the amount and the resulting total as safe integers before changing anything. There is no decrease, so it never goes negative and never decays.
- `src/core/waves.js`: pure night wave planning, with temporary graybox values in `WAVE`. No state, clock or randomness.
  - `nightBudget = 1 + floor((night - 1) / 2)`, `pollutionBudget = 2 * (threatLevel - 1)`, `defenseResponse = min(4, floor(max(0, autocannonCount - 1) / 2))`, `budget = min(20, nightBudget + pollutionBudget + defenseResponse)`.
  - `waveSchedule(budget)` gives strictly increasing integer ticks from 600 to 2700, with gaps that shrink through the night, so at most one mutant spawns per tick.
  - `nightPlan({day, pollution, buildings})` returns a frozen plan `{day, threatLevel, autocannons, nightBudget, pollutionBudget, defenseResponse, budget, schedule}` holding numbers only. Every existing Autocannon counts, enabled or not, powered or not. Threat Level is derived from pollution here and stored nowhere else.
  - `waveProgress(plan, elapsedNightTicks)` counts scheduled slots reached.
- `src/core/mutants.js`: `Mutants({cycle, placement, grid, rng, schedule, planNight})`, temporary graybox values in `MUTANT` and `TARGET_BIAS`.
  - `planNight(day)` is called once per night, on night tick 1, and the plan stays frozen until dawn. That equals sampling at END DAY: pollution only changes during settlement, construction is off at night, and no mutant exists yet. A night's emissions therefore affect the next night's plan. `plan()` returns the plan, or `null` outside a started Night. A fixed `schedule` array is used when there is no `planNight`.
  - Positions are world pixels from the Grid. `speed` is 0.5 px per tick. All distances are Manhattan distances to a footprint rectangle (`distanceToFootprint`).
  - `step()` runs once per tick, **after** `ShiftCycle.onTick()`, and returns `{spawned, attacks, destroyed}` for that tick. Mutants act on night ticks 1..3599; tick 3600 only settles. A retried final tick therefore cannot apply damage twice. Outside Night, `step()` removes survivors with no penalty, which is the dawn cleanup.
  - Records are `{id, x, y, hp, targetId, obstacleId, attackTimer}` and hold building ids only. `hp` starts at `MUTANT.maxHp`.
  - `damageMutant(id, amount)` is the only way mutant HP changes. At 0 HP the record is removed, so a mutant dies exactly once and later damage returns `unknown-mutant`. Invalid amounts return `invalid-damage`. It returns `{ok, killed, hp}`.
  - `selectTarget`: lowest `distance - TARGET_BIAS`, then higher bias, then earliest in the building list. `targetId` stays locked until that building is destroyed.
  - Movement is one step along the longer axis toward the nearest footprint point, stopping within `attackRange`.
  - **Obstacles:** if the next step enters any footprint (`blockerAt`, closed bounds, so touching buildings leave no seam), the mutant stays put and sets `obstacleId`. It attacks that building until destroyed, then resumes toward `targetId`. There is no pathfinding.
  - `attackTimer` only runs while stationary and resets on any movement. The first hit lands on the 60th tick spent attacking.
  - **Spawning:** exactly one RNG draw per scheduled spawn picks one of the `borderSpawns` positions. If that border cell is occupied, the next free position clockwise is used. If every border cell is occupied, that spawn is skipped and not retried, and its slot still counts as reached. Spawning does not depend on buildings existing.
  - With no buildings left, mutants wait in place until dawn. This only happens without HQ, in legacy test setups.
  - **Defeat:** a hit that destroys HQ calls `cycle.defeat()`. The run ends on that hit: later mutants do not act, a due spawn is dropped, and survivors stay frozen. HQ has the top bias and mutants walk shortest paths, so it is always a target, never just an obstacle.
- `src/core/autocannons.js`: `Autocannons({cycle, placement, grid, mutants})`, temporary graybox values in `AUTOCANNON` (`range` 160, `damage` 10, `cooldownTicks` 30).
  - `step()` runs once per tick, after `ShiftCycle.onTick()` and **before** `Mutants.step()`, and returns `{shots}` for that tick. Turrets fire on night ticks 1..3599, never on tick 3600, and do nothing after a defeat. A mutant killed on a tick cannot act on it. A mutant spawned on a tick is first shot on the next one. Outside Night, `step()` clears all turret state, so cooldowns reset at dawn.
  - It holds only `{cooldown, targetId}` per turret, keyed by building id. HP, position and `enabled` stay in `BuildingPlacement`, power is derived, and mutant HP stays in `Mutants`. `snapshot()` is built from the live building list, so a destroyed turret disappears immediately. Records of destroyed turrets are dropped on the next step.
  - Range is circular and inclusive, measured from the footprint centre (`isInRange`, squared values, no `sqrt`).
  - **Targeting:** `selectMutant` acquires the nearest mutant in range, with ties going to spawn order. A lock is kept while the target is alive and in range, even if a nearer mutant arrives. It is reacquired when the target dies or leaves range, and cleared when the turret is disabled or unpowered. Reacquiring never changes the cooldown.
  - **Cooldown:** each powered tick it counts down, with or without a target. A ready turret fires the moment it has a target, then waits 30 ticks. It pauses while disabled or unpowered and resumes where it stopped, so toggling cannot beat the fire rate.
  - A consumer needs status `normal`, so LOW_POWER and BLACKOUT silence every Autocannon. A Plant destroyed on a tick affects turrets from the next tick.
  - Turrets act in building-list order and re-read living mutants each time, so a second turret never hits a mutant the first one killed. Hits resolve instantly; there are no projectiles.
- `src/core/settlement.js`:
  - `calculateSettlement(buildings)` is pure and integer-only, and uses `calculatePower`. Income counts only from **powered** buildings. Upkeep is always charged in full, whether a building is enabled or powered. It returns `{gross, upkeep, net, counts, power: {generation, demand, status}}` and throws `TypeError` on an unknown type.
  - `settleNight({day, buildings, economy, pollution})` is the single atomic night-end transaction, and `pollution` is required. There is no rollback:
    1. Calculate settlement and emissions, with no side effects.
    2. Prevalidate the current balances, `net`, `emitted` and both resulting totals as safe integers.
    3. Commit `pollution.add(emitted)`, then `economy.adjustCredits(net)`. Neither can fail for prevalidated values.
    4. Build the report, so it exists only after both commits.

    Any throw leaves Credits and pollution unchanged. It returns a frozen report `{day, gross, upkeep, net, creditsBefore, creditsAfter, counts, power, pollution: {before, emitted, after, threatLevel}}`, where `day` is the day whose night completed. The power state used is the one at the end of the night, for both income and emissions.
  - It never touches AP, buildings, enabled flags or the grid.
- `src/core/economy.js`:
  - `Economy({credits, ap})` defaults to `STARTING_RESOURCES` (1000 / 5). Balances are private, read through getters.
  - `canAfford(cost)` never changes anything. It checks in a fixed order: `invalid-cost` → `insufficient-credits` → `insufficient-ap` (`EconomyFailure`).
  - `spend(cost)` deducts both resources together, or neither.
  - `restoreAp(ap)` sets AP (used at the start of each Day) and leaves Credits untouched.
  - `adjustCredits(delta)` takes a safe integer only. It may take Credits **negative**, which is debt from nightly upkeep. Affordability is unchanged (`cost.credits <= credits`), so every purchase is rejected while in debt. Starting balances stay non-negative, and there is no bankruptcy rule yet.
  - `snapshot()` returns detached data.
- `src/core/buildingPlacement.js`:
  - `footprintAt(type, cell)` centers a footprint on the pointer cell: anchor = cell − floor((size − 1) / 2). For even sizes, the pointer cell is the left/top cell of the central pair.
  - `BuildingPlacement(grid, economy, {isConstructionAllowed})` provides `select`/`cancel`/`selectedType`/`isPlacing`. `select` returns false while construction is disabled.
  - Building records `{id, type, col, row, width, height, enabled, hp}` are the **single owner** of player power intent and of building HP. `enabled` starts as `true`; `hp` starts at the type's `maxHp`.
  - `damageBuilding(id, amount)` is the only way HP changes. It is not behind the construction gate and never touches the economy. At 0 HP it removes the grid cells and the record together, so a building is destroyed exactly once and later damage returns `unknown-building`. Invalid amounts return `invalid-state`. It returns `{ok, destroyed, hp}`. Damage persists across nights, and there is no repair yet.
  - **HQ rules:** `canBuild(typeId)` returns `{ok}` or `hq-required` / `hq-already-built`, and `select`, `preview`, `placeAt` and the menu all use it. One HQ per run is enforced by a latch (`hqBuilt`), so a destroyed HQ cannot be rebuilt, with or without `requireHq`. With `requireHq`, only HQ can be built until it stands. Placing HQ ends placement mode. `GameScene` always sets `requireHq`, except under `?hq=off`. The constructor default of `false` is legacy compatibility for unit fixtures; do not rely on it in new gameplay code.
  - `setEnabled(id, enabled)` is allowed in **both Day and Night**. It rejects a `switchable: false` type (HQ) with `invalid-state`. It is deliberately not behind the construction gate. It is free (no Credits or AP), touches neither the grid nor the economy, and is rejected with `unknown-building` or `invalid-state`.
  - `preview(cell)` and `placeAt(cell)` share one validation, in this order: the construction gate (`construction-disabled`, e.g. during Night Shift), then the HQ rules, then `grid.canPlace`, then `economy.canAfford`. Space reasons therefore win over resource reasons. `preview` never changes anything.
  - **`placeAt` is one atomic transaction:**
    1. Validate everything.
    2. Commit with `grid.place`, then `economy.spend`. If the spend fails, `grid.remove` undoes the grid change.
    3. Record the building and advance the id.

    A rejection leaves the grid, balances, buildings and next id unchanged. `no-selection` is returned when not placing.
  - Ids are deterministic (`outpost-1`, `factory-2`, …). `buildings()` returns a detached list.
- `src/core/simulationClock.js`: `SimulationClock`, a fixed 60 Hz clock (`TICK_RATE`).
  - Lifecycle: stopped → `start()` → running, with `pause()`/`resume()`. `reset()` returns to stopped with tick 0.
  - `advance(deltaMs, onTick)`: the accumulator. Each frame is capped at `MAX_FRAME_MS` = 100 ms (6 ticks) before it is added. Excess time is deliberately dropped, so there is no catch-up spiral. Does nothing while stopped or paused.
  - `stepTicks(count, onTick)`: exactly 1..240 ticks through the same callback. Allowed while paused, without unpausing. Does nothing before `start()` or after `reset()`.
  - `timeSeconds = tick / tickRate`. There is no wall clock and no timers.
- `src/core/seededRandom.js`:
  - `SeededRandom(seed)` is the Refit/BarrelStorm LCG with a uint32 seed (`DEFAULT_SEED` = 731). It provides `next()` in [0, 1), inclusive `nextInt(min, max)`, `reset()` (back to the seed) and `snapshot()` → `{seed, state}`.
  - `parseSeed(raw)` validates seed overrides.
- `src/core/shiftCycle.js`: `ShiftCycle({clock, economy, settleNight?})`, the Day/Night state machine.
  - Transitions: not-started → `begin()` → Day 1 → `endDay()` → Night → (the `NIGHT_TICKS` = 3600th executed tick) → Day N+1 → …
  - **Day:** the clock is running but paused, so Day never ticks. `isConstructionAllowed` is true.
  - **Night:** `endDay()` resumes the clock. `onTick()` (the fixed-step callback) counts `elapsedNightTicks`.
  - **Last night tick:** `onTick()` does the following, in order:
    1. Call `settleNight(completedDay)`. Its frozen report becomes `lastSettlement`.
    2. Start the next Day.
    3. Call `economy.restoreAp(DAY_AP = 5)`. This sets AP to exactly 5; it does not add 5.
    4. Pause the clock inside the tick. That ends `advance()`'s loop with no extra ticks.
  - **Exactly once:** this is the only place settlement is called, and Day never ticks.
  - **If the hook throws:** nothing changes. It is still Night with 1 tick left, the clock tick is not counted, and AP is not restored. The error propagates, and the final tick is retried on the next step.
  - `stepTicks(n, onTick)` is the QA path: Night only, clamped to the remaining night ticks. It steps one tick at a time and stops if the shift changes, because the clock's own `stepTicks` runs on after a pause. `resume()` is Night only.
  - **`canEndDay`:** a dependency that keeps the run in Day, used until HQ is built. `endDay()` then returns `hq-required`.
  - **`defeat()`:** Night only, and only once. It sets `Shift.DEFEATED`, records a frozen `defeatReport` `{day, nightTick, completedShifts}` and pauses the clock. Mutants act on ticks up to 3599, so a defeat always comes before settlement: that night earns and emits nothing. Afterwards nothing ticks, settles or builds, and `endDay` and `resume` are refused.
  - The global `clock.tick` is never reset.
- `src/scenes/BootScene.js`: Starts the game scene.
- `src/scenes/MutantLayer.js`: graybox circles for mutants and HP bars on damaged buildings. Presentation only; `sync(mutants, buildings)` takes detached snapshots.
- `src/scenes/AutocannonLayer.js`: graybox barrels, quantized to 8 directions, and short tracers lasting 6 simulation ticks. Presentation only; facing and tracer timing never affect gameplay.
- `src/scenes/GameOverLayer.js`: the Game Over overlay and RESTART button. Presentation only; nothing exists until `show()`. Its panel is interactive, so presses on it are UI, never grid input.
- `src/scenes/GameScene.js`:
  - Start hides the title and Start button and removes the `start` proxy. It then creates a 24×16 `Grid` with 32px cells at origin (256, 104), drawn with Phaser Graphics, and shows the build menu in the band left of the grid.
  - The HUD in the top band has two lines:
    - The shift line: `Day N · Day Shift`, or at night `Day N · Night Shift · 59.8 s left`, with `(paused)` added when the QA clock is paused. The countdown is `remainingNightTicks / 60`.
    - The resource line: `Credits: N   AP: N`.
  - The wave HUD sits at the top of the left band (x 16, y 20): `Mutants N | Wave X/Y`. `N` is living mutants, and `X/Y` is scheduled slots reached out of total, not kills. It is visible only while a night plan exists.
  - The pollution HUD sits at the top of the right band (x 1040, y 16): `Pollution N` and `Threat Level N`. It refreshes at Start and on each Day/Night change.
  - Both lines are created at Start, together with the `Economy` and `ShiftCycle`. The scene wires `settleNight` to `core/settlement.js` and contains no formulas.
  - The right band (x 1040) holds:
    - The power summary: `Power G / D` and the status label (NORMAL / LOW POWER / BLACKOUT).
    - The settlement panel with the latest report: `Night N settlement`, then Income, Upkeep, Net, Credits and Power. It is hidden until the first completed night.
    - The **power toggle** (proxy `toggle-power` with `data-target` and `data-enabled`). It is visible whenever an existing building is selected, in Day **and** Night, and calls `placement.setEnabled`.
  - `refreshPower()` re-derives power and restyles buildings after every placement, toggle and Start; it never runs per frame. Disabled buildings are drawn at alpha 0.35; enabled but unpowered ones get a red outline.
  - END DAY (proxy `end-day`) sits at the bottom of the left band and is visible during Day only.
  - **Keeping the UI in step:** `syncShiftUi()` runs after every clock advance, every QA step and END DAY. On each Day/Night change:
    - At Night it exits placement mode and hides the building buttons and END DAY, removing their proxies.
    - At Day it restores them and refreshes the resource line.
  - **HQ-first flow:** a new run offers only HQ. The other buttons and END DAY stay visible but disabled, and pressing them does nothing. Placing HQ unlocks them, marks HQ `BUILT` and enables END DAY. Proxies carry `data-state` (`available`, `locked`, `built`), and END DAY carries `data-enabled`. The toggle stays hidden for HQ.
  - **Defeat:** `syncShiftUi()` calls `enterDefeat()` once on `Shift.DEFEATED`: the phase becomes `defeated`, the play UI hides and the overlay shows `HEADQUARTERS DESTROYED`, the approved quote and `Completed shifts: N`. Grid input is ignored. RESTART calls `scene.restart()`, which returns to the title; `create()` rebuilds everything, so no custom reset exists.
  - The build menu has HQ, Outpost, Factory, Power Plant and Autocannon buttons (proxies `build-hq`/`build-outpost`/`build-factory`/`build-powerPlant`/`build-autocannon`, with `data-selected`). Their labels show the size and cost. There is also a Cancel button, visible with proxy `cancel-placement` only while placing.
  - **Normal mode:** `pointerdown` selects or highlights the cell from `pointer.worldX/worldY` via `grid.worldToCell`. If the cell is occupied, its building is selected too and the highlight covers the footprint. Normal mode never places. A pointer outside the grid clears the selection.
  - **Placement mode:** `pointermove` previews the footprint, and `pointerdown` attempts placement. Selection is cleared and disabled. Placement mode stays active after a successful placement. Escape or Cancel exits.
  - The preview color comes from the domain result: green when ok, red otherwise. An unaffordable footprint is red even when its cells are free.
  - Scene-level pointer handlers ignore events whose hit list (`currentlyOver`) contains a UI object, so a press on a button never counts as grid input.
  - QASurface exposes:
    - `grid`, `selectedCell`, `highlight`
    - `ui` (title, Start, Cancel, END DAY, build menu and power toggle visibility)
    - `power` (the domain `calculatePower` result, including per-building `enabled` and `powered`), `powerView` (the actual summary text) and `selectedBuilding`
    - `placement` (`selectedType`, the domain `preview` result, and `lastResult` from the last placement attempt)
    - `resources` (`economy.snapshot()`), `hudView` (the actual HUD text), `menuLabels` (the actual button labels)
    - `shiftCycle` (`{day, shift, elapsedNightTicks, remainingNightTicks}`, `null` before Start) and `shiftView` (the actual shift-line text)
    - `settlement` (the latest report, or `null`) and `settlementView` (the actual panel text and visibility)
    - `mutants` (domain records), `mutantViews` (rendered circles) and `hpBarViews` (rendered HP bars), all `null` before Start
    - `wave` (the frozen night plan, `null` outside a started Night), `waveProgress` (slots reached, or `null`) and `waveView` (the actual HUD text and visibility)
    - `menuState` (`available`, `locked` or `built` per type), `ui.endDayEnabled`, `defeat` (the defeat report, or `null`) and `gameOverView` (the actual overlay text)
    - `autocannons` (`{id, cooldown, targetId}` per turret), `barrelViews` and `tracerViews` (rendered views), all `null` before Start
    - `pollution` (`{value, threatLevel, emissionsPerNight}`, `null` before Start; `emissionsPerNight` is derived from the current buildings, and the amount actually emitted is `settlement.pollution.emitted`) and `pollutionView` (the actual HUD text and visibility)
    - `simulation`: `{running, paused, tick, timeSeconds, stepsExecuted, rng: {seed, state}}`
    - `previewView` (the rendered preview: visibility, rect, colors)
    - `buildings` (domain records, including `enabled`) and `buildingViews` (the rendered rectangles, including `alpha` and `strokeColor`)
  - **Simulation:**
    - The clock is created stopped. Start calls `cycle.begin()`, which starts it paused for Day 1.
    - `update(time, delta)` calls `clock.advance(delta, stepSimulation)` then `syncShiftUi()`, and ignores Phaser's `time`.
    - `stepSimulation(tick)` counts `stepsExecuted`, calls `cycle.onTick(tick)`, then `autocannons.step()`, then `mutants.step()`. Shots and destroyed buildings are handled from that tick's results: `handleBuildingsDestroyed` removes the views, clears a stale selection and calls `refreshPower()`.
    - The RNG seed is `DEFAULT_SEED`. In TEST_MODE only, `?seed=N` overrides it.
    - In TEST_MODE only, `?waveBudget=N` and `?stressRamp=N` (`src/testShadow/stressParams.js`) give the real `Mutants` a fixed schedule for the soak suites.
    - In TEST_MODE only, `?hq=off` is a compatibility mode for legacy suites written before HQ existed: no HQ button, no HQ rule, and END DAY is always allowed. Production ignores it.
    - In TEST_MODE only, `?mutants=off` gives the real `Mutants` an empty schedule instead of `nightPlan`. `boot(page, {mutants: false})` uses it for suites about power, economy and pollution. Combat tests must not use it, and production ignores it.
  - **TEST_MODE-only controls:** `window.__qa.sim` provides:
    - `pause()` → `clock.pause()` then `syncShiftUi()`
    - `resume()` → `cycle.resume()`, Night only
    - `stepTicks(n)` → `cycle.stepTicks(n, stepSimulation)` then `syncShiftUi()`. It uses the same callback as `update` and drives real shift transitions, and does nothing during Day.

    `window.__qa.perf` (`src/testShadow/PerfProbe.js`) provides `start()`, `stop()`, `counts()` and `renderer()` for the browser soak. It reports simulation, scene update, render callbacks and frame time separately, and classifies the rest as unattributed. Use it for real-time runs only; never derive frame rates from `stepTicks`.

    They can't place or spend. `GameScene` adds them; Test Shadow internals are unchanged. END DAY always resumes the clock, even after a QA pause.
  - Grid cells have no DOM proxies. E2E tests press real canvas points with `clickWorld`/`tapWorld`, and press buttons through their proxies with `clickAction`/`tapAction` (`tests/helpers/canvas.js`).

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

The simulation clock (`src/core/simulationClock.js`) and seeded RNG (`src/core/seededRandom.js`) are integrated in `GameScene`. They follow the Steel Abyss: Refit / BarrelStorm contracts: the 1/60 s accumulator, the 100 ms frame cap and the same LCG. The Day/Night `ShiftCycle` (`src/core/shiftCycle.js`), `Autocannons` (`src/core/autocannons.js`) and `Mutants` (`src/core/mutants.js`) consume ticks, in that order. The clock is paused for all of Day Shift and runs for exactly 3600 ticks per Night. Nightly settlement (`src/core/settlement.js`) runs once, at the end of the final night tick, and applies Credits and pollution together. There is no per-tick revenue or pollution. Mutant spawning is the only consumer of random numbers so far. New simulated systems must run inside `GameScene.stepSimulation()` and draw randomness from `this.rng`.

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
- Uses the real HQ-first flow by default. New tests must use it, with the helpers in `tests/helpers/hq.js`.
- `{hq: false}` adds `?hq=off`, a compatibility mode for tests written before HQ existed, or for states real play cannot reach. Each use carries a comment saying why. `power` and `settlement` stay isolated on purpose, because they test BLACKOUT and exact generation, which HQ makes unreachable. `autocannons`, `building-placement`, `economy`, `mutants` and `waves` stay isolated until a justified migration, and one `pollution` test stays isolated because it asserts blackout.
- Records failure-only diagnostics (`tests/helpers/bootDiagnostics.js`). A failed boot attaches `boot-diagnostics.json` and rethrows the original error. A successful boot adds no output and no waits.

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

### Efficient test execution

This policy applies to TASK 013 and all future tasks.

**During implementation:**

- Run only the unit tests directly relevant to the changed modules.
- Run only the affected Playwright spec files or targeted tests.
- When changing a shared fixture/helper, validate it with a representative desktop and mobile smoke subset before expanding coverage.
- Run targeted tests after each fix, not the entire suite.
- Do not repeatedly run full E2E, soak suites, builds, or mutation checks after minor edits.
- Do not run performance soak suites unless the change affects their contracts, lifecycle behavior, or measured performance.
- Use existing test selection mechanisms. Do not build a new test runner or introduce dependencies.

**Final verification, once the implementation is stable:**

1. Run the complete unit test suite.
2. Run the complete regular Playwright E2E suite with 3 workers and tracing disabled.
3. Run the production build and TEST_MODE isolation gate.
4. Run bounded, targeted mutation checks for new behavior.
5. Run relevant soak suites only when justified by the changes.
6. Check for orphaned processes and verify `git diff --check`.

**The smoke suite:**

The `@smoke` tag marks 13 existing tests covering boot, Start, mobile layout, HQ-first construction, placement, power and toggling, nightly settlement, combat, Game Over and restart. Keep it small. Add a tag only for a whole area that is not covered, not to raise a mutation score. Smoke is a fast signal, and it deliberately misses detail, so run it together with the unit suite: `npm run test && npm run test:smoke` takes about 17 seconds. See `docs/performance-baseline.md`.

**When a final gate fails:**

- Diagnose and fix the failure.
- Rerun the affected subset first.
- Repeat only the final gates potentially invalidated by that fix.
- Never hide failures, weaken assertions, or skip required final verification.

**Reporting:**

- Summarize which targeted tests were run during development.
- Report the final verification separately.
- Explain any skipped or deferred soak checks.

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

Implementation sequence (informational; only explicitly assigned tasks may start):

Complete:

- Bootstrap
- Grid integration
- Building placement
- Credits and Action Points
- Simulation clock and RNG
- Day/Night state machine
- TASK 008: Settlement
- TASK 009: Global Power
- TASK 010: Pollution and Environmental Pressure
- TASK 011A: Basic Mutant Foundation
- TASK 011B: Autocannon Defense
- TASK 012A: Night Wave Director
- TASK 012B: Combat Soak & Performance Baseline
- TASK 013: Headquarters, Defeat & Game Over
- TASK 014: Efficient Test Execution

Later, not yet assigned:

- Repeatable survival loop
- Hardening: `Economy` does not bound balances. The constructor accepts unsafe integers and `adjustCredits` validates the delta but not the result, so a balance can pass the safe-integer range and lose precision. `settleNight` prevalidates this for settlement; `Economy` itself is unchanged.

Known balance issues, accepted for now and not final behaviour (see the GDD):

- Corner camping: an HQ in a corner with one Autocannon survived all scripted runs.
- No-income turtling: a defense-only build with no Factory survived 20 scripted nights.

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