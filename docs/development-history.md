# Development history

Relocated from the root `CLAUDE.md` (TASK 038). **Historical context, not instructions**: nothing here
authorises starting a task, and superseded behaviour must not be reimplemented. Task status below is as last
recorded in `CLAUDE.md`; the developer, not this file, decides what is current.

## Status as last recorded (before TASK 038)

**Current status:** TASK 023 (HEAVY METAL) is complete. TASK 024 (HUD Reconstruction & Mobile UX) and TASK 024.1 (Mobile Building Ghost & Two-Step Placement) are implemented and uncommitted, awaiting the developer's review and a real-device test. TASK 025.3 (Workers & Work Flag) is implemented and uncommitted, awaiting the developer's review. TASK 025.4A (Active Day, Dusk & Terrain Movement, with its follow-up: Day 0, the persistent work flag and the Day speed reset) is implemented and uncommitted, awaiting the developer's review. TASK 025.4B (Jungle Clearing & Pollution) is implemented and uncommitted, awaiting the developer's review. TASK 025.4C (Paid Building Repairs) is implemented and uncommitted, awaiting the developer's review. TASK 026 (Deposits & Mines, which supersedes the old TASK 020 backlog item) is complete: playtested and accepted by the developer. TASK 027 (ECOLOGISTAS! Daytime Environmental Protests) is complete: playtested by the developer. TASK 027.1 (Worker DISPERSE) is implemented and approved; not yet playtested. TASK 028 (Loudspeaker Tower, with Outpost and Loudspeaker art, and the provisional menu layout) is accepted by the developer. TASK 029 (LA VOZ DE SAN PAPI, the morning newspaper, placeholder content with El Papi's portrait) is accepted by the developer. TASK 030 (Sound, SFX & Music) is accepted by the developer after manual audio verification. TASK 031 (Combat Visual FX, with the Spitter's acid splatter) is accepted by the developer. TASK 032 (HUD & UI Overhaul, with the BUILD and AUDIO world hold) is implemented and uncommitted, awaiting the developer's review. TASK 033.1 (THE LITTLE YELLOW BOOK, the in-game manual, with the main menu's controls moved onto the HUD's buttons) is implemented and uncommitted, awaiting the developer's review. TASK 033.2 (El Presidente's Day 0 cameo) is implemented and uncommitted, awaiting the developer's review. TASK 033.3 (Presidential Advice, written tips) is implemented and uncommitted, awaiting the developer's review. TASK 033.4 (the presidential voice for advice, with the developer's ten recordings) is implemented and uncommitted, awaiting the developer's manual check. TASK 034 (La Voz de San Papi's Presidential Decrees and editorial polish, content only) is implemented and uncommitted, awaiting the developer's review. Only work on tasks the developer explicitly assigns.

The project was initialized from the Wee Games Starter Kit Basic. The original demo applications have been removed.

Implemented so far: grid placement, Credits and AP, the active Day/Dusk/Night cycle (an untimed Day 0 for the first build, then timed Days with pause and speed controls), Factories and trucks that work by Day and Night, terrain-dependent walking for workers and soldiers, worker jungle clearing that adds Pollution, paid building repairs by HQ's workers, a Night tint, global power, nightly settlement, pollution and derived threat, one basic mutant type that damages and destroys buildings, the Autocannon, which kills mutants, and nightly waves that scale with the night, Threat Level and Autocannon count, a player-built HQ whose destruction ends the run, Night speed controls, a road network, Factories that earn only when trucks deliver GOODS to HQ, walls and gates that mutants must breach or go round, Barracks that deploy squads to a rally flag each Night, Spitters, the first ranged mutant, from Night 5, Brutes, a slow breaching mutant, from Night 30, and two heavy counters, the Siege Cannon and Rocket specialization for Barracks. Repairs are explicit orders on a damaged building, carried out by HQ's workers by Day.

## Implementation sequence and backlog

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
- Test reliability (known, tracked separately): `tests/e2e/clearing.spec.js` (desktop) has hit the same 15 s timeout with 3 workers while the long ecologist tests ran beside it, and passes alone. `tests/e2e/repairs.spec.js` touch tests on the jungle map (notably "DESTROY is the Killdozer square…" at 844x390) can exceed the 15 s test timeout with 3 workers on the developer's machine. With one worker they take about 7.2-7.5 s, and the failure reproduces without TASK 027. The cause is not identified; the TASK 026 ore canvas is only a candidate. During TASK 028, four `walls-gates.spec.js` mobile tests timed out the same way in an 8-spec, 3-worker batch, and all 28 tests in that spec passed with one worker. The timeout and assertions stay unchanged. Next step: a focused investigation comparing startup and rendering timings with one and with three workers, to find the bottleneck before changing any code.

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
- Late waves (TASK 037, provisional, for playtesting): until then Nights 40-100 were one identical 34-mutant wave. In headless scripted runs at Night 75 composition, the player's `golden-fortress-jungle-v3` held 60 slots in 5 of 5 seeds for a median bill of about 240 Credits, 80 slots in 4 of 5 for about 1.8k, and 100 slots in 2 of 5; `golden-fortress-brute-defense-v3` held 100 in 5 of 5. Browser cost was measured only on software rendering; at 4x speed the clock fell behind as counts rose (about 200 ticks/s at 40 live, 147 at 100, against 240). Real phones and economies are not measured.
- Brutes and their counters (approved with these values, balance still provisional): real play reached Day 32 with an evolved fortress under Brutes, which supports the current values. In scripted runs on `golden-fortress-day33-v2`, 1 Siege Cannon and a Rocket squad on a scripted flag cut the estimated Night 40 rebuild bill from about 418 to about 48 Credits, so concentrated heavy weapons may make Nights 35 to 40 too comfortable. A Siege Cannon also takes most armed Spitter kills where no squad is active, though active flags keep their value. See GDD section 14 and `npm run test:soak:heavy`.
- Jungle map: the spawn frame keeps combat identical to the open map for a base in the clearing, so the map's far jungle plays no part in a Night yet. The clearing has about half the open map's buildable tiles, which squeezes late bases and is not yet playtested. Production always plays one world seed, so the map, like the waves, is the same every run. Rally flags can be set in the jungle.
- Repairs (provisional): HQ damage is no longer permanent, at 1 Credit per HP, and other buildings cost 60% of their price for full HP. Every soak baseline and balance note that assumed permanent damage predates this; none has been rerun.
- Active-cycle Factory income (accepted provisionally, not final): Factories now work through the timed Day, Dusk and Night with no reset, so one Factory earns about 360 to 390 Credits a cycle against 150 a Night before, about 2.45x. Production rates, cargo and payouts are unchanged. Roads now cost 2 Credits a tile.
- Loudspeakers (provisional playtest values, TASK 028): a tower that broadcast by Day is a 384-bias magnet that Night, with 100 HP, so protecting the roads by Day costs a defended or rebuilt tower by Night; worker DISPERSE is the free alternative. Not playtested.
- Ecologists (provisional playtest values, TASK 027): at most 3 groups a Day and 900 ticks each, so a single delivery lane loses at most about a quarter of a Day per group. Nothing but walls, gates and time counters them until TASK 028. Not playtested.
- Mines (provisional playtest values, TASK 026): a Mine pays 60 Credits a load against a Factory's 30, at the same rate, but its deposit lies beyond the spawn frame, so its road crosses the frame and long routes and truck time cut what it really earns. Reaching deposit-1 on the default seed takes two work flags whose circles hold 47 jungle tiles, so up to +47 Pollution if the workers finish both, because clearing is the unchanged radius-3 circle. That alone can cross the Threat thresholds at 25 and 50 (Threat 1 to 2, or 2 to 3 on top of other emissions) before the Mine earns anything. Accepted for now: clearing and deposit generation stay as they are until manual playtests judge it. A powered Mine draws mutants from the frame's nearest edge; an undefended one fell on Night 3 in a scripted run. None of this is playtested.
- Starting budget: 1250 Credits is approved. Power Plant + Factory + Autocannon costs 1150, so the first Day can include all three. A no-income turtle can buy three Autocannons and a Plant, with a median defeat of Night 20 from the centre and Nights 23-24 from corners in scripted runs.

## Known stale statements

Found during TASK 038 and marked *(Stale: …)* in place rather than rewritten:

- The status paragraph above stops at TASK 034; TASKS 035 (Day 1 helicopter), 036/036.1 (Day 100 ending) and 037 (late wave cap) are in git history and `docs/presentation.md` / `docs/gameplay-systems.md` but in no status list.
- "Implementation sequence" lists nothing after TASK 026 as complete or awaiting review, though TASKS 027-037 are described elsewhere.
- `buildingPlacement.js` notes: "there is no repair yet" (repairs exist, TASK 025.4C).
- `mutants.js` notes: "There is no pathfinding" for obstacles, beside the bounded detour BFS for fortifications.
- GameScene simulation notes: "paused for Day 1" (ACTIVE cycle: Day 0).
- Audio: "Minimum controls until TASK 031" and "`papi_final` for the Night 99 ending" (AUDIO panel came in TASK 032; the ending is Day 100, TASK 036).
- Touch drawer: "A HUD redesign waits for the newspaper"; `MENU_SLOTS` no longer exists in `src/`.
- Pre-TASK 032 pixel layouts in GameScene, `BuildingControls` and `SpeedControls` notes (marked in `docs/presentation.md`).
- The old "Simulation Architecture" consumer list (ShiftCycle, SiegeCannons, Autocannons, Gates, Infantry, Mutants, Logistics) omitted Loudspeakers, Workers and Ecologists; `docs/architecture.md` now gives the full `stepSimulation` order.
- `walls.png` and `gate-regular.png` are described as no longer loaded, yet remain in `public/assets/sprites/buildings/` (shipped but unused). *(Resolved, TASK 040: they, `units/rifleman.json`, `units/rocketman.json` and `characters/el-papi.gif` moved to `art-src/sprites/retired/`, nothing deleted)*
- `music.txt`, referenced by `SOUND_MAP.txt`, does not exist (already recorded under Audio).

