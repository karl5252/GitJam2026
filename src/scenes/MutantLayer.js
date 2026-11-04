import {getBuildingType} from '../core/buildingTypes.js';

const MUTANT_RADIUS = 8;
const MUTANT_COLOR = 0xd81b60;
const MUTANT_DEPTH = 6;
const HP_BAR_COLOR = 0x66bb6a;
const HP_BAR_HEIGHT = 4;
const HP_BAR_INSET = 2;
const HP_BAR_DEPTH = 5;

/**
 * Graybox drawing for mutants and damaged buildings. Presentation only: it
 * receives detached domain snapshots and holds no gameplay state.
 */
export class MutantLayer {
    #scene;
    #grid;
    #mutantViews = new Map();
    #hpBars = new Map();

    constructor(scene, grid) {
        this.#scene = scene;
        this.#grid = grid;
    }

    /** Match the views to the current mutants and buildings. */
    sync(mutants, buildings) {
        this.#syncMutants(mutants);
        this.#syncHpBars(buildings);
    }

    /** Rendered mutant circles, for QA. */
    mutantViews() {
        return [...this.#mutantViews].map(([id, view]) => ({
            id, visible: view.visible, x: view.x, y: view.y, radius: view.radius,
        }));
    }

    /** Rendered HP bars, for QA. */
    hpBarViews() {
        return [...this.#hpBars].map(([id, bar]) => ({
            id, visible: bar.visible, x: bar.x, y: bar.y, width: bar.width, height: bar.height,
        }));
    }

    #syncMutants(mutants) {
        const alive = new Set(mutants.map((mutant) => mutant.id));
        for (const [id, view] of this.#mutantViews) {
            if (alive.has(id)) continue;
            view.destroy();
            this.#mutantViews.delete(id);
        }
        for (const {id, x, y} of mutants) {
            let view = this.#mutantViews.get(id);
            if (!view) {
                view = this.#scene.add.circle(x, y, MUTANT_RADIUS, MUTANT_COLOR).setDepth(MUTANT_DEPTH);
                this.#mutantViews.set(id, view);
            }
            view.setPosition(x, y);
        }
    }

    #syncHpBars(buildings) {
        const damaged = buildings.filter((b) => b.hp < getBuildingType(b.type).maxHp);
        const ids = new Set(damaged.map((b) => b.id));
        for (const [id, bar] of this.#hpBars) {
            if (ids.has(id)) continue;
            bar.destroy();
            this.#hpBars.delete(id);
        }
        for (const building of damaged) {
            const rect = this.#grid.footprintRect(building);
            const width = (rect.width - 2 * HP_BAR_INSET) * building.hp / getBuildingType(building.type).maxHp;
            let bar = this.#hpBars.get(building.id);
            if (!bar) {
                bar = this.#scene.add.rectangle(rect.x + HP_BAR_INSET, rect.y + HP_BAR_INSET, width, HP_BAR_HEIGHT, HP_BAR_COLOR)
                    .setOrigin(0, 0)
                    .setDepth(HP_BAR_DEPTH);
                this.#hpBars.set(building.id, bar);
            }
            bar.setSize(width, HP_BAR_HEIGHT);
        }
    }
}
