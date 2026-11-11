import Phaser from 'phaser';
import {GamePhase, defeatGame, startGame} from '../core/gamePhase.js';
import {Grid} from '../core/grid.js';
import {BARRACKS_TYPE, BUILDING_TYPES, BarracksRole, HQ_TYPE, WALL_TYPE, getBuildingType} from '../core/buildingTypes.js';
import {BuildingPlacement, GAME_PAUSED, HQ_ALREADY_BUILT} from '../core/buildingPlacement.js';
import {Economy} from '../core/economy.js';
import {SimulationClock} from '../core/simulationClock.js';
import {SeededRandom, DEFAULT_SEED, parseSeed} from '../core/seededRandom.js';
import {DAY_TICKS, DUSK_TICKS, ShiftCycle, Shift} from '../core/shiftCycle.js';
import {MAX_MANUAL_STEPS, SIMULATION_SPEEDS} from '../core/simulationClock.js';
import {Gates} from '../core/gates.js';
import {INFANTRY, Infantry} from '../core/infantry.js';
import {Logistics} from '../core/logistics.js';
import {ROAD_ACCESS_TYPES, RoadFailure, RoadNetwork, barracksExit, receivingDock, shippingDock} from '../core/roads.js';
import {settleNight} from '../core/settlement.js';
import {calculatePower, causesLowPower} from '../core/power.js';
import {TerrainKind} from '../core/terrain.js';
import {Pollution, calculateEmissions, threatLevel} from '../core/pollution.js';
import {Mutants} from '../core/mutants.js';
import {nightPlan, waveProgress} from '../core/waves.js';
import {Autocannons} from '../core/autocannons.js';
import {DEFAULT_MAP, TILE_SIZE, WORLD_MAPS, createTerrain} from '../core/worldMap.js';
import {WORKER, Workers, repairPrice} from '../core/workers.js';
import {ECOLOGIST, Ecologists} from '../core/ecologists.js';
import {LOUDSPEAKER, Loudspeakers} from '../core/loudspeakers.js';
import {LOUDSPEAKER_TYPE} from '../core/buildingTypes.js';
import {FogOfWar, buildingVision, fortificationTiles, startingKnown, unitVision} from '../core/vision.js';
import {SIEGE, SIEGE_CANNON_TYPE, SiegeCannons} from '../core/siegeCannons.js';
import {TEST_MODE} from '../testMode.js';
import {markScene, setBodyState} from '../testShadow/TestProxy.js';
import {createSetDay} from '../testShadow/dayQa.js';
import {createEconomyQa} from '../testShadow/economyQa.js';
import {createLayoutQa} from '../testShadow/layoutSnapshot.js';
import {createPerfProbe} from '../testShadow/PerfProbe.js';
import {parseStressBrutes, parseStressSchedule, parseStressSpitters} from '../testShadow/stressParams.js';
import {parseWorldParams} from '../testShadow/worldParams.js';
import {QASurface} from '../testShadow/QASurface.js';
import {MutantLayer} from './MutantLayer.js';
import {NightTintLayer} from './NightTintLayer.js';
import {AutocannonLayer} from './AutocannonLayer.js';
import {SiegeLayer} from './SiegeLayer.js';
import {RoadLayer} from './RoadLayer.js';
import {FogLayer} from './FogLayer.js';
import {WorkerLayer} from './WorkerLayer.js';
import {PresidentCameo} from './presidentCameo.js';
import {ADVICE_TIMING, PresidentialAdvice} from './presidentialAdvice.js';
import {ADVICE} from '../content/advice.js';
import {browserStorage} from '../audio/SoundManager.js';
import {PresidentLayer} from './PresidentLayer.js';
import {HeliVisit, blendPose, cameraTarget, pickupPoint} from './presidentialHeli.js';
import {HeliLayer} from './HeliLayer.js';
import {endingDue} from './presidentialEnding.js';
import {endingSeen, setEndingSeen} from './profile.js';
import {atDawnHold, captureDawn, restoreDawn} from '../core/dawnCheckpoint.js';
import {endCampaign, newCampaign, readCampaign, worldOf, writeCampaign} from './campaignStorage.js';
import {createEndingQa} from '../testShadow/endingQa.js';
import {EcologistLayer} from './EcologistLayer.js';
import {TerrainLayer} from './TerrainLayer.js';
import {TruckLayer} from './TruckLayer.js';
import {GateLayer} from './GateLayer.js';
import {InfantryLayer} from './InfantryLayer.js';
import {BuildingArtLayer} from './BuildingArtLayer.js';
import {Command, EventBus, Hint, Hud, Notice, State} from './EventBus.js';
import {edition as newspaperEdition} from '../content/newspaper.js';
import {audioFor, loadMusicWhenUnlocked} from '../audio/audio.js';
import {GameAudio} from '../audio/GameAudio.js';
import {CombatFxLayer} from './CombatFxLayer.js';
import {bodyCentreAbove, planEffects} from './combatFx.js';
import {WorldCamera} from './WorldCamera.js';
import {currentLayout} from './hudLayout.js';
import {isOrientationBlocked} from './orientationGuard.js';
import {SuspendReason, Suspension} from './suspension.js';

/**
 * END DAY runs the rest of the Day through stepSimulation, this many ticks a frame
 * at most: never the whole Day in one frame. 3600 ticks take 15 frames.
 */
export const FAST_FORWARD_TICKS_PER_FRAME = MAX_MANUAL_STEPS;

/** What a player may still do while END DAY's fast-forward runs: look around. */
const HELI_DAY = 2; // TASK 035: the calendar's day 2 is the HUD's Day 1, the first timed Day after Night 1
const FAST_FORWARD_ALLOWED = new Set([Command.ZOOM_IN, Command.ZOOM_OUT, Command.FIT, Command.RESTART]);

const GRID_LINE_COLOR = 0x78909c;
const HIGHLIGHT_COLOR = 0xffeb3b;
export const PREVIEW_VALID_COLOR = 0x4caf50;
export const PREVIEW_INVALID_COLOR = 0xe53935;
const ROAD_TILE_COLOR = 0x455a64; // a gate's barrier is drawn over its road
const BUILDING_COLORS = {
    hq: 0xc9a227, outpost: 0x9e9e9e, factory: 0x616161, mine: 0x8d6e63, powerPlant: 0x5c6bc0, autocannon: 0x00897b, siegeCannon: 0x7b1fa2, barracks: 0x558b2f,
    wall: 0xa1887f, gateVertical: ROAD_TILE_COLOR, gateHorizontal: ROAD_TILE_COLOR,
};
const BUILDING_STROKE = 0x212121;
export const UNPOWERED_STROKE = 0xe53935; // enabled but not operating (low power / blackout)
export const DISABLED_ALPHA = 0.35; // switched OFF by the player

const WORLD_MARGIN = 16; // a mutant on the map edge stays in view
const KEY_PAN = 48; // px of screen per arrow key press
const PINCH_MIN_DISTANCE = 8; // px, below which two fingers are too close to measure
const NO_HUD = Object.freeze({ui: {}});

/**
 * The world: rendering, the world camera, the simulation, and what a press on the
 * battlefield means. Everything in screen coordinates lives in HUDScene, above it.
 * The two talk only through EventBus: this scene publishes presentation state when
 * it changes and acts on commands, and it never touches a HUD object.
 *
 * Input modes after Start:
 *   - Normal: a press on the grid selects/highlights a cell; outside the grid clears
 *     the selection.
 *   - Placement (a building was chosen): moving previews the centred footprint, a
 *     press attempts placement, and walls also follow a drag. Selection is disabled.
 *     Escape or Cancel returns to normal mode.
 *   - Road: a press adds or removes a road, and a drag only adds.
 *   - Flag: the next press becomes the Barracks' post.
 *
 * A mouse acts on pointerdown. A finger acts on release, so that a second finger can
 * still turn it into a pinch or a pan, which change nothing.
 *
 * A finger never builds by accident, because it has no hover to aim with. Choosing a
 * building shows a ghost on the map. A tap or drag moves the ghost, and a separate
 * tap inside it confirms: that is the only touch that spends anything. Walls and
 * roads do the same with a segment, drawn by dragging and confirmed all at once.
 * The ghost is only a proposal: every rule and price is still placeAt's, and the
 * mouse path never sees it.
 *
 * A press on a HUD control never arrives here: Phaser stops at the first scene that
 * captures it. Screen points become world points through WorldCamera, because
 * pointer.worldX belongs to whichever scene looked at it last.
 *
 * Rules live in core (Grid, BuildingPlacement). The preview colour is
 * derived from the domain validation result, never the reverse.
 *
 * Test Shadow usage:
 *   - markScene()/setBodyState() — coarse `data-phase` on <body>.
 *   - QASurface — grid, selection, placement result, rendered preview and
 *     building views, with what HUDScene really shows merged in.
 */
export class GameScene extends Phaser.Scene {
    constructor() {
        super('game');
    }

    create(data = {}) {
        this.phase = GamePhase.READY;
        this.grid = null;
        this.terrain = null;
        this.terrainLayer = null;
        this.fog = null;
        this.fogLayer = null;
        this.placement = null;
        this.economy = null;
        this.pollution = null;
        this.mutants = null;
        this.mutantLayer = null;
        this.combatFx = null;
        this.autocannons = null;
        this.autocannonLayer = null;
        this.siegeCannons = null;
        this.siegeLayer = null;
        this.hqRequired = true;
        this.lastResult = null;
        this.selectedCell = null;
        this.selectionHighlight = null;
        this.previewRect = null;
        this.previewResult = null;
        this.buildingViews = new Map();
        this.buildingArt = null;
        this.cycle = null;
        this.selectedBuildingId = null;
        this.selectedProtestId = null;
        this.roads = null;
        this.roadLayer = null;
        this.logistics = null;
        this.truckLayer = null;
        this.gates = null;
        this.gateLayer = null;
        this.infantry = null;
        this.infantryLayer = null;
        this.workers = null;
        this.workerLayer = null;
        this.ecologists = null;
        this.loudspeakers = null;
        this.speakerRing = null;
        this.speakerRingKey = null;
        this.ecologistLayer = null;
        this.renderedWorkFlagKey = null; // last revision, flag and selection the work flag was drawn for
        this.flagBarracksId = null; // the Barracks or HQ being given a flag, in flag mode
        this.powerWarning = null; // {type, col, row}: a purchase waiting for its second press
        this.renderedPostsKey = null; // last revision and selection the flags were drawn for
        this.dragCell = null;
        this.roadMode = false;
        this.roadDragAdds = false;
        this.renderedShiftKey = null; // last `${day}:${shift}` the UI was synced to
        this.renderedShift = null;
        this.presented = new Map(); // event -> {key, value}: the latest of everything the HUD is told
        this.hudReady = false;
        this.pendingPress = null; // {pointerId, cell}, plus {ghost, onGhost, moved, prior} while building
        this.ghostCell = null; // the tile a finger has proposed for a building
        this.segment = null; // the tiles a finger has proposed for walls or roads
        this.segmentView = []; // those tiles, with whether each would be accepted
        this.ghostRevision = 0;
        this.ghostLast = null; // 'moved', 'confirmed', 'refused' or 'cleared'
        this.gesture = null; // {distance, x, y}: two fingers, and nothing else happens until both lift
        this.mousePan = null; // {x, y}: a drag with the right or middle button

        // Fixed 60 Hz simulation. Stopped until Start; stepped from update().
        // The seed is fixed outside TEST_MODE; tests may override it with ?seed=N.
        this.clock = new SimulationClock();
        const seedOverride = TEST_MODE ? parseSeed(new URLSearchParams(window.location.search).get('seed')) : null;
        this.rng = new SeededRandom(seedOverride ?? DEFAULT_SEED);
        this.simulationSteps = 0;

        // A shipped game always plays the default map on its fixed seed.
        const worldParams = TEST_MODE ? parseWorldParams(window.location.search) : {};
        this.map = worldParams.map ?? WORLD_MAPS[DEFAULT_MAP];
        this.worldSeed = worldParams.worldSeed ?? this.map.seed;

        const {width, height} = this.scale;
        const {cols, rows, tileSize} = this.map;
        this.layout = currentLayout();
        this.suspension = new Suspension(); // TASK 032: a new scene holds no stale reason
        this.ending = null; // TASK 036: the Day 100 ending, once it has begun
        // TASK 043: this run's campaign {id, startedAt}, the dawn it last saved, and how that went.
        this.campaign = null;
        this.savedDawnDay = null;
        this.campaignSave = {last: null, restored: null};
        // TASK 033.3: Presidential Advice, made here so the book's TIPS switches work on the
        // menu too. Only TEST_MODE can switch it off for a session (?tips=off, which boot() adds).
        const adviceParams = new URLSearchParams(TEST_MODE ? window.location.search : '');
        const cooldown = Number(adviceParams.get('tipsCooldown')); // TEST_MODE: tests cannot wait 25 s between tips
        this.advice = new PresidentialAdvice({
            storage: browserStorage(),
            forcedOff: adviceParams.get('tips') === 'off',
            ...(Number.isInteger(cooldown) && cooldown > 0
                ? {timing: {...ADVICE_TIMING, cooldownMs: cooldown, urgentMs: Math.min(cooldown, ADVICE_TIMING.urgentMs)}} : {}),
        });
        this.advicePreview = null; // TEST_MODE: a catalogue tip drawn as if it showed, for layout tests
        this.worldCamera = new WorldCamera(this.cameras.main, this.layout, {
            x: (width - cols * tileSize) / 2 - WORLD_MARGIN,
            y: (height - rows * tileSize) / 2 - WORLD_MARGIN,
            width: cols * tileSize + 2 * WORLD_MARGIN,
            height: rows * tileSize + 2 * WORLD_MARGIN,
        });

        // TASK 030: sound follows what happened; it never changes it.
        this.gameAudio = new GameAudio(audioFor(this.game));
        loadMusicWhenUnlocked(this);
        this.buildingIndex = new Map(); // id -> {type, x, y}, for where a sound happens
        this.lastPowerStatus = null;
        this.input.keyboard.on('keydown-M', () => this.toggleSound());

        this.input.mouse?.disableContextMenu();
        this.input.on('pointerdown', (pointer) => this.handleGridPointerDown(pointer));
        this.input.on('pointermove', (pointer) => this.handleGridPointerMove(pointer));
        this.input.on('pointerup', (pointer) => this.handleGridPointerUp(pointer));
        this.input.on('pointerupoutside', (pointer) => this.handleGridPointerUp(pointer));
        this.input.on('wheel', (pointer, _over, _dx, dy) => this.handleWheel(pointer, dy));
        this.input.keyboard.on('keydown-ESC', (event) => {
            if (this.newspaper?.open) this.closeNewspaper();
            else if (!this.readingManual(event)) this.exitPlacementMode(); // TASK 033.1: Escape closes the book, and only the book
        });
        for (const [key, dx, dy] of [['LEFT', 1, 0], ['RIGHT', -1, 0], ['UP', 0, 1], ['DOWN', 0, -1]]) {
            this.input.keyboard.on(`keydown-${key}`, (event) => {
                if (!this.newspaper?.open && !this.readingManual(event) && !this.inCinematic()) this.worldCamera.panBy(dx * KEY_PAN, dy * KEY_PAN);
            });
        }

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
                setDay: createSetDay(this),
            };
            window.__qa.perf = createPerfProbe(this);
            window.__qa.layout = createLayoutQa(this);
            window.__qa.economy = createEconomyQa(this);
            window.__qa.ending = createEndingQa(this); // TASK 036
            // TASK 043: Continue's entry point, which the stage 3 menu button will call, and the stored save as read.
            window.__qa.campaign = {
                continue: () => this.continueCampaign(),
                read: () => readCampaign(browserStorage(), this.campaignWorld()),
                status: () => ({id: this.campaign?.id ?? null, savedDawnDay: this.savedDawnDay, last: this.campaignSave.last, restored: this.campaignSave.restored}),
                menu: () => this.scene.get('hud')?.campaignMenu?.view() ?? null, // TASK 044: CONTINUE, its notice, the New Game question
            };
            window.__qa.busListeners = () => Object.fromEntries(EventBus.eventNames().map((event) => [event, EventBus.listenerCount(event)]));
            // TASK 033.3: draw one catalogue tip as if it showed (null for the real state), so
            // layout tests can measure every card. It changes nothing: not the controller, not seen.
            window.__qa.advice = {
                preview: (id) => {
                    this.advicePreview = id ?? null;
                    this.presentAdvice();
                },
            };
            // TASK 034: print the open La Voz again as another issue, from the real last
            // settlement, so layout tests can measure every story. The game is not touched.
            window.__qa.newspaper = {
                preview: (issue) => {
                    if (!this.newspaper?.open || !this.cycle?.lastSettlement) return false;
                    this.newspaper.edition = newspaperEdition({
                        issue, settlement: this.cycle.lastSettlement, delivered: this.logistics?.lastNight?.credits ?? 0,
                    });
                    this.presentNewspaper();
                    return true;
                },
            };
        }

        this.subscribe();
        this.present(State.PHASE, {phase: this.phase});
        this.offerCampaign(data.campaignNotice ?? null); // TASK 044: what the menu may continue
        this.scene.launch('hud');
    }

    /** Every command the HUD can send, and a HUD saying it wants the state so far. */
    subscribe() {
        const handlers = {
            [Hud.READY]: () => this.handleHudReady(),
            [Notice.POINTER_LEFT_HUD]: (pointer) => {
                if (!pointer.wasTouch) this.handleGridPointerMove(pointer);
            },
            [Command.START]: (payload) => this.handleStart(payload),
            [Command.CONTINUE]: () => this.handleContinue(),
            [Command.RESTART]: () => this.scene.restart(),
            [Command.BUILD]: ({type}) => this.enterPlacementMode(type),
            [Command.ROAD]: () => this.enterRoadMode(),
            [Command.CANCEL]: () => {
                this.gameAudio?.play('ui.back');
                this.exitPlacementMode();
            },
            [Command.END_DAY]: () => this.handleEndDay(),
            [Command.SET_SPEED]: ({speed}) => this.handleSetSpeed(speed),
            [Command.TOGGLE_POWER]: () => this.handleSelectionAction(),
            [Command.DEMOLISH]: () => this.handleDemolish(),
            [Command.MOVE_FLAG]: () => this.enterFlagMode(),
            [Command.RESET_FLAG]: () => this.handleResetFlag(),
            [Command.REFIT]: () => this.handleRefit(),
            [Command.REPAIR]: () => this.handleRepair(),
            [Command.DISPERSE]: () => this.handleDisperse(),
            [Command.ZOOM_IN]: () => this.worldCamera.zoomIn(),
            [Command.ZOOM_OUT]: () => this.worldCamera.zoomOut(),
            [Command.FIT]: () => this.worldCamera.fit(),
            [Command.TOGGLE_DAY_PAUSE]: () => this.handleToggleDayPause(),
            [Command.OPEN_NEWSPAPER]: () => this.openNewspaper('report'),
            [Command.CLOSE_NEWSPAPER]: () => this.closeNewspaper(),
            [Command.CYCLE_DAY_SPEED]: () => this.handleCycleDaySpeed(),
            [Command.SUSPEND]: ({reason, on}) => this.suspension.set(reason, on),
            [Command.ADVICE]: ({action}) => this.handleAdvice(action),
        };
        // END DAY's fast-forward takes no further orders: only the camera still answers.
        // Advice is never an order (TASK 033.3), so the book's TIPS switches always answer.
        for (const event of Object.values(Command)) {
            if (!handlers[event] || FAST_FORWARD_ALLOWED.has(event) || event === Command.SUSPEND || event === Command.ADVICE) continue;
            const handler = handlers[event];
            handlers[event] = (payload) => {
                if (!this.cycle?.fastForwarding) handler(payload);
            };
        }
        // La Voz is a blocking modal: while it is open, only closing it is heard.
        for (const event of Object.values(Command)) {
            if (!handlers[event] || event === Command.CLOSE_NEWSPAPER || event === Command.SUSPEND || event === Command.ADVICE) continue;
            const handler = handlers[event];
            handlers[event] = (payload) => {
                if (!this.newspaper?.open && !this.inCinematic()) handler(payload); // TASK 035: nor during the helicopter
            };
        }
        for (const [event, handler] of Object.entries(handlers)) EventBus.on(event, handler);
        this.events.once('shutdown', () => {
            this.gameAudio?.stop();
            this.combatFx?.destroy();
            this.combatFx = null;
            this.presidentLayer?.destroy(); // TASK 033.2: the scene object is reused on restart
            this.presidentLayer = null;
            this.president = null;
            this.heliLayer?.destroy(); // TASK 035: a flight cut short leaves nothing behind
            this.heliLayer = null;
            this.heli = null;
            this.heliCamera = null;
            this.scene.stop('ending'); // TASK 036: its speech and actors go with it
            this.ending = null;
            for (const [event, handler] of Object.entries(handlers)) EventBus.off(event, handler);
            this.scene.stop('hud');
        });
    }

    /** data-scene goes up here, so a test that sees it can already press what the HUD draws. */
    handleHudReady() {
        EventBus.emit(Hud.SNAPSHOT, [...this.presented].map(([event, {value}]) => [event, value]));
        if (this.hudReady) return;
        this.hudReady = true;
        markScene(this, {phase: this.phase});
    }

    /** Tell the HUD, if this is news. It is a small comparison, so anything may ask every frame. */
    present(event, value) {
        const key = JSON.stringify(value);
        if (this.presented.get(event)?.key === key) return;
        this.presented.set(event, {key, value});
        EventBus.emit(event, value);
    }

    // ---- Start -------------------------------------------------------------

    handleStart({replace = false} = {}) {
        // TASK 044: a New Game over a saved campaign only once the player has confirmed it,
        // and then that campaign ends now, for every tab, not at the new game's first dawn.
        if (this.phase === GamePhase.READY && this.campaignOffer) {
            if (!replace) return;
            endCampaign(browserStorage(), this.campaignOffer.campaignId);
            this.campaignOffer = null;
        }
        const previous = this.phase;
        this.phase = startGame(this.phase);
        if (previous === GamePhase.READY && this.phase === GamePhase.STARTED) {
            this.createGrid();
            this.present(State.PHASE, {phase: this.phase});
            this.present(State.NEWSPAPER, {enabled: this.newsEnabled, open: false});
            this.cycle.begin(); // Day 1; the clock starts paused for Day Shift
            this.campaign = this.savesCampaign() ? newCampaign() : null; // TASK 043: a New Game
            this.syncShiftUi();
            this.refreshPower();
        }
        setBodyState({phase: this.phase});
    }

    // ---- TASK 043: the campaign save ---------------------------------------------

    /**
     * TASK 044: before Start, will this game keep campaigns? The same rule as savesCampaign()
     * once the world exists: only TEST_MODE's ?hq=off, ?cycle=legacy and ?news=off say no.
     */
    keepsCampaigns() {
        if (!TEST_MODE) return true;
        const params = new URLSearchParams(window.location.search);
        return params.get('hq') !== 'off' && params.get('cycle') !== 'legacy' && params.get('news') !== 'off';
    }

    /**
     * TASK 044: tell the menu what it may continue: a valid save for this world, its HUD day,
     * and whether it is the Day 100 dawn that only the ending follows. A save that is there
     * but cannot be used is not offered, and the menu says why; nothing is deleted.
     */
    offerCampaign(notice = null) {
        const read = this.keepsCampaigns() ? readCampaign(browserStorage(), this.campaignWorld()) : {ok: false, reason: 'no-save'};
        this.campaignOffer = read.ok ? {campaignId: read.save.campaignId, calendarDay: read.save.checkpoint.day} : null;
        const unusable = !read.ok && !['no-save', 'campaign-ended'].includes(read.reason) ? read.reason : null;
        const day = this.campaignOffer?.calendarDay;
        this.present(State.CAMPAIGN, {
            offer: this.campaignOffer ? {day: day - 1, ending: endingDue({timed: true, deployment: false, shift: Shift.DAY, day})} : null, // the HUD's Day N
            notice: notice ?? unusable,
        });
    }

    /** CONTINUE on the menu. A refusal leaves the menu, with the reason; a world that refused it restarts the scene. */
    handleContinue() {
        if (this.phase !== GamePhase.READY) return;
        const result = this.continueCampaign();
        if (!result.ok && result.reason !== 'restore-failed') this.offerCampaign(result.reason);
    }

    /** Real play saves: the ACTIVE cycle with HQ and roads, where a dawn hold exists. */
    savesCampaign() {
        return Boolean(this.cycle?.timed && this.hqRequired && this.roads && this.workers && this.newsEnabled);
    }

    /** What the save belongs to: this map, its world seed and the game's random seed. */
    campaignWorld() {
        return worldOf({map: this.map, worldSeed: this.worldSeed, rngSeed: this.rng.snapshot().seed});
    }

    /** The simulation, as core/dawnCheckpoint.js reads and restores it. */
    checkpointWorld() {
        const {cycle, economy, pollution, rng, grid, fog, placement, roads, logistics, workers, ecologists, mutants, infantry, siegeCannons} = this;
        return {cycle, economy, pollution, rng, grid, fog, placement, roads, logistics, workers, ecologists, mutants, infantry, siegeCannons};
    }

    /**
     * At the dawn hold, as La Voz opens: the Night is settled and no tick is running,
     * because the clock paused inside the tick that settled it. Once per dawn. A failed
     * write keeps the game going; the last good save stays where it was.
     */
    autosave() {
        if (!this.campaign || this.phase !== GamePhase.STARTED || this.ending || !atDawnHold(this.cycle)) return;
        if (this.savedDawnDay === this.cycle.day) return;
        this.savedDawnDay = this.cycle.day;
        let result;
        try {
            result = writeCampaign(browserStorage(), {campaign: this.campaign, world: this.campaignWorld(), checkpoint: captureDawn(this.checkpointWorld())});
        } catch (error) {
            result = {ok: false, reason: 'capture-failed', detail: error.message};
        }
        this.campaignSave.last = {day: this.cycle.day, ...result};
        // TASK 044: say so, once for this dawn, on the HUD's hint line (it stays until the player acts).
        if (!result.ok) this.showHint(['superseded', 'older-dawn', 'campaign-ended'].includes(result.reason) ? Hint.SAVE_REPLACED : Hint.SAVE_FAILED);
    }

    /** HQ fell, or the ending finished: this campaign is over for every tab. The profile is untouched. */
    retireCampaign() {
        if (!this.campaign) return;
        endCampaign(browserStorage(), this.campaign.id);
        this.campaign = null;
    }

    /**
     * Continue (TASK 043 stage 2: the entry point; the menu button is stage 3). Builds the
     * world as Start does, then puts the saved dawn into it in place of cycle.begin(). The
     * save is checked whole first; if the world still refuses it, the half-built world is
     * discarded by restarting the scene, and the save stays as it was.
     * @returns {{ok: true, day: number} | {ok: false, reason: string, detail?: string}}
     */
    continueCampaign() {
        if (this.phase !== GamePhase.READY) return {ok: false, reason: 'not-ready'};
        const read = readCampaign(browserStorage(), this.campaignWorld());
        if (!read.ok) return (this.campaignSave.restored = read);
        const {save} = read;
        this.phase = startGame(this.phase);
        try {
            this.createGrid();
            if (!this.savesCampaign()) throw new Error('this game does not keep campaigns');
            restoreDawn(this.checkpointWorld(), save.checkpoint);
        } catch (error) {
            this.campaignSave.restored = {ok: false, reason: 'restore-failed', detail: error.message};
            this.scene.restart({campaignNotice: 'restore-failed'}); // the half-built world goes; nothing of it is played
            return this.campaignSave.restored;
        }
        this.campaign = {id: save.campaignId, startedAt: save.startedAt};
        this.savedDawnDay = save.checkpoint.day; // this dawn is already saved
        this.present(State.PHASE, {phase: this.phase});
        this.present(State.NEWSPAPER, {enabled: this.newsEnabled, open: false});
        this.handleLayoutLoaded(); // building views, roads and docks, HUD, power, menu
        this.syncShiftUi(); // the dawn: La Voz prints from the saved settlement and holds the Day
        setBodyState({phase: this.phase});
        this.campaignSave.restored = {ok: true, day: save.checkpoint.day};
        return this.campaignSave.restored;
    }

    createGrid() {
        const {width, height} = this.scale;
        const {cols, rows, tileSize, spawnFrame} = this.map;
        this.terrain = createTerrain(this.map, this.worldSeed);
        // What the terrain looked like when last painted, so a clearing repaints exactly what changed.
        this.renderedTerrainRevision = this.terrain?.revision ?? 0;
        this.renderedTerrainKinds = this.terrain
            ? Array.from({length: this.terrain.rows}, (_, row) => Array.from({length: this.terrain.cols}, (__, col) => this.terrain.kindAt(col, row)))
            : null;
        this.grid = new Grid({
            cols,
            rows,
            tileSize,
            originX: (width - cols * tileSize) / 2,
            originY: (height - rows * tileSize) / 2,
            terrain: this.terrain,
        });
        this.buildingArt = new BuildingArtLayer(this, this.grid);
        this.economy = new Economy();
        this.pollution = new Pollution();
        // Orchestration only: the settlement formula lives in core/settlement.js.
        // TEST_MODE only: ?hq=off is a compatibility mode for legacy suites that
        // predate the HQ-first flow. Real play always requires HQ.
        this.hqRequired = !(TEST_MODE && new URLSearchParams(window.location.search).get('hq') === 'off');
        // TEST_MODE only: ?cycle=legacy keeps the untimed Day that older suites were
        // written for. Real play always runs the active Day, Dusk and Night.
        this.legacyCycle = TEST_MODE && new URLSearchParams(window.location.search).get('cycle') === 'legacy';
        // TASK 029: La Voz at every dawn of the ACTIVE cycle. Only TEST_MODE can switch it off
        // (?news=off, which boot() adds unless a test asks for the newspaper).
        this.newsEnabled = !this.legacyCycle && !(TEST_MODE && new URLSearchParams(window.location.search).get('news') === 'off');
        this.newspaper = {open: false, reason: null, edition: null, pausedByNews: false};
        this.cycle = new ShiftCycle({
            clock: this.clock,
            economy: this.economy,
            dayTicks: this.legacyCycle ? null : DAY_TICKS,
            duskTicks: DUSK_TICKS,
            canEndDay: () => !this.hqRequired || this.placement.hqBuilt,
            holdDawn: () => this.newsEnabled, // the new Day waits at tick 0 for La Voz
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
            isPaused: () => this.cycle.pausedDay, // look, select and inspect only
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
            spitterSlots: fixedSchedule?.length ? parseStressSpitters(window.location.search) : [],
            ...(fixedSchedule?.length ? parseStressBrutes(window.location.search) : {}),
            logistics: this.logistics,
            gates: this.gates,
            spawnFrame,
            planNight: fixedSchedule ? null : (day) => nightPlan({
                day,
                pollution: this.pollution.value,
                buildings: this.placement.buildings(),
            }),
        });
        this.mutantLayer = new MutantLayer(this, this.grid);
        this.combatFx = new CombatFxLayer(this); // TASK 031: impacts and explosions, presentation only
        this.nightTint = new NightTintLayer(this, this.grid);
        this.autocannons = new Autocannons({
            cycle: this.cycle,
            placement: this.placement,
            grid: this.grid,
            mutants: this.mutants,
        });
        this.autocannonLayer = new AutocannonLayer(this, this.grid);
        this.siegeCannons = new SiegeCannons({
            cycle: this.cycle,
            placement: this.placement,
            grid: this.grid,
            mutants: this.mutants,
        });
        this.siegeLayer = new SiegeLayer(this, this.grid);
        // Barracks need a road exit, so ?hq=off has none.
        this.infantry = this.roads ? new Infantry({
            cycle: this.cycle,
            placement: this.placement,
            grid: this.grid,
            gates: this.gates,
            mutants: this.mutants,
            roads: this.roads,
        }) : null;
        this.mutants.setInfantry(this.infantry);
        this.infantryLayer = this.infantry ? new InfantryLayer(this, this.grid) : null;
        // HQ's squad, on the same terms: no roads means no HQ.
        this.workers = this.roads ? new Workers({
            cycle: this.cycle, placement: this.placement, grid: this.grid, gates: this.gates, economy: this.economy, roads: this.roads, pollution: this.pollution,
        }) : null;
        this.mutants.setWorkers(this.workers);
        this.workerLayer = this.workers ? new WorkerLayer(this, this.grid) : null;
        // TASK 027: protesters, only on a map with terrain and roads. Their own random stream.
        this.ecologists = this.roads && this.terrain ? new Ecologists({
            cycle: this.cycle, placement: this.placement, grid: this.grid, roads: this.roads, pollution: this.pollution,
            mutants: this.mutants, seed: this.rng.snapshot().seed,
        }) : null;
        if (this.ecologists) this.logistics.setBlockers(() => this.ecologists.blockedTiles());
        if (this.ecologists) this.workers.setEcologists(this.ecologists); // DISPERSE
        // TASK 028: towers' coverage and noise, stepped first in each tick.
        this.loudspeakers = new Loudspeakers({cycle: this.cycle, placement: this.placement});
        this.mutants.setLoudspeakers(this.loudspeakers);
        this.ecologists?.setLoudspeakers(this.loudspeakers);
        this.speakerRing = this.add.graphics().setDepth(2.2).setVisible(false);
        this.ecologistLayer = this.ecologists ? new EcologistLayer(this, this.grid) : null;

        // Terrain paints its own tiles, and only where there is open ground to build on.
        if (this.terrain) {
            this.terrainLayer = new TerrainLayer(this, this.grid, this.terrain);
            this.fog = new FogOfWar({cols, rows, explored: startingKnown(this.terrain)});
            this.fogLayer = new FogLayer(this, this.grid, this.fog);
            this.worldCamera.showArea(this.combatArea()); // the whole world is far too small to start in
        } else {
            this.drawGridLines();
        }

        this.selectionHighlight = this.add.rectangle(0, 0, TILE_SIZE, TILE_SIZE, HIGHLIGHT_COLOR, 0.35)
            .setOrigin(0, 0)
            .setStrokeStyle(2, HIGHLIGHT_COLOR)
            .setVisible(false)
            .setDepth(2);

        this.previewRect = this.add.rectangle(0, 0, TILE_SIZE, TILE_SIZE, PREVIEW_VALID_COLOR, 0.4)
            .setOrigin(0, 0)
            .setVisible(false)
            .setDepth(3);
        this.segmentGraphics = this.add.graphics().setDepth(3);

        // TASK 033.2: El Presidente's Day 0 cameo. Presentation only: see syncPresident.
        this.president = new PresidentCameo();
        this.presidentLayer = new PresidentLayer(this);
        // TASK 035: the Day 1 helicopter. Presentation only: see syncHeli. TEST_MODE may switch it
        // off (?heli=off, which boot() adds) or fly it faster (?heliSpeed=N); a shipped game always has it.
        const heliParams = new URLSearchParams(TEST_MODE ? window.location.search : '');
        this.heli = new HeliVisit({enabled: heliParams.get('heli') !== 'off', timeScale: Number(heliParams.get('heliSpeed')) || 1});
        this.heliLayer = null;
        this.heliCamera = null;
        this.heliRestored = null;
    }

    // ---- TASK 036: THE PRESIDENTIAL VISIT, the Day 100 ending -------------------------

    /**
     * Once a run, on the first tick of the timed Day the HUD calls Day 100 (after Night 100),
     * once La Voz is closed and nothing else holds the world. From then on the world is held
     * as the `cinematic` reason for good (no tick runs again), the HUD sleeps and the
     * ceremony plays in EndingScene. Nothing in the run is changed or removed.
     */
    syncEnding() {
        const {cycle} = this;
        if (this.ending || !cycle?.started || this.phase !== GamePhase.STARTED) return;
        if (!endingDue({timed: cycle.timed, deployment: cycle.deployment, shift: cycle.shift, day: cycle.day})) return;
        if (this.newspaper?.open || this.suspension.active || cycle.fastForwarding) return;
        this.startEnding();
    }

    startEnding() {
        this.exitPlacementMode();
        this.exitFlagMode();
        this.mousePan = null;
        this.pendingPress = null;
        this.dragCell = null;
        this.suspension.set(SuspendReason.CINEMATIC, true);
        this.ending = {day: this.cycle.day, tick: this.clock.tick, finished: false};
        this.scene.sleep('hud');
        const speed = TEST_MODE ? Number(new URLSearchParams(window.location.search).get('endingSpeed')) || 1 : 1;
        this.scene.launch('ending', {speed, onComplete: () => this.finishEnding()});
        this.scene.bringToTop('ending');
    }

    /** The recording is over and the screen is black: remember it, then the menu. */
    finishEnding() {
        if (!this.ending || this.ending.finished) return;
        this.ending.finished = true;
        setEndingSeen(browserStorage(), true);
        this.retireCampaign(); // TASK 043: completed. Until here a closed browser replays the ending from Day 100's dawn
        this.scene.restart(); // the title, as RESTART does; shutdown stops the ending and the HUD
    }

    // ---- TASK 035: the Day 1 helicopter -----------------------------------------------

    /** The helicopter holds the world: no map press, wheel, key pan or order means anything. */
    inCinematic() {
        return this.suspension.has(SuspendReason.CINEMATIC);
    }

    /**
     * One presentation frame of the Day 1 helicopter. It waits for the first timed Day
     * after Night 1 to be free to show (La Voz closed, nothing else holding the world, no
     * END DAY under way), then holds the world as the `cinematic` reason, so no tick runs
     * and none is made up: the Day starts exactly as it would have. It moves the camera
     * onto HQ and back to the player's own view, and touches nothing else.
     */
    syncHeli(delta) {
        const {heli, cycle} = this;
        if (!heli || !cycle?.started) return;
        if (heli.waiting) {
            const day1 = cycle.timed && !cycle.deployment && cycle.day === HELI_DAY;
            if (!cycle.timed || this.phase === GamePhase.DEFEATED || cycle.day > HELI_DAY || (cycle.day === HELI_DAY && cycle.shift !== Shift.DAY)) {
                heli.skip(); // its moment passed (or there is none): never this run
                return;
            }
            const hq = this.placement.buildings().find((b) => b.type === HQ_TYPE);
            const free = !this.newspaper?.open && !this.suspension.active && !cycle.fastForwarding && this.phase === GamePhase.STARTED;
            if (!day1 || !free || !hq) return;
            this.startHeli(this.grid.footprintRect(hq));
        }
        if (!heli.active) return;
        const held = this.suspension.reasons().some((reason) => reason !== SuspendReason.CINEMATIC);
        heli.update(held ? 0 : delta, delta); // the rotor turns whatever holds the flight
        const view = heli.view();
        if (heli.active) {
            this.worldCamera.setPose(blendPose(this.heliCamera.saved, this.heliCamera.target, view.cameraBlend));
            this.heliLayer.sync(view);
        } else this.endHeli();
    }

    startHeli(hqRect) {
        this.exitPlacementMode();
        this.exitFlagMode();
        this.mousePan = null;
        this.pendingPress = null; // a press begun before it means nothing after
        this.dragCell = null;
        const saved = this.worldCamera.pose();
        const pickup = pickupPoint(hqRect);
        const {view: target, rect} = this.worldCamera.framing(cameraTarget(saved, pickup));
        this.heli.start(hqRect, rect);
        this.heliCamera = {saved, target};
        this.heliLayer = new HeliLayer(this);
        this.suspension.set(SuspendReason.CINEMATIC, true);
    }

    /** Everything back as the player left it: the camera exactly, input and the world released. */
    endHeli() {
        this.worldCamera.setPose(this.heliCamera.saved);
        this.heliRestored = this.worldCamera.pose();
        this.heliLayer?.destroy();
        this.heliLayer = null;
        this.heliCamera = null;
        this.suspension.set(SuspendReason.CINEMATIC, false);
    }

    /**
     * TASK 033.2: one presentation frame of El Presidente. He reads the phase and HQ and
     * nothing else, and is given no time while anything holds the world (BUILD, AUDIO,
     * the book, portrait), so he stands still with it. Nothing here touches the simulation.
     */
    syncPresident(delta) {
        if (!this.president || this.president.finished) return;
        const {cycle, grid, terrain} = this;
        const hq = this.placement.buildings().find((b) => b.type === HQ_TYPE);
        this.president.update(this.suspension.active ? 0 : delta, {
            phase: cycle.deployment ? 'deployment' : cycle.shift === Shift.DUSK ? 'dusk' : 'other',
            centre: terrain ? grid.cellCenter(terrain.center.col, terrain.center.row) : grid.cellCenter(Math.floor(grid.cols / 2), Math.floor(grid.rows / 2)),
            hq: hq ? grid.footprintRect(hq) : null,
        });
        this.presidentLayer.sync(this.president.view());
    }

    // ---- TASK 033.3: Presidential Advice ---------------------------------------------

    /** One presentation frame of advice. It reads the game; it never changes it. */
    syncAdvice(delta) {
        this.advice.update(delta, {blocked: this.adviceBlocked(), facts: () => this.adviceFacts()});
        this.presentAdvice();
    }

    /**
     * No tip on the menu, while anything holds the world (BUILD, AUDIO, the book, portrait),
     * behind La Voz, during END DAY's fast-forward, or after a defeat.
     */
    adviceBlocked() {
        return this.phase !== GamePhase.STARTED || !this.cycle?.started || Boolean(this.newspaper?.open)
            || this.suspension.active || Boolean(this.cycle.fastForwarding);
    }

    /** What the tips are about, from what the scene already holds. See src/content/advice.js. */
    adviceFacts() {
        const {cycle, placement, terrain} = this;
        const buildings = placement.buildings();
        const count = (...types) => buildings.filter((b) => types.includes(b.type)).length;
        const day = cycle.shift === Shift.DAY;
        return {
            shift: cycle.shift,
            deployment: cycle.deployment,
            activeDay: day && cycle.timed && !cycle.deployment,
            day,
            hqBuilt: placement.hqBuilt,
            defences: count('autocannon', 'siegeCannon', BARRACKS_TYPE),
            factories: count('factory'),
            mines: count('mine'),
            barracksWithoutFlag: buildings.filter((b) => b.type === BARRACKS_TYPE && !b.flag).length,
            workFlag: Boolean(this.workers?.flag),
            ap: this.economy.ap,
            power: calculatePower(buildings).status,
            powerWarning: this.powerWarning !== null,
            pollution: this.pollution.value,
            deliveries: this.logistics?.snapshot().totals.loads ?? 0,
            protest: (this.ecologists?.blockedTiles().length ?? 0) > 0,
            depositRevealed: Boolean(terrain?.deposits?.some(({tiles}) => tiles.some(({col, row}) => terrain.kindAt(col, row) === TerrainKind.CLEARED))),
            minePlacing: placement.selectedType === 'mine',
        };
    }

    /** The book's TIPS switches, and a tip's OK and BOOK. None of them is a gameplay command. */
    handleAdvice(action) {
        if (action === 'dismiss') this.advice.dismiss();
        else if (action === 'more') this.advice.more(); // the HUD opens the book at the tip's page
        else if (action === 'enable' || action === 'disable') this.advice.setEnabled(action === 'enable');
        else if (action === 'reset') this.advice.reset();
        this.presentAdvice();
    }

    presentAdvice() {
        const view = this.advice.view();
        const preview = this.advicePreview ? ADVICE.find((tip) => tip.id === this.advicePreview) : null;
        this.present(State.ADVICE, preview
            ? {...view, visible: true, tip: {id: preview.id, title: preview.title, text: preview.text, book: preview.book, urgent: Boolean(preview.urgent)}}
            : view);
    }

    drawGridLines() {
        const {cols, rows, tileSize} = this.grid;
        const bounds = this.grid.footprintRect({col: 0, row: 0, width: cols, height: rows});
        const lines = this.add.graphics();
        lines.lineStyle(1, GRID_LINE_COLOR, 0.6);
        lines.beginPath();
        for (let col = 0; col <= cols; col++) {
            const x = bounds.x + col * tileSize;
            lines.moveTo(x, bounds.y);
            lines.lineTo(x, bounds.y + bounds.height);
        }
        for (let row = 0; row <= rows; row++) {
            const y = bounds.y + row * tileSize;
            lines.moveTo(bounds.x, y);
            lines.lineTo(bounds.x + bounds.width, y);
        }
        lines.strokePath();
    }

    /** Where a Night is fought: the spawn frame and a margin. Null when that is the whole world. */
    combatArea() {
        const frame = this.map.spawnFrame;
        if (!frame) return null;
        const {x, y, width, height} = this.grid.footprintRect({col: frame.col, row: frame.row, width: frame.cols, height: frame.rows});
        return {x: x - WORLD_MARGIN, y: y - WORLD_MARGIN, width: width + 2 * WORLD_MARGIN, height: height + 2 * WORLD_MARGIN};
    }

    // ---- What the HUD shows -------------------------------------------------

    presentSettlement(report) {
        this.present(State.SETTLEMENT, {report, delivered: this.logistics?.lastNight?.credits ?? 0}); // paid on delivery, shown here
    }

    /**
     * Re-derive power from the building records and render it: the summary
     * and each building's look. Called right after placement, toggling and shift
     * changes — never per frame, and nothing is cached.
     */
    refreshPower() {
        const power = calculatePower(this.placement.buildings());
        this.buildingIndex = new Map(this.placement.buildings().map((b) => {
            const {x, y, width, height} = this.grid.footprintRect(b);
            return [b.id, {type: b.type, x: x + width / 2, y: y + height / 2, tiles: b.width, height}];
        }));
        if (this.lastPowerStatus && power.status !== this.lastPowerStatus) {
            this.gameAudio?.play(power.status === 'normal' ? 'machinery.power_up' : 'machinery.power_down');
        }
        this.lastPowerStatus = power.status;
        this.poweredIds = new Set(power.buildings.filter((b) => b.powered).map((b) => b.id)); // TASK 032: the palette's header
        this.present(State.POWER, {generation: power.generation, demand: power.demand, status: power.status});
        for (const {id, enabled, powered} of power.buildings) {
            const view = this.buildingViews.get(id);
            view.setAlpha(enabled ? 1 : DISABLED_ALPHA);
            if (enabled && !powered) view.setStrokeStyle(3, UNPOWERED_STROKE);
            else view.setStrokeStyle(2, BUILDING_STROKE, this.buildingArt?.has(id) ? 0.35 : 1);
        }
        this.buildingArt?.sync(this.placement.buildings(), this.cycle?.shift);
        this.updateBuildingVision(power);
        this.presentSelection();
    }

    /** Whatever changes a building's vision also changes power or the building list, so it comes through here. */
    updateBuildingVision(power) {
        if (!this.fog) return;
        const buildings = this.placement.buildings();
        this.fog.setSources('buildings', buildingVision(buildings, power));
        this.fog.markExplored(fortificationTiles(buildings));
    }

    /**
     * Every tick, not every frame, so that what a unit discovers cannot depend on the
     * frame rate or the speed. It only costs anything when a unit has changed tile.
     */
    updateUnitVision() {
        if (!this.fog || !this.infantry) return;
        this.fog.setSources('soldiers', unitVision(this.infantry.soldiers(), this.grid));
        this.fog.setSources('workers', unitVision(this.workers.workers(), this.grid, WORKER.visionRadius));
    }

    /** Is this world point on a tile being watched right now? Null on a map with no fog. */
    seenBy() {
        if (!this.fog) return null;
        return ({x, y}) => {
            const cell = this.grid.worldToCell(x, y);
            return cell !== null && this.fog.isVisible(cell.col, cell.row);
        };
    }

    updateHud() {
        this.present(State.ECONOMY, this.economy.snapshot());
    }

    updatePollutionHud() {
        const {value} = this.pollution.snapshot();
        this.present(State.POLLUTION, {value, threat: threatLevel(value)});
    }

    /** Living mutants, then scheduled slots reached out of total. Not a kill counter. */
    updateWaveHud(mutants) {
        const plan = this.mutants.plan();
        const visible = plan !== null && this.cycle.shift === Shift.NIGHT;
        this.present(State.WAVE, visible
            ? {visible, mutants: mutants.length, reached: waveProgress(plan, this.cycle.elapsedNightTicks), total: plan.schedule.length}
            : {visible});
    }

    /** The night countdown is derived from remaining simulation ticks, to the tenth the HUD shows. */
    updateShiftHud() {
        const {day, shift, remainingNightTicks} = this.cycle.snapshot();
        const remaining = shift === Shift.DUSK ? this.cycle.remainingDuskTicks : shift === Shift.DAY ? this.cycle.remainingDayTicks : remainingNightTicks;
        this.present(State.SHIFT, {
            day,
            shift,
            seconds: (remaining / this.clock.tickRate).toFixed(1),
            paused: this.clock.paused,
            timed: this.cycle.timed,
            fastForward: this.cycle.fastForwarding,
            deployment: this.cycle.deployment ?? false,
        });
    }

    /** What the build menu offers: the keys are the types on sale, so ?hq=off shows fewer. */
    menuStates() {
        const offered = Object.values(BUILDING_TYPES).filter(({id, fortification}) => {
            if (id === HQ_TYPE) return this.hqRequired;
            if (fortification || id === BARRACKS_TYPE || id === SIEGE_CANNON_TYPE) return this.roads !== null;
            if (id === 'mine') return this.roads !== null && (this.terrain?.deposits?.length ?? 0) > 0; // only where ore exists
            if (id === LOUDSPEAKER_TYPE) return this.ecologists !== null; // only where protesters come
            return true;
        });
        return Object.fromEntries(offered.map(({id}) => [id, this.buildState(id)]));
    }

    /** 'available', 'locked' until HQ stands, or 'built' for an HQ already placed. */
    buildState(typeId) {
        const {ok, reason} = this.placement.canBuild(typeId);
        if (ok) return 'available';
        return reason === HQ_ALREADY_BUILT ? 'built' : 'locked';
    }

    presentMenu() {
        // Building is open only in a Day that is not being fast-forwarded.
        const isDay = this.cycle.isConstructionAllowed;
        this.present(State.MENU, {
            visible: isDay,
            states: this.menuStates(),
            selected: this.roadMode ? 'road' : this.placement.selectedType,
            road: this.roads ? {state: this.placement.hqBuilt ? 'available' : 'locked'} : null,
            endDay: {visible: isDay, enabled: this.cycle.canEndDay},
            cancel: this.placement.isPlacing || this.roadMode || this.flagBarracksId !== null,
            speed: this.cycle.shift === Shift.NIGHT || this.cycle.shift === Shift.DUSK,
            dayTime: {visible: this.cycle.canPause, paused: this.clock.paused, speed: this.clock.speed},
            paused: this.cycle.pausedDay, // presentation only: the domain refuses every change itself
        });
    }

    /** Where the camera looks for placing: HQ once it stands, otherwise the clearing or the middle of the map. */
    dayFocus() {
        const hq = this.placement.buildings().find((b) => b.type === HQ_TYPE);
        const rect = this.grid.footprintRect(hq ?? this.terrain?.core ?? {col: 0, row: 0, width: this.grid.cols, height: this.grid.rows});
        return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
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
            this.updateHud(); // AP is restored and the night settled at the start of each Day
            this.updatePollutionHud();
            if (isDay && this.cycle.lastSettlement) this.presentSettlement(this.cycle.lastSettlement);
            if (isDay && this.cycle.lastSettlement && this.newsEnabled && this.cycle.timed && !this.cycle.deployment) {
                this.printNewspaper();
                this.autosave(); // TASK 043: the dawn hold, once per dawn
            }
            if (this.cycle.shift === Shift.DEFEATED) this.enterDefeat();
            if (this.cycle.shift !== this.renderedShift) this.handleShiftChange(isDay);
        }
        this.updateShiftHud();
        this.updateHud();
        this.presentMenu();
        this.presentSelection();
        this.present(State.SPEED, {speed: this.clock.speed});
        const mutants = this.mutants.snapshot();
        const buildings = this.placement.buildings();
        const isSeen = this.seenBy();
        this.fogLayer?.sync();
        this.syncTerrain();
        this.updatePollutionHud(); // clearing adds Pollution by Day; it only re-presents when it changed
        this.mutantLayer.sync(mutants, buildings, {
            shells: this.mutants.shells(),
            tick: this.clock.tick,
            isNight: this.cycle.shift === Shift.NIGHT,
            isSeen,
            // Read-only, so a sprite can face whatever is in its reach.
            trucks: this.logistics?.attackableTrucks() ?? [],
            units: [...(this.infantry?.soldiers() ?? []), ...(this.workers?.workers() ?? [])],
        });
        this.updateWaveHud(isSeen ? mutants.filter(isSeen) : mutants); // the count must not give away what the fog hides
        this.nightTint.sync({
            shift: this.cycle.shift,
            timed: this.cycle.timed,
            day: this.cycle.day,
            elapsedDuskTicks: this.cycle.elapsedDuskTicks,
            elapsedDayTicks: this.cycle.elapsedDayTicks,
        });
        if (this.logistics) this.truckLayer.sync(this.logistics.snapshot());
        this.gateLayer.sync(this.gates.snapshot());
        this.autocannonLayer.sync({
            cannons: this.autocannons.snapshot(),
            mutants,
            buildings,
            tick: this.clock.tick,
            isNight: this.cycle.shift === Shift.NIGHT,
        });
        this.siegeLayer.sync({
            guns: this.siegeCannons.snapshot(),
            shells: this.siegeCannons.shells(),
            buildings,
            reloadTicks: SIEGE.reloadTicks,
            tick: this.clock.tick,
            isNight: this.cycle.shift === Shift.NIGHT,
        });
        if (this.infantry) this.syncInfantry();
        if (this.workers) this.syncWorkers();
        this.syncSpeakerRing();
        if (this.ecologists) {
            this.ecologistLayer.sync(this.ecologists.snapshot(), {tick: this.clock.tick, corpseTicks: ECOLOGIST.corpseTicks, isSeen: this.seenBy()});
        }
    }

    /** Jungle the workers cleared since the last frame, repainted once however many trees fell. */
    syncTerrain() {
        if (!this.terrain || this.terrain.revision === this.renderedTerrainRevision) return;
        this.renderedTerrainRevision = this.terrain.revision;
        const {cols, rows} = this.terrain;
        const changed = [];
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const kind = this.terrain.kindAt(col, row);
                if (kind === this.renderedTerrainKinds[row][col]) continue;
                this.renderedTerrainKinds[row][col] = kind;
                changed.push({col, row});
            }
        }
        if (changed.length) this.terrainLayer.clearTiles(changed);
    }

    /** Once per change of shift, so the player's own zoom is never fought. */
    handleShiftChange(isDay) {
        this.renderedShift = this.cycle.shift;
        this.buildingArt?.sync(this.placement.buildings(), this.cycle.shift);
        if (isDay) this.worldCamera.showDay(this.dayFocus());
        else if (this.cycle.shift === Shift.NIGHT) this.showNight();
    }

    /** All of the fighting and none of the empty jungle: at FIT a large map is too small to read. */
    showNight() {
        const area = this.combatArea();
        if (area) this.worldCamera.showArea(area);
        else this.worldCamera.fit();
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
            rockets: this.infantry.rockets(),
            tick: this.clock.tick,
            isNight: this.cycle.shift === Shift.NIGHT,
        });
    }

    /** Workers every frame; their flag only when it, the walls or the selection changed. */
    syncWorkers() {
        const selected = this.selection().type?.id === HQ_TYPE || this.flagsWorkers();
        const key = `${this.placement.revision}:${JSON.stringify(this.workers.flag)}:${selected}`;
        if (key !== this.renderedWorkFlagKey) {
            this.renderedWorkFlagKey = key;
            this.workerLayer.syncFlag(this.workers.route(), selected);
        }
        const {workers, lost, clearing = null} = this.workers.snapshot();
        this.workerLayer.sync({workers, lost, clearing, maxHp: WORKER.maxHp, tick: this.clock.tick, isNight: this.cycle.shift === Shift.NIGHT});
    }

    /** Runs once: the Day/Night key changes only once into the defeated state. */
    enterDefeat() {
        this.closeNewspaper({resume: false}); // Game Over takes precedence
        this.combatFx?.clear();
        this.phase = defeatGame(this.phase);
        this.retireCampaign(); // TASK 043: permadeath; no tab may save or continue it again
        this.selectAt(null);
        this.present(State.PHASE, {phase: this.phase});
        this.present(State.GAME_OVER, this.cycle.defeatReport);
        setBodyState({phase: this.phase});
    }

    handleEndDay() {
        if (!this.cycle.canEndDay) return; // disabled, and must not disturb placement
        this.gameAudio?.play('ui.accept');
        this.exitPlacementMode();
        this.exitFlagMode();
        this.cycle.endDay();
        this.syncShiftUi();
    }

    handleSetSpeed(speed) {
        if (speed !== this.clock.speed) this.gameAudio?.play('ui.toggle');
        this.clock.setSpeed(speed);
        this.present(State.SPEED, {speed: this.clock.speed});
    }

    /** Day only: the player can stop the clock to plan, and start it again. */
    handleToggleDayPause() {
        if (!this.cycle?.canPause) return;
        this.gameAudio?.play('ui.toggle');
        if (this.clock.paused) this.clock.resume();
        else this.clock.pause();
        this.syncShiftUi();
    }

    /** Day only: 1x, 2x, 4x and round again. The same clock speed Night uses, so it carries over. */
    handleCycleDaySpeed() {
        if (!this.cycle?.canPause) return;
        const next = SIMULATION_SPEEDS[(SIMULATION_SPEEDS.indexOf(this.clock.speed) + 1) % SIMULATION_SPEEDS.length];
        this.handleSetSpeed(next);
        this.syncShiftUi();
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

    /** What the selection offers: the power switch in Day and Night, and the other actions. */
    presentSelection() {
        const {building, type, demolishable} = this.selection();
        const isBarracks = type?.id === BARRACKS_TYPE;
        const isHq = type?.id === HQ_TYPE && this.workers !== null;
        this.present(State.SELECTION, {
            building: building ? {
                id: building.id, type: building.type, enabled: building.enabled, flag: isHq ? this.workers.flag : building.flag ?? null,
                // TASK 032, presentation only: what the palette's header says about it.
                hp: building.hp, maxHp: type.maxHp, powered: this.poweredIds?.has(building.id) ?? false, role: building.role ?? null,
            } : null,
            canFlag: isBarracks || isHq,
            workers: isHq,
            sent: isHq && this.workers.sent,
            canDemolish: demolishable,
            confirmDemolish: !type?.fortification,
            refitTo: isBarracks && this.cycle.isConstructionAllowed
                ? (building.role === BarracksRole.ROCKET ? BarracksRole.RIFLE : BarracksRole.ROCKET)
                : null,
            switchable: Boolean(type) && type.switchable !== false,
            paused: this.cycle.pausedDay,
            repair: this.repairChoice(building, type),
            disperse: building ? null : this.disperseChoice(),
            speakers: isHq && this.hasLoudspeakers() ? {on: this.placement.loudspeakerNetwork} : null,
        });
    }

    /**
     * DISPERSE on a selected protest, CANCEL DISPERSE while ordered: a running timed
     * Day only. A protest that is over drops the selection. Null hides the button.
     */
    disperseChoice() {
        const groupId = this.selectedProtestId;
        if (!groupId || !this.ecologists) return null;
        const ordered = this.workers.disperseOrder(groupId) !== null;
        if (!ordered && !this.ecologists.protest(groupId)) {
            this.selectedProtestId = null;
            this.selectionHighlight.setVisible(false);
            return null;
        }
        if (!this.cycle.timed || this.cycle.shift !== Shift.DAY || this.cycle.deployment) return null;
        const enabled = ordered ? !this.cycle.pausedDay : this.workers.canDisperse(groupId, {quick: true}).ok;
        return {groupId, ordered, enabled};
    }

    handleDisperse() {
        const groupId = this.selectedProtestId;
        if (!groupId || !this.workers) return;
        const cancelling = this.workers.disperseOrder(groupId) !== null;
        const result = cancelling ? this.workers.cancelDisperse(groupId) : this.workers.orderDisperse(groupId);
        this.showHint(result.ok ? null : result.reason);
        this.gameAudio?.result(result.ok, {accepted: cancelling ? 'ui.back' : 'ui.accept'});
        if (result.ok && !cancelling) this.gameAudio?.play('worker.explore');
        this.presentSelection();
    }

    /**
     * REPAIR on a damaged building, STOP REPAIR while one is ordered: only by a timed
     * Day, after Day 0. Shown dimmed, and still pressable for its reason, when no
     * worker can take it. Null hides the button.
     */
    repairChoice(building, type) {
        if (!building || !this.workers || !this.cycle.timed || this.cycle.shift !== Shift.DAY || this.cycle.deployment) return null;
        const ordered = this.workers.repairOrder(building.id) !== null;
        if (!ordered && building.hp >= type.maxHp) return null;
        const enabled = ordered ? !this.cycle.pausedDay : this.workers.canRepair(building.id, {quick: true}).ok;
        return {ordered, enabled, price: repairPrice(type, type.maxHp - building.hp)}; // what full HP would cost now
    }

    /** REPAIR or STOP REPAIR on the selection; a refusal says why. */
    handleRepair() {
        const {building} = this.selection();
        if (!building || !this.workers) return;
        EventBus.emit(Notice.DISARM);
        const result = this.workers.repairOrder(building.id) ? this.workers.stopRepair(building.id) : this.workers.orderRepair(building.id);
        this.showHint(result.ok ? null : result.reason);
        this.gameAudio?.result(result.ok);
        this.presentSelection();
    }

    /** Act on the selected building through the real domain methods. */
    handleSelectionAction() {
        const {building} = this.selection();
        if (!building) return;
        EventBus.emit(Notice.DISARM);
        if (building.type === HQ_TYPE && this.hasLoudspeakers()) { // the HQ's place holds SPEAKERS ON / OFF
            const network = this.placement.setLoudspeakerNetwork(!this.placement.loudspeakerNetwork);
            if (!network.ok) this.showHint(network.reason);
            this.gameAudio?.result(network.ok, {accepted: 'ui.toggle'});
            this.refreshPower();
            return;
        }
        const result = this.placement.setEnabled(building.id, !building.enabled);
        if (!result.ok) this.showHint(result.reason); // a paused Day changes nothing
        this.gameAudio?.result(result.ok, {accepted: 'ui.toggle'});
        this.refreshPower();
    }

    hasLoudspeakers() {
        return this.placement.buildings().some(({type}) => type === LOUDSPEAKER_TYPE);
    }

    /** A selected tower shows its reach: a faint ring of LOUDSPEAKER.radius tiles round its centre. */
    syncSpeakerRing() {
        if (!this.speakerRing) return;
        const {building} = this.selection();
        const show = building?.type === LOUDSPEAKER_TYPE;
        this.speakerRing.setVisible(show);
        if (!show) return;
        const {x, y} = this.grid.cellCenter(building.col, building.row);
        const key = `${building.id}:${this.loudspeakers.isOperating(building.id)}`;
        if (key === this.speakerRingKey) return;
        this.speakerRingKey = key;
        const radius = (LOUDSPEAKER.radius + 0.5) * this.grid.tileSize;
        this.speakerRing.clear().lineStyle(2, 0xfff176, this.loudspeakers.isOperating(building.id) ? 0.7 : 0.3).strokeCircle(x, y, radius);
    }

    /**
     * Dawn: print this Day's issue from the Night just settled, once, and open it.
     * ShiftCycle has held the Day at tick 0 (holdDawn); closing resumes it at 1x.
     */
    printNewspaper() {
        const settlement = this.cycle.lastSettlement;
        this.newspaper.edition = newspaperEdition({
            issue: this.cycle.day - 1, // the HUD's Day N
            settlement,
            delivered: this.logistics?.lastNight?.credits ?? 0,
        });
        this.newspaper.pausedByNews = !this.cycle.running; // held at dawn: closing must start the Day
        this.newspaper.open = true;
        this.newspaper.reason = 'dawn';
        this.gameAudio?.play('ui.open');
        this.presentNewspaper();
    }

    /** REPORT: the same issue again, by Day only. A running Day pauses, and resumes on closing. */
    openNewspaper(reason) {
        if (this.newspaper.open || !this.newspaper.edition || this.cycle?.shift !== Shift.DAY || !this.cycle.timed) return;
        if (this.phase === GamePhase.DEFEATED) return;
        this.exitPlacementMode();
        this.newspaper.pausedByNews = this.cycle.running;
        if (this.newspaper.pausedByNews) this.clock.pause();
        this.newspaper.open = true;
        this.newspaper.reason = reason;
        this.gameAudio?.play('ui.open');
        this.presentNewspaper();
        this.syncShiftUi();
    }

    /** CONTINUE or Escape. Only a pause the newspaper made is undone; a player's own pause stays. */
    closeNewspaper({resume = true} = {}) {
        if (!this.newspaper?.open) return;
        this.newspaper.open = false;
        this.newspaper.reason = null;
        if (resume) this.gameAudio?.play('ui.close');
        if (resume && this.newspaper.pausedByNews) this.cycle.resume();
        this.newspaper.pausedByNews = false;
        this.presentNewspaper();
        this.syncShiftUi();
    }

    presentNewspaper() {
        const {open, reason, edition} = this.newspaper;
        this.present(State.NEWSPAPER, {enabled: this.newsEnabled, open, reason, edition});
    }

    /** The squad walks home. The flag's drawing follows the revision, like any flag change. */
    handleResetFlag() {
        const {building} = this.selection();
        if (!building) return;
        EventBus.emit(Notice.DISARM);
        let result;
        let voice;
        if (building.type !== HQ_TYPE) [result, voice] = [this.placement.clearFlag(building.id), 'soldier.retreat'];
        else if (this.workers.sent) [result, voice] = [this.workers.recall(), 'worker.return'];
        else [result, voice] = [this.workers.dispatch(), 'worker.explore']; // the squad is home and the flag is down: SEND WORKERS, free
        if (!result.ok) this.showHint(result.reason);
        this.gameAudio?.result(result.ok);
        if (result.ok) this.gameAudio?.play(voice);
        this.presentSelection();
    }

    /** The second press of a refit. A refusal says why; it can only be the price. */
    handleRefit() {
        const {building} = this.selection();
        if (!building) return;
        const result = this.placement.refit(building.id);
        this.lastResult = result;
        this.showHint(result.ok ? null : result.reason === GAME_PAUSED ? GAME_PAUSED : Hint.REFIT_REFUSED);
        this.gameAudio?.result(result.ok);
        this.updateHud();
        this.renderedPostsKey = null; // the roof mark shows the role
        this.buildingArt?.sync(this.placement.buildings(), this.cycle.shift); // swap Barracks art on refit
        this.presentSelection();
    }

    handleDemolish() {
        const {building} = this.selection();
        if (!building) return;
        const result = this.placement.demolish(building.id);
        this.gameAudio?.result(result.ok);
        if (result.ok) this.handleBuildingsDestroyed([building.id]);
        else this.showHint(result.reason);
    }

    // ---- Placement mode ----------------------------------------------------

    enterPlacementMode(typeId) {
        this.exitRoadMode();
        this.exitFlagMode();
        if (!this.placement.select(typeId)) {
            this.gameAudio?.play('ui.deny');
            return;
        }
        this.gameAudio?.play('ui.select');
        this.showHint(null);

        // Selection (cell or building) is disabled while placing; it resumes after cancel.
        this.selectedCell = null;
        this.selectedBuildingId = null;
        this.selectedProtestId = null;
        this.selectionHighlight.setVisible(false);
        this.presentSelection();
        this.presentMenu();
        this.clearGhost();
        this.updatePreview(null);
        this.showFirstGhost();
    }

    exitPlacementMode() {
        EventBus.emit(Notice.DISARM);
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
        this.presentMenu();
        this.showFirstGhost();
    }

    exitRoadMode() {
        if (!this.roadMode) return;
        this.roadMode = false;
        this.roadDragAdds = false;
        this.presentMenu();
        this.clearGhost();
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
        this.presentMenu();
        this.showHint(null);
    }

    /** Is the flag being placed HQ's work flag? */
    flagsWorkers() {
        return this.flagBarracksId?.startsWith(`${HQ_TYPE}-`) ?? false;
    }

    /** Back to the Barracks or HQ, if it still stands. */
    exitFlagMode() {
        if (!this.flagBarracksId) return;
        const barracks = this.placement.buildings().find((b) => b.id === this.flagBarracksId);
        this.flagBarracksId = null;
        this.presentMenu();
        this.previewRect.setVisible(false);
        this.previewResult = null;
        this.showHint(null);
        if (barracks) this.selectAt({col: barracks.col, row: barracks.row});
    }

    applyFlagCell(cell) {
        const workersFlag = this.flagsWorkers();
        const result = workersFlag ? this.workers.setFlag(cell) : this.placement.setFlag(this.flagBarracksId, cell);
        this.lastResult = result;
        this.gameAudio?.result(result.ok);
        if (result.ok) {
            this.gameAudio?.play(workersFlag ? 'worker.explore' : 'soldier.order');
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
        const check = this.flagsWorkers() ? this.workers.canSetFlag(cell) : this.placement.canSetFlag(this.flagBarracksId, cell);
        this.previewResult = {footprint: {...cell, width: 1, height: 1}, ...check};
        this.drawPreview();
    }

    /** One road action on a cell, from a tap or a drag. */
    applyRoadCell(cell, {dragging}) {
        const removing = this.roads.has(cell);
        if (dragging && removing) return;
        const result = removing ? this.placement.removeRoad(cell) : this.placement.placeRoad(cell);
        this.lastResult = result;
        this.showHint(result.ok ? null : result.reason);
        this.gameAudio?.result(result.ok);
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
            if (!ROAD_ACCESS_TYPES.includes(building.type)) return [];
            return [{...shippingDock(building.type, building), kind: building.type === 'mine' ? 'mine' : 'factory'}];
        });
        this.roadLayer.sync(this.roads.tiles(), docks);
    }

    /** One short reason after a rejection, because touch has no hover. */
    showHint(reason) {
        if (reason === RoadFailure.NO_ROAD_ACCESS && this.placement?.selectedType === 'mine') reason = Hint.MINE_DOCK;
        this.present(State.HINT, {reason});
    }

    resetPlacementUi() {
        this.presentMenu();
        this.clearGhost();
        this.updatePreview(null);
        this.showHint(null);
    }

    /** Render the preview from the domain validation result for `cell`. */
    updatePreview(cell) {
        this.dropPowerWarning(cell);
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
        // Keep the existing rectangle as the selectable/QA-visible footprint.
        this.buildingViews.get(building.id)?.destroy();
        const rect = this.grid.footprintRect(building);
        const view = this.add.rectangle(rect.x, rect.y, rect.width, rect.height, BUILDING_COLORS[building.type])
            .setOrigin(0, 0)
            .setStrokeStyle(2, BUILDING_STROKE)
            .setDepth(1);
        if (this.buildingArt?.add(building, this.cycle?.shift)) {
            // The sprite becomes the building; a faint pad still shows occupancy.
            view.setFillStyle(BUILDING_COLORS[building.type], 0.10)
                .setStrokeStyle(2, BUILDING_STROKE, 0.35);
        }
        this.buildingViews.set(building.id, view);
    }

    /** Every view that follows the buildings and roads, after a QA layout load. */
    handleLayoutLoaded() {
        for (const building of this.placement.buildings()) this.addBuildingView(building);
        this.refreshRoads();
        this.selectAt(null);
        this.updateHud();
        this.refreshPower();
        this.presentMenu();
    }

    // ---- Pointer -----------------------------------------------------------

    /** The tile under a screen point. Outside the viewport there is none, whatever the camera shows. */
    cellAt({x, y}) {
        if (!this.grid) return null;
        const point = this.worldCamera.worldAt({x, y});
        return point ? this.grid.worldToCell(point.x, point.y) : null;
    }

    /** A press the HUD did not capture. A mouse acts now; a finger may yet become a gesture. */
    handleGridPointerDown(pointer) {
        this.dragCell = null; // lifting a finger sends no move, so a finished drag ends here
        if (!this.grid || this.phase === GamePhase.DEFEATED || isOrientationBlocked() || this.newspaper?.open || this.readingManual() || this.inCinematic()) return;
        // During END DAY's fast-forward a click only looks: construction is closed in
        // the domain, and here a left click no longer selects or arms anything.
        const looking = pointer.rightButtonDown() || pointer.middleButtonDown();
        if (this.cycle?.fastForwarding && !pointer.wasTouch && !looking) return;
        EventBus.emit(Notice.WORLD_PRESSED);
        if (pointer.wasTouch) {
            this.handleTouchDown(pointer);
            return;
        }
        if (pointer.rightButtonDown() || pointer.middleButtonDown()) {
            this.mousePan = {x: pointer.x, y: pointer.y};
            return;
        }
        this.pressCell(this.cellAt(pointer));
    }

    /** What a press on a tile means in the current mode. */
    pressCell(cell) {
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
            if (!this.holdForPowerWarning(cell)) this.placeOnCell(cell);
            return;
        }

        // Normal mode: never places. An occupied cell selects its building.
        this.selectAt(cell);
    }

    fingersDown() {
        return this.input.manager.pointers.filter((pointer) => pointer.isDown && pointer.wasTouch);
    }

    handleTouchDown(pointer) {
        const fingers = this.fingersDown();
        if (fingers.length >= 2) {
            this.beginGesture(fingers);
            return;
        }
        this.gesture = null; // one lifted over a HUD control was never reported here
        const cell = this.cellAt(pointer);
        if (this.touchPlacing()) {
            const onGhost = this.onGhost(cell);
            this.pendingPress = {pointerId: pointer.id, cell, ghost: true, onGhost, moved: false, prior: this.ghostSnapshot()};
            if (cell && !onGhost) this.propose(cell);
            return;
        }
        this.pendingPress = {pointerId: pointer.id, cell};
        this.showTouchPreview(cell);
    }

    /** Two fingers undo whatever the first was doing, and put the ghost back where it was. */
    beginGesture([first, second]) {
        const pending = this.pendingPress;
        this.pendingPress = null;
        this.dragCell = null;
        this.roadDragAdds = false;
        if (pending?.ghost) this.restoreGhost(pending.prior);
        else this.showTouchPreview(null);
        this.gesture = this.measureGesture(first, second);
    }

    measureGesture(first, second) {
        return {
            distance: Math.hypot(first.x - second.x, first.y - second.y),
            x: (first.x + second.x) / 2,
            y: (first.y + second.y) / 2,
        };
    }

    showTouchPreview(cell) {
        if (this.flagBarracksId) this.updateFlagPreview(cell);
    }

    touchPlacing() {
        return Boolean(this.placement?.isPlacing) || this.roadMode;
    }

    /** Walls and roads are drawn by dragging. Anything else a finger only aims. */
    dragBuilds() {
        return this.roadMode || this.placement.selectedType === WALL_TYPE;
    }

    /** @returns {boolean} whether the move has been dealt with */
    handleTouchMove(pointer) {
        if (this.gesture) {
            const fingers = this.fingersDown();
            if (fingers.length >= 2) this.moveGesture(fingers);
            return true;
        }
        const pending = this.pendingPress;
        if (!pending || pending.pointerId !== pointer.id) return this.touchPlacing();
        const cell = this.cellAt(pointer);
        if (cell?.col === pending.cell?.col && cell?.row === pending.cell?.row) return true;
        if (!pending.ghost) {
            pending.cell = cell;
            this.showTouchPreview(cell);
            return true;
        }
        if (!cell) return true; // off the world: the ghost waits where it was
        pending.cell = cell;
        pending.moved = true;
        if (this.dragBuilds()) this.extendSegment(cell);
        else this.setGhost(cell);
        return true;
    }

    // ---- Touch placement ---------------------------------------------------

    /** The nearest tile to the middle of the view that would be accepted, or failing that the nearest in view. */
    firstGhostCell() {
        const {x, y} = this.worldCamera.snapshot();
        const accepted = (cell) => (this.roadMode ? !this.roads.has(cell) && this.placement.previewRoad(cell).ok : this.placement.preview(cell)?.ok);
        const cells = [];
        for (let row = 0; row < this.grid.rows; row++) {
            for (let col = 0; col < this.grid.cols; col++) {
                const center = this.grid.cellCenter(col, row);
                if (this.worldCamera.isVisible(center)) cells.push({col, row, distance: (center.x - x) ** 2 + (center.y - y) ** 2});
            }
        }
        cells.sort((a, b) => a.distance - b.distance || a.row - b.row || a.col - b.col);
        const best = cells.find(accepted) ?? cells[0];
        return {col: best.col, row: best.row};
    }

    /** With no hover to show where a building would go, choosing one shows it straight away. */
    showFirstGhost() {
        if (this.layout.touch) this.propose(this.firstGhostCell());
    }

    propose(cell) {
        if (this.dragBuilds()) this.setSegment([cell]);
        else this.setGhost(cell);
    }

    noteGhost(last) {
        this.ghostRevision++;
        this.ghostLast = last;
    }

    setGhost(cell) {
        this.ghostCell = cell;
        this.noteGhost('moved');
        this.powerWarning = null;
        this.updatePreview(cell);
        const {ok, reason} = this.previewResult;
        if (ok && causesLowPower(this.placement.buildings(), this.placement.selectedType)) {
            // The warning comes with the ghost, so the confirming tap is the second press.
            this.powerWarning = {type: this.placement.selectedType, col: cell.col, row: cell.row};
            this.showHint(Hint.POWER_WARNING);
        } else {
            this.showHint(ok ? null : reason);
        }
    }

    setSegment(cells) {
        this.segment = cells;
        this.noteGhost('moved');
        this.previewRect.setVisible(false);
        this.previewResult = null;
        this.drawSegment();
    }

    /** Every tile between the end of the segment and the finger, so a fast drag leaves no gap. Going back shortens it. */
    extendSegment(cell) {
        const cells = [...this.segment];
        let {col, row} = cells.at(-1);
        while (col !== cell.col || row !== cell.row) {
            if (Math.abs(cell.col - col) >= Math.abs(cell.row - row)) col += Math.sign(cell.col - col);
            else row += Math.sign(cell.row - row);
            const seen = cells.findIndex((c) => c.col === col && c.row === row);
            if (seen === -1) cells.push({col, row});
            else cells.length = seen + 1;
        }
        this.setSegment(cells);
    }

    /** What the real rules say of each tile. Walls are paid for in order. */
    judgeSegment(cells) {
        if (this.roadMode) return this.judgeRoads(cells);
        const price = getBuildingType(WALL_TYPE).cost.credits;
        let accepted = 0;
        return cells.map(({col, row}) => {
            const check = this.placement.preview({col, row});
            const ok = Boolean(check?.ok) && (accepted + 1) * price <= this.economy.credits;
            if (ok) accepted++;
            return {col, row, ok, reason: check?.reason ?? null};
        });
    }

    /** A tile that only lacks a connection is fine if the segment brings one, from either end. */
    judgeRoads(cells) {
        const judged = cells.map(({col, row}) => {
            const cell = {col, row};
            let check;
            if (!this.roads.has(cell)) check = this.placement.previewRoad(cell);
            else if (cells.length === 1) check = this.placement.previewRoadRemoval(cell);
            else check = {ok: this.roads.isConnected(cell), reason: RoadFailure.NOT_CONNECTED};
            return {col, row, ok: check.ok, reason: check.reason ?? null};
        });
        const touchesAccepted = (tile) => judged.some((other) => other.ok && Math.abs(other.col - tile.col) + Math.abs(other.row - tile.row) === 1);
        let spreading = true;
        while (spreading) {
            spreading = false;
            for (const tile of judged) {
                if (tile.ok || tile.reason !== RoadFailure.NOT_CONNECTED || this.roads.has(tile) || !touchesAccepted(tile)) continue;
                tile.ok = true;
                tile.reason = null;
                spreading = true;
            }
        }
        return judged;
    }

    drawSegment() {
        this.segmentView = this.judgeSegment(this.segment);
        this.segmentGraphics.clear();
        for (const {col, row, ok} of this.segmentView) {
            const color = ok ? PREVIEW_VALID_COLOR : PREVIEW_INVALID_COLOR;
            const {x, y, width, height} = this.grid.footprintRect({col, row, width: 1, height: 1});
            this.segmentGraphics.fillStyle(color, 0.4).fillRect(x, y, width, height);
            this.segmentGraphics.lineStyle(2, color, 1).strokeRect(x, y, width, height);
        }
        this.showHint(this.segmentView.find(({ok}) => !ok)?.reason ?? null);
    }

    onGhost(cell) {
        if (!cell) return false;
        if (this.segment) return this.segment.some(({col, row}) => col === cell.col && row === cell.row);
        if (!this.ghostCell) return false;
        const {col, row, width, height} = this.previewResult.footprint;
        return cell.col >= col && cell.col < col + width && cell.row >= row && cell.row < row + height;
    }

    ghostSnapshot() {
        return {cell: this.ghostCell, segment: this.segment};
    }

    restoreGhost({cell, segment}) {
        if (segment) this.setSegment(segment);
        else if (cell) this.setGhost(cell);
        else this.clearGhost();
    }

    clearGhost() {
        if (!this.ghostCell && !this.segment) return;
        this.ghostCell = null;
        this.segment = null;
        this.segmentView = [];
        this.segmentGraphics.clear();
        this.powerWarning = null;
        this.previewRect.setVisible(false);
        this.previewResult = null;
        this.noteGhost('cleared');
    }

    /** The only place a finger spends anything. Rules are still placeAt's, so a red ghost is simply refused. */
    confirmGhost() {
        if (this.segment) {
            this.commitSegment();
            return;
        }
        this.powerWarning = null;
        this.placeOnCell(this.ghostCell);
        this.noteGhost(this.lastResult.ok ? 'confirmed' : 'refused');
    }

    commitSegment() {
        const cells = this.segmentView.filter(({ok}) => ok).map(({col, row}) => ({col, row}));
        if (cells.length === 0) {
            this.noteGhost('refused');
            return;
        }
        if (this.roadMode) this.commitRoads(cells);
        else for (const cell of cells) this.placeOnCell(cell);
        this.segment = null;
        this.segmentView = [];
        this.segmentGraphics.clear();
        this.previewRect.setVisible(false);
        this.previewResult = null;
        this.noteGhost('confirmed');
    }

    /** A segment may be drawn towards the network, so each pass lays what now touches it. */
    commitRoads(cells) {
        if (cells.length === 1) {
            this.applyRoadCell(cells[0], {dragging: false});
            return;
        }
        let waiting = cells.filter((cell) => !this.roads.has(cell));
        let progress = true;
        while (waiting.length > 0 && progress) {
            progress = false;
            waiting = waiting.filter((cell) => {
                this.applyRoadCell(cell, {dragging: true});
                if (this.lastResult.ok) progress = true;
                return !this.lastResult.ok;
            });
        }
    }

    moveGesture([first, second]) {
        const now = this.measureGesture(first, second);
        const before = this.gesture;
        this.worldCamera.panBy(now.x - before.x, now.y - before.y);
        if (before.distance >= PINCH_MIN_DISTANCE && now.distance >= PINCH_MIN_DISTANCE) {
            this.worldCamera.zoomBy(now.distance / before.distance, {x: now.x, y: now.y});
        }
        this.gesture = now;
    }

    handleGridPointerUp(pointer) {
        this.mousePan = null;
        if (!pointer.wasTouch || !this.grid) return;
        if (this.gesture) {
            if (this.fingersDown().length === 0) this.gesture = null;
            return;
        }
        const pending = this.pendingPress;
        if (pending?.pointerId === pointer.id) {
            this.pendingPress = null;
            if (pending.ghost) {
                if (pending.onGhost && !pending.moved && !isOrientationBlocked()) this.confirmGhost();
            } else if (!isOrientationBlocked()) {
                this.pressCell(pending.cell);
            }
        }
        this.dragCell = null;
        this.roadDragAdds = false;
    }

    handleWheel(pointer, deltaY) {
        if (this.newspaper?.open || this.readingManual() || this.inCinematic() || !this.worldCamera.worldAt(pointer) || isOrientationBlocked()) return;
        if (deltaY < 0) this.worldCamera.zoomIn(pointer);
        else if (deltaY > 0) this.worldCamera.zoomOut(pointer);
    }

    /**
     * A purchase that would take power from NORMAL to LOW_POWER needs a second press
     * on the same tile. This is a question for the player, not a rule, so it lives
     * here: placeAt, layouts and QA are unaffected, and the player can still say yes.
     * @returns {boolean} whether this press only warned
     */
    holdForPowerWarning(cell) {
        const type = this.placement.selectedType;
        if (!this.previewResult?.ok || !causesLowPower(this.placement.buildings(), type)) return false;
        if (this.powerWarning) {
            this.powerWarning = null;
            return false;
        }
        this.powerWarning = {type, col: cell.col, row: cell.row};
        this.showHint(Hint.POWER_WARNING);
        return true;
    }

    /** Anything but the same tile takes the question back. A new mode or building arrives here with no cell. */
    dropPowerWarning(cell) {
        const warning = this.powerWarning;
        if (!warning || (cell && cell.col === warning.col && cell.row === warning.row)) return;
        this.powerWarning = null;
        this.showHint(null);
    }

    /** One real placement attempt, from a press or a drag. */
    placeOnCell(cell) {
        const {building, ...result} = this.placement.placeAt(cell);
        this.lastResult = result;
        this.showHint(result.ok ? null : result.reason);
        this.gameAudio?.result(result.ok);
        if (building?.type === 'mine') this.gameAudio?.play('worker.mining');
        if (!result.ok) return;
        this.addBuildingView(building);
        this.refreshRoads();
        this.updateHud();
        this.refreshPower(); // new supply/demand takes effect immediately
        this.updatePreview(cell); // re-validate: cell now occupied, balances lower
        if (building.type === HQ_TYPE) this.resetPlacementUi(); // the domain ended placement; the rest unlocks
        this.presentMenu();
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

    handleGridPointerMove(pointer) {
        if (!this.grid || isOrientationBlocked() || this.newspaper?.open || this.readingManual() || this.inCinematic()) return;
        if (this.mousePan && !pointer.rightButtonDown() && !pointer.middleButtonDown()) this.mousePan = null; // released over the HUD
        if (this.mousePan) {
            this.worldCamera.panBy(pointer.x - this.mousePan.x, pointer.y - this.mousePan.y);
            this.mousePan = {x: pointer.x, y: pointer.y};
            return;
        }
        if (pointer.wasTouch && this.handleTouchMove(pointer)) return;
        const cell = this.cellAt(pointer);
        if (this.flagBarracksId) {
            this.updateFlagPreview(cell);
            return;
        }
        if (this.roadMode) {
            if (cell && pointer.isDown && this.roadDragAdds) this.applyRoadCell(cell, {dragging: true});
            else this.updateRoadPreview(cell);
            return;
        }
        if (!this.placement?.isPlacing || this.phase === GamePhase.DEFEATED) return;
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
        EventBus.emit(Notice.DISARM); // any press on the map, even on the same building
        this.selectedCell = cell;
        this.selectedBuildingId = cell ? this.grid.occupantAt(cell.col, cell.row) : null;
        // A protest is picked by its site or a tile one of its people stands on, where the player can see it.
        const protest = cell && !this.selectedBuildingId && this.ecologists && (!this.fog || this.fog.isVisible(cell.col, cell.row))
            ? this.ecologists.protestAt(cell) : null;
        this.selectedProtestId = protest;
        this.selectionSound(protest);
        if (protest) {
            const {site} = this.ecologists.protest(protest);
            const rect = this.grid.footprintRect({col: site.col, row: site.row, width: 1, height: 1});
            this.selectionHighlight.setPosition(rect.x, rect.y).setSize(rect.width, rect.height).setVisible(true);
        } else if (cell) {
            const building = this.selectedBuildingId
                ? this.placement.buildings().find((b) => b.id === this.selectedBuildingId)
                : null;
            const rect = this.grid.footprintRect(building ?? {col: cell.col, row: cell.row});
            this.selectionHighlight.setPosition(rect.x, rect.y).setSize(rect.width, rect.height).setVisible(true);
        } else {
            this.selectionHighlight.setVisible(false);
        }
        this.presentSelection();
    }

    /** Selecting something says so; HQ's workers and a Barracks' soldiers answer. */
    selectionSound(protest) {
        const building = this.selectedBuildingId ? this.placement.buildings().find((b) => b.id === this.selectedBuildingId) : null;
        if (!building && !protest) return;
        this.gameAudio?.play('ui.select');
        if (building?.type === HQ_TYPE && this.workers) this.gameAudio?.play('worker.select');
        if (building?.type === BARRACKS_TYPE) this.gameAudio?.play('soldier.select');
    }

    // ---- Simulation --------------------------------------------------------

    /**
     * TASK 033.1: THE LITTLE YELLOW BOOK is open (the HUD holds the world for it), or this
     * key press is the one that closed it, so it means nothing to the world. The HUD's
     * keyboard may hear a key before or after this scene's, so both are asked.
     */
    readingManual(event = null) {
        return this.suspension.has(SuspendReason.MANUAL) || event?.papiManual === true;
    }

    /** Phaser's frame delta drives the fixed-step clock; Phaser's `time` is ignored. */
    update(_time, delta) {
        // Turned to portrait, or with the AUDIO panel or the BUILD drawer open (TASK 032),
        // frames simply stop reaching the clock: its speed and pause state are not
        // touched, so the run comes back exactly as it was, no tick skipped or made up.
        this.suspension.set(SuspendReason.ORIENTATION, isOrientationBlocked());
        if (!this.suspension.active) {
            const onTick = (tick) => this.stepSimulation(tick);
            // END DAY: the rest of the Day in bounded batches, every tick through the
            // normal path. It stops at Dusk, which then plays in real time.
            if (this.cycle?.fastForwarding) this.cycle.stepTicks(FAST_FORWARD_TICKS_PER_FRAME, onTick);
            else this.clock.advance(delta, onTick);
        }
        this.syncShiftUi();
        this.syncPresident(delta);
        this.syncHeli(delta);
        this.syncEnding();
        this.syncAdvice(delta);
        this.combatFx?.sync(this.clock.tick, delta, !this.suspension.active && Boolean(this.cycle?.running || this.cycle?.fastForwarding));
        this.syncAudio(delta);
    }

    /** Each frame: music, ducking, engines, the PA, rocket launches and voice moments. */
    syncAudio(delta) {
        if (!this.gameAudio?.manager.enabled) return;
        const started = Boolean(this.cycle?.started);
        const buildings = started ? this.placement.buildings() : [];
        this.gameAudio.frame({
            phase: this.phase,
            shift: this.cycle?.shift ?? null,
            ending: Boolean(this.ending), // TASK 036: no music under the speech
            newspaperOpen: Boolean(this.newspaper?.open),
            advice: this.advice.view(), // TASK 033.4: the tip really on screen, never a QA preview
            // The world sounds only while it runs: not behind La Voz, in a paused Day, on the menu or after defeat.
            worldActive: started && this.phase !== GamePhase.DEFEATED && !this.newspaper?.open && !this.suspension.active
                && (this.cycle.fastForwarding || this.cycle.running),
            camera: this.cameras.main.worldView,
            isSeen: this.seenBy() ?? (() => true),
            trucks: started ? this.logistics?.snapshot().trucks ?? [] : [],
            towers: started ? (this.loudspeakers?.snapshot().towers ?? []).map((t) => ({...t, ...this.grid.cellCenter(t.col, t.row)})) : [],
            rockets: started ? (this.infantry?.rockets() ?? []).map(({id, fromX, fromY}) => ({id, x: fromX, y: fromY})) : [],
            workers: started ? this.workers?.workers() ?? [] : [],
            repairOrders: started && this.cycle.timed && this.workers ? this.workers.repairs().orders : [],
            infantryTotals: started ? this.infantry?.snapshot().totals ?? null : null,
            isWhole: (id) => {
                const building = buildings.find((b) => b.id === id);
                return Boolean(building) && building.hp >= getBuildingType(building.type).maxHp;
            },
        }, delta);
    }

    /** Where effects happen, for one tick's results: the fog decides what can be seen. */
    fxView(kinds = null) {
        const isSeen = this.seenBy() ?? (() => true);
        return {
            isSeen,
            // A hit's spark goes on the body the player sees, by mutant kind, when there is art.
            bodyAbove: (mutantId) => (this.textures.exists('papi-art-runner') ? bodyCentreAbove(kinds?.get(mutantId) ?? 'runner') : 0),
            turretAt: (id) => this.buildingIndex.get(id) ?? null,
            buildingAt: (id) => {
                const b = this.buildingIndex.get(id);
                return b ? {type: b.type, x: b.x, y: b.y, width: b.tiles, height: b.height} : null;
            },
        };
    }

    /** Where sounds happen, for one tick's results. */
    audioView() {
        return {
            positionOf: (id) => this.buildingIndex.get(id) ?? null,
            typeOf: (id) => this.buildingIndex.get(id)?.type ?? null,
            mutantAt: (id) => this.mutants.snapshot().find((m) => m.id === id) ?? null,
            isSeen: this.seenBy() ?? (() => true),
            camera: this.cameras.main.worldView,
        };
    }

    /** M, and the SOUND buttons: mute or unmute everything, and say so. */
    toggleSound() {
        const manager = this.gameAudio?.manager;
        if (!manager?.enabled) return;
        if (!manager.toggleMute()) manager.play('ui.toggle');
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
        this.loudspeakers?.step();
        // Kinds before anything fires: a mutant killed this tick still gets its own body offset for its spark.
        const kinds = this.combatFx && this.cycle?.shift === Shift.NIGHT ? new Map(this.mutants.snapshot().map((m) => [m.id, m.kind ?? 'runner'])) : null;
        const siege = this.siegeCannons?.step();
        if (siege?.fired.length) this.siegeLayer.recordFired(siege.fired, this.placement.buildings(), this.clock.tick);
        if (siege?.impacts.length) this.siegeLayer.recordImpacts(siege.impacts, this.clock.tick);
        const defense = this.autocannons?.step();
        if (defense?.shots.length) this.autocannonLayer.recordShots(defense.shots, this.clock.tick);
        const wanted = this.logistics?.gateDemands();
        if (wanted) {
            this.infantry.addGateDemands(wanted);
            this.workers.addGateDemands(wanted);
        }
        this.gates?.step(wanted);
        const squads = this.infantry?.step();
        if (squads?.shots.length) this.infantryLayer.recordShots(squads.shots, this.clock.tick);
        if (squads?.impacts) this.infantryLayer.recordImpacts(squads.impacts, this.clock.tick);
        const work = this.workers?.step();
        if (work?.cancelled.length) this.showHint(work.cancelled.at(-1).reason); // e.g. a repair that ran out of Credits
        const effects = this.mutants?.step();
        if (this.gameAudio?.manager.enabled) this.gameAudio.tick({siege, defense, squads, effects}, this.audioView());
        // Before destroyed buildings leave the index: where they stood is where they burn.
        this.combatFx?.spawn(planEffects({siege, defense, squads, effects}, this.fxView(kinds)), tick);
        if (effects?.impacts) this.mutantLayer.recordImpacts(effects.impacts, this.clock.tick);
        if (effects?.destroyed.length) this.handleBuildingsDestroyed(effects.destroyed);
        if (this.ecologists?.step().protestsStarted) this.showHint(Hint.PROTEST); // after mutants, before trucks
        if (this.logistics?.step().deliveries) this.updateHud();
        this.updateUnitVision();
    }

    /** Domain already removed these buildings, destroyed or demolished; bring the presentation in line. */
    handleBuildingsDestroyed(ids) {
        for (const id of ids) {
            this.buildingViews.get(id).destroy();
            this.buildingViews.delete(id);
            this.buildingArt?.remove(id);
            this.autocannonLayer.remove(id);
        }
        if (ids.includes(this.selectedBuildingId)) this.selectAt(null);
        if (ids.includes(this.flagBarracksId)) this.exitFlagMode();
        this.refreshPower();
        this.refreshRoads();
    }

    // ---- QA ----------------------------------------------------------------

    qaState() {
        const rectView = (r) => ({visible: r.visible, x: r.x, y: r.y, width: r.width, height: r.height});
        const hud = this.hudReady ? this.scene.get('hud').views() : NO_HUD;
        return {
            ...hud,
            scene: this.scene.key,
            phase: this.phase,
            width: this.scale.width,
            height: this.scale.height,
            grid: this.grid ? this.grid.snapshot() : null,
            map: {id: this.map.id, cols: this.map.cols, rows: this.map.rows, seed: this.worldSeed, spawnFrame: this.map.spawnFrame},
            terrain: this.terrain ? this.terrain.snapshot() : null,
            terrainView: this.terrainLayer ? this.terrainLayer.view() : null,
            deposits: this.terrain?.depositSnapshot ? this.terrain.depositSnapshot() : null,
            buildingArtViews: this.buildingArt ? this.buildingArt.views() : null,
            fog: this.fog ? this.fog.snapshot() : null,
            fogView: this.fogLayer ? this.fogLayer.view() : null,
            selectedCell: this.selectedCell ? {...this.selectedCell} : null,
            highlight: this.selectionHighlight ? rectView(this.selectionHighlight) : null,
            ui: {...hud.ui, endDayEnabled: this.cycle ? this.cycle.canEndDay : false},
            camera: this.worldCamera.snapshot(),
            orientation: {blocked: isOrientationBlocked()},
            suspension: {active: this.suspension.active, reasons: this.suspension.reasons()}, // TASK 032
            // Domain power state, derived on demand from the building records.
            power: this.placement ? calculatePower(this.placement.buildings()) : null,
            selectedBuilding: this.selectedBuildingId,
            shiftCycle: this.cycle?.started ? this.cycle.snapshot() : null,
            // Latest nightly settlement report (domain).
            settlement: this.cycle?.lastSettlement ? structuredClone(this.cycle.lastSettlement) : null,
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
            // Shells in flight, then their rendered effects.
            shells: this.mutants ? this.mutants.shells() : null,
            siegeCannons: this.siegeCannons ? this.siegeCannons.snapshot() : null,
            siegeShells: this.siegeCannons ? this.siegeCannons.shells() : null,
            siegeViews: this.siegeLayer ? this.siegeLayer.views() : null,
            rockets: this.infantry ? this.infantry.rockets() : null,
            powerWarning: this.powerWarning,
            ghost: {
                active: this.ghostCell !== null || this.segment !== null,
                cell: this.ghostCell,
                footprint: this.ghostCell ? this.previewResult?.footprint ?? null : null,
                segment: this.segmentView,
                ok: this.segment ? this.segmentView.every(({ok}) => ok) : Boolean(this.ghostCell && this.previewResult?.ok),
                revision: this.ghostRevision,
                last: this.ghostLast,
            },
            spitterEffectViews: this.mutantLayer ? this.mutantLayer.effectViews() : null,
            hpBarViews: this.mutantLayer ? this.mutantLayer.hpBarViews() : null,
            // The frozen night plan and slots reached so far.
            wave: this.mutants ? this.mutants.plan() : null,
            waveProgress: this.mutants?.plan() && this.cycle.shift === Shift.NIGHT
                ? waveProgress(this.mutants.plan(), this.cycle.elapsedNightTicks)
                : null,
            // The defeat record (null until HQ falls).
            defeat: this.cycle ? this.cycle.defeatReport : null,
            // Domain turret state, then the rendered barrels and tracers.
            autocannons: this.autocannons ? this.autocannons.snapshot() : null,
            barrelViews: this.autocannonLayer ? this.autocannonLayer.barrelViews() : null,
            tracerViews: this.autocannonLayer ? this.autocannonLayer.tracerViews() : null,
            simulation: {
                ...this.clock.snapshot(),
                speed: this.clock.speed,
                stepsExecuted: this.simulationSteps,
                rng: this.rng.snapshot(),
            },
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
            // Domain squads, then the rendered soldiers and flags.
            infantry: this.infantry ? this.infantry.snapshot() : null,
            infantryViews: this.infantryLayer ? this.infantryLayer.views() : null,
            workers: this.workers ? this.workers.snapshot() : null,
            nightTint: this.nightTint ? this.nightTint.view() : null,
            workerViews: this.workerLayer ? this.workerLayer.views() : null,
            ecologists: this.ecologists ? this.ecologists.snapshot() : null,
            selectedProtest: this.selectedProtestId ?? null,
            combatFx: this.combatFx ? this.combatFx.view() : null,
            president: this.president ? {...this.president.view(), drawn: this.presidentLayer.view()} : null, // TASK 033.2
            ending: this.ending ? {...this.ending, ...(this.scene.isActive('ending') ? this.scene.get('ending').view() : {})} : null, // TASK 036
            profile: {presidentialEndingSeen: endingSeen(browserStorage())}, // TASK 036
            heli: this.heli ? { // TASK 035
                ...this.heli.view(),
                drawn: this.heliLayer?.view() ?? null,
                camera: this.heliCamera ? {saved: {...this.heliCamera.saved}, target: {...this.heliCamera.target}} : null,
                restored: this.heliRestored ?? null,
                // What the world really holds, by texture: one hidden El Presidente, at most one helicopter, nobody else.
                actors: Object.fromEntries([['heli', 'papi-heli'], ['president', 'papi-art-elcolonel']]
                    .map(([name, key]) => [name, this.children.list.filter((o) => o.texture?.key === key).length])),
            } : null,
            advice: {...this.advice.view(), preview: this.advicePreview}, // TASK 033.3
            audio: this.gameAudio?.manager.enabled ? {...this.gameAudio.manager.snapshot(), narration: this.gameAudio.narration()} : null,
            newspaper: this.newspaper ? {enabled: this.newsEnabled, open: this.newspaper.open, reason: this.newspaper.reason,
                pausedByNews: this.newspaper.pausedByNews, edition: this.newspaper.edition} : null,
            loudspeakers: this.loudspeakers ? {...this.loudspeakers.snapshot(), network: this.placement.loudspeakerNetwork} : null,
            speakerRingView: this.speakerRing ? {visible: this.speakerRing.visible} : null,
            ecologistViews: this.ecologistLayer ? this.ecologistLayer.views() : null,
            flagMode: this.flagBarracksId,
            roadMode: this.roadMode,
            ringPreviewView: this.roadLayer ? this.roadLayer.ringPreviewView() : null,
            // 'available', 'locked' or 'built', keyed by building type.
            menuState: this.placement ? this.menuStates() : null,
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
