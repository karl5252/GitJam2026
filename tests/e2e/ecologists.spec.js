import {test, expect} from '@playwright/test';
import {clickAction, clickWorld} from '../helpers/canvas.js';
import {cellCenter, hqFlow, qaSim, stepExactly} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * TASK 027 through real presses, on the map a new game gets, in the real ACTIVE
 * cycle, with no mutants. HQ, a Plant and a Factory west of HQ whose dock road
 * joins the HQ ring. On the first timed Day one group (Pollution is below 40)
 * walks in from the dirt path, protests on the Factory's road and holds its
 * truck, then the protest ends, the truck drives on, and they walk out.
 * Dusk and Night (running, surviving, mutants) are covered by
 * tests/unit/ecologists.test.js, because one group a Day has left by Dusk.
 */

const mouse = {pressWorld: clickWorld, pressAction: clickAction};
const flow = hqFlow(mouse);

async function stepUntil(page, predicate, limit = 4000, chunk = 30) {
    for (let done = 0; done < limit; done += chunk) {
        const s = await sample(page);
        if (predicate(s)) return s;
        await stepExactly(page, chunk);
    }
    throw new Error('the condition never came');
}

test.describe('ecologists: desktop', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('a group walks in, protests on the delivery road, holds the truck, then leaves', async ({page}) => {
        test.setTimeout(90000);
        let s = await flow.start(page, '', {map: null, cycle: null, mutants: false});
        const {center} = s.terrain;
        const site = {col: center.col - 3, row: center.row};
        const dock = {col: center.col - 4, row: center.row};
        await flow.buildHq(page, s, center);
        await flow.place(page, s, 'powerPlant', {col: center.col + 5, row: center.row});
        await mouse.pressAction(page, 'build-road');
        for (const cell of [site, dock]) {
            const count = (await sample(page)).roads.tiles.length;
            await mouse.pressWorld(page, cellCenter(s.grid, cell), s);
            await expect.poll(async () => (await sample(page)).roads.tiles.length).toBe(count + 1);
        }
        await mouse.pressAction(page, 'cancel-placement');
        await flow.place(page, s, 'factory', {col: center.col - 6, row: center.row});
        expect((await sample(page)).ecologists.totals.groups).toBe(0); // Day 0: nobody

        // Through Dusk and Night 1 to the first timed Day.
        await mouse.pressAction(page, 'end-day');
        await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('dusk');
        await qaSim(page, 'pause');
        s = await stepUntil(page, (now) => now.shiftCycle.shift === 'day', 8000, 240);

        // They come in from the dirt path's map edge, one at a time.
        s = await stepUntil(page, (now) => now.ecologists.ecologists.length > 0);
        expect(s.ecologists.ecologists[0]).toMatchObject({col: s.ecologists.exit.col, row: s.ecologists.exit.row, state: 'arriving'});
        expect(s.ecologists.exit).toEqual(s.terrain.path[0]);

        // The protest: on the Factory's road, outlined, with the placard frames and a hint.
        s = await stepUntil(page, (now) => now.ecologists.blocked.length > 0, 3000);
        expect(s.ecologists.blocked).toEqual([site]);
        expect(s.ecologists.groups[0].size).toBeGreaterThanOrEqual(3);
        await stepExactly(page, 30);
        s = await sample(page);
        expect(s.ecologistViews.sites).toEqual([site]);
        const drawn = s.ecologistViews.ecologists;
        expect(drawn.every(({art, state}) => art && state === 'protesting')).toBe(true);
        expect(drawn.every(({frame}) => [8, 9, 10, 11].includes(frame))).toBe(true);
        expect(s.placementHint).toBe('ECOLOGISTAS! Protesters are blocking a delivery road');

        // The truck waits in front of them, route and cargo kept.
        // Either side of the protest: at its dock going out, or on the HQ ring coming back.
        const waits = [dock, {col: center.col - 2, row: center.row}];
        s = await stepUntil(page, (now) => {
            const [truck] = now.logistics.trucks;
            return truck.state !== 'idle' && waits.some((cell) => {
                const {x, y} = cellCenter(now.grid, cell);
                return truck.x === x && truck.y === y;
            });
        }, 900, 10);
        const held = s.logistics.trucks[0];
        await stepExactly(page, 120);
        s = await sample(page);
        expect(s.ecologists.blocked).toEqual([site]);
        expect(s.logistics.trucks[0]).toMatchObject({x: held.x, y: held.y, cargo: held.cargo, state: held.state});

        // It ends by itself, the truck drives on, and they walk back out.
        s = await stepUntil(page, (now) => now.ecologists.blocked.length === 0, 1000);
        expect(s.ecologists.groups[0].state).toBe('leaving');
        expect(s.ecologistViews.sites).toEqual([]);
        await stepExactly(page, 60);
        const moved = (await sample(page)).logistics.trucks[0];
        expect({x: moved.x, y: moved.y}).not.toEqual({x: held.x, y: held.y});
        s = await stepUntil(page, (now) => now.ecologists.ecologists.length === 0, 2000);
        expect(s.ecologists.totals).toMatchObject({groups: 1, protests: 1, killed: 0});
        expect(s.ecologists.totals.escaped).toBe(s.ecologists.totals.arrived);
    });
});
