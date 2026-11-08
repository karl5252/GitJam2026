import {test, expect} from '@playwright/test';
import {byAction, clickAction, clickWorld, tapAction, tapWorld, showBuildMenu} from '../helpers/canvas.js';
import {cellCenter, hqFlow, stepExactly} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * Barracks, flags and soldiers through real input on the real HQ-first flow. HQ
 * centred on 12,8 has its ring on 10-14, 6-10. A Barracks at pointer 16,8 has its
 * exit on the ring at 14,8. The Plant stands at pointer 20,3.
 */

const HQ = {col: 12, row: 8};
const BARRACKS = {col: 16, row: 8};
const PLANT = {col: 20, row: 3};
const MIN_TOUCH = 44;

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function suite(input) {
    const {pressWorld, pressAction} = input;
    const {start, buildHq, place, select, nightTo, finishNight} = hqFlow(input);

    const pressCell = (page, state, cell) => pressWorld(page, cellCenter(state.grid, cell), state);

    /** HQ, Plant and Barracks, with no mutants unless a test needs them. */
    async function base(page, query = 'mutants=off') {
        const state = await start(page, query);
        await buildHq(page, state, HQ);
        await place(page, state, 'powerPlant', PLANT);
        await place(page, state, 'barracks', BARRACKS);
        const {buildings} = await sample(page);
        return {state, id: buildings.find((b) => b.type === 'barracks').id};
    }

    async function setFlag(page, state, cell) {
        await pressAction(page, 'set-flag');
        await expect.poll(async () => (await sample(page)).flagMode).not.toBeNull();
        await pressCell(page, state, cell);
    }

    test('RESET FLAG shows only with a flag, and works by Day and by Night', async ({page}) => {
        const {state, id} = await base(page);
        await select(page, state, BARRACKS, id);
        expect((await sample(page)).buildingControlsView).toMatchObject({flagLabel: 'Set\nflag', resetVisible: false});
        await expect(byAction(page, 'reset-flag')).toHaveCount(0);

        await setFlag(page, state, {col: 20, row: 12});
        await expect.poll(async () => (await sample(page)).buildingControlsView.resetVisible).toBe(true);
        await pressAction(page, 'reset-flag');
        await expect.poll(async () => (await sample(page)).buildings.find((b) => b.id === id).flag).toBeNull();
        expect((await sample(page)).buildingControlsView).toMatchObject({flagLabel: 'Set\nflag', resetVisible: false});
        expect((await sample(page)).resources).toEqual({credits: 350, ap: 3});

        await setFlag(page, state, {col: 8, row: 3});
        await expect.poll(async () => (await sample(page)).buildingControlsView.resetVisible).toBe(true);
        await nightTo(page, 200);
        const out = await sample(page);
        expect(out.buildingControlsView.resetVisible).toBe(true);
        const before = out.infantry.soldiers[0];
        await pressAction(page, 'reset-flag');
        await expect.poll(async () => (await sample(page)).infantry.posts[0].post).toEqual({col: 14, row: 8});
        await stepExactly(page, 2);
        const after = (await sample(page)).infantry.soldiers.find((s) => s.id === before.id);
        expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
        await stepExactly(page, 700);
        const home = await sample(page);
        expect(home.infantry.soldiers.every(({col, row}) => col === 14 && row === 8)).toBe(true);
        expect(home.infantry.totals.deployed).toBe(4);
    });

    test('the power toggle still works beside RESET FLAG, and goes back to full width for other buildings', async ({page}) => {
        const {state, id} = await base(page);
        await select(page, state, BARRACKS, id);
        await setFlag(page, state, {col: 20, row: 12});
        await expect(byAction(page, 'reset-flag')).toHaveCount(1);
        await pressAction(page, 'toggle-power');
        await expect.poll(async () => (await sample(page)).buildings.find((b) => b.id === id).enabled).toBe(false);
        const narrow = await byAction(page, 'toggle-power').boundingBox();

        const plant = (await sample(page)).buildings.find((b) => b.type === 'powerPlant').id;
        await select(page, state, PLANT, plant);
        const wide = await byAction(page, 'toggle-power').boundingBox();
        if ((await sample(page)).ui.layout === 'desktop') expect(wide.width).toBeGreaterThan(narrow.width); // touch keeps its own column
        await expect(byAction(page, 'reset-flag')).toHaveCount(0);
        await pressAction(page, 'toggle-power');
        await expect.poll(async () => (await sample(page)).buildings.find((b) => b.id === plant).enabled).toBe(false);
    });

    test('Barracks are locked until HQ stands, and need a road on the left exit', async ({page}) => {
        const state = await start(page, 'mutants=off');
        await expect(byAction(page, 'build-barracks')).toHaveAttribute('data-state', 'locked');
        await buildHq(page, state, HQ);
        expect((await sample(page)).menuLabels.barracks).toBe('Barracks 3x3\n400c · 1 AP');

        await pressAction(page, 'build-barracks');
        await pressCell(page, state, {col: 18, row: 8});
        await expect.poll(async () => (await sample(page)).placementHint).toBe('Barracks exit (left side) needs a connected road');
        const rejected = await sample(page);
        expect(rejected.placement.preview.dock).toEqual({col: 16, row: 8});
        expect(rejected.dockPreviewView.visible).toBe(true);
        await pressCell(page, state, BARRACKS);
        await expect.poll(async () => (await sample(page)).powerWarning).toMatchObject({type: 'barracks'}); // 30 against HQ's 20
        await pressCell(page, state, BARRACKS);
        await expect.poll(async () => (await sample(page)).buildings.length).toBe(2);
        const s = await sample(page);
        expect(s.resources).toEqual({credits: 850, ap: 4});
        expect(s.dockViews).toContainEqual({col: 14, row: 8, kind: 'barracks'});
    });

    test('the Barracks limit locks the button, and demolishing one unlocks it', async ({page}) => {
        const state = await start(page, 'mutants=off');
        await page.evaluate(() => window.__qa.economy.setCredits(10_000));
        await buildHq(page, state, HQ);
        await pressAction(page, 'build-road');
        for (const [col, row] of [[14, 5], [14, 4], [14, 11], [14, 12], [14, 13]]) await pressCell(page, state, {col, row});
        await pressAction(page, 'cancel-placement');
        for (const [col, row] of [[16, 7], [16, 10], [16, 4], [16, 13]]) await place(page, state, 'barracks', {col, row});
        await expect(byAction(page, 'build-barracks')).toHaveAttribute('data-state', 'locked');
        await select(page, state, {col: 16, row: 13}, (await sample(page)).buildings.at(-1).id);
        await pressAction(page, 'demolish');
        await expect(byAction(page, 'demolish')).toHaveAttribute('data-armed', 'true');
        await pressAction(page, 'demolish');
        await expect(byAction(page, 'build-barracks')).toHaveAttribute('data-state', 'available');
        expect((await sample(page)).resources.credits).toBe(10_000 - 5 * 2 - 4 * 400); // five road tiles at 2 Credits
    });

    test('a flag is set through the selected Barracks, and rejected tiles keep the tool open', async ({page}) => {
        const {state, id} = await base(page);
        await select(page, state, BARRACKS, id);
        expect((await sample(page)).buildingControlsView).toEqual({
            flagVisible: true, flagLabel: 'Set\nflag', resetVisible: false, resetLabel: 'RESET\nFLAG', demolishVisible: true, demolishLabel: 'Demolish', demolishArmed: null,
            refitVisible: true, refitLabel: 'Refit: ROCKET\n200c · 1 AP', refitArmed: null,
        });
        await expect(byAction(page, 'set-flag')).toHaveAttribute('data-target', id);

        await setFlag(page, state, HQ);
        await expect.poll(async () => (await sample(page)).placementHint).toBe('Flags go on open ground or roads');
        expect((await sample(page)).flagMode).toBe(id);

        await pressCell(page, state, {col: 20, row: 13});
        await expect.poll(async () => (await sample(page)).flagMode).toBeNull();
        const s = await sample(page);
        expect(s.selectedBuilding).toBe(id);
        expect(s.buildings.find((b) => b.id === id).flag).toEqual({col: 20, row: 13});
        expect(s.buildingControlsView.flagLabel).toBe('Move\nflag');
        expect(s.resources).toEqual({credits: 350, ap: 3});
        expect(s.infantryViews.flags).toEqual([{id, number: 1, flag: {col: 20, row: 13}, blocked: false, selected: true, visible: true}]);
    });

    test('Cancel leaves the flag alone and goes back to the Barracks', async ({page}) => {
        const {state, id} = await base(page);
        await select(page, state, BARRACKS, id);
        await pressAction(page, 'set-flag');
        await expect.poll(async () => (await sample(page)).flagMode).toBe(id);
        await pressAction(page, 'cancel-placement');
        await expect.poll(async () => (await sample(page)).flagMode).toBeNull();
        const s = await sample(page);
        expect(s.selectedBuilding).toBe(id);
        expect(s.buildings.find((b) => b.id === id).flag).toBeNull();
    });

    test('a squad deploys at dusk, marches to its flag and goes home at dawn', {tag: '@smoke'}, async ({page}) => {
        const {state, id} = await base(page);
        await select(page, state, BARRACKS, id);
        await setFlag(page, state, {col: 20, row: 13});
        await expect.poll(async () => (await sample(page)).flagMode).toBeNull();

        await nightTo(page, 91);
        let s = await sample(page);
        expect(s.infantry.soldiers.length).toBe(4);
        expect(s.infantryViews.soldiers.length).toBe(4);
        expect(s.infantryViews.pips).toEqual({[id]: 4});

        await stepExactly(page, 600);
        s = await sample(page);
        expect(s.infantry.soldiers.map(({col, row}) => [col, row])).toEqual(new Array(4).fill([20, 13]));
        expect(s.infantryViews.soldiers.map(({x, y}) => [x, y])).toEqual(s.infantry.soldiers.map(({x, y}) => [x, y]));

        await finishNight(page);
        s = await sample(page);
        expect(s.infantry.soldiers).toEqual([]);
        expect(s.infantryViews.soldiers).toEqual([]);
        expect(s.infantryViews.deaths).toEqual([]);
        expect(s.buildings.find((b) => b.id === id).flag).toEqual({col: 20, row: 13});
    });

    test('a flag moved at Night by a real press redirects the squad; Demolish stays hidden', async ({page}) => {
        const {state, id} = await base(page);
        await nightTo(page, 200);
        await select(page, state, BARRACKS, id);
        const {buildingControlsView} = await sample(page);
        expect(buildingControlsView).toMatchObject({flagVisible: true, demolishVisible: false});
        await expect(byAction(page, 'demolish')).toHaveCount(0);

        await setFlag(page, state, {col: 5, row: 2});
        await expect.poll(async () => (await sample(page)).flagMode).toBeNull();
        await stepExactly(page, 700);
        expect((await sample(page)).infantry.soldiers.map(({col, row}) => [col, row])).toEqual(new Array(4).fill([5, 2]));
    });

    test('a switched-off Barracks sends nobody', async ({page}) => {
        const {state, id} = await base(page);
        await select(page, state, BARRACKS, id);
        await pressAction(page, 'toggle-power');
        await nightTo(page, 120);
        expect((await sample(page)).infantry.soldiers).toEqual([]);
    });

    test('soldiers fight real mutants, with tracers on the map', async ({page}) => {
        const {state, id} = await base(page, 'waveBudget=6');
        await select(page, state, BARRACKS, id);
        await setFlag(page, state, {col: 20, row: 13});
        await nightTo(page, 3000);
        const s = await sample(page);
        expect(s.infantry.night.shots).toBeGreaterThan(0);
        expect(s.infantry.night.kills).toBeGreaterThan(0);
    });

    test('flag mode ends with the Night', async ({page}) => {
        const {state, id} = await base(page);
        await nightTo(page, 100);
        await select(page, state, BARRACKS, id);
        await pressAction(page, 'set-flag');
        await expect.poll(async () => (await sample(page)).flagMode).toBe(id);
        await finishNight(page);
        await expect.poll(async () => (await sample(page)).flagMode).toBeNull();
        await expect(byAction(page, 'cancel-placement')).toHaveCount(0);
    });
}

test.describe('infantry: desktop', () => {
    suite({pressWorld: clickWorld, pressAction: clickAction});
});

test.describe('infantry: mobile landscape', () => {
    test.use({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true});
    test.setTimeout(45_000); // each building takes two taps here, and these bases have several

    suite({pressWorld: tapWorld, pressAction: tapAction});

    test('Barracks controls are comfortable touch targets and overlap nothing, by Day and by Night', async ({page}) => {
        const flow = hqFlow({pressWorld: tapWorld, pressAction: tapAction});
        const state = await flow.start(page, 'mutants=off');
        await flow.buildHq(page, state, HQ);
        await flow.place(page, state, 'powerPlant', PLANT);
        await flow.place(page, state, 'barracks', BARRACKS);
        const id = (await sample(page)).buildings.at(-1).id;
        await flow.select(page, state, BARRACKS, id);
        await showBuildMenu(page);

        const check = async (actions) => {
            const boxes = await Promise.all(actions.map((action) => byAction(page, action).boundingBox()));
            boxes.forEach((box, i) => {
                expect(box.width, `${actions[i]} width`).toBeGreaterThanOrEqual(MIN_TOUCH);
                expect(box.height, `${actions[i]} height`).toBeGreaterThanOrEqual(MIN_TOUCH);
                for (let j = i + 1; j < boxes.length; j++) {
                    expect(overlaps(box, boxes[j]), `${actions[i]} and ${actions[j]}`).toBe(false);
                }
            });
        };
        await check(['set-flag', 'demolish', 'toggle-power', 'end-day', 'build-barracks', 'build-road', 'build-wall', 'build-gateVertical', 'build-gateHorizontal']);

        await tapAction(page, 'open-build'); // close the drawer to reach the map
        await tapAction(page, 'set-flag');
        await expect.poll(async () => (await sample(page)).flagMode).toBe(id);
        await tapWorld(page, cellCenter(state.grid, {col: 20, row: 12}), state);
        await expect.poll(async () => (await sample(page)).flagMode).toBeNull();
        await showBuildMenu(page);
        await check(['set-flag', 'reset-flag', 'demolish', 'toggle-power', 'end-day', 'build-barracks', 'build-road', 'build-wall', 'build-gateVertical', 'build-gateHorizontal']);
        await tapAction(page, 'open-build');

        await flow.nightTo(page, 10);
        await check(['set-flag', 'reset-flag', 'toggle-power', 'speed-1', 'speed-2', 'speed-4']);
    });
});
