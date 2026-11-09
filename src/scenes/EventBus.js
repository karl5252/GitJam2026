import Phaser from 'phaser';

/**
 * The only link between GameScene and HUDScene, as in BarrelStorm. It is global
 * and outlives scenes, so whoever subscribes must unsubscribe on shutdown.
 *
 * State flows down and is presentation data, never live game objects: GameScene
 * publishes a value when it changes, keeps the latest of each, and hands them all
 * over in one Hud.SNAPSHOT when a HUD says it is ready. The simulation stays the
 * single source of truth, so a HUD can be stopped and started at any time.
 *
 * Commands flow up and are intentions. The HUD changes nothing itself: GameScene
 * decides, and the result comes back as state.
 */
export const EventBus = new Phaser.Events.EventEmitter();

export const Hud = Object.freeze({
    READY: 'hud:ready',
    SNAPSHOT: 'hud:snapshot',
});

/** GameScene to HUD. */
export const State = Object.freeze({
    PHASE: 'phase:changed', // {phase}
    SHIFT: 'shift:changed', // {day, shift, seconds, paused, timed, fastForward}
    ECONOMY: 'economy:changed', // {credits, ap}
    POLLUTION: 'pollution:changed', // {value, threat}
    POWER: 'power:changed', // {generation, demand, status}
    SETTLEMENT: 'settlement:changed', // {report, delivered}
    WAVE: 'wave:changed', // {visible, mutants, reached, total}
    MENU: 'menu:changed', // {visible, states, selected, road, endDay, cancel, speed, dayTime}
    SELECTION: 'selection:changed', // {building, canFlag, workers, canDemolish, confirmDemolish, refitTo, switchable}
    HINT: 'hint:changed', // {reason}
    SPEED: 'speed:changed', // {speed}
    GAME_OVER: 'game:over', // {completedShifts}
    NEWSPAPER: 'newspaper:changed', // {enabled, open, reason, edition}: TASK 029
});

/** Something happened that the HUD should react to, but which is not state. */
export const Notice = Object.freeze({
    DISARM: 'selection:disarm', // a two-press action must start again
    WORLD_PRESSED: 'world:pressed', // the player pressed the battlefield
    POINTER_LEFT_HUD: 'hud:pointerLeft', // the move Phaser spent on leaving a control, handed on
});

/** HUD to GameScene. */
export const Command = Object.freeze({
    START: 'game:start',
    RESTART: 'game:restart',
    BUILD: 'build:select', // {type}
    ROAD: 'build:road',
    CANCEL: 'build:cancel',
    END_DAY: 'day:end',
    SET_SPEED: 'simulation:setSpeed', // {speed}
    TOGGLE_POWER: 'building:togglePower',
    DEMOLISH: 'building:demolish',
    MOVE_FLAG: 'barracks:moveFlag',
    RESET_FLAG: 'barracks:resetFlag',
    REFIT: 'barracks:refit',
    REPAIR: 'building:repair', // REPAIR or STOP REPAIR on the selection
    DISPERSE: 'protest:disperse', // DISPERSE or CANCEL DISPERSE on the selected protest
    OPEN_NEWSPAPER: 'newspaper:open', // REPORT, or READ LA VOZ on desktop
    CLOSE_NEWSPAPER: 'newspaper:close', // CONTINUE or Escape
    ZOOM_IN: 'camera:zoomIn',
    ZOOM_OUT: 'camera:zoomOut',
    FIT: 'camera:fit',
    TOGGLE_DAY_PAUSE: 'day:togglePause', // Day only
    CYCLE_DAY_SPEED: 'day:cycleSpeed', // Day only: 1x, 2x, 4x, round again
});

/** Reasons only the HUD words, beside the domain's own failure codes. */
export const Hint = Object.freeze({
    POWER_WARNING: 'power-warning',
    REFIT_REFUSED: 'refit-refused',
    MINE_DOCK: 'mine-dock',
    PROTEST: 'protest',
});
