# PAPI INDUSTRIES: THE GREEN SHIFT
## Game Design Document - v0.4 - 8 November 2026

**Status:** Active graybox development; TASK 025.4A (active Day) and TASK 025.4B (clearing) reported implemented; two-sheet gate art integration reported implemented. TASK 025.4C (manual paid repairs) design approved, implementation pending. Wall-art topology hotfix deferred pending artwork.  
**Genre:** Industrial management + survival tower defense + corporate satire  
**Platform:** Browser (itch.io), desktop and mobile landscape  
**Engine:** Phaser + Vite · public GitHub game repository  
**Jam:** Game Off 2026 · theme **SHIFT**  
**One-line pitch:** Build the industry. Poison the wilderness. Survive what comes out of it. Your boss will take the credit.

> **Scope rule:** Playability first; art and optional systems can be cut without breaking the core loop. Figures throughout are starting hypotheses, not balanced final values.

> **Authority note (8 Nov 2026):** **REPORTED IMPLEMENTED** means the developer received an agent completion report and targeted test results; actual repo state is authoritative and should still be checked. **DESIGN APPROVED / IMPLEMENTATION PENDING** means rules are agreed but not yet confirmed in code. **PLANNED / CONCEPT** is deferred and not permission to implement. **OPEN** requires an explicit choice. `CLAUDE.md` governs coding/testing; this GDD governs gameplay intent. Completing an earlier task does not authorize an agent to start a subsequent task without approval.

### v0.4 change log (8 November 2026)

**Reported implemented; subject to code review:**

- **TASK 025.4A:** initial untimed **Day 0** with no fieldwork/production, then Dusk / Night 1, followed by active, timed 3600-tick Days; 300-tick Dusk, 3600-tick Night. Day pause is look-only. 1×/2×/4× controls apply to active time; each new Day resumes at 1×, unpaused. `END DAY` advances remaining simulation ticks in bounded batches instead of skipping them.
- **Production/logistics redesign:** powered factories produce GOODS, trucks operate and deliveries pay throughout active **Day, Dusk and Night** (not during initial Day 0), rather than during Night alone. The one-time night-end Pollution settlement still applies. Prior factory income/balance observations are historical.
- **Worker lifecycle:** three persistent HQ workers venture out in active Day, stop work and physically recall at Dusk, and can be attacked if still outside during Night. **Placing or MOVING the persistent work flag costs 1 AP per action**; sending/recalling workers to/from an existing flag costs 0 AP. This supersedes the v0.3 daily-expedition AP rule.
- **Road/path movement:** player roads cost 2 Credits per tile and 0 AP; HQ ring remains free. Worker and soldier speed: 1.2× on player roads/HQ ring, 1× on open/cleared ground or natural path, 0.65× in jungle. Path choice considers travel time.
- **TASK 025.4B:** workers reach the persistent flag first, then chop exclusive jungle jobs inside a circular radius of 3 tiles. Each jungle tile takes **300 worker ticks**, turns into buildable **CLEARED** ground, and produces **+1 Pollution once**. Partial tile progress survives recall and flag relocation. Worker clearing animation uses ACTION frames **8–9**, with **10–11** reserved for repair. Restart restores the generated jungle; exported layouts do not record terrain clearing.
- **Gate art hotfix:** independent horizontal and vertical gate sheets, no sprite rotation, 8 frames each, 32×48 frame cells (horizontal art occupies lower 32×32), 5 px gap; visual vertical gate extends **16 px above** its 32×32 logical tile footprint. Input, pathing, collision and gate state logic remain unchanged. Targeted unit/browser tests reported passing.

**Approved next design, not a completed feature:**

- **TASK 025.4C:** explicit **REPAIR / STOP REPAIR** orders on selected damaged buildings; up to 3 assignments, one persistent HQ worker per building, no work flag required, 10 HP restored per 60 active Day ticks, no extra AP. Worker repairs use ACTION frames 10–11. Orders automatically cancel if Credits are insufficient, but pause at Dusk and resume next Day. Proposed repair cost: 60% of building cost prorated by restored HP; HQ 1 Credit/HP. Exact integer/fractional ledger requires deterministic implementation; price and rate remain balance-tuning values.
- **Wall art / topology** is a separate future hotfix: proper native vertical continuations, end caps, wall/gate joins and neighbour refresh. No art changes authorized until corrected sheets arrive.
- **Protesters / LOUDSPEAKER (approved concept, not implemented):** neutral environmental protesters have white shirts with an Earth symbol, green helmets and banners. Physical loudspeaker towers have a **3-tile circular influence radius** each. A **single ON/OFF switch in HQ** controls the broadcast network: ON disperses protesters near active towers by Day, and attracts nearby mutants to the same towers by Night. Detailed placement/power/AI rules remain open.
- **Night 99 finale (approved narrative, not implemented):** surviving **Night 99** leads to the comic ending. El Papi is eaten by a mutant; **that mutant** wears the Colonel's cap and succeeds him. After the ending, the **menu presidential portrait and golden bust switch to bitten variants**. No new combat boss or transformed/reborn Papi is implied.
- **Audio pipeline (approved future approach):** adapt/reuse the **BarrelStorm SoundManager** architecture for this game's event-driven sound, subject to repository ownership/licensing checks. New **original El Papi loudspeaker voice lines will be recorded**; dialogue clips and mixing are not yet available. SFX and Spanish music candidates are inventoried below. None of these additions are part of 025.4C.
- **Mines/deposits, La Voz de San Papi, sound integration, protesters and LOUDSPEAKER, the Night 99 finale** remain separate upcoming tasks; no permission to implement them follows from their inclusion in this GDD.

### v0.3 change log (historical intentions superseded where v0.4 says otherwise)

- **Active Day -> Dusk -> Night -> Dawn** replaces the proposed untimed planning day. Provisional durations: Day **3600 ticks (60 s at 60 Hz)**, Dusk **300 ticks (5 s)**, Night remains **3600 ticks (60 s)**. Tune only after playtesting.
- Day remains a building/planning phase, but workers and ambient NPCs move while the day clock advances. `END DAY` **fast-forwards the remaining simulation ticks**, rather than skipping them.
- The **three controllable HQ workers** become daytime expeditions: first dispatch costs **1 AP per day**, same-day reassignment, recall and redispatch of surviving workers are free; they work only after reaching the work flag, automatically stop at Dusk, and physically return toward HQ. Stragglers can still be outside when Night attacks begin.
- Separate **ambient NPC workers** make the base feel inhabited. They are not controllable, do not provide LOS or production, and their deaths have no economic/gameplay penalty.
- Workers and military infantry gain a provisional **1.2x movement speed on constructed roads and the HQ ring**. The decorative dirt track gives no bonus. A player-placed road costs **2 Credits and 0 AP** (previously free); time-aware route preference is a design requirement to validate with actual navigation.
- **TASK 025.4B** will make workers clear jungle only after arriving at the flag, within the existing work radius (**3 tiles**, provisional). Each tile takes time to clear and adds Pollution; no free autonomous march deeper into the forest.
- **Preserved legacy state:** TASK 025.3 currently reports night-only, temporary workers and an untimed day. No new Day/Dusk functionality is claimed implemented here; TASK 025.4A and 025.4B remain separate deliverables.


### Implemented baseline and historical mechanics (TASKS 001–025.4B)

The list below retains original combat, building and economy details from earlier releases, updated with v0.4 superseding behavior where appropriate. Agent completion reports are not an independent repository audit.

- **IMPLEMENTED (historical starting baseline):** Phaser 4/Vite graybox, originally 1280x720 logical canvas (`FIT`, centered), 24x16 cells of 32 px each, mouse/touch selection, placement previews and actual building selection. **Current normal map is 48x32 jungle** and the open 24x16 map is retained for legacy scenarios (TASK 025.1). HUD/camera and mobile two-step placement were reconstructed in TASK 024/024.1.
- **IMPLEMENTED:** Instant Day-only construction. Initial **1250 Credits / 5 AP** (approved starting budget); Outpost 1×1 costs **100 Credits / 1 AP**; Factory 3×3 costs **400 / 1 AP**; Power Plant 3×3 costs **500 / 1 AP**. The older construction-queue idea is **deferred**, not active.
- **REPORTED IMPLEMENTED (TASK 025.4A):** Deterministic 60 Hz simulation and seeded RNG; initial untimed Day 0, then Dusk 300 ticks and Night 1 at 3600 ticks; subsequent Day 1 onward is active for 3600 ticks. Dusk and Night recur on their fixed tick budgets. AP resets once per dawn to 5. Active Day pause is look-only; gameplay changes are disabled while paused. `END DAY` fast-forwards remaining simulation ticks, not state transitions. QA instrumentation remains test-build-only.
- **IMPLEMENTED:** Global power, no wires. Plant supplies **100**, Factory demands **40**, Outpost demands **10**. Each building has an independent persistent `enabled` flag, toggleable for free during either shift. Power is derived, never duplicated: NORMAL if supply ≥ enabled demand; LOW_POWER if 0 < supply < demand; BLACKOUT if supply = 0 and demand > 0. Under LOW_POWER or BLACKOUT **all enabled consumers are unpowered**, without automatically switching them OFF. No priority-based shedding.
- **REPORTED IMPLEMENTED (025.4A economy):** Factory cash income is received on actual GOODS deliveries across active Day, Dusk and Night; this is no longer night-only income. Night-end settlement still applies once for industrial Pollution and other existing end-of-night accounting, based on the final powered/enabled state. All building upkeep fields currently remain 0; the field is not itself a repair-payment system. Debt can exist, but construction/purchases cannot overspend.
- **REPORTED IMPLEMENTED (TASKS 010/025.4B):** Pollution begins at 0; powered/enabled industrial emissions are added once at Night end (Plant +12, Factory +8, Outpost 0), with no natural decay. Every fully cleared jungle tile adds +1 Pollution immediately during Day, once only. Threat tiers: 0–24 → 1; 25–49 → 2; 50–99 → 3; 100+ → 4. Threat affects the next Night wave plan, sampled on that Night's tick 1, never recalculated during an active wave. Night-end settlement prevalidates the simultaneous Pollution and Credits accounting under existing rules.
- **IMPLEMENTED (TASK 011A, temporary graybox values, not balanced):** Mutants spawn on the grid border on the night's scheduled ticks, using one seeded draw each; a blocked border cell moves the spawn to the next free position clockwise, and the spawn is skipped if every border cell is occupied. Mutant: **40 HP**, **0.5 px per tick** in world pixels, axis-based movement, **8 px** attack range, **5 damage every 60 ticks**. Target choice is the lowest Manhattan distance to the footprint minus a bias of **256** (Power Plant), **128** (Factory) or **0** (Outpost), with deterministic tie-breaks, and the target stays locked until destroyed. A building blocking the next step becomes a temporary obstacle target, attacked until destroyed before the mutant resumes; there is no pathfinding. Building HP: Outpost **100**, Factory and Power Plant **300**. Damage persists across nights. Destruction removes the building and its occupancy together, and power, settlement and pollution use the remaining buildings. Mutants act on night ticks 1–3599, and survivors are removed at dawn with no penalty. With no buildings left, a mutant waits until dawn. Damaged buildings show a graybox HP bar.
- **IMPLEMENTED (TASK 011B, temporary graybox values, not balanced):** The **Autocannon** is a separate 1×1 defensive building: **250 Credits / 1 AP**, power demand **20**, **150 HP**, no income, upkeep or pollution, and a mutant target bias of **64**. It fires automatically during Night while enabled and powered, so LOW_POWER and BLACKOUT silence it. Range is **160 px**, circular and inclusive, from the footprint centre. Each hit deals **10 damage** instantly, with **30 ticks** between shots and no projectiles. It acquires the nearest living mutant in range, with ties going to spawn order, and keeps that target while it is alive and in range. It reacquires when the target dies or leaves range, and clears the lock when disabled or unpowered. Reacquiring never changes the cooldown. The cooldown pauses while unpowered and resets at dawn. Each Night tick resolves shift state, then turrets, then surviving mutants, so a mutant killed on a tick cannot act on it. Combat runs on night ticks 1–3599, and tick 3600 only settles.
- **IMPLEMENTED (TASK 012A, temporary graybox values, not balanced):** Each night's mutant count is **min(40, nightBudget + pollutionBudget + defenseResponse + accelerationBudget)**, where nightBudget = **1 + floor((night − 1) / 2)**, pollutionBudget = **2 × (Threat Level − 1)**, defenseResponse = **min(4, floor(max(0, Autocannons − 1) / 2))**, and accelerationBudget is defined under TASK 015 below. Every existing Autocannon counts, enabled or not, powered or not. The plan is sampled on night tick 1 and frozen until dawn, so a night's emissions affect the next night, and switching power or losing a cannon changes nothing that night. Spawns run from tick **600** to the night's last spawn tick, starting at **2700**, with gaps that shrink through the night, one per tick at most. A spawn skipped because the whole border is occupied is not retried. Night 1 at Threat 1 stays one mutant at tick 600. The HUD shows `Mutants N | Wave X/Y` during Night, where X/Y is scheduled slots reached out of total, not kills.
- **IMPLEMENTED (TASK 019, approved rules with provisional values):** **Walls** are 1×1, **25 Credits / 0 AP**, **100 HP**, with no power, upkeep or pollution. They cannot overlap roads, buildings or each other. **Gates** come in two orientations, Vertical (a vertical barrier across an east-west road) and Horizontal, at **100 Credits / 1 AP**, **150 HP**, with no power. A gate stands on a road tile with road on both sides along its passage axis. It cannot stand on the HQ ring or a dock tile, or strand a Factory dock, and the road under it cannot be removed while it stands. Corners take no gate; a junction can be gated if every dock keeps a route, which cuts the crossing branch at that tile. Both are built during Day and can be demolished during Day, free and with no refund, which is the only way to restore damage. **Gate operation:** gates are closed by default and cannot be commanded. A truck stops one tile short and the gate takes **150** ticks to open, stays open until the last truck has passed, and takes **60** ticks to close, so each crossing costs a truck 150 ticks. Trucks choose the quickest route by estimated time, at **32** ticks a tile plus **150** a gate. A destroyed gate leaves plain road, and at dawn all gates are closed. **Mutants:** walls and gates are obstacles, never targets. A mutant blocked by one looks once for an open way to a free tile next to its target, within **12** extra tiles, and otherwise attacks what blocks it; a mutant has **24** extra tiles and **4** plans for its whole life. **No path never means no attack.** Open gates admit mutants along their passage axis only. Autocannons fire over walls. A breach is passable at once. A fortified border cell does not displace a spawn: the mutant arrives outside it and must breach it. The map edge is not a wall. **Reinforced Gates are future scope:** stronger variants of both orientations, reusing the same logic with different HP and cost.
- **IMPLEMENTED (TASK 021):** Every building except HQ can be **demolished** during Day: no Credits, no AP and no refund, so it is not a way to sell. A selected building shows the action, and HQ and its road ring stay protected. Walls and gates go on one press, for fast editing. Anything else takes two: the first turns the button to **CONFIRM** for that building, and selecting anything else, any other action or the end of Day cancels it. A demolished Factory loses its stored loads and its truck.
- **IMPLEMENTED (TASK 021, approved rules with provisional values):** A **Barracks** is **3×3, 400 Credits / 1 AP**, power demand **30**, **300 HP**, with no upkeep or pollution and a mutant target bias of **64**. At most **4** stand at once; losing one frees a place. Its fixed exit is on its left side, at **{col − 1, row + 1}**, and that exact tile must be a connected road. The exit counts as a dock: its road cannot be removed or gated, so it can never be blocked. **Squads:** each Barracks fields **4** soldiers. They leave on its powered Night ticks **1, 31, 61 and 91**. While below strength after that, one free replacement arrives per **600** powered ticks, and a squad never exceeds four living soldiers. Soldiers exist only at Night: all are removed at dawn, and a full, unhurt squad musters the next Night. Losing power pauses deployment and replacement, but soldiers already out fight on. A destroyed Barracks sends nobody else, and its survivors hold their last post until death or dawn. **Flags:** each Barracks has one rally flag, set by selecting it and pressing Flag, during Day or Night, free. A flag goes on open ground or a road, never on a building or gate, another squad's post, or a tile the squad cannot reach. With no flag the squad guards its exit. A flag walled off or built over later is kept and shown blocked, and the squad guards its exit until a way opens. The player never commands individual soldiers. **Movement:** soldiers ignore roads and walk any open tile at **1 px per tick**, along a shared distance field that is rebuilt whenever walking changes, so a breach is used at once. They pass gates only along the passage axis, wait for OPEN as trucks do, and hold the gate open until clear of it. Soldiers never attack your walls or gates. **Combat:** a soldier has **30 HP** and a rifle: range **96 px**, **5 damage** every **90 ticks**, instant, passing over walls and buildings like Autocannon fire, with no friendly fire. It fires at anything in range, even on the march. It picks up mutants within **160 px** of its post, lets go beyond **192 px**, and closes on a target up to **4 walking tiles** from its post, then goes back. **Mutants:** soldiers are never strategic targets. A soldier in melee reach stops a mutant, which attacks it. A walking mutant within **64 px** of a soldier turns towards it, but only while the whole way is clear, asked afresh every tick, so a soldier behind a wall is ignored and a breach counts at once. A mutant at its target or at an obstacle is not pulled away. Barracks are not counted by `defenseResponse`. Details and scripted balance results are under Known balance issues in section 14.
- **IMPLEMENTED (TASK 022, approved rules with provisional values, kept after playtest):** The **Spitter** is the first ranged mutant, shown as a lime triangle. **30 HP**, **0.5 px per tick**, with the same targets and detours as any mutant. It stops as soon as its target is within **192 px**, circular, measured to the nearest point of the footprint, and only a destroyed target moves it on. It fires a shell every **180 ticks**, the last **45** being a telegraph: it swells and draws a line to a fixed aim point. Each shell does **10 damage**. **Every shot stops at the first solid thing on its line:** walls, gates that are not open, and ordinary buildings all protect what stands behind them, so a blocked shot damages the blocker, never anything further, and a Spitter never needs a firing position or idles. An OPEN gate passes a shot only through its doorway, crossing both passage faces between the posts. Player guns still fire over everything; this asymmetry is deliberate. **Shells are real:** what a shell hits is settled on release and it lands after a short flight, even if its Spitter has died. If that building has gone, it lands on nothing. **Soldiers:** the Spitter fires back at the nearest soldier within **128 px** with a clear line, which uses up a shot. It aims at a point, not a soldier, and a shell never follows anyone, so a soldier who has moved off the spot is missed. It is not lured while it has shots. **After 5 shots it has none left:** it turns over, goes dull, and carries on as an ordinary melee mutant. **Waves:** first eligible on **Night 5**, then **min(6, floor(budget / 4), 1 + floor((night − 5) / 3))** per Night, spread evenly and never first. Each takes the place of one ordinary mutant, so wave size, spawn ticks and spawn positions do not change. `defenseResponse` and the wave cap are untouched. Spitters ignore trucks while they have shots.
- **IMPLEMENTED (TASK 023, approved rules with provisional values):** The **Brute** is a slow, heavy melee mutant, an orange octagon with a visible HP bar: **600 HP**, **0.25 px per tick**, **25 damage every 120 ticks**, no armour and no immunity. It targets, fights, attacks trucks and soldiers and is lured like any mutant, but it **never detours**: a fortification in its way is attacked at once, and the breach is open to everyone behind it. **Waves:** none to Night 29, then at most **1** on Nights 30-34, **2** on 35-39 and **3** from Night 40. Each costs **3** of the wave's 40 slots: it spawns in one, and two are absorbed, keeping their tick and random draw but spawning nothing. So Spitters, spawn positions and the wave cap are unchanged, and a wave gets heavier with fewer enemies. **RESET FLAG:** a Barracks with a flag can have it cleared, by Day or Night, free. Only that squad is affected, and it walks back to its exit, with no teleport, healing or new soldiers.
- **IMPLEMENTED (TASK 023, approved rules with provisional values):** The **Siege Cannon** is a 2×2 stationary gun for heavy targets: **600 Credits / 1 AP**, power demand **20**, **250 HP**, mutant target bias **64**, no upkeep or pollution, available from Day 1. Its range is a ring from **64 to 256 px**. It fires **200 damage** every **300 ticks**, at the nearest Brute in range, otherwise the nearest mutant; Spitters get no preference. Its shell flies over walls at about **8 px per tick** to where the target stood when fired, with no homing, and hurts at most one mutant within **24 px** of that point, with no splash. Unpowered, its reload pauses; a shell in flight still lands, even if the gun has gone; shells are cleared at dawn. Each one counts as one stationary gun in `defenseResponse`, by the unchanged formula. **Rocket Infantry:** a Barracks can be refitted between Rifle and Rocket during Day for **200 Credits and 1 AP**, in two presses, with no rebuild: its flag, HP and power demand stay. A Rocket squad is **2** soldiers at the usual HP and speed, range **128 px**, **120 damage** every **480 ticks**. Rockets fly over walls at **5 px per tick** to where the target stood, with no homing and no splash, and hit only a mutant whose body covers that point when they land: **8 px** for a basic mutant, **11** for a Spitter, **15** for a Brute. So a Brute is hit reliably, and a walking mutant can be missed. They prefer Brutes; otherwise they follow rifle rules. **Power warning:** a placement that would take power from NORMAL to LOW_POWER asks first, and a second press on the same tile confirms it. Any other tile, building or mode cancels. The player can always accept it.
- **REPORTED IMPLEMENTED (TASK 018, adjusted by 025.4A):** Factories produce **GOODS** and earn on delivery. Fixed dock at {col + 3, row + 1}; HQ receiving dock at {col + 1, row + 3} on the permanent ring; connected roads required, no factory rotation. Each powered Factory makes one load (10 GOODS) per 600 production ticks during active Day, Dusk and Night (not Day 0). Each delivered load pays 30 Credits immediately and once only. Storage holds 2 loads; production pauses when full. Production and partial progress continue across phase boundaries while powered, replacing the previous Night-only/dusk-reset model. Each Factory has one free truck (20 HP, 1 px/tick, one load); routing selects estimated quickest road route including gate delays; trucks may overlap, and mutants can damage them opportunistically. Destroyed trucks lose cargo and return after the established delay; final transport lifecycle/recovery rules remain as implemented. Historical 150-Credits-per-Night income and night-only logistics estimates are superseded.
- **REPORTED IMPLEMENTED (TASKS 017/025.4A):** Player-built roads cost **2 Credits per tile / 0 AP** and connect orthogonally to the network; the initial HQ ring is free and permanent. Roads cannot overlap occupied structures or uncleared jungle. Connected Factory and Barracks docks must not be stranded by road removal. The natural path is only decorative traversable ground, with no truck/dock access. Gates occupy road tiles under their existing constraints. Roads speed up worker/infantry travel, but do not change truck speed.
- **REPORTED IMPLEMENTED (025.4A):** Worker/infantry speed multipliers are 1.2× on constructed roads and the HQ ring, 1× on bare/cleared ground and natural track, 0.65× in jungle. Terrain-aware travel-time routing applies to workers; worker and infantry paths invalidate on terrain changes without redundant rebuilds.
- **REPORTED IMPLEMENTED (TASK 016 extended by 025.4A):** Speed controls offer 1×, 2× and 4× during active timed shifts, advancing the same deterministic simulation ticks. The new timed Day begins at 1× and unpaused; initial Day 0 is untimed. Speed does not change simulation outcomes given identical commands at identical ticks. `END DAY` uses batched simulation advancement, including workers, production, logistics and Pollution from clearing.
- **IMPLEMENTED (TASK 015, approved rules with provisional values):** Mutant pressure rises with elapsed Nights, independently of Pollution, and Pollution accelerates it further. accelerationBudget = **floor(max(0, night − 6)² / 12)**, the nightly cap is **40**, and the last spawn tick = **max(1200, 2700 − 100 × max(0, night − 6))**. Budgets through Night 9 match the earlier formula, and spawn timing changes from Night 7. **Approved design decisions:** Factories remain the primary source of Credits; production finances the defenses that survival increasingly needs; a defense-only turtle should fall to combat pressure, not to a financial Game Over; there are **no production quotas, quota fines or insolvency rules**. **Provisional, not final:** the formula values, and the balance target that a no-income turtle collapses around Nights 18–25 in tested scenarios. At the earlier 1000-Credit budget, a two-cannon turtle fell on Nights 17–22 across 30 seeds and three HQ positions. At 1250 Credits, a three-cannon turtle has a median defeat of Night 20 from the centre and Nights 23–24 from corners, and none of the 30 seeds reach Night 30 alive. Corner positioning may stay advantageous. Industrial viability must be judged by real play, not scripted runs.
- **IMPLEMENTED (TASK 013, temporary graybox values, not balanced):** The player builds **HQ** first, anywhere valid on the grid: **3×3, 0 Credits, 0 AP, 600 HP, +20 power, 0 demand**, with no upkeep or pollution, and it cannot be toggled. Until HQ stands, the other buildings and END DAY are visible but disabled. Only one HQ can ever be built per run, even after destruction. HQ power joins the global pool, so HQ alone runs one Autocannon or two Outposts but not a Factory, and with a Plant generation is 120. Generation cannot reach 0 while HQ stands, so BLACKOUT does not occur in normal play; LOW_POWER stops consumers the same way. Mutant target bias is **256**, equal to a Power Plant. **Destroying HQ is the only implemented defeat condition.** The run ends on that hit: later mutants do not act, a due spawn is dropped, survivors freeze, and that night earns and emits nothing. Game Over shows `HEADQUARTERS DESTROYED`, the approved quote and completed shifts, and restart returns to the title with a fully fresh run.
- **REPORTED IMPLEMENTED (TASKS 025.1/025.4B):** The main 48×32 seeded jungle map starts with a central clearing and natural dirt path; the legacy 24×16 map remains for tests/layouts. Jungle originally blocks construction/roads but not ordinary walking; **now workers can clear it**. Each cleared tile becomes its own buildable CLEARED kind and increments terrain revision, invalidating dependent navigation caches. Rendering repaints cleared tiles plus neighbours on a per-run texture copy; RESTART regenerates original jungle. The map's resource deposits and mine placement are still future scope.
- **IMPLEMENTED (TASK 025.2, provisional values):** **Fog of War** on the jungle map: tiles are UNEXPLORED (hidden), EXPLORED (remembered, dimmed, no live enemies shown) or VISIBLE. What is visible is the union of all active vision sources, and explored terrain is never forgotten. A run begins with the clearing explored. Vision radii in tiles: soldiers, workers and ordinary buildings including HQ, **6**; Autocannon and Siege Cannon **7**; Outpost **12**. Walls and gates have no active vision. The camera never reveals anything. Fog changes no rule: combat, targeting, spawning and construction ignore it. The **Outpost** is an observation post: same price and power demand, no upkeep; it sees only while switched on and powered, so LOW_POWER or BLACKOUT blinds it. **TASK 025.3** registered workers as mobile vision sources.
- **REPORTED IMPLEMENTED (TASKS 025.3/025.4A/025.4B):** HQ provides **3** functional, persistent unarmed workers (**15 HP**, **vision radius 6**). They can be dispatched in an active timed Day to a persistent flag and recall physically; work radius is a circle of 3 tiles. **Placing or moving the flag costs 1 AP each time**; sending and recalling workers to an existing flag are free. They must reach the flag before taking jobs; tiles are reserved in worker-ID order, chosen by travel time, with stable assignments and progress per tile. Each jungle tile takes 300 chopping ticks and causes +1 Pollution on completion. Clearing runs only in unpaused timed Day. Workers stop at Dusk and physically head to HQ, including when Night begins; no teleportation. Worker death and dawn replenishment follow the reported 025.4A lifecycle. Clearing loops ACTION frames 8–9; 10–11 are reserved for future repairs. The flag remains until explicitly moved or cleared under current controls.
- **NOT YET IMPLEMENTED / DEFERRED:** Mines and mineral extraction, treatment/policy systems, newspaper, formal score, detailed ecological palette evolution, BarrelStorm-derived SoundManager, environmental protesters, HQ-controlled loudspeaker towers and the **approved Night 99 finale**. **Repairs are DESIGN APPROVED but not yet reported implemented.** Jungle clearing, active Day and native gate-art integration are no longer in this list.

### Next implementation checkpoint

**TASK 025.4C — Manual paid building repairs:** gameplay rules approved in v0.4 (Section 2B). Claude is authorized only as explicitly instructed for this task; implementation and targeted testing have **not** been reported complete at this revision. The wall-sprite topology audit may be completed as a report, but actual wall-art rework waits for corrected sheets. Sound, mines and newspaper do not accompany this patch.

## 1. Vision and design pillars

The player is a foreman operating a resource-extraction complex in the fictional Republic of San Papi. PAPI Industries owns mines, refineries, automotive businesses, energy generation, defense systems, and much of the national narrative. The objective is to keep the operation profitable and survive as many shifts as possible. Industry generates revenue and pollution; pollution makes nighttime wildlife attacks more dangerous. More defense demands more electricity, which may demand more industry.

**Pillars**
1. **Two shifts plus dusk (REPORTED IMPLEMENTED):** an initial untimed Day 0 for HQ/planning, then a timed active Day from Day 1 onward, 300-tick Dusk and 3600-tick Night. Workers undertake daytime expeditions; Night is defence, with trucks and industry also operating across timed shifts.
2. **Self-inflicted escalation:** industrial expansion increases profit and environmental threat.
3. **Readable, emergent defense:** power supply, placement, hardpoints and enemy target preferences create strategy without complicated RTS micromanagement.
4. **Mobile-first restraint:** tap-friendly controls, clear two-step placement preview/confirmation and a readable, predictable Day/Dusk countdown with optional END DAY acceleration, without demanding twitch reactions.
5. **Deadpan corporate satire:** a ludicrous ruler treats every disaster as proof of his genius; game systems deliver the joke.
6. **Testable from day one:** deterministic 60 Hz simulation and explicit, game-specific QA hooks.

### Theme: SHIFT
- **Day Shift / Night Shift:** two different kinds of player decisions.
- **Environmental Shift:** a green jungle becomes brown industrial wasteland; a blue river turns toxic fluorescent green.
- **Policy Shift:** costly or exploitative operating policies alter economics and environmental harm.
- **Strategic Shift:** expansion eventually becomes survival; directives periodically disrupt established defenses.

## 2. Core loop

**CURRENT BUILD (reported through TASK 025.4B):** The active cycle is now reported implemented. The old static Day/night-only-worker description in v0.3 is historical. These are reported rules, not a claim that this document has audited every source file.

0. **INITIAL DAY 0:** untimed preparation and HQ-first construction; no active worker expedition, chopping or industrial production/transport. `END DAY` transitions via Dusk to Night 1.
1. **DAY 1+ (3600 ticks / ~60 s at 1×):** construction, power toggles, worker expeditions, clearing, continuous factory production/truck deliveries and manual management. Worker field tasks consume active simulation time. A Day started after Dawn resumes at 1× and unpaused.
2. **PAUSE:** look-only; camera, inspection, selection and non-committing preview can remain accessible, but no building, flag, worker, repair or other gameplay mutations are allowed. Existing `END DAY` handling remains available under its specific rule. Press PLAY to resume actions.
3. **END DAY:** fast-forward all remaining Day ticks, including moving units, clearing, industry, transport and FoW, in bounded batches (reported 240 ticks per render frame). Lock extra gameplay inputs during acceleration; never double-trigger transition.
4. **DUSK (300 ticks / ~5 s):** fieldwork stops and workers begin physical auto-recall. Dusk does not wait for stragglers. Factories/trucks continue their active-cycle operation when powered.
5. **NIGHT (3600 ticks / ~60 s):** deterministic mutant waves, combat, powered defences, infantry, production and logistics. Workers who have not reached home keep returning and remain vulnerable, without chopping or repairing. No daytime construction.
6. **DAWN:** resolve the once-per-Night settlement/emissions and AP reset to 5 exactly once, clear remaining enemies under current rules, preserve worker positions/health and unfinished terrain work, and start the next timed Day. Production/delivery progress is not discarded merely because the phase changed.

**Fixed-tick contract:** The simulation runs at 60 fixed ticks/sec; 1×/2×/4× changes how many ticks run per frame, not the outcome for the same seed and commands. Rendering, camera zoom and FPS are not gameplay clocks. Day and Dusk must not tick Night's wave/combat schedule, but DO run continuous production/logistics. Night-end Pollution accounting remains a single settlement. The `?cycle=legacy` test harness is an intentional compatibility mode, not evidence the actual game still uses an untimed Day.

**Lighting/presentation (reported 025.4A):** a restrained blue night tint (#18365C at alpha ~0.18) fades in during Dusk and out over early Day; it is below fog and visible units/combat effects to retain legibility. UI pause buttons may dim (alpha ~0.45) with the guidance `Paused: press PLAY to act`.

**Run-ending condition:** **Currently implemented**, HQ destruction is the only Game Over and the build remains endless; debt does not end a run. **Approved future victory ending (NOT IMPLEMENTED):** successfully survive and complete **Night 99**, then play El Papi's comic epilogue and conclude that run. HQ destruction before or during Night 99 still causes the existing defeat. Exact transition/credits implementation, save/unlock persistence and optional continued-play mode remain OPEN. Do not claim the 99-Night end condition is in code yet.

### 2A. Active Day, worker lifecycle and jungle work (TASKS 025.4A and 025.4B)

> **Status: REPORTED IMPLEMENTED with targeted test evidence.** The values remain provisional. The older v0.3 daily expedition-AP and nighttime-only-production proposals are replaced by the rules below.

| Phase | Duration | Construction / controls | Functional workers | Economy and combat |
|---|---:|---|---|---|
| Initial Day 0 | Untimed | HQ-first planning, END DAY | No dispatch or clearing | No industrial production/truck delivery, no wave |
| Timed Day | 3600 ticks | Day construction, flags, pause, speed, selected-building actions | Expeditions, clearing; proposed repairs after 025.4C | Production/logistics/delivery income run; no standard wave |
| END DAY | Remaining Day ticks | Fast-forward, no extra committing commands | All walking/chopping ticks still execute | Production, logistics, revenue and visibility still tick |
| Dusk | 300 ticks | No new field tasks | Stop work, physically recall | Production and deliveries continue; Night wave not yet active |
| Night | 3600 ticks | Defence controls; no construction or fieldwork | Surviving stragglers return and remain vulnerable | Mutants, turrets, soldiers, transport; once-only end settlement |
| Dawn | Phase change | AP reset to 5, time/speed reset | Preserve surviving workers and unfinished work | Clear survivors / transition to Day |

#### 2A.1 Controllable HQ workers

- The HQ maintains **3 functional worker slots**, with **15 HP** per worker, mobile FoW vision radius **6** and a work radius of **3 tiles** (circular, measured from the persistent work flag).
- **Work flag AP (current reported implementation):** **placing OR moving** the flag costs **1 AP each time**. Dispatching surviving workers to an already positioned flag and recalling them do **not** spend AP. No per-tree AP. Flag placement is not automatically free after the first action of the day; this explicitly supersedes v0.3.
- Workers use existing movement and gate rules, navigate on foot to the flag before beginning clearing, and do not chop jungle they pass en route. A distant flag is allowed if reachable. The flag itself grants no vision.
- A worker takes one stable job at a time, chosen in worker-ID order among free jungle cells inside radius. Selection minimizes terrain-weighted estimated travel time from that worker, with row/column tie breaks. Workers do not share clearing jobs; they chop while standing at the target cell centre.
- Workers are persistent across Day, Dusk, Night and Dawn; they retain health, positions and return orders. At Dusk they stop fieldwork immediately and physically return. Night stragglers can be attacked by mutants. Deaths are not replenished in the same cycle; next-Dawn replenishment up to three remains the provisional existing behavior, not a new economy charge.
- Worker and soldier movement: **1.2× on constructed roads/HQ ring**, **1× on open ground, cleared ground or natural dirt path**, **0.65× in jungle**. Travel-time-aware routing chooses routes using these multipliers. Terrain revision invalidates cached walking paths once on a subsequent tick rather than rebuilding per felled tree.

#### 2A.2 Ambient civilians (non-functional)

- **DESIGN APPROVED; verify current implementation before treating as shipped.** Small decorative settlement workers may wander during Day. They have no work slots, power, income, AP, upkeep, production, FoW or loss condition; their deaths have no strategic/economic penalty and must not become a lure exploit. They are separate from the three functional HQ workers.

#### 2A.3 Roads, terrain and navigation

- Every player-built road tile costs **2 Credits / 0 AP** and must obey established connectivity and placement restrictions. HQ's automatic ring is free.
- A natural dirt path provides open-ground movement only, **not** truck network connectivity or road speed bonuses.
- Routes account for movement time; new cleared ground is reflected immediately in grid buildability, road placement and navigation. Player combat and factory gates preserve their own passage rules.

#### 2A.4 Jungle clearing (025.4B)

- The work area is the **circular 3-tile radius** around the **persistent work flag**. All three workers must first reach the flag; chopping cannot start elsewhere or outside an active unpaused timed Day.
- One worker works on one jungle tile for **300 active work ticks (5 s at 60 Hz)**; multiple workers can clear distinct tiles concurrently. Jobs have exclusive reservations. Partial progress belongs to the tile and survives recall, flag moves, worker death, Dusk and restart of an assignment, but **not a new run**.
- On completion the terrain tile becomes **CLEARED**, buildable and eligible for road placement, with **open-ground walking speed**; it raises **Pollution by exactly 1**, once only even for simultaneous completions. The HUD and derived Threat update through the existing pollution system. A Night's wave plan is sampled on Night tick 1, so Pollution added after that cannot change an ongoing wave.
- Workers animate with ACTION frames **8–9 only** for chopping. Frames 10–11 are reserved for repairs. Active work target can show an amber outline and progress bar. When nothing remains, workers wait at the flag.
- A run owns a private mutable copy of the procedurally generated terrain image. On clearing, paint the tile and immediate neighbours, preserving edge shading, lines and stumps; restart gives the untouched seeded jungle rather than carrying old repainting over.
- **Accepted export limitation:** a layout saved with structures on newly cleared tiles cannot replay in a fresh run unless those cleared tiles are encoded too; the current `papi-layout` schema does not store clearing. Do **not** silently extend the layout format as part of 025.4B/025.4C.
- Approximate throughput reported in a full Day: **18–25 tiles** among three workers, dependent on travel; +18–25 immediate Pollution. Work duration and Pollution remain tuning hypotheses.

#### 2A.5 Validation and scope

- Preserve deterministic 60 Hz update order, Day/Night transitions, no double Night settlement, AP charges, gates, pathing, fog and mobile placement behavior.
- 025.4B agent report: 14/14 dedicated clearing unit tests; related terrain/worker/infantry/cycle/layout/vision units pass; 1/1 real-cycle clearing browser test. Two pre-existing touch cases exceeded a 15-second timeout (~15.8 s), with causality to 025.4B unproven. Scope-specific remeasurement, **not** a global timeout increase, is the appropriate follow-up.
- The gate-art patch reported 14/14 unit and 12/12 desktop/mobile browser assertions. Neither report is permission to run the full regression suite or soaks. No agent commits/pushes are assumed unless explicitly reported.

### 2B. Manual paid building repairs (TASK 025.4C)

> **Status: DESIGN APPROVED / IMPLEMENTATION PENDING.** This supersedes the rejected idea to automatically repair every damaged building within a work flag's radius. The player gives direct orders; a work flag is not part of repair targeting.

**UI and commands**

- Select a **damaged standing building**: display **REPAIR** beside **DESTROY** (except HQ, which cannot be demolished). A building already under repair displays **STOP REPAIR** instead. A fully healed, destroyed, or otherwise invalid building cannot start a new repair.
- Clicking **REPAIR** assigns **one existing HQ worker**. Maximum **3 concurrent repair orders**, one per worker and one per building; no queue. With three workers already repairing, another REPAIR is disabled and explains why.
- **STOP REPAIR** immediately cancels that building's order and releases its worker. Completed or destroyed building also frees its worker. Reusing the worker for clearing is allowed if a work flag exists; no clearing progress is erased by reassignment.
- Repair orders are **independent of the work flag**: no need to position or move a flag, no 3-tile radius requirement, no extra AP, no instantaneous teleport. Workers travel physically to a reachable free tile adjacent to their assigned building, then work from that tile's centre. Use the established walker/navigation/reservation logic, with deterministic worker assignment and no double booking.
- Repair commands are gameplay mutations and are issued during **active, unpaused, timed Day** only. Repair **progress** happens only during that phase. Day 0, Pause, Dusk and Night permit no repair progress or fresh repair assignments.
- **Dusk** interrupts work and physically recalls all workers. Unfinished repair **orders stay pending**, preserving restored HP and valid partial work until the next active Day. Workers resume traveling/working only when Day resumes. This is different from pressing STOP REPAIR, which cancels an order.

**Rate, price and resource safeguards (provisional balance)**

- Repair rate: **10 HP per 60 active work ticks per worker**. A worker needs to reach a valid adjacent work tile first. No on-the-spot free healing, repair while moving or repairs during Night.
- Ordinary buildings: full-HP-equivalent repair price = **60% of their Credits construction cost**, proportional to **actual HP restored / maxHP**. Formula before final integer rounding: `0.60 * buildCost * restoredHP / maxHP`. If a damaged wall costs 25 Credits and has 100 max HP, restoring 100 HP equivalent should cost **15 Credits total**, not 20 from repeated upward rounding of 10-HP blocks. A gate (100 Cr, 150 HP) is 60 Cr per full-HP equivalent; Factory (400 Cr, 300 HP) is 240 Cr.
- **HQ exception:** because build price is zero, repair costs **1 Credit per HP actually restored** (600 Credits for 600 HP equivalent).
- Charge at committed repair increments (target 10 HP blocks, last block may be smaller), **atomically before restoring HP**. Accumulate/track fractional cost deterministically so rounding at block boundaries, interrupted sessions, STOP REPAIR and resumed orders cannot overcharge or undercharge or produce free repeated repairs. The exact representation/ledger must be reviewed in code; no general `ceil()` tax on every small block.
- **Insufficient Credits:** if the next repair increment cannot be paid, **cancel the repair order automatically**, release its worker, preserve already restored HP, and show a clear hint. Do **not** leave a permanent paused order or automatically resume it later. The player must manually issue REPAIR again after getting Credits. No repair may create additional debt or negative Credits.
- **No additional AP per repair action or HP increment.** The separate work-flag AP rules apply only if the player places/moves a flag for clearing.
- Eligible targets: HQ, factories, power plants, barracks, Outposts, turrets, walls and gates. A destroyed building is removed and **cannot** be revived. Standing buildings remain operational at their usual rules while being repaired.

**Visuals, QA and implementation boundary**

- Active repairing worker animates **ACTION frames 10–11** only; chopping remains frames 8–9. Building HP bar reflects restoration; selected-building panel reflects status and available Credits.
- Test deterministic ordering, actual adjacent walking, three-job cap, preemption of clearing, manual cancellation, lack of funds cancellation, partial HP accounting, Dusk resumption, Night/Pause/Day0 restrictions, destroyed-target cancellation, HQ/wall/gate prices and browser UI on desktop/mobile.
- Reuse existing HQ workers. No second crew, second repair flag, automated repair radius, new worker framework, repair queue or overnight repair ability. Targeted tests only; no unapproved full test suites, soaks or commits.

## 3. World and camera

- **IMPLEMENTED graybox:** logical square grid with **32×32 game-world pixels per tile**, **48×32** cells on the jungle map and **24×16** on the original open map; other map dimensions (including 5×5 QA maps, 24×24 and 32×32) are future test/design options, not current production maps.
- **Styled top-down / oblique 2.5D:** normal square grid and collisions, but buildings display a roof, a short frontal face and shadow; no perspective rotation of map coordinates.
- One or more fixed/procedurally seeded resource deposits; mines require valid deposit locations. This creates a reason to expand beyond the protected HQ.
- **REPORTED IMPLEMENTED:** jungle cells can be cleared by HQ workers during timed Day to permanent-per-run CLEARED buildable ground. Rivers and other blockers remain separate future terrain features (exact layout TBD).
- Building sprite footprint is decoupled from visual extents; art can extend above/below occupied cells.
- First build uses only colored rectangles, footprints, target markers and debug overlays. Commit to pixel art only after playtesting scale.

**Provisional footprints:**

| Structure | Footprint | Purpose |
|---|---|---|
| HQ (implemented) | 3×3 | Central command, critical loss condition; player-placed first, +20 power |
| Mine (planned) | 2×2 | Deposit-linked extraction / revenue |
| Refinery (planned) | 3×2 | Higher value output, high power/pollution |
| Factory (implemented) | 3×3 | Produces GOODS and receives Credits per truck delivery throughout active Day/Dusk/Night; the former 150 Credits/Night cap is historical |
| Outpost (implemented) | 1×1 | Observation post with the largest vision radius, while powered; **not** an autocannon |
| Power plant | 3×3 | Generates power and pollution |
| Waste treatment | 2×3 | Reduces pollution at a monetary/power cost |
| Machine-gun turret (planned) | 1×1 | Rapid anti-swarm fire |
| Autocannon (implemented) | 1×1 | Separate defensive structure, not an Outpost. Footprint approved for TASK 011B. |
| Siege Cannon (implemented) | 2×2 | Slow, long-range gun for heavy targets, with a minimum range |
| Heavy turret (planned) | 2×2 provisional | Slower, stronger coverage; distinct from Autocannon if retained |
| Barracks (implemented) | 3×3 | Deploys a squad of four soldiers each Night, with a rally flag |
| Wall (implemented) | 1×1 | Damageable passive barrier, built by dragging |
| Gate (implemented) | 1×1 | Barrier on a road: Vertical or Horizontal, opens for trucks and soldiers |
| Loudspeaker tower (concept, not implemented) | TBD | Physical emitter, provisional 3-tile circular effect radius; one HQ ON/OFF switch controls all placed towers; repels protesters by Day, draws mutants by Night |
| Minefield (optional) | tile / section | Consumable damage |
| Road | 1 tile | **2 Credits / 0 AP**, free automatic HQ ring; network required for Factory trucks, 1.2× traversal for workers/infantry. |

## 4. Building and input

**REPORTED IMPLEMENTED construction:** immediate Day-only placement limited by Credits/AP. Placement previews reject invalid terrain, occupied tiles and unaffordable actions without state mutation. Initial Day 0 is untimed; subsequent Days are active and timed. The older commission/wait/ready-to-place queue is DEFERRED, not a building-progress mechanic. The active Day can be paused for inspection but paused gameplay cannot be mutated.

**AP baseline (updated v0.4):** 5 AP granted at each dawn. Most structures cost 1 AP; HQ/walls/roads follow their stated exceptions. Power ON/OFF remains 0 AP per applicable shift. **Placing or MOVING the worker work flag costs 1 AP EACH time**; dispatch and recall to/from an existing flag cost 0 AP; clearing individual tiles costs 0 AP. **Manual repairs cost 0 AP** (025.4C approved pending implementation). Player road construction costs 2 Credits/0 AP. Policy costs remain PLANNED/OPEN.

**Footprints:** placement must reject out-of-bounds, occupied, blocked terrain, wrong deposit and insufficient resources/AP without mutating the game state. Crew members never occupy structural grid cells: if a new building overlaps a wandering crew sprite, the NPC relocates to a valid adjacent location.

**Wall input (IMPLEMENTED, TASK 019; mobile behavior updated by TASK 024.1):** select the Wall tool, then preview a line or section by pressing/dragging; on mobile, confirmation is separate from the preview gesture. Each tile placement costs Credits and no AP. This supersedes the earlier section-with-confirm idea. Segments connecting visually by adjacency remain art work.

**Mobile-first controls:** tap to select building/tool, tap/drag to preview, explicit confirm/cancel; drag to pan (when not placing), pinch to zoom; choose generous hit targets despite small logical cells. Camera/position conversion must handle zoom and scaling. Desktop uses mouse/keyboard equivalents. Landscape is the intended game orientation.

## 5. Economy and power

**Core model:**
- **Credits:** construction and roads, with deliveries providing active-cycle cash income; **manual repairs** approved for 025.4C but not yet reported implemented; future operating expenses are separate.
- **Power:** generation, consumption, available reserve; not a transport network.
- **Pollution:** environmental cost and driver of night difficulty.
- **Corporate share:** headquarters retains a fixed or progressively changing portion of gross production. Only the foreman's allocated share is spendable.
- **Global climate index:** longer-term persistent escalation distinct from local pollution; exact formula deferred.

**IMPLEMENTED power management:** one global pool; no cables, priority tiers or automation. Each building has an **ON/OFF** choice available in both shifts. **Do not reject** switching ON merely because it creates a deficit: under a deficit, all enabled consumers become effectively unpowered (LOW_POWER or BLACKOUT), but their `enabled` flags remain unchanged. The player can restore NORMAL by reducing enabled demand or increasing supply. Power plant destruction must recalculate the same global rules when combat is introduced. This intentionally supersedes the earlier `INSUFFICIENT POWER` rejection idea. **OPEN balance question:** whether total-consumer shutdown is too punitive.

**REPORTED IMPLEMENTED economic cadence (025.4A):** Factory production and trucks run continuously during timed Day, Dusk and Night (not initial Day 0), with Credits paid once on actual delivery, not pooled for Night settlement. Night-end industrial Pollution emissions still settle once at tick 3600, based on the final active power state; the last-tick pollution toggle incentive remains an OPEN balance consideration. Daytime clearing adds immediate Pollution on tile completion. The Night settlement validates accounting changes with its existing safeguards. There are no automatic nighttime repair expenses in v0.4.

## 6. Ecology, policies and threat

**REPORTED IMPLEMENTED ecology baseline (025.4B):** Power Plant +12 and powered Factory +8 Pollution still settle once per completed Night, subject to existing power checks; Outpost +0. **Every completed jungle-clearing tile adds +1 Pollution immediately during an active Day**, once only, with no natural decay. The HUD shows Pollution/derived Threat: 0–24 → 1, 25–49 → 2, 50–99 → 3, 100+ → 4. New Pollution affects the **next planned Night wave**, never a wave already running. Terrain palette evolution, filters, treatment and river changes remain PLANNED; attack-budget scaling already exists. Visual changes should prefer runtime overlays/tints/limited tile repainting rather than separate whole-map tilesets.

**Policy domains (first examples):**
- Waste disposal: river discharge (cheap / dirty) versus treatment (costly / cleaner).
- Emission standards: unfiltered chimneys versus paid filtration.
- Forest management: clear-cutting versus selective extraction / conservation.

Policy changes occur during day, spend AP, and generally persist until changed. Temporary **Papi directives** are a separate system, typically lasting 2–5 completed cycles; they are not part of baseline player policies. Only one disruptive directive should be active at once in early versions, with mandatory advance notice in the morning newspaper and clear HUD countdown. A directive must never create an unavoidable no-defense state: check whether viable alternatives are available.

**Threat formula:** the **implemented Threat Level** is the discrete derived indicator defined above. **IMPLEMENTED attack pressure** is the provisional TASK 012A and TASK 015 wave budget in the baseline above. Climate debt, final coefficients and unlock thresholds remain **OPEN**. Different enemy archetypes may later unlock at thresholds.

## 7. Defense, enemy AI and hardpoints

The player may choose exposed expansion (**overreach**) to maximize resource extraction, or clustered fortified bases/hardpoints to reduce defense perimeter. A **hardpoint is not a special building**: it is an emergent arrangement of walls, turrets, terrain and possibly guards. Avoid fake adjacency buffs.

**Longer-term target-selection direction (not implemented as a replacement algorithm):** Mutants already use deterministic target biases, obstacle attacks and bounded detours per the implemented baseline. Future designs may refine power-plant/HQ priority, add mine/refinery preferences and distinctive enemy targeting. Do not replace working enemy pathing simply to fit this paragraph; combat rebalancing remains a separate explicitly approved task.

**Initial enemy taxonomy (future balance; the graybox basic mutant, the Spitter and the Brute exist, and the others are not implemented):**
- Small critter: about 8×8 px, quick, weak, appears in swarms.
- Spitter / medium: **implemented in TASK 022**, about 22 px so that it reads at mobile size, ranged.
- Brute: **implemented in TASK 023**, about 30 px so that it reads at mobile size, breaks through fortifications.
- Behemoth: 32 px and larger, eventual exceptional threat that justifies heavy weapons; not necessary for initial playable milestone.

**Defensive roles:** The implemented Autocannon, Siege Cannon, Rocket/Rifle Infantry, walls and gates have the concrete stats and behavior described in the baseline. Further turrets, minefields and specializations are PLANNED. **Manual paid repairs are approved for TASK 025.4C but not implemented at v0.4 publication.** Bigger guns should not automatically dominate small, fast mutant swarms.

**Night pacing:** 60-second escalating sequence with sparse early pressure, more fronts mid-shift and climax late. Night must be interesting rather than just a minute of hands-off animation.

## 8. Civilian crew and guards (optional)

**AMBIENT CIVILIANS (DESIGN APPROVED; implementation status to verify):** Decorative non-commandable workers are distinct from the three functional HQ workers. They can wander during Day and may be threatened, but have no AP, Credits, manpower, production, income, LOS or Game Over consequences. Never count them toward worker job capacity or silently lure mutants into a new strategic exploit.

**San Papi Infantry (IMPLEMENTED, TASK 021):** Barracks deploy small squads **only at night**. In daytime they remain inside, invisible. Without a flag a squad guards its Barracks' exit. With one it travels to a small cluster on that tile and defends the area around it. Each Barracks has its **own** rally flag, which the player can move during the night to redirect that squad to a breach, at the cost of travel time, not AP. Pursuit is limited to 4 walking tiles from the post. No formations, morale or soldier micro. The player does not select or individually control units. Replacements are free but bounded. The exact rules are in the implemented baseline above. This replaces the earlier design of a global flag, no pursuit and paid replacements.

## 9. La Voz de San Papi: the newspaper as UI (PLANNED)

**LA VOZ DE SAN PAPI** (formerly referred to as The Daily Progress in earlier drafts) is the planned official newspaper: an old-style black-and-white serif newsprint layout, with truthful mechanical statistics under deadpan state propaganda. It serves as the **single morning report** and a major narrative tool. It is an HTML/CSS overlay over canvas with native vertical scrolling. Top fold always prioritizes actionable information. Tap `X` to dismiss immediately. Last edition can be reopened from the HUD; archive is optional.

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
- **La Voz de San Papi (formerly The Daily Progress):** the newspaper voice is official, grandiose, euphemistic and uncritically supportive. Actual financial/security stats remain factual.
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

### Night 99 narrative ending (DESIGN APPROVED / NOT IMPLEMENTED)

- **Trigger:** on successfully completing **Night 99** with the HQ still standing, the planned game concludes with a satirical epilogue rather than proceeding to a normal Day 99 / Night 100 loop. Until this task is explicitly implemented, the shipped graybox remains endless and losing HQ remains the only working Game Over. Do not wire this into wave balancing or progression as a side effect of other tasks.
- **Story:** after 99 Nights of boasting that he is the greatest, smartest and *tastiest*, El Colonel/El Papi visits an industrial facility to give another speech. A mutant arrives and **eats him**. The creature subsequently wears his famous military cap and is accepted as the new president. **This is the mutant that ate him, not El Papi transformed, reincarnated, or a new combat boss.**
- **Visual payoff:** the same presidential office/gabinet remains in use. The existing **MENU presidential portrait and golden bust** gain alternate **bitten/chewed artwork**. After the ending, the menu displays the bitten variants; the epilogue reveals the mutant in the Colonel's cap occupying the office. Keep this to the original and bitten states; no extra art progression has been approved. How the post-ending menu state persists after reload or fresh runs remains OPEN.
- **Tone:** the administration treats the mutant's incomprehensible growls as executive orders and state media reports the triumph, e.g. `PRESIDENT FULFILLS HIS PROMISE TO FEED THE NATION`. The long-running propaganda line about Papi being *the most delicious* becomes the setup for the final punchline.
- **Boundaries:** narrative/visual end sequence only. No new mutant enemy class, boss phase, Papi resurrection, scripted combat rebalance or mandatory campaign branch is authorized. Ending implementation and jam-release inclusion require a separate task approval.

### Environmental protesters and LOUDSPEAKER towers (DESIGN DIRECTION APPROVED / NOT IMPLEMENTED)

**Environmental protesters:**

- **Approved character art:** white T-shirts with a distinct **Earth/globe emblem**, **green helmets**, and hand-carried **protest banners/placards**. They must read as green-helmeted ecology protesters at small pixel-art scale and remain visually distinct from functional HQ workers and ambient civilians. Artwork/animation files are pending.
- **Intended daytime activity:** neutral demonstrators gather and may obstruct player roads or delivery trucks. Approaching infantry can scatter them; they may regroup when safe. Physical walls may be used to protect logistics lanes. Precise collision, crowd capacity, protest spawn, avoidance, panic and regrouping algorithms are still OPEN and need deterministic tests before implementation.
- Protesters are **not mutant-wave enemies**, soldiers, armed targets or part of defense-response/kill accounting. Mutants may frighten or eat them in the eventual simulation, without awarding enemy kills or altering Night budgets. Their Night lifecycle remains OPEN.

**LOUDSPEAKER (tower/network):**

- **Approved physical implementation:** place one or more **LOUDSPEAKER TOWERS** in the world; each has a **provisional circular radius of 3 grid tiles**, measured from its tile centre. This is its local propaganda/influence area, **not** whole-map mind control.
- **Approved central command:** the player uses **a single network `ON / OFF` control in the HQ panel** to enable or silence the loudspeaker system. No requirement to click or micromanage each tower individually. If there are multiple towers, the common switch governs their combined active coverage. Individual tower availability if damaged/unpowered is a separate rule to decide later.
- **DAY:** when the HQ network is ON, active towers broadcast El Papi propaganda and **disperse environmental protesters within their 3-tile radius**. OFF provides no dispersal effect. The precise panic/recovery/crowd movement is not yet designed.
- **NIGHT:** when the HQ network is ON, the very same broadcasts **attract nearby mutants toward active towers** within their 3-tile influence area. This is a local tactical lure/trap opportunity, not an extra mutant spawn, a change to wave counts, or a promise to redirect monsters across the whole map. OFF disables the lure. Exact target-override priority, retargeting, attackability, occlusion, gate interaction, cooldown, and what happens after a tower is destroyed remain OPEN.
- **Audio content:** the player will **record original lines for El Papi** to play over the towers, with deliberately tinny/filtered public-address coloration. Plan short distinct phrases and varied intervals rather than continuous speech. One logical broadcast event should not stack one full-volume voice instance per tower. Include a mute/subtitle/accessibility path. Content and actual recordings are **NOT YET DELIVERED**.
- **Still OPEN:** construction cost/AP, size/footprint/HP, electric demand and powered-state behavior, construction restrictions, threat/lure priority, exact radius semantics at tile boundaries, switching permissions by phase, handling of overlapping tower areas and audio distance attenuation. The 3-tile figure and central HQ toggle are current design decisions, not implemented features.
- This whole system is a **future separately authorized gameplay/audio task**. No further mechanics should be built simply because this GDD describes it.

## 11. UX and accessibility

- Mobile landscape is first-class; test desktop and emulated mobile, then sanity-check physical mobile hardware.
- Canvas placement and camera controls must be comfortably tappable; never infer intent from a tiny 8-pixel hit target.
- Selecting a building exposes compact management controls (power toggles, demolition). **After TASK 025.4C**, damaged standing buildings also expose explicit **REPAIR / STOP REPAIR** commands; HQ can be repaired but never demolished. Repair targeting does not involve the work flag. Mobile building placement remains two-stage preview and confirmation; a visual gate overhang does not enlarge logical footprint or change hit-testing.
- During the night the menu does **not** pause simulation; background/focus loss should pause automatically for safety/usability.
- Newspaper can be scrolled or closed instantly, with data above flavor. Avoid making long satirical interviews required reading.
- Color coding needs icons/text for accessibility; use UI scale suited to mobile, high contrast for night, and explicit invalid placement overlays.

### 11A. Sound and music production inventory (ASSETS IDENTIFIED / INTEGRATION DEFERRED)

**Approved technical direction:** start from the existing **BarrelStorm SoundManager** architecture as the reference/reuse source, and adapt it to PAPI Industries' Phaser/Vite runtime, its simulation event semantics and gameplay categories. Review the actual implementation and asset/code ownership first; do not paste inaccessible/private starter code or licensed third-party assets into the public game without permission. Preserve a single well-defined event-to-audio boundary; do not build a new competing sound framework for this task.

Audio assets have been identified, but **no PAPI SoundManager integration is claimed implemented**. Existing gameplay tasks 025.4B/C must not silently become an audio-system rewrite. When audio becomes its own approved task, use the adapted event-based manager with capped concurrent instances and category cooldowns (especially rapid gunfire, multi-mutant damage and repeated voice lines). Sound should follow actual simulation events, not render frames or animation callbacks. 2×/4× simulation time must not produce unbounded overlapping voices.

**Tentative event-to-asset map (not final mix):**

| Event | Candidate assets |
|---|---|
| Wall damage/breach/destruction | `Wall Break Stone A.wav` through `Wall Break Stone E.wav` (vary intensity/gain by event) |
| Factory/mine vehicle startup or truck travel | `ENGINE Motor Small Loop 02.ogg` (avoid stacking one loud loop per truck) |
| Building power toggles | `MECH Servo Motor Power Up Long 02.ogg`; `MECH Servo Motor Power Down Long 05.ogg` |
| Mutant spawn | `VOCAL EVIL Growl Grunt 01.ogg`, `02.ogg` |
| Mutant damage | `VOCAL EVIL Growl Grunt 03.ogg`; `VOCAL EVIL Impact Hit AHHH 01.ogg` / `02.ogg` / `03.ogg` |
| Mutant biting | `VOCAL EVIL Grunt Chomp 01.ogg` / `02.ogg` / `03.ogg` |
| Rifle/infantry fire | `WEAPON GUNSHOT MachineGun Repeater 06.ogg`; `WEAPON GUNSHOT MachineGun Spray 04.ogg` (subject to weapon role) |
| Rocket infantry / Siege shot | `WEAPON GUNSHOT Rocket Launcher 03.ogg` (shared placeholder; differentiate mix if needed) |
| Structure destroyed | `DESTRUCTION Break Impact 02.ogg` |
| Rocket/Siege impact | `EXPLOSION Bang Blast 02.ogg` |

**Voice pack (MP3; categorized source inventory):**

- Workers: `worker_select_01/02/03`, `worker_complete_01`, `worker_danger_01/02`, `worker_explore_01/02/03`, `worker_lumber_01/02`, `worker_mining_01/02`, `worker_rare_01/02`, `worker_return_01/02`.
- Soldiers: `soldier_select_01/02/03`, `soldier_order_01/02/03`, `soldier_attack_01/02/03`, `soldier_danger_01/02`, `soldier_retreat_01`, `soldier_victory_01/02`, `soldier_rare_01/02`.
- The asset dump also includes both `worker_return_02.mp3` and `worker_return_02 (1).mp3`; check whether they are duplicates before publishing a manifest.
- Music candidates: `Spanish - Océano Loop.wav` and `Spanish - Como Versace Loop.wav`. **Day vs Night assignment remains unverified until auditioned.** Preserve source masters; choose an appropriate compressed browser delivery format later and verify redistribution licences.
- **El Papi PA voice recordings (PLANNED; not yet recorded):** capture original, short broadcast snippets for future LOUDSPEAKER towers. Suggested authored examples, not recorded assets: `¡Papi el Grande! ¡Papi el Supremo!`, `¡Trabajo! ¡Progreso! ¡Papi!`, `¡Viva San Papi!`, `¡La selva es temporal! ¡El progreso es eterno!`, `¡Papi el más delicioso!`. Keep phrases distinct, ideally around 2–5 seconds, and tag the files by intent. The *most delicious* line deliberately foreshadows the Night 99 ending. Voice casting/performance, file format, loudspeaker distortion and actual rotation cadence belong to a separate audio task; repeated broadcasts must use global cooldown/concurrency limits, not multiply with tower count.

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

**MANDATORY workflow:** risk-based testing only, as recorded in `CLAUDE.md`. Choose targeted units/E2E based on changed code and risk. Full test suites, soaks or broad mutation campaigns require explicit approval; finishing a task is not sufficient justification. Existing production isolation and deterministic-QA guarantees remain mandatory.

**Testing layers:**
- Unit/property tests: arbitrary rectangular footprints, 5×5 grid boundaries, collisions, deletion reversibility, costs/AP rollback and fences.
- Playwright: actual clicks/taps on Phaser canvas and state assertion via snapshot; desktop mouse + mobile landscape touch emulation; zoom/pan, menu, newspaper scroll and dismissal.
- Deterministic simulation: stable update order, seeded RNG, fixed dt and explicit clock across active Day/Dusk/Night; no `Date.now()`/real timers in gameplay logic. DAY fast-forward and ordinary ticking must yield equivalent states, including clearing and deliveries. Tests may advance deterministic ticks rather than waiting in real time.
- Separate real mobile smoke pass for hit-target size, touch ergonomics, browser throttling and performance.

## 13. Scope plan and cut order

**P0: playable core (protect at all costs)** — **REPORTED COMPLETED:** deterministic grid, placement, Credits/AP, power, fixed-tick Day/Dusk/Night cycle, worker expeditions and clearing, roads, production/logistics, pollution/Threat, basic mutants plus Spitter and Brute, turret and infantry defence, mobile placement, HQ defeat and gate art. **Remaining / not confirmed:** compact truthful morning summary/newspaper and TASK 025.4C paid repair implementation. Mines/deposits remain a separate expansion decision, not an implicit P0 requirement.

**P1: game identity (strongly preferred; scope review needed)** — LA VOZ DE SAN PAPI morning newspaper and static contextual satire, polish/UX of active cycle, mobile performance and readability, eventual mine/deposit gameplay. New policies and dramatic terrain-palette shifts may be cut if jam time is short.

**P2: expandable if time remains** — mine/deposit extraction if not part of P1; **approved environmental-protester visuals and 3-tile LOUDSPEAKER towers with HQ ON/OFF control** (mechanics still pending); Papi directives; additional enemy/art/audio variety and newspaper archive. None is automatic follow-on work from worker repairs.

**Post-jam / separately scoped candidates** — BarrelStorm-derived SoundManager/voice pipeline if it misses the jam deadline, expanded industry and climate systems, richer civic AI, campaign/scenarios, complex directives, environmental simulation depth, and the **approved Night 99 ending if it misses jam scope**. The ending is a decided narrative goal, not an implemented win condition.

**Current task sequence (reported tasks, not permission to code):** TASKS 010–025.3 and UI/road/combat work as historically recorded. **025.4A** active Day/worker lifecycle and **025.4B** jungle clearing/Pollution: agent-reported complete, targeted tests reported. Native horizontal/vertical gate sprites: integration reported complete, with 1×1 logical footprint. **025.4C** manual paid repairs: approved but not yet implemented/reported tested. **Wall Art & Topology Hotfix:** audit/design only, corrected sprites being prepared separately; gameplay continues in parallel. **Mines/deposits, newspaper, BarrelStorm-derived SoundManager, policies, protesters, LOUDSPEAKER, Night 99 ending:** later, separately authorized work. Agents do not auto-start next task because a document mentions it.

**Milestone gates:**
1. **Graybox:** two building footprints, one resource, one defense and one attack wave work without art.
2. **Playable:** one full day/night/dawn cycle, basic power/pollution economy and losing conditions.
3. **Jam-ready:** complete loop, morning report, touch controls and repeatable QA tests.
4. **Polish:** cosmetic assets, content library, sound, extras only after readiness.

**Cut rule:** cut features, enemy varieties and art detail before compromising stability of the core loop. Avoid new mechanics during final week.

## 14. Open questions / graybox experiments

1. **Construction queue:** deferred after choosing instant AP/Credits construction; revisit only if the immediate-placement loop proves inadequate.
2. **AP granularity (DECIDED / 025.4A/B):** placing **or moving** the HQ work flag costs **1 AP per action**; sending/recalling workers with an existing flag is free. No per-tree AP; worker repairs in 025.4C will also spend no AP. This supersedes the v0.3 one-AP-per-day expedition rule.
3. **Power deficit:** implemented NORMAL / LOW_POWER / BLACKOUT with full consumer shutdown during deficit, preserving enabled flags. Playtest fairness; do not change it implicitly.
4. **Enemy pathing:** implemented for TASK 019 as direct steering plus a bounded search when a fortification blocks a step. A full flow field was not needed. The limits remain provisional.
5. **Balance:** is 60 seconds of night engaging with only automated turrets? Make waves meaningful, not punitive or idle.
6. **Production accounting (UPDATED 025.4A):** Factory GOODS production, trucking and per-delivery Credits occur across active Day/Dusk/Night, not just Night. This differs materially from the old 150 Credits/night cap. Night-end emissions remain based on end-of-night power state, so pollution-toggling incentives are still a balance question; do not silently change emissions cadence as part of repairs.
7. **Softlocks:** prevent HQ spawns, tree layouts or resource placement from creating unwinnable starts.
8. **Technical/IP:** public repository can show PAPI-specific QA code, but avoid copying private starter code or asset packages unless licenses and redistribution rights permit.
9. **TASK 011A combat values:** coordinate system aligned to 32 px cells, mutant HP, building HP, target priority/tie-breaking, spawn cadence, approach to rectangular footprints, damage persistence and dawn cleanup were approved as temporary graybox values for TASK 011A (see the implemented baseline). Final combat balance remains **OPEN**.
10. **Autocannon footprint:** resolved as 1×1 for TASK 011B. Final turret balance remains **OPEN**.
11. **Economy safety:** `Economy.adjustCredits` historically validated the delta but not the resulting safe-integer balance; TASK 010 prevalidates night-end settlement specifically. Broader Economy hardening is separate work.
12. **Known balance issues (historical scripted evidence; current playtest required):** The old no-income turtle and power-plant vulnerabilities are documented, but active Day logistics now increases potential earnings and clearing increases Pollution. Past simulations and fortress survivals were tuned before all 025.4A/B changes; they are **historical**, not current pass/fail targets. Previously permanent HQ damage is **proposed to become repairable in 025.4C**, which may change Spitter and Brute balance significantly. Review in manual playtests before changing wave formulas.
13. **Starting budget (approved value, balance provisional):** the starting budget is **1250 Credits**. Power Plant (**500**) + Factory (**400**) + Autocannon (**250**) costs **1150**, so the first Day can include all three and leaves **100**. A no-income turtle can now buy three Autocannons and a Plant. Real gameplay will determine whether this opening is well balanced.
14. **Fortress benchmarks (historical, not targets):** the original PAPI FORTRESS 22 predates roads and cannot be built under the road rules, so it is kept as a historical combat benchmark in a world without roads, and it is stale for normal play. The road-legal variant from TASK 017 and the player-exported `fortress-corner-v1` both predate fixed docks, so they are stale too and are kept unchanged. None of these sets a required survival Night. A player-derived, logistics-compliant fortress will follow manual playtesting.
15. **Infantry balance (OPEN, scripted evidence only, see `npm run test:soak:infantry`):** on the real planner with no income and no player input, across 5 seeds, three cannons (750 Credits) fall at a median of Night 22. Two cannons and a Barracks (900) fall at Night 16, two Barracks with flags north and south of HQ (800) at Night 9, and one Barracks and one cannon (650) at Night 7. These runs never move a flag, which is what a squad is for, so they understate infantry. Even so, a static squad is much weaker than an Autocannon. **Soldiers rarely die in ordinary bases:** 3 lost of about 920 deployed across those scripted bases, because mutants at their targets are not lured and soldiers shoot from range. They do die on a lane: 8 of 16 against the heaviest wave. Barracks do not raise the wave budget, which Autocannons do. Real play must judge all of this before any value changes.
16. **Spitter balance (DECIDED: Spitter unchanged, scripted evidence plus one developer playtest, see `npm run test:soak:spitters`):** the developer playtested the Spitter and survived through **Day 40** with an actively managed, economically developed base, and decided to keep its stats and wave composition. The early fall of static, no-income bases is an accepted gameplay distinction, not a defect: with no income, repairs or rebuilding, the established 3-cannon turtles fall at a median of **Night 12 from the centre and 13 from corners**, against **20 and 24** on the same waves of ordinary mutants. This supersedes the Night 18-25 target of TASK 015 for bases facing Spitters; that target still describes ordinary waves alone. Most Spitters use all five shots unanswered, wear down the Plant, and its loss silences every cannon. A 3-cannon compact base falls at Night 12 against 21, and 6 cannons at 14 where every ordinary run survived 30 Nights. Walls help most: 3 cannons with 38 walls falls at 17 against 21. `fortress-checkerboard-v1` barely changes (median beyond Night 30 either way, 5 of 10 runs surviving against 8). A stand-in player moving the flag raises armed Spitters killed from 25 to 142 and cuts shell damage by 35%, but in that no-income base the median stays at Night 13. Day 40 is one playtest: context for later design, not a balance target or a pass condition.
17. **Brute balance (approved, provisional, scripted evidence plus developer playtests, see `npm run test:soak:brutes`):** from a whole `golden-fortress-day33-v2`, ordinary cannons kill nearly every Brute on Nights 30, 35 and 40, HQ takes no damage, and a Night costs about 1, 2 and 4 walls, plus about 1 building in 2 by Night 40. Brutes take 30% to 61% of all cannon shots, so ordinary mutants do up to five times the damage. With nobody playing, that fortress falls at a median of Night 37, where it used to outlast Night 45. No value has been tuned.
18. **Heavy weapons balance (approved, provisional, scripted evidence plus developer playtests, see `npm run test:soak:heavy`):** Developer playtests before these weapons: a passive fortress of three Factories and layered Walls with no guns failed against the first Brute wave, and FORTRESS OF POLAND (9 Autocannons, 2 Barracks, 2 Factories, 3 Plants, 320 of 320 power) reached Day 32 with active repairs and one more Autocannon. That supports the current Brute. In scripted runs, one Brute from the west dies at tick 872 to 5 cannons, 1360 to 1 Siege Cannon, 1337 to a Rocket squad and 858 to both, and a Rifle squad alone leaves it on 295 HP. On `golden-fortress-day33-v2`, the estimated rebuild bill for Night 40 falls from about 418 Credits as built to 178 with 1 Siege Cannon, 250 with a Rocket squad on a static flag, and 48 with both and a scripted flag. **Spitters, Nights 1-29:** a Siege Cannon spends 16% of its shots on them and cuts shots per Spitter from 4.65 to 3.49, and takes most armed kills when no squad is active, but a scripted flag keeps its value: it adds 2 Nights with or without a Siege Cannon. Scripted flags are stand-ins, not play. Real play must judge whether heavy weapons make Nights 35-40 too comfortable; no value has been tuned.
19. **Wave predictability (OPEN, not changed):** every production run uses the same RNG seed (731), so the same spawn order repeats: the first mutant always appears at the bottom-right, at border cell 22,15. Playtesting showed this allows a deliberately asymmetric defense. Review this when the Wave Director is next assigned.

20. **Manual repair balance (APPROVED, awaiting 025.4C):** Provisional 10 HP/60 ticks, 60% value-based ordinary-building repairs and HQ 1 Cr/HP, 3 concurrent direct orders. Manual STOP frees a worker; no money automatically cancels. Verify rounding across repeated 10-HP increments, task interruption and Dusk resumption, and playtest whether the rate makes HQ damage too recoverable.
21. **Worker vs work-flag AP:** Work flag placement/movement costs 1 AP each, dispatch/recall free; repairs intentionally bypass that flag. This must be discoverable in UI and must not make players micromanage geography merely to repair one structure.
22. **Terrain damage to balance:** A full Day can clear roughly 18–25 tiles and immediately add that much Pollution, on top of the established +12/Plant and +8/Factory nightly emissions. This may accelerate Threat tiers quickly; **observe gameplay first**, do not preemptively nerf.
23. **Gate/wall rendering (DEFERRED HOTFIX):** Separate 8-frame horizontal/vertical gate sheets work at native 32×48 cells, with horizontal art seated in lower 32 and vertical overhang +16; footprint stays 1×1. Wall art still needs distinct vertical continuations, end caps and correct wall/gate joins. The developer will supply corrected art later; do not rotate horizontal 2.5D sprite art to fake vertical perspective.
24. **Audio performance and packaging (PARTLY DECIDED / NOT IMPLEMENTED):** Adapt the **BarrelStorm SoundManager** to PAPI's event-driven audio. Repeated combat events need concurrency/priority caps; voices must not overlap uncontrollably; WAV masters need browser-ready delivery copies and licensing verification. El Papi's original loudspeaker lines still need recording; multiple towers must not cause simultaneous duplicate voice playback.
25. **Narrative finale (DESIGN APPROVED, NOT IMPLEMENTED):** surviving **Night 99** triggers the planned conclusion: a mutant eats El Colonel, inherits his hat and office, and the MENU presidential portrait and bust use their bitten variants. Persistence of the alternate menu state after reload, ending credits/UX and jam inclusion remain OPEN. This is not a new boss or a balance pass.
26. **Touch timeout investigation (OPEN):** Two legacy touch variants of the same scenario reportedly took ~15.8 s against a 15 s timeout; disabling new terrain copying did not cure it. This is not proof of an introduced regression. Measure the slow step and change only the scoped test timeout if justified; never silently increase the global suite timeout.

## 15. Definition of done: first playable slice

- A 5×5 QA map and a larger normal map use the same placement rules.
- **REPORTED IMPLEMENTED (025.4B):** A player can clear jungle on the normal map with HQ workers, then build on cleared tiles, with correct AP/credits/terrain/Pollution rules.
- Power generation and consumption affect whether a turret can operate.
- One deterministic 60-second night wave can damage structures and end in victory or loss.
- Pollution changes risk in a verifiable way.
- A morning report eventually presents real results and transitions back to Day (**PLANNED**, not yet implemented).
- **REPORTED IMPLEMENTED (025.4A/B):** active Day/Dusk/Night preserve worker health, positions, visibility and work progress; END DAY simulates remaining ticks instead of skipping them, while Night settlement occurs once. Repair orders are still an approved NEXT TASK, not a completed mechanic.
- Desktop mouse and mobile landscape taps pass Playwright E2E; simulations pass headless tests.

> **PAPI INDUSTRIES:** Building Tomorrow with Yesterday's Ethics.
