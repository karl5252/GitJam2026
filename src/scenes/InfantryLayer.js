const SOLDIER_SIZE = 9; // a square turned 45 degrees: about 13 px across
const SOLDIER_COLOR = 0x81d4fa;
const SOLDIER_STROKE = 0x0d47a1;
const SOLDIER_DEPTH = 6;
const HP_BAR = {width: 14, height: 3, offset: 11};
const HP_BAR_COLOR = 0x66bb6a;
const TRACER_COLOR = 0x4dd0e1;
const TRACER_HEIGHT = 2;
const TRACER_TICKS = 6;
const DEATH_TICKS = 30;
const DEATH_COLOR = '#ef5350';
const FLAG_DEPTH = 5;
const FLAG_COLOR = 0x29b6f6;
const FLAG_BLOCKED_COLOR = 0xe53935;
const FLAG_IDLE_ALPHA = 0.55;
const LABEL_STYLE = {fontFamily: 'monospace', fontSize: '14px', color: '#ffffff'};
const PIP = {size: 6, gap: 2, inset: 3};
const PIP_COLOR = 0x81d4fa;
const PIP_STROKE = 0x212121;
const ROCKET_SOLDIER_COLOR = 0xffb74d;
const ROCKET_SOLDIER_SIZE = 11;
const ROCKET_SIZE = {width: 12, height: 4};
const ROCKET_COLOR = 0xff7043;
const ROCKET_STROKE = 0x3e2723;
const ROCKET_IMPACT_RADIUS = 10;
const ROCKET_IMPACT_TICKS = 12;
const ROCKET_MISS_COLOR = 0xb0bec5;
const STACK_OFFSETS = [[0, 0], [8, -8], [-8, 8], [8, 8], [-8, -8]];

/**
 * Soldiers closing on a target can stop on the same tile centre, and would read
 * as one. Where to draw each so that a stack can be counted, in list order. The
 * domain positions are untouched.
 * @returns {Array<[number, number]>} px, one per soldier
 */
export function stackOffsets(soldiers) {
    const seen = new Map();
    return soldiers.map(({x, y}) => {
        const key = `${x},${y}`;
        const count = seen.get(key) ?? 0;
        seen.set(key, count + 1);
        return STACK_OFFSETS[count % STACK_OFFSETS.length];
    });
}

/**
 * Soldiers, their tracers and health, rally flags and Barracks squad pips.
 * Presentation only: it receives detached snapshots, and its numbers, marks and
 * timings never affect gameplay.
 *
 * A Barracks and its flag share a number, kept for as long as the Barracks
 * stands. Selecting a Barracks brightens its flag and joins the two with a line.
 */
export class InfantryLayer {
    #scene;
    #grid;
    #soldiers = new Map(); // soldier id -> {body, hp, last}
    #tracers = new Map(); // soldier id -> {view, firedTick}
    #deaths = []; // {view, tick}
    #rockets = new Map(); // rocket id -> view
    #impacts = []; // {view, tick}
    #graphics;
    #marks = new Map(); // Barracks id -> {number, roof, flag, pips}
    #flagViews = [];

    constructor(scene, grid) {
        this.#scene = scene;
        this.#grid = grid;
        this.#graphics = scene.add.graphics().setDepth(FLAG_DEPTH);
    }

    /** Show a tracer for each of this tick's shots. */
    recordShots(shots, tick) {
        for (const {soldierId, fromX, fromY, x, y, rocket} of shots) {
            if (rocket) continue; // a rocket is its own view
            const tracer = this.#tracers.get(soldierId) ?? {
                view: this.#scene.add.rectangle(0, 0, 1, TRACER_HEIGHT, TRACER_COLOR).setOrigin(0, 0.5).setDepth(SOLDIER_DEPTH),
            };
            tracer.firedTick = tick;
            tracer.view.setPosition(fromX, fromY)
                .setSize(Math.hypot(x - fromX, y - fromY), TRACER_HEIGHT)
                .setRotation(Math.atan2(y - fromY, x - fromX))
                .setVisible(true);
            this.#tracers.set(soldierId, tracer);
        }
    }

    /** Show where this tick's rockets came down. */
    recordImpacts(impacts, tick) {
        for (const {x, y, mutantId} of impacts) {
            const view = this.#scene.add.circle(x, y, ROCKET_IMPACT_RADIUS).setStrokeStyle(3, mutantId ? ROCKET_COLOR : ROCKET_MISS_COLOR).setDepth(SOLDIER_DEPTH);
            this.#impacts.push({view, tick});
        }
    }

    /** Match the views to the living soldiers and rockets in flight. Runs every frame. */
    sync({soldiers, rockets = [], tick, isNight}) {
        this.#syncRockets(rockets);
        this.#impacts = this.#impacts.filter(({view, tick: landed}) => {
            const age = (tick - landed) / ROCKET_IMPACT_TICKS;
            if (isNight && age <= 1) {
                view.setScale(1 + age).setAlpha(1 - age);
                return true;
            }
            view.destroy();
            return false;
        });
        const alive = new Set(soldiers.map((soldier) => soldier.id));
        for (const [id, view] of this.#soldiers) {
            if (alive.has(id)) continue;
            if (isNight) this.#markDeath(view.last, tick); // at dawn they go home, they do not die
            view.body.destroy();
            view.hp.destroy();
            this.#soldiers.delete(id);
        }
        const offsets = stackOffsets(soldiers);
        soldiers.forEach((soldier, i) => this.#syncSoldier(soldier, offsets[i]));
        for (const [id, tracer] of this.#tracers) {
            tracer.view.setVisible(isNight && tick - tracer.firedTick <= TRACER_TICKS);
            if (alive.has(id)) continue;
            tracer.view.destroy();
            this.#tracers.delete(id);
        }
        this.#deaths = this.#deaths.filter((death) => {
            if (isNight && tick - death.tick <= DEATH_TICKS) return true;
            death.view.destroy();
            return false;
        });
        for (const [id, {pips}] of this.#marks) {
            const living = soldiers.filter((soldier) => soldier.barracksId === id).length;
            pips.forEach((pip, i) => pip.setVisible(i < living));
        }
    }

    /**
     * Redraw flags and Barracks marks. Only called when they change.
     * @param {Array<{id, exit, flag, post, blocked}>} posts
     * @param {Array<{id, col, row}>} barracks
     * @param {string|null} selectedId the Barracks the player is looking at
     */
    syncPosts(posts, barracks, selectedId) {
        const standing = new Set(barracks.map((building) => building.id));
        for (const [id, marks] of this.#marks) {
            if (standing.has(id)) continue;
            marks.roof.destroy();
            marks.flag.destroy();
            for (const pip of marks.pips) pip.destroy();
            this.#marks.delete(id);
        }
        for (const building of barracks) {
            if (!this.#marks.has(building.id)) this.#marks.set(building.id, this.#addMarks(building));
            const marks = this.#marks.get(building.id);
            marks.roof.setText(`${marks.number}${building.role ? 'R' : ''}`);
        }

        this.#graphics.clear();
        this.#flagViews = posts.map(({id, exit, flag, blocked}) => {
            const marks = this.#marks.get(id);
            const selected = id === selectedId;
            if (flag) this.#drawFlag(flag, exit, marks, {selected, blocked});
            else marks.flag.setVisible(false);
            return {id, number: marks.number, flag, blocked, selected, visible: flag !== null};
        });
    }

    /** The rendered soldiers, tracers, marks and flags, for QA. */
    views() {
        return {
            soldiers: [...this.#soldiers].map(([id, {body, hp}]) => ({
                id, x: body.x, y: body.y, visible: body.visible, fillColor: body.fillColor, hpVisible: hp.visible, hpWidth: hp.width,
            })),
            tracers: [...this.#tracers].map(([id, {view}]) => ({id, visible: view.visible, x: view.x, y: view.y, width: view.width})),
            deaths: this.#deaths.map(({view}) => ({x: view.x, y: view.y})),
            flags: this.#flagViews.map((view) => ({...view})),
            pips: Object.fromEntries([...this.#marks].map(([id, {pips}]) => [id, pips.filter((pip) => pip.visible).length])),
            rockets: [...this.#rockets].map(([id, view]) => ({id, visible: view.visible, x: view.x, y: view.y, rotation: view.rotation})),
            impacts: this.#impacts.map(({view}) => ({x: view.x, y: view.y})),
            roofs: Object.fromEntries([...this.#marks].map(([id, {roof}]) => [id, roof.text])),
        };
    }

    #syncRockets(rockets) {
        const inFlight = new Set(rockets.map(({id}) => id));
        for (const [id, view] of this.#rockets) {
            if (inFlight.has(id)) continue;
            view.destroy();
            this.#rockets.delete(id);
        }
        for (const {id, fromX, fromY, x, y, flightTicks, ticksLeft} of rockets) {
            let view = this.#rockets.get(id);
            if (!view) {
                view = this.#scene.add.rectangle(fromX, fromY, ROCKET_SIZE.width, ROCKET_SIZE.height, ROCKET_COLOR)
                    .setStrokeStyle(1, ROCKET_STROKE)
                    .setRotation(Math.atan2(y - fromY, x - fromX))
                    .setDepth(SOLDIER_DEPTH);
                this.#rockets.set(id, view);
            }
            const flown = 1 - ticksLeft / flightTicks;
            view.setPosition(fromX + (x - fromX) * flown, fromY + (y - fromY) * flown);
        }
    }

    #syncSoldier({id, x: domainX, y: domainY, hp, maxHp, role}, [dx, dy]) {
        const view = this.#soldiers.get(id) ?? this.#addSoldier(id, role);
        const x = domainX + dx;
        const y = domainY + dy;
        view.last = {x, y};
        view.body.setPosition(x, y);
        view.hp.setPosition(x - HP_BAR.width / 2, y - HP_BAR.offset)
            .setSize(HP_BAR.width * hp / maxHp, HP_BAR.height)
            .setVisible(hp < maxHp);
    }

    #addSoldier(id, role) {
        const size = role ? ROCKET_SOLDIER_SIZE : SOLDIER_SIZE;
        const view = {
            body: this.#scene.add.rectangle(0, 0, size, size, role ? ROCKET_SOLDIER_COLOR : SOLDIER_COLOR)
                .setStrokeStyle(2, SOLDIER_STROKE)
                .setRotation(Math.PI / 4)
                .setDepth(SOLDIER_DEPTH),
            hp: this.#scene.add.rectangle(0, 0, HP_BAR.width, HP_BAR.height, HP_BAR_COLOR).setOrigin(0, 0).setDepth(SOLDIER_DEPTH),
            last: null,
        };
        this.#soldiers.set(id, view);
        return view;
    }

    #markDeath({x, y}, tick) {
        const view = this.#scene.add.text(x, y, '×', {...LABEL_STYLE, fontSize: '20px', color: DEATH_COLOR})
            .setOrigin(0.5).setDepth(SOLDIER_DEPTH);
        this.#deaths.push({view, tick});
    }

    /** The lowest number not in use, so a replaced Barracks takes its number back. */
    #nextNumber() {
        const used = new Set([...this.#marks.values()].map(({number}) => number));
        let number = 1;
        while (used.has(number)) number++;
        return number;
    }

    #addMarks(building) {
        const number = this.#nextNumber();
        const {x, y, width, height} = this.#grid.footprintRect(building);
        const pips = Array.from({length: 4}, (_, i) => this.#scene.add
            .rectangle(x + PIP.inset + i * (PIP.size + PIP.gap), y + PIP.inset, PIP.size, PIP.size, PIP_COLOR)
            .setOrigin(0, 0)
            .setStrokeStyle(1, PIP_STROKE)
            .setDepth(FLAG_DEPTH)
            .setVisible(false));
        return {
            number,
            pips,
            roof: this.#scene.add.text(x + width / 2, y + height / 2, `${number}`, {...LABEL_STYLE, fontSize: '20px'}).setOrigin(0.5).setDepth(FLAG_DEPTH),
            flag: this.#scene.add.text(0, 0, `${number}`, LABEL_STYLE).setOrigin(0.5).setDepth(FLAG_DEPTH),
        };
    }

    #drawFlag(flag, exit, marks, {selected, blocked}) {
        const {x, y} = this.#grid.cellCenter(flag.col, flag.row);
        const color = blocked ? FLAG_BLOCKED_COLOR : FLAG_COLOR;
        const alpha = selected ? 1 : FLAG_IDLE_ALPHA;
        if (selected) {
            const from = this.#grid.cellCenter(exit.col, exit.row);
            this.#graphics.lineStyle(2, color, 0.7);
            this.#graphics.lineBetween(from.x, from.y, x, y);
        }
        this.#graphics.fillStyle(color, alpha);
        this.#graphics.fillRect(x - 9, y - 13, 2, 26);
        this.#graphics.fillTriangle(x - 7, y - 13, x + 11, y - 7, x - 7, y - 1);
        if (blocked) {
            this.#graphics.lineStyle(3, FLAG_BLOCKED_COLOR, 1);
            this.#graphics.lineBetween(x - 11, y - 11, x + 11, y + 11);
            this.#graphics.lineBetween(x + 11, y - 11, x - 11, y + 11);
        }
        marks.flag.setPosition(x + 1, y + 7).setAlpha(alpha).setVisible(true);
    }
}
