import Phaser from 'phaser';
import {BARRACKS_LIMIT, FlagFailure, MAX_BARRACKS, MineFailure} from '../core/buildingPlacement.js';
import {BUILDING_TYPES, REFIT_COST, ROAD_COST, getBuildingType} from '../core/buildingTypes.js';
import {PlacementFailure} from '../core/grid.js';
import {PowerStatus} from '../core/power.js';
import {RoadFailure} from '../core/roads.js';
import {WorkFlagFailure} from '../core/workers.js';
import {Shift} from '../core/shiftCycle.js';
import {addProxy} from '../testShadow/TestProxy.js';
import {AudioSettingsPanel} from './AudioSettingsPanel.js';
import {BuildingControls} from './BuildingControls.js';
import {Command, EventBus, Hint, Hud, Notice, State} from './EventBus.js';
import {GameOverLayer} from './GameOverLayer.js';
import {BuildButton, HudButton, TONE} from './HudButton.js';
import {AdviceCard} from './AdviceCard.js';
import {FieldManualLayer} from './FieldManualLayer.js';
import {NewspaperLayer} from './NewspaperLayer.js';
import {audioFor} from '../audio/audio.js';
import {OfficeMenuLayer} from './OfficeMenuLayer.js';
import {browserStorage} from '../audio/SoundManager.js';
import {endingSeen} from './profile.js';
import {SpeedControls} from './SpeedControls.js';
import {DRAWER_ROWS, currentLayout} from './hudLayout.js';
import {costText, shortfall} from './uiArt.js';
import {CampaignMenu} from './CampaignMenu.js';

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
    [Hint.SAVE_FAILED]: 'Campaign could not be saved. Progress may be lost when you leave', // TASK 044
    [Hint.SAVE_REPLACED]: 'Not saved: another tab has replaced or moved on with this campaign', // TASK 044
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
const POWER_STATUS_COLORS = {
    [PowerStatus.NORMAL]: '#c8e6c9',
    [PowerStatus.LOW_POWER]: '#ffcc80',
    [PowerStatus.BLACKOUT]: '#ef9a9a',
};

/** The phase line's colour: Day 0 is not a Day, and Dusk and Night read at a glance. */
const PHASE_COLORS = {
    deployment: '#ffd54f',
    [Shift.DAY]: '#c8e6c9',
    [Shift.DUSK]: '#ffb74d',
    [Shift.NIGHT]: '#90caf9',
    [Shift.DEFEATED]: '#ef9a9a',
};

const MANUAL_TONE = 0x8a6d0a; // TASK 033.1: banana, darkened so the white `i` reads
/** TASK 033.1: the main menu's one row of HUD buttons. START stays centred at (640, 668). */
const MENU_DEPTH = 51; // over the office and the title (50)
const MENU_ROW = Object.freeze({
    manual: {x: 124, y: 668, width: 208, height: 88},
    start: {x: 640, y: 668, width: 260, height: 88},
    sound: {x: 1156, y: 668, width: 208, height: 88},
});
const DISABLED_ALPHA = 0.45;
/**
 * A paused Day's gameplay buttons: dimmed but still readable and still pressable,
 * so a press reaches the domain, which refuses it and says why. PLAY, END DAY, the
 * Day speed, the camera and the drawer stay as they are.
 */
export const PAUSED_ALPHA = DISABLED_ALPHA;
const BAND_COLOR = 0x263238;
const BAND_EDGE = 0x455a64;
const PALETTE_COLOR = 0x1c262b;
const DRAWER_COLOR = 0x1c262b;
const BUTTON_DEPTH = 4;
const LABEL_DEPTH = 5;
const PALETTE_DEPTH = 5.5;
const DRAWER_DEPTH = 8; // the drawer lifts its own buttons above it
const TOOLTIP_DEPTH = 12;

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const cost = ({cost: {credits, ap}}) => (ap ? `${credits}c · ${ap} AP` : `${credits}c`);

/** The full name and price: the build button's tooltip, and what QA reads as its label. */
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
const priceOf = (id) => (id === 'road' ? {credits: ROAD_COST.credits, ap: ROAD_COST.ap ?? 0} : getBuildingType(id).cost);

/**
 * Everything drawn in screen coordinates: the top status bar, the left command rail,
 * the construction drawer, the selection's palette, the right rail's camera, speed
 * and audio controls, hints, La Voz and Game Over. See hudLayout.js for where.
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
        this.economy = null;
        this.drawerOpen = false;
        this.held = {build: false, audio: false, manual: false}; // what this HUD has asked the world to wait for
        this.reportOpen = false;
        this.menuSound = null;
        this.menuManual = null;
        this.hasReport = false;
        this.newsEnabled = false; // TASK 029: REPORT opens La Voz instead
        // TASK 033.1: THE LITTLE YELLOW BOOK, from the main menu and from the rail. It exists
        // before Start, so the menu can open it with no gameplay UI at all.
        this.adviceState = null; // TASK 033.3: what GameScene's Presidential Advice says
        this.manual = new FieldManualLayer(this, {
            onChange: (open) => this.suspend('manual', open),
            sound: (event) => audioFor(this.game).play(event),
            tips: {
                state: () => this.adviceState,
                set: (on) => {
                    audioFor(this.game).play('ui.toggle');
                    EventBus.emit(Command.ADVICE, {action: on ? 'enable' : 'disable'});
                },
                reset: () => {
                    audioFor(this.game).play('ui.click');
                    EventBus.emit(Command.ADVICE, {action: 'reset'});
                },
            },
        });
        this.createTitle();
        this.events.once('shutdown', () => {
            this.officeMenu?.destroy();
            this.officeMenu = null;
            this.manual.close();
            for (const reason of Object.keys(this.held)) this.suspend(reason, false); // nothing stale outlives the HUD
        });
        // Escape closes the book first and does nothing else; otherwise the AUDIO panel, or
        // else the drawer. GameScene hears it too, as before, and leaves a key the book took
        // alone (`papiManual`), whichever scene hears it first.
        this.input.keyboard?.on('keydown-ESC', (event) => {
            if (this.manual.open) {
                if (event) event.papiManual = true;
                this.manual.close();
            } else if (this.ui?.audioPanel?.open) this.ui.audioPanel.close();
            else if (this.drawerOpen) this.setDrawerOpen(false);
        });
        // The arrow keys turn the book's pages while it is open (GameScene's camera ignores them then).
        this.input.keyboard?.on('keydown-LEFT', (event) => {
            if (!this.manual.open) return;
            if (event) event.papiManual = true;
            this.manual.prev();
        });
        this.input.keyboard?.on('keydown-RIGHT', (event) => {
            if (!this.manual.open) return;
            if (event) event.papiManual = true;
            this.manual.next();
        });
        // Leaving a control counts as this scene capturing that move, so GameScene would
        // not see it, and a preview would wait for the next one.
        this.input.on('gameobjectout', (pointer) => EventBus.emit(Notice.POINTER_LEFT_HUD, pointer));

        const handlers = {
            [State.PHASE]: (value) => this.onPhase(value),
            [State.CAMPAIGN]: (value) => this.campaignMenu?.setOffer(value), // TASK 044
            [State.SHIFT]: (value) => this.onShift(value),
            [State.ECONOMY]: (economy) => {
                this.economy = economy;
                this.ui?.resources.setText(`Credits: ${economy.credits}   AP: ${economy.ap}`);
                this.renderMenu(); // what can be afforded changed
            },
            [State.POLLUTION]: ({value, threat}) => this.ui?.pollution.setText(`Pollution ${value}\nThreat Level ${threat}`),
            [State.POWER]: ({generation, demand, status}) => this.ui?.power.setText(`Power ${generation} / ${demand}\n${POWER_STATUS_LABELS[status]}`)
                .setColor(POWER_STATUS_COLORS[status] ?? '#ffffff'),
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
                this.ui?.audioPanel?.close();
                this.manual.close();
                if (this.ui) this.renderManualButton(false);
                this.setDrawerOpen(false);
                this.ui?.gameOver.show(report);
            },
            [State.NEWSPAPER]: (value) => this.onNewspaper(value),
            [State.ADVICE]: (value) => this.onAdvice(value),
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
        this.officeMenu = new OfficeMenuLayer(this, {endingSeen: endingSeen(browserStorage())}); // TASK 036
        const {width} = this.scale;
        this.title = this.add.text(width / 2, 52, 'PAPI Industries: The Green Shift', {
            fontFamily: 'monospace',
            fontSize: '48px',
            color: '#f8d88b',
        }).setOrigin(0.5).setDepth(50);
        // TASK 033.1: the menu's controls are the HUD's own buttons (TASK 032's framed metal,
        // tone fills, hover and press), one row, one height: 88 px, 44 CSS px at 740x360.
        // START keeps its place, colour family, press and proxy.
        this.startButton = new HudButton(this, {...MENU_ROW.start, fontSize: '32px'}, {
            text: 'START', tone: TONE.danger, depth: MENU_DEPTH, onPress: () => {
                audioFor(this.game).play('ui.click');
                if (this.campaignMenu?.offered) this.campaignMenu.openConfirm(); // TASK 044: it would end the saved campaign
                else EventBus.emit(Command.START);
            },
        });
        this.startProxy = addProxy(this, this.startButton.rect, 'start', {label: 'Start'});
        // TASK 044: CONTINUE, its notices and the New Game question. GameScene says what may be continued.
        this.campaignMenu = new CampaignMenu(this, {
            depth: MENU_DEPTH,
            onContinue: () => {
                audioFor(this.game).play('ui.click');
                EventBus.emit(Command.CONTINUE);
            },
            onNewGame: () => {
                audioFor(this.game).play('ui.click');
                EventBus.emit(Command.START, {replace: true});
            },
        });
        this.menuSound = this.menuSoundButton(MENU_ROW.sound);
        this.menuManual = this.menuManualButton(MENU_ROW.manual);
    }

    /** SOUND ON / OFF on the menu: soundButton's behaviour, in the HUD's button. */
    menuSoundButton(spec) {
        const manager = audioFor(this.game);
        if (!manager.enabled) return null;
        const button = new HudButton(this, {...spec, fontSize: '24px'}, {
            tone: TONE.neutral, depth: MENU_DEPTH, onPress: () => {
                if (!manager.toggleMute()) manager.play('ui.toggle');
                render();
            },
        });
        const proxy = addProxy(this, button.rect, 'toggle-sound', {label: 'Sound'});
        const render = () => {
            button.setLabel(manager.muted ? 'SOUND\nOFF' : 'SOUND\nON');
            proxy.label(manager.muted ? 'SOUND OFF' : 'SOUND ON').set({enabled: !manager.muted});
        };
        render();
        return {button, proxy};
    }

    /** TASK 033.1: THE LITTLE YELLOW BOOK on the main menu, opposite SOUND, in the rail `i`'s colour. */
    menuManualButton(spec) {
        const button = new HudButton(this, {...spec, fontSize: '24px'}, {
            text: 'YELLOW\nBOOK', tone: MANUAL_TONE, depth: MENU_DEPTH, onPress: () => this.openManual(),
        });
        const proxy = addProxy(this, button.rect, 'open-manual', {label: 'The Little Yellow Book'});
        return {button, proxy};
    }

    /** Open the book, on its cover unless a page is named. Nothing else stays open over the world with it. */
    openManual(page = 0) {
        if (this.manual.open) return;
        audioFor(this.game).play('ui.click');
        this.setDrawerOpen(false);
        this.ui?.audioPanel?.close();
        this.manual.show({touch: this.layout.touch, page});
    }

    /** TASK 033.3: the tip as GameScene's advice says; the book's TIPS switch follows it. */
    onAdvice(value) {
        const settingChanged = this.adviceState?.setting !== value.setting || this.adviceState?.seen.length !== value.seen.length;
        this.adviceState = value;
        this.ui?.advice.render(value);
        if (settingChanged) this.manual.refresh();
    }

    /** A tip's BOOK: the tip goes, as read, and the book opens at its page. */
    adviceMore() {
        const heading = this.adviceState?.tip?.book ?? null;
        EventBus.emit(Command.ADVICE, {action: 'more'});
        this.openManual(this.manual.pageOf(heading));
    }

    /** The rail's `i`: there whenever the HUD is, by Day and Night, until Game Over. */
    renderManualButton(visible) {
        this.ui.manualButton.setVisible(visible);
        this.ui.manualProxy = this.syncProxy(this.ui.manualProxy, this.ui.manualButton, visible, 'open-manual', 'The Little Yellow Book');
    }

    /**
     * TASK 030's minimum control: SOUND ON / OFF (M on desktop), on the menu and in La
     * Voz, the two screens every player sees. In play, AUDIO on the right rail opens
     * the full settings (TASK 032).
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
        this.ui?.audioPanel?.render(); // follows the M key
    }

    onPhase({phase}) {
        if (phase === 'ready' || this.ui) return;
        this.officeMenu?.destroy();
        this.officeMenu = null;
        this.title.setVisible(false);
        this.campaignMenu?.destroy(); // TASK 044
        this.campaignMenu = null;
        this.startButton.setVisible(false);
        this.startProxy.destroy();
        this.startProxy = null;
        for (const item of [this.menuSound, this.menuManual]) {
            if (!item) continue;
            item.button.destroy();
            item.proxy.destroy();
        }
        this.menuSound = null;
        this.menuManual = null;
        this.createUi();
    }

    // ---- Controls ----------------------------------------------------------

    createUi() {
        const {layout} = this;
        const label = ({x, y, fontSize, originX, wrap, ...style}, color = '#ffffff') => this.add.text(x, y, '', {
            fontFamily: 'monospace', fontSize, color, ...(wrap ? {wordWrap: {width: wrap}} : {}), ...style,
        }).setOrigin(originX, originX === 0.5 ? 0.5 : 0);
        const {text} = layout;
        for (const {x, y, width, height} of layout.bands) {
            this.add.rectangle(x, y, width, height, BAND_COLOR).setOrigin(0, 0);
        }
        // The top bar's lower edge, so the status bar reads as one strip.
        this.add.rectangle(0, layout.bands[0].height - 2, this.scale.width, 2, BAND_EDGE).setOrigin(0, 0);
        this.ui = {
            shift: label(text.shift, PHASE_COLORS[Shift.DAY]).setFontStyle('bold'),
            resources: label(text.resources).setFontStyle('bold'),
            wave: label(text.wave, '#ef9a9a').setVisible(false),
            pollution: label(text.pollution, '#dce775'),
            power: label(text.power),
            hint: label(text.hint, '#ffcc80').setVisible(false).setDepth(LABEL_DEPTH),
            settlement: label({...text.settlement, backgroundColor: '#263238', padding: {x: 8, y: 6}}).setVisible(false).setDepth(LABEL_DEPTH),
        };
        this.ui.tooltip = this.add.text(0, 0, '', {
            fontFamily: 'monospace', fontSize: '16px', color: '#ffffff', backgroundColor: '#101820', padding: {x: 6, y: 4},
        }).setOrigin(0, 0.5).setDepth(TOOLTIP_DEPTH).setVisible(false);
        this.createPalette();
        this.createRail();
        this.createBuildMenu();
        this.ui.toggle = this.button({...layout.palette.slot(0), fontSize: layout.palette.fontSize}, '', TONE.neutral,
            () => EventBus.emit(Command.TOGGLE_POWER), PALETTE_DEPTH + 0.5);
        this.ui.toggleProxy = null;
        this.ui.speakersProxy = null;
        this.ui.toggle.setVisible(false);
        this.ui.controls = new BuildingControls(this, {
            onFlag: () => EventBus.emit(Command.MOVE_FLAG),
            onResetFlag: () => EventBus.emit(Command.RESET_FLAG),
            onDemolish: () => EventBus.emit(Command.DEMOLISH),
            onRefit: () => EventBus.emit(Command.REFIT),
            onRepair: () => EventBus.emit(Command.REPAIR),
            onDisperse: () => EventBus.emit(Command.DISPERSE),
        }, layout.palette);
        this.ui.speed = new SpeedControls(this, (speed) => EventBus.emit(Command.SET_SPEED, {speed}), layout.speed);
        this.ui.dayPause = this.button(layout.dayTime.pause, 'PAUSE', TONE.neutral, () => EventBus.emit(Command.TOGGLE_DAY_PAUSE));
        this.ui.daySpeed = this.button(layout.dayTime.speed, '1×', TONE.neutral, () => EventBus.emit(Command.CYCLE_DAY_SPEED));
        this.ui.dayPauseProxy = null;
        this.ui.daySpeedProxy = null;
        this.ui.dayPause.setVisible(false);
        this.ui.daySpeed.setVisible(false);
        this.ui.gameOver = new GameOverLayer(this, () => EventBus.emit(Command.RESTART));
        this.ui.newspaper = new NewspaperLayer(this, () => EventBus.emit(Command.CLOSE_NEWSPAPER), {
            sound: (spec, depth) => this.soundButton(spec, depth),
        });
        // The desktop figures stay clickable: the panel opens La Voz too (REPORT is the button for it).
        this.ui.settlement.on('pointerdown', () => {
            if (this.newsEnabled && !this.layout.touch) EventBus.emit(Command.OPEN_NEWSPAPER);
        });
        this.createCameraControls();
        this.createAudioControls();
        this.ui.advice = new AdviceCard(this, layout.advice, {
            onDismiss: () => {
                audioFor(this.game).play('ui.back');
                EventBus.emit(Command.ADVICE, {action: 'dismiss'});
            },
            onMore: () => this.adviceMore(),
        });
        this.ui.advice.render(this.adviceState);
    }

    /** Left rail: BUILD, CANCEL while placing, REPORT, END DAY. A slot is kept for PAPI DIRECTIVES. */
    createRail() {
        const {rail} = this.layout;
        this.ui.build = this.button(rail.build, 'BUILD', TONE.go, () => this.setDrawerOpen(!this.drawerOpen));
        this.ui.buildProxy = null;
        this.ui.cancel = this.button(rail.cancel, 'CANCEL', TONE.stop, () => EventBus.emit(Command.CANCEL));
        this.ui.cancelProxy = null;
        this.ui.report = this.button(rail.report, 'REPORT', TONE.neutral, () => {
            if (this.newsEnabled) EventBus.emit(Command.OPEN_NEWSPAPER); // TASK 029: the newspaper replaces the box
            else this.setReportOpen(!this.reportOpen);
        });
        this.ui.report.text.setStyle({fontSize: '17px'});
        this.ui.reportProxy = null;
        this.ui.endDay = this.button(rail.endDay, 'END\nDAY', TONE.earth, () => EventBus.emit(Command.END_DAY));
        this.ui.endDayProxy = null;
        for (const button of [this.ui.build, this.ui.cancel, this.ui.report, this.ui.endDay]) button.setVisible(false);
        // TASK 033.1: below the reserved PAPI DIRECTIVES slot, which stays free.
        this.ui.manualButton = this.button(rail.manual, 'i\nBOOK', MANUAL_TONE, () => this.openManual());
        this.ui.manualProxy = null;
        this.renderManualButton(true);
    }

    /** The selection's palette: a panel with the object's name, HP and state, and its commands below. */
    createPalette() {
        const {panel, header} = this.layout.palette;
        this.ui.palette = {
            panel: this.add.rectangle(panel.x, panel.y, panel.width, panel.height, PALETTE_COLOR, 0.94).setOrigin(0, 0)
                .setStrokeStyle(2, BAND_EDGE).setDepth(PALETTE_DEPTH).setVisible(false),
            header: this.add.text(header.x, header.y, '', {
                fontFamily: 'monospace', fontSize: header.fontSize, color: '#f8d88b', lineSpacing: header.lineSpacing,
                wordWrap: {width: header.wrap},
            }).setDepth(PALETTE_DEPTH + 0.1).setVisible(false),
        };
    }

    /** By Day: pause or run the clock, and step through 1x, 2x and 4x. Night keeps its own buttons. */
    renderDayTime() {
        const {visible = false, paused = false, speed = 1} = this.menu?.dayTime ?? {};
        const {dayPause, daySpeed} = this.ui;
        dayPause.setVisible(visible);
        daySpeed.setVisible(visible);
        dayPause.setLabel(paused ? 'PLAY' : 'PAUSE').setTone(paused ? TONE.go : TONE.neutral).setSelected(paused);
        daySpeed.setLabel(`${speed}×`);
        this.ui.dayPauseProxy = this.syncProxy(this.ui.dayPauseProxy, dayPause, visible, 'day-pause', 'Pause Day');
        this.ui.daySpeedProxy = this.syncProxy(this.ui.daySpeedProxy, daySpeed, visible, 'day-speed', 'Day speed');
        this.ui.dayPauseProxy?.set({paused});
        this.ui.daySpeedProxy?.set({speed});
    }

    button(spec, text, tone, onPress, depth = BUTTON_DEPTH) {
        return new HudButton(this, {fontSize: '20px', ...spec}, {text, tone, onPress, depth});
    }

    createCameraControls() {
        const {camera} = this.layout;
        const add = (spec, text, command, action, name) => {
            const button = this.button({...spec, fontSize: '20px'}, text, TONE.neutral, () => {
                audioFor(this.game).play('ui.click');
                EventBus.emit(command);
            });
            addProxy(this, button.rect, action, {label: name});
            return button;
        };
        this.ui.camera = {
            zoomIn: add(camera.zoomIn, 'ZOOM\n+', Command.ZOOM_IN, 'camera-zoom-in', 'Zoom in'),
            fit: add(camera.fit, 'FIT', Command.FIT, 'camera-fit', 'Fit to battlefield'),
            zoomOut: add(camera.zoomOut, 'ZOOM\n−', Command.ZOOM_OUT, 'camera-zoom-out', 'Zoom out'),
        };
    }

    /** AUDIO on the right rail opens the settings panel, when there is sound at all. */
    createAudioControls() {
        const manager = audioFor(this.game);
        this.ui.audioPanel = null;
        this.ui.audio = null;
        if (!manager.enabled) return;
        const {audio} = this.layout;
        this.ui.audioPanel = new AudioSettingsPanel(this, manager, audio, {onChange: (open) => this.suspend('audio', open)});
        this.ui.audio = this.button({...audio.open, fontSize: '20px'}, 'AUDIO', TONE.neutral, () => {
            manager.play('ui.click');
            this.setDrawerOpen(false);
            this.ui.audioPanel.toggle();
        });
        addProxy(this, this.ui.audio.rect, 'audio-settings', {label: 'Audio settings'});
    }

    createBuildMenu() {
        const {layout} = this;
        const {drawer} = layout;
        this.ui.buttons = {};
        this.ui.proxies = {};
        this.menuText = {};
        const panel = this.add.rectangle(drawer.panel.x, drawer.panel.y, drawer.panel.width, drawer.panel.height, DRAWER_COLOR, 0.97)
            .setOrigin(0, 0)
            .setStrokeStyle(3, 0x90a4ae)
            .setDepth(DRAWER_DEPTH)
            .setInteractive()
            .setVisible(false);
        panel.on('pointerdown', () => this.setDrawerOpen(false));
        const headings = drawer.labels.map(({label, x, y}) => this.add.text(x, y, label, {
            fontFamily: 'monospace', fontSize: drawer.headingFont, fontStyle: 'bold', color: '#c8e6c9',
        }).setDepth(DRAWER_DEPTH + 1).setVisible(false));
        this.ui.drawer = {panel, headings};
        for (const [id, spec] of Object.entries(layout.menu)) {
            this.menuText[id] = menuLabel(id);
            const button = new BuildButton(this, id, spec, {
                scale: drawer.scale, depth: DRAWER_DEPTH + 1, costFont: drawer.costFont, labelFont: drawer.labelFont,
                onPress: () => this.pressMenu(id),
                onHover: (hovered) => this.showTooltip(hovered ? button : null),
            });
            button.setVisible(false);
            this.ui.buttons[id] = button;
        }
    }

    /** Desktop hover: the full name and price beside the build button, kept on screen. */
    showTooltip(button) {
        const {tooltip} = this.ui;
        if (!button || this.layout.touch || !button.visible) {
            tooltip.setVisible(false);
            return;
        }
        const {x, y, width} = button.view().box;
        tooltip.setText(this.menuText[button.id]);
        const right = x + width / 2 + 6;
        const fits = right + tooltip.width <= this.scale.width;
        tooltip.setOrigin(fits ? 0 : 1, 0.5).setPosition(fits ? right : x - width / 2 - 6, y).setVisible(true);
    }

    /**
     * The choice is made, then the drawer closes and lets the world go, and placement
     * begins. The press was the HUD's, so it never lands on the world as well.
     */
    pressMenu(id) {
        EventBus.emit(id === 'road' ? Command.ROAD : Command.BUILD, {type: id});
        this.setDrawerOpen(false);
    }

    /**
     * TASK 032: an open drawer or AUDIO panel holds the world, each as its own reason,
     * only on a change, so nothing is ever toggled blindly.
     */
    suspend(reason, on) {
        if (this.held[reason] === on) return;
        this.held[reason] = on;
        EventBus.emit(Command.SUSPEND, {reason, on});
    }

    setDrawerOpen(open) {
        this.drawerOpen = open;
        if (this.ui) this.suspend('build', open);
        if (this.ui?.drawer) {
            this.ui.drawer.panel.setVisible(open);
            // A category with nothing to offer on this map (no deposits, no protesters) shows no heading.
            const offered = (id) => (id === 'road' ? this.menu?.road != null : Object.hasOwn(this.menu?.states ?? {}, id));
            this.ui.drawer.headings.forEach((heading, i) => heading.setVisible(open && DRAWER_ROWS[i][1].some(offered)));
            if (!open) this.ui.tooltip.setVisible(false);
            if (open) this.ui.audioPanel?.close();
        }
        this.renderMenu();
        this.renderPalette();
    }

    setReportOpen(open) {
        this.reportOpen = open;
        this.ui.settlement.setVisible(open && this.hasReport);
    }

    /** A press on the world closes the drawer, and on touch the settlement box. */
    onWorldPressed() {
        if (!this.ui) return;
        if (this.drawerOpen) this.setDrawerOpen(false);
        if (this.layout.touch) this.setReportOpen(false);
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
        this.ui.shift.setColor(paused ? '#fff59d' : PHASE_COLORS[deployment && shift === Shift.DAY ? 'deployment' : shift] ?? '#ffffff');
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
        this.renderRail();
        this.syncReadLaVoz();
    }

    /** TASK 029: La Voz opens at dawn, and again through REPORT. */
    onNewspaper({enabled, open = false, reason = null, edition = null}) {
        this.newsEnabled = enabled;
        if (!this.ui) return;
        if (open && edition) {
            this.setReportOpen(this.reportOpen && !this.layout.touch);
            this.setDrawerOpen(false);
            this.ui.audioPanel?.close();
            this.manual.close(); // La Voz is the dawn's; the book can be opened again after
            this.ui.newspaper.show(edition, {reason, touch: this.layout.touch});
        } else {
            this.ui.newspaper.hide();
        }
        this.renderRail();
        this.syncReadLaVoz();
    }

    /** Desktop: the settlement panel itself still opens La Voz, by Day, while La Voz is closed. */
    syncReadLaVoz() {
        if (!this.ui) return;
        const panel = this.ui.settlement;
        const active = this.newsEnabled && !this.layout.touch && this.hasReport && panel.visible
            && Boolean(this.menu?.visible) && !this.ui.newspaper.open;
        if (active) panel.setInteractive({useHandCursor: true});
        else panel.disableInteractive();
    }

    onMenu(menu) {
        this.menu = menu;
        if (!this.ui) return;
        this.setDrawerOpen(this.drawerOpen && menu.visible); // no drawer when construction is closed
        this.ui.speed.setVisible(menu.speed);
        this.renderRail();
        this.renderDayTime();
        this.syncReadLaVoz();
    }

    /** The rail's buttons follow the phase: BUILD and REPORT by Day, CANCEL while placing. */
    renderRail() {
        if (!this.ui || !this.menu) return;
        const {visible, cancel} = this.menu;
        const {build, report} = this.ui;
        build.setVisible(visible).setSelected(this.drawerOpen);
        this.ui.buildProxy = this.syncProxy(this.ui.buildProxy, build, visible, 'open-build', 'Build');
        this.ui.buildProxy?.set({open: this.drawerOpen});
        this.setCancelVisible(cancel);
        this.renderEndDay();
        const showReport = visible && this.hasReport;
        report.setVisible(showReport).setLabel(this.newsEnabled ? 'LA VOZ' : 'REPORT');
        const reportLabel = this.newsEnabled && !this.layout.touch ? 'READ LA VOZ' : 'Report';
        this.ui.reportProxy = this.syncProxy(this.ui.reportProxy, report, showReport, 'show-report', reportLabel);
        this.ui.reportProxy?.label(reportLabel);
    }

    showButton(button, visible) {
        button.setVisible(visible);
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
        const shown = visible && this.drawerOpen;
        this.ui.build?.setSelected(this.drawerOpen && visible);
        this.ui.buildProxy?.set({open: this.drawerOpen});
        for (const [id, button] of Object.entries(this.ui.buttons)) {
            const isRoad = id === 'road';
            if ((!isRoad && !Object.hasOwn(states, id)) || (isRoad && road === null)) {
                button.setVisible(false);
                continue;
            }
            button.setVisible(shown);
            const state = isRoad ? road.state : states[id];
            const isSelected = selected === id;
            const price = priceOf(id);
            button.render({state, selected: isSelected, paused, price: costText(price), lacks: shortfall(price, this.economy)});
            if (state === 'built') {
                const type = getBuildingType(id);
                this.menuText[id] = `${type.name} ${type.width}x${type.height}\nBUILT`;
            } else this.menuText[id] = menuLabel(id);
            if (!visible) {
                this.ui.proxies[id]?.destroy();
                delete this.ui.proxies[id];
                continue;
            }
            this.ui.proxies[id] ??= addProxy(this, button.rect, `build-${id}`, {label: isRoad ? 'Road' : BUILDING_TYPES[id].name});
            const lacks = shortfall(price, this.economy);
            this.ui.proxies[id].set({selected: isSelected, state, paused, affordable: lacks === null}).show(shown);
        }
    }

    renderEndDay() {
        const {visible, enabled} = this.menu.endDay;
        const {endDay} = this.ui;
        endDay.setVisible(visible).setAlpha(enabled ? 1 : DISABLED_ALPHA);
        this.ui.endDayProxy = this.syncProxy(this.ui.endDayProxy, endDay, visible, 'end-day', 'End Day');
        this.ui.endDayProxy?.set({enabled});
    }

    setCancelVisible(visible) {
        this.ui.cancel.setVisible(visible);
        this.ui.cancelProxy = this.syncProxy(this.ui.cancelProxy, this.ui.cancel, visible, 'cancel-placement', 'Cancel');
    }

    onSelection(selection) {
        this.selection = selection;
        if (!this.ui) return;
        this.renderPalette();
    }

    /**
     * The palette: the selection's switch first (power, or HQ's speakers), then the
     * commands BuildingControls stacks below it. Hidden while the drawer is open, so
     * the two never overlap; the selection itself is kept.
     */
    renderPalette() {
        const selection = this.selection;
        if (!this.ui || !selection) return;
        const {building, canFlag, workers, sent, canDemolish, confirmDemolish, refitTo, switchable, paused = false, repair = null, disperse = null} = selection;
        const speakers = selection.speakers ?? null; // TASK 028: HQ's one switch for every Loudspeaker
        const blocked = this.drawerOpen;
        const hasSwitch = !blocked && (switchable || Boolean(speakers));
        const quiet = {canFlag: false, workers, sent, canDemolish: false, confirmDemolish, refitTo: null, paused, repair: null, disperse: null};
        const used = this.ui.controls.update(building, blocked ? quiet : {canFlag, workers, sent, canDemolish, confirmDemolish, refitTo, paused, repair, disperse},
            hasSwitch ? 1 : 0);
        this.ui.toggle.setVisible(hasSwitch);
        const visible = hasSwitch || used > 0;
        this.ui.palette.panel.setVisible(visible);
        this.ui.palette.header.setVisible(visible).setText(visible ? this.paletteHeader(selection) : '');
        if (!speakers || blocked) {
            this.ui.speakersProxy?.destroy();
            this.ui.speakersProxy = null;
        }
        if (!switchable || blocked) {
            this.ui.toggleProxy?.destroy();
            this.ui.toggleProxy = null;
            if (speakers && !blocked) this.renderSpeakers(speakers, paused);
            return;
        }
        this.ui.toggle.setLabel(building.enabled ? 'SWITCH\nOFF' : 'SWITCH\nON').setTone(building.enabled ? TONE.on : TONE.neutral)
            .setAlpha(paused ? PAUSED_ALPHA : 1);
        this.ui.toggleProxy ??= addProxy(this, this.ui.toggle.rect, 'toggle-power', {label: 'Toggle power'});
        this.ui.toggleProxy.set({target: building.id, enabled: building.enabled, paused});
    }

    /** Name, HP and state, where there are any. */
    paletteHeader({building, disperse}) {
        if (!building) return disperse ? 'PROTEST\nblocking a road' : '';
        const type = getBuildingType(building.type);
        const name = (building.role === 'rocket' ? 'Rocket Barracks' : type.name).toUpperCase();
        const state = type.switchable === false ? null : !building.enabled ? 'OFF' : building.powered ? 'ON' : 'UNPOWERED';
        return [name, `HP ${building.hp}/${building.maxHp}`, ...(state ? [state] : [])].join('\n');
    }

    /** HQ selected with a tower standing: the switch's slot holds SPEAKERS ON / OFF. */
    renderSpeakers({on}, paused) {
        this.ui.toggle.setLabel(on ? 'SPEAKERS\nON' : 'SPEAKERS\nOFF').setTone(on ? TONE.on : TONE.neutral)
            .setAlpha(paused ? PAUSED_ALPHA : 1);
        this.ui.speakersProxy ??= addProxy(this, this.ui.toggle.rect, 'loudspeakers', {label: 'Loudspeakers'});
        this.ui.speakersProxy.label(on ? 'SPEAKERS ON' : 'SPEAKERS OFF').set({enabled: on, paused});
    }

    // ---- QA ----------------------------------------------------------------

    /** What is really on screen, read off the game objects. */
    views() {
        const ui = this.ui;
        const textView = (view) => (view ? {visible: view.visible, text: view.text} : null);
        return {
            officeMenuView: this.officeMenu?.view() ?? null, // TASK 036: portrait, bust frame, El Colonel
            ui: {
                titleVisible: this.title.visible,
                startVisible: this.startButton.visible,
                cancelVisible: ui ? ui.cancel.visible : false,
                endDayVisible: ui ? ui.endDay.visible : false,
                buildMenuVisible: ui ? ui.build.visible : false,
                toggleVisible: ui ? ui.toggle.visible : false,
                hintVisible: ui ? ui.hint.visible : false,
                drawerOpen: this.drawerOpen,
                paletteVisible: ui ? ui.palette.panel.visible : false,
                audioOpen: Boolean(ui?.audioPanel?.open),
                newspaperOpen: Boolean(ui?.newspaper.open),
                manualOpen: this.manual.open, // TASK 033.1
                manualButtonVisible: ui ? ui.manualButton.visible : Boolean(this.menuManual),
                adviceVisible: ui ? ui.advice.view().visible : false, // TASK 033.3
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
                menu: Object.fromEntries(Object.entries(ui.buttons).filter(([, btn]) => btn.visible).map(([id, btn]) => [id, btn.rect.alpha])),
                toggle: ui.toggle.visible ? ui.toggle.rect.alpha : null,
                endDay: ui.endDay.visible ? ui.endDay.rect.alpha : null,
                dayPause: ui.dayPause.visible ? ui.dayPause.rect.alpha : null,
            } : null,
            dayTimeView: ui ? {
                visible: ui.dayPause.visible, pause: ui.dayPause.text.text, speed: ui.daySpeed.text.text,
            } : null,
            buildingControlsView: ui ? ui.controls.view() : null,
            placementHint: ui ? ui.hint.text : null,
            hudView: textView(ui?.resources),
            // The full name and price of each offered button: its tooltip and accessible description.
            menuLabels: ui && this.menu
                ? Object.fromEntries(Object.keys(ui.buttons).filter((id) => Object.hasOwn(this.menu.states, id)).map((id) => [id, this.menuText[id]]))
                : null,
            // TASK 032: the build buttons as drawn, the palette and the audio settings.
            buildButtonViews: ui ? Object.fromEntries(Object.entries(ui.buttons).map(([id, b]) => [id, b.view()])) : null,
            paletteView: ui ? {
                visible: ui.palette.panel.visible,
                header: ui.palette.header.visible ? ui.palette.header.text : null,
                toggle: ui.toggle.visible ? {label: ui.toggle.text.text, box: ui.toggle.box()} : null,
            } : null,
            audioSettingsView: ui?.audioPanel ? ui.audioPanel.view() : null,
            fieldManualView: this.manual.view(), // TASK 033.1, before Start too
            adviceView: ui ? ui.advice.view() : null, // TASK 033.3: the card as drawn
        };
    }
}
