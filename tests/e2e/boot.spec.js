import {test, expect} from '@playwright/test';
import {boot, body} from '../helpers/canvas.js';
import {sample} from '../helpers/qa.js';

test('game boots into the game scene in the ready phase with a live QA surface', async ({page}) => {
    await boot(page, {scene: 'game', waitForQA: true});

    await expect(body(page)).toHaveAttribute('data-phase', 'ready');

    expect(await sample(page)).toEqual({
        scene: 'game',
        phase: 'ready',
        width: 1280,
        height: 720,
        grid: null,
        selectedCell: null,
        highlight: null,
    });
});
