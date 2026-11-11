# Combat performance baseline

Recorded on 4 November 2026 for TASK 012B, on top of commit `d4c979b`.

This is a single-machine baseline for comparison over time. **All timing is report-only**, and no timing value fails a test. Hard failures cover correctness: determinism, invariants, combat activity, lifecycle cleanup, production isolation and runtime errors. The one behavioural exception is ticks per second in real-time browser runs, explained below.

## Commands

```bash
npm run test:soak                 # headless, about 1 minute; writes soak-results/domain.json
npm run test:soak -- --quick      # shorter subset, without the 2000-mutant scenarios
npm run test:soak:browser         # Chromium, about 3.5 minutes; writes soak-results/browser-*.json
```

The soak suites are separate from `npm run test` and `npm run test:e2e`. The browser suite uses one worker, port 5175, no server reuse and no tracing.

Optional hardware-GPU run, which does not block anything and has not been recorded yet:

```bash
npx playwright test --config playwright.soak.config.js --headed -g "real time"
```

Each result file records its renderer, labelled `software` or `hardware`. Never compare the two directly.

For a fair run, keep the machine awake, leave free disk space, and close other browsers and dev servers.

## Environment

| Item | Value |
|---|---|
| CPU | Intel Core i5-10400F, 2.90 GHz |
| RAM | 16 GB |
| Node | 20.19.0 |
| Browser | Playwright 1.64.1 headless Chromium |
| Renderer | **Software**: ANGLE, SwiftShader |
| Phaser | 4.2.1 |

## Workload classes

- **Synthetic:** test-only spawn schedules and resources, plus mid-night rebuilding through the real `placeAt()` with an isolated open construction gate. This keeps combat going under load. It says nothing about normal construction rules or the economy.
- **Legal:** the real planner, starting resources, construction gate and settlement, using only commands a player can issue.

The nightly cap, 20 when this was measured and 40 since TASK 015, does not apply to synthetic scenarios, because they use a fixed `schedule`.

## Domain results

Tick time covers `ShiftCycle`, `Autocannons` and `Mutants`. It excludes the harness's checks and rebuilding. All values are from one full run; the digests of every repeat matched.

| Scenario | Class | Spawned | Shots | Kills | Attacks | Destroyed | Rebuilt | Peak alive |
|---|---|---|---|---|---|---|---|---|
| 20 mutants, 4 cannons | Synthetic | 20 | 60 | 15 | 478 | 17 | 17 | 20 |
| 100 mutants, 12 cannons | Synthetic | 100 | 376 | 94 | 635 | 22 | 22 | 98 |
| 500 mutants, 12 cannons | Synthetic | 500 | 248 | 59 | 12117 | 383 | 379 | 460 |
| 500 mutants, 36 cannons | Synthetic | 500 | 2000 | 500 | 2542 | 49 | 49 | 372 |
| 2000 mutants, 12 cannons | Synthetic | 2000 | 248 | 59 | 18456 | 651 | 645 | 1941 |
| 2000 mutants, 36 cannons | Synthetic | 2000 | 3933 | 976 | 15162 | 299 | 296 | 1462 |
| 20 mutants, 20 nights | Synthetic | 400 | 1288 | 322 | 3826 | 117 | 112 | 20 |
| Survives 20 nights (seed 98) | Legal | 239 | 951 | 237 | 34 | 0 | 0 | 9 |
| Collapses (seed 1) | Legal | 146 | 12 | 3 | 150 | 3 | 0 | 12 |
| No defense | Legal | 110 | 0 | 0 | 120 | 2 | 0 | 10 |

| Scenario | p50 ms | p95 ms | p99 ms | Max ms | Turrets ms/tick | Mutants ms/tick | Approx. bytes/tick | GC events / ms |
|---|---|---|---|---|---|---|---|---|
| 20 mutants, 4 cannons | 0.015 | 0.049 | 0.212 | 0.737 | 0.013 | 0.009 | 5.5 K | 54 / 13 |
| 100 mutants, 12 cannons | 0.012 | 0.074 | 0.145 | 1.293 | 0.016 | 0.008 | 14 K | 65 / 13 |
| 500 mutants, 12 cannons | 0.143 | 0.373 | 0.615 | 2.321 | 0.065 | 0.114 | 16 K | 162 / 39 |
| 500 mutants, 36 cannons | 0.090 | 0.624 | 0.756 | 1.080 | 0.132 | 0.067 | 42 K | 121 / 26 |
| 2000 mutants, 12 cannons | 0.486 | 0.797 | 0.991 | 1.562 | 0.128 | 0.359 | 53 K | 227 / 60 |
| 2000 mutants, 36 cannons | 1.933 | 2.633 | 2.945 | 6.142 | 1.031 | 0.692 | 44 K | 1011 / 240 |
| Survives 20 nights | 0.002 | 0.006 | 0.010 | 5.537 | 0.002 | 0.001 | 8 K | 45 / 14 |

- Scenarios that fight less can show lower percentiles even at higher counts, so read timing with the workload columns.
- Allocation is approximate. It sums positive heap changes between chunks, and it includes the harness's own work.
- A tick can be expensive once in a while: the 5.5 ms maximum in a cheap legal run is a single outlier, likely JIT or GC. It is not a sustained cost.

## Browser results (software rendering)

Real-time runs only. Frame numbers are never taken from QA stepping.

| Scenario | Ticks/s | Frame p50 / p95 / p99 / max ms | Frames over 20 ms | Sim ms/tick | Scene update ms/frame | Render callbacks ms/frame | Unattributed ms/frame |
|---|---|---|---|---|---|---|---|
| Idle night | 59.2 | 16.7 / 33.3 / 33.4 / 33.5 | 27 of 333 (8%) | 0.036 | 0.144 | 0.240 | 17.6 |
| Defended, 20 scheduled | 59.8 | 16.7 / 33.3 / 33.4 / 33.5 | 351 of 3262 (11%) | 0.034 | 0.142 | 0.244 | 18.1 |
| Undefended, 20 alive | 59.7 | 16.7 / 33.3 / 33.4 / 33.4 | 327 of 3289 (10%) | 0.021 | 0.126 | 0.325 | 17.9 |
| Ramp 100 | 59.4 | 16.7 / 33.3 / 33.4 / 33.4 | 56 of 844 (7%) | 0.096 | 0.281 | 1.257 | 16.2 |
| Ramp 200 | 59.6 | 16.7 / 33.3 / 33.4 / 33.4 | 48 of 851 (6%) | 0.114 | 0.325 | 1.819 | 15.5 |
| Ramp 500 | 59.1 | 16.7 / 33.4 / 33.4 / 83.4 | 272 of 620 (44%) | 0.148 | 0.559 | 3.124 | 20.5 |
| Ramp 1000 | 59.1 | 33.3 / 50.0 / 50.1 / 83.4 | 381 of 703 (54%) | 0.135 | 0.677 | 4.311 | 23.3 |

How to read the columns:

- **Scene update** includes simulation.
- **Render callbacks** is the time between Phaser's `prerender` and `postrender`. It is CPU-side submission only, not GPU work.
- **Unattributed** is what remains of the frame. It includes vsync wait, browser, compositor and GPU time. At 60 Hz, about 16 ms of it is simply waiting. It is not evidence of a specific cost.
- **Frame times** arrive in 16.7 ms steps, so percentiles jump between 16.7 and 33.3.
- **Ticks per second** is a hard check in realistic scenarios, at a minimum of 57. It is a behaviour check, not a speed target: the clock drops time once frames pass its 100 ms cap, so a shortfall means gameplay has really slowed.

## Lifecycle

20 stepped nights with `waveBudget=4`, legal commands only. Three turrets were destroyed, two were rebuilt, and a destroyed selection cleared twice.

At every dawn, static objects stayed at 26, scene listeners excluding proxies at 49, game listeners at 19 and input listeners at 2. There were no tweens, and no mutant views or stale turret state.

Each `DOMElement` adds 3 scene listeners, so the TEST_MODE toggle proxy is excluded from that comparison. The base fell on night 9, so nights 10 to 20 only confirm that an empty board stays clean.

## First measured bottleneck

**Rendering-side work is the first cost to grow with mutant count. The simulation is not the limit.**

- In the browser, from 20 to 1000 mutants, render callbacks grew from about 0.24 to 4.31 ms per frame, while simulation stayed under 0.15 ms per tick.
- Frames first degrade clearly between 200 and 500 mutants: 6% to 44% of frames over 20 ms. Unattributed time rises by about 5 ms there, which callbacks cannot see.
- This run uses **software rendering**, so GPU-side cost here says little about real hardware. A hardware-GPU run is needed before treating that part as a real problem.
- The simulation kept real time throughout, at over 59 ticks per second even at 1000 mutants.

At the former cap of 20, there is no measurable pressure. Idle and 20-mutant nights are indistinguishable: both show 33 ms frames at a similar rate, so those frames are not caused by combat.

**Inside the domain,** a CPU profile of 2000 mutants and 36 cannons shows `Mutants.snapshot()` at 31.4% of self time (`mutants.js:185`), followed by `blockerAt` at 14.7%, `Mutants.step` at 12.3% and building lookup at 10.9%. Turrets call `snapshot()` per turret per tick. The profiled script also called it once per tick itself, so that share is somewhat inflated.

That is about 2 ms per tick at 100 times the real cap. It does not justify optimization now.

## HQ and defeat (TASK 013)

The recorded numbers above predate HQ, and the scenarios behind them use the legacy HQ-less setup, so they stay comparable. The domain soak adds `legal-hq-survives-20-nights` and `legal-hq-undefended-defeat` on the real HQ rules, and the browser soak adds repeated defeat and restart cycles, with hard checks on objects and listeners.

## Test execution (TASK 014)

Measured on 5 November 2026, wall clock, including dev server startup. Regular E2E runs 199 tests at 3 workers with tracing off.

| Workflow | Tests | Wall time |
|---|---|---|
| Unit | 418 | About 2 s |
| Smoke, first run of a session | 13 | 27.7 s (includes a cold Vite start) |
| Smoke, repeat runs | 13 | 14.2 s |

Measured when 13 tests carried the tag. There are 19 since TASK 019.

| Unit + smoke | 431 | 17.0 s |
| Full regular E2E | 199 | 175.5 s before TASK 014, 180.4 s after |
| `npm run test:full` | 617 | 177.6 s |

Migrated tests now build HQ first, which accounts for the few extra seconds in full E2E. Unit + smoke is about 10 times faster than full E2E.

### What smoke catches

24 mutations across all game systems, run against smoke alone:

- **Caught (15):** HQ lock, HQ supply, HQ menu refresh, purchases not charged, low power stopping nothing, toggle ignored, income ignored, pollution not emitted, AP not restored, night never ending, turrets never firing, mutants never attacking, HQ loss not defeating, restart doing nothing, overlay not shown.
- **Missed (9):** END DAY gate, grid bounds, upkeep, turret cooldown off by one, collision, dawn cleanup, wave Threat term, Defense Response, later mutants acting after defeat.

The unit suite caught all 9 misses, so unit + smoke caught all 24. These are targeted mutations, not a coverage measure. Smoke was deliberately not tuned to raise this score, and it never replaces full regression.

### Boot failures

Failure-only diagnostics now attach `boot-diagnostics.json` to any failed `boot()`. Forced failures confirmed that a blocked script, a throwing script and a hung request each produce a distinct report, and that the original error is kept.

| Observed | Symptom | Context |
|---|---|---|
| TASK 012B stability run | `data-scene` empty after 10 s | Around the time the PC slept, tracing on |
| TASK 013 first full run | `data-scene` empty after 10 s | No sleep, before any HQ code |
| TASK 014 first full run | `page.goto: net::ERR_NO_BUFFER_SPACE` | Before any game code |

No failure reproduced in 1,189 stress boots (slowest 821 ms) or 325 stress test runs. `TIME_WAIT` sockets peaked at 862 of 16,384 ports during a full run, so port exhaustion is not the cause. The third failure shows the browser's network layer can fail on this machine. Whether the first two share that cause is unproven, although one failed module request does produce the same `data-scene` symptom. The root cause is unknown.

## Wave cap of 40 (TASK 015)

Real-time browser nights on the same machine, on 5 November 2026, with a Plant and two Autocannons:

| Night | Ticks per second | Simulation mean ms | Render callbacks mean ms | Frames over 20 ms |
|---|---:|---:|---:|---:|
| 20 mutants | 59.7 | 0.033 | 0.235 | 272 of 3343 (8%) |
| 40 mutants, full window | 59.8 | 0.033 | 0.235 | 149 of 3463 (4%) |
| 40 mutants, ending on tick 1200 | 59.6 | 0.039 | 0.501 | 402 of 3215 (13%) |

`?waveBudget=40&waveLastTick=1200` is the shortest approved window. 36 mutants were alive at the last spawn, and they destroyed the whole test base by dawn. The simulation kept real time, and render callbacks stayed under 3 ms per frame at worst. More frames exceeded 20 ms, always at the 33 ms step this machine also shows when idle, and p50 stayed at 16.7 ms. This is one run with software rendering, so that share is not a stable measurement.

## Night speed (TASK 016)

Complete real-time Nights at 4x on the same machine, on 5 November 2026, with a Plant and two Autocannons and software rendering. Each Night ran twice.

| Night | Run | Real seconds | Ticks per second | Frames over 20 ms | Frame p50 / p95 / max ms | Simulation mean ms | Scene update mean ms | Render callbacks mean ms |
|---|---|---:|---:|---:|---|---:|---:|---:|
| 4 mutants | 1 | 15.24 | 236.2 | 115 of 798 (14%) | 16.7 / 33.4 / 33.4 | 0.013 | 0.337 | 0.382 |
| 4 mutants | 2 | 15.18 | 237.0 | 120 of 789 (15%) | 16.7 / 33.4 / 33.5 | 0.012 | 0.345 | 0.383 |
| 40 mutants ending on tick 1200 | 1 | 15.05 | 239.0 | 0 of 902 (0%) | 16.7 / 16.7 / 16.8 | 0.011 | 0.216 | 0.364 |
| 40 mutants ending on tick 1200 | 2 | 15.17 | 237.2 | 112 of 795 (14%) | 16.7 / 33.4 / 50.1 | 0.021 | 0.403 | 0.659 |

Frame pacing varied between 0% and 15% slow frames, and the same stress Night gave both 0% and 14%, so two runs cannot show whether speed or load affects it. Throughput held in all four runs, because the frame cap applies before the speed, so 33 ms frames still run the right number of ticks. A frame runs at most 24 ticks, up from 6, and time beyond that is dropped. No real mobile hardware has been measured.

## Fortress benchmarks (TASK 017)

`npm run test:soak:fortress` runs separate references from Night 22 at full HP with no player input: the original FORTRESS 22 and the TASK 017 road-legal variant, both historical in worlds without roads since TASK 018 added fixed docks, and the technical logistics reference with real roads and trucks. They measure combat. Survival is report-only and is not a target. A player-derived fortress will replace the historical ones.

## Walls at 4x (TASK 019)

`npm run test:soak:fortification` runs `fortification-reference.json`, a base inside 199 walls and one gate, under 40 mutants ending on tick 1200. Node, after warm-up, seeds 98 and 1:

| Layout | Tick p50 ms | Tick p99 ms | 24 ticks at p99 ms |
|---|---:|---:|---:|
| No walls | 0.008 | 0.03 | 0.7 |
| 199 walls | 0.07 | 0.24 | 5.9 |
| 177 walls, with gaps | 0.06 | 0.23 | 5.4 |

The first case of a run is slower (0.8 ms p99), which looks like JIT warm-up. Part of the difference is workload rather than walls: without them mutants reach the cannons sooner and die. The 24-tick column assumes every tick of a frame is a p99 tick, so it is an upper bound.

In Chromium with software rendering, the 4x walled Night ran at 237.5 ticks per second, with a simulation mean of 0.11 ms, against 236.9 and 0.033 ms for the logistics reference. One run on one machine, with no mobile hardware.

## Spitters (TASK 022)

`npm run test:soak:spitters`, on 6 November 2026, Node, about 3 minutes. Each base runs on the real planner with Spitters and with the same waves of ordinary mutants. Survival is report-only and never a target. "Fell" is the median Night, with 31 meaning it survived all 30.

| Base | Seeds | Fell, ordinary | Fell, Spitters | Armed Spitters killed | Shell damage |
|---|---:|---:|---:|---:|---:|
| Turtle, centre | 30 | 20 (18-21) | 12 (11-14) | 0 of 493 | 23450 |
| Turtle, north-west corner | 30 | 24 (21-26) | 13 (11-15) | 92 of 516 | 16490 |
| Turtle, south-east corner | 30 | 24 (21-26) | 13 (11-15) | 110 of 561 | 17390 |
| Compact, 3 cannons | 10 | 21 (19-22) | 12 (11-14) | 7 of 156 | 7220 |
| Compact, 6 cannons | 10 | 31 (all survived) | 14 (10-16) | 47 of 191 | 7150 |
| Barracks-free, 3 cannons + 38 walls | 10 | 21 (19-23) | 17 (14-19) | 16 of 334 | 15810 |
| Squad, static flag | 10 | 16 (11-18) | 13 (12-15) | 25 of 181 | 7550 |
| Squad, active flag | 10 | 16 (11-18) | 13 (11-14) | 142 of 174 | 4890 |
| `fortress-checkerboard-v1` | 10 | 31 (27-31) | 31 (26-31) | 843 of 1050 | 20620 |

The ordinary turtle medians match those recorded for TASK 015, which is the control. The developer has since playtested this and kept the Spitter unchanged: a managed base with income reached Day 40, so the early fall of these static bases is accepted. These bases have no income, rebuilding or repairs and nobody plays them, so this is the worst case for a weapon that wears things down. "Active" is a stand-in for a player that sends the flag to a Spitter once it has fired. Simulation stayed under 0.05 ms a tick in every case, so the Spitter adds no measurable cost.

## Brutes (TASK 023 checkpoint)

`npm run test:soak:brutes`, on 6 November 2026, Node, about 90 seconds, 10 seeds. Report-only. "Whole base" is one Night from an undamaged layout, as a player who rebuilds each Day would face it. Lost buildings are per Night, in `golden-fortress-day33-v2`.

| Night | Brutes reaching the base | Median first contact tick | Killed before dawn | Walls lost | Other buildings lost | Cannon shots at Brutes | Ordinary mutant damage |
|---|---:|---:|---:|---:|---:|---:|---:|
| 30 | 10 of 10 | 1906 | 10 of 10 | 1.2 | 0 | 30% | 1.4x |
| 35 | 19 of 20 | 1476 | 19 of 20 | 2.0 | 0.2 | 48% | 3.2x |
| 40 | 30 of 30 | 1714 | 28 of 30 | 4.1 | 0.9 | 61% | 5.3x |

With nobody playing from Night 28 to Night 45: `golden-fortress-day33-v2` falls at a median of Night 37 (9 of 10 outlast Night 45 without Brutes), `fortress-checkerboard-v1` at 33 (without Brutes 42), and `fortress-logistics-v1` at 30 either way. Bases have no income in these runs.

## Heavy weapons (TASK 023)

`npm run test:soak:heavy`, on 6 November 2026, Node, about 4 minutes, 10 seeds. Synthetic and report-only: no value is a target, and none of this is a playtest. "Static" flags never move. A "scripted flag" is a stand-in that sends the first squad to a Brute, once per target. Rebuild is the estimated Credits to replace what one Night destroyed.

| Night 40, whole `golden-fortress-day33-v2` | Spent | Brutes killed | By cannon / squad / Siege | Brutes reaching the base | Rebuild |
|---|---:|---:|---|---:|---:|
| As built | 0 | 28 of 30 | 24 / 4 / 0 | 30 | 418 |
| 1 more cannon | 250 | 28 of 30 | 25 / 3 / 0 | 30 | 243 |
| 1 Rocket squad, static | 200 | 28 of 30 | 23 / 5 / 0 | 28 | 250 |
| 1 Rocket squad, scripted flag | 200 | 27 of 30 | 19 / 8 / 0 | 30 | 343 |
| 1 Siege | 600 | 29 of 30 | 18 / 1 / 10 | 19 | 178 |
| 1 Siege + Rocket squad, static | 800 | 29 of 30 | 16 / 6 / 7 | 19 | 165 |
| 1 Siege + Rocket squad, scripted flag | 800 | 30 of 30 | 15 / 7 / 8 | 19 | 48 |
| 2 Siege, one cannon demolished | 1200 | 29 of 30 | 11 / 1 / 17 | 15 | 200 |

Rows with an extra Plant are in the result file but are not a fair comparison: the script puts it on the nearest free spot, outside this fortress's walls, where it is lost every Night and takes all power with it. With 10 seeds, one lost Plant moves a row by 50 Credits.

| Siege against Spitters, Nights 1-29 | Median fall | Shots per Spitter | Armed kills: cannon / squad / Siege | Siege shots at Spitters |
|---|---:|---:|---|---:|
| 3 cannons | 12 | 4.65 | 7 / 0 / 0 | |
| 5 cannons | 13 | 4.06 | 26 / 0 / 0 | |
| 3 cannons + Rifle squad, static | 14 | 4.15 | 11 / 26 / 0 | |
| 3 cannons + Rifle squad, scripted flag | 16 | 3.18 | 16 / 221 / 0 | |
| 3 cannons + Siege | 12 | 3.49 | 6 / 0 / 45 | 16% |
| 3 cannons + Siege + Rifle squad, static | 15 | 2.95 | 10 / 30 / 66 | 18% |
| 3 cannons + Siege + Rifle squad, scripted flag | 17 | 2.46 | 13 / 178 / 80 | 15% |

## Known gaps

- One machine and one run. Rerun before treating any number as a trend.
- Software rendering only. No hardware-GPU result is recorded.
- Desktop viewport only, and no real mobile hardware.
- Synthetic scenarios use one spawn per tick, so a ramp of N takes N ticks to reach full load.
- The 8 to 11% of 33 ms frames at idle are unexplained. They may belong to this environment.

## Release candidate audit (TASK 040)

Measured on 11 November 2026, same machine, Chromium headless with software rendering, dev server with `?testMode` unless noted. GPU texture memory was counted by wrapping the page's WebGL `createTexture`/`texImage2D`/`texStorage2D`/`deleteTexture` (level 0, 4 bytes a texel); no game code was added for it.

| Scenario | Live GPU textures | GPU MB before | GPU MB after |
|---|---:|---:|---:|
| Main menu | 58 | 7.5 | 7.5 |
| Fresh jungle (48x32) | 127 / 124 | 103.8 | 31.8 |
| Golden jungle colony | 131 / 128 | 103.8 | 31.8 |
| Night, 40 mutants ending on tick 1200, 1x | 131 / 128 | 103.8 | 31.8 |
| After 3 defeats and restarts | 127 / 124 | 103.8 | 31.8 |
| Mobile landscape 844x390, colony | 130 / 127 | 103.8 | 31.8 |

- The change: TerrainLayer's per-seed generated picture, bare ground and ore (three 3072x2048 canvases, 24 MB each, only ever read) are plain canvases instead of Phaser `CanvasTexture`s, so only the run's copy is on the GPU. Screenshots of a fresh jungle and of the same jungle after a scripted clearing of 18 tiles are pixel-identical before and after (0 of 435,200 pixels differ). The CPU-side canvases are unchanged (about 72 MB for the jungle).
- Texture upload at Start fell from 206.9 to 62.9 MB. Frame and render timings did not change: render callbacks 0.59 ms a frame for the colony and 0.63 to 0.65 ms in the 40-mutant Night, simulation 0.14 ms a tick, 60 ticks a second. Frames sit on the 33 ms step this software renderer always shows.
- Restarts accumulate nothing: textures, game objects (19 after Start) and listeners are the same after each of three defeat-restart cycles.

Production build (`vite preview`, OGG browser), cold load: JS 506 KB transferred, PNG 244 KB, effects and voices 2.27 MB (82 files) at boot, and the music about 9.2 MB more after the first gesture. The last boot request ended at about 530 ms locally. Images are about 2% of the transfer, so atlasing or PNG optimisation cannot gain much; the sprite sheets stay as they are.
