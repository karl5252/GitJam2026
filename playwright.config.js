import {defineConfig} from '@playwright/test';

const PORT = 5173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 15_000,
    fullyParallel: true,
    webServer: {
        // Same dev server as `npm run dev` — no separate test build/mode.
        // TEST_MODE is toggled purely by the ?testMode query param below.
        command: `npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 20_000,
    },
    use: {
        baseURL: BASE_URL,
    },
});
