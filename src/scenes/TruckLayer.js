import {addArt, placeArt} from './SpriteArt.js';

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
    #truckArt = new Map();
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
            const art = this.#truckArt.get(truck.id);
            if (art) {
                if (art.lastX !== undefined && art.lastX !== truck.x) art.sprite.setFlipX(truck.x < art.lastX);
                art.lastX = truck.x;
                art.sprite.setFrame(truck.cargo > 0 ? 1 : 0)
                    .setVisible(truck.state !== 'respawning');
                placeArt(art.sprite, 'truck', truck.x, truck.y);
            }
        }
        for (const [id, view] of this.#trucks) {
            if (live.has(id)) continue;
            view.destroy();
            this.#truckArt.get(id)?.sprite.destroy();
            this.#truckArt.delete(id);
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
        const art = addArt(this.#scene, 'truck', TRUCK_DEPTH + 0.1);
        if (art) this.#truckArt.set(id, {sprite: art});
        const view = this.#scene.add.rectangle(0, 0, TRUCK_SIZE.width, TRUCK_SIZE.height, EMPTY_COLOR)
            .setStrokeStyle(1, STROKE)
            .setDepth(TRUCK_DEPTH);
        if (art) view.setAlpha(0);
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
