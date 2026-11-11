# Architecture

Relocated and condensed from the root `CLAUDE.md` (TASK 038). Read this before a change that crosses
`src/core/` and `src/scenes/`, touches the tick order, the clock, the RNG, the grid or the scene/HUD split.
Source code is authoritative for details; per-module contracts are in `docs/gameplay-systems.md` (core) and
`docs/presentation.md` (scenes).

## Layers

| Path | Owns | Rule |
|---|---|---|
| `src/core/` | Domain rules: phases, economy, placement, grid, power, pollution, waves, combat, units, logistics, simulation state | Never imports Phaser. Unit-testable in Node. |
| `src/scenes/` | Phaser rendering, input, camera, HUD, visual feedback, wiring domain state to visuals | No gameplay rules. Layers are presentation only. |
| `src/content/` | Pure editorial data: newspaper, stories, field manual, advice | No simulation effect. |
| `src/audio/` | SoundManager, GameAudio, soundMap, advice narrator | Presentation only; `src/core` never knows about it. |
| `src/testShadow/` | TestProxy, QASurface, TEST_MODE-only QA helpers | No-ops outside TEST_MODE; never bypasses player validation. See `docs/testing.md`. |

`GameScene` holds the world and the simulation; `HUDScene` draws screen-space UI. They talk only through
`src/scenes/EventBus.js` (`State` down, `Command` up, `Notice`, `Hud.READY`/`Hud.SNAPSHOT`).

## Simulation (fixed step, deterministic)

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

Note: the list of tick consumers in the paragraph above is the original one and is incomplete; the
authoritative order is `GameScene.stepSimulation`, summarised below.

### Wiring in GameScene

- The clock is created stopped. Start calls `cycle.begin()`, which starts it paused for Day 1. *(Stale: in the ACTIVE cycle this is the untimed Day 0; the calendar still reads day 1)*
- `update(time, delta)` calls `clock.advance(delta, stepSimulation)` then `syncShiftUi()`, and ignores Phaser's `time`.
- `stepSimulation(tick)` counts `stepsExecuted`, calls `cycle.onTick(tick)`, then `siegeCannons.step()`, then `autocannons.step()`, then `gates.step()` with the demands of trucks, soldiers and workers, then `infantry.step()`, then `workers.step()`, then `mutants.step()`, then `ecologists.step()`, then `logistics.step()`. `loudspeakers.step()` runs first, right after `cycle.onTick()`. Shots and destroyed buildings are handled from that tick's results: `handleBuildingsDestroyed` removes the views, clears a stale selection and calls `refreshPower()`.


## Day Shift

Day 0, the first Day of a run, is an untimed planning phase for the initial base: nothing ticks until END DAY. Every later Day is timed (3600 ticks) and runs the simulation, so Factories produce and trucks deliver; the player can pause it, change its speed, or END DAY to fast-forward the rest of it through the normal simulation. Dusk (300 ticks) follows every Day and recalls the workers.

Gameplay actions are discrete commands, such as:
- Place building
- Change building power state
- Repair building
- End day

The player must not be forced to make planning decisions under a real-time countdown: Day 0 has none, and a timed Day can be paused. Pausing a timed Day is for looking: camera, selection and inspection work, and every gameplay change waits for PLAY. Day 0 is untimed, not paused, so everything can be built in it.

## Night Shift

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

## Grid and construction

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

## Phaser 4 conventions

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

Rendering (1280x720 logical, `Scale.FIT`, `CENTER_BOTH`, camera-aware coordinates) is in `docs/presentation.md`.
