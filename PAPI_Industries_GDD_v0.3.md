# PAPI INDUSTRIES: THE GREEN SHIFT
## Game Design Document - v0.3 - 7 November 2026

**Status:** Active graybox development; TASK 025.3 reported completed; TASK 025.4A design specified, implementation not confirmed  
**Genre:** Industrial management + survival tower defense + corporate satire  
**Platform:** Browser (itch.io), desktop and mobile landscape  
**Engine:** Phaser + Vite · public GitHub game repository  
**Jam:** Game Off 2026 · theme **SHIFT**  
**One-line pitch:** Build the industry. Poison the wilderness. Survive what comes out of it. Your boss will take the credit.

> **Scope rule:** Playability first; art and optional systems can be cut without breaking the core loop. Figures throughout are starting hypotheses, not balanced final values.

> **Authority note (7 Nov 2026):** **IMPLEMENTED** refers to behavior reported by the development agent in completed tasks, subject to verification against repository code/tests. **DESIGN APPROVED / NOT VERIFIED AS IMPLEMENTED** records gameplay decisions for the next implementation stage; it does not mean the repository already does this. **PLANNED** describes deferred intent. **OPEN** requires an explicit decision. `CLAUDE.md` governs coding and mandatory risk-based testing; this GDD governs gameplay design. An agent must not automatically start another task merely because this document lists it.

### v0.3 change log (design decisions, not an implementation report)

- **Active Day -> Dusk -> Night -> Dawn** replaces the proposed untimed planning day. Provisional durations: Day **3600 ticks (60 s at 60 Hz)**, Dusk **300 ticks (5 s)**, Night remains **3600 ticks (60 s)**. Tune only after playtesting.
- Day remains a building/planning phase, but workers and ambient NPCs move while the day clock advances. `END DAY` **fast-forwards the remaining simulation ticks**, rather than skipping them.
- The **three controllable HQ workers** become daytime expeditions: first dispatch costs **1 AP per day**, same-day reassignment, recall and redispatch of surviving workers are free; they work only after reaching the work flag, automatically stop at Dusk, and physically return toward HQ. Stragglers can still be outside when Night attacks begin.
- Separate **ambient NPC workers** make the base feel inhabited. They are not controllable, do not provide LOS or production, and their deaths have no economic/gameplay penalty.
- Workers and military infantry gain a provisional **1.2x movement speed on constructed roads and the HQ ring**. The decorative dirt track gives no bonus. A player-placed road costs **2 Credits and 0 AP** (previously free); time-aware route preference is a design requirement to validate with actual navigation.
- **TASK 025.4B** will make workers clear jungle only after arriving at the flag, within the existing work radius (**3 tiles**, provisional). Each tile takes time to clear and adds Pollution; no free autonomous march deeper into the forest.
- **Preserved legacy state:** TASK 025.3 currently reports night-only, temporary workers and an untimed day. No new Day/Dusk functionality is claimed implemented here; TASK 025.4A and 025.4B remain separate deliverables.


### Reported implemented graybox baseline (through TASK 025.3)

The list below deliberately retains some historic behavior that the approved 025.4A design will replace. **Do not treat approved redesign rules as already implemented.**

- **IMPLEMENTED (historical starting baseline):** Phaser 4/Vite graybox, originally 1280x720 logical canvas (`FIT`, centered), 24x16 cells of 32 px each, mouse/touch selection, placement previews and actual building selection. **Current normal map is 48x32 jungle** and the open 24x16 map is retained for legacy scenarios (TASK 025.1). HUD/camera and mobile two-step placement were reconstructed in TASK 024/024.1.
- **IMPLEMENTED:** Instant Day-only construction. Initial **1250 Credits / 5 AP** (approved starting budget); Outpost 1×1 costs **100 Credits / 1 AP**; Factory 3×3 costs **400 / 1 AP**; Power Plant 3×3 costs **500 / 1 AP**. The older construction-queue idea is **deferred**, not active.
- **IMPLEMENTED (before TASK 025.4A):** Deterministic 60 Hz simulation and seeded RNG; **currently untimed and static Day**, **3600-tick Night**, AP reset to 5 at dawn. Test-only pause/resume/manual stepping; QA instrumentation absent in production build. **DESIGN APPROVED / NOT VERIFIED AS IMPLEMENTED:** replace the static Day with active Day and Dusk according to Section 2A; do not describe this as existing behavior until verified.
- **IMPLEMENTED:** Global power, no wires. Plant supplies **100**, Factory demands **40**, Outpost demands **10**. Each building has an independent persistent `enabled` flag, toggleable for free during either shift. Power is derived, never duplicated: NORMAL if supply ≥ enabled demand; LOW_POWER if 0 < supply < demand; BLACKOUT if supply = 0 and demand > 0. Under LOW_POWER or BLACKOUT **all enabled consumers are unpowered**, without automatically switching them OFF. No priority-based shedding.
- **IMPLEMENTED:** Night-end economic settlement: no building has upkeep at present (the Outpost's was removed in TASK 025.2; the field remains for future worker repairs); Factories earn through deliveries instead (TASK 018); Plant contributes no income/upkeep in current graybox. Calculation uses **end-of-night power state**, even if toggled in the last tick. Debt is allowed; construction cannot overspend.
- **IMPLEMENTED (TASK 010, historic economy baseline):** Pollution starts at **0**. Existing industrial emissions accumulate once per completed Night, with **no decay**. The planned worker clearing in TASK 025.4B will add immediate Pollution during Day; this is separate from Night-end industrial emissions. An enabled generating Plant emits **+12**, an enabled powered Factory **+8**, Outpost **0**. Threat is derived: pollution **0–24 ⇒ 1**, **25–49 ⇒ 2**, **50–99 ⇒ 3**, **100+ ⇒ 4**. The derived Threat contributes to the implemented wave budget (TASK 012A). Credits and pollution are jointly prevalidated before night-end settlement; the game uses a synchronous pollution-then-Credits commit with no rollback. 
- **IMPLEMENTED (TASK 011A, temporary graybox values, not balanced):** Mutants spawn on the grid border on the night's scheduled ticks, using one seeded draw each; a blocked border cell moves the spawn to the next free position clockwise, and the spawn is skipped if every border cell is occupied. Mutant: **40 HP**, **0.5 px per tick** in world pixels, axis-based movement, **8 px** attack range, **5 damage every 60 ticks**. Target choice is the lowest Manhattan distance to the footprint minus a bias of **256** (Power Plant), **128** (Factory) or **0** (Outpost), with deterministic tie-breaks, and the target stays locked until destroyed. A building blocking the next step becomes a temporary obstacle target, attacked until destroyed before the mutant resumes; there is no pathfinding. Building HP: Outpost **100**, Factory and Power Plant **300**. Damage persists across nights. Destruction removes the building and its occupancy together, and power, settlement and pollution use the remaining buildings. Mutants act on night ticks 1–3599, and survivors are removed at dawn with no penalty. With no buildings left, a mutant waits until dawn. Damaged buildings show a graybox HP bar.
- **IMPLEMENTED (TASK 011B, temporary graybox values, not balanced):** The **Autocannon** is a separate 1×1 defensive building: **250 Credits / 1 AP**, power demand **20**, **150 HP**, no income, upkeep or pollution, and a mutant target bias of **64**. It fires automatically during Night while enabled and powered, so LOW_POWER and BLACKOUT silence it. Range is **160 px**, circular and inclusive, from the footprint centre. Each hit deals **10 damage** instantly, with **30 ticks** between shots and no projectiles. It acquires the nearest living mutant in range, with ties going to spawn order, and keeps that target while it is alive and in range. It reacquires when the target dies or leaves range, and clears the lock when disabled or unpowered. Reacquiring never changes the cooldown. The cooldown pauses while unpowered and resets at dawn. Each Night tick resolves shift state, then turrets, then surviving mutants, so a mutant killed on a tick cannot act on it. Combat runs on night ticks 1–3599, and tick 3600 only settles.
- **IMPLEMENTED (TASK 012A, temporary graybox values, not balanced):** Each night's mutant count is **min(40, nightBudget + pollutionBudget + defenseResponse + accelerationBudget)**, where nightBudget = **1 + floor((night − 1) / 2)**, pollutionBudget = **2 × (Threat Level − 1)**, defenseResponse = **min(4, floor(max(0, Autocannons − 1) / 2))**, and accelerationBudget is defined under TASK 015 below. Every existing Autocannon counts, enabled or not, powered or not. The plan is sampled on night tick 1 and frozen until dawn, so a night's emissions affect the next night, and switching power or losing a cannon changes nothing that night. Spawns run from tick **600** to the night's last spawn tick, starting at **2700**, with gaps that shrink through the night, one per tick at most. A spawn skipped because the whole border is occupied is not retried. Night 1 at Threat 1 stays one mutant at tick 600. The HUD shows `Mutants N | Wave X/Y` during Night, where X/Y is scheduled slots reached out of total, not kills.
- **IMPLEMENTED (TASK 019, approved rules with provisional values):** **Walls** are 1×1, **25 Credits / 0 AP**, **100 HP**, with no power, upkeep or pollution. They cannot overlap roads, buildings or each other. **Gates** come in two orientations, Vertical (a vertical barrier across an east-west road) and Horizontal, at **100 Credits / 1 AP**, **150 HP**, with no power. A gate stands on a road tile with road on both sides along its passage axis. It cannot stand on the HQ ring or a dock tile, or strand a Factory dock, and the road under it cannot be removed while it stands. Corners take no gate; a junction can be gated if every dock keeps a route, which cuts the crossing branch at that tile. Both are built during Day and can be demolished during Day, free and with no refund, which is the only way to restore damage. **Gate operation:** gates are closed by default and cannot be commanded. A truck stops one tile short and the gate takes **150** ticks to open, stays open until the last truck has passed, and takes **60** ticks to close, so each crossing costs a truck 150 ticks. Trucks choose the quickest route by estimated time, at **32** ticks a tile plus **150** a gate. A destroyed gate leaves plain road, and at dawn all gates are closed. **Mutants:** walls and gates are obstacles, never targets. A mutant blocked by one looks once for an open way to a free tile next to its target, within **12** extra tiles, and otherwise attacks what blocks it; a mutant has **24** extra tiles and **4** plans for its whole life. **No path never means no attack.** Open gates admit mutants along their passage axis only. Autocannons fire over walls. A breach is passable at once. A fortified border cell does not displace a spawn: the mutant arrives outside it and must breach it. The map edge is not a wall. **Reinforced Gates are future scope:** stronger variants of both orientations, reusing the same logic with different HP and cost.
- **IMPLEMENTED (TASK 021):** Every building except HQ can be **demolished** during Day: no Credits, no AP and no refund, so it is not a way to sell. A selected building shows the action, and HQ and its road ring stay protected. Walls and gates go on one press, for fast editing. Anything else takes two: the first turns the button to **CONFIRM** for that building, and selecting anything else, any other action or the end of Day cancels it. A demolished Factory loses its stored loads and its truck.
- **IMPLEMENTED (TASK 021, approved rules with provisional values):** A **Barracks** is **3×3, 400 Credits / 1 AP**, power demand **30**, **300 HP**, with no upkeep or pollution and a mutant target bias of **64**. At most **4** stand at once; losing one frees a place. Its fixed exit is on its left side, at **{col − 1, row + 1}**, and that exact tile must be a connected road. The exit counts as a dock: its road cannot be removed or gated, so it can never be blocked. **Squads:** each Barracks fields **4** soldiers. They leave on its powered Night ticks **1, 31, 61 and 91**. While below strength after that, one free replacement arrives per **600** powered ticks, and a squad never exceeds four living soldiers. Soldiers exist only at Night: all are removed at dawn, and a full, unhurt squad musters the next Night. Losing power pauses deployment and replacement, but soldiers already out fight on. A destroyed Barracks sends nobody else, and its survivors hold their last post until death or dawn. **Flags:** each Barracks has one rally flag, set by selecting it and pressing Flag, during Day or Night, free. A flag goes on open ground or a road, never on a building or gate, another squad's post, or a tile the squad cannot reach. With no flag the squad guards its exit. A flag walled off or built over later is kept and shown blocked, and the squad guards its exit until a way opens. The player never commands individual soldiers. **Movement:** soldiers ignore roads and walk any open tile at **1 px per tick**, along a shared distance field that is rebuilt whenever walking changes, so a breach is used at once. They pass gates only along the passage axis, wait for OPEN as trucks do, and hold the gate open until clear of it. Soldiers never attack your walls or gates. **Combat:** a soldier has **30 HP** and a rifle: range **96 px**, **5 damage** every **90 ticks**, instant, passing over walls and buildings like Autocannon fire, with no friendly fire. It fires at anything in range, even on the march. It picks up mutants within **160 px** of its post, lets go beyond **192 px**, and closes on a target up to **4 walking tiles** from its post, then goes back. **Mutants:** soldiers are never strategic targets. A soldier in melee reach stops a mutant, which attacks it. A walking mutant within **64 px** of a soldier turns towards it, but only while the whole way is clear, asked afresh every tick, so a soldier behind a wall is ignored and a breach counts at once. A mutant at its target or at an obstacle is not pulled away. Barracks are not counted by `defenseResponse`. Details and scripted balance results are under Known balance issues in section 14.
- **IMPLEMENTED (TASK 022, approved rules with provisional values, kept after playtest):** The **Spitter** is the first ranged mutant, shown as a lime triangle. **30 HP**, **0.5 px per tick**, with the same targets and detours as any mutant. It stops as soon as its target is within **192 px**, circular, measured to the nearest point of the footprint, and only a destroyed target moves it on. It fires a shell every **180 ticks**, the last **45** being a telegraph: it swells and draws a line to a fixed aim point. Each shell does **10 damage**. **Every shot stops at the first solid thing on its line:** walls, gates that are not open, and ordinary buildings all protect what stands behind them, so a blocked shot damages the blocker, never anything further, and a Spitter never needs a firing position or idles. An OPEN gate passes a shot only through its doorway, crossing both passage faces between the posts. Player guns still fire over everything; this asymmetry is deliberate. **Shells are real:** what a shell hits is settled on release and it lands after a short flight, even if its Spitter has died. If that building has gone, it lands on nothing. **Soldiers:** the Spitter fires back at the nearest soldier within **128 px** with a clear line, which uses up a shot. It aims at a point, not a soldier, and a shell never follows anyone, so a soldier who has moved off the spot is missed. It is not lured while it has shots. **After 5 shots it has none left:** it turns over, goes dull, and carries on as an ordinary melee mutant. **Waves:** first eligible on **Night 5**, then **min(6, floor(budget / 4), 1 + floor((night − 5) / 3))** per Night, spread evenly and never first. Each takes the place of one ordinary mutant, so wave size, spawn ticks and spawn positions do not change. `defenseResponse` and the wave cap are untouched. Spitters ignore trucks while they have shots.
- **IMPLEMENTED (TASK 023, approved rules with provisional values):** The **Brute** is a slow, heavy melee mutant, an orange octagon with a visible HP bar: **600 HP**, **0.25 px per tick**, **25 damage every 120 ticks**, no armour and no immunity. It targets, fights, attacks trucks and soldiers and is lured like any mutant, but it **never detours**: a fortification in its way is attacked at once, and the breach is open to everyone behind it. **Waves:** none to Night 29, then at most **1** on Nights 30-34, **2** on 35-39 and **3** from Night 40. Each costs **3** of the wave's 40 slots: it spawns in one, and two are absorbed, keeping their tick and random draw but spawning nothing. So Spitters, spawn positions and the wave cap are unchanged, and a wave gets heavier with fewer enemies. **RESET FLAG:** a Barracks with a flag can have it cleared, by Day or Night, free. Only that squad is affected, and it walks back to its exit, with no teleport, healing or new soldiers.
- **IMPLEMENTED (TASK 023, approved rules with provisional values):** The **Siege Cannon** is a 2×2 stationary gun for heavy targets: **600 Credits / 1 AP**, power demand **20**, **250 HP**, mutant target bias **64**, no upkeep or pollution, available from Day 1. Its range is a ring from **64 to 256 px**. It fires **200 damage** every **300 ticks**, at the nearest Brute in range, otherwise the nearest mutant; Spitters get no preference. Its shell flies over walls at about **8 px per tick** to where the target stood when fired, with no homing, and hurts at most one mutant within **24 px** of that point, with no splash. Unpowered, its reload pauses; a shell in flight still lands, even if the gun has gone; shells are cleared at dawn. Each one counts as one stationary gun in `defenseResponse`, by the unchanged formula. **Rocket Infantry:** a Barracks can be refitted between Rifle and Rocket during Day for **200 Credits and 1 AP**, in two presses, with no rebuild: its flag, HP and power demand stay. A Rocket squad is **2** soldiers at the usual HP and speed, range **128 px**, **120 damage** every **480 ticks**. Rockets fly over walls at **5 px per tick** to where the target stood, with no homing and no splash, and hit only a mutant whose body covers that point when they land: **8 px** for a basic mutant, **11** for a Spitter, **15** for a Brute. So a Brute is hit reliably, and a walking mutant can be missed. They prefer Brutes; otherwise they follow rifle rules. **Power warning:** a placement that would take power from NORMAL to LOW_POWER asks first, and a second press on the same tile confirms it. Any other tile, building or mode cancels. The player can always accept it.
- **IMPLEMENTED (TASK 018, approved rules with provisional values):** Factories produce **GOODS** and earn through delivery, replacing their Night settlement income. Every Factory has a fixed outgoing dock on its right side, at **{col + 3, row + 1}**, and that exact tile must be a connected road; no other adjacent tile counts, and there is no rotation. HQ receives at its bottom centre, **{col + 1, row + 3}**, on its permanent ring. A powered Factory makes one load (**10 GOODS**) every **600** powered ticks, so a fully powered Night gives **5 loads**. Each delivered load pays **30 Credits**, immediately and exactly once, for up to **150 Credits a Night**. Storage holds **2 loads**, production pauses when full, stored loads persist, and partial progress resets at dusk, so switching on before dawn earns nothing. Each Factory has one free truck: **20 HP**, **1 px per tick**, one load, shortest road route, automatic return. There are no truck purchases or commands, and trucks may overlap. Mutants attack trucks in melee range but never hunt them. A destroyed truck loses its cargo and returns after **600** Night ticks. At dawn trucks park at their docks; a carried load returns to storage if there is room, otherwise it stays on the truck. Credits already delivered are kept even if HQ falls later that Night. Short routes are a deliberate advantage: a route of up to about 10 road edges keeps the full 150, and longer ones earn less, down to about 90 at 20 edges.
- **IMPLEMENTED (TASK 017):** Roads are real infrastructure, separate from buildings. Placing HQ creates a permanent one-tile road ring around it, so the whole **5×5** must fit on the map. Players **currently extend the network for free** during Day, on tiles orthogonally touching the connected network; this price is **superseded in approved design** by the 2-Credit road tile noted immediately below. Nothing can be built on a road. **Factories need a connected road on their fixed dock tile** (TASK 018), and Power Plants, Autocannons and Outposts need no road. A road cannot be removed if a Factory dock would lose every connected route; other removals are allowed and may leave harmless disconnected fragments. Roads are not attacked and do not affect mutants or combat. Since TASK 019 a gate can stand on one.
- **DESIGN APPROVED / NOT VERIFIED AS IMPLEMENTED (post-025.3):** Constructed player Road tiles now cost **2 Credits / 0 AP**; construction of the automatic HQ ring is free. Workers and Rifle/Rocket infantry gain **1.2x movement** on constructed roads, not on natural dirt track. Preserve the previous implementation values above as historical until the relevant patch is confirmed.
- **IMPLEMENTED (TASK 016):** During Night the player can choose **1×, 2× or 4×** speed, for Nights of about 60, 30 or 15 real seconds, hardware permitting. Speed runs more of the same fixed 60 Hz ticks per frame, so a Night is still **3600 ticks** and outcomes do not change for the same commands on the same ticks. The choice lasts across Nights and resets to 1× on a new run. The countdown stays in simulation seconds.
- **IMPLEMENTED (TASK 015, approved rules with provisional values):** Mutant pressure rises with elapsed Nights, independently of Pollution, and Pollution accelerates it further. accelerationBudget = **floor(max(0, night − 6)² / 12)**, the nightly cap is **40**, and the last spawn tick = **max(1200, 2700 − 100 × max(0, night − 6))**. Budgets through Night 9 match the earlier formula, and spawn timing changes from Night 7. **Approved design decisions:** Factories remain the primary source of Credits; production finances the defenses that survival increasingly needs; a defense-only turtle should fall to combat pressure, not to a financial Game Over; there are **no production quotas, quota fines or insolvency rules**. **Provisional, not final:** the formula values, and the balance target that a no-income turtle collapses around Nights 18–25 in tested scenarios. At the earlier 1000-Credit budget, a two-cannon turtle fell on Nights 17–22 across 30 seeds and three HQ positions. At 1250 Credits, a three-cannon turtle has a median defeat of Night 20 from the centre and Nights 23–24 from corners, and none of the 30 seeds reach Night 30 alive. Corner positioning may stay advantageous. Industrial viability must be judged by real play, not scripted runs.
- **IMPLEMENTED (TASK 013, temporary graybox values, not balanced):** The player builds **HQ** first, anywhere valid on the grid: **3×3, 0 Credits, 0 AP, 600 HP, +20 power, 0 demand**, with no upkeep or pollution, and it cannot be toggled. Until HQ stands, the other buildings and END DAY are visible but disabled. Only one HQ can ever be built per run, even after destruction. HQ power joins the global pool, so HQ alone runs one Autocannon or two Outposts but not a Factory, and with a Plant generation is 120. Generation cannot reach 0 while HQ stands, so BLACKOUT does not occur in normal play; LOW_POWER stops consumers the same way. Mutant target bias is **256**, equal to a Power Plant. **Destroying HQ is the only implemented defeat condition.** The run ends on that hit: later mutants do not act, a due spawn is dropped, survivors freeze, and that night earns and emits nothing. Game Over shows `HEADQUARTERS DESTROYED`, the approved quote and completed shifts, and restart returns to the title with a fully fresh run.
- **IMPLEMENTED (TASK 025.1, provisional):** New games are played on a **48×32** jungle map: a seeded, irregular clearing near the middle, dense jungle around it and a dirt path from a map edge into the clearing. **Jungle blocks buildings and roads, and nothing else.** The dirt path is open ground and decoration only: it is not a road and gives no truck access. Mutants emerge from the jungle on a frame the size of the original battlefield around the clearing, so they have as far to walk as before and combat is unchanged. HQ is still placed by the player. The original 24×16 open battlefield is kept for layouts and tests.
- **IMPLEMENTED (TASK 025.2, provisional values):** **Fog of War** on the jungle map: tiles are UNEXPLORED (hidden), EXPLORED (remembered, dimmed, no live enemies shown) or VISIBLE. What is visible is the union of all active vision sources, and explored terrain is never forgotten. A run begins with the clearing explored. Vision radii in tiles: soldiers, workers and ordinary buildings including HQ, **6**; Autocannon and Siege Cannon **7**; Outpost **12**. Walls and gates have no active vision. The camera never reveals anything. Fog changes no rule: combat, targeting, spawning and construction ignore it. The **Outpost** is an observation post: same price and power demand, no upkeep; it sees only while switched on and powered, so LOW_POWER or BLACKOUT blinds it. **TASK 025.3** registered workers as mobile vision sources.
- **IMPLEMENTED (TASK 025.3, current legacy worker behavior):** **Workers.** HQ has a squad of **3** unarmed workers (**15 HP**, vision **6**, work radius **3**, currently unused), at no cost or upkeep. Selecting HQ offers **SEND WORKERS / MOVE FLAG** and **RECALL WORKERS**. The flag can go on any free tile, including jungle and unexplored ground, reveals nothing itself, and remains until recalled. **Currently, movement is Night-only**, workers return/disappear at dawn, and each Night starts with a full squad; killed workers are not replaced mid-Night. They use the soldiers' existing navigation and gates; mutants can kill them. They do no work yet. **DESIGN APPROVED / NOT VERIFIED AS IMPLEMENTED:** replace this lifecycle under TASK 025.4A with Day dispatch costing 1 AP, physical dusk recall and stragglers surviving phase transitions (Section 2A).
- **NOT YET IMPLEMENTED:** score, mine/deposit extraction, trees/terrain clearing, other turret types, building repairs, climate debt, newspaper, policies/directives, decorative environmental changes and final art. Do not treat their descriptions below as existing functionality.

### Next implementation checkpoint

**TASK 025.4A - Active Day & Worker Lifecycle:** design approved and task brief already prepared; completion has **not** been verified in the source/reports available for v0.3. It is followed, only after review, by **TASK 025.4B - Jungle Clearing & Pollution**. This GDD is **not** an instruction to start either task automatically. **Do not assume Outpost is a turret.**


## 1. Vision and design pillars

The player is a foreman operating a resource-extraction complex in the fictional Republic of San Papi. PAPI Industries owns mines, refineries, automotive businesses, energy generation, defense systems, and much of the national narrative. The objective is to keep the operation profitable and survive as many shifts as possible. Industry generates revenue and pollution; pollution makes nighttime wildlife attacks more dangerous. More defense demands more electricity, which may demand more industry.

**Pillars**
1. **Two shifts plus dusk:** a timed, active Day for planning, building and worker expeditions; Dusk recalls workers; Night is a 60-second realtime defense. The new timing model is approved design, not yet verified implementation.
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

**CURRENT BUILD (reported through TASK 025.3):** Day remains an untimed planning phase; workers only venture out during Night; Night lasts 3600 fixed ticks. The following is the **APPROVED NEXT DESIGN**, not yet verified as implemented. Keep this distinction explicit in code reviews, QA and release notes.

1. **DAY START (after Dawn):** show any currently available morning summary, then allow construction and expedition commands with **5 AP** already granted by the Dawn transition. The full newspaper is **PLANNED**, not implemented.
2. **DAY (active, provisional 3600 ticks):** players build and manage power with Credits/AP while HQ workers physically travel to their flag and, in TASK 025.4B, clear jungle. Separate ambient NPC workers wander within the settlement. No mutant waves spawn during ordinary Day.
3. **END DAY:** a deliberate player shortcut that **fast-forwards remaining Day simulation ticks** (including walking, work and visibility updates), then reaches Dusk. It must not teleport units, skip work, or settle income; prevent repeated taps from producing double transitions.
4. **DUSK (provisional 300 ticks):** a visible warning/siren marks the end of fieldwork. Active HQ workers abandon the task and receive an **automatic recall** to El Cuartel General. They move physically; Dusk ends on its timer, **not** when the last worker reaches home.
5. **NIGHT (3600 ticks):** mutant waves, combat, turrets, factory truck logistics and existing Night-specific systems run as before. Workers left outside keep returning via normal routes, can be intercepted or killed by mutants, and do not resume chopping at Night. No daytime construction.
6. **DAWN:** resolve the existing Night economy and pollution **exactly once**, reset AP **exactly once** to 5, and remove surviving mutant enemies under the **currently implemented** cleanup rule. Preserve workers' physical positions and return orders, then start the next Day. Mutant retreat at sunrise is a separate **DEFERRED** idea, not part of the active-day redesign.

**Deterministic time model:** the single 60 Hz fixed-tick simulation advances during Day, Dusk and Night. The browser render rate must not change game outcomes. `END DAY` processes the same simulation steps in bounded, non-blocking batches, without drawing every intermediate tick. If the same commands are issued at the same simulation ticks, normal Day and fast-forwarded Day produce identical states. Night remains the existing 1x / 2x / 4x deterministic simulation; any extension of speed controls to Day requires explicit UX review. Pausing, background/focus loss and mobile portrait suspension must remain safe. Day ticks must **not** accidentally advance Night wave timers, production payouts, nightly pollution settlement, or deployment rules.

**Run-ending condition:** HQ destruction remains the only approved Game Over. Debt does not end a run. The endless survival loop remains the primary game mode; a secret comic ending after 99 Nights is a separate narrative idea, not an automatic balance change or implemented victory condition.

### 2A. Approved Day/Night redesign contract (TASK 025.4A and 025.4B)

> **Status: DESIGN APPROVED / NOT VERIFIED AS IMPLEMENTED.** TASK 025.4A introduces active time and the worker lifecycle. TASK 025.4B introduces work/clearing. Do not bundle both into one unreviewed patch. Durations and movement bonuses below are provisional tuning values.

| Phase | Initial duration | Construction / AP | Controllable workers | Combat and economy |
|---|---:|---|---|---|
| DAY | 3600 ticks (~60 s) | Building, demolition, toggles, flags; 5 AP/dawn | Dispatch, walk, reposition; clear jungle once 025.4B exists | No normal mutant wave; no nightly income/pollution settlement |
| END DAY acceleration | Remaining Day ticks | Lock additional commands while fast-forward is in progress | All ordinary worker steps and work ticks still run | No skipped settlement or wave starts |
| DUSK | 300 ticks (~5 s) | No new expeditions | Stop work, automatic physical recall | No early Night wave; warning/transition |
| NIGHT | 3600 ticks (~60 s) | Existing Night controls; no construction | Survivors outside keep heading home, exposed | Existing waves, turrets, logistics, one settlement at Night end |
| DAWN | Instant transition | AP resets to 5 once | Preserve survivors and positions; replenish only within the agreed cap | Resolve Night once; enter next active Day |

#### 2A.1 Controllable HQ worker expedition

- The HQ has exactly **3 functional worker slots** (TASK 025.3 reports 15 HP per worker), with **vision radius 6 tiles** and a **separate work radius of 3 tiles**. Provisional values; do not add a new worker resource or upkeep tax here.
- **SEND WORKERS** during Day begins an expedition and costs **1 AP the first time that day**. After paying, repositioning **MOVE FLAG**, **RECALL WORKERS** and sending the same surviving workers again during that Day cost **0 additional AP**. Do not charge for every destination change or for every tree. Never create extra workers merely by repeating commands. New deployments are not available at Dusk or Night.
- The flag designates the **centre of a bounded work area**, not a command to march endlessly outward. It can be placed far away, including deep in jungle (provided the destination is genuinely reachable). The flag alone gives no vision.
- Workers **walk to the destination first**. They do **not** chop while passing through the forest. Only after reaching their work area do they begin a task (TASK 025.4B); they select uncleared tiles within the **3-tile work radius** and work on them over multiple simulation ticks. When this area is finished, they stop and wait for further orders. They do not automatically move the work centre into the next patch of jungle.
- **Distance is the natural cost.** Walking out, clearing and physically returning all consume the same limited Day/Dusk/Night time budget. A distant flag is permitted even if it is strategically reckless. Do not invent a distance tax, teleport, or forced safe-return radius.
- Players can recall the expedition early. At Dusk, a recall command is issued automatically; unfinished work halts immediately. Workers navigate home via the existing walk map and passable gates. Dusk does not wait for them. Workers remaining outside at Night are vulnerable, and may enter HQ only after actually reaching it.
- Workers **persist across phase boundaries**: no disappearing at sunrise/sunset, no resetting their positions. Fatalities must not be replenished in the same cycle. **Provisional next-dawn replenishment:** add missing workers at the HQ, up to the three-worker cap, but do not duplicate living workers still traveling home. Permanent hiring/replacement costs are **OPEN** for a later economy task.
- No worker auto-fleeing AI or new combat AI is approved here. They remain unarmed, with the existing mutant vulnerability, and may be distracted/attacked like exposed soldiers according to current rules.

#### 2A.2 Ambient civilians (separate from the expedition)

- A handful of small, decorative NPC workers wander inside the accessible settlement during Day. They provide life and humor, **not** a second player-controlled workforce.
- They have **no flag, work, income, AP cost, upkeep, LOS or persistent employment statistics**. They do not count toward the HQ's 3 functional workers, use worker slots, or change victory conditions.
- They may flee toward shelter at Dusk/when threatened and can be eaten if a mutant reaches them. Their death has **no economic, strategic or population penalty**, no replacement cost and no direct wave-balancing effect. Avoid using them as intentional mutant lures or allowing them to distort enemy pathfinding.
- They can be recreated as ambience on another Day. Keep their wandering bounded, lightweight and deterministic, with no independent gameplay clock.

#### 2A.3 Roads as expeditions and military infrastructure

- **DESIGN APPROVED / NOT VERIFIED AS IMPLEMENTED:** A player-built **Road tile costs 2 Credits and 0 AP**, replacing the currently implemented free-road cost. The automatic HQ road ring incurs no per-tile construction fee. Existing road connectivity, Factory/truck routing and gate rules stay unchanged.
- Constructed roads, including the HQ ring, give **1.2x movement speed** to **workers, Riflemen and Rocket Infantry** on the affected tiles. Open/dirt-path/jungle terrain remains **1.0x**; the naturally generated dirt track is a visual feature, not a road and gives no speed bonus. Truck speed and gate opening rules are unchanged unless a separate task approves a revision.
- Since workers and infantry share the existing walking/pathfinding machinery, the bonus should apply to both without duplicating the rules. Preserve deterministic sub-tile movement and gate handling.
- **Routing intent:** when both routes are viable, favor the route with the shortest estimated **travel time**, which can make a slightly longer road preferable to a direct cross-country shortcut. Do not silently replace the entire pathfinding engine to accomplish this; verify current routing first and isolate any required change.
- The road bonus shortens both the outward journey and the often more dangerous return journey. It does not remove the risk of late return.

#### 2A.4 Jungle work and Pollution (TASK 025.4B, not yet implemented)

- A functional worker only begins **CHOP CHOP** after arrival at the flag's work area; there is no automatic clearing on the way. Work consumes **configurable ticks per tile**, not an instant terrain change.
- Only jungle tiles within the fixed work radius may be cleared. A tile becomes buildable under normal placement rules only after completion. Multiple workers may cooperate/choose different tiles, but a tile may be completed and charged **once only**.
- **Clearing increases Pollution** via the existing pollution system; the per-tile amount, work duration, worker selection/coordination and whether partial work persists are **OPEN tuning/implementation details**. The agreed gameplay costs are expedition AP, travel time, work time and risk; no separate per-tree AP tax is currently approved.
- Robot squads may be sent directly to a distant mineral deposit once discovered and clear **only around it**, rather than being forced to carve a continuous road/cleared strip from HQ. The future **Mine** and its truck logistics will still require their own valid infrastructure/connectivity; no new deposit resource type is introduced here.
- At Dusk, abandon the active work, start automatic recall and stop generating clearing pollution for the rest of that shift. Night is for escape/survival, not continued work.

#### 2A.5 Validation and implementation boundaries

- Preserve the unchanged fixed-tick wave schedule for Night and the existing one-time Night settlement/AP reset invariants. Do not turn Day into a second combat wave or production-settlement period.
- Keep mobile two-tap building confirmation, camera alignment, FoW (real workers contribute LOS, ambient ones do not), and a visible Day/Dusk timer. Ambient animations must never consume the wave RNG sequence.
- Include explicit risk-based tests for phase transitions, END DAY step equivalence, physical worker recall, AP charges, no duplication, worker death/LOS, and the road bonus. When 025.4B begins, test tile-clearing idempotency and Pollution accounting.
- Do not automatically run full unit/E2E/soak suites. Follow the mandatory risk-based policy in CLAUDE.md and obtain explicit approval for wider runs.
- **TASK 025.4A is the time/lifecycle deliverable. TASK 025.4B is the clearing/Pollution deliverable.** Neither authorizes mining, repairs, Kill-bounty, dawn mutant retreat, newspapers, audio or general-purpose framework extraction.

## 3. World and camera

- **IMPLEMENTED graybox:** logical square grid with **32×32 game-world pixels per tile**, **48×32** cells on the jungle map and **24×16** on the original open map; other map dimensions (including 5×5 QA maps, 24×24 and 32×32) are future test/design options, not current production maps.
- **Styled top-down / oblique 2.5D:** normal square grid and collisions, but buildings display a roof, a short frontal face and shadow; no perspective rotation of map coordinates.
- One or more fixed/procedurally seeded resource deposits; mines require valid deposit locations. This creates a reason to expand beyond the protected HQ.
- Jungle trees occupy terrain cells and require clearing before industrial placement. Rivers and impassable terrain are blockers (exact map layout TBD).
- Building sprite footprint is decoupled from visual extents; art can extend above/below occupied cells.
- First build uses only colored rectangles, footprints, target markers and debug overlays. Commit to pixel art only after playtesting scale.

**Provisional footprints:**

| Structure | Footprint | Purpose |
|---|---|---|
| HQ (implemented) | 3×3 | Central command, critical loss condition; player-placed first, +20 power |
| Mine (planned) | 2×2 | Deposit-linked extraction / revenue |
| Refinery (planned) | 3×2 | Higher value output, high power/pollution |
| Factory (implemented) | 3×3 | Produces GOODS; earns up to 150 Credits a Night through truck deliveries |
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
| Minefield (optional) | tile / section | Consumable damage |
| Road | 1 tile | **Currently free; approved next cost 2 Credits / 0 AP**. Connects Factory docks to HQ; future movement bonus for workers and infantry. |

## 4. Building and input

**IMPLEMENTED construction:** instant construction constrained by Credits and AP, available during Day only. Placement previews show valid/invalid cells; attempts that fail validation do not change resources or occupancy. The older C&C-style commission/wait/ready-to-place queue is **DEFERRED** and must not be implemented without a new design decision. **An active Day timer is now explicitly approved** as a worker travel/work/return risk mechanism (Section 2A), not as a construction progress bar.

**AP baseline:** **5 AP** each Day; placing each implemented building costs **1 AP** except the HQ/walls/roads as specified; ON/OFF toggles cost **0 AP** in Day and Night. **Approved, not yet implemented:** one HQ worker expedition costs **1 AP per Day**; repositioning/recall is free; roads cost **2 Credits / 0 AP**. Worker clearing consumes work time (no per-tree AP), while repairs, queued construction and policy-change costs remain **PLANNED / OPEN**.

**Footprints:** placement must reject out-of-bounds, occupied, blocked terrain, wrong deposit and insufficient resources/AP without mutating the game state. Crew members never occupy structural grid cells: if a new building overlaps a wandering crew sprite, the NPC relocates to a valid adjacent location.

**Wall input (IMPLEMENTED, TASK 019; mobile behavior updated by TASK 024.1):** select the Wall tool, then preview a line or section by pressing/dragging; on mobile, confirmation is separate from the preview gesture. Each tile placement costs Credits and no AP. This supersedes the earlier section-with-confirm idea. Segments connecting visually by adjacency remain art work.

**Mobile-first controls:** tap to select building/tool, tap/drag to preview, explicit confirm/cancel; drag to pan (when not placing), pinch to zoom; choose generous hit targets despite small logical cells. Camera/position conversion must handle zoom and scaling. Desktop uses mouse/keyboard equivalents. Landscape is the intended game orientation.

## 5. Economy and power

**Core model:**
- **Credits:** construction, repairs and operational expenses.
- **Power:** generation, consumption, available reserve; not a transport network.
- **Pollution:** environmental cost and driver of night difficulty.
- **Corporate share:** headquarters retains a fixed or progressively changing portion of gross production. Only the foreman's allocated share is spendable.
- **Global climate index:** longer-term persistent escalation distinct from local pollution; exact formula deferred.

**IMPLEMENTED power management:** one global pool; no cables, priority tiers or automation. Each building has an **ON/OFF** choice available in both shifts. **Do not reject** switching ON merely because it creates a deficit: under a deficit, all enabled consumers become effectively unpowered (LOW_POWER or BLACKOUT), but their `enabled` flags remain unchanged. The player can restore NORMAL by reducing enabled demand or increasing supply. Power plant destruction must recalculate the same global rules when combat is introduced. This intentionally supersedes the earlier `INSUFFICIENT POWER` rejection idea. **OPEN balance question:** whether total-consumer shutdown is too punitive.

**IMPLEMENTED economic cadence (preserved by active-Day redesign):** no passive income during Day. The night settles **once at tick 3600**, using the enabled/powered state **at that final moment**, for both economic income and pollution. This is a deliberate graybox simplification, **not an anti-exploit solution**. **OPEN balance issue:** last-tick switching can grant a full night of income or avoid a full night of emissions. Consider time-weighted accounting only after basic combat and power-balancing playtests. The simultaneous Credits/Pollution settlement validates safe integers before committing either change.

## 6. Ecology, policies and threat

**IMPLEMENTED ecology baseline:** emissions are computed once at night-end from powered/enabled buildings: Power Plant **+12**, Factory **+8**, Outpost **0**. Pollution starts at zero, only increases, and has no natural decay. Current HUD shows Pollution and derived Threat. **Threat levels:** 0–24 → 1; 25–49 → 2; 50–99 → 3; ≥100 → 4. **NOT YET IMPLEMENTED:** terrain palette evolution, filters and waste treatment. Attack-budget scaling is already implemented in TASK 012A/015. Future treatment and filters may reduce net pollution at a power/money cost. Visual changes should prefer runtime tinting, overlay and limited tile replacements over separate full tilesets.

**Policy domains (first examples):**
- Waste disposal: river discharge (cheap / dirty) versus treatment (costly / cleaner).
- Emission standards: unfiltered chimneys versus paid filtration.
- Forest management: clear-cutting versus selective extraction / conservation.

Policy changes occur during day, spend AP, and generally persist until changed. Temporary **Papi directives** are a separate system, typically lasting 2–5 completed cycles; they are not part of baseline player policies. Only one disruptive directive should be active at once in early versions, with mandatory advance notice in the morning newspaper and clear HUD countdown. A directive must never create an unavoidable no-defense state: check whether viable alternatives are available.

**Threat formula:** the **implemented Threat Level** is the discrete derived indicator defined above. **IMPLEMENTED attack pressure** is the provisional TASK 012A and TASK 015 wave budget in the baseline above. Climate debt, final coefficients and unlock thresholds remain **OPEN**. Different enemy archetypes may later unlock at thresholds.

## 7. Defense, enemy AI and hardpoints

The player may choose exposed expansion (**overreach**) to maximize resource extraction, or clustered fortified bases/hardpoints to reduce defense perimeter. A **hardpoint is not a special building**: it is an emergent arrangement of walls, turrets, terrain and possibly guards. Avoid fake adjacency buffs.

**PLANNED target selection:** mutants prefer **power plants and HQ**, then refineries/mines; current Factory and Outpost must be given explicit provisional priorities in TASK 011A rather than silently being treated as canonically equivalent. Civilian crew are opportunistic prey when nearby. Turrets may become retaliation targets; walls become attackable obstacles when implemented. Combine target weight with reachable distance and deterministic tie-breaking / retarget hysteresis so enemies do not jitter. Different enemy types may override preferences. The temporary graybox rule is listed in the implemented baseline; the final algorithm and distance metric remain **OPEN**.

**Initial enemy taxonomy (future balance; the graybox basic mutant, the Spitter and the Brute exist, and the others are not implemented):**
- Small critter: about 8×8 px, quick, weak, appears in swarms.
- Spitter / medium: **implemented in TASK 022**, about 22 px so that it reads at mobile size, ranged.
- Brute: **implemented in TASK 023**, about 30 px so that it reads at mobile size, breaks through fortifications.
- Behemoth: 32 px and larger, eventual exceptional threat that justifies heavy weapons; not necessary for initial playable milestone.

**Defensive roles (PLANNED, not TASK 011A):** MG/autocannon for groups, heavy slow turret for large targets (minimum range and rotation/cooldown weaknesses if used), passive walls and single-use mines as late additions. Turrets require energy, repairs and construction cost. **Autocannon is a separate building, not an upgraded Outpost.** Bigger guns should not be universally optimal against small fast threats.

**Night pacing:** 60-second escalating sequence with sparse early pressure, more fronts mid-shift and climax late. Night must be interesting rather than just a minute of hands-off animation.

## 8. Civilian crew and guards (optional)

**AMBIENT CIVILIANS (DESIGN APPROVED / NOT VERIFIED AS IMPLEMENTED, TASK 025.4A):** Tiny non-commandable workers wander the settlement during active Day, optionally panic at Dusk or during an alarm, and can be eaten. They do not gather resources, produce money, cost AP/Credits, use functional worker slots, block construction, provide LOS or affect defeat conditions. Their death has no game-state/economic penalty and must not become a mutant-lure exploit. If the planned newspaper mentions them, those are flavor-only counts, never a workforce loss. **The controllable three-worker HQ expedition is a separate system** defined in Section 2A.

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
- Selecting a building exposes compact management controls such as `ONLINE/OFFLINE` without requiring a double tap; **mobile building placement** itself follows the implemented two-stage preview-and-confirm tap flow.
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

**MANDATORY workflow:** risk-based testing only, as recorded in `CLAUDE.md`. Choose targeted units/E2E based on changed code and risk. Full test suites, soaks or broad mutation campaigns require explicit approval; finishing a task is not sufficient justification. Existing production isolation and deterministic-QA guarantees remain mandatory.

**Testing layers:**
- Unit/property tests: arbitrary rectangular footprints, 5×5 grid boundaries, collisions, deletion reversibility, costs/AP rollback and fences.
- Playwright: actual clicks/taps on Phaser canvas and state assertion via snapshot; desktop mouse + mobile landscape touch emulation; zoom/pan, menu, newspaper scroll and dismissal.
- Deterministic simulation: stable update order, seeded RNG, fixed dt and explicit clock. No `Date.now()`/real timers in gameplay logic. Run full nights in seconds of test execution by advancing ticks, not waiting 60 s.
- Separate real mobile smoke pass for hit-target size, touch ergonomics, browser throttling and performance.

## 13. Scope plan and cut order

**P0: playable core (protect at all costs)** — **completed:** deterministic grid/footprints, instant placement, AP/Credits, Power Plant/Factory/Outpost, day/night, power, economic settlement, pollution and derived Threat, one mutant with damage/destruction, one separate defensive turret (Autocannon), pollution affecting attack pressure (provisional)., HQ/loss condition. **Remaining:** compact factual morning summary. **Trees and mine/deposits** remain design intent to prioritize or cut for the jam based on time.

**P1: game identity (strongly preferred; not yet implemented)** — full newspaper template with static contextual articles; basic Policies; terrain color evolution; more building/enemy roles; intuitive power ON/OFF and mobile landscape polish.

**P2: expandable if time remains (not yet implemented)** - mines (TASK 020, moved to the backlog); random Papi directives; heavy enemies/Behemoth; newspaper archive. Ambient civilians are now part of the approved TASK 025.4A design, not an unassigned P2 idea.

**Post-jam** — advanced enemy specializations, expanded industries, campaign/scenarios, complex directive sets, more troop roles, environmental simulation depth.

**Current task sequence (reports and design, not automatic permission to code):** TASKS 010-023 completed as recorded above; TASK 024 HUD/camera and 024.1 mobile two-step placement completed; TASK 025.1 bigger jungle world, 025.2 fog/outpost and 025.3 mobile workers reported completed; TASK 025.4A active Day / worker lifecycle **approved design, implementation not yet verified**; TASK 025.4B worker clearing / Pollution **next proposed stage, not yet implemented**; TASK 020 Mines and deposits remain backlog; repairs, newspaper, mutant sunrise retreat and balance follow only after explicit assignment. Artwork remains iterative and must not drive unauthorized mechanics.

**Milestone gates:**
1. **Graybox:** two building footprints, one resource, one defense and one attack wave work without art.
2. **Playable:** one full day/night/dawn cycle, basic power/pollution economy and losing conditions.
3. **Jam-ready:** complete loop, morning report, touch controls and repeatable QA tests.
4. **Polish:** cosmetic assets, content library, sound, extras only after readiness.

**Cut rule:** cut features, enemy varieties and art detail before compromising stability of the core loop. Avoid new mechanics during final week.

## 14. Open questions / graybox experiments

1. **Construction queue:** deferred after choosing instant AP/Credits construction; revisit only if the immediate-placement loop proves inadequate.
2. **AP granularity (DECIDED for worker clearing):** one daily worker expedition costs **1 AP**; moving/recalling its flag costs **0 AP**, and individual trees do **not** cost AP. Chopping time and Pollution per cleared tile remain provisional. This replaces the previous per-tree AP question.
3. **Power deficit:** implemented NORMAL / LOW_POWER / BLACKOUT with full consumer shutdown during deficit, preserving enabled flags. Playtest fairness; do not change it implicitly.
4. **Enemy pathing:** implemented for TASK 019 as direct steering plus a bounded search when a fortification blocks a step. A full flow field was not needed. The limits remain provisional.
5. **Balance:** is 60 seconds of night engaging with only automated turrets? Make waves meaningful, not punitive or idle.
6. **Production accounting:** Factory income now follows actual powered production and delivery (TASK 018), which closes the last-tick income exploit. Pollution still uses the final power state at night end, so that toggle issue remains.
7. **Softlocks:** prevent HQ spawns, tree layouts or resource placement from creating unwinnable starts.
8. **Technical/IP:** public repository can show PAPI-specific QA code, but avoid copying private starter code or asset packages unless licenses and redistribution rights permit.
9. **TASK 011A combat values:** coordinate system aligned to 32 px cells, mutant HP, building HP, target priority/tie-breaking, spawn cadence, approach to rectangular footprints, damage persistence and dawn cleanup were approved as temporary graybox values for TASK 011A (see the implemented baseline). Final combat balance remains **OPEN**.
10. **Autocannon footprint:** resolved as 1×1 for TASK 011B. Final turret balance remains **OPEN**.
11. **Economy safety:** `Economy.adjustCredits` historically validated the delta but not the resulting safe-integer balance; TASK 010 prevalidates night-end settlement specifically. Broader Economy hardening is separate work.
12. **Known balance issues (provisional, not final behavior):** TASK 015 ended the indefinite no-income turtle and one-cannon corner camp in scripted runs, but corners stay stronger than the centre. **At 1000 Credits, scripted industrial bases in the centre could perform worse than defensive turtles.** At 1250 Credits one scripted build queue improved from 5 to 28 of 30 runs alive after Night 20, but real play must confirm this. The Plant + Factory opening can now afford a Night 1 cannon, but a Plant + Factory opening without one remains exposed, HQ damage is permanent because repairs do not exist, and losing a Plant silences every cannon. Scripted results are evidence, not playtests; review this through real play before changing any other system.
13. **Starting budget (approved value, balance provisional):** the starting budget is **1250 Credits**. Power Plant (**500**) + Factory (**400**) + Autocannon (**250**) costs **1150**, so the first Day can include all three and leaves **100**. A no-income turtle can now buy three Autocannons and a Plant. Real gameplay will determine whether this opening is well balanced.
14. **Fortress benchmarks (historical, not targets):** the original PAPI FORTRESS 22 predates roads and cannot be built under the road rules, so it is kept as a historical combat benchmark in a world without roads, and it is stale for normal play. The road-legal variant from TASK 017 and the player-exported `fortress-corner-v1` both predate fixed docks, so they are stale too and are kept unchanged. None of these sets a required survival Night. A player-derived, logistics-compliant fortress will follow manual playtesting.
15. **Infantry balance (OPEN, scripted evidence only, see `npm run test:soak:infantry`):** on the real planner with no income and no player input, across 5 seeds, three cannons (750 Credits) fall at a median of Night 22. Two cannons and a Barracks (900) fall at Night 16, two Barracks with flags north and south of HQ (800) at Night 9, and one Barracks and one cannon (650) at Night 7. These runs never move a flag, which is what a squad is for, so they understate infantry. Even so, a static squad is much weaker than an Autocannon. **Soldiers rarely die in ordinary bases:** 3 lost of about 920 deployed across those scripted bases, because mutants at their targets are not lured and soldiers shoot from range. They do die on a lane: 8 of 16 against the heaviest wave. Barracks do not raise the wave budget, which Autocannons do. Real play must judge all of this before any value changes.
16. **Spitter balance (DECIDED: Spitter unchanged, scripted evidence plus one developer playtest, see `npm run test:soak:spitters`):** the developer playtested the Spitter and survived through **Day 40** with an actively managed, economically developed base, and decided to keep its stats and wave composition. The early fall of static, no-income bases is an accepted gameplay distinction, not a defect: with no income, repairs or rebuilding, the established 3-cannon turtles fall at a median of **Night 12 from the centre and 13 from corners**, against **20 and 24** on the same waves of ordinary mutants. This supersedes the Night 18-25 target of TASK 015 for bases facing Spitters; that target still describes ordinary waves alone. Most Spitters use all five shots unanswered, wear down the Plant, and its loss silences every cannon. A 3-cannon compact base falls at Night 12 against 21, and 6 cannons at 14 where every ordinary run survived 30 Nights. Walls help most: 3 cannons with 38 walls falls at 17 against 21. `fortress-checkerboard-v1` barely changes (median beyond Night 30 either way, 5 of 10 runs surviving against 8). A stand-in player moving the flag raises armed Spitters killed from 25 to 142 and cuts shell damage by 35%, but in that no-income base the median stays at Night 13. Day 40 is one playtest: context for later design, not a balance target or a pass condition.
17. **Brute balance (approved, provisional, scripted evidence plus developer playtests, see `npm run test:soak:brutes`):** from a whole `golden-fortress-day33-v2`, ordinary cannons kill nearly every Brute on Nights 30, 35 and 40, HQ takes no damage, and a Night costs about 1, 2 and 4 walls, plus about 1 building in 2 by Night 40. Brutes take 30% to 61% of all cannon shots, so ordinary mutants do up to five times the damage. With nobody playing, that fortress falls at a median of Night 37, where it used to outlast Night 45. No value has been tuned.
18. **Heavy weapons balance (approved, provisional, scripted evidence plus developer playtests, see `npm run test:soak:heavy`):** Developer playtests before these weapons: a passive fortress of three Factories and layered Walls with no guns failed against the first Brute wave, and FORTRESS OF POLAND (9 Autocannons, 2 Barracks, 2 Factories, 3 Plants, 320 of 320 power) reached Day 32 with active repairs and one more Autocannon. That supports the current Brute. In scripted runs, one Brute from the west dies at tick 872 to 5 cannons, 1360 to 1 Siege Cannon, 1337 to a Rocket squad and 858 to both, and a Rifle squad alone leaves it on 295 HP. On `golden-fortress-day33-v2`, the estimated rebuild bill for Night 40 falls from about 418 Credits as built to 178 with 1 Siege Cannon, 250 with a Rocket squad on a static flag, and 48 with both and a scripted flag. **Spitters, Nights 1-29:** a Siege Cannon spends 16% of its shots on them and cuts shots per Spitter from 4.65 to 3.49, and takes most armed kills when no squad is active, but a scripted flag keeps its value: it adds 2 Nights with or without a Siege Cannon. Scripted flags are stand-ins, not play. Real play must judge whether heavy weapons make Nights 35-40 too comfortable; no value has been tuned.
19. **Wave predictability (OPEN, not changed):** every production run uses the same RNG seed (731), so the same spawn order repeats: the first mutant always appears at the bottom-right, at border cell 22,15. Playtesting showed this allows a deliberately asymmetric defense. Review this when the Wave Director is next assigned.

## 15. Definition of done: first playable slice

- A 5×5 QA map and a larger normal map use the same placement rules.
- The player can clear terrain, order/place at least two differently sized structures, reject invalid placement and spend AP/Credits correctly.
- Power generation and consumption affect whether a turret can operate.
- One deterministic 60-second night wave can damage structures and end in victory or loss.
- Pollution changes risk in a verifiable way.
- A morning report eventually presents real results and transitions back to Day (**PLANNED**, not yet implemented).
- After TASK 025.4A, Day/Dusk/Night transitions preserve worker positions and worker risk; END DAY fast-forwards simulated ticks without teleporting or changing Night settlement cadence (**APPROVED DESIGN, not a current verified test result**).
- Desktop mouse and mobile landscape taps pass Playwright E2E; simulations pass headless tests.

> **PAPI INDUSTRIES:** Building Tomorrow with Yesterday's Ethics.
