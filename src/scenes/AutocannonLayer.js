const BARREL_COLOR = 0xeceff1;
const BARREL_SIZE = {width: 14, height: 6};
const TRACER_COLOR = 0xffeb3b;
const TRACER_HEIGHT = 2;
const TRACER_TICKS = 6;
const LAYER_DEPTH = 5;
const DISABLED_ALPHA = 0.35;
const FACING_STEP = Math.PI / 4;
const DEFAULT_FACING = -Math.PI / 2;

/** Snap an angle to the nearest of 8 directions. */
export const quantizeFacing = (angle) => Math.round(angle / FACING_STEP) * FACING_STEP;

/**
 * Graybox barrels and tracers. Presentation only: it receives detached domain
 * snapshots, and its facing angle and tracer timing never affect gameplay.
 */
export class AutocannonLayer {
    #scene;
    #grid;
    #barrels = new Map(); // turret id -> {view, facing}
    #tracers = new Map(); // turret id -> {view, firedTick}

    constructor(scene, grid) {
        this.#scene = scene;
        this.#grid = grid;
    }

    /** Show a tracer for each of this tick's shots. */
    recordShots(shots, tick) {
        for (const shot of shots) {
            const {x, y} = this.#centerOf(shot.turretId);
            const angle = Math.atan2(shot.y - y, shot.x - x);
            const length = Math.hypot(shot.x - x, shot.y - y);
            const tracer = this.#tracers.get(shot.turretId) ?? {
                view: this.#scene.add.rectangle(x, y, length, TRACER_HEIGHT, TRACER_COLOR).setOrigin(0, 0.5).setDepth(LAYER_DEPTH),
            };
            tracer.firedTick = tick;
            tracer.view.setSize(length, TRACER_HEIGHT).setRotation(angle).setVisible(true);
            this.#tracers.set(shot.turretId, tracer);
        }
    }

    /** Match the views to the current turrets, mutants and buildings. */
    sync({cannons, mutants, buildings, tick, isNight}) {
        const ids = new Set(cannons.map((cannon) => cannon.id));
        for (const id of [...this.#barrels.keys(), ...this.#tracers.keys()]) {
            if (!ids.has(id)) this.remove(id);
        }
        for (const {id, targetId} of cannons) {
            const barrel = this.#barrelFor(id);
            const target = mutants.find((mutant) => mutant.id === targetId);
            if (target) {
                const {x, y} = this.#centerOf(id);
                barrel.facing = quantizeFacing(Math.atan2(target.y - y, target.x - x));
            }
            const enabled = buildings.find((b) => b.id === id).enabled;
            barrel.view.setRotation(barrel.facing).setAlpha(enabled ? 1 : DISABLED_ALPHA);
        }
        for (const tracer of this.#tracers.values()) {
            tracer.view.setVisible(isNight && tick - tracer.firedTick <= TRACER_TICKS);
        }
    }

    /** Remove a turret's views at once, e.g. when it is destroyed. */
    remove(id) {
        this.#barrels.get(id)?.view.destroy();
        this.#barrels.delete(id);
        this.#tracers.get(id)?.view.destroy();
        this.#tracers.delete(id);
    }

    /** Rendered barrels, for QA. */
    barrelViews() {
        return [...this.#barrels].map(([id, {view}]) => ({
            id, visible: view.visible, x: view.x, y: view.y, width: view.width, height: view.height, rotation: view.rotation, alpha: view.alpha,
        }));
    }

    /** Rendered tracers, for QA. */
    tracerViews() {
        return [...this.#tracers].map(([id, {view}]) => ({
            id, visible: view.visible, x: view.x, y: view.y, width: view.width, rotation: view.rotation,
        }));
    }

    #barrelFor(id) {
        if (!this.#barrels.has(id)) {
            const {x, y} = this.#centerOf(id);
            const view = this.#scene.add.rectangle(x, y, BARREL_SIZE.width, BARREL_SIZE.height, BARREL_COLOR)
                .setOrigin(0, 0.5)
                .setDepth(LAYER_DEPTH);
            this.#barrels.set(id, {view, facing: DEFAULT_FACING});
        }
        return this.#barrels.get(id);
    }

    #centerOf(id) {
        const footprint = this.#scene.placement.buildings().find((b) => b.id === id);
        const {x, y, width, height} = this.#grid.footprintRect(footprint);
        return {x: x + width / 2, y: y + height / 2};
    }
}
