import Phaser from 'phaser';
import {BARRACKS_LIMIT, FlagFailure, MAX_BARRACKS} from '../core/buildingPlacement.js';
import {BARRACKS_TYPE, BUILDING_TYPES, REFIT_COST, getBuildingType} from '../core/buildingTypes.js';
import {PlacementFailure} from '../core/grid.js';
import {PowerStatus} from '../core/power.js';
import {RoadFailure} from '../core/roads.js';
import {WorkFlagFailure} from '../core/workers.js';
import {Shift} from '../core/shiftCycle.js';
import {addProxy} from '../testShadow/TestProxy.js';
import {BuildingControls} from './BuildingControls.js';
import {Command, EventBus, Hint, Hud, Notice, State} from './EventBus.js';
import {GameOverLayer} from './GameOverLayer.js';
import {OfficeMenuLayer} from './OfficeMenuLayer.js';
import {SpeedControls} from './SpeedControls.js';
import {currentLayout} from './hudLayout.js';

const PLACEMENT_HINTS = {
    [Hint.POWER_WARNING]: 'LOW POWER: this stops every powered building. Press again to build',
    [Hint.REFIT_REFUSED]: `A refit needs ${REFIT_COST.credits} Credits and ${REFIT_COST.ap} AP`,
    [PlacementFailure.TERRAIN_BLOCKED]: 'Dense jungle: build in the clearing',
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
    [WorkFlagFailure.OCCUPIED]: 'Work flags go on open ground, roads or jungle',
    [WorkFlagFailure.UNREACHABLE]: 'Workers cannot reach this tile',
};

const POWER_STATUS_LABELS = {
    [PowerStatus.NORMAL]: 'NORMAL',
    [PowerStatus.LOW_POWER]: 'LOW POWER',
    [PowerStatus.BLACKOUT]: 'BLACKOUT',
};

const IDLE_STROKE = 0x90a4ae;
const SELECTED_STROKE = 0xffeb3b;
const DISABLED_ALPHA = 0.45;
const BAND_COLOR = 0x263238;
const DRAWER_COLOR = 0x1c262b;
const BUTTON_DEPTH = 4;
const LABEL_DEPTH = 5;
const DRAWER_DEPTH = 8; // the drawer lifts its own buttons above it

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const cost = ({cost: {credits, ap}}) => (ap ? `${credits}c · ${ap} AP` : `${credits}c`);

const MENU_LABELS = {
    road: () => 'Road\nfree',
    barracks: (type) => `Barracks 3x3\n${cost(type)}`,
    wall: (type) => `Wall\n${cost(type)}`,
    gateVertical: (type) => `Gate |\n${cost(type)}`,
    gateHorizontal: (type) => `Gate —\n${cost(type)}`,
    siegeCannon: (type) => `Siege 2x2\n${cost(type)}\nheavy · ${type.power.demand}P`,
};
const menuLabel = (id) => {
    const type = getBuildingType(id);
    if (MENU_LABELS[id]) return MENU_LABELS[id](type);
    return `${type.name} ${type.width}x${type.height}\n${type.cost.credits}c · ${type.cost.ap} AP`;
};

/**
 * Everything drawn in screen coordinates: resources, the shift, the build menu, the
 * selection's actions, speed and camera controls, hints and Game Over.
 *
 * It runs above GameScene, with its own camera, so the world camera cannot move it,
 * and a press on any interactive object here is captured before GameScene sees it.
 * It knows nothing of the simulation: it draws what EventBus tells it, and answers
 * with commands. All state arrives as events, so it can be restarted at any moment.
 */
export class HUDScene extends Phaser.Scene {
    constructor() {
        super('hud');
    }

    create() {
        this.layout = currentLayout();
        this.ui = null; // everything that exists after Start
        this.menu = null;
        this.selection = null;
        this.drawerOpen = false;
        this.reportOpen = false;
        this.hasReport = false;
        this.toggleNarrow = false;
        this.createTitle();
        this.events.once('shutdown', () => {
            this.officeMenu?.destroy();
            this.officeMenu = null;
        });
        // Leaving a control counts as this scene capturing that move, so GameScene would
        // not see it, and a preview would wait for the next one.
        this.input.on('gameobjectout', (pointer) => EventBus.emit(Notice.POINTER_LEFT_HUD, pointer));

        const handlers = {
            [State.PHASE]: (value) => this.onPhase(value),
            [State.SHIFT]: (value) => this.onShift(value),
            [State.ECONOMY]: ({credits, ap}) => this.ui?.resources.setText(`Credits: ${credits}   AP: ${ap}`),
            [State.POLLUTION]: ({value, threat}) => this.ui?.pollution.setText(`Pollution ${value}\nThreat Level ${threat}`),
            [State.POWER]: ({generation, demand, status}) => this.ui?.power.setText(`Power ${generation} / ${demand}\n${POWER_STATUS_LABELS[status]}`),
            [State.SETTLEMENT]: (value) => this.onSettlement(value),
            [State.WAVE]: (value) => this.onWave(value),
            [State.MENU]: (value) => this.onMenu(value),
            [State.SELECTION]: (value) => this.onSelection(value),
            [State.HINT]: ({reason}) => {
                const hint = PLACEMENT_HINTS[reason] ?? '';
                this.ui?.hint.setText(hint).setVisible(hint !== ''); // the touch hint has a background of its own
            },
            [State.SPEED]: ({speed}) => this.ui?.speed.setSpeed(speed),
            [State.GAME_OVER]: (report) => this.ui?.gameOver.show(report),
            [Notice.DISARM]: () => this.ui?.controls.disarm(),
            [Notice.WORLD_PRESSED]: () => this.onWorldPressed(),
            [Hud.SNAPSHOT]: (entries) => {
                for (const [event, value] of entries) handlers[event]?.(value);
            },
        };
        for (const [event, handler] of Object.entries(handlers)) EventBus.on(event, handler);
        this.events.once('shutdown', () => {
            for (const [event, handler] of Object.entries(handlers)) EventBus.off(event, handler);
        });
        EventBus.emit(Hud.READY);
    }

    // ---- Title -------------------------------------------------------------

    createTitle() {
        // Keep the existing START button, coordinates and test proxy.
        this.officeMenu = new OfficeMenuLayer(this);
        const {width} = this.scale;
        this.title = this.add.text(width / 2, 52, 'PAPI Industries: The Green Shift', {
            fontFamily: 'monospace',
            fontSize: '48px',
            color: '#f8d88b',
        }).setOrigin(0.5).setDepth(50);
        this.startButton = this.add.rectangle(width / 2, 668, 240, 72, 0x7c2628)
            .setStrokeStyle(3, 0xf7d88b)
            .setInteractive({useHandCursor: true})
            .setDepth(51);
        this.startLabel = this.add.text(this.startButton.x, this.startButton.y, 'START', {
            fontFamily: 'monospace',
            fontSize: '32px',
            color: '#ffffff',
        }).setOrigin(0.5).setDepth(52);
        this.startButton.on('pointerdown', () => EventBus.emit(Command.START));
        this.startProxy = addProxy(this, this.startButton, 'start', {label: 'Start'});
    }

    update(_time, delta) {
        this.officeMenu?.update(delta);
    }

    onPhase({phase}) {
        if (phase === 'ready' || this.ui) return;
        this.officeMenu?.destroy();
        this.officeMenu = null;
        this.title.setVisible(false);
        this.startLabel.setVisible(false);
        this.startButton.setVisible(false).disableInteractive();
        this.startProxy.destroy();
        this.startProxy = null;
        this.createUi();
    }

    // ---- Controls ----------------------------------------------------------

    createUi() {
        const {layout} = this;
        const label = ({x, y, fontSize, originX, ...style}, color = '#ffffff') => this.add.text(x, y, '', {
            fontFamily: 'monospace', fontSize, color, ...style,
        }).setOrigin(originX, originX === 0.5 ? 0.5 : 0);
        const {text} = layout;
        if (layout.touch) {
            this.add.rectangle(0, 0, this.scale.width, layout.viewport.y, BAND_COLOR).setOrigin(0, 0);
            this.add.rectangle(0, 0, layout.viewport.x, this.scale.height, BAND_COLOR).setOrigin(0, 0);
            this.add.rectangle(layout.viewport.x + layout.viewport.width, 0, 200, this.scale.height, BAND_COLOR).setOrigin(0, 0);
        }
        this.ui = {
            shift: label(text.shift, '#c8e6c9'),
            resources: label(text.resources),
            wave: label(text.wave).setVisible(false),
            pollution: label(text.pollution),
            power: label(text.power),
            hint: label(text.hint, '#ffcc80').setVisible(false).setDepth(LABEL_DEPTH),
            settlement: label({...text.settlement, backgroundColor: '#263238', padding: {x: 8, y: 6}}).setVisible(false).setDepth(LABEL_DEPTH),
        };
        this.createBuildMenu();
        this.ui.cancel = this.button(layout.cancel, 'Cancel', 0x8e2b2b, () => EventBus.emit(Command.CANCEL));
        this.ui.cancelProxy = null;
        this.setCancelVisible(false);
        this.ui.endDay = this.button(layout.endDay, layout.touch ? 'END\nDAY' : 'END DAY', 0x6d4c41, () => EventBus.emit(Command.END_DAY));
        this.ui.endDayProxy = null;
        this.ui.toggle = this.button(layout.toggle, '', 0x37474f, () => EventBus.emit(Command.TOGGLE_POWER));
        this.ui.toggleProxy = null;
        this.ui.controls = new BuildingControls(this, {
            onFlag: () => EventBus.emit(Command.MOVE_FLAG),
            onResetFlag: () => EventBus.emit(Command.RESET_FLAG),
            onDemolish: () => EventBus.emit(Command.DEMOLISH),
            onRefit: () => EventBus.emit(Command.REFIT),
        }, layout.actions);
        this.ui.speed = new SpeedControls(this, (speed) => EventBus.emit(Command.SET_SPEED, {speed}), layout.speed);
        this.ui.gameOver = new GameOverLayer(this, () => EventBus.emit(Command.RESTART));
        this.createCameraControls();
    }

    button({x, y, width, height}, text, fill, onPress) {
        const rect = this.add.rectangle(x, y, width, height, fill)
            .setStrokeStyle(3, IDLE_STROKE)
            .setInteractive({useHandCursor: true})
            .setDepth(BUTTON_DEPTH);
        const label = this.add.text(x, y, text, {
            fontFamily: 'monospace',
            fontSize: '20px',
            color: '#ffffff',
            align: 'center',
        }).setOrigin(0.5).setDepth(LABEL_DEPTH);
        rect.on('pointerdown', onPress);
        return {rect, text: label};
    }

    createCameraControls() {
        const {camera} = this.layout;
        const add = (spec, text, command, action, name) => {
            const button = this.button(spec, text, 0x37474f, () => EventBus.emit(command));
            button.text.setStyle({fontSize: '22px'});
            addProxy(this, button.rect, action, {label: name});
            return button;
        };
        this.ui.camera = {
            zoomIn: add(camera.zoomIn, 'ZOOM\n+', Command.ZOOM_IN, 'camera-zoom-in', 'Zoom in'),
            fit: add(camera.fit, 'FIT', Command.FIT, 'camera-fit', 'Fit to battlefield'),
            zoomOut: add(camera.zoomOut, 'ZOOM\n−', Command.ZOOM_OUT, 'camera-zoom-out', 'Zoom out'),
        };
    }

    createBuildMenu() {
        const {layout} = this;
        this.ui.buttons = {};
        this.ui.proxies = {};
        if (layout.touch) this.createDrawer();
        for (const [id, spec] of Object.entries(layout.menu)) {
            const button = this.button(spec, menuLabel(id), 0x37474f, () => this.pressMenu(id));
            button.text.setStyle({fontSize: layout.touch ? '22px' : '17px', wordWrap: {width: spec.width - 6}});
            if (layout.touch) {
                button.rect.setDepth(DRAWER_DEPTH + 1);
                button.text.setDepth(DRAWER_DEPTH + 2);
            }
            this.ui.buttons[id] = button;
        }
    }

    createDrawer() {
        const {drawer} = this.layout;
        const panel = this.add.rectangle(drawer.panel.x, drawer.panel.y, drawer.panel.width, drawer.panel.height, DRAWER_COLOR, 0.96)
            .setStrokeStyle(3, IDLE_STROKE)
            .setDepth(DRAWER_DEPTH)
            .setInteractive()
            .setVisible(false);
        panel.on('pointerdown', () => this.setDrawerOpen(false));
        const headings = drawer.labels.map(({label, x, y}) => this.add.text(x, y, label, {fontFamily: 'monospace', fontSize: '22px', color: '#c8e6c9'})
            .setDepth(DRAWER_DEPTH + 1)
            .setVisible(false));
        const open = this.button(drawer.open, 'BUILD', 0x2e7d32, () => this.setDrawerOpen(!this.drawerOpen));
        const report = this.button(this.layout.report, 'REPORT', 0x37474f, () => this.setReportOpen(!this.reportOpen));
        report.rect.setVisible(false).disableInteractive();
        report.text.setVisible(false).setStyle({fontSize: '18px'});
        this.ui.drawer = {panel, headings, open, openProxy: null, report, reportProxy: null};
    }

    /** The drawer closes on any choice, so a press never lands on the world by surprise. */
    pressMenu(id) {
        this.setDrawerOpen(false);
        EventBus.emit(id === 'road' ? Command.ROAD : Command.BUILD, {type: id});
    }

    setDrawerOpen(open) {
        this.drawerOpen = open;
        if (this.ui?.drawer) {
            this.ui.drawer.panel.setVisible(open);
            for (const heading of this.ui.drawer.headings) heading.setVisible(open);
        }
        this.renderMenu();
    }

    setReportOpen(open) {
        this.reportOpen = open;
        this.ui.settlement.setVisible(open && this.hasReport);
    }

    onWorldPressed() {
        if (!this.ui || !this.layout.touch) return;
        this.setReportOpen(false);
    }

    // ---- State -------------------------------------------------------------

    onShift({day, shift, seconds, paused}) {
        if (!this.ui) return;
        let text = `Day ${day} · Day Shift`;
        if (shift === Shift.DEFEATED) text = `Day ${day} · Headquarters destroyed`;
        if (shift === Shift.NIGHT) text = `Day ${day} · Night Shift · ${seconds} s left${paused ? ' (paused)' : ''}`;
        this.ui.shift.setText(text);
    }

    onWave({visible, mutants, reached, total}) {
        if (!this.ui) return;
        this.ui.wave.setVisible(visible);
        if (visible) this.ui.wave.setText(`Mutants ${mutants} | Wave ${reached}/${total}`);
    }

    onSettlement({report, delivered}) {
        if (!this.ui) return;
        this.ui.settlement.setText([
            `Night ${report.day} settlement`,
            `Income  ${signed(report.gross + delivered)}`,
            `Upkeep  ${signed(-report.upkeep)}`,
            `Net     ${signed(report.net + delivered)}`,
            `Credits ${report.creditsAfter}`,
            `Power   ${POWER_STATUS_LABELS[report.power.status]}`,
        ].join('\n'));
        this.hasReport = true;
        this.setReportOpen(true);
    }

    onMenu(menu) {
        this.menu = menu;
        if (!this.ui) return;
        if (!menu.visible) this.drawerOpen = false;
        this.setDrawerOpen(this.drawerOpen);
        this.setCancelVisible(menu.cancel);
        this.renderEndDay();
        this.ui.speed.setVisible(menu.speed);
        this.renderDrawerButtons();
    }

    renderDrawerButtons() {
        const {drawer} = this.ui;
        if (!drawer) return;
        const {visible} = this.menu;
        this.showButton(drawer.open, visible);
        drawer.openProxy = this.syncProxy(drawer.openProxy, drawer.open, visible, 'open-build', 'Build');
        const report = visible && this.hasReport;
        this.showButton(drawer.report, report);
        drawer.reportProxy = this.syncProxy(drawer.reportProxy, drawer.report, report, 'show-report', 'Report');
    }

    showButton({rect, text}, visible) {
        rect.setVisible(visible);
        text.setVisible(visible);
        if (visible) rect.setInteractive({useHandCursor: true});
        else rect.disableInteractive();
    }

    syncProxy(proxy, button, visible, action, label) {
        if (!visible) {
            proxy?.destroy();
            return null;
        }
        return proxy ?? addProxy(this, button.rect, action, {label});
    }

    /** A hidden drawer keeps its proxies, hidden too, so tests can read a button's state in any layout. */
    renderMenu() {
        if (!this.ui || !this.menu) return;
        const {visible, states, selected, road} = this.menu;
        const shown = visible && (!this.layout.touch || this.drawerOpen);
        for (const [id, button] of Object.entries(this.ui.buttons)) {
            const isRoad = id === 'road';
            if (!isRoad && !Object.hasOwn(states, id)) {
                this.showButton(button, false);
                continue;
            }
            if (isRoad && road === null) {
                this.showButton(button, false);
                continue;
            }
            this.showButton(button, shown);
            const state = isRoad ? road.state : states[id];
            const isSelected = selected === id;
            const alpha = state === 'available' ? 1 : DISABLED_ALPHA;
            button.rect.setAlpha(alpha).setStrokeStyle(3, isSelected ? SELECTED_STROKE : IDLE_STROKE);
            button.text.setAlpha(alpha);
            if (state === 'built') {
                const type = getBuildingType(id);
                button.text.setText(`${type.name} ${type.width}x${type.height}\nBUILT`);
            }
            if (!visible) {
                this.ui.proxies[id]?.destroy();
                delete this.ui.proxies[id];
                continue;
            }
            this.ui.proxies[id] ??= addProxy(this, button.rect, `build-${id}`, {label: isRoad ? 'Road' : BUILDING_TYPES[id].name});
            this.ui.proxies[id].set({selected: isSelected, state}).show(shown);
        }
    }

    renderEndDay() {
        const {visible, enabled} = this.menu.endDay;
        const {rect, text} = this.ui.endDay;
        this.showButton(this.ui.endDay, visible);
        const alpha = enabled ? 1 : DISABLED_ALPHA;
        rect.setAlpha(alpha);
        text.setAlpha(alpha);
        this.ui.endDayProxy = this.syncProxy(this.ui.endDayProxy, this.ui.endDay, visible, 'end-day', 'End Day');
        this.ui.endDayProxy?.set({enabled});
    }

    setCancelVisible(visible) {
        this.showButton(this.ui.cancel, visible);
        this.ui.cancelProxy = this.syncProxy(this.ui.cancelProxy, this.ui.cancel, visible, 'cancel-placement', 'Cancel');
    }

    onSelection(selection) {
        this.selection = selection;
        if (!this.ui) return;
        const {building, canFlag, workers, canDemolish, confirmDemolish, refitTo, switchable} = selection;
        this.ui.controls.update(building, {canFlag, workers, canDemolish, confirmDemolish, refitTo});
        const narrow = this.layout.touch || building?.type === BARRACKS_TYPE;
        if (switchable) this.layoutToggle(narrow);
        this.showButton(this.ui.toggle, switchable);
        if (!switchable) {
            this.ui.toggleProxy?.destroy();
            this.ui.toggleProxy = null;
            return;
        }
        const label = building.enabled ? 'Switch OFF' : 'Switch ON';
        this.ui.toggle.text.setText(narrow ? label.replace(' ', '\n') : `${building.id}\n${label}`);
        this.ui.toggleProxy ??= addProxy(this, this.ui.toggle.rect, 'toggle-power', {label: 'Toggle power'});
        this.ui.toggleProxy.set({target: building.id, enabled: building.enabled});
    }

    /** A Barracks shares the row with RESET FLAG. A proxy keeps the size it was made with, so it goes too. */
    layoutToggle(narrow) {
        if (narrow === this.toggleNarrow) return;
        this.toggleNarrow = narrow;
        const {x, y, width, height} = narrow ? this.layout.narrowToggle : this.layout.toggle;
        const {rect, text} = this.ui.toggle;
        rect.setPosition(x, y).setSize(width, height);
        text.setPosition(x, y);
        this.ui.toggleProxy?.destroy();
        this.ui.toggleProxy = null;
    }

    // ---- QA ----------------------------------------------------------------

    /** What is really on screen, read off the game objects. */
    views() {
        const ui = this.ui;
        const textView = (view) => (view ? {visible: view.visible, text: view.text} : null);
        return {
            ui: {
                titleVisible: this.title.visible,
                startVisible: this.startButton.visible,
                cancelVisible: ui ? ui.cancel.rect.visible : false,
                endDayVisible: ui ? ui.endDay.rect.visible : false,
                buildMenuVisible: ui ? (this.layout.touch ? ui.drawer.open.rect.visible : Object.values(ui.buttons).some(({rect}) => rect.visible)) : false,
                toggleVisible: ui ? ui.toggle.rect.visible : false,
                hintVisible: ui ? ui.hint.visible : false,
                drawerOpen: this.drawerOpen,
                layout: this.layout.touch ? 'touch' : 'desktop',
            },
            powerView: textView(ui?.power),
            settlementView: textView(ui?.settlement),
            shiftView: textView(ui?.shift),
            waveView: textView(ui?.wave),
            gameOverView: ui ? ui.gameOver.view() : null,
            pollutionView: textView(ui?.pollution),
            speedView: ui ? ui.speed.view() : null,
            buildingControlsView: ui ? ui.controls.view() : null,
            placementHint: ui ? ui.hint.text : null,
            hudView: textView(ui?.resources),
            menuLabels: ui && this.menu
                ? Object.fromEntries(Object.entries(ui.buttons).filter(([id]) => Object.hasOwn(this.menu.states, id)).map(([id, b]) => [id, b.text.text]))
                : null,
        };
    }
}
