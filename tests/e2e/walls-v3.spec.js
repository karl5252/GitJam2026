import {test, expect} from '@playwright/test';
import {clickAction, clickWorld, worldToScreen} from '../helpers/canvas.js';
import {cellCenter, hqFlow} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * walls_v3 autotiling through real presses on the open map. HQ on 12,8 (ring
 * 10-14, 6-10). A 5x5 window grid of walls on cols 1-5, rows 1-5 holds every
 * corner, T, straight and the crossing; a Horizontal Gate on the north road and a
 * Vertical Gate on the west road each have walls on their barrier sides.
 */
const HQ = {col: 12, row: 8};
const NORTH_ROAD = [[12, 5], [12, 4], [12, 3]];
const WEST_ROAD = [[9, 8], [8, 8], [7, 8], [6, 8], [5, 8]];
const GRID = [];
for (let row = 1; row <= 5; row++) {
    for (let col = 1; col <= 5; col++) if (row % 2 === 1 || col % 2 === 1) GRID.push([col, row]);
}
const BY_GATES = [[10, 4], [11, 4], [13, 4], [7, 7], [7, 9]];
const LOOSE = [[20, 2], [17, 13], [18, 13], [21, 11], [21, 12], [21, 13]];

/** Expected frame (N1 E2 S4 W8) at each tile. */
const EXPECTED = {
    '1,1': 6, '2,1': 10, '3,1': 14, '4,1': 10, '5,1': 12,
    '1,2': 5, '3,2': 5, '5,2': 5,
    '1,3': 7, '2,3': 10, '3,3': 15, '4,3': 10, '5,3': 13,
    '1,4': 5, '3,4': 5, '5,4': 5,
    '1,5': 3, '2,5': 10, '3,5': 11, '4,5': 10, '5,5': 9,
    '10,4': 2, '11,4': 10, '13,4': 8, // Horizontal Gate on 12,4 joins east and west
    '7,7': 4, '7,9': 1, // Vertical Gate on 7,8 joins north and south
    '20,2': 0, '17,13': 2, '18,13': 8, '21,11': 4, '21,12': 5, '21,13': 1,
};

const {start, buildHq, select} = hqFlow({pressWorld: clickWorld, pressAction: clickAction});

async function wallFrames(page) {
    const s = await sample(page);
    const at = new Map(s.buildings.filter((b) => b.type === 'wall').map((b) => [b.id, `${b.col},${b.row}`]));
    return Object.fromEntries(s.buildingArtViews.filter((v) => at.has(v.id)).map((v) => [at.get(v.id), v.frame]));
}

test('walls join by their cardinal neighbours and gate barriers, one 32 px sprite per tile, and follow removals', async ({page}, testInfo) => {
    test.setTimeout(60000); // about fifty real presses
    const state = await start(page, '?mutants=off');
    await buildHq(page, state, HQ);
    await clickAction(page, 'build-road');
    for (const [col, row] of [...NORTH_ROAD, ...WEST_ROAD]) await clickWorld(page, cellCenter(state.grid, {col, row}), state);
    await clickAction(page, 'cancel-placement');
    for (const [type, col, row] of [['gateHorizontal', 12, 4], ['gateVertical', 7, 8]]) {
        await clickAction(page, `build-${type}`);
        await clickWorld(page, cellCenter(state.grid, {col, row}), state);
        await expect.poll(async () => (await sample(page)).buildings.some((b) => b.type === type)).toBe(true);
        await clickAction(page, 'cancel-placement');
    }
    const cells = [...GRID, ...BY_GATES, ...LOOSE];
    await clickAction(page, 'build-wall');
    for (const [col, row] of cells) await clickWorld(page, cellCenter(state.grid, {col, row}), state);
    await clickAction(page, 'cancel-placement');
    await expect.poll(async () => (await sample(page)).buildings.filter((b) => b.type === 'wall').length).toBe(cells.length);

    await expect.poll(() => wallFrames(page)).toEqual(EXPECTED);
    const s = await sample(page);
    const {tileSize} = s.grid;
    for (const wall of s.buildings.filter((b) => b.type === 'wall')) {
        const view = s.buildingArtViews.find((v) => v.id === wall.id);
        const centre = cellCenter(s.grid, wall);
        // One sprite per wall, exactly its tile, centred on whole pixels; the footprint is unchanged.
        expect(view).toMatchObject({kind: 'wall', x: centre.x, y: centre.y, width: tileSize, height: tileSize, originY: 0.5});
        expect(Number.isInteger(view.x - tileSize / 2) && Number.isInteger(view.y - tileSize / 2)).toBe(true);
        expect([wall.width, wall.height, wall.hp]).toEqual([1, 1, 100]);
    }
    // Gates keep their own art, unrotated and closed.
    expect(s.gateViews.map(({kind, frame, angle}) => ({kind, frame, angle}))).toEqual(expect.arrayContaining([
        {kind: 'gateHorizontal', frame: 0, angle: 0}, {kind: 'gateVertical', frame: 0, angle: 0},
    ]));
    await page.screenshot({path: testInfo.outputPath('walls-v3.png')});
    // Close up, where seams would show: the wheel zooms at the pointer.
    const focus = await worldToScreen(page, cellCenter(s.grid, {col: 7, row: 5}), s);
    await page.mouse.move(focus.x, focus.y);
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -240);
    await expect.poll(async () => (await sample(page)).camera.zoom).toBeGreaterThan(2.5);
    await page.screenshot({path: testInfo.outputPath('walls-v3-zoom.png')});
    await clickAction(page, 'camera-fit');

    // Removing the crossing refreshes its four neighbours.
    const idAt = async (col, row) => (await sample(page)).buildings.find((b) => b.col === col && b.row === row).id;
    await select(page, state, {col: 3, row: 3}, await idAt(3, 3));
    await clickAction(page, 'demolish');
    // Removing a wall beside a gate leaves the gate as it was.
    await select(page, state, {col: 13, row: 4}, await idAt(13, 4));
    await clickAction(page, 'demolish');
    // Removing a gate turns the walls beside it into ends.
    await select(page, state, {col: 7, row: 8}, await idAt(7, 8));
    await clickAction(page, 'demolish');
    const after = {...EXPECTED, '3,2': 1, '2,3': 8, '4,3': 2, '3,4': 4, '7,7': 0, '7,9': 0};
    delete after['3,3'];
    delete after['13,4'];
    await expect.poll(() => wallFrames(page)).toEqual(after);
    const gates = (await sample(page)).gateViews;
    expect(gates.map(({kind, frame}) => ({kind, frame}))).toEqual([{kind: 'gateHorizontal', frame: 0}]);
    await page.screenshot({path: testInfo.outputPath('walls-v3-after.png')});
});

/** A close-up of one tile at the camera's top zoom, saved for a person to look at. */
async function closeUp(page, testInfo, s, cell, name) {
    const at = await worldToScreen(page, cellCenter(s.grid, cell), s);
    await page.mouse.move(at.x, at.y);
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -240);
    await expect.poll(async () => (await sample(page)).camera.zoom).toBeGreaterThan(3);
    const here = await worldToScreen(page, cellCenter(s.grid, cell), s);
    await page.screenshot({path: testInfo.outputPath(`${name}.png`), clip: {x: here.x - 90, y: here.y - 110, width: 180, height: 220}});
    await clickAction(page, 'camera-fit');
}

test('the wall\'s pillar sits centred in its BUILD card and its book plate; gates join walls cleanly', async ({page}, testInfo) => {
    test.setTimeout(60000);
    const state = await start(page, '?mutants=off');
    await buildHq(page, state, HQ);

    // BUILD: the card's picture is frame 0, the lone pillar, fitted by its own pixels.
    await clickAction(page, 'open-build');
    await expect.poll(async () => (await sample(page)).ui.drawerOpen).toBe(true);
    const card = (await sample(page)).buildButtonViews.wall;
    expect(card.art).toBe('papi-art-wall');
    await page.screenshot({path: testInfo.outputPath('build-wall-card.png')});
    await clickAction(page, 'open-build');

    // The Little Yellow Book: the walls page shows the same pillar, by the same bounds.
    await clickAction(page, 'open-manual');
    await clickAction(page, 'manual-chapter-military');
    for (let i = 0; i < 6 && (await sample(page)).fieldManualView.heading !== 'Walls, gates and outposts'; i++) {
        await clickAction(page, 'manual-next');
    }
    const book = (await sample(page)).fieldManualView;
    expect(book.heading).toBe('Walls, gates and outposts');
    expect(book.art.find((plate) => plate.kind === 'wall')).toMatchObject({frame: 0, bounds: {x: 22, y: 21, width: 20, height: 23}});
    expect(book.overflow).toEqual([]);
    await page.screenshot({path: testInfo.outputPath('manual-walls-page.png')});
    await page.keyboard.press('Escape');

    // Vertical Gates on the west road: walls north and south of one, south only of the other.
    await clickAction(page, 'build-road');
    for (const [col, row] of [...NORTH_ROAD, ...WEST_ROAD, [4, 8], [3, 8]]) await clickWorld(page, cellCenter(state.grid, {col, row}), state);
    await clickAction(page, 'cancel-placement');
    for (const [type, col, row] of [['gateVertical', 8, 8], ['gateVertical', 5, 8], ['gateHorizontal', 12, 4]]) {
        await clickAction(page, `build-${type}`);
        await clickWorld(page, cellCenter(state.grid, {col, row}), state);
        await expect.poll(async () => (await sample(page)).buildings.some((b) => b.col === col && b.row === row)).toBe(true);
        await clickAction(page, 'cancel-placement');
    }
    const walls = [[8, 7], [8, 9], [5, 9], [11, 4], [13, 4]];
    await clickAction(page, 'build-wall');
    for (const [col, row] of walls) await clickWorld(page, cellCenter(state.grid, {col, row}), state);
    await clickAction(page, 'cancel-placement');
    await expect.poll(() => wallFrames(page)).toEqual({'8,7': 4, '8,9': 1, '5,9': 1, '11,4': 2, '13,4': 8});

    const s = await sample(page);
    await closeUp(page, testInfo, s, {col: 5, row: 8}, 'gate-vertical-south');
    await closeUp(page, testInfo, s, {col: 8, row: 8}, 'gate-vertical-north-south');
    await closeUp(page, testInfo, s, {col: 12, row: 4}, 'gate-horizontal');
});
