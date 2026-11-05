import {test, expect} from '@playwright/test';
import {boot, body, byAction, clickAction, clickWorld} from '../helpers/canvas.js';
import {sample} from '../helpers/qa.js';

test('clicking Start on the canvas moves the phase to started', {tag: '@smoke'}, async ({page}) => {
    await boot(page, {scene: 'game', waitForQA: true});

    await clickAction(page, 'start');

    await expect(body(page)).toHaveAttribute('data-phase', 'started');
    expect((await sample(page)).phase).toBe('started');
});

test('after Start, title and Start button are hidden and inert', async ({page}) => {
    await boot(page, {scene: 'game', waitForQA: true});

    const startPoint = {x: 640, y: 668}; // Start button centre in world space
    await clickAction(page, 'start');
    await expect(body(page)).toHaveAttribute('data-phase', 'started');

    await expect(byAction(page, 'start')).toHaveCount(0);
    const after = await sample(page);
    expect(after.ui).toMatchObject({titleVisible: false, startVisible: false});

    // Clicking where the button used to be does nothing.
    await clickWorld(page, startPoint, after);
    const again = await sample(page);
    expect(again.phase).toBe('started');
    expect(again.grid).toEqual(after.grid);
    expect(again.buildings).toEqual([]);
});
