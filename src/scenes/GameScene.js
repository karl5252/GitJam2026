import Phaser from 'phaser';
import {GamePhase, defeatGame, startGame} from '../core/gamePhase.js';
import {Grid} from '../core/grid.js';
import {BARRACKS_TYPE, BUILDING_TYPES, HQ_TYPE, WALL_TYPE, getBuildingType} from '../core/buildingTypes.js';
import {BARRACKS_LIMIT, BuildingPlacement, FlagFailure, HQ_ALREADY_BUILT, MAX_BARRACKS} from '../core/buildingPlacement.js';
import {Economy} from '../core/economy.js';
import {SimulationClock} from '../core/simulationClock.js';
import {SeededRandom, DEFAULT_SEED, parseSeed} from '../core/seededRandom.js';
import {ShiftCycle, Shift} from '../core/shiftCycle.js';
import {Gates} from '../core/gates.js';
import {INFANTRY, Infantry} from '../core/infantry.js';
import {Logistics} from '../core/logistics.js';
import {ROAD_ACCESS_TYPES, RoadFailure, RoadNetwork, barracksExit, outgoingDock, receivingDock} from '../core/roads.js';
import {settleNight} from '../core/settlement.js';
import {calculatePower, PowerStatus} from '../core/power.js';
import {Pollution, calculateEmissions, threatLevel} from '../core/pollution.js';
import {Mutants} from '../core/mutants.js';
import {nightPlan, waveProgress} from '../core/waves.js';
import {Autocannons} from '../core/autocannons.js';
import {TEST_MODE} from '../testMode.js';
import {addProxy, markScene, setBodyState} from '../testShadow/TestProxy.js';
import {createEconomyQa} from '../testShadow/economyQa.js';
import {createLayoutQa} from '../testShadow/layoutSnapshot.js';
import {createPerfProbe} from '../testShadow/PerfProbe.js';
import {parseStressSchedule} from '../testShadow/stressParams.js';
import {QASurface} from '../testShadow/QASurface.js';
import {MutantLayer} from './MutantLayer.js';
import {AutocannonLayer} from './AutocannonLayer.js';
import {GameOverLayer} from './GameOverLayer.js';
import {SpeedControls} from './SpeedControls.js';
import {RoadLayer} from './RoadLayer.js';
import {TruckLayer} from './TruckLayer.js';
import {GateLayer} from './GateLayer.js';
import {InfantryLayer} from './InfantryLayer.js';
import {BuildingControls} from './BuildingControls.js';

const GRID_COLS = 24;
const GRID_ROWS = 16;
const TILE_SIZE = 32;

const GRID_LINE_COLOR = 0x78909c;
const HIGHLIGHT_COLOR = 0xffeb3b;
export const PREVIEW_VALID_COLOR = 0x4caf50;
export const PREVIEW_INVALID_COLOR = 0xe53935;
const ROAD_TILE_COLOR = 0x455a64; // a gate's barrier is drawn over its road
const BUILDING_COLORS = {
    hq: 0xc9a227, outpost: 0x9e9e9e, factory: 0x616161, powerPlant: 0x5c6bc0, autocannon: 0x00897b, barracks: 0x558b2f,
    wall: 0xa1887f, gateVertical: ROAD_TILE_COLOR, gateHorizontal: ROAD_TILE_COLOR,
};
const BUILDING_STROKE = 0x212121;
export const UNPOWERED_STROKE = 0xe53935; // enabled but not operating (low power / blackout)
export const DISABLED_ALPHA = 0.35; // switched OFF by the player

const PLACEMENT_HINTS = {
    [RoadFailure.NO_ROAD_ACCESS]: 'Factory dock (right side) needs a connected road',
    [RoadFailure.ROAD_OCCUPIED]: 'Buildings cannot go on roads',
    [RoadFailure.HQ_RING_OUT_OF_BOUNDS]: 'The HQ road ring must fit on the map',
    [RoadFailure.ROAD_REQUIRED]: 'A Factory dock depends on this road',
    [RoadFailure.HQ_RING_PERMANENT]: 'The HQ road ring is permanent',
    [RoadFailure.NOT_CONNECTED]: 'Roads must extend the connected network',
    [RoadFailure.GATE_NEEDS_ROAD]: 'Gates go on a road',
    [RoadFailure.GATE_NEEDS_STRAIGHT_ROAD]: 'This gate needs a straight road through it',
    [RoadFailure.GATE_ON_HQ_RING]: 'No gates on the HQ road ring',
    [RoadFailure.GATE_ON_DOCK]: 'No gates on a dock tile',
    [RoadFailure.GATE_DEPENDS_ON_ROAD]: 'A gate depends on this road',
    [RoadFailure.NO_EXIT_ACCESS]: 'Barracks exit (left side) needs a connected road',
    [RoadFailure.EXIT_REQUIRED]: 'A Barracks exit depends on this road',
    [BARRACKS_LIMIT]: `No more than ${MAX_BARRACKS} Barracks`,
    [FlagFailure.OCCUPIED]: 'Flags go on open ground or roads',
    [FlagFailure.TAKEN]: 'Another squad holds this tile',
    [FlagFailure.UNREACHABLE]: 'Soldiers cannot reach this tile',
};

const POWER_STATUS_LABELS = {
    [PowerStatus.NORMAL]: 'NORMAL',
    [PowerStatus.LOW_POWER]: 'LOW POWER',
    [PowerStatus.BLACKOUT]: 'BLACKOUT',
};

const BUTTON_IDLE_STROKE = 0x90a4ae;
const BUTTON_SELECTED_STROKE = 0xffeb3b;
const BUTTON_DISABLED_ALPHA = 0.45;

// Build menu lives in the band left of the grid (grid x starts at 256), in two
// columns. Every button is at least 82 logical pixels on each side, which is 44
// CSS pixels at 844x390. Road, Wall, Barracks and the gates fill the slots below
// the buildings; slots run left to right, top to bottom. The menu is now full:
// slot 10 would run into END DAY.
const MENU_X = 128;
const MENU_BUTTON = {width: 192, height: 84};
const MENU_CELL = {width: 120, height: 84};
const MENU_COLUMNS = [66, 190];
const MENU_TOP = 122;
const MENU_STEP = 88;
const MENU_SLOTS = {road: 5, wall: 6, barracks: 7, gateVertical: 8, gateHorizontal: 9};
const RIGHT_ACTION = {x: 1152, y: 560}; // Cancel and the selection button share it: placing clears selection
const menuSlot = (slot) => ({x: MENU_COLUMNS[slot % 2], y: MENU_TOP + Math.floor(slot / 2) * MENU_STEP});

/**
 * Title + Start button. Start (READY -> STARTED) hides both, creates a 24x16
 * grid (32px cells) centred in the 1280x720 area and shows the build menu.
 *
 * Input modes after Start:
 *   - Normal: pointerdown on the grid selects/highlights a cell; outside the
 *     grid clears the selection.
 *   - Placement (a building button was pressed): pointermove previews the
 *     centred footprint, pointerdown attempts placement, and walls also follow
 *     a drag. Selection is disabled. Escape or Cancel returns to normal mode.
 *   - Road (the Road button was pressed): a press adds or removes a road, and
 *     a drag only adds.
 *
 * Rules live in core (Grid, BuildingPlacement). The preview colour is
 * derived from the domain validation result, never the reverse.
 *
 * Pointer events whose target is a UI button are never treated as grid
 * input (Phaser passes the hit objects to the scene-level handler).
 *
 * Test Shadow usage:
 *   - addProxy for real buttons, such as start, build-* and cancel-placement.
 *     Grid cells deliberately get no proxies.
 *   - markScene()/setBodyState() — coarse `data-phase` on <body>.
 *   - QASurface — grid, selection, placement result, rendered preview and
 *     building views.
 */
export class GameScene extends Phaser.Scene {
    constructor() {
        super('game');
    }

    create() {
        const {width} = this.scale;
        this.phase = GamePhase.READY;
        this.grid = null;
        this.placement = null;
        this.economy = null;
        this.pollution = null;
        this.hud = null;
        this.pollutionHud = null;
        this.waveHud = null;
        this.mutants = null;
        this.mutantLayer = null;
        this.autocannons = null;
        this.autocannonLayer = null;
        this.gameOverLayer = null;
        this.hqRequired = true;
        this.lastResult = null;
        this.selectedCell = null;
        this.selectionHighlight = null;
        this.previewRect = null;
        this.previewResult = null;
        this.buildingViews = new Map();
        this.buildButtons = {};
        this.cancelButton = null;
        this.cancelProxy = null;
        this.endDayButton = null;
        this.endDayProxy = null;
        this.cycle = null;
        this.shiftHud = null;
        this.settlementPanel = null;
        this.powerHud = null;
        this.selectedBuildingId = null;
        this.toggleButton = null;
        this.toggleProxy = null;
        this.speedControls = null;
        this.roads = null;
        this.roadLayer = null;
        this.logistics = null;
        this.truckLayer = null;
        this.gates = null;
        this.gateLayer = null;
        this.infantry = null;
        this.infantryLayer = null;
        this.buildingControls = null;
        this.flagBarracksId = null; // the Barracks being given a flag, in flag mode
        this.renderedPostsKey = null; // last revision and selection the flags were drawn for
        this.dragCell = null;
        this.roadButton = null;
        this.roadProxy = null;
        this.roadMode = false;
        this.roadDragAdds = false;
        this.placementHint = null;
        this.renderedShiftKey = null; // last `${day}:${shift}` the UI was synced to

        // Fixed 60 Hz simulation. Stopped until Start; stepped from update().
        // The seed is fixed outside TEST_MODE; tests may override it with ?seed=N.
        this.clock = new SimulationClock();
        const seedOverride = TEST_MODE ? parseSeed(new URLSearchParams(window.location.search).get('seed')) : null;
        this.rng = new SeededRandom(seedOverride ?? DEFAULT_SEED);
        this.simulationSteps = 0;

        this.title = this.add.text(width / 2, 52, 'PAPI Industries: The Green Shift', {
            fontFamily: 'monospace',
            fontSize: '48px',
            color: '#c8e6c9',
        }).setOrigin(0.5);

        this.startButton = this.add.rectangle(width / 2, 668, 240, 72, 0x2e7d32)
            .setStrokeStyle(3, 0xa5d6a7)
            .setInteractive({useHandCursor: true});
        this.startLabel = this.add.text(this.startButton.x, this.startButton.y, 'START', {
            fontFamily: 'monospace',
            fontSize: '32px',
            color: '#ffffff',
        }).setOrigin(0.5);

        this.startButton.on('pointerdown', () => this.handleStart());
        this.startProxy = addProxy(this, this.startButton, 'start', {label: 'Start'});

        this.input.on('pointerdown', (pointer, over) => this.handleGridPointerDown(pointer, over));
        this.input.on('pointermove', (pointer, over) => this.handleGridPointerMove(pointer, over));
        this.input.keyboard.on('keydown-ESC', () => this.exitPlacementMode());

        // Instantiated BEFORE markScene: the QA surface should exist by the
        // time a test sees data-scene appear.
        this.qa = new QASurface(this, () => this.qaState());

        // Game-specific, TEST_MODE-only simulation controls. They call the
        // real clock / shift-cycle methods; stepTicks uses the same callback
        // as update() and drives real shift transitions. resume and stepTicks
        // never tick during Day Shift. They cannot place or spend anything;
        // only __qa.economy, a manual testing aid, changes a balance.
        // window.__qa (and these controls) are removed with the QASurface on
        // shutdown and never exist in production builds.
        if (TEST_MODE && window.__qa) {
            window.__qa.sim = {
                pause: () => {
                    this.clock.pause();
                    this.syncShiftUi(); // like stepTicks, so the HUD never lags behind QA
                    return this.clock.snapshot();
                },
                resume: () => {
                    this.cycle?.resume();
                    return this.clock.snapshot();
                },
                stepTicks: (count) => {
                    const onTick = (tick) => this.stepSimulation(tick);
                    const done = this.cycle
                        ? this.cycle.stepTicks(count, onTick)
                        : this.clock.stepTicks(count, onTick); // before Start: validates, returns 0
                    this.syncShiftUi();
                    return done;
                },
            };
            window.__qa.perf = createPerfProbe(this);
            window.__qa.layout = createLayoutQa(this);
            window.__qa.economy = createEconomyQa(this);
        }

        markScene(this, {phase: this.phase});
    }

    // ---- Start -------------------------------------------------------------

    handleStart() {
        const previous = this.phase;
        this.phase = startGame(this.phase);
        if (previous === GamePhase.READY && this.phase === GamePhase.STARTED) {
            this.title.setVisible(false);
            this.startLabel.setVisible(false);
            this.startButton.setVisible(false).disableInteractive();
            this.startProxy.destroy();
            this.startProxy = null;

            this.createGrid();
            this.createHud();
            this.createBuildMenu();
            this.speedControls = new SpeedControls(this, this.clock);
            this.cycle.begin(); // Day 1; the clock starts paused for Day Shift
            this.syncShiftUi();
            this.refreshPower();
        }
        setBodyState({phase: this.phase});
    }

    createGrid() {
        const {width, height} = this.scale;
        this.grid = new Grid({
            cols: GRID_COLS,
            rows: GRID_ROWS,
            tileSize: TILE_SIZE,
            originX: (width - GRID_COLS * TILE_SIZE) / 2,
            originY: (height - GRID_ROWS * TILE_SIZE) / 2,
        });
        this.economy = new Economy();
        this.pollution = new Pollution();
        // Orchestration only: the settlement formula lives in core/settlement.js.
        // TEST_MODE only: ?hq=off is a compatibility mode for legacy suites that
        // predate the HQ-first flow. Real play always requires HQ.
        this.hqRequired = !(TEST_MODE && new URLSearchParams(window.location.search).get('hq') === 'off');
        this.cycle = new ShiftCycle({
            clock: this.clock,
            economy: this.economy,
            canEndDay: () => !this.hqRequired || this.placement.hqBuilt,
            settleNight: (day) => settleNight({
                day,
                buildings: this.placement.buildings(),
                economy: this.economy,
                pollution: this.pollution,
            }),
        });
        // No HQ means no network, so ?hq=off plays without road rules.
        this.roads = this.hqRequired ? new RoadNetwork({grid: this.grid}) : null;
        this.placement = new BuildingPlacement(this.grid, this.economy, {
            isConstructionAllowed: () => this.cycle.isConstructionAllowed,
            requireHq: this.hqRequired,
            roads: this.roads,
        });
        this.roadLayer = new RoadLayer(this, this.grid);
        this.gates = new Gates({cycle: this.cycle, placement: this.placement, grid: this.grid});
        this.gateLayer = new GateLayer(this, this.grid);
        this.logistics = this.roads ? new Logistics({
            cycle: this.cycle,
            placement: this.placement,
            grid: this.grid,
            roads: this.roads,
            economy: this.economy,
            gates: this.gates,
        }) : null;
        this.truckLayer = new TruckLayer(this, this.grid);
        // TEST_MODE only: ?mutants=off gives the real system an empty schedule,
        // for E2E suites about power, economy and pollution, and the soak suites
        // can set a fixed one. Otherwise the formula in core/waves.js plans each
        // night.
        const mutantsOff = TEST_MODE && new URLSearchParams(window.location.search).get('mutants') === 'off';
        const fixedSchedule = TEST_MODE ? (mutantsOff ? [] : parseStressSchedule(window.location.search)) : null;
        this.mutants = new Mutants({
            cycle: this.cycle,
            placement: this.placement,
            grid: this.grid,
            rng: this.rng,
            schedule: fixedSchedule ?? [],
            logistics: this.logistics,
            gates: this.gates,
            planNight: fixedSchedule ? null : (day) => nightPlan({
                day,
                pollution: this.pollution.value,
                buildings: this.placement.buildings(),
            }),
        });
        this.mutantLayer = new MutantLayer(this, this.grid);
        this.autocannons = new Autocannons({
            cycle: this.cycle,
            placement: this.placement,
            grid: this.grid,
            mutants: this.mutants,
        });
        this.autocannonLayer = new AutocannonLayer(this, this.grid);
        // Barracks need a road exit, so ?hq=off has none.
        this.infantry = this.roads ? new Infantry({
            cycle: this.cycle,
            placement: this.placement,
            grid: this.grid,
            gates: this.gates,
            mutants: this.mutants,
        }) : null;
        this.mutants.setInfantry(this.infantry);
        this.infantryLayer = this.infantry ? new InfantryLayer(this, this.grid) : null;
        this.gameOverLayer = new GameOverLayer(this, () => this.scene.restart());

        const bounds = this.grid.footprintRect({col: 0, row: 0, width: GRID_COLS, height: GRID_ROWS});
        const lines = this.add.graphics();
        lines.lineStyle(1, GRID_LINE_COLOR, 0.6);
        lines.beginPath();
        for (let col = 0; col <= GRID_COLS; col++) {
            const x = bounds.x + col * TILE_SIZE;
            lines.moveTo(x, bounds.y);
            lines.lineTo(x, bounds.y + bounds.height);
        }
        for (let row = 0; row <= GRID_ROWS; row++) {
            const y = bounds.y + row * TILE_SIZE;
            lines.moveTo(bounds.x, y);
            lines.lineTo(bounds.x + bounds.width, y);
        }
        lines.strokePath();

        this.selectionHighlight = this.add.rectangle(0, 0, TILE_SIZE, TILE_SIZE, HIGHLIGHT_COLOR, 0.35)
            .setOrigin(0, 0)
            .setStrokeStyle(2, HIGHLIGHT_COLOR)
            .setVisible(false)
            .setDepth(2);

        this.previewRect = this.add.rectangle(0, 0, TILE_SIZE, TILE_SIZE, PREVIEW_VALID_COLOR, 0.4)
            .setOrigin(0, 0)
            .setVisible(false)
            .setDepth(3);
    }

    // ---- HUD ---------------------------------------------------------------

    createHud() {
        // Top band, where the (now hidden) title was: shift line, then resources.
        this.shiftHud = this.add.text(this.scale.width / 2, 30, '', {
            fontFamily: 'monospace',
            fontSize: '24px',
            color: '#c8e6c9',
        }).setOrigin(0.5);
        this.hud = this.add.text(this.scale.width / 2, 70, '', {
            fontFamily: 'monospace',
            fontSize: '28px',
            color: '#ffffff',
        }).setOrigin(0.5);
        // Top of the left band, clear of the centred shift line. Night only.
        this.waveHud = this.add.text(16, 20, '', {
            fontFamily: 'monospace',
            fontSize: '20px',
            color: '#ffffff',
        }).setOrigin(0, 0).setVisible(false);
        // Top of the right band, clear of the centred shift and resource lines.
        this.pollutionHud = this.add.text(1040, 16, '', {
            fontFamily: 'monospace',
            fontSize: '22px',
            color: '#ffffff',
            lineSpacing: 4,
        }).setOrigin(0, 0);
        // Right band beside the grid (grid ends at x 1024): global power
        // summary, then the latest nightly settlement (hidden until the first
        // night completes).
        this.powerHud = this.add.text(1040, 112, '', {
            fontFamily: 'monospace',
            fontSize: '20px',
            color: '#ffffff',
            lineSpacing: 4,
        }).setOrigin(0, 0);
        // Under the resource line, just above the grid.
        this.placementHint = this.add.text(this.scale.width / 2, 94, '', {
            fontFamily: 'monospace',
            fontSize: '16px',
            color: '#ffcc80',
        }).setOrigin(0.5);
        this.settlementPanel = this.add.text(1040, 190, '', {
            fontFamily: 'monospace',
            fontSize: '20px',
            color: '#ffffff',
            backgroundColor: '#263238',
            padding: {x: 8, y: 6},
            lineSpacing: 4,
        }).setOrigin(0, 0).setVisible(false);
        this.updateHud();
        this.updatePollutionHud();
    }

    /** Render a settlement report (already calculated in core). */
    showSettlement(report) {
        const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
        const delivered = this.logistics?.lastNight?.credits ?? 0; // paid on delivery, shown here
        this.settlementPanel.setText([
            `Night ${report.day} settlement`,
            `Income  ${signed(report.gross + delivered)}`,
            `Upkeep  ${signed(-report.upkeep)}`,
            `Net     ${signed(report.net + delivered)}`,
            `Credits ${report.creditsAfter}`,
            `Power   ${POWER_STATUS_LABELS[report.power.status]}`,
        ].join('\n')).setVisible(true);
    }

    /**
     * Re-derive power from the building records and render it: the summary
     * text and each building's look. Called right after placement, toggling
     * and shift changes — never per frame, and nothing is cached.
     */
    refreshPower() {
        const power = calculatePower(this.placement.buildings());
        this.powerHud.setText(`Power ${power.generation} / ${power.demand}\n${POWER_STATUS_LABELS[power.status]}`);
        for (const {id, enabled, powered} of power.buildings) {
            const view = this.buildingViews.get(id);
            view.setAlpha(enabled ? 1 : DISABLED_ALPHA);
            if (enabled && !powered) view.setStrokeStyle(3, UNPOWERED_STROKE);
            else view.setStrokeStyle(2, BUILDING_STROKE);
        }
        this.updateToggleButton();
    }

    updateHud() {
        const {credits, ap} = this.economy.snapshot();
        this.hud.setText(`Credits: ${credits}   AP: ${ap}`);
    }

    updatePollutionHud() {
        const {value} = this.pollution.snapshot();
        this.pollutionHud.setText(`Pollution ${value}\nThreat Level ${threatLevel(value)}`);
    }

    /** Living mutants, then scheduled slots reached out of total. Not a kill counter. */
    updateWaveHud(mutants) {
        const plan = this.mutants.plan();
        const visible = plan !== null && this.cycle.shift === Shift.NIGHT;
        this.waveHud.setVisible(visible);
        if (!visible) return;
        const reached = waveProgress(plan, this.cycle.elapsedNightTicks);
        const text = `Mutants ${mutants.length} | Wave ${reached}/${plan.schedule.length}`;
        if (this.waveHud.text !== text) this.waveHud.setText(text);
    }

    /** Shift line; the night countdown is derived from remaining simulation ticks. */
    updateShiftHud() {
        const {day, shift, remainingNightTicks} = this.cycle.snapshot();
        let text = `Day ${day} · Day Shift`;
        if (shift === Shift.DEFEATED) text = `Day ${day} · Headquarters destroyed`;
        if (shift === Shift.NIGHT) {
            text = `Day ${day} · Night Shift · ${(remainingNightTicks / this.clock.tickRate).toFixed(1)} s left`
                + (this.clock.paused ? ' (paused)' : '');
        }
        if (this.shiftHud.text !== text) this.shiftHud.setText(text);
    }

    /**
     * Bring shift-dependent UI in line with the domain cycle. Called after
     * every clock advance / manual step and after END DAY; the expensive
     * part only runs when day or shift actually changed.
     */
    syncShiftUi() {
        if (!this.cycle?.started) return;
        const key = `${this.cycle.day}:${this.cycle.shift}`;
        if (key !== this.renderedShiftKey) {
            this.renderedShiftKey = key;
            this.exitFlagMode();
            const isDay = this.cycle.shift === Shift.DAY;
            if (!isDay) this.exitPlacementMode();
            this.setBuildMenuVisible(isDay);
            this.setEndDayVisible(isDay);
            this.speedControls.setVisible(this.cycle.shift === Shift.NIGHT);
            this.updateHud(); // AP is restored and the night settled at the start of each Day
            this.updatePollutionHud();
            if (isDay && this.cycle.lastSettlement) this.showSettlement(this.cycle.lastSettlement);
            if (this.cycle.shift === Shift.DEFEATED) this.enterDefeat();
            this.updateToggleButton(); // Demolish is for Day
        }
        this.updateShiftHud();
        const mutants = this.mutants.snapshot();
        const buildings = this.placement.buildings();
        this.mutantLayer.sync(mutants, buildings);
        this.updateWaveHud(mutants);
        if (this.logistics) this.truckLayer.sync(this.logistics.snapshot());
        this.gateLayer.sync(this.gates.snapshot());
        this.autocannonLayer.sync({
            cannons: this.autocannons.snapshot(),
            mutants,
            buildings,
            tick: this.clock.tick,
            isNight: this.cycle.shift === Shift.NIGHT,
        });
        if (this.infantry) this.syncInfantry();
    }

    /** Soldiers every frame; flags only when walking or the selection changed. */
    syncInfantry() {
        const key = `${this.placement.revision}:${this.selectedBuildingId}:${this.flagBarracksId}`;
        if (key !== this.renderedPostsKey) {
            this.renderedPostsKey = key;
            this.infantryLayer.syncPosts(this.infantry.posts(), this.placement.barracks(), this.selectedBuildingId ?? this.flagBarracksId);
        }
        this.infantryLayer.sync({
            soldiers: this.infantry.soldiers().map((soldier) => ({...soldier, maxHp: INFANTRY.maxHp})),
            tick: this.clock.tick,
            isNight: this.cycle.shift === Shift.NIGHT,
        });
    }

    /** Runs once: the Day/Night key changes only once into the defeated state. */
    enterDefeat() {
        this.phase = defeatGame(this.phase);
        this.selectAt(null);
        this.gameOverLayer.show(this.cycle.defeatReport);
        setBodyState({phase: this.phase});
    }

    handleEndDay() {
        if (!this.cycle.canEndDay) return; // disabled, and must not disturb placement
        this.exitPlacementMode();
        this.cycle.endDay();
        this.syncShiftUi();
    }

    // ---- Build menu --------------------------------------------------------

    createButton(y, label, fill, x = MENU_X, size = MENU_BUTTON) {
        const rect = this.add.rectangle(x, y, size.width, size.height, fill)
            .setStrokeStyle(3, BUTTON_IDLE_STROKE)
            .setInteractive({useHandCursor: true})
            .setDepth(4);
        const text = this.add.text(x, y, label, {
            fontFamily: 'monospace',
            fontSize: '20px',
            color: '#ffffff',
            align: 'center',
        }).setOrigin(0.5).setDepth(5);
        return {rect, text};
    }

    /** A half-width menu button, in one of the two columns. */
    createMenuCell(slot, label) {
        const {x, y} = menuSlot(slot);
        const button = this.createButton(y, label, 0x37474f, x, MENU_CELL);
        button.text.setStyle({fontSize: '17px', wordWrap: {width: MENU_CELL.width - 6}});
        return button;
    }

    addBuildButton(slot, type, label) {
        const button = this.createMenuCell(slot, label);
        button.rect.on('pointerdown', () => this.enterPlacementMode(type.id));
        button.type = type;
        button.proxy = null;
        this.buildButtons[type.id] = button;
    }

    createBuildMenu() {
        const buildings = Object.values(BUILDING_TYPES)
            .filter((t) => !t.fortification && t.id !== BARRACKS_TYPE && (this.hqRequired || t.id !== HQ_TYPE));
        buildings.forEach((type, slot) => {
            this.addBuildButton(slot, type, `${type.name} ${type.width}x${type.height}\n${type.cost.credits}c · ${type.cost.ap} AP`);
        });

        if (this.roads) {
            this.roadButton = this.createMenuCell(MENU_SLOTS.road, 'Road\nfree');
            this.roadButton.rect.on('pointerdown', () => this.enterRoadMode());
            const cost = ({cost: {credits, ap}}) => (ap ? `${credits}c · ${ap} AP` : `${credits}c`);
            const {barracks, wall, gateVertical, gateHorizontal} = BUILDING_TYPES;
            this.addBuildButton(MENU_SLOTS.barracks, barracks, `Barracks 3x3\n${cost(barracks)}`);
            this.addBuildButton(MENU_SLOTS.wall, wall, `Wall\n${cost(wall)}`);
            this.addBuildButton(MENU_SLOTS.gateVertical, gateVertical, `Gate |\n${cost(gateVertical)}`);
            this.addBuildButton(MENU_SLOTS.gateHorizontal, gateHorizontal, `Gate —\n${cost(gateHorizontal)}`);
        }

        this.cancelButton = this.createButton(RIGHT_ACTION.y, 'Cancel', 0x8e2b2b, RIGHT_ACTION.x);
        this.cancelButton.rect.on('pointerdown', () => this.exitPlacementMode());
        this.setCancelVisible(false);

        // Bottom of the left band, clear of the grid (grid x starts at 256).
        this.endDayButton = this.createButton(620, 'END DAY', 0x6d4c41);
        this.endDayButton.rect.on('pointerdown', () => this.handleEndDay());

        // What can be done to the selected building, right band: its power
        // switch in Day AND Night, and above it Demolish during Day and any flag.
        this.toggleButton = this.createButton(RIGHT_ACTION.y, '', 0x37474f, RIGHT_ACTION.x);
        this.toggleButton.rect.on('pointerdown', () => this.handleSelectionAction());
        this.buildingControls = new BuildingControls(this, {
            onFlag: () => this.enterFlagMode(),
            onDemolish: () => this.handleDemolish(),
        });
        this.updateToggleButton();
    }

    // ---- Building selection / power switch ---------------------------------

    /** The selected building, and whether Demolish applies to it right now. */
    selection() {
        const building = this.selectedBuildingId
            ? this.placement.buildings().find((b) => b.id === this.selectedBuildingId)
            : null;
        const type = building ? getBuildingType(building.type) : null;
        const demolishable = Boolean(type) && type.demolishable !== false && this.cycle.isConstructionAllowed;
        return {building, type, demolishable};
    }

    /** The power switch shows for a switchable building, in Day and Night. The other actions follow. */
    updateToggleButton() {
        const {building, type, demolishable} = this.selection();
        this.buildingControls.update(building, {
            canFlag: type?.id === BARRACKS_TYPE,
            canDemolish: demolishable,
            confirmDemolish: !type?.fortification,
        });
        const {rect, text} = this.toggleButton;
        const switchable = Boolean(type) && type.switchable !== false;
        rect.setVisible(switchable);
        text.setVisible(switchable);
        if (!switchable) {
            this.toggleProxy?.destroy();
            this.toggleProxy = null;
            rect.disableInteractive();
            return;
        }
        rect.setInteractive({useHandCursor: true});
        text.setText(`${building.id}\n${building.enabled ? 'Switch OFF' : 'Switch ON'}`);
        this.toggleProxy ??= addProxy(this, rect, 'toggle-power', {label: 'Toggle power'});
        this.toggleProxy.set({target: building.id, enabled: building.enabled});
    }

    /** Act on the selected building through the real domain methods. */
    handleSelectionAction() {
        const {building} = this.selection();
        if (!building) return;
        this.buildingControls.disarm();
        this.placement.setEnabled(building.id, !building.enabled);
        this.refreshPower();
    }

    handleDemolish() {
        const {building} = this.selection();
        if (building && this.placement.demolish(building.id).ok) this.handleBuildingsDestroyed([building.id]);
    }

    /** Show/enable the building buttons (Day) or hide/disable them (Night). */
    setBuildMenuVisible(visible) {
        for (const button of Object.values(this.buildButtons)) {
            button.rect.setVisible(visible).setStrokeStyle(3, BUTTON_IDLE_STROKE);
            button.text.setVisible(visible);
            if (visible) {
                button.rect.setInteractive({useHandCursor: true});
                button.proxy ??= addProxy(this, button.rect, `build-${button.type.id}`, {
                    label: button.type.name,
                    state: {selected: false},
                });
                button.proxy.set({selected: false});
            } else {
                button.rect.disableInteractive();
                button.proxy?.destroy();
                button.proxy = null;
            }
        }
        if (this.roadButton) {
            const {rect, text} = this.roadButton;
            rect.setVisible(visible).setStrokeStyle(3, BUTTON_IDLE_STROKE);
            text.setVisible(visible);
            if (visible) {
                rect.setInteractive({useHandCursor: true});
                this.roadProxy ??= addProxy(this, rect, 'build-road', {label: 'Road'});
                this.roadProxy.set({selected: false});
            } else {
                rect.disableInteractive();
                this.roadProxy?.destroy();
                this.roadProxy = null;
            }
        }
        if (visible) this.refreshBuildMenu();
    }

    /** 'available', 'locked' until HQ stands, or 'built' for an HQ already placed. */
    buildState(typeId) {
        const {ok, reason} = this.placement.canBuild(typeId);
        if (ok) return 'available';
        return reason === HQ_ALREADY_BUILT ? 'built' : 'locked';
    }

    /** Disabled buttons stay visible and pressable, but pressing them does nothing. */
    refreshBuildMenu() {
        for (const [id, button] of Object.entries(this.buildButtons)) {
            const state = this.buildState(id);
            const alpha = state === 'available' ? 1 : BUTTON_DISABLED_ALPHA;
            button.rect.setAlpha(alpha);
            button.text.setAlpha(alpha);
            if (state === 'built') button.text.setText(`${button.type.name} ${button.type.width}x${button.type.height}\nBUILT`);
            button.proxy?.set({state});
        }
        if (this.roadButton) {
            const alpha = this.placement.hqBuilt ? 1 : BUTTON_DISABLED_ALPHA;
            this.roadButton.rect.setAlpha(alpha);
            this.roadButton.text.setAlpha(alpha);
            this.roadProxy?.set({state: this.placement.hqBuilt ? 'available' : 'locked'});
        }
    }

    refreshEndDay() {
        const enabled = this.cycle.canEndDay;
        const alpha = enabled ? 1 : BUTTON_DISABLED_ALPHA;
        this.endDayButton.rect.setAlpha(alpha);
        this.endDayButton.text.setAlpha(alpha);
        this.endDayProxy?.set({enabled});
    }

    setEndDayVisible(visible) {
        const {rect, text} = this.endDayButton;
        rect.setVisible(visible);
        text.setVisible(visible);
        if (visible) {
            rect.setInteractive({useHandCursor: true});
            this.endDayProxy ??= addProxy(this, rect, 'end-day', {label: 'End Day'});
            this.refreshEndDay();
        } else {
            rect.disableInteractive();
            this.endDayProxy?.destroy();
            this.endDayProxy = null;
        }
    }

    setCancelVisible(visible) {
        const {rect, text} = this.cancelButton;
        rect.setVisible(visible);
        text.setVisible(visible);
        if (visible) {
            rect.setInteractive({useHandCursor: true});
            if (!this.cancelProxy) {
                this.cancelProxy = addProxy(this, rect, 'cancel-placement', {label: 'Cancel'});
            }
        } else {
            rect.disableInteractive();
            if (this.cancelProxy) {
                this.cancelProxy.destroy();
                this.cancelProxy = null;
            }
        }
    }

    // ---- Placement mode ----------------------------------------------------

    enterPlacementMode(typeId) {
        this.exitRoadMode();
        this.exitFlagMode();
        if (!this.placement.select(typeId)) return;
        this.showHint(null);

        // Selection (cell or building) is disabled while placing; it resumes after cancel.
        this.selectedCell = null;
        this.selectedBuildingId = null;
        this.selectionHighlight.setVisible(false);
        this.updateToggleButton();

        for (const [id, button] of Object.entries(this.buildButtons)) {
            const selected = id === typeId;
            button.rect.setStrokeStyle(3, selected ? BUTTON_SELECTED_STROKE : BUTTON_IDLE_STROKE);
            button.proxy?.set({selected});
        }
        this.setCancelVisible(true);
        this.updatePreview(null);
    }

    exitPlacementMode() {
        this.buildingControls?.disarm();
        this.exitRoadMode();
        this.exitFlagMode();
        if (!this.placement?.isPlacing) return;
        this.placement.cancel();
        this.resetPlacementUi();
    }

    /** Road tool: tap adds or removes, dragging only ever adds. Needs HQ. */
    enterRoadMode() {
        if (!this.placement.hqBuilt || !this.cycle.isConstructionAllowed) return;
        this.exitPlacementMode();
        this.selectAt(null);
        this.roadMode = true;
        this.roadButton.rect.setStrokeStyle(3, BUTTON_SELECTED_STROKE);
        this.roadProxy?.set({selected: true});
        this.setCancelVisible(true);
    }

    exitRoadMode() {
        if (!this.roadMode) return;
        this.roadMode = false;
        this.roadDragAdds = false;
        this.roadButton.rect.setStrokeStyle(3, BUTTON_IDLE_STROKE);
        this.roadProxy?.set({selected: false});
        this.setCancelVisible(false);
        this.previewRect.setVisible(false);
        this.previewResult = null;
        this.showHint(null);
    }

    /** Flag tool: the next tile pressed becomes the selected Barracks' post. Day and Night. */
    enterFlagMode() {
        const {building} = this.selection();
        if (!building) return;
        this.exitPlacementMode();
        this.flagBarracksId = building.id;
        this.selectAt(null);
        this.setCancelVisible(true);
        this.showHint(null);
    }

    /** Back to the Barracks, if it still stands. */
    exitFlagMode() {
        if (!this.flagBarracksId) return;
        const barracks = this.placement.barracks().find((b) => b.id === this.flagBarracksId);
        this.flagBarracksId = null;
        this.setCancelVisible(false);
        this.previewRect.setVisible(false);
        this.previewResult = null;
        this.showHint(null);
        if (barracks) this.selectAt({col: barracks.col, row: barracks.row});
    }

    applyFlagCell(cell) {
        const result = this.placement.setFlag(this.flagBarracksId, cell);
        this.lastResult = result;
        if (result.ok) {
            this.exitFlagMode();
            return;
        }
        this.showHint(result.reason);
        this.updateFlagPreview(cell);
    }

    updateFlagPreview(cell) {
        if (!cell) {
            this.previewResult = null;
            this.previewRect.setVisible(false);
            return;
        }
        this.previewResult = {footprint: {...cell, width: 1, height: 1}, ...this.placement.canSetFlag(this.flagBarracksId, cell)};
        this.drawPreview();
    }

    /** One road action on a cell, from a tap or a drag. */
    applyRoadCell(cell, {dragging}) {
        const removing = this.roads.has(cell);
        if (dragging && removing) return;
        const result = removing ? this.placement.removeRoad(cell) : this.placement.placeRoad(cell);
        this.lastResult = result;
        this.showHint(result.ok ? null : result.reason);
        if (result.ok) this.refreshRoads();
        this.updateRoadPreview(cell);
    }

    updateRoadPreview(cell) {
        if (!cell) {
            this.previewResult = null;
            this.previewRect.setVisible(false);
            return;
        }
        const check = this.roads.has(cell) ? this.placement.previewRoadRemoval(cell) : this.placement.previewRoad(cell);
        this.previewResult = {footprint: {...cell, width: 1, height: 1}, ...check};
        this.drawPreview();
    }

    /** Redraw roads and every dock on them. Only called when they change. */
    refreshRoads() {
        if (!this.roads) return;
        const buildings = this.placement.buildings();
        const docks = buildings.flatMap((building) => {
            if (building.type === HQ_TYPE) return [{...receivingDock(building), kind: 'hq'}];
            if (building.type === BARRACKS_TYPE) return [{...barracksExit(building), kind: 'barracks'}];
            return ROAD_ACCESS_TYPES.includes(building.type) ? [{...outgoingDock(building), kind: 'factory'}] : [];
        });
        this.roadLayer.sync(this.roads.tiles(), docks);
    }

    /** One short reason after a rejection, because touch has no hover. */
    showHint(reason) {
        this.placementHint.setText(PLACEMENT_HINTS[reason] ?? '');
    }

    resetPlacementUi() {
        for (const button of Object.values(this.buildButtons)) {
            button.rect.setStrokeStyle(3, BUTTON_IDLE_STROKE);
            button.proxy?.set({selected: false});
        }
        this.setCancelVisible(false);
        this.updatePreview(null);
        this.showHint(null);
    }

    /** Render the preview from the domain validation result for `cell`. */
    updatePreview(cell) {
        this.previewResult = this.placement.preview(cell);
        if (!this.previewResult) {
            this.previewRect.setVisible(false);
            this.roadLayer.showRing(null);
            this.roadLayer.showDock(null);
            this.gateLayer.showPreview(null);
            return;
        }
        this.drawPreview();
    }

    drawPreview() {
        const rect = this.grid.footprintRect(this.previewResult.footprint);
        const color = this.previewResult.ok ? PREVIEW_VALID_COLOR : PREVIEW_INVALID_COLOR;
        this.previewRect
            .setPosition(rect.x, rect.y)
            .setSize(rect.width, rect.height)
            .setFillStyle(color, 0.4)
            .setStrokeStyle(2, color)
            .setVisible(true);
        const hqRing = this.roads && this.placement.selectedType === HQ_TYPE;
        this.roadLayer.showRing(hqRing ? this.previewResult.footprint : null, color);
        this.roadLayer.showDock(this.previewResult.dock ?? null, color);
        const gate = this.placement.selectedType ? getBuildingType(this.placement.selectedType).gate : null;
        this.gateLayer.showPreview(gate ? this.previewResult.footprint : null, gate?.orientation, color);
    }

    addBuildingView(building) {
        const rect = this.grid.footprintRect(building);
        const view = this.add.rectangle(rect.x, rect.y, rect.width, rect.height, BUILDING_COLORS[building.type])
            .setOrigin(0, 0)
            .setStrokeStyle(2, BUILDING_STROKE)
            .setDepth(1);
        this.buildingViews.set(building.id, view);
    }

    /** Every view that follows the buildings and roads, after a QA layout load. */
    handleLayoutLoaded() {
        for (const building of this.placement.buildings()) this.addBuildingView(building);
        this.refreshRoads();
        this.selectAt(null);
        this.updateHud();
        this.refreshPower();
        this.refreshBuildMenu();
        this.refreshEndDay();
    }

    // ---- Pointer -----------------------------------------------------------

    /** `over` = interactive objects under the pointer; UI hits are never grid input. */
    handleGridPointerDown(pointer, over) {
        this.dragCell = null; // lifting a finger sends no move, so a finished drag ends here
        if (!this.grid || over.length > 0 || this.phase === GamePhase.DEFEATED) return;
        const cell = this.grid.worldToCell(pointer.worldX, pointer.worldY);

        if (this.flagBarracksId) {
            if (cell) this.applyFlagCell(cell);
            return;
        }

        if (this.roadMode) {
            this.roadDragAdds = false;
            if (!cell) return;
            this.roadDragAdds = !this.roads.has(cell);
            this.applyRoadCell(cell, {dragging: false});
            return;
        }

        if (this.placement.isPlacing) {
            this.updatePreview(cell); // touch has no hover: show where the tap landed
            if (!cell) return;
            this.dragCell = this.placement.selectedType === WALL_TYPE ? cell : null;
            this.placeOnCell(cell);
            return;
        }

        // Normal mode: never places. An occupied cell selects its building.
        this.selectAt(cell);
    }

    /** One real placement attempt, from a press or a drag. */
    placeOnCell(cell) {
        const {building, ...result} = this.placement.placeAt(cell);
        this.lastResult = result;
        this.showHint(result.ok ? null : result.reason);
        if (!result.ok) return;
        this.addBuildingView(building);
        this.refreshRoads();
        this.updateHud();
        this.refreshPower(); // new supply/demand takes effect immediately
        this.updatePreview(cell); // re-validate: cell now occupied, balances lower
        if (building.type === BARRACKS_TYPE) this.refreshBuildMenu(); // the limit may have been reached
        if (building.type === HQ_TYPE) { // the domain ended placement; the rest unlocks
            this.resetPlacementUi();
            this.refreshBuildMenu();
            this.refreshEndDay();
        }
    }

    /**
     * Walls follow a drag. Every tile between two pointer samples is visited, so
     * a fast drag leaves no gap, and each is an ordinary placement with its own
     * validation and cost.
     */
    dragWallsTo(cell) {
        let {col, row} = this.dragCell;
        while (col !== cell.col || row !== cell.row) {
            if (Math.abs(cell.col - col) >= Math.abs(cell.row - row)) col += Math.sign(cell.col - col);
            else row += Math.sign(cell.row - row);
            this.placeOnCell({col, row});
        }
        this.dragCell = cell;
    }

    handleGridPointerMove(pointer, over) {
        if (this.flagBarracksId) {
            this.updateFlagPreview(over.length > 0 ? null : this.grid.worldToCell(pointer.worldX, pointer.worldY));
            return;
        }
        if (this.roadMode) {
            const cell = over.length > 0 ? null : this.grid.worldToCell(pointer.worldX, pointer.worldY);
            if (cell && pointer.isDown && this.roadDragAdds) this.applyRoadCell(cell, {dragging: true});
            else this.updateRoadPreview(cell);
            return;
        }
        if (!this.placement?.isPlacing || this.phase === GamePhase.DEFEATED) return;
        const cell = over.length > 0 ? null : this.grid.worldToCell(pointer.worldX, pointer.worldY);
        if (!pointer.isDown) this.dragCell = null;
        if (cell && this.dragCell) this.dragWallsTo(cell);
        this.updatePreview(cell);
    }

    /**
     * Select a cell, or clear selection when `cell` is null (outside the
     * grid). If the cell is occupied, its building is selected too and the
     * highlight covers the building's footprint.
     */
    selectAt(cell) {
        this.buildingControls?.disarm(); // any press on the map, even on the same building
        this.selectedCell = cell;
        this.selectedBuildingId = cell ? this.grid.occupantAt(cell.col, cell.row) : null;
        if (cell) {
            const building = this.selectedBuildingId
                ? this.placement.buildings().find((b) => b.id === this.selectedBuildingId)
                : null;
            const rect = this.grid.footprintRect(building ?? {col: cell.col, row: cell.row});
            this.selectionHighlight.setPosition(rect.x, rect.y).setSize(rect.width, rect.height).setVisible(true);
        } else {
            this.selectionHighlight.setVisible(false);
        }
        this.updateToggleButton();
    }

    // ---- Simulation --------------------------------------------------------

    /** Phaser's frame delta drives the fixed-step clock; Phaser's `time` is ignored. */
    update(_time, delta) {
        this.clock.advance(delta, (tick) => this.stepSimulation(tick));
        this.syncShiftUi();
    }

    /**
     * One fixed 1/60 s simulation step. Called by both update() and manual
     * QA stepping. Drives the shift cycle (night countdown and the automatic
     * Night -> Day transition), then turrets, gates, soldiers, the surviving
     * mutants and trucks. The order matters: a mutant killed this tick cannot act,
     * every gate has its record before a soldier looks at it, and if settlement
     * throws on the final tick nothing else steps, so the retried tick cannot
     * apply anything twice. The counter lets QA verify that every tick ran
     * this path.
     */
    stepSimulation(tick) {
        this.simulationSteps++;
        this.cycle?.onTick(tick);
        const defense = this.autocannons?.step();
        if (defense?.shots.length) this.autocannonLayer.recordShots(defense.shots, this.clock.tick);
        const wanted = this.logistics?.gateDemands();
        if (wanted) this.infantry.addGateDemands(wanted);
        this.gates?.step(wanted);
        const squads = this.infantry?.step();
        if (squads?.shots.length) this.infantryLayer.recordShots(squads.shots, this.clock.tick);
        const effects = this.mutants?.step();
        if (effects?.destroyed.length) this.handleBuildingsDestroyed(effects.destroyed);
        if (this.logistics?.step().deliveries) this.updateHud();
    }

    /** Domain already removed these buildings, destroyed or demolished; bring the presentation in line. */
    handleBuildingsDestroyed(ids) {
        for (const id of ids) {
            this.buildingViews.get(id).destroy();
            this.buildingViews.delete(id);
            this.autocannonLayer.remove(id);
        }
        if (ids.includes(this.selectedBuildingId)) this.selectAt(null);
        if (ids.includes(this.flagBarracksId)) this.exitFlagMode();
        this.refreshPower();
        this.refreshRoads();
        this.refreshBuildMenu(); // losing a Barracks frees a place under the limit
    }

    // ---- QA ----------------------------------------------------------------

    qaState() {
        const rectView = (r) => ({visible: r.visible, x: r.x, y: r.y, width: r.width, height: r.height});
        return {
            scene: this.scene.key,
            phase: this.phase,
            width: this.scale.width,
            height: this.scale.height,
            grid: this.grid ? this.grid.snapshot() : null,
            selectedCell: this.selectedCell ? {...this.selectedCell} : null,
            highlight: this.selectionHighlight ? rectView(this.selectionHighlight) : null,
            ui: {
                titleVisible: this.title.visible,
                startVisible: this.startButton.visible,
                cancelVisible: this.cancelButton ? this.cancelButton.rect.visible : false,
                endDayVisible: this.endDayButton ? this.endDayButton.rect.visible : false,
                endDayEnabled: this.cycle ? this.cycle.canEndDay : false,
                buildMenuVisible: Object.values(this.buildButtons).some((b) => b.rect.visible),
                toggleVisible: this.toggleButton ? this.toggleButton.rect.visible : false,
            },
            // Domain power state, derived on demand from the building records.
            power: this.placement ? calculatePower(this.placement.buildings()) : null,
            // Actual power summary text, read off the game object.
            powerView: this.powerHud ? {visible: this.powerHud.visible, text: this.powerHud.text} : null,
            selectedBuilding: this.selectedBuildingId,
            shiftCycle: this.cycle?.started ? this.cycle.snapshot() : null,
            // Latest nightly settlement report (domain) and the actual panel text.
            settlement: this.cycle?.lastSettlement ? structuredClone(this.cycle.lastSettlement) : null,
            settlementView: this.settlementPanel
                ? {visible: this.settlementPanel.visible, text: this.settlementPanel.text}
                : null,
            // Actual shift HUD text, read off the game object.
            shiftView: this.shiftHud ? {visible: this.shiftHud.visible, text: this.shiftHud.text} : null,
            placement: this.placement
                ? {
                    selectedType: this.placement.selectedType,
                    // Domain validation result (source of truth).
                    preview: this.previewResult ? structuredClone(this.previewResult) : null,
                    // Outcome of the most recent placement attempt.
                    lastResult: this.lastResult ? structuredClone(this.lastResult) : null,
                }
                : null,
            resources: this.economy ? this.economy.snapshot() : null,
            // Domain pollution. emissionsPerNight is what the current buildings
            // would emit; settlement.pollution.emitted is what the last night did.
            pollution: this.pollution
                ? {
                    ...this.pollution.snapshot(),
                    threatLevel: threatLevel(this.pollution.value),
                    emissionsPerNight: calculateEmissions(this.placement.buildings()),
                }
                : null,
            // Domain mutants, then the rendered circles and building HP bars.
            mutants: this.mutants ? this.mutants.snapshot() : null,
            mutantViews: this.mutantLayer ? this.mutantLayer.mutantViews() : null,
            hpBarViews: this.mutantLayer ? this.mutantLayer.hpBarViews() : null,
            // The frozen night plan, slots reached so far, and the actual HUD text.
            wave: this.mutants ? this.mutants.plan() : null,
            waveProgress: this.mutants?.plan() && this.cycle.shift === Shift.NIGHT
                ? waveProgress(this.mutants.plan(), this.cycle.elapsedNightTicks)
                : null,
            waveView: this.waveHud ? {visible: this.waveHud.visible, text: this.waveHud.text} : null,
            // The defeat record (null until HQ falls) and the actual overlay text.
            defeat: this.cycle ? this.cycle.defeatReport : null,
            gameOverView: this.gameOverLayer ? this.gameOverLayer.view() : null,
            // Domain turret state, then the rendered barrels and tracers.
            autocannons: this.autocannons ? this.autocannons.snapshot() : null,
            barrelViews: this.autocannonLayer ? this.autocannonLayer.barrelViews() : null,
            tracerViews: this.autocannonLayer ? this.autocannonLayer.tracerViews() : null,
            // Actual pollution HUD text, read off the game object.
            pollutionView: this.pollutionHud ? {visible: this.pollutionHud.visible, text: this.pollutionHud.text} : null,
            simulation: {
                ...this.clock.snapshot(),
                speed: this.clock.speed,
                stepsExecuted: this.simulationSteps,
                rng: this.rng.snapshot(),
            },
            speedView: this.speedControls ? this.speedControls.view() : null,
            roads: this.roads ? this.roads.snapshot() : null,
            roadViews: this.roadLayer ? this.roadLayer.views() : null,
            dockViews: this.roadLayer ? this.roadLayer.dockViews() : null,
            dockPreviewView: this.roadLayer ? this.roadLayer.dockPreviewView() : null,
            logistics: this.logistics ? this.logistics.snapshot() : null,
            truckViews: this.truckLayer ? this.truckLayer.views() : null,
            // Domain gate state, then the rendered barriers and the placement preview.
            gates: this.gates ? this.gates.snapshot() : null,
            gateViews: this.gateLayer ? this.gateLayer.views() : null,
            gatePreviewView: this.gateLayer ? this.gateLayer.previewView() : null,
            // Domain squads, then the rendered soldiers and flags, and the selection's controls.
            infantry: this.infantry ? this.infantry.snapshot() : null,
            infantryViews: this.infantryLayer ? this.infantryLayer.views() : null,
            buildingControlsView: this.buildingControls ? this.buildingControls.view() : null,
            flagMode: this.flagBarracksId,
            roadMode: this.roadMode,
            ringPreviewView: this.roadLayer ? this.roadLayer.ringPreviewView() : null,
            placementHint: this.placementHint ? this.placementHint.text : null,
            // Actual HUD text, read off the game object.
            hudView: this.hud ? {visible: this.hud.visible, text: this.hud.text} : null,
            // 'available', 'locked' or 'built', keyed by building type.
            menuState: this.hud
                ? Object.fromEntries(Object.keys(this.buildButtons).map((id) => [id, this.buildState(id)]))
                : null,
            // Actual build-button label text, keyed by building type.
            menuLabels: this.hud
                ? Object.fromEntries(Object.entries(this.buildButtons).map(([id, b]) => [id, b.text.text]))
                : null,
            // Actual rendered preview properties, read off the game object.
            previewView: this.previewRect
                ? {...rectView(this.previewRect), fillColor: this.previewRect.fillColor, strokeColor: this.previewRect.strokeColor}
                : null,
            buildings: this.placement ? this.placement.buildings() : [],
            // Rendered building rectangles: alpha < 1 = disabled, red stroke = unpowered.
            buildingViews: [...this.buildingViews].map(([id, view]) => ({
                id, ...rectView(view), fillColor: view.fillColor, strokeColor: view.strokeColor, alpha: view.alpha,
            })),
        };
    }
}
