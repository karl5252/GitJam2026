import {test, expect} from '@playwright/test';
import {byAction, clickAction, clickWorld, tapAction, tapOnce, tapWorld, worldToScreen} from '../helpers/canvas.js';
import {cellCenter, hqFlow} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';
import {inViewport, worldToScreen as project} from '../../src/scenes/cameraView.js';

/**
 * Building with a finger: a ghost appears, taps and drags move it, and only a
 * separate tap inside it spends anything. What is under test uses tapOnce, a single
 * real tap, so nothing hides behind tapWorld, which plays both taps. HQ is centred
 * on 12,8, its ring on 10-14, 6-10, with a Plant at 20,3 unless a test says otherwise.
 */

const HQ = {col: 12, row: 8};
const touch = {pressWorld: tapWorld, pressAction: tapAction};
const GREEN = 0x4caf50;
const RED = 0xe53935;

/** HQ and a Plant, then the whole map in view. */
async function base(page, query = 'mutants=off') {
    const {start, buildHq, place} = hqFlow(touch);
    const state = await start(page, query);
    await buildHq(page, state, HQ);
    await place(page, state, 'powerPlant', {col: 20, row: 3});
    await tapAction(page, 'camera-fit');
    return state;
}

const tile = (page, state, cell) => tapOnce(page, cellCenter(state.grid, cell), state);
const ghost = async (page) => (await sample(page)).ghost;
const spent = async (page) => {
    const {resources, buildings} = await sample(page);
    return {resources, count: buildings.length};
};

async function choose(page, type) {
    await tapAction(page, `build-${type}`);
    await expect.poll(async () => (await ghost(page)).active).toBe(true);
}

/** Real fingers, frame by frame, in page pixels. */
async function drag(page, state, cells) {
    const client = await page.context().newCDPSession(page);
    const at = (cell) => worldToScreen(page, cellCenter(state.grid, cell), state);
    await client.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [await at(cells[0])]});
    for (const cell of cells.slice(1)) {
        await client.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [await at(cell)]});
        await page.waitForTimeout(30);
    }
    await client.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await page.waitForTimeout(60);
}

/** Two fingers from a pair of points to another pair. */
async function twoFingers(page, frames) {
    const client = await page.context().newCDPSession(page);
    const points = (list) => list.map(([x, y], id) => ({x, y, id}));
    for (const [i, frame] of frames.entries()) {
        await client.send('Input.dispatchTouchEvent', {type: i === 0 ? 'touchStart' : 'touchMove', touchPoints: points(frame)});
        await page.waitForTimeout(30);
    }
    await client.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await page.waitForTimeout(60);
}

for (const [name, viewport] of [['844x390', {width: 844, height: 390}], ['740x360', {width: 740, height: 360}]]) {
    test.describe(`touch placement ${name}`, () => {
        test.use({viewport, hasTouch: true, isMobile: true});

        test('choosing a building shows its ghost at once, in view, on a tile it can use', async ({page}) => {
            await base(page);
            const before = await spent(page);
            await choose(page, 'factory');
            const s = await sample(page);
            expect(s.previewView.visible).toBe(true);
            expect(s.ghost.cell).not.toBeNull();
            expect(s.ghost.ok).toBe(true);
            expect(await spent(page)).toEqual(before);
        });

        test('the first ghost is in view however the camera stands', async ({page}) => {
            const state = await base(page);
            await tapAction(page, 'camera-zoom-in');
            await tapAction(page, 'camera-zoom-in');
            await tapAction(page, 'camera-zoom-in');
            await choose(page, 'outpost');
            const {camera, ghost: {cell}} = await sample(page);
            expect(camera.zoom).toBeGreaterThan(camera.fitZoom);
            expect(inViewport(camera.viewport, project(camera, camera.viewport, cellCenter(state.grid, cell)))).toBe(true);
        });

        test('a first tap moves the ghost and builds nothing', async ({page}) => {
            const state = await base(page);
            const before = await spent(page);
            await choose(page, 'outpost');
            await tile(page, state, {col: 4, row: 4});
            await expect.poll(async () => (await ghost(page)).cell).toEqual({col: 4, row: 4});
            const s = await sample(page);
            expect(s.previewView).toMatchObject({visible: true, fillColor: GREEN});
            expect(await spent(page)).toEqual(before);
        });

        test('a drag moves the ghost, and letting go builds nothing', async ({page}) => {
            const state = await base(page);
            const before = await spent(page);
            await choose(page, 'outpost');
            await drag(page, state, [{col: 4, row: 4}, {col: 5, row: 4}, {col: 7, row: 5}]);
            expect((await ghost(page)).cell).toEqual({col: 7, row: 5});
            expect(await spent(page)).toEqual(before);
        });

        test('a drag that starts on the ghost carries it, and still builds nothing', async ({page}) => {
            const state = await base(page);
            const before = await spent(page);
            await choose(page, 'outpost');
            await tile(page, state, {col: 4, row: 4});
            await expect.poll(async () => (await ghost(page)).cell).toEqual({col: 4, row: 4});
            await drag(page, state, [{col: 4, row: 4}, {col: 6, row: 4}]);
            expect((await ghost(page)).cell).toEqual({col: 6, row: 4});
            expect(await spent(page)).toEqual(before);
        });

        test('a separate tap inside the footprint builds exactly once, and pays once', async ({page}) => {
            const state = await base(page);
            await page.evaluate(() => window.__qa.economy.setCredits(2000));
            const before = await spent(page);
            await choose(page, 'autocannon');
            await tile(page, state, {col: 4, row: 4});
            await expect.poll(async () => (await ghost(page)).cell).toEqual({col: 4, row: 4});
            await tile(page, state, {col: 4, row: 4});
            await expect.poll(async () => (await sample(page)).buildings.length).toBe(before.count + 1);
            const s = await sample(page);
            expect(s.buildings.at(-1)).toMatchObject({type: 'autocannon', col: 4, row: 4});
            expect(s.resources).toEqual({credits: before.resources.credits - 250, ap: before.resources.ap - 1});
            // A stray extra tap finds an occupied tile: red, refused and free.
            await tile(page, state, {col: 4, row: 4});
            await expect.poll(async () => (await ghost(page)).last).toBe('refused');
            expect((await sample(page)).buildings).toHaveLength(before.count + 1);
            expect((await sample(page)).resources.credits).toBe(before.resources.credits - 250);
        });

        test('anywhere inside a large ghost confirms it, where the ghost is', async ({page}) => {
            const state = await base(page);
            await page.evaluate(() => window.__qa.economy.setCredits(2000));
            await choose(page, 'powerPlant');
            const {count} = await spent(page);
            await tile(page, state, {col: 5, row: 5});
            await expect.poll(async () => (await ghost(page)).cell).toEqual({col: 5, row: 5});
            await tile(page, state, {col: 6, row: 6}); // a corner of the 3x3
            await expect.poll(async () => (await sample(page)).buildings.length).toBe(count + 1);
            expect((await sample(page)).buildings.at(-1)).toMatchObject({type: 'powerPlant', col: 4, row: 4});
        });

        test('a tap outside the ghost moves it instead of building', async ({page}) => {
            const state = await base(page);
            const before = await spent(page);
            await choose(page, 'outpost');
            await tile(page, state, {col: 4, row: 4});
            await expect.poll(async () => (await ghost(page)).cell).toEqual({col: 4, row: 4});
            await tile(page, state, {col: 7, row: 12});
            await expect.poll(async () => (await ghost(page)).cell).toEqual({col: 7, row: 12});
            expect(await spent(page)).toEqual(before);
        });

        test('an invalid spot is red and cannot be confirmed', async ({page}) => {
            const state = await base(page);
            const before = await spent(page);
            await choose(page, 'outpost');
            await tile(page, state, HQ);
            await expect.poll(async () => (await ghost(page)).cell).toEqual(HQ);
            expect((await sample(page)).previewView).toMatchObject({visible: true, fillColor: RED});
            expect((await ghost(page)).ok).toBe(false);
            await tile(page, state, HQ);
            await expect.poll(async () => (await ghost(page)).last).toBe('refused');
            expect(await spent(page)).toEqual(before);
        });

        test('Cancel and another building discard the ghost and spend nothing', async ({page}) => {
            const state = await base(page);
            const before = await spent(page);
            await choose(page, 'outpost');
            await tile(page, state, {col: 4, row: 4});
            await expect.poll(async () => (await ghost(page)).cell).toEqual({col: 4, row: 4});
            await tapAction(page, 'build-wall'); // another building
            await expect.poll(async () => (await sample(page)).placement.selectedType).toBe('wall');
            expect((await ghost(page)).cell).toBeNull();
            await tapAction(page, 'cancel-placement');
            await expect.poll(async () => (await ghost(page)).active).toBe(false);
            const s = await sample(page);
            expect(s.previewView.visible).toBe(false);
            expect(await spent(page)).toEqual(before);
        });

        test('a wall segment stays a proposal until a separate tap, then pays for every tile at once', async ({page}) => {
            const state = await base(page);
            const before = await spent(page);
            await choose(page, 'wall');
            await drag(page, state, [{col: 3, row: 3}, {col: 4, row: 3}, {col: 6, row: 3}]);
            const proposed = (await ghost(page)).segment;
            expect(proposed.map(({col, ok}) => [col, ok])).toEqual([[3, true], [4, true], [5, true], [6, true]]);
            expect(await spent(page)).toEqual(before);

            await tile(page, state, {col: 5, row: 3});
            await expect.poll(async () => (await sample(page)).buildings.length).toBe(before.count + 4);
            const s = await sample(page);
            expect(s.resources.credits).toBe(before.resources.credits - 100);
            expect(s.ghost.segment).toEqual([]);
            expect(s.placement.selectedType).toBe('wall');
        });

        test('going back along a segment shortens it, and Cancel throws it away for free', async ({page}) => {
            const state = await base(page);
            const before = await spent(page);
            await choose(page, 'wall');
            await drag(page, state, [{col: 3, row: 3}, {col: 6, row: 3}, {col: 4, row: 3}]);
            expect((await ghost(page)).segment.map(({col}) => col)).toEqual([3, 4]);
            await tapAction(page, 'cancel-placement');
            await expect.poll(async () => (await ghost(page)).active).toBe(false);
            expect(await spent(page)).toEqual(before);
        });

        test('a road segment needs a confirming tap too, and may be drawn towards the network', async ({page}) => {
            const state = await base(page);
            await tapAction(page, 'build-road');
            await expect.poll(async () => (await ghost(page)).active).toBe(true);
            const roads = async () => (await sample(page)).roads.tiles.length;
            const before = await roads();

            // Nowhere near the network: red, and a confirming tap lays nothing.
            await drag(page, state, [{col: 2, row: 2}, {col: 2, row: 3}, {col: 2, row: 4}]);
            expect((await ghost(page)).segment.map(({ok}) => ok)).toEqual([false, false, false]);
            await tile(page, state, {col: 2, row: 3});
            await expect.poll(async () => (await ghost(page)).last).toBe('refused');
            expect(await roads()).toBe(before);

            // Drawn towards the network, so its far end only connects once the near end is laid.
            await drag(page, state, [{col: 7, row: 8}, {col: 8, row: 8}, {col: 9, row: 8}]);
            expect((await ghost(page)).segment.map(({col, ok}) => [col, ok])).toEqual([[7, true], [8, true], [9, true]]);
            expect(await roads()).toBe(before);
            await tile(page, state, {col: 8, row: 8});
            await expect.poll(roads).toBe(before + 3);
            expect((await sample(page)).roadMode).toBe(true);

            // Cancel discards the next one.
            await drag(page, state, [{col: 6, row: 8}, {col: 5, row: 8}]);
            expect(await roads()).toBe(before + 3);
            await tapAction(page, 'cancel-placement');
            await expect.poll(async () => (await sample(page)).roadMode).toBe(false);
            expect(await roads()).toBe(before + 3);
        });

        test('a pinch or a pan during placement builds nothing and leaves the ghost on its tile', async ({page}) => {
            const state = await base(page);
            const before = await spent(page);
            await choose(page, 'outpost');
            await tile(page, state, {col: 12, row: 3});
            await expect.poll(async () => (await ghost(page)).cell).toEqual({col: 12, row: 3});
            const box = await page.locator('canvas').boundingBox();
            const cx = box.x + box.width / 2;
            const cy = box.y + box.height / 2;
            await twoFingers(page, [[[cx - 40, cy], [cx + 40, cy]], [[cx - 70, cy], [cx + 70, cy]], [[cx - 100, cy], [cx + 100, cy]]]);
            await twoFingers(page, [[[cx - 40, cy], [cx + 40, cy]], [[cx - 80, cy], [cx, cy]]]);
            await expect.poll(async () => (await sample(page)).camera.zoom).toBeGreaterThan((await sample(page)).camera.fitZoom);
            const s = await sample(page);
            expect(s.ghost.cell).toEqual({col: 12, row: 3});
            expect(s.previewView).toMatchObject({x: state.grid.originX + 12 * 32, y: state.grid.originY + 3 * 32}); // still on its world tile
            expect(await spent(page)).toEqual(before);
        });

        test('a second finger cancels a drag in progress, and puts the ghost back', async ({page}) => {
            const state = await base(page);
            const before = await spent(page);
            await choose(page, 'outpost');
            await tile(page, state, {col: 4, row: 4});
            await expect.poll(async () => (await ghost(page)).cell).toEqual({col: 4, row: 4});
            const client = await page.context().newCDPSession(page);
            const at = (cell) => worldToScreen(page, cellCenter(state.grid, cell), state);
            const a = await at({col: 8, row: 12});
            const b = await at({col: 10, row: 12});
            const c = await at({col: 14, row: 12});
            await client.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{...a, id: 0}]});
            await expect.poll(async () => (await ghost(page)).cell).toEqual({col: 8, row: 12});
            await client.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{...b, id: 0}]});
            await client.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{...b, id: 0}, {...c, id: 1}]});
            await expect.poll(async () => (await ghost(page)).cell).toEqual({col: 4, row: 4});
            await client.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
            await page.waitForTimeout(60);
            expect((await ghost(page)).cell).toEqual({col: 4, row: 4});
            expect(await spent(page)).toEqual(before);
        });

        test('HUD taps build nothing and do not move the ghost', async ({page}) => {
            const state = await base(page);
            const before = await spent(page);
            await choose(page, 'outpost');
            await tile(page, state, {col: 4, row: 4});
            await expect.poll(async () => (await ghost(page)).cell).toEqual({col: 4, row: 4});
            for (const action of ['camera-zoom-in', 'camera-zoom-out', 'camera-fit']) {
                await tapAction(page, action);
                expect((await ghost(page)).cell, action).toEqual({col: 4, row: 4});
            }
            await tapAction(page, 'open-build');
            await expect.poll(async () => (await sample(page)).ui.drawerOpen).toBe(true);
            await tapAction(page, 'open-build');
            await expect.poll(async () => (await sample(page)).ui.drawerOpen).toBe(false);
            expect((await ghost(page)).cell).toEqual({col: 4, row: 4});
            expect(await spent(page)).toEqual(before);
        });

        test('a LOW_POWER purchase warns as the ghost lands, so the confirming tap is the second press', async ({page}) => {
            const {start, buildHq} = hqFlow(touch);
            const state = await start(page, 'mutants=off');
            await buildHq(page, state, HQ);
            await tapAction(page, 'camera-fit');
            await choose(page, 'autocannon'); // 20 of HQ's 20
            await tapWorld(page, cellCenter(state.grid, {col: 3, row: 3}), state);
            await expect.poll(async () => (await sample(page)).buildings.length).toBe(2);
            await tile(page, state, {col: 5, row: 3}); // and 20 more
            await expect.poll(async () => (await sample(page)).powerWarning).toMatchObject({type: 'autocannon'});
            expect((await sample(page)).placementHint).toContain('LOW POWER');
            expect((await sample(page)).buildings).toHaveLength(2);
            await tile(page, state, {col: 5, row: 3});
            await expect.poll(async () => (await sample(page)).buildings.length).toBe(3);
            expect((await sample(page)).power.status).toBe('low-power');
        });

        test('the ghost goes when the shift ends', async ({page}) => {
            await base(page);
            await choose(page, 'outpost');
            await tapAction(page, 'end-day');
            await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('night');
            await expect.poll(async () => (await ghost(page)).active).toBe(false);
            expect((await sample(page)).previewView.visible).toBe(false);
        });
    });
}

test.describe('desktop placement is unchanged', () => {
    test('no ghost: hover previews, one click builds, and placement stays active', async ({page}) => {
        const {start, buildHq, place} = hqFlow({pressWorld: clickWorld, pressAction: clickAction});
        const state = await start(page, 'mutants=off');
        await buildHq(page, state, HQ);
        await place(page, state, 'powerPlant', {col: 20, row: 3});
        await clickAction(page, 'build-outpost');
        expect((await ghost(page)).active).toBe(false);
        expect((await sample(page)).previewView.visible).toBe(false);

        const at = await worldToScreen(page, cellCenter(state.grid, {col: 4, row: 4}), state);
        await page.mouse.move(at.x, at.y);
        await expect.poll(async () => (await sample(page)).placement.preview?.footprint).toMatchObject({col: 4, row: 4});
        expect((await sample(page)).previewView).toMatchObject({visible: true, fillColor: GREEN});

        const {count} = await spent(page);
        await page.mouse.click(at.x, at.y);
        await expect.poll(async () => (await sample(page)).buildings.length).toBe(count + 1);
        expect((await sample(page)).placement.selectedType).toBe('outpost');
        await expect(byAction(page, 'cancel-placement')).toHaveCount(1);
    });

    test('a wall drag still builds as it goes', async ({page}) => {
        const {start, buildHq} = hqFlow({pressWorld: clickWorld, pressAction: clickAction});
        const state = await start(page, 'mutants=off');
        await buildHq(page, state, HQ);
        await clickAction(page, 'build-wall');
        const from = await worldToScreen(page, cellCenter(state.grid, {col: 3, row: 3}), state);
        const to = await worldToScreen(page, cellCenter(state.grid, {col: 6, row: 3}), state);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y);
        await page.mouse.up();
        await expect.poll(async () => (await sample(page)).buildings.filter((b) => b.type === 'wall').length).toBe(4);
    });
});
