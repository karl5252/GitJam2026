import {getBuildingType} from '../core/buildingTypes.js';
import {BRUTE, MUTANT, SPITTER} from '../core/mutants.js';
import {addArt, mutantMeleeFrame, placeArt, spitterSpitFrame, walkFrame} from './SpriteArt.js';
import {Facing, attackFocus, flipFor, nextFacing} from './mutantFacing.js';

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
const BRUTE_RADIUS = 15; // an octagon about 30 px across, 16 CSS px at 844x390
const BRUTE_COLOR = 0xff6f00;
const BRUTE_STROKE = 0x3e1c00;
const BRUTE_STROKE_WIDTH = 3;
const BRUTE_SWELL = 0.25; // winding up a blow
const BRUTE_BAR = {width: 32, height: 5, offset: 22, back: 0x212121};
const DEATH_TICKS = 30;
const DEATH_STYLE = {fontFamily: 'monospace', fontSize: '24px', color: '#c6ff00'};

/**
 * Graybox drawing for mutants, shells and damaged buildings. Presentation only: it
 * receives detached domain snapshots and holds no gameplay state.
 *
 * Mutants differ by shape, not just colour: a circle, or a triangle for a Spitter.
 * A Spitter swells and draws a line to its fixed aim point during its telegraph,
 * and with its last shot gone it turns over and goes dull, which is the warning
 * that it is coming in. A Brute is a large octagon that always shows its HP, and it
 * swells as it winds up a blow, with a ring when the blow lands.
 */
export class MutantLayer {
    #scene;
    #grid;
    #mutantViews = new Map();
    #runnerArt = new Map();
    #runners = new Map(); // id -> {x, y, facing}
    #spitters = new Map(); // id -> {view, line, spent, x, y, facing}
    #brutes = new Map(); // id -> {view, back, bar, timer, x, y, facing}
    #shells = new Map();
    #impacts = []; // {view, tick}
    #deaths = []; // {view, tick}
    #hpBars = new Map();

    #world = {byId: new Map(), rectOf: () => null};

    constructor(scene, grid) {
        this.#scene = scene;
        this.#grid = grid;
    }

    /** Match the views to the current mutants, shells and buildings. */
    sync(mutants, buildings, {shells = [], tick = 0, isNight = false, isSeen = null, trucks = [], units = []} = {}) {
        const spitters = mutants.filter(({kind}) => kind === SPITTER.kind);
        const brutes = mutants.filter(({kind}) => kind === BRUTE.kind);
        this.#world = {
            byId: new Map(buildings.map((building) => [building.id, building])),
            rectOf: (building) => this.#grid.footprintRect(building),
            trucks,
            units,
            tileSize: this.#grid.tileSize,
        };
        this.#syncMutants(mutants.filter(({kind}) => kind === undefined), tick);
        this.#syncSpitters(spitters, tick, isNight);
        this.#syncBrutes(brutes, tick, isNight);
        this.#syncShells(shells);
        this.#syncFading(tick, isNight);
        this.#syncHpBars(buildings);
        if (isSeen) this.#conceal(isSeen);
    }

    /** Fog dims what it covers without hiding it, so nothing the enemy does may show on a tile not being watched. */
    #conceal(isSeen) {
        for (const [id, view] of this.#mutantViews) {
            const seen = isSeen(view);
            view.setVisible(seen);
            this.#runnerArt.get(id)?.sprite.setVisible(seen);
        }
        for (const {view, line, art} of this.#spitters.values()) {
            const seen = isSeen(view);
            view.setVisible(seen);
            art?.setVisible(seen);
            line.setVisible(line.visible && seen);
        }
        for (const {view, back, bar, art} of this.#brutes.values()) {
            const seen = isSeen(view);
            for (const part of [view, back, bar, art]) part?.setVisible(seen);
        }
        for (const view of this.#shells.values()) view.setVisible(isSeen(view));
        for (const {view} of [...this.#impacts, ...this.#deaths]) view.setVisible(isSeen(view));
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
                facing: this.#runners.get(id)?.facing, flipX: this.#runnerArt.get(id)?.sprite.flipX ?? null,
            })),
            ...[...this.#spitters].map(([id, {view, line, spent, art, facing}]) => ({
                id,
                facing,
                flipX: art?.flipX ?? null,
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
            ...[...this.#brutes].map(([id, {view, bar, art, facing}]) => ({
                id,
                facing,
                flipX: art?.flipX ?? null,
                kind: BRUTE.kind,
                visible: view.visible,
                x: view.x,
                y: view.y,
                radius: BRUTE_RADIUS,
                scale: view.scaleX,
                fillColor: view.fillColor,
                hpBarWidth: bar.width,
                hpBarVisible: bar.visible,
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

    #syncMutants(mutants, tick) {
        const alive = new Set(mutants.map((mutant) => mutant.id));
        for (const [id, view] of this.#mutantViews) {
            if (alive.has(id)) continue;
            view.destroy();
            this.#runnerArt.get(id)?.sprite.destroy();
            this.#runnerArt.delete(id);
            this.#runners.delete(id);
            this.#mutantViews.delete(id);
        }
        for (const mutant of mutants) {
            const {id, x, y} = mutant;
            let view = this.#mutantViews.get(id);
            if (!view) {
                view = this.#scene.add.circle(x, y, MUTANT_RADIUS, MUTANT_COLOR).setDepth(MUTANT_DEPTH);
                this.#mutantViews.set(id, view);
                const art = addArt(this.#scene, 'runner', MUTANT_DEPTH + 0.1);
                if (art) {
                    this.#runnerArt.set(id, {sprite: art});
                    view.setAlpha(0);
                }
                this.#runners.set(id, {x, y, facing: this.#initialFacing(mutant), timer: mutant.attackTimer});
            }
            view.setPosition(x, y);
            const state = this.#runners.get(id);
            const moving = this.#turn(state, mutant);
            const struck = mutant.attackTimer > state.timer;
            state.timer = mutant.attackTimer;
            const art = this.#runnerArt.get(id);
            if (art) {
                const frame = mutantMeleeFrame(state.attacking || (struck && !moving), mutant.attackTimer, MUTANT.attackCooldownTicks);
                art.sprite.setFrame(frame ?? walkFrame(moving, tick, 6)).setFlipX(flipFor('runner', state.facing));
                placeArt(art.sprite, 'runner', x, y);
            }
        }
    }

    #syncSpitters(spitters, tick, isNight) {
        const alive = new Set(spitters.map(({id}) => id));
        for (const [id, spitter] of this.#spitters) {
            if (alive.has(id)) continue;
            if (isNight) this.#addDeath(spitter, tick, 'spitter');
            spitter.view.destroy();
            spitter.art?.destroy();
            spitter.line.destroy();
            this.#spitters.delete(id);
        }
        for (const mutant of spitters) {
            const spitter = this.#spitters.get(mutant.id) ?? this.#addSpitter(mutant);
            const spent = mutant.shots === 0;
            if (spent && !spitter.spent) this.#addRing(mutant.x, mutant.y, SPITTER_SPENT_COLOR, tick);
            spitter.spent = spent;
            const moving = this.#turn(spitter, mutant);
            this.#drawSpitter(spitter, mutant, tick, moving);
        }
    }

    #syncBrutes(brutes, tick, isNight) {
        const alive = new Set(brutes.map(({id}) => id));
        for (const [id, brute] of this.#brutes) {
            if (alive.has(id)) continue;
            if (isNight) this.#addDeath(brute, tick, 'brute');
            for (const view of [brute.view, brute.back, brute.bar, brute.art]) view?.destroy();
            this.#brutes.delete(id);
        }
        for (const mutant of brutes) {
            const brute = this.#brutes.get(mutant.id) ?? this.#addBrute(mutant);
            const {x, y, hp, attackTimer} = mutant;
            const struck = attackTimer > brute.timer;
            const moving = this.#turn(brute, mutant);
            if (struck) this.#addRing(x, y, BRUTE_COLOR, tick); // a blow landed since the last frame
            brute.timer = attackTimer;
            brute.view.setPosition(x, y).setScale(1 + BRUTE_SWELL * (1 - attackTimer / BRUTE.attackCooldownTicks));
            if (brute.art) {
                const frame = mutantMeleeFrame(brute.attacking || (struck && !moving), attackTimer, BRUTE.attackCooldownTicks);
                brute.art.setFrame(frame ?? walkFrame(moving, tick, 6)).setFlipX(flipFor('brute', brute.facing));
                placeArt(brute.art, 'brute', x, y);
            }
            const left = x - BRUTE_BAR.width / 2;
            brute.back.setPosition(left, y - BRUTE_BAR.offset);
            brute.bar.setPosition(left, y - BRUTE_BAR.offset).setSize(BRUTE_BAR.width * hp / BRUTE.maxHp, BRUTE_BAR.height);
        }
    }

    #addBrute(mutant) {
        const {id, attackTimer} = mutant;
        const view = this.#scene.add.star(0, 0, 4, BRUTE_RADIUS, BRUTE_RADIUS, BRUTE_COLOR)
            .setStrokeStyle(BRUTE_STROKE_WIDTH, BRUTE_STROKE)
            .setDepth(MUTANT_DEPTH);
        const art = addArt(this.#scene, 'brute', MUTANT_DEPTH + 0.1);
        if (art) view.setAlpha(0);
        const back = this.#scene.add.rectangle(0, 0, BRUTE_BAR.width, BRUTE_BAR.height, BRUTE_BAR.back).setOrigin(0, 0.5).setDepth(MUTANT_DEPTH);
        const bar = this.#scene.add.rectangle(0, 0, BRUTE_BAR.width, BRUTE_BAR.height, HP_BAR_COLOR).setOrigin(0, 0.5).setDepth(MUTANT_DEPTH);
        const brute = {view, art, back, bar, timer: attackTimer, x: mutant.x, y: mutant.y, facing: this.#initialFacing(mutant)};
        this.#brutes.set(id, brute);
        return brute;
    }

    #addSpitter(mutant) {
        const {id} = mutant;
        const half = SPITTER_SIZE / 2;
        const view = this.#scene.add.triangle(0, 0, 0, SPITTER_SIZE, half, 0, SPITTER_SIZE, SPITTER_SIZE, SPITTER_COLOR)
            .setStrokeStyle(SPITTER_STROKE_WIDTH, SPITTER_STROKE)
            .setDepth(MUTANT_DEPTH);
        const art = addArt(this.#scene, 'spitter', MUTANT_DEPTH + 0.1);
        if (art) view.setAlpha(0);
        const line = this.#scene.add.rectangle(0, 0, 1, AIM_LINE_HEIGHT, SPITTER_AIM_COLOR, AIM_LINE_ALPHA)
            .setOrigin(0, 0.5)
            .setDepth(MUTANT_DEPTH)
            .setVisible(false);
        const spitter = {view, art, line, spent: false, x: mutant.x, y: mutant.y, facing: this.#initialFacing(mutant)};
        this.#spitters.set(id, spitter);
        return spitter;
    }

    #drawSpitter({view, art, line, spent, facing}, {x, y, aim, attackTimer, shots}, tick, moving) {
        const windup = aim ? 1 - attackTimer / SPITTER.windupTicks : 0;
        const fillAlpha = spent ? 1 : SPITTER_MIN_FILL_ALPHA + (1 - SPITTER_MIN_FILL_ALPHA) * shots / SPITTER.maxShots;
        const color = spent ? SPITTER_SPENT_COLOR : aim ? SPITTER_AIM_COLOR : SPITTER_COLOR;
        if (art) {
            art.setFrame(spent ? 16 : spitterSpitFrame(aim, attackTimer, SPITTER.windupTicks) ?? walkFrame(moving, tick, 6));
            art.setTint(spent ? 0x777744 : 0xffffff).setFlipX(flipFor('spitter', facing));
            placeArt(art, 'spitter', x, y);
        }
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

    /**
     * Update a view's facing from its record and remember where it stood.
     * @returns {boolean} whether it moved since the last frame
     */
    #turn(state, mutant) {
        const dx = mutant.x - state.x;
        const moving = Math.abs(dx) + Math.abs(mutant.y - state.y) > 0.1;
        const focus = attackFocus(mutant, this.#world);
        state.attacking = !moving && Boolean(focus);
        state.facing = nextFacing(state.facing, {x: mutant.x, dx, focus});
        state.x = mutant.x;
        state.y = mutant.y;
        return moving;
    }

    /** A new mutant looks towards its target, or right, the way the art is drawn. */
    #initialFacing(mutant) {
        const target = this.#world.byId.get(mutant.targetId);
        const rect = target ? this.#world.rectOf(target) : null;
        const focus = rect ? {x: Math.min(Math.max(mutant.x, rect.x), rect.x + rect.width)} : null;
        return nextFacing(Facing.RIGHT, {x: mutant.x, dx: 0, focus});
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

    #addDeath({x, y, facing}, tick, kind) {
        const art = addArt(this.#scene, kind, SHELL_DEPTH);
        const view = art ?? this.#scene.add.text(x, y, '×', DEATH_STYLE).setOrigin(0.5).setDepth(SHELL_DEPTH);
        if (art) art.setFrame(19).setPosition(x, y).setFlipX(flipFor(kind, facing)); // falls the way it faced
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
