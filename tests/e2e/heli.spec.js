import {test, expect} from '@playwright/test';
import {body, clickAction, clickWorld, tapAction, tapWorld} from '../helpers/canvas.js';
import {hqFlow} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * TASK 035: the Day 1 Presidential helicopter on a real new game (the jungle map, the
 * ACTIVE cycle, Night 1's real wave). It never comes in Day 0, comes once when Day 1 is
 * free to show, holds the world without changing it, and gives the camera and input back.
 * SHOTS=<dir> saves pictures, among them the helicopter hovering over HQ.
 */

const mouse = {pressWorld: clickWorld, pressAction: clickAction};
const touch = {pressWorld: tapWorld, pressAction: tapAction};
const shots = process.env.SHOTS ?? null;
const shoot = async (page, name) => {
    if (shots) await page.screenshot({path: `${shots}/${name}.png`});
};
const heli = async (page) => (await sample(page)).heli;
const cellOf = (grid, {x, y}) => ({col: Math.floor((x - grid.originX) / grid.tileSize), row: Math.floor((y - grid.originY) / grid.tileSize)});
const NEW_GAME = {map: null, cycle: null, heli: true};
const FLIGHT = [2, 3, 4, 5, 6, 7];
const pose = ({zoom, x, y}) => ({zoom, x, y});

/** The first sample taken in a state: a fast flight is only briefly in each. */
async function sampleIn(page, state) {
    let found = null;
    await expect.poll(async () => {
        const s = await sample(page);
        if (s.heli?.state === state) found = s;
        return s.heli?.state;
    }, {intervals: [30]}).toBe(state);
    return found;
}

/** What the simulation is: anything the helicopter changed would show here. */
const simulation = (s) => JSON.stringify({
    tick: s.simulation.tick, steps: s.simulation.stepsExecuted, rng: s.simulation.rng, shift: s.shiftCycle,
    resources: s.resources, buildings: s.buildings, pollution: s.pollution, workers: s.workers, mutants: s.mutants,
    logistics: s.logistics, ecologists: s.ecologists ?? null,
});

/** Day 0 with HQ built where El Presidente stands (the clearing), as a new game plays it. */
async function day0(page, input, query = 'heliSpeed=3', options = {}) {
    const state = await hqFlow(input).start(page, query, {...NEW_GAME, ...options});
    await expect.poll(async () => (await sample(page)).president?.visible).toBe(true);
    await hqFlow(input).buildHq(page, state, cellOf(state.grid, (await sample(page)).president));
    return state;
}

/** END DAY, then QA steps through Dusk and Night 1 to Day 1's first tick, in one go: no frame runs between. */
async function throughNight1(page, input) {
    await input.pressAction(page, 'end-day');
    return page.evaluate(() => {
        window.__qa.sim.pause();
        const qa = () => window.__qa.getState();
        for (let i = 0; i < 40 && !(qa().shiftCycle.shift === 'day' && qa().shiftCycle.day === 2); i++) window.__qa.sim.stepTicks(240);
        return qa();
    });
}

test.describe('Presidential helicopter: desktop', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('none in Day 0, the cameo unchanged; once after Night 1 it visits HQ and leaves, the simulation untouched, the camera and input given back', async ({page}) => {
        test.setTimeout(60000);
        const state = await hqFlow(mouse).start(page, 'heliSpeed=3', NEW_GAME);
        await expect.poll(async () => (await sample(page)).president?.state).toBe('wander');
        await page.waitForTimeout(600);
        let s = await sample(page);
        expect(s.heli).toMatchObject({state: 'waiting', visible: false, drawn: null, actors: {heli: 0, president: 1}});
        expect(s.president.drawn.visible, 'El Presidente wanders Day 0 as before').toBe(true);
        expect(s.suspension.reasons).toEqual([]);
        await hqFlow(mouse).buildHq(page, state, cellOf(state.grid, s.president));
        expect((await heli(page)).state, 'nor once HQ stands').toBe('waiting');

        const dawn = await throughNight1(page, mouse);
        expect(dawn.shiftCycle).toMatchObject({shift: 'day', day: 2});
        expect(dawn.heli.state, 'Night 1 never had it').toBe('waiting');
        const before = pose(dawn.camera);

        const start = await sampleIn(page, 'camera-in');
        expect(start.suspension.reasons).toEqual(['cinematic']);
        expect(start.heli.camera.saved).toEqual(before);
        expect(start.president.state, 'El Presidente went into HQ at Dusk as before, and stays gone').toBe('gone');

        // Input means nothing while it flies.
        const hq = start.buildings.find((b) => b.type === 'hq');
        await clickWorld(page, {x: state.grid.originX + (hq.col + 1.5) * state.grid.tileSize, y: state.grid.originY + (hq.row + 1.5) * state.grid.tileSize}, state);
        s = await sampleIn(page, 'hover');
        expect(s.selectedBuilding, 'a press during the flight selects nothing').toBe(null);
        expect(s.heli.drawn).toMatchObject({visible: true, texture: 'papi-heli'});
        expect(FLIGHT).toContain(s.heli.drawn.frame);
        expect(s.heli.ground).toEqual(s.heli.route.pickup);
        const roof = {x: state.grid.originX + hq.col * state.grid.tileSize, y: state.grid.originY + hq.row * state.grid.tileSize, w: hq.width * state.grid.tileSize};
        expect(s.heli.ground.x).toBeGreaterThan(roof.x);
        expect(s.heli.ground.x).toBeLessThan(roof.x + roof.w);
        expect(s.heli.ground.y).toBeGreaterThan(roof.y);
        expect(s.heli.ground.y).toBeLessThan(roof.y + roof.w);
        expect(s.heli.actors, 'one helicopter, El Presidente hidden, nobody else').toEqual({heli: 1, president: 1});
        expect(s.president.visible).toBe(false);

        const end = await sampleIn(page, 'camera-out');
        expect(simulation(end), 'nothing simulated while it flew').toBe(simulation(start));
        expect(end.heli.collected).toBe(true);

        await expect.poll(async () => (await heli(page)).state).toBe('done');
        s = await sample(page);
        expect(s.suspension.reasons).toEqual([]);
        expect(pose(s.camera), 'the camera exactly as the player left it').toEqual(before);
        expect(s.heli.restored).toEqual(before);
        expect(s.heli.drawn).toBe(null);
        expect(s.heli.actors).toEqual({heli: 0, president: 1});
        expect(s.president.visible).toBe(false);
        expect(s.simulation.rng, 'the game\'s random numbers untouched').toEqual(start.simulation.rng);

        // Input works again: a press on HQ selects it.
        await clickWorld(page, {x: roof.x + roof.w / 2, y: roof.y + roof.w / 2}, state);
        await expect.poll(async () => (await sample(page)).selectedBuilding).toBe(hq.id);

        // Once a run: Night 2 and Day 2 never bring it back.
        await page.evaluate(() => {
            window.__qa.sim.pause();
            for (let i = 0; i < 70 && window.__qa.getState().shiftCycle.day < 3; i++) window.__qa.sim.stepTicks(240);
        });
        await page.waitForTimeout(400);
        s = await sample(page);
        expect(s.shiftCycle.day).toBe(3);
        expect(s.heli.state).toBe('done');
        expect(s.heli.actors.heli).toBe(0);
    });

    test('it waits for the book to close, and the BUILD drawer holds the flight still while the rotor turns', async ({page}) => {
        test.setTimeout(60000);
        await day0(page, mouse);
        await clickAction(page, 'end-day');
        await page.evaluate(() => window.__qa.sim.pause());
        await clickAction(page, 'open-manual');
        const dawn = await page.evaluate(() => {
            const qa = () => window.__qa.getState();
            for (let i = 0; i < 40 && !(qa().shiftCycle.shift === 'day' && qa().shiftCycle.day === 2); i++) window.__qa.sim.stepTicks(240);
            return qa();
        });
        expect(dawn.shiftCycle.day).toBe(2);
        await page.waitForTimeout(800);
        let s = await sample(page);
        expect(s.heli.state, 'never behind an open book').toBe('waiting');
        expect(s.suspension.reasons).toEqual(['manual']);
        await clickAction(page, 'close-manual');
        await expect.poll(async () => (await heli(page)).state, {intervals: [40]}).toBe('approach');

        await clickAction(page, 'open-build'); // the HUD's own drawer still opens: it holds the flight
        await expect.poll(async () => (await sample(page)).suspension.reasons).toEqual(['build', 'cinematic']);
        const held = await heli(page);
        const frames = new Set();
        for (let i = 0; i < 8; i++) {
            await page.waitForTimeout(90);
            const h = await heli(page);
            expect([h.state, h.progress, h.x, h.y]).toEqual([held.state, held.progress, held.x, held.y]);
            frames.add(h.drawn.frame);
        }
        expect(frames.size, 'the rotor keeps turning').toBeGreaterThan(1);
        for (const f of frames) expect(FLIGHT).toContain(f);
        await clickAction(page, 'open-build');
        await expect.poll(async () => (await heli(page)).state, {timeout: 10000}).toBe('done');
        expect((await sample(page)).suspension.reasons).toEqual([]);
    });

    test('with La Voz at dawn it waits for CONTINUE, then flies', async ({page}) => {
        test.setTimeout(60000);
        await day0(page, mouse, 'heliSpeed=3', {news: true});
        await throughNight1(page, mouse);
        await expect.poll(async () => (await sample(page)).newspaper?.open).toBe(true);
        await page.waitForTimeout(600);
        expect((await heli(page)).state).toBe('waiting');
        await clickAction(page, 'close-newspaper');
        await expect.poll(async () => (await heli(page)).state).not.toBe('waiting');
        await expect.poll(async () => (await heli(page)).state, {timeout: 10000}).toBe('done');
        const s = await sample(page);
        expect(s.suspension.reasons).toEqual([]);
        expect(s.newspaper.open).toBe(false);
    });

    test('the run it never reaches Day 1 it never comes; RESTART and START bring a fresh one, waiting', async ({page}) => {
        test.setTimeout(60000);
        const state = await hqFlow(mouse).start(page, 'waveBudget=20&heliSpeed=3', NEW_GAME);
        await hqFlow(mouse).buildHq(page, state, cellOf(state.grid, (await sample(page)).president));
        await clickAction(page, 'end-day');
        const shift = await page.evaluate(() => {
            window.__qa.sim.pause();
            for (let i = 0; i < 600 && window.__qa.getState().shiftCycle.shift !== 'defeated'; i++) window.__qa.sim.stepTicks(240);
            return window.__qa.getState().shiftCycle.shift;
        });
        expect(shift).toBe('defeated');
        await expect.poll(async () => (await heli(page)).state).toBe('skipped');
        expect((await heli(page)).actors.heli).toBe(0);
        await clickAction(page, 'restart');
        await expect(body(page)).toHaveAttribute('data-phase', 'ready');
        await expect.poll(async () => (await sample(page)).heli).toBe(null);
        await clickAction(page, 'start');
        await expect.poll(async () => (await heli(page))?.state).toBe('waiting');
        const s = await sample(page);
        expect(s.heli.actors).toEqual({heli: 0, president: 1});
        expect(s.suspension.reasons).toEqual([]);
    });

    test('at its own speed: the helicopter hovering over HQ (screenshot)', async ({page}) => {
        test.setTimeout(60000);
        await day0(page, mouse, '');
        await throughNight1(page, mouse);
        await expect.poll(async () => (await heli(page)).state, {timeout: 10000}).toBe('hover');
        await page.waitForTimeout(300);
        await shoot(page, 'heli-desktop-hover');
        const h = await heli(page);
        expect(h.drawn.visible).toBe(true);
        await expect.poll(async () => (await heli(page)).state, {timeout: 15000}).toBe('done');
    });
});

test.describe('Presidential helicopter: touch 844x390', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});

    test('on a phone it visits once and gives the camera back exactly', async ({page}) => {
        test.setTimeout(60000);
        await day0(page, touch);
        const dawn = await throughNight1(page, touch);
        const before = pose(dawn.camera);
        await expect.poll(async () => (await heli(page)).state, {intervals: [40]}).toBe('hover');
        await shoot(page, 'heli-touch-hover');
        await expect.poll(async () => (await heli(page)).state, {timeout: 10000}).toBe('done');
        const s = await sample(page);
        expect(pose(s.camera)).toEqual(before);
        expect(s.suspension.reasons).toEqual([]);
        expect(s.heli.actors.heli).toBe(0);
    });
});
