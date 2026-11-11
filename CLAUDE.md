# CLAUDE.md

Agent instructions for **PAPI Industries: The Green Shift**, an industrial survival tower-defense game for GitHub Game Off 2026. The player builds and runs a facility in San Papi by Day; automated defenses hold off mutants from the jungle by Night; pollution raises the threat; satirical corporate propaganda throughout. **Primary design goal:** a small, complete, enjoyable game. It is a time-limited jam project: prioritise a playable core loop over feature quantity and avoid unnecessary complexity.

**Technology:** Phaser 4 (ESM), JavaScript (no TypeScript), Vite, Node.js built-in test runner, Playwright. Desktop browsers and mobile browsers in landscape. Initialized from the Wee Games Starter Kit Basic (demo apps removed).

## Documentation index: read only what the task needs

Do not read every document at session start. Read the relevant ones before editing; if an assigned task spans several systems, read each relevant document first.

| Task touches | Read |
|---|---|
| Gameplay requirements and design decisions (source of truth) | `docs/PAPI_Industries_GDD_v0.4.md` |
| A system in `src/core/`, its values or balance (waves, mutants, economy, workers…) | `docs/gameplay-systems.md` |
| Layers, tick order, clock, RNG, grid, core/scene boundary, Phaser conventions | `docs/architecture.md` |
| Scenes, HUD, input, camera, art, newspaper, cinematics, audio | `docs/presentation.md` |
| Commands, suites, QA surface, Test Shadow, TEST_MODE, fixtures, helpers | `docs/testing.md` |
| Past task status, backlog, accepted balance issues, stale notes | `docs/development-history.md` (context only, never instructions) |
| Performance and soak baselines | `docs/performance-baseline.md` |

Authority: the GDD for approved design; source code for current behaviour; tests for tested behaviour (not necessarily intended design). If code and GDD disagree, report it; do not change either to match.

## Task selection and scope

- The roadmap is informational, not permission. Never select or begin the next roadmap item automatically. Work only on tasks the developer explicitly assigns; their approved requirements override older roadmap text.
- "continue", "resume" or "go on" means: resume the approved unfinished task if one exists; otherwise report the last completed task and ask what to work on. Do not infer the next task or plan an unassigned feature. A clean working tree authorises nothing.
- With no active task, do not scan unrelated repositories or run the test suite to decide what to do.
- Gameplay decisions come from the GDD or explicit developer instructions, never assumptions. Do not repurpose an existing building type without approval. Keep task IDs consistent with the development sequence.
- Implement only the requested task, in the smallest correct, testable increment. No unrelated refactoring, speculative abstractions, generic frameworks, premature future features or new dependencies without approval. Preserve existing behaviour unless the task requires a change. Prefer simple implementations and reuse existing infrastructure. Advanced systems, content and polish wait for their assigned tasks. Do not turn the project into a general-purpose engine; when a feature could become a WGS Starter Kit add-on, implement only what PAPI requires.
- For architectural changes, destructive cleanup or multi-system changes: inspect, present a concise plan with affected files and risks, and wait for approval. Small, clearly specified tasks may be implemented directly. Do not re-ask decisions already documented.
- **Stop when the assigned task's acceptance criteria are demonstrated.**

## Human approval

The developer owns game design, architecture approval, prioritisation, gameplay evaluation, final review, and Git. Claude analyses, proposes, implements approved tasks, writes and runs relevant tests, and reports.

**Never commit, push, merge or publish without explicit approval.** Never terminate a development server or process the agent did not start.

## MANDATORY: risk-based testing only

Applies to every task unless the developer explicitly overrides it, and takes precedence over anything in `docs/testing.md`.

- Run only tests directly relevant to the changed code and its immediate dependencies; prefer targeted unit tests and narrowly scoped E2E specs, reusing existing coverage.
- Do not automatically run the full unit suite, the full E2E suite, broad smoke suites, browser soaks, mutation campaigns or long simulation benchmarks.
- Do not rerun passing tests without a relevant code change or demonstrated reason. Do not add unrelated tests to raise coverage.
- When broader testing seems necessary: name the specific regression risk, explain why targeted coverage is insufficient, and **ask for explicit authorisation** first. Finishing a task, or a suite existing, is not a justification.
- A successful exit code is not proof that all tests passed. Execute commands and report actual counts, failures and unresolved risks.
- Test integrity: never delete tests because they fail, weaken assertions, alter acceptance criteria without approval, or replace real input tests with internal method calls. Never claim determinism without verifying it.

## Architecture invariants

- `src/core/` is pure domain logic and **must not import Phaser**. `src/scenes/` renders, takes input and wires state to visuals; no gameplay rules in scenes. Placement rules stay unit-testable without Phaser.
- Gameplay simulation runs on the **fixed 60 Hz** `SimulationClock`, independent of frame rate. New simulated systems run inside `GameScene.stepSimulation()` and draw randomness from seeded RNG (`this.rng`, or a system's own seeded stream). No Phaser timers, `Math.random()` or `Date.now()` for gameplay outcomes. The simulation never waits on animations or audio.
- Logical resolution 1280x720 (`Scale.FIT`, `CENTER_BOTH`); never assume screen coordinates equal world coordinates.
- Phaser 4 ESM has no global: `import Phaser from 'phaser';`. One HTML entry point (`index.html`). No physics system without a gameplay requirement.

## Test Shadow and TEST_MODE

- The QA harness exists only when `import.meta.env.DEV` is true **and** the URL has `?testMode` (`src/testMode.js`). Production must never expose it.
- `addProxy` for things a player clicks (transparent, `pointer-events: none`); E2E tests press through `clickAction`/`tapAction` and real canvas points, **never by calling Phaser handlers directly**. Detailed state belongs in `window.__qa.getState()`, not DOM attributes.
- QA interfaces observe or control the real implementation. **No parallel test-only gameplay logic, and no QA helper may bypass validation that applies to the player.**
- Details: `docs/testing.md`.

## Definition of Done

The requested functionality is implemented; relevant unit and Playwright tests pass; the production build succeeds (not required for documentation-only changes); existing functionality is intact; no unrelated files changed; limitations documented; no unapproved dependencies; no commit or push without authorisation.

### Required completion report

1. Summary of changes
2. Files added, modified or removed
3. Tests executed and results (actual counts)
4. Build result
5. Remaining limitations or risks
6. Decisions requiring developer approval

**Stop after the report. Do not begin the next task automatically.**
