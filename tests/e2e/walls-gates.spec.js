import {test, expect} from '@playwright/test';
import {byAction, clickAction, clickWorld, tapAction, tapWorld, worldToScreen} from '../helpers/canvas.js';
import {cellCenter, hqFlow, qaSim, stepExactly} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * Walls and gates through real input on the real HQ-first flow. HQ centred on
 * 12,8 has its ring on 10-14, 6-10. The west road runs along row 8 from the ring
 * to a Factory dock at 5,8; the north road runs up col 12.
 */

const HQ = {col: 12, row: 8};
const WEST_ROAD = [[9, 8], [8, 8], [7, 8], [6, 8], [5, 8]];
const NORTH_ROAD = [[12, 5], [12, 4], [12, 3]];
const MIN_TOUCH = 44;
const BUILD_ACTIONS = ['build-hq', 'build-outpost', 'build-factory', 'build-powerPlant', 'build-autocannon', 'build-road', 'build-wall', 'build-gateVertical', 'build-gateHorizontal'];

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function suite(input) {
    const {pressWorld, pressAction} = input;
    const {start, buildHq, place, select, nightTo, finishNight} = hqFlow(input);

    const pressCell = (page, state, [col, row]) => pressWorld(page, cellCenter(state.grid, {col, row}), state);
    const countOf = async (page, type) => (await sample(page)).buildings.filter((b) => b.type === type).length;

    async function hqRun(page) {
        const state = await start(page);
        await buildHq(page, state, HQ);
        return state;
    }

    async function layRoad(page, state, cells) {
        await pressAction(page, 'build-road');
        for (const cell of cells) await pressCell(page, state, cell);
        await pressAction(page, 'cancel-placement');
        await expect.poll(async () => (await sample(page)).roadMode).toBe(false);
    }

    async function placeGate(page, state, type, cell) {
        await pressAction(page, `build-${type}`);
        await pressCell(page, state, cell);
        await expect.poll(() => countOf(page, type)).toBe(1);
        await pressAction(page, 'cancel-placement');
    }

    test('wall and gate buttons are locked until HQ stands, and show their costs', async ({page}) => {
        await start(page);
        for (const action of ['build-wall', 'build-gateVertical', 'build-gateHorizontal']) {
            await expect(byAction(page, action)).toHaveAttribute('data-state', 'locked');
        }
        const {menuLabels} = await sample(page);
        expect(menuLabels.wall).toBe('Wall\n25c');
        expect(menuLabels.gateVertical).toBe('Gate |\n100c · 1 AP');
        expect(menuLabels.gateHorizontal).toBe('Gate —\n100c · 1 AP');
    });

    test('a wall is placed by a press, costing Credits and no AP, and stays in wall mode', async ({page}) => {
        const state = await hqRun(page);
        await pressAction(page, 'build-wall');
        await pressCell(page, state, [3, 3]);
        await pressCell(page, state, [4, 3]);
        await expect.poll(() => countOf(page, 'wall')).toBe(2);
        const s = await sample(page);
        expect(s.resources).toEqual({credits: 1200, ap: 5});
        expect(s.placement.selectedType).toBe('wall');
        expect(s.buildingViews.filter((v) => v.id.startsWith('wall'))).toHaveLength(2);
    });

    test('a wall on a road is refused with a hint', async ({page}) => {
        const state = await hqRun(page);
        await pressAction(page, 'build-wall');
        await pressCell(page, state, [10, 6]);
        await expect.poll(async () => (await sample(page)).placementHint).toBe('Buildings cannot go on roads');
        expect(await countOf(page, 'wall')).toBe(0);
    });

    test('a selected wall can be demolished during Day, with no refund, and not at Night', async ({page}) => {
        const state = await hqRun(page);
        await place(page, state, 'wall', {col: 3, row: 3});
        await place(page, state, 'wall', {col: 4, row: 3});
        await select(page, state, {col: 3, row: 3}, 'wall-2');
        await expect(byAction(page, 'demolish')).toHaveAttribute('data-target', 'wall-2');
        await expect(byAction(page, 'toggle-power')).toHaveCount(0);
        const {resources} = await sample(page);

        await pressAction(page, 'demolish');
        await expect.poll(() => countOf(page, 'wall')).toBe(1);
        const s = await sample(page);
        expect(s.resources).toEqual(resources);
        expect(s.selectedBuilding).toBeNull();
        expect(s.buildingViews.some((v) => v.id === 'wall-2')).toBe(false);
        await expect(byAction(page, 'demolish')).toHaveCount(0);

        await select(page, state, {col: 4, row: 3}, 'wall-3');
        await nightTo(page, 1);
        await expect(byAction(page, 'demolish')).toHaveCount(0);
        await finishNight(page);
        await expect(byAction(page, 'demolish')).toHaveCount(1);
    });

    test('the build tools are gone at Night', async ({page}) => {
        await hqRun(page);
        await nightTo(page, 1);
        for (const action of ['build-wall', 'build-gateVertical', 'build-gateHorizontal']) await expect(byAction(page, action)).toHaveCount(0);
    });

    test('each gate previews its own orientation, green where the road allows it and red where not', async ({page}) => {
        const state = await hqRun(page);
        await layRoad(page, state, WEST_ROAD);

        await pressAction(page, 'build-gateHorizontal');
        await pressCell(page, state, [7, 8]);
        await expect.poll(async () => (await sample(page)).placementHint).toBe('This gate needs a straight road through it');
        let s = await sample(page);
        expect(s.gatePreviewView).toEqual({visible: true, col: 7, row: 8, orientation: 'horizontal'});
        expect(s.placement.preview).toMatchObject({ok: false, reason: 'gate-needs-straight-road'});
        expect(await countOf(page, 'gateHorizontal')).toBe(0);
        await pressAction(page, 'cancel-placement');
        await expect.poll(async () => (await sample(page)).gatePreviewView.visible).toBe(false);

        await pressAction(page, 'build-gateVertical');
        await pressCell(page, state, [7, 8]);
        await expect.poll(() => countOf(page, 'gateVertical')).toBe(1);
        s = await sample(page);
        expect(s.gates).toMatchObject([{col: 7, row: 8, orientation: 'vertical', passageAxis: 'x', state: 'closed', tier: 'standard'}]);
        await expect.poll(async () => (await sample(page)).gateViews).toMatchObject([{col: 7, row: 8, orientation: 'vertical', state: 'closed', open: 0}]);
        expect(s.resources).toEqual({credits: 1150, ap: 4});
        expect(s.roads.tiles.some((t) => t.col === 7 && t.row === 8)).toBe(true);
    });

    test('a horizontal gate goes on a north-south road, and never on the HQ ring', async ({page}) => {
        const state = await hqRun(page);
        await layRoad(page, state, NORTH_ROAD);
        await pressAction(page, 'build-gateHorizontal');
        await pressCell(page, state, [12, 6]);
        await expect.poll(async () => (await sample(page)).placementHint).toBe('No gates on the HQ road ring');
        await pressCell(page, state, [12, 4]);
        await expect.poll(() => countOf(page, 'gateHorizontal')).toBe(1);
        await expect.poll(async () => (await sample(page)).gateViews[0]?.orientation).toBe('horizontal');
    });

    test('the road under a gate cannot be removed; demolishing the gate frees it', async ({page}) => {
        const state = await hqRun(page);
        await layRoad(page, state, WEST_ROAD);
        await placeGate(page, state, 'gateVertical', [7, 8]);

        await pressAction(page, 'build-road');
        await pressCell(page, state, [7, 8]);
        await expect.poll(async () => (await sample(page)).placementHint).toBe('A gate depends on this road');
        await pressAction(page, 'cancel-placement');

        const [gate] = (await sample(page)).gates;
        await select(page, state, {col: 7, row: 8}, gate.id);
        await pressAction(page, 'demolish');
        await expect.poll(() => countOf(page, 'gateVertical')).toBe(0);
        await expect.poll(async () => (await sample(page)).gateViews).toEqual([]);
        expect((await sample(page)).roads.tiles.some((t) => t.col === 7 && t.row === 8)).toBe(true);
    });

    test('a real truck opens a real gate, crosses, and the gate closes behind it', {tag: '@smoke'}, async ({page}) => {
        const state = await start(page, '?mutants=off');
        await buildHq(page, state, HQ);
        await layRoad(page, state, WEST_ROAD);
        await place(page, state, 'powerPlant', {col: 20, row: 3});
        await place(page, state, 'factory', {col: 3, row: 8});
        await placeGate(page, state, 'gateVertical', [7, 8]);

        await nightTo(page, 660);
        await expect.poll(async () => (await sample(page)).gates[0].state).toBe('opening');
        await stepExactly(page, 150);
        await expect.poll(async () => (await sample(page)).gateViews[0].state).toBe('open');
        await stepExactly(page, 250);
        expect((await sample(page)).gates[0].state).toBe('closed');
        await stepExactly(page, 400);
        expect((await sample(page)).logistics.night.loads).toBe(1);

        await finishNight(page);
        const s = await sample(page);
        expect(s.gates[0].state).toBe('closed');
        expect(s.logistics.trucks[0].state).toBe('idle');
    });
}

test.describe('walls and gates: desktop', () => {
    suite({pressWorld: clickWorld, pressAction: clickAction});

    test('dragging builds a wall along the path, with no gaps even on a fast drag', async ({page}) => {
        const {start, buildHq} = hqFlow({pressWorld: clickWorld, pressAction: clickAction});
        const state = await start(page);
        await buildHq(page, state, HQ);
        await clickAction(page, 'build-wall');
        const screen = (col, row) => worldToScreen(page, cellCenter(state.grid, {col, row}), state);
        const from = await screen(2, 2);
        const to = await screen(8, 2);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y); // one sample: nothing in between was hovered
        await page.mouse.up();
        await expect.poll(async () => (await sample(page)).buildings.filter((b) => b.type === 'wall').length).toBe(7);
        const cols = (await sample(page)).buildings.filter((b) => b.type === 'wall').map((b) => b.col);
        expect(cols).toEqual([2, 3, 4, 5, 6, 7, 8]);
        expect((await sample(page)).resources.credits).toBe(1250 - 7 * 25);

        // After release, moving builds nothing.
        const away = await screen(8, 12);
        await page.mouse.move(away.x, away.y);
        expect((await sample(page)).buildings.filter((b) => b.type === 'wall')).toHaveLength(7);
    });

    test('Escape leaves wall mode', async ({page}) => {
        const {start, buildHq} = hqFlow({pressWorld: clickWorld, pressAction: clickAction});
        const state = await start(page);
        await buildHq(page, state, HQ);
        await clickAction(page, 'build-wall');
        await page.keyboard.press('Escape');
        await expect.poll(async () => (await sample(page)).placement.selectedType).toBeNull();
    });
});

test.describe('walls and gates: mobile landscape', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});

    suite({pressWorld: tapWorld, pressAction: tapAction});

    test('every Day control is at least 44x44 CSS pixels, and none overlap', async ({page}) => {
        const flow = hqFlow({pressWorld: tapWorld, pressAction: tapAction});
        const state = await flow.start(page);
        await flow.buildHq(page, state, HQ);
        await flow.place(page, state, 'wall', {col: 3, row: 3});
        await tapAction(page, 'build-outpost');
        await expect(byAction(page, 'cancel-placement')).toHaveCount(1);

        const actions = [...BUILD_ACTIONS, 'cancel-placement', 'end-day'];
        const boxes = await Promise.all(actions.map((action) => byAction(page, action).boundingBox()));
        boxes.forEach((box, i) => {
            expect(box.width, `${actions[i]} width`).toBeGreaterThanOrEqual(MIN_TOUCH);
            expect(box.height, `${actions[i]} height`).toBeGreaterThanOrEqual(MIN_TOUCH);
            for (let j = i + 1; j < boxes.length; j++) {
                expect(overlaps(box, boxes[j]), `${actions[i]} and ${actions[j]}`).toBe(false);
            }
        });

        await tapAction(page, 'cancel-placement');
        await expect(byAction(page, 'cancel-placement')).toHaveCount(0);
        await flow.select(page, state, {col: 3, row: 3}, 'wall-2');
        const demolish = await byAction(page, 'demolish').boundingBox();
        expect(demolish.width).toBeGreaterThanOrEqual(MIN_TOUCH);
        expect(demolish.height).toBeGreaterThanOrEqual(MIN_TOUCH);
    });

    test('a touch drag builds a wall', async ({page}) => {
        const flow = hqFlow({pressWorld: tapWorld, pressAction: tapAction});
        const state = await flow.start(page);
        await flow.buildHq(page, state, HQ);
        await tapAction(page, 'build-wall');
        const screen = (col, row) => worldToScreen(page, cellCenter(state.grid, {col, row}), state);
        const from = await screen(2, 2);
        const to = await screen(6, 2);
        const client = await page.context().newCDPSession(page);
        const touch = (type, points) => client.send('Input.dispatchTouchEvent', {type, touchPoints: points});
        await touch('touchStart', [from]);
        await touch('touchMove', [to]);
        await touch('touchEnd', []);
        await expect.poll(async () => (await sample(page)).buildings.filter((b) => b.type === 'wall').length).toBe(5);
    });
});

test('after restart nothing of the walls and gates is left', async ({page}) => {
    const input = {pressWorld: clickWorld, pressAction: clickAction};
    const {start, buildHq, place, stepToDefeat} = hqFlow(input);
    const state = await start(page);
    await buildHq(page, state, HQ);
    await place(page, state, 'wall', {col: 3, row: 3});
    await clickAction(page, 'build-road');
    for (const [col, row] of NORTH_ROAD) await clickWorld(page, cellCenter(state.grid, {col, row}), state);
    await clickAction(page, 'cancel-placement');
    await clickAction(page, 'build-gateHorizontal');
    await clickWorld(page, cellCenter(state.grid, {col: 12, row: 4}), state);
    await expect.poll(async () => (await sample(page)).gates.length).toBe(1);
    await clickAction(page, 'cancel-placement');

    await stepToDefeat(page, 40);
    await clickAction(page, 'restart');
    await expect.poll(async () => (await sample(page)).phase).toBe('ready');
    await clickAction(page, 'start');
    await expect.poll(async () => (await sample(page)).phase).toBe('started');
    const s = await sample(page);
    expect(s.buildings).toEqual([]);
    expect(s.gates).toEqual([]);
    expect(s.gateViews).toEqual([]);
    expect(s.placement.selectedType).toBeNull();
    await expect(byAction(page, 'demolish')).toHaveCount(0);
    await qaSim(page, 'pause');
});
