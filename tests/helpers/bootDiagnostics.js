/**
 * Failure-only diagnostics for boot(). While a page boots, this keeps a small
 * in-memory timeline of what the browser reported. If boot succeeds, it is
 * thrown away with no output and no added waits. If boot fails, the timeline
 * and a snapshot of the page are attached to the test, and the caller rethrows
 * the original error, so a diagnostics problem can never hide a real failure.
 *
 * It exists to explain a rare boot timeout where data-scene never appeared.
 * It changes no timeouts and retries nothing.
 */

const MAX_EVENTS = 200;
const MAX_TEXT = 200;
const SNAPSHOT_LIMIT_MS = 2000;
const FRAME_PROBE_MS = 500;

const trim = (text) => String(text).replace(/\u001b\[[0-9;]*m/g, '').slice(0, MAX_TEXT);

/**
 * Start recording. Call stop() when boot ends, whatever the outcome.
 * @param {import('@playwright/test').Page} page
 */
export function watchBoot(page) {
    const startedAt = Date.now();
    const events = [];
    const pending = new Set();
    let dropped = 0;

    const note = (type, detail = '') => {
        if (events.length >= MAX_EVENTS) {
            dropped++;
            return;
        }
        events.push({ms: Date.now() - startedAt, type, detail: trim(detail)});
    };

    const handlers = {
        console: (message) => {
            if (['error', 'warning'].includes(message.type())) note(`console.${message.type()}`, message.text());
        },
        pageerror: (error) => note('pageerror', error.message),
        request: (request) => pending.add(request),
        requestfinished: (request) => pending.delete(request),
        requestfailed: (request) => {
            pending.delete(request);
            note('requestfailed', `${request.url()} ${request.failure()?.errorText ?? ''}`);
        },
        response: (response) => {
            if (response.status() >= 400) note('http-error', `${response.status()} ${response.url()}`);
        },
        domcontentloaded: () => note('domcontentloaded'),
        load: () => note('load'),
        framenavigated: (frame) => {
            if (frame === page.mainFrame()) note('navigated', frame.url());
        },
        crash: () => note('crash'),
        close: () => note('close'),
    };
    for (const [name, handler] of Object.entries(handlers)) page.on(name, handler);

    return {
        /** Detached record of everything seen so far. */
        report() {
            return {
                elapsedMs: Date.now() - startedAt,
                events: [...events],
                droppedEvents: dropped,
                pendingRequests: [...pending].slice(0, 50).map((request) => trim(request.url())),
            };
        },
        stop() {
            for (const [name, handler] of Object.entries(handlers)) page.off(name, handler);
        },
    };
}

/** Runs in the page. Bounded by its own frame probe. */
async function pageSnapshot(frameProbeMs) {
    const frameFired = await new Promise((resolve) => {
        requestAnimationFrame(() => resolve(true));
        setTimeout(() => resolve(false), frameProbeMs);
    });
    const resources = performance.getEntriesByType('resource');
    let webgl;
    try {
        webgl = Boolean(document.createElement('canvas').getContext('webgl'));
    } catch {
        webgl = false;
    }
    return {
        url: location.href,
        readyState: document.readyState,
        visibility: document.visibilityState,
        canvas: Boolean(document.querySelector('canvas')),
        bodyData: {...document.body?.dataset},
        qaSurface: typeof window.__qa,
        frameFired,
        webgl,
        resourceCount: resources.length,
        lastResources: resources.slice(-5).map((entry) => entry.name),
    };
}

/** Never throws, and never waits longer than SNAPSHOT_LIMIT_MS. */
async function safeSnapshot(page) {
    let timer;
    const limit = new Promise((resolve) => {
        timer = setTimeout(() => resolve({unavailable: 'snapshot timed out'}), SNAPSHOT_LIMIT_MS);
    });
    try {
        return await Promise.race([page.evaluate(pageSnapshot, FRAME_PROBE_MS), limit]);
    } catch (error) {
        return {unavailable: trim(error.message)};
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Attach the diagnostics to a failed boot. Failures here are swallowed on
 * purpose: the caller must always be able to rethrow the original error.
 * @param {{page, watch: ReturnType<typeof watchBoot>, error: Error, testInfo?: {attach: Function}}} input
 */
export async function attachBootDiagnostics({page, watch, error, testInfo}) {
    try {
        const body = JSON.stringify({
            error: trim(error?.message?.split('\n')[0] ?? error),
            ...watch.report(),
            page: await safeSnapshot(page),
        }, null, 2);
        await testInfo?.attach('boot-diagnostics.json', {body, contentType: 'application/json'});
    } catch {
        // The original failure matters more than its diagnostics.
    }
}
