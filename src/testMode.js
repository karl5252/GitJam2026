/**
 * Single source of truth for the test harness flag.
 *
 * import.meta.env.DEV is statically replaced by Vite at build time, so in
 * a production build (`vite build`, mode: production) this whole
 * expression folds to the literal `false` — and every branch guarded by
 * TEST_MODE, including the URLSearchParams call, is dead code Rollup/Terser
 * can drop from the bundle. This is stronger than gating on the query
 * param alone: someone appending ?testMode to a shipped itch.io build
 * cannot turn this on, because the check never runs at all in that build.
 *
 * `npm run dev` sets DEV to true, so ?testMode works there and in
 * Playwright's webServer (which runs `npm run dev`, not a built preview).
 */
export const TEST_MODE =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).has('testMode');
