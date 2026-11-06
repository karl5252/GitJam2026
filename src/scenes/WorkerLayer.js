import {stackOffsets} from './InfantryLayer.js';

const DEPTH = 6;
const FLAG_DEPTH = 5;
const BODY_RADIUS = 5;
const BODY_COLOR = 0xffd54f;
const BODY_STROKE = 0x4e342e;
const HAT_SIZE = {width: 8, height: 3};
const HAT_COLOR = 0xff6f00;
const HP_BAR = {width: 12, height: 3, offset: 10};
const HP_BAR_COLOR = 0x66bb6a;
const DEATH_TICKS = 30;
const DEATH_STYLE = {fontFamily: 'monospace', fontSize: '20px', color: '#ef5350'};
const FLAG_COLOR = 0xffb300;
const FLAG_BLOCKED_COLOR = 0xe53935;
const FLAG_IDLE_ALPHA = 0.55;
const POLE_COLOR = 0xeceff1; // light, because it often stands in the dark of unexplored ground
const RING_RADIUS = 15;

/**
 * Workers and the work flag. A worker is a small yellow circle in an orange hard hat,
 * against the soldiers' diamonds and the mutants' plain circles. The flag is an amber
 * pennant, so it cannot be taken for a Barracks' blue one. Selecting HQ brightens it
 * and joins the two with a line. Presentation only: it receives detached snapshots.
 */
export class WorkerLayer {
    #scene;
    #grid;
    #workers = new Map(); // worker id -> {body, hat, hp, last}
    #deaths = []; // {view, tick}
    #graphics;
    #flagView = null;
    #lost = 0;

    constructor(scene, grid) {
        this.#scene = scene;
        this.#grid = grid;
        this.#graphics = scene.add.graphics().setDepth(FLAG_DEPTH);
    }

    /** Every frame. */
    sync({workers, lost, maxHp, tick, isNight}) {
        const alive = new Set(workers.map(({id}) => id));
        let died = lost - this.#lost; // anyone else who has gone went inside
        this.#lost = lost;
        for (const [id, view] of this.#workers) {
            if (alive.has(id)) continue;
            if (died-- > 0) this.#markDeath(view.last, tick);
            for (const part of [view.body, view.hat, view.hp]) part.destroy();
            this.#workers.delete(id);
        }
        const offsets = stackOffsets(workers);
        workers.forEach((worker, i) => this.#syncWorker(worker, offsets[i], maxHp));
        this.#deaths = this.#deaths.filter((death) => {
            if (isNight && tick - death.tick <= DEATH_TICKS) return true;
            death.view.destroy();
            return false;
        });
    }

    /** Only when the flag, the walls or the selection have changed. */
    syncFlag(route, selected) {
        this.#graphics.clear();
        this.#flagView = null;
        if (!route?.flag) return;
        const {flag, exit, blocked} = route;
        const {x, y} = this.#grid.cellCenter(flag.col, flag.row);
        const color = blocked ? FLAG_BLOCKED_COLOR : FLAG_COLOR;
        const alpha = selected ? 1 : FLAG_IDLE_ALPHA;
        if (selected) {
            const from = this.#grid.cellCenter(exit.col, exit.row);
            this.#graphics.lineStyle(2, color, 0.8).lineBetween(from.x, from.y, x, y);
        }
        this.#graphics.lineStyle(2, color, alpha).strokeCircle(x, y, RING_RADIUS);
        this.#graphics.lineStyle(3, POLE_COLOR, 1).lineBetween(x - 8, y + 14, x - 8, y - 15);
        this.#graphics.fillStyle(color, Math.max(alpha, 0.8)).fillTriangle(x - 7, y - 15, x + 15, y - 7, x - 7, y + 1);
        if (blocked) this.#graphics.lineStyle(3, FLAG_BLOCKED_COLOR, 1).lineBetween(x - 12, y - 12, x + 12, y + 12).lineBetween(x + 12, y - 12, x - 12, y + 12);
        this.#flagView = {col: flag.col, row: flag.row, x, y, color, alpha, blocked};
    }

    /** Rendered workers, deaths and the flag, for QA. */
    views() {
        return {
            workers: [...this.#workers].map(([id, {body, hat, hp}]) => ({
                id, visible: body.visible, x: body.x, y: body.y, radius: body.radius, hatColor: hat.fillColor, hpVisible: hp.visible,
            })),
            deaths: this.#deaths.map(({view}) => ({x: view.x, y: view.y})),
            flag: this.#flagView,
        };
    }

    #syncWorker({id, x: domainX, y: domainY, hp}, [dx, dy], maxHp) {
        const view = this.#workers.get(id) ?? this.#addWorker(id);
        const x = domainX + dx;
        const y = domainY + dy;
        view.last = {x, y};
        view.body.setPosition(x, y);
        view.hat.setPosition(x, y - BODY_RADIUS + 1);
        view.hp.setPosition(x - HP_BAR.width / 2, y - HP_BAR.offset)
            .setSize(HP_BAR.width * hp / maxHp, HP_BAR.height)
            .setVisible(hp < maxHp);
    }

    #addWorker(id) {
        const view = {
            body: this.#scene.add.circle(0, 0, BODY_RADIUS, BODY_COLOR).setStrokeStyle(2, BODY_STROKE).setDepth(DEPTH),
            hat: this.#scene.add.rectangle(0, 0, HAT_SIZE.width, HAT_SIZE.height, HAT_COLOR).setDepth(DEPTH),
            hp: this.#scene.add.rectangle(0, 0, HP_BAR.width, HP_BAR.height, HP_BAR_COLOR).setOrigin(0, 0).setDepth(DEPTH),
            last: null,
        };
        this.#workers.set(id, view);
        return view;
    }

    #markDeath({x, y}, tick) {
        const view = this.#scene.add.text(x, y, '×', DEATH_STYLE).setOrigin(0.5).setDepth(DEPTH);
        this.#deaths.push({view, tick});
    }
}
