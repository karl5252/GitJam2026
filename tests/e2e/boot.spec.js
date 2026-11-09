import {test, expect} from '@playwright/test';
import {boot, body} from '../helpers/canvas.js';
import {sample} from '../helpers/qa.js';

test('game boots into the game scene in the ready phase with a live QA surface', {tag: '@smoke'}, async ({page}) => {
    await boot(page, {scene: 'game', waitForQA: true});

    await expect(body(page)).toHaveAttribute('data-phase', 'ready');

    expect(await sample(page)).toEqual({
        scene: 'game',
        phase: 'ready',
        width: 1280,
        height: 720,
        grid: null,
        map: {id: 'open', cols: 24, rows: 16, seed: null, spawnFrame: null},
        terrain: null,
        terrainView: null,
        fog: null,
        fogView: null,
        workers: null,
        workerViews: null,
        deposits: null, // TASK 026
        buildingArtViews: null,
        ecologists: null, // TASK 027
        ecologistViews: null,
        selectedProtest: null, // TASK 027.1
        loudspeakers: null, // TASK 028
        speakerRingView: null,
        newspaper: null, // TASK 029
        newspaperView: null,
        audio: null, // TASK 030: ?audio=off
        nightTint: null,
        dayTimeView: null,
        actionAlphaView: null,
        selectedCell: null,
        highlight: null,
        ui: {
            titleVisible: true, startVisible: true, cancelVisible: false,
            endDayVisible: false, endDayEnabled: false, buildMenuVisible: false, toggleVisible: false,
            hintVisible: false, drawerOpen: false, newspaperOpen: false, layout: 'desktop',
        },
        camera: {zoom: 1, x: 640, y: 360, viewport: {x: 240, y: 88, width: 800, height: 544}, fitZoom: 1, maxZoom: 3.2},
        orientation: {blocked: false},
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
        shells: null,
        spitterEffectViews: null,
        siegeCannons: null,
        siegeShells: null,
        siegeViews: null,
        rockets: null,
        powerWarning: null,
        ghost: {active: false, cell: null, footprint: null, segment: [], ok: false, revision: 0, last: null},
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
            running: false, paused: false, tick: 0, timeSeconds: 0, speed: 1, stepsExecuted: 0,
            rng: {seed: 731, state: 731},
        },
        speedView: null,
        roads: null,
        roadViews: null,
        dockViews: null,
        dockPreviewView: null,
        logistics: null,
        truckViews: null,
        gates: null,
        gateViews: null,
        gatePreviewView: null,
        infantry: null,
        infantryViews: null,
        buildingControlsView: null,
        flagMode: null,
        roadMode: false,
        ringPreviewView: null,
        placementHint: null,
        hudView: null,
        menuState: null,
        menuLabels: null,
        previewView: null,
        buildings: [],
        buildingViews: [],
    });
});
