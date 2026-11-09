import Phaser from 'phaser';
import {BARRACKS_LIMIT, FlagFailure, MAX_BARRACKS, MineFailure} from '../core/buildingPlacement.js';
import {BARRACKS_TYPE, BUILDING_TYPES, REFIT_COST, ROAD_COST, getBuildingType} from '../core/buildingTypes.js';
import {PlacementFailure} from '../core/grid.js';
import {PowerStatus} from '../core/power.js';
import {RoadFailure} from '../core/roads.js';
import {WorkFlagFailure} from '../core/workers.js';
import {Shift} from '../core/shiftCycle.js';
import {addProxy} from '../testShadow/TestProxy.js';
import {BuildingControls} from './BuildingControls.js';
import {Command, EventBus, Hint, Hud, Notice, State} from './EventBus.js';
import {GameOverLayer} from './GameOverLayer.js';
import {NewspaperLayer} from './NewspaperLayer.js';
import {audioFor} from '../audio/audio.js';
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
    [Hint.MINE_DOCK]: 'Mine dock (bottom side) needs a connected road',
    [Hint.PROTEST]: 'ECOLOGISTAS! Protesters are blocking a delivery road',
    [MineFailure.NO_DEPOSIT]: 'A Mine needs all four tiles on one ore deposit',
    [MineFailure.DEPOSIT_TAKEN]: 'This deposit already has a Mine',
    [FlagFailure.OCCUPIED]: 'Flags go on open ground or roads',
    [FlagFailure.TAKEN]: 'Another squad holds this tile',
    [FlagFailure.UNREACHABLE]: 'Soldiers cannot reach this tile',
    [WorkFlagFailure.OCCUPIED]: 'Work flags go on open ground, roads or jungle',
    [WorkFlagFailure.UNREACHABLE]: 'Workers cannot reach this tile',
    [WorkFlagFailure.DAY_ONLY]: 'Workers go out only while a Day is running',
    [WorkFlagFailure.NO_FLAG]: 'Put a work flag down first',
    'game-paused': 'Paused: press PLAY to act',
    'truck-in-the-way': 'A truck is on this road',
    'truck-stranded': 'A truck needs this road to get home',
    'unit-in-the-way': 'A worker is standing there',
    'repair-no-worker': 'Every worker already has a repair',
    'repair-no-credits': 'Repair stopped: not enough Credits',
    'repair-unreachable': 'No worker can reach this building',
    'repair-not-damaged': 'Nothing to repair',
    'disperse-no-workers': 'Two free workers are needed to disperse a protest',
    'disperse-unreachable': 'Workers cannot get beside this protest',
    'disperse-busy': 'Workers are already dispersing a protest',
    'disperse-not-a-protest': 'This protest is over',
};

const POWER_STATUS_LABELS = {
    [PowerStatus.NORMAL]: 'NORMAL',
    [PowerStatus.LOW_POWER]: 'LOW POWER',
    [PowerStatus.BLACKOUT]: 'BLACKOUT',
};

const IDLE_STROKE = 0x90a4ae;
const SELECTED_STROKE = 0xffeb3b;
const DISABLED_ALPHA = 0.45;
/**
 * A paused Day's gameplay buttons: dimmed but still readable and still pressable,
 * so a press reaches the domain, which refuses it and says why. PLAY, END DAY, the
 * Day speed, the camera and the drawer stay as they are.
 */
export const PAUSED_ALPHA = DISABLED_ALPHA;
const BAND_COLOR = 0x263238;
const DRAWER_COLOR = 0x1c262b;
const BUTTON_DEPTH = 4;
const LABEL_DEPTH = 5;
const DRAWER_DEPTH = 8; // the drawer lifts its own buttons above it

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const cost = ({cost: {credits, ap}}) => (ap ? `${credits}c · ${ap} AP` : `${credits}c`);

const MENU_LABELS = {
    road: () => `Road\n${ROAD_COST.credits}c`,
    barracks: (type) => `Barracks 3x3\n${cost(type)}`,
    wall: (type) => `Wall\n${cost(type)}`,
    gateVertical: (type) => `Gate |\n${cost(type)}`,
    gateHorizontal: (type) => `Gate —\n${cost(type)}`,
    siegeCannon: (type) => `Siege 2x2\n${cost(type)}\nheavy · ${type.power.demand}P`,
    loudspeaker: (type) => `Loudspeaker\n${cost(type)}`,
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
        this.menuSound = null;
        this.hasReport = false;
        this.newsEnabled = false; // TASK 029: REPORT and the desktop panel open La Voz instead
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
            [State.GAME_OVER]: (report) => {
                this.ui?.newspaper.hide(); // Game Over takes precedence
                this.ui?.gameOver.show(report);
            },
            [State.NEWSPAPER]: (value) => this.onNewspaper(value),
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
        this.startButton.on('pointerdown', () => {
            audioFor(this.game).play('ui.click');
            EventBus.emit(Command.START);
        });
        this.startProxy = addProxy(this, this.startButton, 'start', {label: 'Start'});
        this.menuSound = this.soundButton({x: width - 110, y: 668, width: 180, height: 88}, 51);
    }

    /**
     * TASK 030's minimum control: SOUND ON / OFF (M on desktop), on the menu and in La
     * Voz, the two screens every player sees. Not a HUD element; TASK 031 brings settings.
     */
    soundButton({x, y, width, height}, depth) {
        const manager = audioFor(this.game);
        if (!manager.enabled) return null;
        const rect = this.add.rectangle(x, y, width, height, 0x263238).setStrokeStyle(3, 0xf7d88b)
            .setInteractive({useHandCursor: true}).setDepth(depth);
        const label = this.add.text(x, y, '', {fontFamily: 'monospace', fontSize: '24px', color: '#ffffff', align: 'center'})
            .setOrigin(0.5).setDepth(depth + 1);
        const proxy = addProxy(this, rect, 'toggle-sound', {label: 'Sound'});
        const render = () => {
            label.setText(manager.muted ? 'SOUND\nOFF' : 'SOUND\nON');
            proxy.label(manager.muted ? 'SOUND OFF' : 'SOUND ON').set({enabled: !manager.muted});
        };
        rect.on('pointerdown', () => {
            if (!manager.toggleMute()) manager.play('ui.toggle');
            render();
        });
        render();
        return {rect, label, proxy, render};
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
        if (this.menuSound) {
            this.menuSound.rect.destroy();
            this.menuSound.label.destroy();
            this.menuSound.proxy.destroy();
            this.menuSound = null;
        }
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
            onRepair: () => EventBus.emit(Command.REPAIR),
            onDisperse: () => EventBus.emit(Command.DISPERSE),
        }, layout.actions);
        this.ui.speed = new SpeedControls(this, (speed) => EventBus.emit(Command.SET_SPEED, {speed}), layout.speed);
        this.ui.dayPause = this.button(layout.dayTime.pause, 'PAUSE', 0x37474f, () => EventBus.emit(Command.TOGGLE_DAY_PAUSE));
        this.ui.daySpeed = this.button(layout.dayTime.speed, '1×', 0x37474f, () => EventBus.emit(Command.CYCLE_DAY_SPEED));
        this.ui.dayPauseProxy = null;
        this.ui.daySpeedProxy = null;
        this.showButton(this.ui.dayPause, false);
        this.showButton(this.ui.daySpeed, false);
        this.ui.gameOver = new GameOverLayer(this, () => EventBus.emit(Command.RESTART));
        this.ui.newspaper = new NewspaperLayer(this, () => EventBus.emit(Command.CLOSE_NEWSPAPER), {
            sound: (spec, depth) => this.soundButton(spec, depth),
        });
        this.ui.readProxy = null;
        this.ui.settlement.on('pointerdown', () => {
            if (this.newsEnabled && !this.layout.touch) EventBus.emit(Command.OPEN_NEWSPAPER);
        });
        this.createCameraControls();
    }

    /** By Day: pause or run the clock, and step through 1x, 2x and 4x. Night keeps its own buttons. */
    renderDayTime() {
        const {visible = false, paused = false, speed = 1} = this.menu?.dayTime ?? {};
        const {dayPause, daySpeed} = this.ui;
        this.showButton(dayPause, visible);
        this.showButton(daySpeed, visible);
        dayPause.text.setText(paused ? 'PLAY' : 'PAUSE');
        daySpeed.text.setText(`${speed}×`);
        this.ui.dayPauseProxy = this.syncProxy(this.ui.dayPauseProxy, dayPause, visible, 'day-pause', 'Pause Day');
        this.ui.daySpeedProxy = this.syncProxy(this.ui.daySpeedProxy, daySpeed, visible, 'day-speed', 'Day speed');
        this.ui.dayPauseProxy?.set({paused});
        this.ui.daySpeedProxy?.set({speed});
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
        rect.on('pointerover', () => audioFor(this.game).play('ui.hover'));
        return {rect, text: label};
    }

    createCameraControls() {
        const {camera} = this.layout;
        const add = (spec, text, command, action, name) => {
            const button = this.button(spec, text, 0x37474f, () => {
                audioFor(this.game).play('ui.click');
                EventBus.emit(command);
            });
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
        const report = this.button(this.layout.report, 'REPORT', 0x37474f, () => {
            if (this.newsEnabled) EventBus.emit(Command.OPEN_NEWSPAPER); // TASK 029: the newspaper replaces the box
            else this.setReportOpen(!this.reportOpen);
        });
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

    /**
     * LEGACY counts Day N and its Night N. ACTIVE starts on Day 0, the untimed
     * deployment, and Night N follows Day N - 1: the domain's `day` is the Night's
     * number, so plans and settlements keep theirs.
     */
    onShift({day, shift, seconds, paused, timed = false, fastForward = false, deployment = false}) {
        if (!this.ui) return;
        const pause = paused ? ' (paused)' : '';
        if (!timed) {
            let text = `Day ${day} · Day Shift`;
            if (shift === Shift.DEFEATED) text = `Day ${day} · Headquarters destroyed`;
            if (shift === Shift.NIGHT) text = `Day ${day} · Night Shift · ${seconds} s left${pause}`;
            this.ui.shift.setText(text);
            return;
        }
        const today = `Day ${day - 1}`;
        const texts = {
            [Shift.DAY]: deployment ? `${today} · Initial Deployment`
                : fastForward ? `${today} · Day Shift · ending…` : `${today} · Day Shift · ${seconds} s left${pause}`,
            [Shift.DUSK]: `${today} · Dusk · ${seconds} s${pause}`,
            [Shift.NIGHT]: `Night ${day} · Night Shift · ${seconds} s left${pause}`,
            [Shift.DEFEATED]: `Night ${day} · Headquarters destroyed`,
        };
        this.ui.shift.setText(texts[shift] ?? today);
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
            ...(this.newsEnabled && !this.layout.touch ? ['▸ READ LA VOZ'] : []),
        ].join('\n'));
        this.hasReport = true;
        if (!(this.newsEnabled && this.layout.touch)) this.setReportOpen(true); // on touch the newspaper replaces the box
        this.syncReadLaVoz();
    }

    /** TASK 029: La Voz opens at dawn, and again through REPORT or READ LA VOZ. */
    onNewspaper({enabled, open = false, reason = null, edition = null}) {
        this.newsEnabled = enabled;
        if (!this.ui) return;
        if (open && edition) {
            this.setReportOpen(this.reportOpen && !this.layout.touch);
            this.setDrawerOpen(false);
            this.ui.newspaper.show(edition, {reason, touch: this.layout.touch});
        } else {
            this.ui.newspaper.hide();
        }
        this.syncReadLaVoz();
    }

    /** Desktop: the settlement panel itself is the way in, by Day, while La Voz is closed. */
    syncReadLaVoz() {
        if (!this.ui) return;
        const panel = this.ui.settlement;
        const active = this.newsEnabled && !this.layout.touch && this.hasReport && panel.visible
            && Boolean(this.menu?.visible) && !this.ui.newspaper.open;
        if (active) panel.setInteractive({useHandCursor: true});
        else panel.disableInteractive();
        this.ui.readProxy = this.syncProxy(this.ui.readProxy, {rect: panel}, active, 'show-report', 'READ LA VOZ');
    }

    onMenu(menu) {
        this.menu = menu;
        if (!this.ui) return;
        if (!menu.visible) this.drawerOpen = false;
        this.setDrawerOpen(this.drawerOpen);
        this.setCancelVisible(menu.cancel);
        this.renderEndDay();
        this.ui.speed.setVisible(menu.speed);
        this.renderDayTime();
        this.renderDrawerButtons();
        this.syncReadLaVoz();
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
        const {visible, states, selected, road, paused = false} = this.menu;
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
            const alpha = state === 'available' && !paused ? 1 : DISABLED_ALPHA;
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
            this.ui.proxies[id].set({selected: isSelected, state, paused}).show(shown);
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
        const {building, canFlag, workers, sent, canDemolish, confirmDemolish, refitTo, switchable, paused = false, repair = null, disperse = null} = selection;
        this.ui.controls.update(building, {canFlag, workers, sent, canDemolish, confirmDemolish, refitTo, paused, repair, disperse});
        const narrow = this.layout.touch || building?.type === BARRACKS_TYPE;
        const speakers = selection.speakers ?? null; // TASK 028: HQ's one switch for every Loudspeaker
        if (switchable || speakers) this.layoutToggle(narrow);
        this.showButton(this.ui.toggle, switchable || Boolean(speakers));
        if (!speakers) {
            this.ui.speakersProxy?.destroy();
            this.ui.speakersProxy = null;
        }
        if (!switchable) {
            this.ui.toggleProxy?.destroy();
            this.ui.toggleProxy = null;
            if (speakers) this.renderSpeakers(speakers, paused);
            return;
        }
        const label = building.enabled ? 'Switch OFF' : 'Switch ON';
        this.ui.toggle.text.setText(narrow ? label.replace(' ', '\n') : `${building.id}\n${label}`);
        const alpha = paused ? PAUSED_ALPHA : 1;
        this.ui.toggle.rect.setAlpha(alpha);
        this.ui.toggle.text.setAlpha(alpha);
        this.ui.toggleProxy ??= addProxy(this, this.ui.toggle.rect, 'toggle-power', {label: 'Toggle power'});
        this.ui.toggleProxy.set({target: building.id, enabled: building.enabled, paused});
    }

    /** HQ selected with a tower standing: the power switch's place holds SPEAKERS ON / OFF. */
    renderSpeakers({on}, paused) {
        this.ui.toggle.text.setText(on ? 'SPEAKERS\nON' : 'SPEAKERS\nOFF');
        const alpha = paused ? PAUSED_ALPHA : 1;
        this.ui.toggle.rect.setAlpha(alpha);
        this.ui.toggle.text.setAlpha(alpha);
        this.ui.speakersProxy ??= addProxy(this, this.ui.toggle.rect, 'loudspeakers', {label: 'Loudspeakers'});
        this.ui.speakersProxy.label(on ? 'SPEAKERS ON' : 'SPEAKERS OFF').set({enabled: on, paused});
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
        this.ui.speakersProxy?.destroy();
        this.ui.speakersProxy = null;
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
                newspaperOpen: Boolean(ui?.newspaper.open),
                layout: this.layout.touch ? 'touch' : 'desktop',
            },
            powerView: textView(ui?.power),
            settlementView: textView(ui?.settlement),
            shiftView: textView(ui?.shift),
            waveView: textView(ui?.wave),
            gameOverView: ui ? ui.gameOver.view() : null,
            newspaperView: ui ? ui.newspaper.view() : null,
            pollutionView: textView(ui?.pollution),
            speedView: ui ? ui.speed.view() : null,
            // How dimmed each gameplay button is: 1, or PAUSED_ALPHA in a paused Day.
            actionAlphaView: ui ? {
                menu: Object.fromEntries(Object.entries(ui.buttons).filter(([, btn]) => btn.rect.visible).map(([id, btn]) => [id, btn.rect.alpha])),
                toggle: ui.toggle.rect.visible ? ui.toggle.rect.alpha : null,
                endDay: ui.endDay.rect.visible ? ui.endDay.rect.alpha : null,
                dayPause: ui.dayPause.rect.visible ? ui.dayPause.rect.alpha : null,
            } : null,
            dayTimeView: ui ? {
                visible: ui.dayPause.rect.visible, pause: ui.dayPause.text.text, speed: ui.daySpeed.text.text,
            } : null,
            buildingControlsView: ui ? ui.controls.view() : null,
            placementHint: ui ? ui.hint.text : null,
            hudView: textView(ui?.resources),
            menuLabels: ui && this.menu
                ? Object.fromEntries(Object.entries(ui.buttons).filter(([id]) => Object.hasOwn(this.menu.states, id)).map(([id, b]) => [id, b.text.text]))
                : null,
        };
    }
}
