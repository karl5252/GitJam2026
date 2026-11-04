# PAPI INDUSTRIES: THE GREEN SHIFT
## Game Design Document · v0.2 · 4 November 2026

**Status:** Active graybox development · TASK 011A completed, TASK 011B proposed (not approved)\
**Genre:** Industrial management + survival tower defense + corporate satire  
**Platform:** Browser (itch.io), desktop and mobile landscape  
**Engine:** Phaser + Vite · public GitHub game repository  
**Jam:** Game Off 2026 · theme **SHIFT**  
**One-line pitch:** Build the industry. Poison the wilderness. Survive what comes out of it. Your boss will take the credit.

> **Scope rule:** Playability first; art and optional systems can be cut without breaking the core loop. Figures throughout are starting hypotheses, not balanced final values.

> **Authority note (4 Nov 2026):** Sections marked **IMPLEMENTED** describe the current agreed behavior as reported for completed tasks 001–011A. **PLANNED** sections are design intent, not permission for an agent to implement them. **OPEN** items require explicit developer approval. The repository source code and tests must be inspected to verify implementation details. `CLAUDE.md` governs workflow; this GDD governs gameplay intent. An agent must not automatically start the next task when resuming a session.

### Implemented graybox baseline (TASKS 001–011A)

- **IMPLEMENTED:** Phaser 4/Vite graybox, 1280×720 logical canvas (`FIT`, centered), 24 columns × 16 rows of 32 px tiles (grid origin 256,104 in the current presentation); mouse/touch selection, placement previews and actual building selection.
- **IMPLEMENTED:** Instant Day-only construction. Initial **1000 Credits / 5 AP**; Outpost 1×1 costs **100 Credits / 1 AP**; Factory 3×3 costs **400 / 1 AP**; Power Plant 3×3 costs **500 / 1 AP**. The older construction-queue idea is **deferred**, not active.
- **IMPLEMENTED:** Deterministic 60 Hz simulation and seeded RNG; untimed Day, 3600-tick Night; AP resets to 5 at dawn. Test-only pause/resume/manual stepping; QA instrumentation absent in production build.
- **IMPLEMENTED:** Global power, no wires. Plant supplies **100**, Factory demands **40**, Outpost demands **10**. Each building has an independent persistent `enabled` flag, toggleable for free during either shift. Power is derived, never duplicated: NORMAL if supply ≥ enabled demand; LOW_POWER if 0 < supply < demand; BLACKOUT if supply = 0 and demand > 0. Under LOW_POWER or BLACKOUT **all enabled consumers are unpowered**, without automatically switching them OFF. No priority-based shedding.
- **IMPLEMENTED:** Night-end economic settlement: powered Factory **+150 Credits**; Outpost upkeep **−20 Credits** regardless of power; Plant contributes no income/upkeep in current graybox. Calculation uses **end-of-night power state**, even if toggled in the last tick. Debt is allowed; construction cannot overspend.
- **IMPLEMENTED (TASK 010, per agent completion report):** Pollution starts at **0**, accumulates once per completed night, with **no decay**. An enabled generating Plant emits **+12**, an enabled powered Factory **+8**, Outpost **0**. Threat is derived: pollution **0–24 ⇒ 1**, **25–49 ⇒ 2**, **50–99 ⇒ 3**, **100+ ⇒ 4**. Threat is not yet connected to actual enemies. Credits and pollution are jointly prevalidated before night-end settlement; the game uses a synchronous pollution-then-Credits commit with no rollback. 
- **IMPLEMENTED (TASK 011A, temporary graybox values, not balanced):** One basic mutant spawns at night tick **600** on the grid border, using one seeded draw; a blocked border cell moves the spawn to the next free position clockwise, and the spawn is skipped if every border cell is occupied. Mutant: **40 HP** (nothing damages it yet), **0.5 px per tick** in world pixels, axis-based movement, **8 px** attack range, **5 damage every 60 ticks**. Target choice is the lowest Manhattan distance to the footprint minus a bias of **256** (Power Plant), **128** (Factory) or **0** (Outpost), with deterministic tie-breaks, and the target stays locked until destroyed. A building blocking the next step becomes a temporary obstacle target, attacked until destroyed before the mutant resumes; there is no pathfinding. Building HP: Outpost **100**, Factory and Power Plant **300**. Damage persists across nights. Destruction removes the building and its occupancy together, and power, settlement and pollution use the remaining buildings. Mutants act on night ticks 1–3599, and survivors are removed at dawn with no penalty. With no buildings left, a mutant waits until dawn. Damaged buildings show a graybox HP bar.
- **NOT YET IMPLEMENTED:** HQ/loss condition, mine/deposit extraction, trees/terrain clearing, turrets and defensive fire, damage to mutants, building repairs, attack-pressure scaling, newspaper, policies/directives, decorative environmental changes and final art. Do not treat their descriptions below as existing functionality.

### Next proposed task: TASK 011B (not approved)

A separate **Autocannon** defensive building is the next proposed task. It is **not approved**, and no work may begin without explicit developer approval. Its footprint remains **OPEN** (see section 14). **Do not assume Outpost is a turret.**


## 1. Vision and design pillars

The player is a foreman operating a resource-extraction complex in the fictional Republic of San Papi. PAPI Industries owns mines, refineries, automotive businesses, energy generation, defense systems, and much of the national narrative. The objective is to keep the operation profitable and survive as many shifts as possible. Industry generates revenue and pollution; pollution makes nighttime wildlife attacks more dangerous. More defense demands more electricity, which may demand more industry.

**Pillars**
1. **Two shifts, two modes:** untimed strategic daytime planning with action points; 60-second realtime nighttime defense.
2. **Self-inflicted escalation:** industrial expansion increases profit and environmental threat.
3. **Readable, emergent defense:** power supply, placement, hardpoints and enemy target preferences create strategy without complicated RTS micromanagement.
4. **Mobile-first restraint:** tap-friendly controls, clear preview/confirmation and no mandatory reading or twitchy daytime countdown.
5. **Deadpan corporate satire:** a ludicrous ruler treats every disaster as proof of his genius; game systems deliver the joke.
6. **Testable from day one:** deterministic 60 Hz simulation and explicit, game-specific QA hooks.

### Theme: SHIFT
- **Day Shift / Night Shift:** two different kinds of player decisions.
- **Environmental Shift:** a green jungle becomes brown industrial wasteland; a blue river turns toxic fluorescent green.
- **Policy Shift:** costly or exploitative operating policies alter economics and environmental harm.
- **Strategic Shift:** expansion eventually becomes survival; directives periodically disrupt established defenses.

## 2. Core loop

1. **DAWN / newspaper:** show previous night's actual statistics, finances, changes in pollution, staff losses and any new directive; narrative articles are lower down and optional.
2. **DAY SHIFT (untimed):** spend limited Action Points (AP) and Credits on clearing trees, commissioning/placing buildings, repairs and selected policy decisions; position defenses, manage ON/OFF states, plan deployment. Tap **END DAY** when ready.
3. **NIGHT SHIFT (60 s in simulation time):** enemies emerge and seek industrial targets; turrets fire automatically; the player may switch buildings ON/OFF, respond to shortages and, if troops are implemented, move a rally flag. No new construction.
4. **DAWN:** snapshot economic results and combat telemetry, apply losses and maintenance, resolve timers/directives, reset AP, generate the next newspaper.

**Time architecture:** game logic advances in fixed 1/60-second ticks. A realtime accumulator drives ticks during the night (with capped catch-up); game logic is independent of wall-clock time. Daytime planning does not passively generate resources or pollution; visual ambience may animate independently. A headless runner can advance a full night deterministically.

**Run-ending conditions (provisional):** HQ destruction, or sustained insolvency over an agreed number of shifts. **Score:** days survived and cumulative net profit, with secondary environmental / personnel statistics. No conventional final victory.

## 3. World and camera

- **IMPLEMENTED graybox:** logical square grid with **32×32 game-world pixels per tile**, currently **24×16** cells; alternate map dimensions (including 5×5 QA maps, 24×24 and 32×32) are future test/design options, not current production maps.
- **Styled top-down / oblique 2.5D:** normal square grid and collisions, but buildings display a roof, a short frontal face and shadow; no perspective rotation of map coordinates.
- One or more fixed/procedurally seeded resource deposits; mines require valid deposit locations. This creates a reason to expand beyond the protected HQ.
- Jungle trees occupy terrain cells and require clearing before industrial placement. Rivers and impassable terrain are blockers (exact map layout TBD).
- Building sprite footprint is decoupled from visual extents; art can extend above/below occupied cells.
- First build uses only colored rectangles, footprints, target markers and debug overlays. Commit to pixel art only after playtesting scale.

**Provisional footprints:**

| Structure | Footprint | Purpose |
|---|---|---|
| HQ (planned) | 3×3 | Central command, critical loss condition |
| Mine (planned) | 2×2 | Deposit-linked extraction / revenue |
| Refinery (planned) | 3×2 | Higher value output, high power/pollution |
| Factory (implemented) | 3×3 | Current graybox income producer (+150 if powered) |
| Outpost (implemented) | 1×1 | Current power consumer and upkeep cost; **not** an autocannon |
| Power plant | 3×3 | Generates power and pollution |
| Waste treatment | 2×3 | Reduces pollution at a monetary/power cost |
| Machine-gun turret (planned) | 1×1 | Rapid anti-swarm fire |
| Autocannon (planned) | **OPEN** | Separate defensive structure, not an Outpost. Prior art brief assumed 1×1; older GDD assumed 2×2. Confirm before TASK 011B. |
| Heavy turret (planned) | 2×2 provisional | Slower, stronger coverage; distinct from Autocannon if retained |
| Barracks (optional) | 2×2 | Deploys guards at night |
| Fence / wall (optional) | line of segments | Damageable passive cover |
| Minefield (optional) | tile / section | Consumable damage |
| Road (optional) | painted tiles | Cosmetic only: no logistical system |

## 4. Building and input

**IMPLEMENTED construction:** instant construction constrained by Credits and AP, available during Day only. Placement previews show valid/invalid cells; attempts that fail validation do not change resources or occupancy. The older C&C-style commission/wait/ready-to-place queue is **DEFERRED** and must not be implemented without a new design decision. Do **not** introduce a realtime day clock to justify a progress bar.

**AP baseline:** **5 AP** per Day; placing each implemented building costs **1 AP**; ON/OFF toggles cost **0 AP** in Day and Night. Tree removal, repairs, queued construction and policy-change AP costs remain **PLANNED / OPEN** and are not present in the graybox.

**Footprints:** placement must reject out-of-bounds, occupied, blocked terrain, wrong deposit and insufficient resources/AP without mutating the game state. Crew members never occupy structural grid cells: if a new building overlaps a wandering crew sprite, the NPC relocates to a valid adjacent location.

**Fence/wall input (optional):** select start and end, snap to a horizontal/vertical section, preview footprint and costs, then confirm. Cost in Credits scales with length; AP applies per construction action, with a maximum segment length. Segments connect visually by adjacency.

**Mobile-first controls:** tap to select building/tool, tap/drag to preview, explicit confirm/cancel; drag to pan (when not placing), pinch to zoom; choose generous hit targets despite small logical cells. Camera/position conversion must handle zoom and scaling. Desktop uses mouse/keyboard equivalents. Landscape is the intended game orientation.

## 5. Economy and power

**Core model:**
- **Credits:** construction, repairs and operational expenses.
- **Power:** generation, consumption, available reserve; not a transport network.
- **Pollution:** environmental cost and driver of night difficulty.
- **Corporate share:** headquarters retains a fixed or progressively changing portion of gross production. Only the foreman's allocated share is spendable.
- **Global climate index:** longer-term persistent escalation distinct from local pollution; exact formula deferred.

**IMPLEMENTED power management:** one global pool; no cables, priority tiers or automation. Each building has an **ON/OFF** choice available in both shifts. **Do not reject** switching ON merely because it creates a deficit: under a deficit, all enabled consumers become effectively unpowered (LOW_POWER or BLACKOUT), but their `enabled` flags remain unchanged. The player can restore NORMAL by reducing enabled demand or increasing supply. Power plant destruction must recalculate the same global rules when combat is introduced. This intentionally supersedes the earlier `INSUFFICIENT POWER` rejection idea. **OPEN balance question:** whether total-consumer shutdown is too punitive.

**IMPLEMENTED economic cadence:** no passive income during Day. The night settles **once at tick 3600**, using the enabled/powered state **at that final moment**, for both economic income and pollution. This is a deliberate graybox simplification, **not an anti-exploit solution**. **OPEN balance issue:** last-tick switching can grant a full night of income or avoid a full night of emissions. Consider time-weighted accounting only after basic combat and power-balancing playtests. The simultaneous Credits/Pollution settlement validates safe integers before committing either change.

## 6. Ecology, policies and threat

**IMPLEMENTED ecology baseline:** emissions are computed once at night-end from powered/enabled buildings: Power Plant **+12**, Factory **+8**, Outpost **0**. Pollution starts at zero, only increases, and has no natural decay. Current HUD shows Pollution and derived Threat. **Threat levels:** 0–24 → 1; 25–49 → 2; 50–99 → 3; ≥100 → 4. **NOT YET IMPLEMENTED:** attack-budget scaling, terrain palette evolution, filters and waste treatment. Future treatment and filters may reduce net pollution at a power/money cost. Visual changes should prefer runtime tinting, overlay and limited tile replacements over separate full tilesets.

**Policy domains (first examples):**
- Waste disposal: river discharge (cheap / dirty) versus treatment (costly / cleaner).
- Emission standards: unfiltered chimneys versus paid filtration.
- Forest management: clear-cutting versus selective extraction / conservation.

Policy changes occur during day, spend AP, and generally persist until changed. Temporary **Papi directives** are a separate system, typically lasting 2–5 completed cycles; they are not part of baseline player policies. Only one disruptive directive should be active at once in early versions, with mandatory advance notice in the morning newspaper and clear HUD countdown. A directive must never create an unavoidable no-defense state: check whether viable alternatives are available.

**Threat formula:** the **implemented Threat Level** is only the discrete derived indicator defined above, **not** yet a wave budget. **PLANNED attack pressure** will use a deterministic mapping from day, Pollution/Threat and possibly climate debt; coefficients and unlock thresholds are **OPEN**, and must not be invented as part of TASK 011A. Different enemy archetypes may later unlock at thresholds.

## 7. Defense, enemy AI and hardpoints

The player may choose exposed expansion (**overreach**) to maximize resource extraction, or clustered fortified bases/hardpoints to reduce defense perimeter. A **hardpoint is not a special building**: it is an emergent arrangement of walls, turrets, terrain and possibly guards. Avoid fake adjacency buffs.

**PLANNED target selection:** mutants prefer **power plants and HQ**, then refineries/mines; current Factory and Outpost must be given explicit provisional priorities in TASK 011A rather than silently being treated as canonically equivalent. Civilian crew are opportunistic prey when nearby. Turrets may become retaliation targets; walls become attackable obstacles when implemented. Combine target weight with reachable distance and deterministic tie-breaking / retarget hysteresis so enemies do not jitter. Different enemy types may override preferences. The temporary graybox rule is listed in the implemented baseline; the final algorithm and distance metric remain **OPEN**.

**Initial enemy taxonomy (future balance; only one graybox basic mutant exists, and none of these archetypes is implemented yet):**
- Small critter: about 8×8 px, quick, weak, appears in swarms.
- Spitter / medium: about 12–16 px, ranged or tougher.
- Brute: about 16–24 px, attacks structures, favors major infrastructure.
- Behemoth: 32 px and larger, eventual exceptional threat that justifies heavy weapons; not necessary for initial playable milestone.

**Defensive roles (PLANNED, not TASK 011A):** MG/autocannon for groups, heavy slow turret for large targets (minimum range and rotation/cooldown weaknesses if used), passive walls and single-use mines as late additions. Turrets require energy, repairs and construction cost. **Autocannon is a separate building, not an upgraded Outpost.** Bigger guns should not be universally optimal against small fast threats.

**Night pacing:** 60-second escalating sequence with sparse early pressure, more fronts mid-shift and climax late. Night must be interesting rather than just a minute of hands-off animation.

## 8. Civilian crew and guards (optional)

**Civilian crew:** 8-pixel ambient NPCs walk slowly between buildings during the day. They do not gather resources, produce money or block building footprints. When a nearby threat/alarm occurs, they panic and run for HQ/shelter. Mutants may consume them; losses appear in the newspaper.

**Guards:** barracks deploy a limited paid group of tiny units **only at night**. In daytime they remain inside, invisible. Without a rally marker they form a local guard post near their barracks. With a marker they travel to a small cluster around that position, stop and fire at targets within a fixed effective range; **they do not chase enemies**. During the night the player can move a **global emergency rally flag** to redirect guards to a breach, at the cost of travel time, not AP. No formations, morale, combat pursuit or soldier micro. Survivors return to barracks at dawn; replacements cost Credits. Details await post-core implementation.

## 9. The Daily Progress: the newspaper as UI

The daily paper serves as the **single morning report** and a major narrative tool. It is an HTML/CSS overlay over canvas with native vertical scrolling. Top fold always prioritizes actionable information. Tap `X` to dismiss immediately. Last edition can be reopened from the HUD; archive is optional.

**Article order:**
1. Actual shift stats: net/gross income, company share, maintenance, power issues, employees lost, enemy kills, destroyed buildings, pollution/climate change.
2. Clear active/new directive, mechanical effect and remaining cycles.
3. Optional flavor below: interviews, side news, advertisements, contradictory propaganda.

Headlines may lie, but mechanical stats and directive text must be accurate. A nonreader can still understand the game from the top of the paper.

**Content pipeline:** `ShiftResult -> EventRules -> SelectedContent -> NewspaperTemplate`. Store offline static text in JSON, with fields such as `id`, `category`, `conditions`, `priority`, `weight`, `once`, `cooldownDays`, `headline`, `body`, `quote`. Seed selection for replay and Playwright. No runtime LLM, API or token cost. Generate large batches externally, then editorially review and validate schema/duplicates.

**Sample schema:**
```json
{
  "id": "environment_green_river_001",
  "category": "environment",
  "priority": 50,
  "weight": 2,
  "once": false,
  "cooldownDays": 5,
  "conditions": { "pollutionMin": 70 },
  "headline": "LOCAL RIVER ACHIEVES HISTORIC GREENNESS",
  "body": "Company scientists hail the remarkable coloration as proof of national environmental leadership.",
  "quote": "The river isn't contaminated. It's branded. — Papi"
}
```

## 10. Narrative style and Papi

The country exists in an **intentionally unspecified year**, with mismatched technology: industrial smokestacks, old diesel trucks, electric SUVs, futuristic defenses and vintage propaganda. Papi is a fictional industrial mogul, president-for-life, charismatic deal-maker and self-declared inventor. He has more money and power than judgement; he takes credit for other people's work and redefines his own claims until they are technically compatible with something that happened. He is **never performing comedy intentionally**. The newspaper solemnly validates his statements; the accounting figures contradict them.

**Three distinct voices:**
- **Papi:** boastful, improvisational, repetitive, tangential, always right in his own narration.
- **The Daily Progress:** official, grandiose, euphemistic, uncritically supportive.
- **Finance/security report:** factual, concise, internally consistent.

**Canon quote (must feature on game page, QA section, exact wording):**
> "I personally invented Quality Assurance. We tested everything. All failures are now scientifically confirmed to be somebody else's fault."

**Other approved voice examples / seed library:**

| Context | Quote / headline |
|---|---|
| Intelligence | "The only intelligence you need is Papi. Papi thinks for you." |
| Independent thought | "Thinking is hard. Let Papi do it." |
| Innovation | "I am the smartest man on Earth. Scientific fact. Not proven." |
| Evidence | "I own seventeen laboratories. If I needed evidence, I'd buy some." |
| Leadership | "Papi does not make mistakes. Papi creates learning opportunities for others." |
| Quality | "All tests were personally supervised by Papi. Technical execution was delegated to less important individuals." |
| Environment | "The river isn't contaminated. It's branded." |
| Forest | "We planted ten thousand trees. Beautiful trees. Then we discovered minerals underneath. Even better." |
| Workers | "Our employees are our greatest asset. Unfortunately, assets depreciate." |
| Pollution headline | "PAPI INDUSTRIES REPORTS 400% INCREASE IN BIODIVERSITY!" |
| Emergency | "Nobody could have predicted a second Behemoth." |
| Export media | "Why listen to the news when you can be hit by it?" |
| Press | "We have achieved 100% freedom from unwanted information." |
| Corporate reporting | "The numbers speak for themselves. Especially the good ones." |
| Game over | "Your replacement will arrive tomorrow." |

**Invented-autocannon interview beat:** Papi says he invented the cannon personally; admits scientists designed it under his leadership; says his key contribution was asking for it to be bigger and black; finally reveals that he ordered a finished product online and chose express shipping. His final claim: he invented the historic purchasing process.

**Sample temporary directive:** `HUMAN-FIRST DEFENSE INITIATIVE` (2–5 cycles): automated turrets temporarily disabled; guard recruitment discounted. The player should know at dawn and have a viable preparation path. Not a mandatory jam MVP feature.

**Satire principle:** critique propaganda, corporate greenwashing, concentration of power, executive credit-taking and shifting blame; avoid referencing or copying real politicians' exact speech. Humor should arise from systems as often as text.

## 11. UX and accessibility

- Mobile landscape is first-class; test desktop and emulated mobile, then sanity-check physical mobile hardware.
- Canvas placement and camera controls must be comfortably tappable; never infer intent from a tiny 8-pixel hit target.
- Select building -> compact menu -> explicit `ONLINE/OFFLINE`; no required double-tap.
- During the night the menu does **not** pause simulation; background/focus loss should pause automatically for safety/usability.
- Newspaper can be scrolled or closed instantly, with data above flavor. Avoid making long satirical interviews required reading.
- Color coding needs icons/text for accessibility; use UI scale suited to mobile, high contrast for night, and explicit invalid placement overlays.

## 12. Technical architecture / QA

**Suggested eventual project boundaries (conceptual, NOT the current repo layout):**
```text
src/
  game/
    config/       building/enemy/balance configs
    simulation/   fixed 60-Hz step, seeded RNG, authoritative state
    systems/      grid, buildings, economy, power, combat, waves, ecology
    scenes/       Phaser rendering and input
    qa/           PAPI-specific __qa adapter (test builds only)
  ui/             HUD, newspaper overlay, menus
  content/        newspaper JSON, text rules
 tests/
    unit/         grid invariants and economics
    e2e/          Playwright mouse / mobile tap / canvas placement
    simulation/   deterministic combat, power, day/night
```

**Non-negotiable separation:** simulation is the only source of gameplay truth; rendering and input call the real production operations. Test APIs are adapters, not separate gameplay implementations. The public QA adapter may be tightly coupled to this one game; private Wee Games Starter Kit universal entity-extraction tools need not be included or imported.

**Example QA surface (historical concept only, NOT an implemented API; do not implement unapproved test-only gameplay shortcuts):**
```js
window.__qa = {
  getSnapshot: () => simulation.snapshot(),
  advanceTicks: n => simulation.advanceTicks(n),
  reset: opts => simulation.reset(opts),
  setPollution: n => environment.setPollution(n),
  spawnMutant: (kind,x,y) => enemies.spawn(kind,x,y),
  gridToCanvas: (col,row) => view.gridCenterInCanvasCoordinates(col,row)
};
```

**Testing layers:**
- Unit/property tests: arbitrary rectangular footprints, 5×5 grid boundaries, collisions, deletion reversibility, costs/AP rollback and fences.
- Playwright: actual clicks/taps on Phaser canvas and state assertion via snapshot; desktop mouse + mobile landscape touch emulation; zoom/pan, menu, newspaper scroll and dismissal.
- Deterministic simulation: stable update order, seeded RNG, fixed dt and explicit clock. No `Date.now()`/real timers in gameplay logic. Run full nights in seconds of test execution by advancing ticks, not waiting 60 s.
- Separate real mobile smoke pass for hit-target size, touch ergonomics, browser throttling and performance.

## 13. Scope plan and cut order

**P0: playable core (protect at all costs)** — **completed:** deterministic grid/footprints, instant placement, AP/Credits, Power Plant/Factory/Outpost, day/night, power, economic settlement, pollution and derived Threat, one mutant with damage/destruction. **Remaining:** at least one separate defensive turret, pollution affecting attack pressure, HQ/loss condition, compact factual morning summary. **Trees and mine/deposits** remain design intent to prioritize or cut for the jam based on time.

**P1: game identity (strongly preferred; not yet implemented)** — full newspaper template with static contextual articles; basic Policies; terrain color evolution; more building/enemy roles; intuitive power ON/OFF and mobile landscape polish.

**P2: expandable if time remains (not yet implemented)** — civilian crew ambience; section walls and mines; barracks/rally flags; random Papi directives; heavy enemies/Behemoth; newspaper archive; decorative roads.

**Post-jam** — advanced enemy specializations, expanded industries, campaign/scenarios, complex directive sets, more troop roles, environmental simulation depth.

**Current task sequence (implementation authority remains the explicit human-approved task):** TASK 010 Pollution **complete**; TASK 011A basic mutant **complete**; TASK 011B separate Autocannon **proposed, not approved**; then HQ/loss, attack-pressure integration, morning report and balance, subject to explicit reprioritization. Art integration stays near the end after gameplay stabilization.

**Milestone gates:**
1. **Graybox:** two building footprints, one resource, one defense and one attack wave work without art.
2. **Playable:** one full day/night/dawn cycle, basic power/pollution economy and losing conditions.
3. **Jam-ready:** complete loop, morning report, touch controls and repeatable QA tests.
4. **Polish:** cosmetic assets, content library, sound, extras only after readiness.

**Cut rule:** cut features, enemy varieties and art detail before compromising stability of the core loop. Avoid new mechanics during final week.

## 14. Open questions / graybox experiments

1. **Construction queue:** deferred after choosing instant AP/Credits construction; revisit only if the immediate-placement loop proves inadequate.
2. **AP granularity:** does a single tree cost AP, or should clearing use a small selected area to avoid tedious tapping?
3. **Power deficit:** implemented NORMAL / LOW_POWER / BLACKOUT with full consumer shutdown during deficit, preserving enabled flags. Playtest fairness; do not change it implicitly.
4. **Enemy pathing:** A* / flow-field / direct steering? Need obstacles, damageable fences and deterministic tie-breakers.
5. **Balance:** is 60 seconds of night engaging with only automated turrets? Make waves meaningful, not punitive or idle.
6. **Production accounting:** implemented at night end using the final power state for BOTH revenue and emissions; known toggle exploit remains a balance issue.
7. **Softlocks:** prevent HQ spawns, tree layouts or resource placement from creating unwinnable starts.
8. **Technical/IP:** public repository can show PAPI-specific QA code, but avoid copying private starter code or asset packages unless licenses and redistribution rights permit.
9. **TASK 011A combat values:** coordinate system aligned to 32 px cells, mutant HP, building HP, target priority/tie-breaking, spawn cadence, approach to rectangular footprints, damage persistence and dawn cleanup were approved as temporary graybox values for TASK 011A (see the implemented baseline). Final combat balance remains **OPEN**.
10. **Autocannon footprint and turrets:** previous GDD and art brief disagree (2×2 vs 1×1); resolve when TASK 011B is designed.
11. **Economy safety:** `Economy.adjustCredits` historically validated the delta but not the resulting safe-integer balance; TASK 010 prevalidates night-end settlement specifically. Broader Economy hardening is separate work.

## 15. Definition of done: first playable slice

- A 5×5 QA map and a larger normal map use the same placement rules.
- The player can clear terrain, order/place at least two differently sized structures, reject invalid placement and spend AP/Credits correctly.
- Power generation and consumption affect whether a turret can operate.
- One deterministic 60-second night wave can damage structures and end in victory or loss.
- Pollution changes risk in a verifiable way.
- A morning report presents real results and transitions back to day.
- Desktop mouse and mobile landscape taps pass Playwright E2E; simulations pass headless tests.

> **PAPI INDUSTRIES:** Building Tomorrow with Yesterday's Ethics.
