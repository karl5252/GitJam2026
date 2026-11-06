const BARREL_COLOR = 0xffb300;
const BARREL_SIZE = {width: 30, height: 9};
const DEFAULT_FACING = -Math.PI / 2;
const RELOAD_BAR = {height: 4, inset: 3, color: 0xffb300, back: 0x212121};
const SHELL_RADIUS = 6;
const SHELL_COLOR = 0xffb300;
const SHELL_STROKE = 0x3e2723;
const MARK_RADIUS = 24; // the impact radius, so the player sees what it can reach
const MARK_COLOR = 0xffb300;
const MARK_ALPHA = 0.5;
const IMPACT_TICKS = 16;
const IMPACT_GROWTH = 0.5;
const IMPACT_MISS_COLOR = 0xb0bec5;
const LAYER_DEPTH = 5;
const SHELL_DEPTH = 7;

/**
 * Graybox Siege Cannons: a long barrel, a bar that fills as it reloads, a shell in
 * flight with a ring where it will land, and a burst on impact. Presentation only:
 * it receives detached snapshots, and nothing here affects gameplay.
 */
export class SiegeLayer {
    #scene;
    #grid;
    #guns = new Map(); // gun id -> {barrel, back, bar, facing, width}
    #shells = new Map(); // shell id -> {view, mark}
    #impacts = []; // {view, tick}

    constructor(scene, grid) {
        this.#scene = scene;
        this.#grid = grid;
    }

    /** Point each gun that fired at what it fired at. */
    recordFired(fired, buildings) {
        for (const {gunId, x, y} of fired) {
            const gun = this.#guns.get(gunId);
            const building = buildings.find((b) => b.id === gunId);
            if (!gun || !building) continue;
            const center = this.#centerOf(building);
            gun.facing = Math.atan2(y - center.y, x - center.x);
        }
    }

    /** Show where this tick's shells came down. */
    recordImpacts(impacts, tick) {
        for (const {x, y, mutantId} of impacts) {
            const view = this.#scene.add.circle(x, y, MARK_RADIUS).setStrokeStyle(4, mutantId ? SHELL_COLOR : IMPACT_MISS_COLOR).setDepth(SHELL_DEPTH);
            this.#impacts.push({view, tick});
        }
    }

    /** Match the views to the guns and shells. Runs every frame. */
    sync({guns, shells, buildings, reloadTicks, tick, isNight}) {
        const standing = new Set(guns.map(({id}) => id));
        for (const [id, gun] of this.#guns) {
            if (standing.has(id)) continue;
            for (const view of [gun.barrel, gun.back, gun.bar]) view.destroy();
            this.#guns.delete(id);
        }
        for (const {id, cooldown} of guns) {
            const building = buildings.find((b) => b.id === id);
            const gun = this.#guns.get(id) ?? this.#addGun(building);
            gun.barrel.setRotation(gun.facing).setAlpha(building.enabled ? 1 : 0.35);
            gun.bar.setSize(gun.width * (1 - cooldown / reloadTicks), RELOAD_BAR.height);
        }
        this.#syncShells(shells);
        this.#impacts = this.#impacts.filter((impact) => {
            const age = (tick - impact.tick) / IMPACT_TICKS;
            if (isNight && age <= 1) {
                impact.view.setScale(1 + IMPACT_GROWTH * age).setAlpha(1 - age);
                return true;
            }
            impact.view.destroy();
            return false;
        });
    }

    /** Rendered guns, shells and impacts, for QA. */
    views() {
        return {
            guns: [...this.#guns].map(([id, {barrel, bar}]) => ({id, x: barrel.x, y: barrel.y, rotation: barrel.rotation, reload: bar.width})),
            shells: [...this.#shells].map(([id, {view, mark}]) => ({id, visible: view.visible, x: view.x, y: view.y, markX: mark.x, markY: mark.y})),
            impacts: this.#impacts.map(({view}) => ({x: view.x, y: view.y})),
        };
    }

    #syncShells(shells) {
        const inFlight = new Set(shells.map(({id}) => id));
        for (const [id, {view, mark}] of this.#shells) {
            if (inFlight.has(id)) continue;
            view.destroy();
            mark.destroy();
            this.#shells.delete(id);
        }
        for (const {id, fromX, fromY, x, y, flightTicks, ticksLeft} of shells) {
            const shell = this.#shells.get(id) ?? this.#addShell(id, x, y);
            const flown = 1 - ticksLeft / flightTicks;
            shell.view.setPosition(fromX + (x - fromX) * flown, fromY + (y - fromY) * flown);
        }
    }

    #addShell(id, x, y) {
        const shell = {
            view: this.#scene.add.circle(x, y, SHELL_RADIUS, SHELL_COLOR).setStrokeStyle(2, SHELL_STROKE).setDepth(SHELL_DEPTH),
            mark: this.#scene.add.circle(x, y, MARK_RADIUS).setStrokeStyle(2, MARK_COLOR, MARK_ALPHA).setDepth(LAYER_DEPTH),
        };
        this.#shells.set(id, shell);
        return shell;
    }

    #addGun(building) {
        const {x, y, width, height} = this.#grid.footprintRect(building);
        const center = this.#centerOf(building);
        const barWidth = width - 2 * RELOAD_BAR.inset;
        const barY = y + height - RELOAD_BAR.inset - RELOAD_BAR.height;
        const gun = {
            barrel: this.#scene.add.rectangle(center.x, center.y, BARREL_SIZE.width, BARREL_SIZE.height, BARREL_COLOR).setOrigin(0, 0.5).setDepth(LAYER_DEPTH),
            back: this.#scene.add.rectangle(x + RELOAD_BAR.inset, barY, barWidth, RELOAD_BAR.height, RELOAD_BAR.back).setOrigin(0, 0).setDepth(LAYER_DEPTH),
            bar: this.#scene.add.rectangle(x + RELOAD_BAR.inset, barY, barWidth, RELOAD_BAR.height, RELOAD_BAR.color).setOrigin(0, 0).setDepth(LAYER_DEPTH),
            facing: DEFAULT_FACING,
            width: barWidth,
        };
        this.#guns.set(building.id, gun);
        return gun;
    }

    #centerOf(building) {
        const {x, y, width, height} = this.#grid.footprintRect(building);
        return {x: x + width / 2, y: y + height / 2};
    }
}
