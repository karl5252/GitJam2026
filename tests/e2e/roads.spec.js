import {test, expect} from '@playwright/test';
import {body, byAction, clickAction, clickWorld, tapAction, tapWorld, worldToScreen, showBuildMenu} from '../helpers/canvas.js';
import {cellCenter, hqFlow} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * Roads through real input on the real HQ-first flow. HQ centred on 12,8 has
 * its footprint on 11-13, 7-9 and its ring on 10-14, 6-10.
 */

const HQ = {col: 12, row: 8};
const ABOVE_RING = {col: 12, row: 5};
const RING_TILE = {col: 10, row: 6};
const FACTORY_ON_RING = {col: 8, row: 8}; // dock 10,8 is on the ring
const FACTORY_FAR = {col: 3, row: 3};

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function roadSuite(input) {
    const {pressWorld, pressAction} = input;
    const {start, buildHq, place, nightTo, stepToDefeat} = hqFlow(input);

    const pressCell = (page, state, cell) => pressWorld(page, cellCenter(state.grid, cell), state);
    const roadCount = async (page) => (await sample(page)).roads.tiles.length;

    async function hqRun(page, query) {
        const state = await start(page, query);
        await buildHq(page, state, HQ);
        return state;
    }

    async function roadTool(page) {
        await pressAction(page, 'build-road');
        await expect.poll(async () => (await sample(page)).roadMode).toBe(true);
        await expect(byAction(page, 'build-road')).toHaveAttribute('data-selected', 'true');
    }

    test('HQ brings its ring, rendered where the domain says', {tag: '@smoke'}, async ({page}) => {
        const state = await hqRun(page);
        const s = await sample(page);
        expect(s.roads).toMatchObject({connected: 16});
        expect(s.roads.tiles).toHaveLength(16);
        expect(s.roadViews).toHaveLength(16);
        const first = s.roadViews[0];
        expect(first).toMatchObject({col: 10, row: 6, kind: 'hq-ring'});
        expect([first.x, first.y]).toEqual([state.grid.originX + 10 * state.grid.tileSize, state.grid.originY + 6 * state.grid.tileSize]);
    });

    test('HQ cannot be placed unless the whole ring fits', async ({page}) => {
        const state = await start(page);
        await pressAction(page, 'build-hq');
        await pressCell(page, state, {col: 1, row: 1});
        await expect.poll(async () => (await sample(page)).placementHint).toBe('The HQ road ring must fit on the map');
        const s = await sample(page);
        expect(s.buildings).toEqual([]);
        expect(s.roads.tiles).toEqual([]);
        expect(s.placement.preview).toMatchObject({ok: false, reason: 'hq-ring-out-of-bounds'});
        expect(s.ringPreviewView.visible).toBe(true);
        expect([s.ringPreviewView.width, s.ringPreviewView.height]).toEqual([160, 160]);

        await pressCell(page, state, {col: 2, row: 2});
        await expect.poll(async () => (await sample(page)).buildings.length).toBe(1);
        expect((await sample(page)).ringPreviewView.visible).toBe(false);
        expect((await sample(page)).placementHint).toBe('');
    });

    test('the road tool is locked until HQ stands', async ({page}) => {
        await start(page);
        await expect(byAction(page, 'build-road')).toHaveAttribute('data-state', 'locked');
        await pressAction(page, 'build-road');
        expect((await sample(page)).roadMode).toBe(false);
    });

    test('a press adds a road for 2 Credits, and a second press removes it with no refund', async ({page}) => {
        const state = await hqRun(page);
        const before = (await sample(page)).resources;
        await roadTool(page);

        await pressCell(page, state, ABOVE_RING);
        await expect.poll(() => roadCount(page)).toBe(17);
        expect((await sample(page)).roadViews).toHaveLength(17);
        expect((await sample(page)).resources).toEqual({...before, credits: before.credits - 2});
        await pressCell(page, state, ABOVE_RING);
        await expect.poll(() => roadCount(page)).toBe(16);
        expect((await sample(page)).roadViews).toHaveLength(16);
        expect((await sample(page)).resources).toEqual({...before, credits: before.credits - 2});

        await pressAction(page, 'cancel-placement');
        await expect.poll(async () => (await sample(page)).roadMode).toBe(false);
    });

    test('rejected road actions explain themselves and change nothing', async ({page}) => {
        const state = await hqRun(page);
        await roadTool(page);
        await pressCell(page, state, RING_TILE);
        await expect.poll(async () => (await sample(page)).placementHint).toBe('The HQ road ring is permanent');
        await pressCell(page, state, {col: 2, row: 2});
        await expect.poll(async () => (await sample(page)).placementHint).toBe('Roads must extend the connected network');
        expect(await roadCount(page)).toBe(16);
    });

    test('a Factory needs road access, and its last road is protected', async ({page}) => {
        const state = await hqRun(page);
        await pressAction(page, 'build-factory');
        await pressCell(page, state, FACTORY_FAR);
        await expect.poll(async () => (await sample(page)).placementHint).toBe('Factory dock (right side) needs a connected road');
        expect((await sample(page)).buildings).toHaveLength(1);
        await pressAction(page, 'cancel-placement');

        await roadTool(page);
        for (const cell of [{col: 10, row: 5}, {col: 10, row: 4}]) await pressCell(page, state, cell);
        await expect.poll(() => roadCount(page)).toBe(18);
        await pressAction(page, 'cancel-placement');
        await place(page, state, 'factory', {col: 8, row: 4});

        await roadTool(page);
        await pressCell(page, state, {col: 10, row: 5});
        await expect.poll(async () => (await sample(page)).placementHint).toBe('A Factory dock depends on this road');
        expect(await roadCount(page)).toBe(18);
    });

    test('a Factory with its dock on the ring can be built with no extra road', async ({page}) => {
        const state = await hqRun(page);
        await place(page, state, 'factory', FACTORY_ON_RING);
        expect((await sample(page)).buildings).toHaveLength(2);
    });

    test('nothing can be built on a road', async ({page}) => {
        const state = await hqRun(page);
        await pressAction(page, 'build-outpost');
        await pressCell(page, state, RING_TILE);
        await expect.poll(async () => (await sample(page)).placementHint).toBe('Buildings cannot go on roads');
        expect((await sample(page)).buildings).toHaveLength(1);
    });

    test('Night closes the road tool and hides its button', async ({page}) => {
        await hqRun(page);
        await pressAction(page, 'build-road');
        await expect.poll(async () => (await sample(page)).roadMode).toBe(true);
        await nightTo(page, 1);
        expect((await sample(page)).roadMode).toBe(false);
        await expect(byAction(page, 'build-road')).toHaveCount(0);
    });

    test('restart clears the network, and the next HQ brings a new ring', async ({page}) => {
        const state = await hqRun(page, 'waveBudget=20');
        await stepToDefeat(page);
        await pressAction(page, 'restart');
        await expect(body(page)).toHaveAttribute('data-phase', 'ready');
        expect((await sample(page)).roads).toBeNull();

        await pressAction(page, 'start');
        await expect(body(page)).toHaveAttribute('data-phase', 'started');
        expect((await sample(page)).roads.tiles).toEqual([]);
        expect((await sample(page)).roadViews).toEqual([]);
        await buildHq(page, state, {col: 6, row: 6});
        expect((await sample(page)).roads.tiles[0]).toMatchObject({col: 4, row: 4});
    });

    test('the longer menu overlaps nothing', async ({page}) => {
        await hqRun(page);
        await pressAction(page, 'build-road'); // shows Cancel too
        await expect(byAction(page, 'cancel-placement')).toHaveCount(1);
        await showBuildMenu(page);
        const actions = ['build-hq', 'build-outpost', 'build-factory', 'build-powerPlant', 'build-autocannon', 'build-road', 'cancel-placement', 'end-day'];
        const boxes = await Promise.all(actions.map((action) => byAction(page, action).boundingBox()));
        for (const [i, box] of boxes.entries()) {
            for (const [j, other] of boxes.slice(i + 1).entries()) {
                expect(overlaps(box, other), `${actions[i]} and ${actions[i + j + 1]}`).toBe(false);
            }
        }
    });
}

test.describe('desktop mouse', () => {
    test.use({viewport: {width: 1280, height: 720}});
    roadSuite({pressWorld: clickWorld, pressAction: clickAction});

    test('dragging lays roads and never removes them', async ({page}) => {
        const {start, buildHq} = hqFlow({pressWorld: clickWorld, pressAction: clickAction});
        const state = await start(page);
        await buildHq(page, state, HQ);
        await clickAction(page, 'build-road');
        await clickWorld(page, cellCenter(state.grid, {col: 12, row: 4 + 1}), state); // 12,5, a press adds it
        await expect.poll(async () => (await sample(page)).roads.tiles.length).toBe(17);

        const screen = (col, row) => worldToScreen(page, cellCenter(state.grid, {col, row}), state);
        const start4 = await screen(13, 5);
        await page.mouse.move(start4.x, start4.y);
        await page.mouse.down();
        for (const [col, row] of [[14, 5], [15, 5], [15, 4], [15, 3]]) {
            const p = await screen(col, row);
            await page.mouse.move(p.x, p.y, {steps: 3});
        }
        await page.mouse.up();
        await expect.poll(async () => (await sample(page)).roads.tiles.length).toBe(22);

        // A drag that starts on a road removes it once, then adds nothing over the rest.
        const from = await screen(13, 5);
        const to = await screen(15, 5);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, {steps: 5});
        await page.mouse.up();
        await expect.poll(async () => (await sample(page)).roads.tiles.length).toBe(21);
    });

    test('hovering HQ previews the whole 5x5', async ({page}) => {
        const {start} = hqFlow({pressWorld: clickWorld, pressAction: clickAction});
        const state = await start(page);
        await clickAction(page, 'build-hq');
        const p = await worldToScreen(page, cellCenter(state.grid, HQ), state);
        await page.mouse.move(p.x, p.y);
        await expect.poll(async () => (await sample(page)).ringPreviewView.visible).toBe(true);
        const {x, y, width, height} = (await sample(page)).ringPreviewView;
        expect([x, y, width, height]).toEqual([state.grid.originX + 320, state.grid.originY + 192, 160, 160]);
    });
});

test.describe('mobile landscape touch', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});
    roadSuite({pressWorld: tapWorld, pressAction: tapAction});
});
