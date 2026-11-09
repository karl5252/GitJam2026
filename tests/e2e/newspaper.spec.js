import {test, expect} from '@playwright/test';
import {body, byAction, clickAction, clickWorld, tapAction, tapWorld} from '../helpers/canvas.js';
import {cellCenter, hqFlow, qaSim, stepExactly} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';
import {LEADS} from '../../src/content/newspaperStories.js';

/**
 * TASK 029, LA VOZ DE SAN PAPI, on the map a new game gets, in the real ACTIVE
 * cycle, with the newspaper on ({news: true}) and no mutants.
 */

const mouse = {pressWorld: clickWorld, pressAction: clickAction};
const touch = {pressWorld: tapWorld, pressAction: tapAction};

const opened = async (page) => (await sample(page)).ui.newspaperOpen;
const shots = process.env.SHOTS ?? null;
const shoot = async (page, name) => {
    if (shots) await page.screenshot({path: `${shots}/${name}.png`});
};

/**
 * TASK 034: print the open paper as each issue of one round of leads (every lead once,
 * and every rotation of the world columns), measuring each as drawn: every text inside its
 * own region and above the footer, nothing cut with an ellipsis. Then it closes as ever.
 */
async function everyIssueFits(page, input, layout) {
    await toNightsEnd(page, input, 0);
    await expect.poll(() => opened(page)).toBe(true);
    for (let issue = 1; issue <= LEADS.length; issue++) {
        expect(await page.evaluate((n) => window.__qa.newspaper.preview(n), issue)).toBe(true);
        await expect.poll(async () => (await sample(page)).newspaperView.lead?.id).toBe(LEADS[issue - 1].id);
        const view = (await sample(page)).newspaperView;
        expect(view.layout).toBe(layout);
        expect(view.overflow, `issue ${issue}: ${view.lead.id}`).toEqual([]);
        expect(view.headline.replace(/\s+/g, ' ')).toBe(LEADS[issue - 1].headline);
        expect(view.story.replace(/\s+/g, ' ')).toBe(layout === 'touch' ? LEADS[issue - 1].brief : LEADS[issue - 1].body);
        if (['great-disarmament', 'banana-ketchup', 'defense-restoration'].includes(view.lead.id)) await shoot(page, `news-${layout}-${view.lead.id}`);
    }
    await input.pressAction(page, 'close-newspaper');
    await expect.poll(() => opened(page)).toBe(false);
}

/** HQ, END DAY, through Dusk and most of Night 1 with QA steps; the last ticks are left to the caller. */
async function toNightsEnd(page, input, leave = 50) {
    const flow = hqFlow(input);
    let s = await flow.start(page, '', {map: null, cycle: null, mutants: false, news: true});
    expect(await opened(page)).toBe(false); // Day 0 brings no newspaper
    await flow.buildHq(page, s, s.terrain.center);
    expect(await opened(page)).toBe(false);
    await input.pressAction(page, 'end-day');
    await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('dusk');
    await qaSim(page, 'pause');
    s = await sample(page);
    await stepExactly(page, s.shiftCycle.remainingDuskTicks + 1); // the last Dusk tick, then Night tick 1
    s = await sample(page);
    expect(s.shiftCycle.shift).toBe('night');
    await stepExactly(page, s.shiftCycle.remainingNightTicks - leave);
    return sample(page);
}

test.describe('newspaper: desktop', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('every issue of a round prints its decree, columns and notice in full, inside the page', async ({page}) => {
        test.setTimeout(60000);
        await everyIssueFits(page, mouse, 'desktop');
    });

    test('at 4x the dawn holds the Day at tick 0 behind La Voz; nothing else answers; CONTINUE starts the Day at 1x', async ({page}) => {
        test.setTimeout(60000);
        let s = await toNightsEnd(page, mouse);

        // The Night's last ticks in real time at 4x: 24 ticks a frame cross the dawn.
        await clickAction(page, 'speed-4');
        await expect.poll(async () => (await sample(page)).simulation.speed).toBe(4);
        await qaSim(page, 'resume');
        await expect.poll(() => opened(page), {timeout: 10000}).toBe(true);
        s = await sample(page);
        expect(s.shiftCycle).toMatchObject({shift: 'day', day: 2});
        expect(s.shiftCycle.elapsedDayTicks).toBe(0);
        const heldAt = s.simulation.tick;
        await page.waitForTimeout(500);
        s = await sample(page);
        expect(s.simulation.tick).toBe(heldAt);
        expect(s.simulation.paused).toBe(true);
        await expect(body(page)).toHaveAttribute('data-modal', 'newspaper');

        // The issue: this Day's number, Night 1's period, and Night 1's real figures.
        const view = s.newspaperView;
        expect(view).toMatchObject({open: true, reason: 'dawn', layout: 'desktop', issue: 1, night: 1, masthead: 'LA VOZ DE SAN PAPI'});
        expect(view.figures.find((line) => line.startsWith('Credits'))).toContain(String(s.settlement.creditsAfter));
        expect(s.newspaper.edition.issue).toBe(1);
        // El Papi's portrait, from the edition's asset id, at 2x in its frame, with its caption.
        expect(view.photo).toMatchObject({asset: 'el-papi', loaded: true, width: 128, height: 192, scale: 2, caption: 'HIS EXCELLENCY, EL PAPI'});

        // A blocking modal: the map, END DAY, the camera and the wheel do nothing.
        const zoom = s.camera.zoom;
        await clickWorld(page, cellCenter(s.grid, s.terrain.center), s);
        await clickAction(page, 'end-day');
        await clickAction(page, 'camera-zoom-in');
        await page.mouse.move(640, 360);
        await page.mouse.wheel(0, -300);
        await page.waitForTimeout(200);
        s = await sample(page);
        expect(s.selectedBuilding).toBe(null);
        expect(s.shiftCycle.shift).toBe('day');
        expect(s.camera.zoom).toBe(zoom);
        expect(s.ui.newspaperOpen).toBe(true);

        // CONTINUE: the Day runs, at 1x.
        await clickAction(page, 'close-newspaper');
        await expect.poll(() => opened(page)).toBe(false);
        await expect(body(page)).not.toHaveAttribute('data-modal', 'newspaper');
        s = await sample(page);
        expect(s.simulation.speed).toBe(1);
        await expect.poll(async () => (await sample(page)).shiftCycle.elapsedDayTicks).toBeGreaterThan(0);
    });

    test('READ LA VOZ reopens the same issue; it pauses a running Day and keeps a paused one paused', async ({page}) => {
        test.setTimeout(60000);
        await toNightsEnd(page, mouse, 0);
        await expect.poll(() => opened(page)).toBe(true);
        const first = (await sample(page)).newspaper.edition;
        await page.keyboard.press('Escape');
        await expect.poll(() => opened(page)).toBe(false);
        await expect.poll(async () => (await sample(page)).simulation.paused).toBe(false);
        await page.waitForTimeout(300); // the Day runs on before it is reopened

        // Running Day: READ LA VOZ pauses it; closing resumes it. Same edition, not a new one.
        await expect(byAction(page, 'show-report')).toHaveAttribute('aria-label', 'READ LA VOZ');
        await clickAction(page, 'show-report');
        await expect.poll(() => opened(page)).toBe(true);
        let s = await sample(page);
        expect(s.newspaper.reason).toBe('report');
        expect(s.newspaper.edition).toEqual(first);
        expect(s.simulation.paused).toBe(true);
        await clickAction(page, 'close-newspaper');
        await expect.poll(async () => (await sample(page)).simulation.paused).toBe(false);

        // Paused by the player: it stays paused after closing.
        await clickAction(page, 'day-pause');
        await expect.poll(async () => (await sample(page)).simulation.paused).toBe(true);
        await clickAction(page, 'show-report');
        await expect.poll(() => opened(page)).toBe(true);
        await clickAction(page, 'close-newspaper');
        await expect.poll(() => opened(page)).toBe(false);
        s = await sample(page);
        expect(s.simulation.paused).toBe(true);
        expect(s.settlementView.visible).toBe(true); // the desktop figures stay where they were
    });
});

for (const [label, viewport] of [['844x390', {width: 844, height: 390}], ['740x360', {width: 740, height: 360}]]) {
    test.describe(`newspaper: touch ${label}`, () => {
        test.use({viewport, hasTouch: true, isMobile: true});

        test('every issue of a round prints its decree brief in full on a phone', async ({page}) => {
            test.setTimeout(60000);
            await everyIssueFits(page, touch, 'touch');
        });

        test('the front page fits, reads, and CONTINUE and REPORT work by touch', async ({page}) => {
            test.setTimeout(60000);
            await toNightsEnd(page, touch, 0);
            await expect.poll(() => opened(page)).toBe(true);
            let s = await sample(page);
            expect(s.newspaperView.layout).toBe('touch');
            expect(s.newspaperView.minFontPx).toBeGreaterThanOrEqual(24); // 12 CSS px at 740x360
            expect(s.settlementView.visible).toBe(false); // the old box no longer opens at dawn
            expect(s.newspaperView.photo).toMatchObject({asset: 'el-papi', loaded: true, width: 192, height: 288, scale: 3});
            expect(s.newspaperView.photo.caption.replace(/\s+/g, ' ')).toBe('HIS EXCELLENCY, EL PAPI');
            const box = await byAction(page, 'close-newspaper').boundingBox();
            expect(box.width).toBeGreaterThanOrEqual(44);
            expect(box.height).toBeGreaterThanOrEqual(44);
            expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
            expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
            await tapAction(page, 'close-newspaper');
            await expect.poll(() => opened(page)).toBe(false);
            await tapAction(page, 'show-report');
            await expect.poll(() => opened(page)).toBe(true);
            s = await sample(page);
            expect(s.newspaper.reason).toBe('report');
            await tapAction(page, 'close-newspaper');
            await expect.poll(() => opened(page)).toBe(false);
        });
    });
}
