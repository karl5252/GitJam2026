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
## MANDATORY: RISK-BASED TESTING ONLY

All development tasks MUST use risk-based testing unless the user explicitly instructs otherwise.

**Default behavior:**

- Run only tests directly relevant to changed code and its immediate dependencies.
- Prefer targeted unit tests and narrowly scoped E2E specifications.
- Reuse existing test coverage wherever practical.
- Do not run the entire unit suite automatically.
- Do not run the full E2E suite automatically.
- Do not run broad smoke suites, browser soaks, mutation campaigns or lengthy simulation benchmarks automatically.
- Do not rerun passing tests without a relevant code change or demonstrated reason.
- Do not add unrelated tests merely to increase coverage numbers.

**When broader testing appears necessary:**

1. Identify the specific regression risk.
2. Explain why targeted coverage is insufficient.
3. Ask for explicit user authorization before running the broader suite.

A task being finished is NOT sufficient justification for a full regression run.

A test suite existing is NOT sufficient justification for running it.

A successful process exit code is NOT sufficient evidence that all tests passed.

**Agent efficiency requirements:**

- Implement the smallest correct change.
- Avoid unrelated refactoring.
- Do not expand task scope without authorization.
- Stop after the agreed acceptance criteria are demonstrated.
- Report actual test counts, failures and unresolved risks.
- Never terminate a development server or process that the agent did not start.

**This policy applies to all subsequent tasks unless the user explicitly overrides it.** It takes precedence over anything else in this file about when tests run, including section 9.

---

## 1. Project

**PAPI Industries: The Green Shift** is an industrial survival tower-defense game developed for GitHub Game Off 2026.

**Technology:**
- Phaser 4 (ESM)
- JavaScript (no TypeScript)
- Vite
- Node.js built-in test runner
- Playwright for E2E testing

**Target platforms:** Desktop browsers and mobile browsers in landscape orientation.

**Current status:** TASK 023 (HEAVY METAL) is complete. TASK 024 (HUD Reconstruction & Mobile UX) and TASK 024.1 (Mobile Building Ghost & Two-Step Placement) are implemented and uncommitted, awaiting the developer's review and a real-device test. TASK 025.3 (Workers & Work Flag) is implemented and uncommitted, awaiting the developer's review. TASK 025.4A (Active Day, Dusk & Terrain Movement, with its follow-up: Day 0, the persistent work flag and the Day speed reset) is implemented and uncommitted, awaiting the developer's review. TASK 025.4B (Jungle Clearing & Pollution) is implemented and uncommitted, awaiting the developer's review. TASK 025.4C (Paid Building Repairs) is implemented and uncommitted, awaiting the developer's review. TASK 026 (Deposits & Mines, which supersedes the old TASK 020 backlog item) is complete: playtested and accepted by the developer. TASK 027 (ECOLOGISTAS! Daytime Environmental Protests) is complete: playtested by the developer. TASK 027.1 (Worker DISPERSE) is implemented and approved; not yet playtested. Only work on tasks the developer explicitly assigns.

The project was initialized from the Wee Games Starter Kit Basic. The original demo applications have been removed.

Implemented so far: grid placement, Credits and AP, the active Day/Dusk/Night cycle (an untimed Day 0 for the first build, then timed Days with pause and speed controls), Factories and trucks that work by Day and Night, terrain-dependent walking for workers and soldiers, worker jungle clearing that adds Pollution, paid building repairs by HQ's workers, a Night tint, global power, nightly settlement, pollution and derived threat, one basic mutant type that damages and destroys buildings, the Autocannon, which kills mutants, and nightly waves that scale with the night, Threat Level and Autocannon count, a player-built HQ whose destruction ends the run, Night speed controls, a road network, Factories that earn only when trucks deliver GOODS to HQ, walls and gates that mutants must breach or go round, Barracks that deploy squads to a rally flag each Night, Spitters, the first ranged mutant, from Night 5, Brutes, a slow breaching mutant, from Night 30, and two heavy counters, the Siege Cannon and Rocket specialization for Barracks. Repairs are explicit orders on a damaged building, carried out by HQ's workers by Day.

### Game concept

The player manages an industrial facility in San Papi.

During the **Day Shift**, the player builds infrastructure, manages resources, allocates power, and prepares defenses.

During the **Night Shift**, automated defenses protect the facility from mutant creatures emerging from the surrounding jungle.

Industrial expansion increases pollution, which contributes to escalating threats.

The game combines economic decisions, tower defense, environmental consequences, and satirical corporate propaganda.

**Primary design goal:** Create a small, complete, enjoyable game. Avoid unnecessary complexity.

The Game Design Document, `docs/PAPI_Industries_GDD_v0.4.md`, is the source of truth for gameplay requirements. This file defines implementation constraints and development practices.

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
- `src/core/workers.js`: `Workers({cycle, placement, grid, gates, economy?, roads?})`, HQ's squad, with provisional values in `WORKER` (`squadSize` 3, `maxHp` 15, `speed` 1 on open ground, `flagCost` 1 AP, `visionRadius` 6, `workRadius` 3, which nothing reads yet). `step()` runs after `Infantry.step()` and before `Mutants.step()`; `addGateDemands(wanted)` runs with the soldiers'.
  - **Lifecycle (ACTIVE cycle):** people, not tokens. A worker outside keeps its id, HP and position across every phase, and nobody moves except by walking. They leave HQ one at a time, by Day only. Dusk recalls them on foot; a straggler still outside at Night stays outside, walking home, and can be hit. At each dawn `inside` becomes 3 less anyone still outside, so the dead are replaced then and a survivor is never doubled. `lost` counts deaths since that dawn.
  - **Flag (ACTIVE cycle):** the flag and `sent` are separate. `setFlag(cell)` puts the flag down or moves it and sends the squad: 1 AP for a tile that differs from the current flag (`flagCostsAp(cell)`), nothing for the same tile. `dispatch()` (SEND WORKERS) sends the squad to the flag already down, free; `recall()` brings it home, free, and keeps the flag; it is refused only in a paused Day (`game-paused`), like every other order. Dusk's own recall is the simulation's and is never refused. Placing, moving and sending need a running timed Day: `game-paused` while paused, otherwise `work-flag-day-only` in Day 0, during END DAY's fast-forward, at Dusk or at Night. `dispatch()` with no flag is `work-flag-missing`. The flag lasts across Dusk, Night and dawn; Dusk only sets `sent` to false, so the next Day reuses it for nothing. `snapshot()` adds `sent`.
  - **LEGACY cycle:** the old rules. Workers exist on Night ticks 1..3599 while a flag is down and are all inside at dawn. `setFlag` is free, Day or Night, and `recall()` removes the flag. `snapshot()` keeps its old shape.
  - **Flag, both cycles:** held here, not on the HQ record, so layouts, `placement.revision` and combat digests never see it, and it is not saved. Any free tile, including jungle and unexplored tiles, and it reveals nothing. It refuses `work-flag-out-of-bounds`, `work-flag-occupied` and `work-flag-unreachable`. `route()` derives `{exit, post, flag, blocked}`, by Day too: a flag walled off later is `blocked`, nobody goes, and it works again when a way opens.
  - **Guard:** a building cannot go on a tile a worker stands on or is stepping into (`unit-in-the-way`).
  - **Movement:** the soldiers' navigation from `walkField.js`, with the tile-stepping repeated here, at the speed of the ground underfoot (`terrainSpeed.js`). They leave from `receivingDock(hq)`, a road tile that is always free, and may share tiles. At the flag each walks to its `SLOTS` place and stops. Moving the flag or recalling finishes the current edge first, so nobody teleports. A gate is waited for and held as soldiers do.
  - **Vulnerability:** `attackable()` joins the soldiers' list in `Mutants`, marked `worker`, so mutants reach, are lured by and shoot at workers exactly as at soldiers, soldiers first on ties. `damageWorker(id, amount)` is the only way worker HP changes.
  - **Vision:** the `workers` group in the fog, updated with `soldiers` every tick.
  - **Repair orders (ACTIVE, timed Day only, GDD v0.4 section 2B):** values in `REPAIR` (`hpPerBlock` 10, `ticksPerBlock` 60, `share` 3/5, `hqCreditsPerHp` 1, all provisional). The player orders a repair on a damaged building (`orderRepair`, the building's REPAIR button); it is not tied to the flag or its area. Placing and stopping orders follow the dispatch rules: a running timed Day only, `game-paused` while paused (STOP REPAIR too), `work-flag-day-only` otherwise. Each order takes one worker, the nearest free one by travel time from its tile (a worker outside before one leaving HQ on equal time, then id order), and outranks clearing: the worker drops its jungle tile, whose progress stays with the tile. No queue: at most one order per living worker, three at most (`repair-no-worker`). The worker walks to the free tile beside the footprint it reaches soonest and works from its centre (`repairing`); every `ticksPerBlock` ticks there it pays for one block (`repairBlock`), then restores up to `hpPerBlock` through `placement.repairBuilding`. Price: `repairPrice(type, missing)` is 60% of the construction Credits for full HP, in proportion, rounded half up; HQ is 1 Credit per HP. A block costs the difference between the price of the HP missing before and after it, so a whole repair costs exactly the rounded total, whatever stops and resumes happen (at most half a Credit of rounding per session, never per block). No AP. A block it cannot pay for cancels the order (`repair-no-credits`, reported by `step()` as `{cancelled}`) and frees the worker; HP stays, nothing goes into debt, and nothing resumes by itself. An order ends when the building is whole, destroyed or demolished, or on `stopRepair`. Dusk sends the worker home as usual; the order and its partial block wait, and the next running Day sends a worker from HQ if its own went inside or died. `repairOrder`, `canRepair(id, {quick})` (quick skips the walk fields, for a button drawn every frame), `repairs()` (`{orders, spent, restored}`, also in the ACTIVE `snapshot()`). Worker records add `repair` and `repairing`.
  - **DISPERSE (TASK 027.1, ACTIVE, timed Day only):** values in `DISPERSE` (`workers` 2, `ticks` 120, provisional). `setEcologists(e)` connects the protesters. `orderDisperse(groupId)` needs a gathering or protesting group (`ecologists.protest(id)`), and follows the dispatch rules (`game-paused`, `work-flag-day-only`). One dispersal at a time (`disperse-busy`); repairs plus 2 per dispersal never exceed 3 workers. It takes the two free workers (never one on a repair) and two distinct free tiles touching the site N/E/S/W, never the site, matched quickest pair first (a worker outside before one leaving HQ on equal time, then id, then tile order), all reserved before the order is accepted. It is refused with `disperse-no-workers` or `disperse-unreachable`, and changes nothing. A taken worker leaves its jungle tile, whose progress stays with the tile; workers still inside leave HQ for it. Once both stand at their tiles' centres, 120 ticks later `ecologists.disperse(id)` sends the group FLEEING (the block goes that tick) and the order ends. `cancelDisperse` (CANCEL DISPERSE) ends it at once, free; so does the protest ending, fleeing or leaving, a worker going, or a tile being lost. On release each worker returns to the jungle tile it left if that is still jungle, unclaimed and the flag has not moved; otherwise the usual flag rules. Repairs are unchanged. Dusk cancels unfinished orders and the usual recall follows. Assignments are kept off worker records, so `workers()` and existing digests are unchanged; the ACTIVE `snapshot()` adds `dispersals` only where protesters exist. `canDisperse(id, {quick})`, `disperseOrder(id)`, `dispersals()`.
  - **Jungle clearing (ACTIVE, timed Day only):** values in `CLEARING` (`radius` = `workRadius` 3, `ticksPerTile` 300, `pollutionPerTile` 1, all provisional). The work area is jungle within the radius of the flag, circular as Fog of War measures. A worker takes jobs only after reaching the flag tile (`arrived`). Workers choose in id order: each takes the free jungle tile in the area that it reaches soonest from its own tile (the terrain-aware walk field), ties by row then column, never one another worker holds (`job`), and keeps it until done. It walks onto the tile and works from its centre (`working`); each such tick on a running Day adds one to the tile's progress, which belongs to the tile, so recall, Dusk, a flag moved elsewhere or a death keep it and nothing advances without a worker there. At `ticksPerTile` the terrain is cleared and Pollution rises by `pollutionPerTile`, through the existing `Pollution`, once. With nothing left, workers wait at the flag. Navigation is rebuilt once on the next tick, however many tiles fell. `clearing()` and the ACTIVE `snapshot()` give `{progress, cleared, ticksPerTile}`. The dependency is `pollution`. Daytime Pollution can raise the Threat of the next Night's plan, made on Night tick 1; a Night already planned never changes.
- `src/core/ecologists.js` (TASK 027): `Ecologists({cycle, placement, grid, roads, pollution, mutants, seed})`, neutral protesters, with provisional values in `ECOLOGIST`. Only on a map with terrain and roads, in the ACTIVE cycle; never in Day 0, the LEGACY cycle, on the open map or under `?hq=off`. `step()` runs after `Mutants.step()` and before `Logistics.step()`.
  - **Arrivals:** on each timed Day, `groupsFor(Pollution)` = `min(3, 1 + floor(Pollution / 40))` groups, on Day ticks 600, 1500 and 2400. A group comes only if an **active producer** (a Factory or Mine that `power.js` reports powered) has a road route to HQ. 3 or 4 ecologists walk in one at a time (30 ticks apart) from the dirt path's map-edge tile (`terrain.path`, the first tile not built on), at worker speed and on the ground's speed. Randomness (group size, site) comes from its own `SeededRandom` (the game seed mixed with `ECOLOGIST.salt`), so terrain and mutant draws are untouched.
  - **Sites:** a player road tile on an active producer's route to HQ, never the HQ ring, a dock or a gate. Walking uses `walkField.js` with every gate treated as a wall, so protesters never cross or open a fortification. A group that cannot reach any route tile protests on the reachable non-road tile nearest one and blocks nothing: walls and gates are the counter. A site built over before the protest ends sends the group home.
  - **Protest:** once every member stands at the site, 900 ticks (frames 8-11), then they walk back out (LEAVING) and are removed on the exit tile. One protest per group. `blockedTiles()` is the sites of protesting groups with members standing on them.
  - **Trucks:** `Logistics.setBlockers(fn)`. A truck at a tile centre waits while its next tile is blocked, like a gate, keeping route and cargo, and drives on by itself. One already on the tile drives off it. Without blockers nothing changes.
  - **Dusk and Night:** Dusk ends every protest at once and removes every block. Every ecologist still on the map turns FLEEING and runs for the exit at `fleeSpeed` 2 (twice the walk; terrain multipliers still apply). Nobody is removed because Night comes: survivors keep running through the Night, and the next Day if need be, and leave only on the exit tile. They never protest or block again.
  - **Mutants:** 1 HP. After `Mutants.step()`, an ecologist within `bodyRadius(mutant) + 6` px of any mutant dies (DEAD) and stays as a corpse for 120 ticks (frame 12 for 18 ticks, then 13), blocking, moving and guarding nothing, then is removed. Mutants are only read: they never target, stop for or gain anything from ecologists, so combat is unchanged tick for tick (tested). Runners usually leave the spawn frame during the 300-tick Dusk, so a Night death needs a straggler or a mutant out beyond the frame.
  - **Guard:** nothing can be built on a tile a living ecologist stands on or is stepping into (`unit-in-the-way`).
  - **For DISPERSE (TASK 027.1):** `protest(id)` (a gathering or protesting group, or null), `protestAt(cell)` (the group whose site, or one of whose people, is on the tile) and `disperse(id)` (FLEEING at once, counted in `totals.dispersed`). A dispersed group never protests again.
  - `snapshot()`: `{ecologists, groups, blocked, exit, totals: {groups, arrived, protests, escaped, killed}}`. QA: `ecologists`, `ecologistViews`.
  - **Soldiers:** none by Day (Option A). Infantry is unchanged; the Loudspeaker Tower (TASK 028) is the planned active counter.
- `src/core/vision.js`: Fog of War. Pure, and nothing in the simulation reads it. `FogOfWar({cols, rows, explored})` holds each tile as UNEXPLORED, EXPLORED or VISIBLE. What is visible is the union of every source in every group; `setSources(group, sources)` replaces one group and recalculates only if its sources differ, so a unit that stays on its tile costs nothing. A source is `{col, row, width, height, radius}`, and a tile is seen if its distance to the footprint is within the radius, circularly, in whole numbers. EXPLORED is never lost. `markExplored(cells)` makes tiles known without making them VISIBLE. `stateAt`, `isVisible`, `revision`, `snapshot()` (rows of `#`, `~`, `O`).
  - **Radii:** `VISION_RADIUS` is the one place they live: `unit` 6, `building` 6, `turret` 7, `outpost` 12, in tiles, all provisional. `visionRadiusOf(type)` is `null` for walls and gates.
  - **Sources:** `buildingVision(buildings, power)`: every standing building sees, powered or not, except an Outpost, which needs to be `powered`, so LOW_POWER and BLACKOUT blind it. `unitVision(units, grid, radius)` turns anything with `{x, y}` into moving sources. `fortificationTiles` gives wall and gate tiles, which become known and scout nothing. `startingKnown(terrain)` is the clearing and the trees at its edge, EXPLORED from the start, so there is something to see before HQ.
  - **Updates:** `GameScene.refreshPower` updates the `buildings` group, because anything that changes a building's vision also goes through it. `stepSimulation` updates the `soldiers` group every tick, last, so what a unit discovers cannot depend on frame rate or speed. A new mobile unit is one more group and one more `unitVision` call. Vision radius is the only radius here: a work radius belongs to the unit.
  - **Concealment:** EXPLORED only dims, so `MutantLayer.sync` takes `isSeen` and hides mutants, Spitter aim lines, shells, rings and deaths on any tile not VISIBLE, and the wave HUD counts only seen mutants. `Wave X/Y` is unchanged. QA's `mutants` still reports them all. The open map has no fog: `isSeen` is null and nothing is hidden.
- `src/core/worldMap.js`: what a run is played on, as data. `open` is the original 24×16 battlefield with no terrain, and `jungle` (`DEFAULT_MAP`) is 48×32. Tile size is 32 on both. `createTerrain(map, seed)` gives a map's terrain, or `null`. A shipped game always plays `jungle` on `DEFAULT_SEED`. In TEST_MODE only, `?map=open|jungle` and `?worldSeed=N` override that (`src/testShadow/worldParams.js`); `?worldSeed` is the terrain and `?seed` is the wave RNG, and neither affects the other. `boot()` adds `map=open`, so suites stay on the open map unless they pass `{map: null}` for what a new game gets, or `{map: 'jungle'}`.
  - **`spawnFrame`:** the night's length and walking speed were set for the open map, and from the border of a 48×32 map a late wave would never arrive. So on `jungle` mutants spawn on a centred 24×16 frame, `{col: 12, row: 8, cols: 24, rows: 16}`, which lands on the same world pixels and the same 80 positions as the open map's border. `tests/unit/terrain.test.js` holds a translated base to the same tick-by-tick combat digests on both maps. A building on the frame (only possible where the path crosses it) is handled like one on the open map's border: a fortification puts the mutant one step outside the frame, and it then walks or detours as usual.
- `src/core/deposits.js` (TASK 026): `generateDeposits` places ore deposits for `generateJungle`, from its own stream (`seed ^ DEPOSIT.salt`), after the terrain is finished, so the terrain, its snapshot digest and the game's RNG are unchanged. Values in `DEPOSIT` (provisional): 3 deposits on different sides of the clearing (N, E, S, W); the first with its 2x2 core 3 to 5 jungle tiles from the generated clearing (never from HQ), the others 5 to 9; 7 to 12 tiles each, grown at random from the core and never a rectangle; under jungle only, more than 2 tiles from the dirt path, off the spawn frame's ring, more than 3 tiles from each other. The core is always a valid Mine footprint, and its south dock `{col + 1, row + 2}` is in the map, free of ore, off the ring and has a road way to the clearing. A seed sweep in `tests/unit/mines.test.js` guards all of it. On the default seed every deposit lies beyond the spawn frame.
  - `Terrain` adds `deposits`, `depositAt(col, row)` (an id or `null`, whatever grows there) and `depositSnapshot()`. Deposits are kept out of `snapshot()`, which stays pinned. Clearing reveals a deposit and changes nothing about it; roads and other buildings may stand on deposit tiles and consume nothing. Deposits never deplete. QA: `deposits`.
  - **Discovery:** the fog hides everything on UNEXPLORED tiles. `TerrainLayer` paints subtle surface signs over the canopy (a faint rust stain and a stone, always on the core, on about a third of the other tiles) into the generated picture, so they show once a tile is explored. The ore itself (irregular polygon lumps in ochre, rust and slate, thinning at the cluster's edge and spilling over tile lines) is on its own transparent picture (`<key>-ore`) and is copied in only by `clearTiles`, so only cleared ground shows it. `view()` adds `oreRevealed`.
- `src/core/terrain.js`: `generateJungle({cols, rows, seed, spawnFrame})` gives a `Terrain`, fixed by its seed except for clearing: `kindAt(col, row)` (`jungle`, `clearing`, `path`, `cleared`, or `null` off the map), `isBuildable`, `center`, `core`, `path` (the track's middle, from the map edge) and `snapshot()`, whose rows are strings of `#`, `.` and `=`. It draws from its own `SeededRandom`, never the game's, and uses integers and `sqrt` only, so a seed is the same map on every engine. A seed that is not a uint32 throws `RangeError`.
  - **Clearing:** one run of open tiles per row, each holding the centre column, so it is one piece. `CLEARING.core` (13×9) is always open, which fits HQ and its ring, a Factory on a road, a Plant, cannons and a Barracks on any seed. It stays inside the frame, with jungle between them.
  - **Path:** two tiles wide, unbroken, from a seeded map edge into the clearing. It is open ground and nothing more: not a road, no dock access, no income, no cost. Buildings and roads go on it like any open ground. Trees the track curls round become open ground too, so there are never pockets of jungle.
  - **Jungle** blocks buildings and roads, and nothing else. Mutants, soldiers, shells, spawns and rally flags ignore it, and it does not occupy the Grid. Workers walk through it at x0.65.
  - **Clearing:** `clear(col, row)` turns one jungle tile into `cleared` ground (`,` in `snapshot()`) for the rest of the run and returns true; anything else returns false, so nothing is cleared twice. Cleared ground is buildable open ground (x1.0 to walk). `revision` counts clearings. A new run generates a new `Terrain`, so nothing cleared outlives its run. Everything that asks the terrain (`Grid.isBuildable`, placement, previews, roads, `groundAt`) sees the change at once; walk maps are rebuilt from `terrain.revision`.
- `src/core/grid.js`: `Grid` class (Phaser-free). Configurable `cols`/`rows`/`tileSize` with an origin offset (`originX`/`originY`). World↔cell conversion (`worldToCell`, `cellToWorld`, `cellCenter`, `footprintRect`). NxM footprints `{col, row, width, height}`, anchored at the top-left cell. `canPlace`/`place` are atomic and return `{ok}` or `{ok: false, reason}`, where reason is one of `PlacementFailure`: `invalid-footprint`, `out-of-bounds`, `occupied` (plus `blockers`), `duplicate-id`. Also `remove`, `occupantAt` and `snapshot()`, which returns detached JSON data. The grid is the source of truth for occupancy and validity. With an optional `terrain`, `isBuildable(col, row)` answers for the ground, `canPlace` refuses a footprint with `terrain-blocked` (after `occupied`), and `RoadNetwork` refuses a road or an HQ ring tile the same way. Without one, nothing changes.
- `src/core/buildingTypes.js`: frozen plain data, with temporary graybox values. `getBuildingType(id)` returns the type or `null`.
  - `hq`: 3×3, costs `{credits: 0, ap: 0}`, operations `{income: 0, upkeep: 0}`, power `{supply: 20, demand: 0}`, `pollutionPerNight: 0`, `maxHp: 600`, `switchable: false`, `demolishable: false`. Its power joins the global pool, so `power.js` has no special case. Generation never reaches 0 while HQ stands, so BLACKOUT does not occur in normal play.
  - `outpost`: 1×1, costs `{credits: 100, ap: 1}`, operations `{income: 0, upkeep: 0}`, power `{supply: 0, demand: 10}`, `pollutionPerNight: 0`, `maxHp: 100`.
  - `factory`: 3×3, costs `{credits: 400, ap: 1}`, operations `{income: 0, upkeep: 0}` (it earns through deliveries, see `src/core/logistics.js`), power `{supply: 0, demand: 40}`, `pollutionPerNight: 8`, `maxHp: 300`.
  - `powerPlant`: 3×3, costs `{credits: 500, ap: 1}`, operations `{income: 0, upkeep: 0}`, power `{supply: 100, demand: 0}`, `pollutionPerNight: 12`, `maxHp: 300`.
  - `autocannon`: 1×1, costs `{credits: 250, ap: 1}`, operations `{income: 0, upkeep: 0}`, power `{supply: 0, demand: 20}`, `pollutionPerNight: 0`, `maxHp: 150`. It is a separate defensive building; Outpost is not a turret.
  - `mine` (TASK 026, last in `BUILDING_TYPES`): 2×2, costs `{credits: 500, ap: 1}`, power `{supply: 0, demand: 30}`, `pollutionPerNight: 10`, `maxHp: 250`. It earns through deliveries (`MINE_OUTPUT` in `logistics.js`). It needs all four tiles on one deposit (`no-deposit`, after the grid's reasons, so uncleared jungle is `terrain-blocked`), one Mine per deposit (`deposit-taken`), then the road rules: a road on the footprint is `road-occupied`, and its south dock (`shippingDock`) must be a connected road (`no-road-access`; the hint names the bottom side). Offered only on a map with deposits and roads. Art: `buildings/mine.png`, one 32x32 frame at 2x, `offsetX` 19 and `offsetY` 14 so its doorway (source columns 9..19, sill at row 26) stands over the dock with its sill on the footprint's bottom edge; it overhangs 19 px east and 12 px south. QA `buildingArtViews` gives each sprite's `doorway`.
  - `barracks`: 3×3, costs `{credits: 400, ap: 1}`, operations `{income: 0, upkeep: 0}`, power `{supply: 0, demand: 30}`, `pollutionPerNight: 0`, `maxHp: 300`. It has a road exit and no truck. See `core/infantry.js`.
  - `siegeCannon`: 2×2, costs `{credits: 600, ap: 1}`, operations `{income: 0, upkeep: 0}`, power `{supply: 0, demand: 20}`, `pollutionPerNight: 0`, `maxHp: 250`, target bias 64. It needs no road. See `core/siegeCannons.js`.
  - `BarracksRole` is `rifle` or `rocket`, and `REFIT_COST` is `{credits: 200, ap: 1}`.
  - `wall`: 1×1, costs `{credits: 25, ap: 0}`, no operations, power or pollution, `maxHp: 100`, `switchable: false`, `fortification: true`.
  - `gateVertical`, `gateHorizontal`: 1×1, costs `{credits: 100, ap: 1}`, `maxHp: 150`, otherwise as `wall`, plus `gate: {tier, orientation, passageAxis}`. A Vertical Gate is a vertical barrier across an east-west road, so its `passageAxis` is `x`. Both are generated from `GATE_TIERS` × `GATE_ORIENTATIONS`, so a future tier is one row of data. Only `standard` exists; Reinforced Gates are future scope.
  - `fortification` means: never a mutant target, does not displace a spawn, and stays out of the main menu loop. Walls and gates are ordinary building records, so HP, damage, HP bars, selection and snapshots need no special path.
- `src/core/power.js`: `calculatePower(buildings)` → `{generation, demand, status, buildings: [{id, type, enabled, powered}]}`.
  - One global pool, derived on demand from the building records and never stored. It is pure and does not mutate its input.
  - Generation and demand count **enabled** buildings only.
  - `PowerStatus`:
    - `normal`: generation ≥ demand, including 0/0.
    - `low-power`: 0 < generation < demand.
    - `blackout`: generation is 0 and demand > 0.
  - A consumer is `powered` only when it is enabled and the status is `normal`. Low power and blackout stop **all** consumers; there is no priority or partial allocation. A generator is powered when enabled.
  - `causesLowPower(buildings, typeId)` is pure: would adding this type take the pool from NORMAL to LOW_POWER? It changes nothing and no rule uses it; see the warning in `GameScene`.
- `src/core/pollution.js`:
  - `threatLevel(pollution)` is pure and is the only source of threat, which is never stored: 0-24 = 1, 25-49 = 2, 50-99 = 3, 100+ = 4.
  - `calculateEmissions(buildings)` is pure and sums `pollutionPerNight` over buildings that `calculatePower` reports as `powered`. Disabled buildings and unpowered consumers emit nothing.
  - `Pollution(value = 0)` has a private value, read through `value` or `snapshot()` → `{value}`. `add(amount)` validates the amount and the resulting total as safe integers before changing anything. There is no decrease, so it never goes negative and never decays.
- `src/core/waves.js`: pure night wave planning, with temporary graybox values in `WAVE`. No state, clock or randomness.
  - `nightBudget = 1 + floor((night - 1) / 2)`, `pollutionBudget = 2 * (threatLevel - 1)`, `defenseResponse = min(4, floor(max(0, autocannonCount - 1) / 2))`, `accelerationBudget = floor(max(0, night - 6)^2 / 12)`, `budget = min(40, nightBudget + pollutionBudget + defenseResponse + accelerationBudget)`.
  - `lastSpawnTick(night) = max(1200, 2700 - 100 * max(0, night - 6))`. Acceleration and the window depend only on the night, so pressure rises without Pollution. Nights 1 to 6 are unchanged.
  - `waveSchedule(budget, lastTick = 2700)` gives strictly increasing integer ticks from 600 to `lastTick`, with gaps that shrink through the night, so at most one mutant spawns per tick. Final gaps that round to zero are walked back to their own ticks, and a budget that cannot fit the window throws `RangeError`.
  - `nightPlan({day, pollution, buildings})` returns a frozen plan `{day, threatLevel, autocannons, nightBudget, pollutionBudget, defenseResponse, accelerationBudget, budget, lastSpawnTick, schedule}` holding numbers only. Every existing Autocannon and Siege Cannon counts as one stationary gun in `defenseResponse`, enabled or not, powered or not, and the plan adds `siegeCannons`. Barracks are not counted. Threat Level is derived from pollution here and stored nowhere else.
  - `waveProgress(plan, elapsedNightTicks)` counts scheduled slots reached.
  - **Spitters:** values in `SPITTER_WAVE`. `spitterCount(night, budget)` is 0 before Night 5, then `min(6, floor(budget / 4), 1 + floor((night - 5) / 3))`. `spitterSlots(budget, spitters)` gives evenly spread, centred indices into the schedule, never slot 0 in a real plan. A Spitter takes the place of one ordinary mutant, so `budget`, `schedule` and every other term are unchanged. The plan adds `spitters` and a frozen `spitterSlots`.
  - **Brutes:** values in `BRUTE_WAVE`. `bruteCount(night)` is 0 to Night 29, then 1, 2 from Night 35 and 3 from Night 40, by the Night alone: from Night 29 every base is at the cap of 40, so a Brute always has room. Each costs `slotCost` (3) slots. `bruteSlots(budget, taken, brutes)` places them after Spitters, whose slots never move, in the first half of the schedule and never in slot 0, then claims the next free slots as `absorbedSlots`. An absorbed slot keeps its tick and its RNG draw, counts as reached, and spawns nothing, so the schedule and everyone else's spawn position are unchanged. The plan adds `brutes`, `bruteSlots` and `absorbedSlots`.
- `src/core/mutants.js`: `Mutants({cycle, placement, grid, rng, schedule, planNight})`, temporary graybox values in `MUTANT`, `TARGET_BIAS` and `LURE_RANGE`.
  - `planNight(day)` is called once per night, on night tick 1, and the plan stays frozen until dawn. That equals sampling at END DAY: pollution only changes during settlement, construction is off at night, and no mutant exists yet. A night's emissions therefore affect the next night's plan. `plan()` returns the plan, or `null` outside a started Night. A fixed `schedule` array is used when there is no `planNight`.
  - Positions are world pixels from the Grid. `speed` is 0.5 px per tick. All distances are Manhattan distances to a footprint rectangle (`distanceToFootprint`).
  - **Fortifications:** a step blocked by a fortification runs one breadth-first search (`#planDetour`, N, E, S, W order) to a free tile orthogonally next to the target's footprint, never an occupied one. A mutant that finds a path follows tile centres; one that does not attacks the blocker. **NO PATH never means NO ATTACK:** there is no searching state, a search runs once per block, and everything that blocks can be destroyed. `DETOUR` limits one detour to 12 tiles beyond the direct distance, and a mutant's whole life to 24 extra tiles and 4 plans, spent on success and never refunded. Detour state lives in a `WeakMap`, not on the record, so `snapshot()` and the digests of layouts without walls are unchanged; `detours()` reports it. With no fortifications none of this runs.
  - **Gates:** an OPEN gate lets a step through along its `passageAxis` only; from the side it is solid. OPENING and CLOSING are solid. A gate attacked as an obstacle stops being one as soon as it lets the mutant pass. A gate can close on a mutant in the doorway, which then attacks it like any obstacle.
  - **Blocker lookup:** the Grid is asked about the up to four tiles touching the point, so cost does not grow with walls. It uses `gridBlockerAt`, which a test sweeps against the plain definition, `blockerAt`.
  - **Trucks:** with a `logistics` dependency, a truck within melee range stops a mutant, which counts as stationary, and the attack timer's hit lands on the truck before any building. A truck counts as one road tile for range. Mutants never seek trucks out, and truck hits are not in `effects`.
  - **Soldiers:** connected with `setInfantry`, because Infantry needs Mutants too. Never strategic targets, and `targetId` never changes for one. A soldier in melee reach stops a mutant, after any truck and before any building. A walking mutant within `LURE_RANGE` (64) of the nearest soldier steps towards it only while the whole way there is clear (`#clearWay` walks it in advance). Nothing is remembered, so a blocked lure walks on as usual and a breach or open gate counts at once. Where a mutant walks next depends only on where it stands, so every step of a clear way stays clear and it cannot flip between a soldier and its target. A mutant attacking anything, or on a detour, is not lured. Soldier hits are not in `effects`.
  - `step()` runs once per tick, **after** `ShiftCycle.onTick()`, and returns `{spawned, attacks, destroyed}` for that tick. Mutants act on night ticks 1..3599; tick 3600 only settles. A retried final tick therefore cannot apply damage twice. Outside Night, `step()` removes survivors with no penalty, which is the dawn cleanup.
  - Records are `{id, x, y, hp, targetId, obstacleId, attackTimer}` and hold building ids only. `hp` starts at `MUTANT.maxHp`.
  - `damageMutant(id, amount)` is the only way mutant HP changes. At 0 HP the record is removed, so a mutant dies exactly once and later damage returns `unknown-mutant`. Invalid amounts return `invalid-damage`. It returns `{ok, killed, hp}`.
  - `selectTarget(point, buildings, grid, powered?)`: lowest `distance - bias`, then higher bias, then earliest in the building list. `targetId` stays locked until that building is destroyed. Bias is `targetBias(building, powered)`: `TARGET_BIAS`, except a Mine, which is `MINE_BIAS.active` (192) when `power.js` reports it powered (enabled and NORMAL) and `MINE_BIAS.idle` (64, its `TARGET_BIAS`) otherwise. `Mutants` works out the powered ids once per tick, only when a Mine stands. Bias is read only when choosing, so switching a Mine off never breaks a lock. A future Loudspeaker Tower is planned at 384 (not implemented). Mutants walk out beyond the spawn frame to a Mine: on the default seed 17 of the 80 spawn points choose a powered Mine on deposit-1, 13 an idle one.
  - Movement is one step along the longer axis toward the nearest footprint point, stopping within `attackRange`.
  - **Obstacles:** if the next step enters any footprint (`blockerAt`, closed bounds, so touching buildings leave no seam), the mutant stays put and sets `obstacleId`. It attacks that building until destroyed, then resumes toward `targetId`. There is no pathfinding.
  - `attackTimer` only runs while stationary and resets on any movement. The first hit lands on the 60th tick spent attacking.
  - **Spitters:** provisional values in `SPITTER`. A record with `kind: 'spitter'`, `shots` and `aim`; ordinary records have none of these, so their snapshots and digests are unchanged. `#shoot` runs while `shots > 0`, otherwise the unchanged melee code does (`#melee`), so five shots later it is an ordinary attacker, lures and trucks included. It walks and detours like anything else, uses the same `selectTarget` and `TARGET_BIAS`, ignores lures and trucks, and stops once its target is in range (`range` 192, circular, to the nearest footprint point). Only a destroyed target moves it on, so it cannot wander. `attackTimer` counts down to `windupTicks` (45), walking or not, so losing a target cannot shorten the 180-tick cycle. At 45, if it has anything to aim at, it fixes `aim`, a point and not a thing, and a telegraph always ends in a shell. Aim order: the nearest soldier within `retaliationRange` (128) with a clear line, then `obstacleId`, then the target. **A shell** is released along that line, with what it hits settled at that moment by `firstSolid`. It lands on a fixed tick, first thing in `step()`, and outlives its Spitter. If what it would hit has gone, it finds nothing else. A shell aimed at a soldier hits only a soldier whose body covers the point when it lands, so moving 7 px off it is enough. Shells are read through `shells()`, are not in `snapshot()`, and go at dawn. A landing adds to `effects.attacks` and to an `impacts` key that exists only on a tick when one landed. NO LINE never means NO ATTACK: something is always hit, there is no searching, and nothing moves it for a better shot.
  - **Brutes:** provisional values in `BRUTE` (600 HP, 0.25 px per tick, 25 damage every 120 ticks, no armour). A record with `kind: 'brute'`. `statsOf(mutant)` is all that knows it differs: it runs the melee code, targets, trucks, soldiers and lures included. The one difference in behaviour is that a Brute never plans a detour: whatever fortification blocks it becomes its obstacle at once. A breach is open to everyone at once, and Brutes share a wall because mutants do not collide.
  - **Spawning:** exactly one RNG draw per scheduled spawn picks one of the `borderSpawns` positions. If that border cell holds a building, the next position clockwise is used. If every border cell holds an ordinary building, that spawn is skipped and not retried, and its slot still counts as reached. Spawning does not depend on buildings existing. A fortification does not displace a spawn: the mutant arrives one step (0.5 px) outside the map, clear of it, and has to breach it, so fortifying the border can neither cancel a wave nor funnel it. This is spawn handling only: those are the only positions outside the map, such a mutant does not plan detours, and its one possible move is inward, so it never walks along the edge. The map edge is not a wall: an enclosure that reaches the border can still receive spawns inside it.
  - With no buildings left, mutants wait in place until dawn. This only happens without HQ, in legacy test setups.
  - **Defeat:** a hit that destroys HQ calls `cycle.defeat()`. The run ends on that hit: later mutants do not act, a due spawn is dropped, and survivors stay frozen. HQ has the top bias and mutants walk shortest paths, so it is always a target, never just an obstacle.
- `src/core/lineOfFire.js`: pure, no state. `firstSolid(from, to, {grid, buildings, byId, isOpenGate})` returns `{building, x, y}` for the first solid building on a line, or `null`. Bounds are closed, so a corner touch counts and a checkerboard two deep stops every line. Doubled coordinates and exact fractions, so no engine can round differently. An OPEN gate passes a line only if it crosses both passage faces strictly between the posts, in either direction: a line that clips a post, enters from the side or stops in the doorway hits the gate, whichever axis the line mostly runs along. A building the shooter stands in is skipped: it can only be a gate that shut on it. Autocannon and rifle fire do not use this and still pass over everything.
- `src/core/shots.js`: pure, what aimed projectiles share, and not a projectile engine: each weapon keeps its own short list. `flightTicks(from, to, speed)`, `mutantAt(point, mutants, reachOf)` (nearest within reach, ties to spawn order), `bodyRadius` (`BODY_RADIUS`: ordinary 8, spitter 11, brute 15), `isBrute`.
- `src/core/siegeCannons.js`: `SiegeCannons({cycle, placement, grid, mutants})`, provisional values in `SIEGE` (`range` 256, `minRange` 64, `damage` 200, `reloadTicks` 300, `shellSpeed` 8, `impactRadius` 24). `step()` runs after `ShiftCycle.onTick()` and before `Autocannons.step()`, so a mutant it kills leaves no turret lock behind, and returns `{fired, impacts}`. Ready, a gun picks with `selectSiegeTarget`: the nearest Brute in its ring (inclusive at both ends, from the footprint centre), otherwise the nearest mutant, ties to spawn order, with no lock and no preference for Spitters. A shell flies over everything to the target's position when fired, lands first thing on its tick, and hurts at most one mutant within `impactRadius`; there is no splash and no homing. Unpowered, the reload pauses; shells in flight still land, and outlive their gun. Outside Night everything clears, reloads and shells alike, without landing. Holds only `{cooldown}` per gun and the shells, read through `snapshot()` and `shells()`.
- `src/core/walkField.js`: pure, no state. `walkMap(grid, buildings, ground?)` gives one value per tile, plus `half`, the ticks to cross half of each tile on its ground (`{roads, terrain}`; none is open ground everywhere). An edge exists only if BOTH ends allow travel along that axis (`canStep`), so a gate is entered and left along its passage axis only, and is solid across it, even with open ground beside it. Gate state is not on the map, because soldiers wait for OPEN. `walkField(map, goal)` is the travel time in ticks to one goal from every tile: a step costs half of each tile it joins, and entering a gate adds `GATE_TILE_COST` (5) open tiles, 160 ticks. So the way chosen is the quickest, not the shortest. Over open ground every value is the old tile count times 32 (`openTileTicks(map)`), so choices there are unchanged. A non-free goal is reached from nowhere. `nextStep` is the next tile on a cheapest way, N, E, S, W on ties; every step lowers the cost, so following a field cannot loop. `resolvePost(map, exit, flag)` gives `{post, blocked, field}`: the flag if it can be reached from the exit, otherwise the exit. It is derived, never stored.
- `src/core/terrainSpeed.js`: pure. `TERRAIN_SPEED` is the one place the walking multipliers live: `Ground.ROAD` (constructed roads and the HQ ring) 1.2, `Ground.OPEN` (open ground and the jungle map's dirt track, which is not a road) 1.0, `Ground.JUNGLE` 0.65 (provisional). They apply to workers and rifle and rocket soldiers only; mutants and trucks are unchanged. `groundAt(cell, {roads, terrain})`, `speedOn(ground, base)`, `halfTileTicks(ground, tileSize)` (open 16, road 14, jungle 25 for 32 px) and `approach(unit, goal, speed)`, which moves along one axis and lands exactly on the goal, so a speed of 1 is the old whole-pixel step.
- `src/core/infantry.js`: `Infantry({cycle, placement, grid, gates, mutants, roads?})`, provisional values in `INFANTRY`. Soldiers walk at the speed of the ground underfoot (`terrainSpeed.js`), and navigation is rebuilt when buildings or roads change. `step()` runs after `Gates.step()` and before `Mutants.step()`, on Night ticks 1..3599, and returns `{shots}`. Outside Night nothing exists: no unit state crosses a Day.
  - **Deployment:** per Barracks, on its powered ticks 1, 31, 61 and 91. Then, below strength, one free replacement per 600 powered ticks. The timer only runs below strength after the muster, and resets at full strength. Unpowered, both pause; soldiers out keep fighting. A destroyed Barracks' squad stays `orphaned` on its last post until its soldiers are gone.
  - **Navigation:** one field per squad, rebuilt only when `placement.revision` changes. Soldiers walk tile centre to tile centre at 1 px per tick and always finish an edge. At their post they stand on one of four fixed `SLOTS`. No building appears at Night, so regions only merge and a soldier always has a way home.
  - **Gates:** `addGateDemands(wanted)` runs before `Gates.step()`, and adds the gate on a soldier's own tile, the one it is entering and the one it is held at. It reads the grid and the walk map, never `gates.idAt`, whose records do not exist until the first gate step. A soldier waits at the centre before a gate until OPEN. On a gate tile it ignores combat and keeps walking, so only reaching the far tile's centre releases the gate. Injury, targeting and flag changes cannot. A gate's cost keeps every tile beyond it outside the leash, so combat cannot pull a soldier off a gate it is waiting for.
  - **Combat:** `selectInfantryTarget` takes the nearest mutant in weapon range or within `defendRadius` of the post, ties to spawn order. A lock lasts until death, or until the target is out of weapon range and beyond `releaseRadius` of the post. Hits are instant and pass over everything. Within `leashTiles` of the post (measured on the field, as that many tiles of open-ground time, so a road reaches a little further) a soldier stops to fight or closes on its target, never into a gate; beyond it, it keeps walking and shooting. `damageSoldier(id, amount)` is the only way soldier HP changes.
  - `snapshot()` is pure: `{posts, squads, soldiers, night, totals}`. `posts()` derives each Barracks' `{id, exit, flag, post, blocked}`, by Day too.
  - **Rockets:** a Barracks record with `role: 'rocket'` musters `ROCKET` instead (`squadSize` 2, `weaponRange` 128, `damage` 120, `cooldownTicks` 480, `rocketSpeed` 5), at the same HP and speed, on powered ticks 1 and 31. Their records carry `role`; rifle records do not, so digests of bases without rockets are unchanged. A rocket soldier takes the nearest Brute it can, over any lock, and otherwise follows the rifle rules. A rocket is aimed at the target's position, flies over walls with no homing, and lands first thing in `step()`, hurting only a mutant whose `bodyRadius` covers the point. It outlives its soldier and Barracks, which is why `step()` and `#standDown` check `#rockets` too. Read through `rockets()`, not `snapshot()`. A hit is in `shots` with `rocket: true`, and `impacts` is there only on a tick when one landed.
- `src/core/gates.js`: `Gates({cycle, placement, grid})`, provisional values in `GATE` (`openTicks` 150, `closeTicks` 60). One state machine for every gate: CLOSED → OPENING → OPEN → CLOSING → CLOSED, with reversals that keep the barrier's position. `step(wanted)` runs after `Autocannons.step()` and before `Infantry.step()` and `Mutants.step()`. `wanted` is `logistics.gateDemands()` plus `infantry.addGateDemands()`, derived afresh each tick, so there are no claims to leak. A gate never refuses and needs no power. It holds only `{state, timer}` by building id. ACTIVE cycle: gates run in Day, Dusk and Night and keep their state across boundaries. LEGACY: Night only, and at dawn every gate is CLOSED. The player cannot command a gate.
- `src/core/autocannons.js`: `Autocannons({cycle, placement, grid, mutants})`, temporary graybox values in `AUTOCANNON` (`range` 160, `damage` 10, `cooldownTicks` 30).
  - `step()` runs once per tick, after `ShiftCycle.onTick()` and **before** `Mutants.step()`, and returns `{shots}` for that tick. Turrets fire on night ticks 1..3599, never on tick 3600, and do nothing after a defeat. A mutant killed on a tick cannot act on it. A mutant spawned on a tick is first shot on the next one. Outside Night, `step()` clears all turret state, so cooldowns reset at dawn.
  - It holds only `{cooldown, targetId}` per turret, keyed by building id. HP, position and `enabled` stay in `BuildingPlacement`, power is derived, and mutant HP stays in `Mutants`. `snapshot()` is built from the live building list, so a destroyed turret disappears immediately. Records of destroyed turrets are dropped on the next step.
  - Range is circular and inclusive, measured from the footprint centre (`isInRange`, squared values, no `sqrt`).
  - **Targeting:** `selectMutant` acquires the nearest mutant in range, with ties going to spawn order. A lock is kept while the target is alive and in range, even if a nearer mutant arrives. It is reacquired when the target dies or leaves range, and cleared when the turret is disabled or unpowered. Reacquiring never changes the cooldown.
  - **Cooldown:** each powered tick it counts down, with or without a target. A ready turret fires the moment it has a target, then waits 30 ticks. It pauses while disabled or unpowered and resumes where it stopped, so toggling cannot beat the fire rate.
  - A consumer needs status `normal`, so LOW_POWER and BLACKOUT silence every Autocannon. A Plant destroyed on a tick affects turrets from the next tick.
  - Turrets act in building-list order and re-read living mutants each time, so a second turret never hits a mutant the first one killed. Hits resolve instantly; there are no projectiles, so walls never block a shot.
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
  - `Economy({credits, ap})` defaults to `STARTING_RESOURCES` (1250 / 5). Balances are private, read through getters.
  - `canAfford(cost)` never changes anything. It checks in a fixed order: `invalid-cost` → `insufficient-credits` → `insufficient-ap` (`EconomyFailure`).
  - `spend(cost)` deducts both resources together, or neither.
  - `restoreAp(ap)` sets AP (used at the start of each Day) and leaves Credits untouched.
  - `adjustCredits(delta)` takes a safe integer only. It may take Credits **negative**, which is debt. No building has upkeep now, so nothing in normal play causes it; the mechanism stays for future costs. Affordability is unchanged (`cost.credits <= credits`), so every purchase is rejected while in debt. Starting balances stay non-negative. Debt never ends the run: HQ destruction is the only approved Game Over.
  - `snapshot()` returns detached data.
- `src/core/buildingPlacement.js`:
  - `footprintAt(type, cell)` centers a footprint on the pointer cell: anchor = cell − floor((size − 1) / 2). For even sizes, the pointer cell is the left/top cell of the central pair.
  - `BuildingPlacement(grid, economy, {isConstructionAllowed})` provides `select`/`cancel`/`selectedType`/`isPlacing`. `select` returns false while construction is disabled.
  - Building records `{id, type, col, row, width, height, enabled, hp}` are the **single owner** of player power intent and of building HP. `enabled` starts as `true`; `hp` starts at the type's `maxHp`.
  - `demolish(id)`: anything without `demolishable: false`, so everything but HQ. Day only, no Credits, no AP, no refund. Rebuilding is an alternative to a paid repair. Everything that depended on the building is derived, so nothing else needs telling: power, dock and exit protection, wave counts, targeting and walking. A demolished Factory loses its stored loads and truck at once. A Day loss counts in `totals.cargoLost` only, because it belongs to no Night. Two presses are a UI rule in `BuildingControls`, not a domain one.
  - `revision` changes on every placement, removal (destruction or demolition) and flag change, which is everything that affects walking. Roads, HP, power and gate state do not change it.
  - **Barracks rules:** `canBuild` returns `barracks-limit` once `MAX_BARRACKS` (4) stand. A Barracks' left exit (`barracksExit`) must be a connected road (`no-exit-access`, also with no road network at all), and counts as a dock in `#roadDependents`, so nothing can block it. A road or gate that only a Barracks depends on is refused with `exit-required`, and `road-required` still means a Factory. `ROAD_ACCESS_TYPES` stays Factory-only, because `Logistics` gives every such type a truck.
  - **Flags:** a Barracks record holds `flag: {col, row} | null`, the one nested value on any record, so `buildings()` copies it. `setFlag`/`canSetFlag` work in Day and Night, cost nothing and give `flag-out-of-bounds`, `flag-occupied` (gates too), `flag-taken` (another squad's flag, or its exit while it has no flag) or `flag-unreachable`. `restoreFlag` skips those rules, because a flag walled off later is legal; only `src/testShadow/layoutSnapshot.js` calls it. `clearFlag(id)` is RESET FLAG: Day and Night, free, with no placement rules, because a recall must never fail. It returns the squad to its exit, on foot, through the ordinary revision change. A squad whose exit holds another squad's flag shares that tile.
  - **Refits:** `canRefit(id)`/`refit(id)` swap a Barracks between rifles and rockets for `REFIT_COST`, Day only (`construction-disabled`), and return `{ok, role}`. It is not a placement: flag, HP, power, id and `revision` stay. A rifle record carries no `role`, so going back leaves it exactly as it was. `restoreRole` skips the price; only `src/testShadow/layoutSnapshot.js` calls it.
  - `repairBuilding(id, amount)` is the only way HP goes up: capped at the type's `maxHp`, refused for an unknown (destroyed) building or a bad amount, returning `{ok, hp, restored}`. Only HQ's workers call it, per paid block. It is simulation, so the pause rule does not apply to it.
  - `damageBuilding(id, amount)` is the only way HP goes down. It is not behind the construction gate and never touches the economy. At 0 HP it removes the grid cells and the record together, so a building is destroyed exactly once and later damage returns `unknown-building`. Invalid amounts return `invalid-state`. It returns `{ok, destroyed, hp}`. Damage persists across nights, and there is no repair yet.
  - **HQ rules:** `canBuild(typeId)` returns `{ok}` or `hq-required` / `hq-already-built`, and `select`, `preview`, `placeAt` and the menu all use it. One HQ per run is enforced by a latch (`hqBuilt`), so a destroyed HQ cannot be rebuilt, with or without `requireHq`. With `requireHq`, only HQ can be built until it stands. Placing HQ ends placement mode. `GameScene` always sets `requireHq`, except under `?hq=off`. The constructor default of `false` is legacy compatibility for unit fixtures; do not rely on it in new gameplay code.
  - **Road rules:** with a `roads` dependency, HQ needs its whole 5x5 inside the map (`hq-ring-out-of-bounds`) and adds its 16-tile ring in the same transaction, nothing can be built on a road (`road-occupied`), and for types in `ROAD_ACCESS_TYPES` (Factory only) the exact dock tile must be a connected road (`no-road-access`). `preview` reports that tile as `dock`. `placeRoad`, `removeRoad`, `previewRoad` and `previewRoadRemoval` are behind the construction gate. A new road tile costs `ROAD_COST` (2 Credits, 0 AP), checked after space, so `insufficient-credits` follows a free tile; removal refunds nothing, and the HQ ring is free. Layout replay restores roads unpaid. **Pause:** the `isPaused` option (`GameScene` passes `cycle.pausedDay`) refuses every mutation with `GAME_PAUSED` (`game-paused`): placing buildings and gates, roads both ways, `demolish`, `setEnabled`, `refit`, Barracks `setFlag` and `clearFlag`. Selecting a type, previews and reading are unaffected; `restoreFlag` and `restoreRole` (layout fixtures) skip it. **Guards:** `addGuard(fn)` lets a moving thing refuse an edit; `#validate` and `previewRoadRemoval` ask every guard, after the road rules and before the price. Logistics and Workers register one. Without `roads`, as in legacy fixtures and `?hq=off`, none of this applies, there can be no gates, and with no logistics a Factory earns nothing.
  - **Gate rules:** a gate is the one building that goes on a road, through `RoadNetwork.canAddGate`. A Factory cannot take a gated tile as its dock (`gate-on-dock`).
  - `setEnabled(id, enabled)` is allowed in **both Day and Night**. It rejects a `switchable: false` type (HQ) with `invalid-state`. It is deliberately not behind the construction gate. It is free (no Credits or AP), touches neither the grid nor the economy, and is rejected with `unknown-building` or `invalid-state`.
  - `preview(cell)` and `placeAt(cell)` share one validation, in this order: the construction gate (`construction-disabled`, e.g. during Night Shift), then the HQ rules, then `grid.canPlace`, then `economy.canAfford`. Space reasons therefore win over resource reasons. `preview` never changes anything.
  - **`placeAt` is one atomic transaction:**
    1. Validate everything.
    2. Commit with `grid.place`, then `economy.spend`. If the spend fails, `grid.remove` undoes the grid change.
    3. Record the building and advance the id.

    A rejection leaves the grid, balances, buildings and next id unchanged. `no-selection` is returned when not placing.
  - Ids are deterministic (`outpost-1`, `factory-2`, …). `buildings()` returns a detached list.
- `src/core/roads.js`: `RoadNetwork({grid})`, Phaser-free. Roads are not buildings and never occupy the `Grid`, so they have no effect on combat, spawning or settlement. `revision` changes on every tile and gate change. `connects(a, b)` asks whether a truck may drive one step. `route(from, to, {without, gate})` can answer as if one tile were gone or one more gate stood, for the edit guards; nothing is changed.
  - **Docks:** `outgoingDock(footprint)` is the middle of a building's right side, and `receivingDock(footprint)` the middle of its bottom side. `shippingDock(type, footprint)` is a producer's truck dock: a Factory's right side, a Mine's bottom side, `{col + 1, row + 2}` for its 2×2 (the same tile `receivingDock` gives). `ROAD_ACCESS_TYPES` is `factory` and `mine`; every such type gets a truck, a protected dock and the same placement and gate rules. There is no rotation. A Factory ships from `{col: col + 3, row: row + 1}`, and HQ receives on `{col: col + 1, row: row + 3}`, which is always on its ring. A zero-edge route is impossible, because the docks could only meet if the footprints overlapped; the shortest legal route is 2 edges.
  - Tiles are `{col, row, kind}`, with kind `hq-ring` or `player`. `tiles()` and `connectedTiles()` are detached and row-major.
  - Connectivity is orthogonal and derived from the HQ ring, never stored. `neighbors(cell)` uses fixed N, E, S, W order. `isConnected(cell)` checks a tile. `route(from, to)` is the quickest route by `ROUTE_COST` (32 ticks a tile, plus 150 to enter a gate), both ends included, or `null`. Equal costs settle in discovery order, which without gates is exactly the old breadth-first search, and the cost is the same both ways. It is static: no traffic is modelled.
  - **Gates:** `setGate`/`clearGate`/`gateAt` hold each gate's passage axis. `neighbors` drops edges across a barrier, so routes and connectivity obey orientation with no other code, and losing a gate only adds edges. `canAddGate(cell, axis, docks)` needs a player road running straight through along the axis, with no perpendicular gate next to it (`gate-needs-road`, `gate-needs-straight-road`), not on the HQ ring or a dock (`gate-on-hq-ring`, `gate-on-dock`), and no dock may lose its route (`road-required`). So corners and dead ends take no gate, and a junction can be gated if docks survive, which cuts the crossing branch at that tile. The ring stays open, which keeps ring-seeded connectivity valid. `canRemove` refuses a gate's tile and its axis neighbours (`gate-depends-on-road`), so every gate always has its road.
  - `canAdd`/`add`: free, in bounds, not on a road or building, and touching the connected network. `canRemove`/`remove`: ring tiles are permanent, and a player tile stays only if removing it would leave a dock in `docks` with no connected route. Removal may leave a harmless disconnected fragment, which gives no access until a new tile rejoins it.
  - `restoreTile(cell)` skips only the touching rule. It exists for layout fixtures, because fragments are legal; only `src/testShadow/layoutSnapshot.js` calls it.
- `src/core/logistics.js`: `Logistics({cycle, placement, grid, roads, economy, gates})`, provisional values in `LOGISTICS`. `step()` runs last in the tick, after `Mutants.step()`, and returns `{deliveries}`. ACTIVE cycle: it runs on every tick of a timed Day, Dusk and Night (none run in Day 0), and nothing resets at a boundary: production progress, stored loads, cargo and trucks on the road all carry on, so there is no dusk reset and no dawn parking. The `night` tally covers a whole cycle, from the tick a Day starts to the end of its Night, and becomes `lastNight` at the next dawn. LEGACY cycle: Night ticks 1..3599 only, with the rules below.
  - **Reading is pure:** `snapshot()` changes nothing. Records follow the Factories at two explicit moments: during Day through `placement.onBuildingsChanged`, as each is placed or removed, and during Night in `step()`. Never at the moment of a Night destruction, because `Mutants.step()` holds a truck list then, and `damageTruck` on a removed truck throws.
  - **Mines (TASK 026):** a Mine is a producer like a Factory, with `MINE_OUTPUT` (`loadTicks` 600, `creditsPerLoad` 60, `storageLoads` 2, provisional), chosen by `outputOf(type)`; one truck, the same truck, gate, loss and routing rules, and its own dock. A Mine's `snapshot().factories` entry adds `type: 'mine'` after `id`; Factory entries are unchanged.
  - **Production:** a powered Factory makes one load (10 GOODS) per 600 powered ticks, so a full Night gives exactly five, on ticks 600..3000. LEGACY: partial progress resets at dusk. ACTIVE: it carries on, which gives about 12.5 loads per 7500-tick cycle. Storage holds 2 loads, production pauses when full, and stored loads persist.
  - **Trucks:** one free truck per Factory, in creation order, 20 HP, 1 px per tick, carrying one load. It leaves its dock when idle with a load, choosing its route then, and follows the shortest road to the HQ dock. A load pays exactly 30 Credits through `economy.adjustCredits` on arrival, and the truck drives back. Trucks may overlap.
  - **Losses:** `damageTruck(id, amount)` is the only way truck HP changes. A destroyed truck loses its cargo and returns after 600 Night ticks, carried across Day. If its Factory is destroyed, a truck carrying cargo finishes the delivery and is then removed; stored loads are lost. All cargo losses are counted in `cargoLost`.
  - **Road edits (ACTIVE):** a truck always finishes the edge it is on. When a road or gate change breaks the rest of its route, it takes the quickest way from the end of that edge; a route that still works is kept. Its return leg always heads for its own dock. An edit is refused only when a truck cannot survive it: a road taken from under it or a gate on a tile it touches (`truck-in-the-way`), or no way left to where it is going (`truck-stranded`). With no way at all (only after an unguarded edit such as a layout fixture), it waits at the end of its edge and asks again each tick.
  - **Dawn (LEGACY):** every truck parks at its dock, so Day road edits cannot strand one. A carried load returns to storage if there is room, otherwise it stays on the truck and leaves first next Night. Nothing is duplicated or dropped.
  - An unreachable dock is safe: the truck stays parked, `noRoute` is set, and storage fills. Placement and removal rules keep this from happening in normal play.
  - **Gates:** a truck holds at the centre of the tile before a gate until it is OPEN, so each crossing costs exactly `openTicks`, and crosses in the open. `gateDemands()` reports the gate on its tile and the next, so a gate stays open until the last truck has reached the tile beyond it. Trucks overlap, so there is no queue. A truck that dies stops asking, and a gate that falls stops being in the way.
  - Deliveries during a Night that ends in defeat are kept. Settlement is unchanged, with `gross` 0 for Factories; the panel adds `lastNight.credits` to its Income and Net lines.
- `src/core/simulationClock.js`: `SimulationClock`, a fixed 60 Hz clock (`TICK_RATE`).
  - Lifecycle: stopped → `start()` → running, with `pause()`/`resume()`. `reset()` returns to stopped with tick 0.
  - `advance(deltaMs, onTick)`: the accumulator. Each frame is capped at `MAX_FRAME_MS` = 100 ms (6 ticks) before it is added. Excess time is deliberately dropped, so there is no catch-up spiral. Does nothing while stopped or paused.
  - `speed` and `setSpeed(n)`: 1, 2 or 4 (`SIMULATION_SPEEDS`), default 1. `advance()` multiplies the frame delta by the speed **after** the cap, so a frame runs at most 24 ticks and 4x holds at low frame rates. `reset()` returns to 1. `clock.snapshot()` does not include it.
  - `stepTicks(count, onTick)`: exactly 1..240 ticks through the same callback, at any speed. Allowed while paused, without unpausing. Does nothing before `start()` or after `reset()`.
  - `timeSeconds = tick / tickRate`. There is no wall clock and no timers.
- `src/core/seededRandom.js`:
  - `SeededRandom(seed)` is the Refit/BarrelStorm LCG with a uint32 seed (`DEFAULT_SEED` = 731). It provides `next()` in [0, 1), inclusive `nextInt(min, max)`, `reset()` (back to the seed) and `snapshot()` → `{seed, state}`.
  - `parseSeed(raw)` validates seed overrides.
- `src/core/shiftCycle.js`: `ShiftCycle({clock, economy, nightTicks?, dayTicks?, duskTicks?, settleNight?, canEndDay?})`, the Day/Dusk/Night state machine. `Shift` is `day`, `dusk`, `night` or `defeated`. `DAY_TICKS` 3600, `DUSK_TICKS` 300, `NIGHT_TICKS` 3600.
  - **Two modes, chosen by `dayTicks`.** ACTIVE (`dayTicks` set, what `GameScene` plays) and LEGACY (`dayTicks` null, the default for unit fixtures, and `?cycle=legacy` in TEST_MODE): an untimed Day where nothing ticks and END DAY starts the Night at once. `timed` says which.
  - **Day 0 (ACTIVE):** `begin()` enters the first Day, the initial deployment (`deployment` true). It is untimed: the clock starts paused and nothing can resume or step it, so no tick runs, and nothing produces, delivers, walks, earns or emits. Construction works normally. Its `endDay()` goes straight to Dusk, whose first tick is the next one. It happens once. The calendar does not count it: `day` stays 1 through Day 0 and Night 1, so Night numbering, wave plans and settlement are exactly as before. The HUD shows the ACTIVE timeline as Day 0, Night 1, Day 1, Night 2…: a timed Day is labelled `day - 1` and a Night `day`.
  - **Timed Day (ACTIVE):** Day ticks 1..3600 see DAY; the next tick is Dusk tick 1; Dusk ticks 1..300 see DUSK; the next is Night tick 1, exactly like the first tick after a LEGACY END DAY. `elapsedDayTicks`/`remainingDayTicks`, `elapsedDuskTicks`/`remainingDuskTicks`. The player may pause a timed Day (`canPause`); entering Dusk resumes the clock, so nobody can pause a Dusk or a Night. Every timed Day starts at 1x and unpaused. **`pausedDay`** is a timed Day, not fast-forwarding, whose clock is stopped: the player may look, select and inspect, and every gameplay change is refused with `game-paused` until PLAY. Day 0 is never a paused Day: it is untimed. END DAY still works from a paused Day.
  - **END DAY (ACTIVE, timed Day):** `endDay()` sets `fastForwarding`, which closes construction at once. The caller runs the rest of the Day through `stepTicks`, at most 240 ticks a frame, every tick through the normal callback, and it ends at Dusk.
  - **Night:** `onTick()` (the fixed-step callback) counts `elapsedNightTicks`.
  - **Last night tick:** `onTick()` does the following, in order:
    1. Call `settleNight(completedDay)`. Its frozen report becomes `lastSettlement`.
    2. Start the next Day.
    3. Call `economy.restoreAp(DAY_AP = 5)`. This sets AP to exactly 5; it does not add 5.
    4. LEGACY: pause the clock inside the tick, which ends `advance()`'s loop with no extra ticks. ACTIVE: set the speed to 1 and resume.
  - **Exactly once:** this is the only place settlement is called.
  - **If the hook throws:** nothing changes. It is still Night with 1 tick left, the clock tick is not counted, and AP is not restored. The error propagates, and the final tick is retried on the next step.
  - `stepTicks(n, onTick)`: QA and END DAY. Only in a phase that ticks (`active`: a timed Day, Dusk or Night), at most `n`, stopping at a change of shift, whose tick is the last one run. `resume()` is Night only in LEGACY, and any phase that ticks in ACTIVE. `running` says whether the clock runs.
  - **`canEndDay`:** a dependency that keeps the run in Day, used until HQ is built. `endDay()` then returns `hq-required`.
  - **`defeat()`:** Night only, and only once. It sets `Shift.DEFEATED`, records a frozen `defeatReport` `{day, nightTick, completedShifts}` and pauses the clock. Mutants act on ticks up to 3599, so a defeat always comes before settlement: that night earns and emits nothing. Afterwards nothing ticks, settles or builds, and `endDay` and `resume` are refused.
  - The global `clock.tick` is never reset. `snapshot()` keeps its LEGACY shape; ACTIVE adds `deployment`, the Day and Dusk tick counts and `fastForwarding`.
  - `jumpToDay(day)`: QA only, called by `testShadow/dayQa.js` and by the soak suites. During a Day it moves the calendar and nothing else; a day that is not a positive safe integer throws `RangeError`, and outside Day it returns `not-day` or `not-started`. The next Night plans from it, because a plan is made on Night tick 1.
- `src/scenes/BootScene.js`: Starts the game scene.
- `src/scenes/EventBus.js`: the only link between `GameScene` and `HUDScene`, as in BarrelStorm. `State` flows down, as presentation data; `Command` flows up, as intentions; `Notice` is the few things that are not state; `Hud.READY` and `Hud.SNAPSHOT` are the handshake. It outlives scenes, so whoever subscribes unsubscribes on shutdown.
- `src/scenes/HUDScene.js`: everything in screen coordinates, in its own scene above `GameScene`: title, resources, shift, wave, power, pollution, settlement, hints, build menu, Cancel, END DAY, the selection's actions, speed, camera buttons and Game Over. It draws what it is told and sends commands; it never touches the simulation, and `GameScene` never touches its objects. All its state arrives as events, so it can be restarted at any time. `views()` is what QA reads. Phaser stops at the first scene that captures an input, so a press on any interactive object here never reaches the world. Leaving a control also counts as a capture, so `Notice.POINTER_LEFT_HUD` hands that one move on.
- `src/scenes/hudLayout.js`: pure data. `DESKTOP` is the bands round the grid. `TOUCH`, for a coarse pointer on a viewport at most 540 px on its short side, is a top bar, two columns of controls at least 90 logical pixels (45 CSS at 740×360) and a build drawer by category. Each gives `viewport`, the screen rectangle the world is drawn in, which only the drawer and the hint ever cover.
- `src/scenes/cameraView.js`: pure camera maths: fit, clamp, zoom at a point, pan, and world/screen conversion. `src/scenes/WorldCamera.js` applies it to `GameScene`'s main camera, in the layout's viewport. The world rectangle is the grid plus 16 px. On desktop the fitted view is exactly the plain screen, so a world point keeps its pixel. Zoom runs from the fit to 3.2. Night opens at FIT and Day at the layout's `dayZoom` (2 on touch, none on desktop), once per change of shift, so the player's own zoom is never fought. On a map with a `spawnFrame`, FIT is too small to fight at, so Night opens on `showArea` of the frame plus 16 px instead, the same zoom the open map fits at, and the first desktop Day starts there too. The FIT button and the zoom limit still use the whole world. Screen points become world points here, never through `pointer.worldX`, which belongs to whichever scene looked last.
- `src/scenes/orientationGuard.js`: on a coarse pointer in portrait, a DOM screen from `index.html` shows, `GameScene.update` stops feeding frames to the clock, and world input is ignored. The clock's speed and pause state are not touched, so a run comes back exactly as it was, paused or not. A desktop window can be any shape. QA stepping is not suspended.
- `src/scenes/MutantLayer.js`: graybox circles for mutants, HP bars on damaged buildings, and Spitters: a lime triangle about 22 px across, whose fill thins as shots go. In its telegraph it swells and draws an aim line; shells, impact rings and a fading × follow. With no shots left it turns over and goes olive, with a ring, which is the warning that it is coming in. A Brute is an orange octagon about 30 px across that always shows its HP, swells as it winds up a blow, and rings when one lands. Timing counts simulation ticks. Presentation only; `sync(mutants, buildings, {shells, tick, isNight})` takes detached snapshots.
- `src/scenes/AutocannonLayer.js`: graybox barrels, quantized to 8 directions, and short tracers lasting 6 simulation ticks. Presentation only; facing and tracer timing never affect gameplay.
- `src/scenes/SiegeLayer.js`: barrel, reload bar, shell, a ring at the landing point the size of the impact radius, and a burst on impact. Presentation only.
- `src/scenes/TerrainLayer.js`: the terrain, painted once into one `CanvasTexture` at 2 texels per world pixel and shown as one image at the grid's origin, depth -1, so it costs one quad a frame and cannot drift from the grid at any zoom. The canopy is clipped to jungle tiles, so it ends on the tile that stops building. The generated picture and its bare ground (before tile lines and canopy) are cached per seed and never painted on again; each run paints on its own copy (`<key>-run`), so a restart shows the jungle as generated. `clearTiles(cells)` repaints each cleared tile and every open tile touching it from the bare ground, adds raw earth and stumps to cleared tiles, then tile lines and jungle shadow as the terrain now stands. `GameScene.syncTerrain` calls it once a frame with whatever changed since. `view()` adds `repainted`. Open ground draws its own tile lines; `GameScene` draws the plain grid lines only on a map with no terrain. Its shapes come from its own generator. Presentation only.
- `src/scenes/WorkerLayer.js`: workers (yellow circles in orange hard hats), HP bars when hurt, a fading × on a death, and the amber work flag, ringed and light-poled so that it reads on unexplored ground. Selecting HQ brightens it and draws a line from the exit; blocked is red and crossed. The flag redraws only on a revision, flag or selection change. A working worker loops the chop frames 8–9 (`chopFrame`), a repairing one the repair frames 10–11 (`repairFrame`; `workerFrame` chooses), and each tile being cleared gets an amber outline and a progress bar. QA: `workerViews` adds `chopping`, `repairing` and `frame` per worker, and `jobs`. Presentation only.
- `src/scenes/nightTint.js` and `src/scenes/NightTintLayer.js`: a subtle blue over the world at Night. `NIGHT_TINT` holds the tunable values (`#18365C`, alpha 0.18, 300-tick Dusk fade-in, 120-tick dawn fade-out); `nightTintAlpha` is pure and reads phase ticks only, so it is clear by Day and in Day 0. One world rectangle at depth 2.4: over terrain, roads, buildings and trucks, under the fog, so fogged ground is not darkened twice, and under turrets, HP bars, units, shells and muzzle flashes. The HUD is its own scene and is never tinted. Presentation only.
- `src/scenes/FogLayer.js`: the fog, as one canvas texture with one texel per tile, stretched over the map as one world image at the grid's origin, so it costs one quad a frame, stays on the grid at any zoom, and the stretching softens its edges. Depth 2.5: over buildings and trucks, under every placement preview. Redrawn only when `fog.revision` changes. Presentation only.
- **Protest selection (TASK 027.1):** in normal mode, `selectAt` on a visible tile with no building that `ecologists.protestAt` names selects the protest (`selectedProtestId`, QA `selectedProtest`); the highlight frames its site. `BuildingControls` then shows only DISPERSE (proxy `disperse`, `data-target` the group, `data-ordered`, `data-enabled`; CANCEL DISPERSE while ordered) in the old Demolish slot: 116x84 on desktop, the 188x90 touch pair row. It is dimmed but pressable when two workers are not free. A protest that is over drops the selection. `buildingControlsView` adds `disperseVisible`, `disperseLabel`, `disperseAlpha` and `disperseBox`.
- `src/scenes/EcologistLayer.js`: protesters from `units/ecologist.png` (45x40 frames, 5 px spacing, drawn like a worker), facing the way they walk; `ecologistFrame` chooses idle 0-1, walk 4-5 (every 10 ticks; every 4 when fleeing), protest 8-11 and death 12-13. A red outline marks a blocked road. The fog hides them like mutants. A protest's start shows the hint `ECOLOGISTAS! Protesters are blocking a delivery road`. Presentation only.
- `src/scenes/TruckLayer.js`: truck rectangles, amber when loaded, and storage pips on Factories. Presentation only, synced from `Logistics.snapshot()`.
- `src/scenes/RoadLayer.js`: road tiles under buildings, dock markers, the Factory dock preview and the 5x5 HQ preview outline. Presentation only, redrawn only when roads change.
- `src/scenes/InfantryLayer.js`: soldiers (blue diamonds, against round magenta mutants), cyan tracers, HP bars when hurt, a fading × on a death, rally flags with the number of their Barracks, and roof pips counting living soldiers. Selecting a Barracks brightens its flag and draws a line to it; a blocked flag is red and crossed. Flags redraw only on a revision or selection change. Rocket soldiers are larger and orange, a rocket Barracks' roof shows `1R`, and rockets are drawn in flight with a ring where they land. Presentation only.
- `src/scenes/BuildingControls.js`: on HQ, the flag and reset buttons below become SEND WORKERS/MOVE FLAG and RECALL WORKERS, with the same proxies (`set-flag`, `reset-flag`), and `GameScene` sends them to `Workers` when `flagBarracksId` holds HQ's id. Demolish (proxy `demolish`, `data-target`, `data-armed`) for any selected building but HQ, by Day, and Flag (proxy `set-flag`, `data-target`) for a Barracks, by Day and Night. Two 116×84 buttons at y 470 between the settlement panel and the power toggle. Anything but a wall or gate needs two presses: the first arms the button as CONFIRM for that building, and any press on the map, selection change, other action, Escape or the end of Day disarms it. Presentation only. RESET FLAG (proxy `reset-flag`, `data-target`) shows for a Barracks with a flag, by Day and Night, at x 1218 y 560. A selected Barracks narrows the power toggle to 116 px at x 1098 to make room, labelled without the building id; `GameScene.layoutToggle` recreates its proxy, which keeps the size it was made with. Refit (proxy `refit`, `data-target`, `data-armed`, `data-role`) shows for a Barracks by Day at x 1152 y 650, where Speed sits at Night. It always takes two presses, and arming it or Demolish disarms the other.
- `src/scenes/GateLayer.js`: gate barriers, drawn on one Graphics object and redrawn only when a gate changes. A shut gate is a bar across the road, which parts towards two posts as it opens. Also the orientation preview, with passage arrows. With art loaded, each orientation draws its own sheet, unrotated: `buildings/gate-horizontal.png` and `buildings/gate-vertical.png`, each 8 frames closed to open in 32x48 cells 5 px apart (`ART.gateHorizontal`/`gateVertical`, `GateFrames.js`). Both anchor bottom-centre (`originY` 1) on the bottom edge of their one tile: the horizontal art fills the tile, the vertical art rises 16 px into the tile above without occupying it. Depth is `gateDepth(row)`, from the tile the gate stands on, so a gate further south draws over one to its north, between building art (1.1) and the fog (2.5). Sprites are never interactive, so a press on the overhang is a press on the tile under it. The placement preview shows the real sprite, closed and tinted by the verdict, as `gatePreviewView.ghost`; the placement rectangle stays one tile. `gateViews` adds `kind`, `frame`, `angle`, position, size, origin and depth. The old `gate-regular.png` is no longer loaded. Presentation only.
- `src/scenes/SpeedControls.js`: the Dusk and Night 1x, 2x and 4x buttons (proxies `speed-1`, `speed-2`, `speed-4`, with `data-selected`), in the right band below the power toggle so they never sit under END DAY at dawn. 82x84 logical pixels is about 44 CSS pixels at 844x390. Presentation only: the clock owns the speed, so it lasts across Nights and a restart returns to 1x. The countdown stays in simulation seconds.
- `src/scenes/GameOverLayer.js`: the Game Over overlay and RESTART button. Presentation only; nothing exists until `show()`. Its panel is interactive, so presses on it are UI, never grid input.
- `src/scenes/GameScene.js`: the world, the simulation and what a press on the battlefield means. It publishes through `present(event, value)`, which only emits what changed and keeps the latest of each for `Hud.SNAPSHOT`, and it launches the HUD and marks the scene once the HUD is ready. Where the notes below name a button or text, `HUDScene` draws it now and `GameScene` decides it.
  - **Input:** a mouse acts on pointerdown; right or middle drag pans, the wheel zooms at the pointer and the arrow keys pan. A finger acts on release, so a second finger can still make it a gesture. Two fingers pinch and pan and build nothing, and nothing else happens until both lift.
  - **Touch placement:** a finger never builds in one step. On the touch layout, choosing a building or the Road tool shows a ghost at once, on the nearest accepted tile to the middle of the view (`firstGhostCell`). A tap or drag moves it; a separate tap inside it, without moving off its tile, is the only touch that spends anything (`confirmGhost`). A red ghost is refused by `placeAt` as usual, and after a success it stays on its tile, now red, so a stray tap cannot build twice. Walls and roads draw a segment instead (`extendSegment`, tile by tile, and going back shortens it), and one tap on it commits every accepted tile (`commitSegment`). A road segment may be drawn towards the network from either end. One tap on an existing player road proposes removing it. Cancel, another building and the end of Day discard the proposal, and a second finger puts it back as it was before that press. The LOW_POWER warning appears as the ghost lands, so the confirming tap is its second press. All of this is proposal only: core rules and prices are unchanged, and the mouse path never sees it.
  - Start hides the title and Start button and removes the `start` proxy. It then creates a 24×16 `Grid` with 32px cells at origin (256, 104), drawn with Phaser Graphics, and shows the build menu in the band left of the grid.
  - The HUD in the top band has two lines:
    - The shift line: `Day N · Day Shift`, or at night `Day N · Night Shift · 59.8 s left`, with `(paused)` added when the QA clock is paused. The countdown is `remainingNightTicks / 60`.
    - The resource line: `Credits: N   AP: N`.
  - The wave HUD sits at the top of the left band (x 16, y 20): `Mutants N | Wave X/Y`. `N` is living mutants, and `X/Y` is scheduled slots reached out of total, not kills. It is visible only while a night plan exists.
  - The pollution HUD sits at the top of the right band (x 1040, y 16): `Pollution N` and `Threat Level N`. It refreshes at Start and on each Day/Night change.
  - Both lines are created at Start, together with the `Economy` and `ShiftCycle`. The scene wires `settleNight` to `core/settlement.js` and contains no formulas.
  - **Touch targets:** every Day control is at least 82 logical pixels on each side, 44 CSS pixels at 844×390. The build menu is two columns of 120×82 cells (`MENU_SLOTS`), six rows of 84 from y 104, with Road, Wall, Barracks, the gates and the Siege Cannon below the buildings. Rows end at y 565, clear of END DAY at y 578, so slot 11, now the Mine, is the last that fits. On touch the drawer's ECONOMY row is HQ, Factory, Plant and Mine, and the Outpost moved to INFRASTRUCTURE: four buttons are all a row holds. 82 logical pixels is 44 CSS pixels at 844×390. Barracks are not offered under `?hq=off`, which has no roads. END DAY, Cancel and the right-band action button are 192×84.
  - The right band (x 1040) holds:
    - The power summary: `Power G / D` and the status label (NORMAL / LOW POWER / BLACKOUT).
    - The settlement panel with the latest report: `Night N settlement`, then Income, Upkeep, Net, Credits and Power. It is hidden until the first completed night.
    - The **power toggle** (proxy `toggle-power` with `data-target` and `data-enabled`). It is visible whenever a switchable building is selected, in Day **and** Night, and calls `placement.setEnabled`. Demolish and Flag sit above it, in `BuildingControls`.
    - **Cancel** shares that spot (`RIGHT_ACTION`), which is safe because placing clears the selection.
  - `refreshPower()` re-derives power and restyles buildings after every placement, toggle and Start; it never runs per frame. Disabled buildings are drawn at alpha 0.35; enabled but unpowered ones get a red outline.
  - END DAY (proxy `end-day`) sits at the bottom of the left band and is visible during Day only, never during its fast-forward. In a timed Day it starts the fast-forward, which `update()` runs as `cycle.stepTicks(240)` a frame instead of `clock.advance`; every command but the camera's is ignored, and a left click on the world does nothing, until Dusk.
  - **Day time controls (timed Day only):** PAUSE/PLAY (proxy `day-pause`, `data-paused`) and a speed button that steps 1x, 2x, 4x and round (proxy `day-speed`, `data-speed`), from `hudLayout`'s `dayTime`: the bottom band right of the camera buttons on desktop, right column slots 5 and 6 on touch. Hidden in Day 0, Dusk and Night. The shift line counts the Day down, and shows `(paused)`.
  - **Paused Day:** the build menu, the power toggle and the selection's actions are dimmed to 0.45 (`PAUSED_ALPHA`), still readable and still pressable, with `data-paused` on their proxies; PLAY, the Day speed, END DAY, the camera and the drawer are not. A press reaches the domain, which refuses it, and the hint says `Paused: press PLAY to act`; placement previews show red. Day 0 keeps its normal look, and PLAY restores it at once. QA reads `actionAlphaView`. The Road button shows its price.
  - **REPAIR and DESTROY (icon buttons):** two square icon buttons side by side in the old Demolish slot (`hudLayout`'s `pairIn`), REPAIR on the left and DESTROY on the right: 48x48 logical on desktop, and 90x90 on touch, so each is at least 44 CSS px at 740x360. On touch that row of the right column reaches left to x 1090, and the world's `viewport` and the drawer panel end at x 1088; the fit is limited by height on both maps, so the world loses no zoom. DESTROY shows the Killdozer (`public/assets/sprites/ui/killdozer.png`, loaded by `BootScene` with nearest-neighbour filtering; `killdozerIcon.js` fits its vehicle, x 3..44 y 5..38, into 40 px, centred, ignoring the transparent padding) on dark red; armed it turns bright red with a yellow frame and keeps a CONFIRM DESTROY tooltip up, and walls and gates still take one press. REPAIR (ACTIVE, timed Day, not Day 0, on a damaged building or one with an order) is a white wrench on green; STOP REPAIR is the wrench crossed out on red. The whole square is the hit area. Accessible names (`aria-label` on the proxies) are DESTROY, REPAIR and STOP REPAIR; desktop hover shows a tooltip, REPAIR's with the price of full HP, kept inside the screen. REPAIR is dimmed but pressable, for its hint, when no worker is free. Proxies `repair` (`data-target`, `data-ordered`, `data-enabled`) and `demolish` (`data-armed`). REPORT, camera, PAUSE and speed controls are untouched. `buildingControlsView` adds `repairVisible`, `repairLabel` (REPAIR / STOP REPAIR), `repairAlpha`, `repairBox`, `demolishBox` and `tooltip`; `demolishLabel` stays Demolish / CONFIRM.
  - **HQ worker buttons (ACTIVE):** SEND WORKERS / MOVE FLAG (`set-flag`) places or moves the flag; the second button (`reset-flag`) is RECALL WORKERS while the squad is out and SEND WORKERS, free, while it is home with a flag down.
  - **Keeping the UI in step:** `syncShiftUi()` runs after every clock advance, every QA step and END DAY. On each Day/Night change:
    - At Night it exits placement mode and hides the building buttons and END DAY, removing their proxies.
    - At Day it restores them and refreshes the resource line.
  - **HQ-first flow:** a new run offers only HQ. The other buttons and END DAY stay visible but disabled, and pressing them does nothing. Placing HQ unlocks them, marks HQ `BUILT` and enables END DAY. Proxies carry `data-state` (`available`, `locked`, `built`), and END DAY carries `data-enabled`. The toggle stays hidden for HQ.
  - **Defeat:** `syncShiftUi()` calls `enterDefeat()` once on `Shift.DEFEATED`: the phase becomes `defeated`, the play UI hides and the overlay shows `HEADQUARTERS DESTROYED`, the approved quote and `Completed shifts: N`. Grid input is ignored. RESTART calls `scene.restart()`, which returns to the title; `create()` rebuilds everything, so no custom reset exists.
  - **Road tool:** the Road button (proxy `build-road`, `data-state` `locked` or `available`, `data-selected`) needs HQ. A tap or click adds a road on an empty tile and removes a player road, and dragging only ever adds. Cancel, Escape and Night exit it. A rejected placement or road action shows a short hint above the grid, because touch has no hover.
  - The build menu has HQ, Outpost, Factory, Power Plant and Autocannon buttons (proxies `build-hq`/`build-outpost`/`build-factory`/`build-powerPlant`/`build-autocannon`, with `data-selected`), and with roads also Wall and both gates (`build-wall`/`build-gateVertical`/`build-gateHorizontal`). Their labels show the size and cost. There is also a Cancel button, visible with proxy `cancel-placement` only while placing.
  - **Flag tool:** Flag on a selected Barracks enters flag mode (`flagBarracksId`) in Day or Night. The selection clears and Cancel shows. The next press on an accepted tile sets the flag and returns to the Barracks; a rejected one shows a hint and stays. Cancel, Escape, any shift change or losing the Barracks exit it.
  - **Walls** use normal placement mode, and a press or a drag places them. A drag visits every tile between pointer samples, so a fast drag leaves no gap, and each tile is an ordinary placement. A press on an existing wall does nothing, because there are no refunds.
  - **LOW_POWER confirmation:** a press that would place something taking power from NORMAL to LOW_POWER (`causesLowPower`) places nothing, sets `powerWarning` `{type, col, row}` and shows a hint. A second press on that tile places it. Any other tile, building or mode drops it, through `updatePreview`. This is UI only: `placeAt`, layouts, QA and the player's choice are unaffected. HQ alone supplies 20, so a Factory before a Plant asks. `place` in `tests/helpers/hq.js` gives the second press.
  - **Normal mode:** `pointerdown` selects or highlights the cell from `pointer.worldX/worldY` via `grid.worldToCell`. If the cell is occupied, its building is selected too and the highlight covers the footprint. Normal mode never places. A pointer outside the grid clears the selection.
  - **Placement mode:** `pointermove` previews the footprint, and `pointerdown` attempts placement. Selection is cleared and disabled. Placement mode stays active after a successful placement. Escape or Cancel exits.
  - The preview color comes from the domain result: green when ok, red otherwise. An unaffordable footprint is red even when its cells are free.
  - Scene-level pointer handlers ignore events whose hit list (`currentlyOver`) contains a UI object, so a press on a button never counts as grid input.
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
  - **Simulation:**
    - The clock is created stopped. Start calls `cycle.begin()`, which starts it paused for Day 1.
    - `update(time, delta)` calls `clock.advance(delta, stepSimulation)` then `syncShiftUi()`, and ignores Phaser's `time`.
    - `stepSimulation(tick)` counts `stepsExecuted`, calls `cycle.onTick(tick)`, then `siegeCannons.step()`, then `autocannons.step()`, then `gates.step()` with the demands of trucks, soldiers and workers, then `infantry.step()`, then `workers.step()`, then `mutants.step()`, then `ecologists.step()`, then `logistics.step()`. Shots and destroyed buildings are handled from that tick's results: `handleBuildingsDestroyed` removes the views, clears a stale selection and calls `refreshPower()`.
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

The simulation clock (`src/core/simulationClock.js`) and seeded RNG (`src/core/seededRandom.js`) are integrated in `GameScene`. They follow the Steel Abyss: Refit / BarrelStorm contracts: the 1/60 s accumulator, the 100 ms frame cap and the same LCG. The Day/Night `ShiftCycle` (`src/core/shiftCycle.js`), `SiegeCannons` (`src/core/siegeCannons.js`), `Autocannons` (`src/core/autocannons.js`), `Gates` (`src/core/gates.js`), `Infantry` (`src/core/infantry.js`), `Mutants` (`src/core/mutants.js`) and `Logistics` (`src/core/logistics.js`) consume ticks, in that order. In the ACTIVE cycle the clock is paused for Day 0, runs 3600 ticks per timed Day (unless the player pauses), 300 per Dusk and exactly 3600 per Night. Logistics, gates and workers step in all three; mutants, turrets and soldiers act at Night only, as before. Nightly settlement (`src/core/settlement.js`) runs once, at the end of the final night tick, and applies Credits and pollution together. There is no per-tick revenue or pollution. Mutant spawning is the only consumer of random numbers so far. New simulated systems must run inside `GameScene.stepSimulation()` and draw randomness from `this.rng`.

### Day Shift

Day 0, the first Day of a run, is an untimed planning phase for the initial base: nothing ticks until END DAY. Every later Day is timed (3600 ticks) and runs the simulation, so Factories produce and trucks deliver; the player can pause it, change its speed, or END DAY to fast-forward the rest of it through the normal simulation. Dusk (300 ticks) follows every Day and recalls the workers.

Gameplay actions are discrete commands, such as:
- Place building
- Change building power state
- Repair building
- End day

The player must not be forced to make planning decisions under a real-time countdown: Day 0 has none, and a timed Day can be paused. Pausing a timed Day is for looking: camera, selection and inspection work, and every gameplay change waits for PLAY. Day 0 is untimed, not paused, so everything can be built in it.

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
- Adds `?cycle=legacy` by default, which keeps the untimed Day older suites were written for. `{cycle: null}` plays the real ACTIVE cycle (Day 0, timed Days, Dusk). Evidence about the ACTIVE cycle must come from tests that pass `cycle: null` (`tests/e2e/active-cycle.spec.js`) or from `createWorld({active: true})` in the soak harness (`tests/unit/activeCycle.test.js`), never from LEGACY results.
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
- TASK 015: Combat Escalation
- TASK 016: Night Simulation Speed Controls
- TASK 017: Roads & Connectivity
- TASK 018: GOODS, Logistics & Delivery Trucks
- TASK 019: Walls & Gates
- TASK 019.5: Cleanup & Stabilization
- TASK 021: Barracks & Infantry, with consistent demolition and pure Logistics snapshots
- TASK 022: Mutant Archetypes & Ranged Threats (the Spitter)
- TASK 023: HEAVY METAL (Brute, Siege Cannon, Rocket Infantry, RESET FLAG)
- TASK 026: Deposits & Mines (supersedes TASK 020)

Implemented, awaiting the developer's review:

- TASK 024: HUD Reconstruction & Mobile UX (HUDScene, world camera, touch layout, landscape guard)
- TASK 024.1: Mobile Building Ghost & Two-Step Placement
- TASK 025.1: Bigger World & Jungle
- TASK 025.2: Fog of War & Outpost Rework
- TASK 025.3: Workers & Work Flag
- TASK 025.4A: Active Day, Dusk & Terrain Movement, with the follow-up: Day 0, the persistent work flag and the Day speed reset
- TASK 025.4B: Jungle Clearing & Pollution
- TASK 025.4C: Paid Building Repairs (explicit REPAIR orders)

Later, not yet assigned:

- Repeatable survival loop
- Hardening: `Economy` does not bound balances. The constructor accepts unsafe integers and `adjustCredits` validates the delta but not the result, so a balance can pass the safe-integer range and lose precision. `settleNight` prevalidates this for settlement; `Economy` itself is unchanged.
- Test reliability (known, tracked separately): `tests/e2e/clearing.spec.js` (desktop) has hit the same 15 s timeout with 3 workers while the long ecologist tests ran beside it, and passes alone. `tests/e2e/repairs.spec.js` touch tests on the jungle map (notably "DESTROY is the Killdozer square…" at 844x390) can exceed the 15 s test timeout with 3 workers on the developer's machine. With one worker they take about 7.2-7.5 s, and the failure reproduces without TASK 027. The cause is not identified; the TASK 026 ore canvas is only a candidate. The timeout and assertions stay unchanged. Next step: a focused investigation comparing startup and rendering timings with one and with three workers, to find the bottleneck before changing any code.

Known balance issues, accepted for now and not final behaviour (see the GDD):

- Corner advantage: corners stay stronger than the centre. Since TASK 015, a corner HQ with one Autocannon falls around Night 19 in scripted runs. The HQ ring now keeps HQ one tile from every edge; that effect has not been simulated.
- Wave predictability: production always uses `DEFAULT_SEED`, so spawn positions repeat every run. The first mutant always appears at border cell 22,15, which allows a deliberately asymmetric defense. Not changed; review it with the Wave Director.
- Compact fortresses: docks constrain a compact base more than roads alone, but short routes stay a deliberate advantage. The FORTRESS 22 fixtures and `fortress-corner-v1.json` predate docks and are stale; a player-derived fortress will follow.
- Long routes: a Factory holds 150 Credits a Night up to about 10 road edges, then falls gradually to about 90 at 20 edges.
- Centre industry: at 1000 Credits, scripted industrial bases in the centre could do worse than defensive turtles. At 1250 Credits one scripted build queue improved from 5 to 28 of 30 runs alive after Night 20. HQ damage is still permanent, and losing a Plant still silences every cannon. Only real playtests can judge industrial viability.
- Fortress play: walls keep cannons out of melee, so fortified bases may last longer than the figures above. Scripted enclosed bases with no cannons still fall, but real play must judge how strong walls plus cannons are. Fixed seeds keep lanes predictable.
- Thick walls: a detour is bounded and a maze cannot stall a mutant for free, but layers of wall still cost it about 1200 ticks each when it is alone. That is paid for in wall HP and Credits, and it is not bounded per mutant.
- Infantry: in scripted bases with no flag moves, Barracks are much weaker than Autocannons (median fall Night 22 for three cannons, Night 9 for two Barracks), and soldiers almost never die, because mutants at their targets are not lured. They do die on a lane. Barracks do not raise the wave budget. See GDD section 14 and `npm run test:soak:infantry`; real play must judge this.
- Spitters (accepted, not a target): static no-income bases fall much earlier. In scripted runs the three established 3-cannon turtles fall at a median of Night 12 to 13, against 20 and 24 on the same waves of ordinary mutants, because most Spitters spend all five shots unanswered, the Plant goes first, and every cannon falls silent. The developer playtested this and kept the Spitter unchanged: an actively managed, economically developed base survived through Day 40, so this is the intended gap between a static base and a managed one. One playtest is context, not a balance target. `tests/unit/waves.test.js` guards both sides: ordinary waves keep the Night 15 floor, and with Spitters a turtle must fall no earlier than Night 10 and at least 5 Nights sooner.
- Brutes and their counters (approved with these values, balance still provisional): real play reached Day 32 with an evolved fortress under Brutes, which supports the current values. In scripted runs on `golden-fortress-day33-v2`, 1 Siege Cannon and a Rocket squad on a scripted flag cut the estimated Night 40 rebuild bill from about 418 to about 48 Credits, so concentrated heavy weapons may make Nights 35 to 40 too comfortable. A Siege Cannon also takes most armed Spitter kills where no squad is active, though active flags keep their value. See GDD section 14 and `npm run test:soak:heavy`.
- Jungle map: the spawn frame keeps combat identical to the open map for a base in the clearing, so the map's far jungle plays no part in a Night yet. The clearing has about half the open map's buildable tiles, which squeezes late bases and is not yet playtested. Production always plays one world seed, so the map, like the waves, is the same every run. Rally flags can be set in the jungle.
- Repairs (provisional): HQ damage is no longer permanent, at 1 Credit per HP, and other buildings cost 60% of their price for full HP. Every soak baseline and balance note that assumed permanent damage predates this; none has been rerun.
- Active-cycle Factory income (accepted provisionally, not final): Factories now work through the timed Day, Dusk and Night with no reset, so one Factory earns about 360 to 390 Credits a cycle against 150 a Night before, about 2.45x. Production rates, cargo and payouts are unchanged. Roads now cost 2 Credits a tile.
- Ecologists (provisional playtest values, TASK 027): at most 3 groups a Day and 900 ticks each, so a single delivery lane loses at most about a quarter of a Day per group. Nothing but walls, gates and time counters them until TASK 028. Not playtested.
- Mines (provisional playtest values, TASK 026): a Mine pays 60 Credits a load against a Factory's 30, at the same rate, but its deposit lies beyond the spawn frame, so its road crosses the frame and long routes and truck time cut what it really earns. Reaching deposit-1 on the default seed takes two work flags whose circles hold 47 jungle tiles, so up to +47 Pollution if the workers finish both, because clearing is the unchanged radius-3 circle. That alone can cross the Threat thresholds at 25 and 50 (Threat 1 to 2, or 2 to 3 on top of other emissions) before the Mine earns anything. Accepted for now: clearing and deposit generation stay as they are until manual playtests judge it. A powered Mine draws mutants from the frame's nearest edge; an undefended one fell on Night 3 in a scripted run. None of this is playtested.
- Starting budget: 1250 Credits is approved. Power Plant + Factory + Autocannon costs 1150, so the first Day can include all three. A no-income turtle can buy three Autocannons and a Plant, with a median defeat of Night 20 from the centre and Nights 23-24 from corners in scripted runs.

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