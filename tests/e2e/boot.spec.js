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
        ui: {
            titleVisible: true, startVisible: true, cancelVisible: false,
            endDayVisible: false, endDayEnabled: false, buildMenuVisible: false, toggleVisible: false,
        },
        power: null,
        powerView: null,
        selectedBuilding: null,
        shiftCycle: null,
        settlement: null,
        settlementView: null,
        shiftView: null,
        placement: null,
        resources: null,
        pollution: null,
        pollutionView: null,
        mutants: null,
        mutantViews: null,
        hpBarViews: null,
        wave: null,
        waveProgress: null,
        waveView: null,
        defeat: null,
        gameOverView: null,
        autocannons: null,
        barrelViews: null,
        tracerViews: null,
        simulation: {
            running: false, paused: false, tick: 0, timeSeconds: 0, stepsExecuted: 0,
            rng: {seed: 731, state: 731},
        },
        hudView: null,
        menuState: null,
        menuLabels: null,
        previewView: null,
        buildings: [],
        buildingViews: [],
    });
});
