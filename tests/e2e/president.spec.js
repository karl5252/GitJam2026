import {test, expect} from '@playwright/test';
import {body, clickAction, clickWorld, tapAction, tapWorld} from '../helpers/canvas.js';
import {hqFlow, qaSim} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * TASK 033.2: El Presidente's Day 0 cameo on a real new game (the jungle map, the ACTIVE
 * cycle). He wanders by Day 0, stands still while the world is held, keeps off HQ, runs
 * for HQ's door at Dusk and is gone before Night, and starts afresh after a restart.
 * SHOTS=<dir> saves pictures.
 */

const mouse = {pressWorld: clickWorld, pressAction: clickAction};
const touch = {pressWorld: tapWorld, pressAction: tapAction};
const shots = process.env.SHOTS ?? null;
const shoot = async (page, name) => {
    if (shots) await page.screenshot({path: `${shots}/${name}.png`});
};
const president = async (page) => (await sample(page)).president;
const cellOf = (grid, {x, y}) => ({col: Math.floor((x - grid.originX) / grid.tileSize), row: Math.floor((y - grid.originY) / grid.tileSize)});
const inside = ({x, y}, r) => x > r.x && x < r.x + r.width && y > r.y && y < r.y + r.height;
const hqRect = (grid, hq) => ({x: grid.originX + hq.col * grid.tileSize, y: grid.originY + hq.row * grid.tileSize, width: hq.width * grid.tileSize, height: hq.height * grid.tileSize});
const NEW_GAME = {map: null, cycle: null, mutants: false};

/** Day 0 on a new game, with El Presidente in view. */
async function day0(page, input) {
    const state = await hqFlow(input).start(page, '', NEW_GAME);
    await expect.poll(async () => (await president(page))?.visible).toBe(true);
    return state;
}

/** HQ on the tile he stands on, through the real menu and placement. */
async function hqOnHim(page, input, state) {
    const at = cellOf(state.grid, await president(page));
    await hqFlow(input).buildHq(page, state, at);
    const s = await sample(page);
    const hq = s.buildings.find((b) => b.type === 'hq');
    return {hq, rect: hqRect(state.grid, hq), at};
}

test.describe('El Presidente: desktop', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('Day 0: he appears in the clearing, drawn from his own sheet, wanders and pauses, and the game does not tick for him', async ({page}) => {
        await day0(page, mouse);
        const first = await president(page);
        expect(first).toMatchObject({state: 'wander', visible: true});
        expect(first.drawn).toMatchObject({visible: true, texture: 'papi-art-elcolonel'});
        const before = await sample(page);
        await expect.poll(async () => {
            const p = await president(page);
            return Math.hypot(p.x - first.x, p.y - first.y) > 2 || p.activity !== first.activity;
        }, {timeout: 9000}).toBe(true);
        await shoot(page, 'president-desktop-day0');
        const after = await sample(page);
        expect(after.simulation.tick, 'Day 0 never ticks, El Presidente or not').toBe(before.simulation.tick);
        expect(after.simulation.rng).toEqual(before.simulation.rng);
        expect([0, 1, 4, 5, 8, 9, 10, 11]).toContain(after.president.drawn.frame);
    });

    test('BUILD, AUDIO and the book hold him still with the world; he moves again after', async ({page}) => {
        test.setTimeout(45000);
        await day0(page, mouse);
        const still = async () => {
            const a = await president(page);
            await page.waitForTimeout(700);
            const b = await president(page);
            expect([b.x, b.y, b.frame, b.activity]).toEqual([a.x, a.y, a.frame, a.activity]);
        };
        await clickAction(page, 'open-build');
        await still();
        await clickAction(page, 'open-build');
        await clickAction(page, 'open-manual');
        await still();
        await clickAction(page, 'close-manual');
        expect((await sample(page)).suspension.reasons).toEqual([]);
        const from = await president(page);
        await expect.poll(async () => JSON.stringify(await president(page)) !== JSON.stringify(from), {timeout: 9000}).toBe(true);
    });

    test('HQ placed right on him is placed as usual; he steps out of its door and keeps off it, then at Dusk runs in and is gone before Night', async ({page}) => {
        test.setTimeout(45000);
        const state = await day0(page, mouse);
        const {hq, rect, at} = await hqOnHim(page, mouse, state);
        expect(hq, 'placement is unaffected by him').toBeTruthy();
        expect([hq.col + 1, hq.row + 1]).toEqual([at.col, at.row]); // centred on his tile
        await expect.poll(async () => inside(await president(page), rect)).toBe(false);
        for (let i = 0; i < 6; i++) {
            expect(inside(await president(page), rect), 'never on HQ').toBe(false);
            await page.waitForTimeout(250);
        }
        await shoot(page, 'president-desktop-hq');

        await clickAction(page, 'end-day');
        await qaSim(page, 'pause'); // QA holds the simulation in Dusk; he runs on presentation time
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('dusk');
        await expect.poll(async () => (await president(page)).state).not.toBe('wander');
        const running = await president(page);
        if (running.state === 'retreat') {
            expect(running.route.at(-1)).toEqual({x: rect.x + rect.width / 2, y: rect.y + rect.height});
        }
        await expect.poll(async () => (await president(page)).state, {timeout: 5000}).toBe('gone');
        const s = await sample(page);
        expect(s.shiftCycle.shift, 'gone while it is still Dusk').toBe('dusk');
        expect(s.president.drawn.visible).toBe(false);
        await page.evaluate(() => {
            for (let i = 0; i < 4 && window.__qa.getState().shiftCycle.shift !== 'night'; i++) window.__qa.sim.stepTicks(240);
        });
        expect((await sample(page)).shiftCycle.shift).toBe('night');
        expect((await president(page)).visible).toBe(false);
    });

    test('a Dusk that ends before he arrives hides him at once; Night never waits for him', async ({page}) => {
        const state = await day0(page, mouse);
        await hqFlow(mouse).buildHq(page, state, cellOf(state.grid, await president(page)));
        await clickAction(page, 'end-day');
        // Straight through Dusk in one call, before a single presentation frame can bring him home.
        const shift = await page.evaluate(() => {
            window.__qa.sim.pause();
            for (let i = 0; i < 4 && window.__qa.getState().shiftCycle.shift !== 'night'; i++) window.__qa.sim.stepTicks(240);
            return window.__qa.getState().shiftCycle.shift;
        });
        expect(shift).toBe('night');
        await expect.poll(async () => (await president(page)).state).toBe('gone');
        const p = await president(page);
        expect([p.visible, p.drawn.visible, p.dust.length]).toEqual([false, false, 0]);
    });

    test('after a defeat, RESTART and START bring a fresh El Presidente back to the clearing', async ({page}) => {
        test.setTimeout(60000);
        const state = await hqFlow(mouse).start(page, 'waveBudget=20', {map: null, cycle: null});
        await hqFlow(mouse).buildHq(page, state, cellOf(state.grid, await president(page)));
        await clickAction(page, 'end-day');
        const shift = await page.evaluate(() => {
            window.__qa.sim.pause();
            for (let i = 0; i < 600 && window.__qa.getState().shiftCycle.shift !== 'defeated'; i++) window.__qa.sim.stepTicks(240);
            return window.__qa.getState().shiftCycle.shift;
        });
        expect(shift).toBe('defeated');
        expect((await president(page)).visible).toBe(false);
        await clickAction(page, 'restart');
        await expect(body(page)).toHaveAttribute('data-phase', 'ready');
        await expect.poll(async () => (await sample(page)).president, {message: 'the title has no El Presidente'}).toBe(null);
        await clickAction(page, 'start');
        await expect.poll(async () => (await president(page))?.state).toBe('wander');
        const fresh = await president(page);
        expect(fresh.drawn.visible).toBe(true);
        expect(fresh.dust).toEqual([]);
        expect(Math.hypot(fresh.x - fresh.anchor.x, fresh.y - fresh.anchor.y)).toBeLessThanOrEqual(81);
    });
});

test.describe('El Presidente: touch 844x390', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});

    test('he wanders on a phone; HQ by two taps on his tile is placed as usual; Dusk sends him home before Night', async ({page}) => {
        test.setTimeout(45000);
        const state = await day0(page, touch);
        expect((await sample(page)).ui.layout).toBe('touch');
        await shoot(page, 'president-touch-day0');
        const {hq, rect} = await hqOnHim(page, touch, state);
        expect(hq).toBeTruthy();
        await expect.poll(async () => inside(await president(page), rect)).toBe(false);
        await tapAction(page, 'end-day');
        await qaSim(page, 'pause');
        await expect.poll(async () => (await president(page)).state, {timeout: 5000}).toBe('gone');
        expect((await sample(page)).shiftCycle.shift).toBe('dusk');
    });
});
