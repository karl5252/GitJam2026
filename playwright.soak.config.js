import {defineConfig} from '@playwright/test';

/**
 * Browser soak only: `npm run test:soak:browser`. Kept apart from the normal
 * E2E suite. One worker, because concurrent browsers would distort timing, and
 * its own port with no server reuse, so it can never attach to a dev server
 * that is already running.
 */
const PORT = 5175;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
    testDir: './tests/soak',
    testMatch: '*.spec.js',
    workers: 1,
    timeout: 240_000,
    webServer: {
        command: `npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 30_000,
    },
    use: {
        baseURL: BASE_URL,
        trace: 'off',
        viewport: {width: 1280, height: 720},
    },
});
