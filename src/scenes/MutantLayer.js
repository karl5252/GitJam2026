import {getBuildingType} from '../core/buildingTypes.js';
import {SPITTER} from '../core/mutants.js';

const MUTANT_RADIUS = 8;
const MUTANT_COLOR = 0xd81b60;
const MUTANT_DEPTH = 6;
const HP_BAR_COLOR = 0x66bb6a;
const HP_BAR_HEIGHT = 4;
const HP_BAR_INSET = 2;
const HP_BAR_DEPTH = 5;

const SPITTER_SIZE = 22; // about 12 CSS px at 844x390, against 9 for an ordinary mutant
const SPITTER_COLOR = 0xc6ff00;
const SPITTER_AIM_COLOR = 0xf4ff81;
const SPITTER_SPENT_COLOR = 0x827717;
const SPITTER_STROKE = 0x1b2a00;
const SPITTER_STROKE_WIDTH = 2;
const SPITTER_MIN_FILL_ALPHA = 0.5; // the fill thins as shots are used up
const SPITTER_AIM_SWELL = 0.4;
const AIM_LINE_HEIGHT = 3;
const AIM_LINE_ALPHA = 0.7;
const SHELL_SIZE = 8;
const SHELL_DEPTH = 7;
const IMPACT_TICKS = 14;
const IMPACT_RADIUS = 7;
const IMPACT_GROWTH = 2;
const IMPACT_STROKE = 3;
const IMPACT_MISS_COLOR = 0xb0bec5;
const DEATH_TICKS = 30;
const DEATH_STYLE = {fontFamily: 'monospace', fontSize: '24px', color: '#c6ff00'};

/**
 * Graybox drawing for mutants, shells and damaged buildings. Presentation only: it
 * receives detached domain snapshots and holds no gameplay state.
 *
 * Mutants differ by shape, not just colour: a circle, or a triangle for a Spitter.
 * A Spitter swells and draws a line to its fixed aim point during its telegraph,
 * and with its last shot gone it turns over and goes dull, which is the warning
 * that it is coming in.
 */
export class MutantLayer {
    #scene;
    #grid;
    #mutantViews = new Map();
    #spitters = new Map(); // id -> {view, line, spent, x, y}
    #shells = new Map();
    #impacts = []; // {view, tick}
    #deaths = []; // {view, tick}
    #hpBars = new Map();

    constructor(scene, grid) {
        this.#scene = scene;
        this.#grid = grid;
    }

    /** Match the views to the current mutants, shells and buildings. */
    sync(mutants, buildings, {shells = [], tick = 0, isNight = false} = {}) {
        const spitters = mutants.filter(({kind}) => kind === SPITTER.kind);
        this.#syncMutants(mutants.filter(({kind}) => kind !== SPITTER.kind));
        this.#syncSpitters(spitters, tick, isNight);
        this.#syncShells(shells);
        this.#syncFading(tick, isNight);
        this.#syncHpBars(buildings);
    }

    /** Show where this tick's shells came down. */
    recordImpacts(impacts, tick) {
        for (const {x, y, buildingId, soldierId} of impacts) {
            this.#addRing(x, y, buildingId || soldierId ? SPITTER_COLOR : IMPACT_MISS_COLOR, tick);
        }
    }

    /** Rendered mutant circles and Spitter triangles, for QA. */
    mutantViews() {
        return [
            ...[...this.#mutantViews].map(([id, view]) => ({
                id, visible: view.visible, x: view.x, y: view.y, radius: view.radius,
            })),
            ...[...this.#spitters].map(([id, {view, line, spent}]) => ({
                id,
                kind: SPITTER.kind,
                visible: view.visible,
                x: view.x,
                y: view.y,
                size: SPITTER_SIZE,
                scale: view.scaleX,
                fillColor: view.fillColor,
                fillAlpha: view.fillAlpha,
                spent,
                inverted: view.rotation !== 0,
                aiming: line.visible,
            })),
        ];
    }

    /** Rendered Spitter effects, for QA. */
    effectViews() {
        return {
            aimLines: [...this.#spitters.values()].filter(({line}) => line.visible)
                .map(({line}) => ({x: line.x, y: line.y, width: line.width, rotation: line.rotation})),
            shells: [...this.#shells].map(([id, view]) => ({id, visible: view.visible, x: view.x, y: view.y})),
            impacts: this.#impacts.map(({view}) => ({x: view.x, y: view.y, color: view.strokeColor})),
            deaths: this.#deaths.map(({view}) => ({x: view.x, y: view.y})),
        };
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

    #syncSpitters(spitters, tick, isNight) {
        const alive = new Set(spitters.map(({id}) => id));
        for (const [id, spitter] of this.#spitters) {
            if (alive.has(id)) continue;
            if (isNight) this.#addDeath(spitter, tick);
            spitter.view.destroy();
            spitter.line.destroy();
            this.#spitters.delete(id);
        }
        for (const mutant of spitters) {
            const spitter = this.#spitters.get(mutant.id) ?? this.#addSpitter(mutant);
            const spent = mutant.shots === 0;
            if (spent && !spitter.spent) this.#addRing(mutant.x, mutant.y, SPITTER_SPENT_COLOR, tick);
            spitter.spent = spent;
            spitter.x = mutant.x;
            spitter.y = mutant.y;
            this.#drawSpitter(spitter, mutant);
        }
    }

    #addSpitter({id}) {
        const half = SPITTER_SIZE / 2;
        const view = this.#scene.add.triangle(0, 0, 0, SPITTER_SIZE, half, 0, SPITTER_SIZE, SPITTER_SIZE, SPITTER_COLOR)
            .setStrokeStyle(SPITTER_STROKE_WIDTH, SPITTER_STROKE)
            .setDepth(MUTANT_DEPTH);
        const line = this.#scene.add.rectangle(0, 0, 1, AIM_LINE_HEIGHT, SPITTER_AIM_COLOR, AIM_LINE_ALPHA)
            .setOrigin(0, 0.5)
            .setDepth(MUTANT_DEPTH)
            .setVisible(false);
        const spitter = {view, line, spent: false, x: 0, y: 0};
        this.#spitters.set(id, spitter);
        return spitter;
    }

    #drawSpitter({view, line, spent}, {x, y, aim, attackTimer, shots}) {
        const windup = aim ? 1 - attackTimer / SPITTER.windupTicks : 0;
        const fillAlpha = spent ? 1 : SPITTER_MIN_FILL_ALPHA + (1 - SPITTER_MIN_FILL_ALPHA) * shots / SPITTER.maxShots;
        const color = spent ? SPITTER_SPENT_COLOR : aim ? SPITTER_AIM_COLOR : SPITTER_COLOR;
        view.setPosition(x, y)
            .setScale(1 + SPITTER_AIM_SWELL * windup)
            .setRotation(spent ? Math.PI : 0)
            .setFillStyle(color, aim ? 1 : fillAlpha);
        line.setVisible(Boolean(aim));
        if (!aim) return;
        line.setPosition(x, y)
            .setSize(Math.hypot(aim.x - x, aim.y - y), AIM_LINE_HEIGHT)
            .setRotation(Math.atan2(aim.y - y, aim.x - x));
    }

    #syncShells(shells) {
        const inFlight = new Set(shells.map(({id}) => id));
        for (const [id, view] of this.#shells) {
            if (inFlight.has(id)) continue;
            view.destroy();
            this.#shells.delete(id);
        }
        for (const {id, fromX, fromY, x, y, flightTicks, ticksLeft} of shells) {
            let view = this.#shells.get(id);
            if (!view) {
                view = this.#scene.add.rectangle(fromX, fromY, SHELL_SIZE, SHELL_SIZE, SPITTER_COLOR)
                    .setStrokeStyle(1, SPITTER_STROKE)
                    .setRotation(Math.PI / 4)
                    .setDepth(SHELL_DEPTH);
                this.#shells.set(id, view);
            }
            const flown = 1 - ticksLeft / flightTicks;
            view.setPosition(fromX + (x - fromX) * flown, fromY + (y - fromY) * flown);
        }
    }

    #addRing(x, y, color, tick) {
        const view = this.#scene.add.circle(x, y, IMPACT_RADIUS)
            .setStrokeStyle(IMPACT_STROKE, color)
            .setDepth(SHELL_DEPTH);
        this.#impacts.push({view, tick});
    }

    #addDeath({x, y}, tick) {
        const view = this.#scene.add.text(x, y, '×', DEATH_STYLE).setOrigin(0.5).setDepth(SHELL_DEPTH);
        this.#deaths.push({view, tick});
    }

    /** Rings grow as they fade and marks just fade, all counted in simulation ticks. */
    #syncFading(tick, isNight) {
        const fade = (list, ticks, draw) => list.filter((item) => {
            const age = tick - item.tick;
            if (isNight && age <= ticks) {
                draw(item.view, age / ticks);
                return true;
            }
            item.view.destroy();
            return false;
        });
        this.#impacts = fade(this.#impacts, IMPACT_TICKS, (view, age) => view.setScale(1 + IMPACT_GROWTH * age).setAlpha(1 - age));
        this.#deaths = fade(this.#deaths, DEATH_TICKS, (view, age) => view.setAlpha(1 - age));
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
