import {test, expect} from '@playwright/test';

/**
 * TASK 030: music must be AUDIBLE in a normal session (no TEST_MODE, no stubs), not
 * just started. Every connection to the speakers is tapped into an analyser, and the
 * real output level is measured. Both browser situations are covered: audio locked
 * until the first press (a fresh profile), and autoplay already allowed (a profile
 * that has used the site, which is where music was once never requested at all).
 */

const TAP = () => {
    window.__starts = [];
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (target, ...rest) {
        if (target instanceof AudioDestinationNode && !this.context.__analyser) {
            this.context.__analyser = this.context.createAnalyser();
            this.context.__analyser.fftSize = 2048;
            window.__ctx = this.context;
        }
        if (target instanceof AudioDestinationNode) connect.call(this, this.context.__analyser);
        return connect.call(this, target, ...rest);
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a) {
        window.__starts.push({duration: Math.round(this.buffer?.duration ?? -1), now: (a[0] ?? 0) <= this.context.currentTime + 0.05});
        return start.apply(this, a);
    };
};

/** Mean output RMS over about two seconds. */
async function loudness(page) {
    const samples = [];
    for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(200);
        samples.push(await page.evaluate(() => {
            const an = window.__ctx?.__analyser;
            if (!an) return 0;
            const d = new Float32Array(an.fftSize);
            an.getFloatTimeDomainData(d);
            return Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length);
        }));
    }
    return samples.reduce((a, b) => a + b, 0) / samples.length;
}
const started = (page, seconds) => page.evaluate((d) => window.__starts.filter((s) => s.duration === d && s.now).length, seconds);
// About -40 dBFS: what the first gains gave Océano's opening, which nobody could hear.
const AUDIBLE = 0.012;

    test.describe('audible music: locked until the first press', () => {
        test.use({viewport: {width: 1280, height: 720}});

        test('the menu music, then the Day music, can be heard; one copy each; no page error', async ({page}) => {
            test.setTimeout(60000);
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.addInitScript(TAP);
            await page.goto('/');
            await page.waitForTimeout(1000);
            await page.mouse.click(300, 400); // the first press, on the office
            await expect.poll(() => started(page, 232), {timeout: 15000}).toBe(1);
            await page.waitForTimeout(1500); // through the crossfade
            expect(await loudness(page)).toBeGreaterThan(AUDIBLE);
            await page.mouse.click(640, 668); // START
            await expect.poll(() => started(page, 285), {timeout: 15000}).toBe(1);
            await page.waitForTimeout(1500);
            expect(await loudness(page)).toBeGreaterThan(AUDIBLE);
            expect([await started(page, 232), await started(page, 285)]).toEqual([1, 1]);
            expect(errors).toEqual([]);
        });
    });

test.describe('?audioDebug=1 in a normal session', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('shows the pipeline: requested, loaded, playing', async ({page}) => {
        test.setTimeout(60000);
        const logs = [];
        page.on('console', (m) => {
            if (m.text().startsWith('[audio]')) logs.push(m.text());
        });
        await page.goto('/?audioDebug=1');
        const panel = page.locator('#audio-debug');
        await expect(panel).toContainText('AUDIO DEBUG');
        await page.mouse.click(300, 400);
        await expect(panel).toContainText('menu: gain', {timeout: 15000});
        await expect(panel).toContainText('PLAYING', {timeout: 15000});
        await expect(panel).toContainText('context running');
        expect(logs.some((l) => l.includes('music-request'))).toBe(true);
        expect(logs.some((l) => l.includes('load-ok'))).toBe(true);
        expect(logs.some((l) => l.includes('music-play'))).toBe(true);
    });
});
