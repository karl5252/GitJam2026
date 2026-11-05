const TRUCK_SIZE = {width: 18, height: 12};
const EMPTY_COLOR = 0xb0bec5;
const LOADED_COLOR = 0xffb300;
const STROKE = 0x212121;
const TRUCK_DEPTH = 2;
const PIP_SIZE = 8;
const PIP_GAP = 3;

/** Trucks and Factory storage pips. Presentation only; state comes from a snapshot. */
export class TruckLayer {
    #scene;
    #grid;
    #trucks = new Map();
    #pips = new Map();

    constructor(scene, grid) {
        this.#scene = scene;
        this.#grid = grid;
    }

    /** @param {{trucks: Array, factories: Array}} snapshot */
    sync({trucks, factories}) {
        const live = new Set();
        for (const truck of trucks) {
            live.add(truck.id);
            const view = this.#trucks.get(truck.id) ?? this.#addTruck(truck.id);
            view.setPosition(truck.x, truck.y)
                .setFillStyle(truck.cargo > 0 ? LOADED_COLOR : EMPTY_COLOR)
                .setVisible(truck.state !== 'respawning');
        }
        for (const [id, view] of this.#trucks) {
            if (live.has(id)) continue;
            view.destroy();
            this.#trucks.delete(id);
        }

        const standing = new Set();
        for (const factory of factories) {
            standing.add(factory.id);
            const pips = this.#pips.get(factory.id) ?? this.#addPips(factory);
            pips.forEach((pip, i) => pip.setVisible(i < factory.stored));
        }
        for (const [id, pips] of this.#pips) {
            if (standing.has(id)) continue;
            for (const pip of pips) pip.destroy();
            this.#pips.delete(id);
        }
    }

    #addTruck(id) {
        const view = this.#scene.add.rectangle(0, 0, TRUCK_SIZE.width, TRUCK_SIZE.height, EMPTY_COLOR)
            .setStrokeStyle(1, STROKE)
            .setDepth(TRUCK_DEPTH);
        this.#trucks.set(id, view);
        return view;
    }

    #addPips(factory) {
        const {x, y} = this.#grid.footprintRect(factory);
        const pips = [0, 1].map((i) => this.#scene.add
            .rectangle(x + PIP_GAP + i * (PIP_SIZE + PIP_GAP), y + PIP_GAP, PIP_SIZE, PIP_SIZE, LOADED_COLOR)
            .setOrigin(0, 0)
            .setStrokeStyle(1, STROKE)
            .setDepth(TRUCK_DEPTH)
            .setVisible(false));
        this.#pips.set(factory.id, pips);
        return pips;
    }

    /** The rendered trucks and storage pips, for QA. */
    views() {
        return {
            trucks: [...this.#trucks].map(([id, view]) => ({id, x: view.x, y: view.y, visible: view.visible, fillColor: view.fillColor})),
            stored: Object.fromEntries([...this.#pips].map(([id, pips]) => [id, pips.filter((pip) => pip.visible).length])),
        };
    }
}
