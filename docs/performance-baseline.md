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

The nightly cap of 20 does not apply to synthetic scenarios, because they use a fixed `schedule`. Production balance is unchanged.

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

At the real cap of 20, there is no measurable pressure. Idle and 20-mutant nights are indistinguishable: both show 33 ms frames at a similar rate, so those frames are not caused by combat.

**Inside the domain,** a CPU profile of 2000 mutants and 36 cannons shows `Mutants.snapshot()` at 31.4% of self time (`mutants.js:185`), followed by `blockerAt` at 14.7%, `Mutants.step` at 12.3% and building lookup at 10.9%. Turrets call `snapshot()` per turret per tick. The profiled script also called it once per tick itself, so that share is somewhat inflated.

That is about 2 ms per tick at 100 times the real cap. It does not justify optimization now.

## HQ and defeat (TASK 013)

The recorded numbers above predate HQ, and the scenarios behind them use the legacy HQ-less setup, so they stay comparable. The domain soak adds `legal-hq-survives-20-nights` and `legal-hq-undefended-defeat` on the real HQ rules, and the browser soak adds repeated defeat and restart cycles, with hard checks on objects and listeners.

## Known gaps

- One machine and one run. Rerun before treating any number as a trend.
- Software rendering only. No hardware-GPU result is recorded.
- Desktop viewport only, and no real mobile hardware.
- Synthetic scenarios use one spawn per tick, so a ramp of N takes N ticks to reach full load.
- The 8 to 11% of 33 ms frames at idle are unexplained. They may belong to this environment.
