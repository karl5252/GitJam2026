import {test, expect} from '@playwright/test';
import {boot, body, clickAction} from '../helpers/canvas.js';

const VIEWPORT = {width: 844, height: 390};

test.use({viewport: VIEWPORT});

test('canvas fits a mobile landscape viewport', {tag: '@smoke'}, async ({page}) => {
    await boot(page, {scene: 'game'});

    const box = await page.locator('canvas').boundingBox();
    expect(box).toBeTruthy();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(VIEWPORT.height + 1);

    const scrolls = await page.evaluate(() => ({
        x: document.documentElement.scrollWidth > window.innerWidth,
        y: document.documentElement.scrollHeight > window.innerHeight,
    }));
    expect(scrolls).toEqual({x: false, y: false});
});

test('Start proxy stays aligned with the scaled canvas', async ({page}) => {
    await boot(page, {scene: 'game'});

    await clickAction(page, 'start');

    await expect(body(page)).toHaveAttribute('data-phase', 'started');
});
