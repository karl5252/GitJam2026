import {test, expect} from '@playwright/test';
import {boot, body, clickAction} from '../helpers/canvas.js';
import {sample} from '../helpers/qa.js';

test('clicking Start on the canvas moves the phase to started', async ({page}) => {
    await boot(page, {scene: 'game', waitForQA: true});

    await clickAction(page, 'start');

    await expect(body(page)).toHaveAttribute('data-phase', 'started');
    expect((await sample(page)).phase).toBe('started');
});

test('clicking Start again keeps the phase at started', async ({page}) => {
    await boot(page, {scene: 'game', waitForQA: true});

    await clickAction(page, 'start');
    await expect(body(page)).toHaveAttribute('data-phase', 'started');

    await clickAction(page, 'start');
    await expect(body(page)).toHaveAttribute('data-phase', 'started');
    expect((await sample(page)).phase).toBe('started');
});
