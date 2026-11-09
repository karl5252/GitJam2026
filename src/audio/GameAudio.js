/**
 * TASK 030: what the game sounds like. GameScene hands it what already happened,
 * each tick's results and each frame's state, and it decides which semantic
 * events play, where. It never reads or writes the simulation itself.
 *
 * Fog of War is respected: an event on a tile the player cannot see plays
 * nothing, except the loss of one of the player's own buildings.
 */
import {AdviceNarrator} from './adviceNarrator.js';

const WALL_TYPES = new Set(['wall', 'gateVertical', 'gateHorizontal']);
const MAX_ENGINES = 2;

/**
 * One tick's results as sound events. Pure.
 * @param {{siege?, defense?, squads?, effects?}} results the step() results of SiegeCannons,
 *   Autocannons, Infantry and Mutants
 * @param {{positionOf: (buildingId) => {x, y} | null, typeOf: (buildingId) => string | null,
 *          mutantAt: (mutantId) => {x, y} | null, isSeen: ({x, y}) => boolean}} view
 * @returns {Array<{event: string, x: number, y: number}>}
 */
export function tickEvents({siege = null, defense = null, squads = null, effects = null}, view) {
    const out = [];
    const add = (event, at, always = false) => {
        if (!at) return;
        if (!always && !view.isSeen(at)) return;
        out.push({event, x: at.x, y: at.y});
    };
    for (const {gunId} of siege?.fired ?? []) add('weapon.rocket_alt', view.positionOf(gunId));
    for (const {x, y, killed} of siege?.impacts ?? []) {
        add('combat.explosion', {x, y});
        if (killed) add('mutant.hit', {x, y});
    }
    for (const {turretId, killed, x, y} of defense?.shots ?? []) {
        add('weapon.machinegun', view.positionOf(turretId));
        if (killed) add('mutant.hit', {x, y});
    }
    for (const {rocket, killed, fromX, fromY, x, y} of squads?.shots ?? []) {
        if (rocket) add('combat.explosion', {x, y}); // a rocket is in shots when it lands
        else add('weapon.machinegun_alt', {x: fromX, y: fromY});
        if (killed) add('mutant.hit', {x, y});
    }
    for (const id of effects?.spawned ?? []) add('mutant.growl', view.mutantAt(id));
    for (const {buildingId} of effects?.attacks ?? []) add('mutant.attack', view.positionOf(buildingId));
    for (const id of effects?.destroyed ?? []) {
        add(WALL_TYPES.has(view.typeOf(id)) ? 'wall.break' : 'building.destroy', view.positionOf(id), true);
    }
    return out;
}

/** The music a moment wants. */
export function musicState({phase, shift}) {
    if (phase === 'ready') return 'menu';
    if (phase === 'defeated' || shift === 'defeated') return 'defeat';
    if (shift === 'dusk') return 'dusk';
    if (shift === 'night') return 'night';
    return 'day';
}

export class GameAudio {
    #sound;
    #narrator; // TASK 033.4: El Presidente reads the tip on screen
    #seenRockets = new Set();
    #last = null; // what the previous frame saw, for the voice moments

    /** @param {import('./SoundManager.js').SoundManager} sound */
    constructor(sound) {
        this.#sound = sound;
        this.#narrator = new AdviceNarrator(sound);
    }

    /** TASK 033.4: which tips have had their line, and whose line speaks. */
    narration() {
        return this.#narrator.view();
    }

    get manager() {
        return this.#sound;
    }

    /** Pan from where it is across the view, quieter off-screen. */
    #placed({x, y}, camera) {
        if (!camera) return {};
        const pan = Math.max(-1, Math.min(1, (x - (camera.x + camera.width / 2)) / (camera.width / 2)));
        const inside = x >= camera.x && x <= camera.x + camera.width && y >= camera.y && y <= camera.y + camera.height;
        return {pan, gain: inside ? 1 : 0.45};
    }

    /** Play a UI or unit event, not tied to a place. */
    play(event) {
        return this.#sound.play(event);
    }

    /** A command's result: accepted or refused, never both. */
    result(ok, {accepted = 'ui.accept'} = {}) {
        this.#sound.play(ok ? accepted : 'ui.deny');
    }

    /** Each tick's results. */
    tick(results, view) {
        for (const {event, x, y} of tickEvents(results, view)) this.#sound.play(event, this.#placed({x, y}, view.camera));
    }

    /**
     * Each frame: music, the newspaper's duck, truck engines, the PA, rocket launches,
     * and the unit voice moments found by comparing this frame with the last.
     */
    frame(state, deltaMs) {
        const sound = this.#sound;
        sound.setMusicState(musicState(state));
        sound.duck(state.newspaperOpen);
        // One switch for everything the world itself sounds like: engines and the PA.
        sound.setWorldActive(state.worldActive !== false);

        // Engines on the moving trucks nearest the view's centre, which can be seen.
        const camera = state.camera;
        const centre = camera ? {x: camera.x + camera.width / 2, y: camera.y + camera.height / 2} : {x: 0, y: 0};
        const moving = (state.trucks ?? [])
            .filter((t) => (t.state === 'outbound' || t.state === 'returning') && state.isSeen(t))
            .sort((a, b) => Math.hypot(a.x - centre.x, a.y - centre.y) - Math.hypot(b.x - centre.x, b.y - centre.y) || (a.id < b.id ? -1 : 1))
            .slice(0, MAX_ENGINES);
        sound.syncLoops(new Map(moving.map((t) => [t.id, {event: 'vehicle.engine', ...this.#placed(t, camera)}])));

        // One PA voice, from the nearest operating tower.
        const towers = (state.towers ?? []).filter((t) => t.operating);
        const nearest = towers.sort((a, b) => Math.hypot(a.x - centre.x, a.y - centre.y) - Math.hypot(b.x - centre.x, b.y - centre.y))[0];
        sound.broadcast(nearest ? this.#placed(nearest, camera) : null);

        // Rockets are fired when they first appear in flight.
        for (const rocket of state.rockets ?? []) {
            if (this.#seenRockets.has(rocket.id)) continue;
            this.#seenRockets.add(rocket.id);
            if (state.isSeen(rocket)) sound.play('weapon.rocket', this.#placed(rocket, camera));
        }
        if ((state.rockets ?? []).length === 0) this.#seenRockets.clear();

        this.#voices(state);
        this.#narrator.frame(state.advice ?? null); // after the units: the President outranks them
        sound.update(deltaMs);
    }

    /** Unit voices at meaningful moments, never every tick of work or every shot. */
    #voices(state) {
        const now = {
            shift: state.shift,
            working: (state.workers ?? []).some((w) => w.working),
            workerHp: Object.fromEntries((state.workers ?? []).map((w) => [w.id, w.hp])),
            orders: new Set((state.repairOrders ?? []).map((o) => o.buildingId)),
            soldierShots: state.infantryTotals?.shots ?? 0,
            soldiersLost: state.infantryTotals?.lost ?? 0,
            fought: false,
        };
        const last = this.#last;
        this.#last = now;
        if (!last) return;
        now.fought = last.fought || now.soldierShots > last.soldierShots;
        if (now.working && !last.working) this.#sound.play('worker.lumber');
        if (Object.entries(now.workerHp).some(([id, hp]) => last.workerHp[id] !== undefined && hp < last.workerHp[id])) this.#sound.play('worker.danger');
        for (const id of last.orders) {
            if (!now.orders.has(id) && state.isWhole?.(id)) this.#sound.play('worker.complete');
        }
        if (now.soldierShots > last.soldierShots) this.#sound.play('soldier.attack');
        if (now.soldiersLost > last.soldiersLost) this.#sound.play('soldier.danger');
        if (now.shift === 'dusk' && last.shift === 'day' && (state.workers ?? []).length > 0) this.#sound.play('worker.return');
        if (now.shift === 'day' && last.shift === 'night') {
            if (last.fought) this.#sound.play('soldier.victory');
            now.fought = false;
        }
        if (now.shift === 'night' && last.shift !== 'night') now.fought = false;
    }

    /** The scene is ending. */
    stop() {
        this.#narrator.stop();
        this.#sound.stopTransient();
        this.#seenRockets.clear();
        this.#last = null;
    }
}
