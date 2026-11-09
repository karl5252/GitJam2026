import {test, expect} from '@playwright/test';

// A browser that already allows autoplay on this site: audio is unlocked before
// the game has finished creating its scene, which once meant music was never requested.
test.use({viewport: {width: 1280, height: 720}, launchOptions: {args: ['--autoplay-policy=no-user-gesture-required']}});

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

    test.describe('audible music: autoplay already allowed', () => {

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

