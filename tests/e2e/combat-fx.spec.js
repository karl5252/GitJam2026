import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {clickAction, clickWorld, worldToScreen} from '../helpers/canvas.js';
import {hqFlow, qaSim, stepExactly} from '../helpers/hq.js';
import {sample} from '../helpers/qa.js';

/**
 * TASK 031 in a real Night on player-authored fortresses: Autocannon sparks,
 * rifle sparks, layered rocket and Siege Cannon explosions, and destruction.
 * SHOTS=<dir> also saves cropped screenshots of each moment for a visual check.
 */

const mouse = {pressWorld: clickWorld, pressAction: clickAction};
const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/layouts/${name}.json`, import.meta.url), 'utf8'));
const shots = process.env.SHOTS ?? null;

async function nightOn(page, layout, query) {
    const {start} = hqFlow(mouse);
    await start(page, query);
    const result = await page.evaluate((s) => window.__qa.layout.load(s), layout);
    expect(result.ok).toBe(true);
    await clickAction(page, 'end-day');
    await expect.poll(async () => (await sample(page)).shiftCycle.shift).toBe('night');
    await qaSim(page, 'pause');
}

/** Step until `predicate` holds of the effects, then let a frame draw them. */
async function stepUntilFx(page, predicate, limit = 3600, chunk = 4) {
    for (let done = 0; done < limit; done += chunk) {
        await stepExactly(page, chunk);
        await page.waitForTimeout(20); // a frame draws them
        // Only the effects while stepping (the whole QA state each step is slow); everything once it holds.
        const fx = await page.evaluate(() => window.__qa.getState().combatFx);
        if (predicate(fx)) return sample(page);
    }
    throw new Error('the effect never came');
}

async function snap(page, s, at, name, size = 160) {
    if (!shots) return;
    const p = await worldToScreen(page, at, s);
    const half = size / 2;
    await page.screenshot({path: `${shots}/${name}.png`, clip: {x: Math.max(0, p.x - half), y: Math.max(0, p.y - half), width: size, height: size}});
}

test.describe('combat fx: desktop', () => {
    test.use({viewport: {width: 1280, height: 720}});

    test('Autocannon sparks, layered rocket and Siege explosions, and never a bullet that explodes', async ({page}) => {
        test.setTimeout(120000);
        await nightOn(page, fixture('golden-fortress-brute-defense-v3'), 'waveBudget=30&waveBrutes=2');

        await stepUntilFx(page, (fx) => fx.totals.impacts.autocannon > 0);
        let s = await stepUntilFx(page, (fx) => fx.impacts.some((i) => i.type === 'autocannon' && i.ticks <= 1), 600, 1);
        const spark = s.combatFx.impacts.find((i) => i.type === 'autocannon' && i.ticks <= 1);
        await snap(page, s, spark, 'autocannon-sparks', 96);
        expect(s.combatFx.explosions.filter((e) => e.size !== 'medium' && e.size !== 'big')).toEqual([]);

        s = await stepUntilFx(page, (fx) => fx.explosions.some((e) => e.size === 'medium' && e.layers.every((l) => l.visible)));
        const rocket = s.combatFx.explosions.find((e) => e.size === 'medium');
        expect(rocket.layers.map((l) => l.sheet)).toEqual(['yellowA', 'stylizedC']);
        await snap(page, s, rocket, 'rocket-medium', 128);

        s = await stepUntilFx(page, (fx) => fx.explosions.some((e) => e.size === 'big' && e.layers.every((l) => l.visible)), 3600, 2);
        const big = s.combatFx.explosions.find((e) => e.size === 'big');
        expect(big.layers.map((l) => l.sheet)).toEqual(['yellowA', 'orangeC', 'stylizedC']);
        expect(Math.max(...big.layers.map((l) => l.width))).toBeGreaterThan(90);
        await snap(page, s, big, 'siege-big', 200);

        // However much fire, an explosion only ever comes from an explosive or a building.
        s = await sample(page);
        const {totals} = s.combatFx;
        expect(totals.impacts.autocannon).toBeGreaterThan(5);
        expect(totals.explosions.medium + totals.explosions.big).toBeGreaterThan(0);
        expect(totals.explosions.small).toBe(0); // no 1x1 building fell, and bullets never explode
        if (shots) await page.screenshot({path: `${shots}/heavy-combat.png`});
    });

    test('rifle squads leave small sparks on the body they hit', async ({page}) => {
        test.setTimeout(120000);
        await nightOn(page, fixture('golden-fortress-day33-v2'), 'waveBudget=40');
        await stepUntilFx(page, (fx) => fx.totals.impacts.rifle > 0);
        const s = await stepUntilFx(page, (fx) => fx.impacts.some((i) => i.type === 'rifle' && i.ticks <= 1), 600, 1);
        const rifle = s.combatFx.impacts.find((i) => i.type === 'rifle' && i.ticks <= 1);
        await snap(page, s, rifle, 'rifle-sparks', 96);
        expect(s.combatFx.explosions.filter((e) => e.size === 'small')).toEqual([]);
        // On the visible body: above the mutant's logical position, never at its feet.
        const mutant = s.mutants.find((m) => Math.abs(m.x - rifle.x) < 1 && m.y - rifle.y >= 6 && m.y - rifle.y <= 14);
        expect(mutant, 'a spark 6-14 px above a mutant it hit').toBeTruthy();
    });

    test('a Spitter shell splashes violet acid where it lands, beside its ring, and the splash ends', async ({page}) => {
        test.setTimeout(120000);
        await nightOn(page, fixture('golden-fortress-day33-v2'), 'waveBudget=12&waveSpitters=6');
        const s = await stepUntilFx(page, (fx) => fx.explosions.some((e) => e.size === 'acid' && e.layers[0].frame >= 4), 3600, 2);
        const acid = s.combatFx.explosions.find((e) => e.size === 'acid');
        expect(acid.layers).toHaveLength(1);
        expect(acid.layers[0]).toMatchObject({sheet: 'splatterViolet', width: 32, fps: 18});
        // Exactly where a shell landed: the Spitter impact ring is drawn on the same point.
        expect(s.spitterEffectViews.impacts.some((ring) => ring.x === acid.x && ring.y === acid.y)).toBe(true);
        await snap(page, s, acid, 'spitter-acid', 96);
        await stepExactly(page, 40);
        await expect.poll(async () => (await sample(page)).combatFx.explosions.filter((e) => e.size === 'acid' && e.x === acid.x && e.y === acid.y)).toEqual([]);
    });
});
