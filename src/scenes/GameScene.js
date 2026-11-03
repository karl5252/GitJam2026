import Phaser from 'phaser';
import {GamePhase, startGame} from '../core/gamePhase.js';
import {Grid} from '../core/grid.js';
import {BUILDING_TYPES} from '../core/buildingTypes.js';
import {BuildingPlacement} from '../core/buildingPlacement.js';
import {Economy} from '../core/economy.js';
import {SimulationClock} from '../core/simulationClock.js';
import {SeededRandom, DEFAULT_SEED, parseSeed} from '../core/seededRandom.js';
import {ShiftCycle, Shift} from '../core/shiftCycle.js';
import {TEST_MODE} from '../testMode.js';
import {addProxy, markScene, setBodyState} from '../testShadow/TestProxy.js';
import {QASurface} from '../testShadow/QASurface.js';

const GRID_COLS = 24;
const GRID_ROWS = 16;
const TILE_SIZE = 32;

const GRID_LINE_COLOR = 0x78909c;
const HIGHLIGHT_COLOR = 0xffeb3b;
export const PREVIEW_VALID_COLOR = 0x4caf50;
export const PREVIEW_INVALID_COLOR = 0xe53935;
const BUILDING_COLORS = {outpost: 0x9e9e9e, factory: 0x616161};
const BUILDING_STROKE = 0x212121;

const BUTTON_IDLE_STROKE = 0x90a4ae;
const BUTTON_SELECTED_STROKE = 0xffeb3b;

// Build menu lives in the band left of the grid (grid x starts at 256).
const MENU_X = 128;
const MENU_BUTTON = {width: 192, height: 64};

/**
 * Title + Start button. Start (READY -> STARTED) hides both, creates a 24x16
 * grid (32px cells) centred in the 1280x720 area and shows the build menu.
 *
 * Input modes after Start:
 *   - Normal: pointerdown on the grid selects/highlights a cell; outside the
 *     grid clears the selection.
 *   - Placement (a building button was pressed): pointermove previews the
 *     centred footprint, pointerdown attempts placement. Selection is
 *     disabled. Escape or Cancel returns to normal mode.
 *
 * Rules live in core (Grid, BuildingPlacement). The preview colour is
 * derived from the domain validation result, never the reverse.
 *
 * Pointer events whose target is a UI button are never treated as grid
 * input (Phaser passes the hit objects to the scene-level handler).
 *
 * Test Shadow usage:
 *   - addProxy for real buttons: start, build-outpost, build-factory,
 *     cancel-placement. Grid cells deliberately get no proxies.
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
        this.hud = null;
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
        // never tick during Day Shift. They cannot place or spend anything.
        // window.__qa (and these controls) are removed with the QASurface on
        // shutdown and never exist in production builds.
        if (TEST_MODE && window.__qa) {
            window.__qa.sim = {
                pause: () => {
                    this.clock.pause();
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
            this.cycle.begin(); // Day 1; the clock starts paused for Day Shift
            this.syncShiftUi();
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
        this.cycle = new ShiftCycle({clock: this.clock, economy: this.economy});
        this.placement = new BuildingPlacement(this.grid, this.economy, {
            isConstructionAllowed: () => this.cycle.isConstructionAllowed,
        });

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
        this.updateHud();
    }

    updateHud() {
        const {credits, ap} = this.economy.snapshot();
        this.hud.setText(`Credits: ${credits}   AP: ${ap}`);
    }

    /** Shift line; the night countdown is derived from remaining simulation ticks. */
    updateShiftHud() {
        const {day, shift, remainingNightTicks} = this.cycle.snapshot();
        const text = shift === Shift.NIGHT
            ? `Day ${day} · Night Shift · ${(remainingNightTicks / this.clock.tickRate).toFixed(1)} s left`
                + (this.clock.paused ? ' (paused)' : '')
            : `Day ${day} · Day Shift`;
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
            const isDay = this.cycle.shift === Shift.DAY;
            if (!isDay) this.exitPlacementMode();
            this.setBuildMenuVisible(isDay);
            this.setEndDayVisible(isDay);
            this.updateHud(); // AP is restored at the start of each Day
        }
        this.updateShiftHud();
    }

    handleEndDay() {
        this.exitPlacementMode();
        this.cycle.endDay();
        this.syncShiftUi();
    }

    // ---- Build menu --------------------------------------------------------

    createButton(y, label, fill) {
        const rect = this.add.rectangle(MENU_X, y, MENU_BUTTON.width, MENU_BUTTON.height, fill)
            .setStrokeStyle(3, BUTTON_IDLE_STROKE)
            .setInteractive({useHandCursor: true})
            .setDepth(4);
        const text = this.add.text(MENU_X, y, label, {
            fontFamily: 'monospace',
            fontSize: '20px',
            color: '#ffffff',
            align: 'center',
        }).setOrigin(0.5).setDepth(5);
        return {rect, text};
    }

    createBuildMenu() {
        let y = 180;
        for (const type of Object.values(BUILDING_TYPES)) {
            const label = `${type.name} ${type.width}x${type.height}\n${type.cost.credits}c · ${type.cost.ap} AP`;
            const button = this.createButton(y, label, 0x37474f);
            button.rect.on('pointerdown', () => this.enterPlacementMode(type.id));
            button.type = type;
            button.proxy = null;
            this.buildButtons[type.id] = button;
            y += 88;
        }

        this.cancelButton = this.createButton(y + 40, 'Cancel', 0x8e2b2b);
        this.cancelButton.rect.on('pointerdown', () => this.exitPlacementMode());
        this.setCancelVisible(false);

        // Bottom of the left band, clear of the grid (grid x starts at 256).
        this.endDayButton = this.createButton(620, 'END DAY', 0x6d4c41);
        this.endDayButton.rect.on('pointerdown', () => this.handleEndDay());
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
    }

    setEndDayVisible(visible) {
        const {rect, text} = this.endDayButton;
        rect.setVisible(visible);
        text.setVisible(visible);
        if (visible) {
            rect.setInteractive({useHandCursor: true});
            this.endDayProxy ??= addProxy(this, rect, 'end-day', {label: 'End Day'});
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
        if (!this.placement.select(typeId)) return;

        // Selection is disabled while placing; it resumes after cancel.
        this.selectedCell = null;
        this.selectionHighlight.setVisible(false);

        for (const [id, button] of Object.entries(this.buildButtons)) {
            const selected = id === typeId;
            button.rect.setStrokeStyle(3, selected ? BUTTON_SELECTED_STROKE : BUTTON_IDLE_STROKE);
            button.proxy?.set({selected});
        }
        this.setCancelVisible(true);
        this.updatePreview(null);
    }

    exitPlacementMode() {
        if (!this.placement?.isPlacing) return;
        this.placement.cancel();
        for (const button of Object.values(this.buildButtons)) {
            button.rect.setStrokeStyle(3, BUTTON_IDLE_STROKE);
            button.proxy?.set({selected: false});
        }
        this.setCancelVisible(false);
        this.updatePreview(null);
    }

    /** Render the preview from the domain validation result for `cell`. */
    updatePreview(cell) {
        this.previewResult = this.placement.preview(cell);
        if (!this.previewResult) {
            this.previewRect.setVisible(false);
            return;
        }
        const rect = this.grid.footprintRect(this.previewResult.footprint);
        const color = this.previewResult.ok ? PREVIEW_VALID_COLOR : PREVIEW_INVALID_COLOR;
        this.previewRect
            .setPosition(rect.x, rect.y)
            .setSize(rect.width, rect.height)
            .setFillStyle(color, 0.4)
            .setStrokeStyle(2, color)
            .setVisible(true);
    }

    addBuildingView(building) {
        const rect = this.grid.footprintRect(building);
        const view = this.add.rectangle(rect.x, rect.y, rect.width, rect.height, BUILDING_COLORS[building.type])
            .setOrigin(0, 0)
            .setStrokeStyle(2, BUILDING_STROKE)
            .setDepth(1);
        this.buildingViews.set(building.id, view);
    }

    // ---- Pointer -----------------------------------------------------------

    /** `over` = interactive objects under the pointer; UI hits are never grid input. */
    handleGridPointerDown(pointer, over) {
        if (!this.grid || over.length > 0) return;
        const cell = this.grid.worldToCell(pointer.worldX, pointer.worldY);

        if (this.placement.isPlacing) {
            this.updatePreview(cell); // touch has no hover: show where the tap landed
            if (!cell) return;
            const {building, ...result} = this.placement.placeAt(cell);
            this.lastResult = result;
            if (result.ok) {
                this.addBuildingView(building);
                this.updateHud();
                this.updatePreview(cell); // re-validate: cell now occupied, balances lower
            }
            return;
        }

        this.selectAt(cell);
    }

    handleGridPointerMove(pointer, over) {
        if (!this.placement?.isPlacing) return;
        const cell = over.length > 0 ? null : this.grid.worldToCell(pointer.worldX, pointer.worldY);
        this.updatePreview(cell);
    }

    /** Select a cell, or clear selection when `cell` is null (outside the grid). */
    selectAt(cell) {
        this.selectedCell = cell;
        if (cell) {
            const {x, y} = this.grid.cellToWorld(cell.col, cell.row);
            this.selectionHighlight.setPosition(x, y).setVisible(true);
        } else {
            this.selectionHighlight.setVisible(false);
        }
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
     * Night -> Day transition). No other gameplay is simulated yet; the
     * counter lets QA verify that every tick ran this path.
     */
    stepSimulation(tick) {
        this.simulationSteps++;
        this.cycle?.onTick(tick);
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
                buildMenuVisible: Object.values(this.buildButtons).some((b) => b.rect.visible),
            },
            shiftCycle: this.cycle?.started ? this.cycle.snapshot() : null,
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
            simulation: {
                ...this.clock.snapshot(),
                stepsExecuted: this.simulationSteps,
                rng: this.rng.snapshot(),
            },
            // Actual HUD text, read off the game object.
            hudView: this.hud ? {visible: this.hud.visible, text: this.hud.text} : null,
            // Actual build-button label text, keyed by building type.
            menuLabels: this.hud
                ? Object.fromEntries(Object.entries(this.buildButtons).map(([id, b]) => [id, b.text.text]))
                : null,
            // Actual rendered preview properties, read off the game object.
            previewView: this.previewRect
                ? {...rectView(this.previewRect), fillColor: this.previewRect.fillColor, strokeColor: this.previewRect.strokeColor}
                : null,
            buildings: this.placement ? this.placement.buildings() : [],
            buildingViews: [...this.buildingViews].map(([id, view]) => ({id, ...rectView(view), fillColor: view.fillColor})),
        };
    }
}
