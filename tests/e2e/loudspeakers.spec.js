import {test, expect} from '@playwright/test';
import {byAction, clickAction, clickWorld, showBuildMenu, tapAction, tapWorld} from '../helpers/canvas.js';
import {cellCenter, hqFlow, qaSim, stepExactly} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * TASK 028 through real presses on the map a new game gets, in the real ACTIVE
 * cycle with no mutants: the tall Outpost and Loudspeaker art, HQ's one SPEAKERS
 * switch, a protest driven off by a tower, and the provisional menu layout.
 */

const mouse = {pressWorld: clickWorld, pressAction: clickAction};
const touch = {pressWorld: tapWorld, pressAction: tapAction};
const MIN_TOUCH = 44;

async function stepUntil(page, predicate, limit = 4000, chunk = 30) {
    for (let done = 0; done < limit; done += chunk) {
        const s = await sample(page);
        if (predicate(s)) return s;
        await stepExactly(page, chunk);
    }
    throw new Error('the condition never came');
}

const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test.describe('loudspeakers: desktop', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('tall towers stand on their tile; HQ switches every speaker; a tower drives a protest off', async ({page}) => {
        test.setTimeout(90000);
        const flow = hqFlow(mouse);
        let s = await flow.start(page, '', {map: null, cycle: null, mutants: false});
        const {center} = s.terrain;
        const site = {col: center.col - 3, row: center.row};
        const dock = {col: center.col - 4, row: center.row};

        // The seventh menu row and END DAY, moved to the bottom band, never overlap.
        const [speakerButton, endDay] = await Promise.all(['build-loudspeaker', 'end-day'].map((a) => byAction(page, a).boundingBox()));
        expect(overlap(speakerButton, endDay)).toBe(false);
        expect(s.menuLabels.loudspeaker).toBe('Loudspeaker\n250c · 1 AP');

        await flow.buildHq(page, s, center);
        await page.evaluate(() => window.__qa.economy.addCredits(2000)); // two towers, an Outpost, a Plant and a Factory
        await flow.place(page, s, 'powerPlant', {col: center.col + 5, row: center.row});
        const outpostCell = {col: center.col + 2, row: center.row - 4};
        const towerCell = {col: center.col - 2, row: center.row - 4};
        await flow.place(page, s, 'outpost', outpostCell);
        await flow.place(page, s, 'loudspeaker', towerCell);
        s = await sample(page);

        // Both are one tile, with art 32 wide standing on the tile's bottom edge, rising above it.
        const {grid} = s;
        const bottom = (cell) => grid.originY + (cell.row + 1) * grid.tileSize;
        for (const [type, cell, height] of [['outpost', outpostCell, 64], ['loudspeaker', towerCell, 72]]) {
            const building = s.buildings.find((b) => b.type === type);
            expect(building).toMatchObject({...cell, width: 1, height: 1});
            const art = s.buildingArtViews.find(({id}) => id === building.id);
            expect(art).toMatchObject({kind: type, width: 32, height, originY: 1, x: cellCenter(grid, cell).x, y: bottom(cell)});
            expect(art.depth).toBeCloseTo(1.5 + cell.row * 0.001, 6);
        }
        const outpost = s.buildings.find((b) => b.type === 'outpost');
        expect(s.power.buildings.find((b) => b.id === outpost.id)).toMatchObject({enabled: true, powered: true}); // unchanged rules

        // Selecting the tower shows its reach and no power switch of its own.
        const tower = s.buildings.find((b) => b.type === 'loudspeaker');
        await flow.select(page, s, towerCell, tower.id);
        s = await sample(page);
        expect(s.speakerRingView.visible).toBe(true);
        await expect(byAction(page, 'toggle-power')).toHaveCount(0);

        // HQ holds the one switch.
        await flow.select(page, s, center, s.buildings.find((b) => b.type === 'hq').id);
        await expect(byAction(page, 'loudspeakers')).toHaveAttribute('aria-label', 'SPEAKERS ON');
        await mouse.pressAction(page, 'loudspeakers');
        await expect.poll(async () => (await sample(page)).loudspeakers.network).toBe(false);
        expect((await sample(page)).buildings.find((b) => b.id === tower.id).enabled).toBe(false);
        await expect(byAction(page, 'loudspeakers')).toHaveAttribute('aria-label', 'SPEAKERS OFF');
        await mouse.pressAction(page, 'loudspeakers');
        await expect.poll(async () => (await sample(page)).loudspeakers.network).toBe(true);

        // A delivery road and a Factory, then a Day: the protest the tower is out of reach of.
        await mouse.pressAction(page, 'build-road');
        for (const cell of [site, dock]) {
            const count = (await sample(page)).roads.tiles.length;
            await mouse.pressWorld(page, cellCenter(grid, cell), s);
            await expect.poll(async () => (await sample(page)).roads.tiles.length).toBe(count + 1);
        }
        await mouse.pressAction(page, 'cancel-placement');
        await flow.place(page, s, 'factory', {col: center.col - 6, row: center.row});
        await mouse.pressAction(page, 'end-day');
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('dusk');
        await qaSim(page, 'pause');
        await stepUntil(page, (now) => now.shiftCycle.shift === 'day', 8000, 240);
        s = await stepUntil(page, (now) => now.ecologists.blocked.length > 0, 3000);
        expect(s.ecologists.blocked).toEqual([site]);

        // A second tower in reach of the site: the protest breaks up, and the road clears.
        await qaSim(page, 'resume');
        await flow.place(page, s, 'loudspeaker', {col: site.col, row: site.row + 3});
        await qaSim(page, 'pause');
        s = await stepUntil(page, (now) => now.ecologists.totals.repelled > 0, 60, 1);
        expect(s.ecologists.blocked).toEqual([]);
        expect(s.ecologists.groups[0].state).toBe('fleeing');
    });
});

for (const [label, viewport] of [['844x390', {width: 844, height: 390}], ['740x360', {width: 740, height: 360}]]) {
    test.describe(`loudspeakers: touch ${label}`, () => {
        test.use({viewport, hasTouch: true, isMobile: true});

        test('the drawer holds the Loudspeaker in a fourth row; every button is big enough and none overlap', async ({page}) => {
            test.setTimeout(45000); // a jungle boot, every drawer button measured, and a two-step build
            const flow = hqFlow(touch);
            const s = await flow.start(page, '', {map: null, cycle: null, mutants: false});
            await flow.buildHq(page, s, s.terrain.center);
            await showBuildMenu(page);
            const actions = await page.evaluate(() => [...document.querySelectorAll('[data-action^="build-"]')].map((el) => el.dataset.action));
            expect(actions).toContain('build-loudspeaker');
            const boxes = await Promise.all(actions.map(async (action) => ({action, box: await byAction(page, action).boundingBox()})));
            for (const {action, box} of boxes) {
                expect(box, action).not.toBeNull();
                expect(box.width, `${action} width`).toBeGreaterThanOrEqual(MIN_TOUCH);
                expect(box.height, `${action} height`).toBeGreaterThanOrEqual(MIN_TOUCH);
                expect(box.y + box.height, `${action} on screen`).toBeLessThanOrEqual(viewport.height);
            }
            for (let i = 0; i < boxes.length; i++) {
                for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i].box, boxes[j].box), `${boxes[i].action} / ${boxes[j].action}`).toBe(false);
            }
            // REPORT, the camera and END DAY are untouched by the drawer's new row.
            await tapAction(page, 'open-build'); // close it
            for (const action of ['camera-fit', 'camera-zoom-in', 'camera-zoom-out', 'end-day']) {
                const box = await byAction(page, action).boundingBox();
                expect(box?.width ?? 0, action).toBeGreaterThanOrEqual(MIN_TOUCH);
            }
            // The Loudspeaker can be built from it, with the two-step ghost.
            await flow.place(page, s, 'loudspeaker', {col: s.terrain.center.col + 3, row: s.terrain.center.row - 4});
            expect((await sample(page)).buildings.some((b) => b.type === 'loudspeaker')).toBe(true);
        });
    });
}
