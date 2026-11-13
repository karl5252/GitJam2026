# PAPI Industries: The Green Shift

> **100 days. One glorious industrial complex. A president who is never wrong.**

**PAPI Industries: The Green Shift** is a browser-based industrial strategy and base-defense game created by **Wee Games Studio** for **GitHub Game Off 2026** (theme: **SHIFT**).

Welcome to the Republic of **San Papi**, where every problem has an industrial solution and every government report confirms another historic success.

Your assignment is simple: transform a patch of jungle into a profitable industrial complex, keep the trucks moving, defend your workers, and survive **100 days** of presidential ambition. The jungle, the mutants, and the Ministry of Truth may have other plans.

*"Progress is inevitable. Your survival is a separate matter."*

<!-- Add the actual gameplay GIF once it has been committed to the repository.
     Example: ![From clearing to industrial complex](docs/media/papi-timelapse.gif)
     Do not leave a broken image reference in the published README. -->

## The glorious assignment

- **Build an industry:** place factories, mines, power plants, roads, and defenses. Connect production to HQ so trucks can deliver exports and earn Credits.
- **Manage your shifts:** spend Action Points wisely, expand during the Day, and survive increasingly dangerous Nights.
- **Clear the jungle:** send workers to open land for construction, repair damaged facilities, and keep vital routes accessible.
- **Defend the Republic:** use walls, gates, Autocannons, Siege Cannons, and rifle or rocket squads against mutant attacks.
- **Pay the price of progress:** pollution raises the threat, ecologists interfere with deliveries, and loudspeakers promote the official version of events.
- **Read the news:** *La Voz de San Papi* and the **Little Banana-Yellow Book** offer invaluable guidance, as approved by the authorities.

## How to play

1. **Start on Day 0.** Place your **HQ** in the clearing, then plan your first factories, roads, power supply, and defenses. There is no Day 0 time limit.
2. **Connect the economy.** Factories and mines need suitable road access to HQ. Trucks generate Credits by completing deliveries.
3. **Send workers out during the Day.** Move their work flag to clear jungle or assign repairs to damaged buildings. Leave room for workers to reach what they need to repair.
4. **Prepare for Night.** Mutants attack after dusk. Most building and worker orders are unavailable at Night, so plan ahead.
5. **Survive to Day 100.** If your HQ falls, the campaign ends.

**Controls:** use the on-screen buttons and **BUILD** menu to give orders. On desktop, click to select and place; drag while building roads or walls, drag with the right/middle mouse button to pan, and use the mouse wheel to zoom. On touch devices, placement uses a preview followed by confirmation; drag/pinch to navigate. **Mobile play requires landscape orientation.**

For full instructions, open the **Little Banana-Yellow Book** from the office menu.

## Save & Continue

The campaign saves a local checkpoint at **dawn**, when *La Voz* opens. **CONTINUE** restores that checkpoint in the same browser and on the same device.

- One local campaign save; no cloud synchronization.
- Closing the game partway through a Day or Night may require replaying from the previous dawn.
- Starting a new campaign replaces the existing local save after confirmation.

## Run locally

The game uses **Phaser 4**, **JavaScript**, and **Vite**.

```bash
npm install
npm run dev
```

Create a production build with `npm run build` and preview it with `npm run preview`.

### Testing

The project includes a deterministic simulation and an automated QA surface, with Node.js unit tests and Playwright browser tests.

```bash
npm test
npm run test:smoke
```

Run the appropriate targeted tests for the change being made; a full regression is not required for every cosmetic update.

## Credits & development disclosure

**Created and directed by Wee Games Studio.**

- **Game concept, systems design, writing, art direction, pixel-art creation and editing, integration, playtesting, and QA:** Wee Games Studio.
- **Programming assistance:** Claude (Anthropic), used to generate and revise code under developer direction, review, and testing.
- **Voice production:** ElevenLabs, used as part of the game's audio production workflow.
- **Engine and tooling:** Phaser 4, Vite, and Playwright.
- **Additional artwork, sound effects, music, and other third-party material:** used under their respective licenses, where applicable. Individual credits and required attributions should be included according to those licenses.

AI tools assisted development. The game's design decisions, creative direction, visual editing, integration, and testing were carried out by its creator. AI assistance does not imply that the repository or its assets are free to reuse.

## Copyright & permitted use

**Copyright © 2026 Wee Games Studio. All rights reserved.**

**This game is source-available, not open-source.** Source availability is provided for transparency, review, and participation in GitHub Game Off 2026. No license is granted to copy, adapt, modify, redistribute, republish, rehost, sell, sublicense, or incorporate the project's original code, artwork, animations, audio, writing, or other protected material into another work without prior written permission from the relevant rights holder, except where applicable law permits otherwise.

The game may be played through its official distribution pages. Public access to this repository does **not** make its contents public domain. GitHub's Terms of Service may separately permit certain platform functions, including viewing and forking public repositories.

Third-party components and licensed assets remain subject to their own licenses. **See [LICENSE](LICENSE)** for the repository's rights notice.

---

*Issued by the Ministry of Industrial Excellence. Approved by El Presidente Papi. Accuracy not independently verified.* 🍌
