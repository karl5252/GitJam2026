import {test, expect} from '@playwright/test';
import {body, boot, byAction, clickAction, clickWorld, tapAction} from '../helpers/canvas.js';
import {cellCenter, hqFlow, qaSim} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';
import {buildingRow, contents, manualPages} from '../../src/content/fieldManual.js';

/**
 * TASK 033.1: THE LITTLE YELLOW BOOK. From the main menu and the rail, its contents and
 * pages, Escape, the `manual` hold on the world, and the book's isolation from the game.
 * SHOTS=<dir> also saves screenshots of the cover and a chapter page on each layout.
 */

const mouse = {pressWorld: clickWorld, pressAction: clickAction};
const touch = {pressWorld: null, pressAction: tapAction};
const shots = process.env.SHOTS ?? null;
const shoot = async (page, name) => {
    if (shots) await page.screenshot({path: `${shots}/${name}.png`});
};
const PAGES = manualPages();
const CONTENTS = contents(PAGES);
const book = async (page) => (await sample(page)).fieldManualView;
const reasons = async (page) => (await sample(page)).suspension.reasons;
const tick = async (page) => (await sample(page)).simulation.tick;
const overlaps = (p, q) => p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;

/** Turn every page with NEXT, as a reader would, checking each one fits. */
async function readEveryPage(page, press, {minFont}) {
    const first = await book(page);
    expect(first.page).toBe(0);
    for (let i = 0; i < PAGES.length; i++) {
        const view = await book(page);
        expect(view.page, 'the page turned').toBe(i);
        expect(view.kind).toBe(PAGES[i].kind);
        expect(view.overflow, `page ${i} (${view.heading}) fits on ${view.layout}`).toEqual([]);
        expect(view.minFontPx, `page ${i} is legible`).toBeGreaterThanOrEqual(minFont);
        if (i < PAGES.length - 1) {
            await press(page, 'manual-next');
            await expect.poll(async () => (await book(page)).page).toBe(i + 1);
        } else {
            await expect(byAction(page, 'manual-next')).toHaveCount(0); // the last page has no NEXT
        }
    }
}

/** A running timed Day in the ACTIVE cycle, as in hud-overhaul.spec.js. */
async function runningDay(page) {
    const flow = hqFlow(mouse);
    const state = await flow.start(page, '', {cycle: null, mutants: false});
    await flow.buildHq(page, state, {col: 6, row: 6});
    await clickAction(page, 'end-day');
    await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('dusk');
    await qaSim(page, 'pause');
    await page.evaluate(() => {
        for (let i = 0; i < 40 && window.__qa.getState().shiftCycle.shift !== 'day'; i++) window.__qa.sim.stepTicks(240);
    });
    await expect.poll(async () => (await sample(page)).simulation.paused).toBe(false);
    return state;
}

async function expectFrozen(page) {
    const before = await sample(page);
    await page.waitForTimeout(400);
    const after = await sample(page);
    expect(after.simulation.tick).toBe(before.simulation.tick);
    expect(after.shiftCycle).toEqual(before.shiftCycle);
    return after.simulation.tick;
}

const expectRunning = async (page, from) => expect.poll(() => tick(page)).toBeGreaterThan(from);

/** The Cannons page as drawn: both guns from frame 5, each fitted by that frame's own bounds. */
async function expectCannonPlates(page) {
    await expect.poll(async () => (await book(page)).heading).toBe('Cannons');
    const {art} = await book(page);
    expect(art.find((a) => a.kind === 'autocannon')).toEqual({kind: 'autocannon', frame: 5, bounds: {x: 1, y: 5, width: 26, height: 23}});
    expect(art.find((a) => a.kind === 'siegeCannon')).toEqual({kind: 'siegeCannon', frame: 5, bounds: {x: 3, y: 6, width: 26, height: 26}});
}

/** The menu's BOOK, START and SOUND: one row of HUD buttons, one height, apart, START still centred. */
async function expectMenuRow(page, viewport, minCss) {
    const row = await Promise.all(['open-manual', 'start', 'toggle-sound'].map(async (action) => ({action, box: await byAction(page, action).boundingBox()})));
    for (const {action, box} of row) {
        expect(box, action).not.toBeNull();
        expect(box.height, `${action} height`).toBeCloseTo(row[1].box.height, 0);
        expect(box.y, `${action} on START's line`).toBeCloseTo(row[1].box.y, 0);
        expect(box.height, `${action} big enough`).toBeGreaterThanOrEqual(minCss);
        expect(box.y + box.height, `${action} on screen`).toBeLessThanOrEqual(viewport.height + 0.5);
    }
    expect(overlaps(row[0].box, row[1].box) || overlaps(row[1].box, row[2].box)).toBe(false);
    const canvas = await page.locator('canvas').boundingBox();
    expect(row[1].box.x + row[1].box.width / 2).toBeCloseTo(canvas.x + canvas.width / 2, 0);
    const views = (await sample(page)).ui;
    expect(views.startVisible).toBe(true);
}

test.describe('THE LITTLE YELLOW BOOK: desktop', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('the main menu\'s BOOK, START and SOUND are one row of HUD buttons, and START still starts', async ({page}) => {
        await boot(page, {scene: 'game', waitForQA: true, audio: true});
        await expectMenuRow(page, {width: 1280, height: 720}, 44);
        await page.waitForTimeout(300);
        await shoot(page, 'menu-desktop-sound');
        await clickAction(page, 'toggle-sound');
        await expect(byAction(page, 'toggle-sound')).toHaveAttribute('data-enabled', 'false');
        await clickAction(page, 'toggle-sound');
        await expect(byAction(page, 'toggle-sound')).toHaveAttribute('data-enabled', 'true');
        await clickAction(page, 'start');
        await expect(body(page)).toHaveAttribute('data-phase', 'started');
        await expect(byAction(page, 'toggle-sound')).toHaveCount(0); // the menu's controls go with it
        expect((await sample(page)).ui.startVisible).toBe(false);
    });

    test('opens from the main menu before a game starts: contents, chapters, PREV/NEXT, arrows, Escape, then START still works', async ({page}) => {
        await boot(page, {scene: 'game', waitForQA: true});
        let s = await sample(page);
        expect(s.phase).toBe('ready');
        expect(s.ui.manualButtonVisible).toBe(true);
        await page.waitForTimeout(300); // let the office settle for the picture
        await shoot(page, 'menu-desktop');
        await clickAction(page, 'open-manual');
        await expect.poll(async () => (await sample(page)).ui.manualOpen).toBe(true);
        await expect(body(page)).toHaveAttribute('data-modal', 'manual');
        expect(await reasons(page)).toEqual(['manual']);
        let view = await book(page);
        expect(view).toMatchObject({kind: 'contents', page: 0, layout: 'desktop'});
        expect(view.contents.map((row) => row.id)).toEqual(['republic', 'workers', 'industry', 'mining', 'military', 'environment']);
        await expect(byAction(page, 'manual-prev')).toHaveCount(0); // nothing before the cover
        await shoot(page, 'manual-desktop-cover');

        const industry = CONTENTS.find((c) => c.id === 'industry');
        await clickAction(page, 'manual-chapter-industry');
        await expect.poll(async () => (await book(page)).page).toBe(industry.page);
        view = await book(page);
        expect(view).toMatchObject({kind: 'chapter', chapter: 'industry'});
        await clickAction(page, 'manual-next');
        await expect.poll(async () => (await book(page)).page).toBe(industry.page + 1);
        await clickAction(page, 'manual-prev');
        await expect.poll(async () => (await book(page)).page).toBe(industry.page);
        await page.keyboard.press('ArrowRight');
        await expect.poll(async () => (await book(page)).page).toBe(industry.page + 1);
        await page.keyboard.press('ArrowLeft');
        await expect.poll(async () => (await book(page)).page).toBe(industry.page);
        await clickAction(page, 'manual-contents');
        await expect.poll(async () => (await book(page)).page).toBe(0);

        await page.keyboard.press('Escape');
        await expect.poll(async () => (await sample(page)).ui.manualOpen).toBe(false);
        expect(await reasons(page)).toEqual([]);
        await expect(body(page)).not.toHaveAttribute('data-modal', 'manual');
        await expect(byAction(page, 'close-manual')).toHaveCount(0);

        await clickAction(page, 'start');
        await expect(body(page)).toHaveAttribute('data-phase', 'started');
        s = await sample(page);
        expect(s.ui.manualButtonVisible, 'the rail has its own `i`').toBe(true);
        expect(s.ui.manualOpen).toBe(false);
    });

    test('every page fits the desktop book, and the tables are the buildings\' real figures', async ({page}) => {
        test.setTimeout(45000); // reads all sixteen pages
        await boot(page, {scene: 'game', waitForQA: true});
        await clickAction(page, 'open-manual');
        await expect.poll(async () => (await sample(page)).ui.manualOpen).toBe(true);
        await readEveryPage(page, clickAction, {minFont: 13});
        // The Factory's page shows the Factory's row exactly as buildingTypes makes it.
        const factory = PAGES.findIndex((p) => p.table?.rows.some((row) => row[0] === 'Factory'));
        await clickAction(page, 'manual-contents');
        await clickAction(page, 'manual-chapter-industry');
        while ((await book(page)).page < factory) await clickAction(page, 'manual-next');
        const shown = (await book(page)).text.join('\n');
        for (const cell of buildingRow('factory')) expect(shown).toContain(cell);
        await shoot(page, 'manual-desktop-factory');
        // The Cannons page: the Autocannon from frame 5, fitted by that frame's bounds; the Siege Cannon as before.
        await clickAction(page, 'manual-contents');
        await clickAction(page, 'manual-chapter-military');
        await expectCannonPlates(page);
        await shoot(page, 'manual-desktop-autocannon');
        await clickAction(page, 'close-manual');
        await expect.poll(async () => (await sample(page)).ui.manualOpen).toBe(false);
    });

    test('in a running Day the book holds the world from the same tick, keeps 4x and a manual PAUSE, and Escape closes only the book', async ({page}) => {
        test.setTimeout(45000);
        await runningDay(page);
        await expectRunning(page, await tick(page));

        // 1x: frozen while open, and the reading time is never made up after.
        await clickAction(page, 'open-manual');
        expect(await reasons(page)).toEqual(['manual']);
        const held = await expectFrozen(page);
        await clickAction(page, 'close-manual');
        expect(await reasons(page)).toEqual([]);
        expect(await tick(page)).toBeLessThanOrEqual(held + 24); // a frame or so, as BUILD's hold
        await expectRunning(page, held);

        // 4x: held, and still 4x after.
        await clickAction(page, 'day-speed');
        await clickAction(page, 'day-speed');
        await expect.poll(async () => (await sample(page)).simulation.speed).toBe(4);
        await clickAction(page, 'open-manual');
        const fast = await expectFrozen(page);
        expect((await sample(page)).simulation.speed).toBe(4);
        await clickAction(page, 'close-manual');
        await expectRunning(page, fast);
        expect((await sample(page)).simulation.speed).toBe(4);

        // The player's PAUSE is the clock's; the book never touches it.
        await clickAction(page, 'day-pause');
        await expect.poll(async () => (await sample(page)).simulation.paused).toBe(true);
        await clickAction(page, 'open-manual');
        await clickAction(page, 'close-manual');
        expect(await reasons(page)).toEqual([]);
        await expectFrozen(page);
        expect((await sample(page)).dayTimeView.pause).toBe('PLAY');
        await clickAction(page, 'day-pause');

        // Placing a wall: Escape closes the book and leaves placement alone; the next Escape cancels it.
        await clickAction(page, 'build-wall');
        await expect.poll(async () => (await sample(page)).placement.selectedType).toBe('wall');
        await clickAction(page, 'open-manual');
        await expect.poll(async () => (await sample(page)).ui.manualOpen).toBe(true);
        await page.keyboard.press('Escape');
        await expect.poll(async () => (await sample(page)).ui.manualOpen).toBe(false);
        let s = await sample(page);
        expect(s.placement.selectedType, 'Escape went to the book only').toBe('wall');
        expect(s.suspension.reasons).toEqual([]);
        await page.keyboard.press('Escape');
        await expect.poll(async () => (await sample(page)).placement.selectedType).toBe(null);

        // BUILD open, then the book: the drawer closes and lets go, and only the book holds.
        await clickAction(page, 'open-build');
        expect(await reasons(page)).toEqual(['build']);
        await clickAction(page, 'open-manual');
        s = await sample(page);
        expect(s.ui.drawerOpen).toBe(false);
        expect(s.suspension.reasons).toEqual(['manual']);
        await clickAction(page, 'close-manual');
        expect(await reasons(page)).toEqual([]);
    });

    test('reading the book changes nothing in the game, and no press, wheel or arrow reaches the world through it', async ({page}) => {
        test.setTimeout(45000); // reads to the last page
        const flow = hqFlow(mouse);
        const state = await flow.start(page, 'mutants=off');
        await flow.buildHq(page, state, {col: 6, row: 6});
        await clickAction(page, 'build-wall');
        await expect.poll(async () => (await sample(page)).placement.selectedType).toBe('wall');
        const keep = (s) => ({
            buildings: s.buildings, resources: s.resources, roads: s.roads, simulation: s.simulation, shiftCycle: s.shiftCycle,
            pollution: s.pollution, camera: s.camera, selectedBuilding: s.selectedBuilding, selectedType: s.placement.selectedType,
        });
        const before = keep(await sample(page));

        await clickAction(page, 'open-manual');
        await expect.poll(async () => (await sample(page)).ui.manualOpen).toBe(true);
        // A wall's worth of presses on open ground and one on HQ, through the book. The book
        // takes them (one may land on a contents entry and turn a page); the world never does.
        for (const cell of [{col: 12, row: 3}, {col: 13, row: 3}, {col: 7, row: 7}]) await clickWorld(page, cellCenter(state.grid, cell), state);
        const at = await (async () => {
            const canvas = await page.locator('canvas').boundingBox();
            return {x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2};
        })();
        await page.mouse.move(at.x, at.y);
        await page.mouse.wheel(0, -400);
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('ArrowDown');
        expect((await sample(page)).ui.manualOpen, 'still open: nothing under it was pressed').toBe(true);
        while (await byAction(page, 'manual-next').count() > 0) await clickAction(page, 'manual-next'); // read to the end
        expect((await book(page)).page).toBe(PAGES.length - 1);
        await page.waitForTimeout(150);
        expect(keep(await sample(page)), 'nothing changed while the book was open').toEqual(before);
        await clickAction(page, 'close-manual');
        await expect.poll(async () => (await sample(page)).ui.manualOpen).toBe(false);
        expect(keep(await sample(page)), 'nor by closing it').toEqual(before);
    });
});

for (const viewport of [{width: 844, height: 390}, {width: 740, height: 360}]) {
    test.describe(`THE LITTLE YELLOW BOOK: touch ${viewport.width}x${viewport.height}`, () => {
        test.use({viewport, hasTouch: true, isMobile: true});
        const MIN = 44;
        const big = async (page, actions) => {
            for (const action of actions) {
                const box = await byAction(page, action).boundingBox();
                expect(box, action).not.toBeNull();
                expect(box.width, `${action} width`).toBeGreaterThanOrEqual(MIN);
                expect(box.height, `${action} height`).toBeGreaterThanOrEqual(MIN);
                expect(box.x + box.width, `${action} on screen`).toBeLessThanOrEqual(viewport.width + 0.5);
                expect(box.y + box.height, `${action} on screen`).toBeLessThanOrEqual(viewport.height + 0.5);
            }
        };

        test('the menu row is one height and big enough to tap', async ({page}) => {
            await boot(page, {scene: 'game', waitForQA: true, audio: true});
            await expectMenuRow(page, viewport, MIN);
            if (viewport.width === 844) {
                await page.waitForTimeout(300);
                await shoot(page, 'menu-touch-sound');
            }
        });

        test('from the menu: big enough to tap, every page fits with text at least 24 px, and CLOSE lets go', async ({page}) => {
            test.setTimeout(45000); // reads all sixteen pages
            await boot(page, {scene: 'game', waitForQA: true});
            expect((await sample(page)).ui.layout).toBe('touch');
            await big(page, ['open-manual']);
            if (viewport.width === 844) {
                await page.waitForTimeout(300);
                await shoot(page, 'menu-touch');
            }
            await tapAction(page, 'open-manual');
            await expect.poll(async () => (await sample(page)).ui.manualOpen).toBe(true);
            expect((await book(page)).layout).toBe('touch');
            await big(page, ['close-manual', 'manual-next', ...CONTENTS.map(({id}) => `manual-chapter-${id}`)]);
            if (viewport.width === 844) await shoot(page, 'manual-touch-cover');
            await tapAction(page, 'manual-chapter-military');
            await expect.poll(async () => (await book(page)).chapter).toBe('military');
            await expectCannonPlates(page);
            await big(page, ['manual-contents', 'manual-prev', 'manual-next', 'close-manual']);
            if (viewport.width === 844) await shoot(page, 'manual-touch-military');
            await tapAction(page, 'manual-contents');
            await expect.poll(async () => (await book(page)).page).toBe(0);
            await readEveryPage(page, tapAction, {minFont: 24});
            await tapAction(page, 'close-manual');
            await expect.poll(async () => (await sample(page)).ui.manualOpen).toBe(false);
            expect(await reasons(page)).toEqual([]);
        });

        test('in a game: the rail\'s `i` is big enough, clear of BUILD, REPORT and END DAY, and holds the world only while open', async ({page}) => {
            const flow = hqFlow(touch);
            await flow.start(page, 'mutants=off');
            await big(page, ['open-manual', 'open-build', 'end-day']);
            const boxes = await Promise.all(['open-manual', 'open-build', 'end-day'].map((a) => byAction(page, a).boundingBox()));
            expect(overlaps(boxes[0], boxes[1])).toBe(false);
            expect(overlaps(boxes[0], boxes[2])).toBe(false);
            await tapAction(page, 'open-manual');
            await expect.poll(async () => (await sample(page)).ui.manualOpen).toBe(true);
            expect(await reasons(page)).toEqual(['manual']);
            await tapAction(page, 'close-manual');
            await expect.poll(async () => (await sample(page)).ui.manualOpen).toBe(false);
            expect(await reasons(page)).toEqual([]);
        });
    });
}
