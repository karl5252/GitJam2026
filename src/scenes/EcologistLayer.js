import {addArt, placeArt} from './SpriteArt.js';

const DEPTH = 6; // with the workers: over the night tint and fog edge, under HP bars
const SITE_DEPTH = 2.3; // the blocked road, under trucks' riders but over the road
const BODY = {radius: 5, color: 0xffffff, stroke: 0x2e7d32}; // shown only if the sheet is missing
const SITE_COLOR = 0xe53935;
const SITE_ALPHA = 0.85;

// ecologist.png: 4 x 4 frames of 45 x 40 with 5 px between them.
//   0-1 idle, 4-5 walk, 8-11 protest (placard), 12-13 hit and down.
const IDLE = [0, 1];
const WALK = [4, 5];
const PROTEST = [8, 9, 10, 11];
const DEATH = Object.freeze({hit: 12, down: 13, hitTicks: 18});
const WALK_TICKS = 10;
const FLEE_TICKS = 4; // the same walk, frantic
const PROTEST_TICKS = 12;
const IDLE_TICKS = 30;

const loop = (frames, tick, every) => frames[Math.floor(tick / every) % frames.length];

/**
 * What an ecologist's sprite shows for its state. Pure, so tests can check it.
 * @param {{state: string, timer?: number}} ecologist timer counts a corpse's ticks down
 * @param {boolean} moving
 * @param {number} tick simulation tick
 * @param {number} corpseTicks the domain's ECOLOGIST.corpseTicks
 */
export function ecologistFrame({state, timer = 0}, moving, tick, corpseTicks) {
    if (state === 'dead') return corpseTicks - timer < DEATH.hitTicks ? DEATH.hit : DEATH.down;
    if (state === 'protesting') return loop(PROTEST, tick, PROTEST_TICKS);
    if (state === 'fleeing') return moving ? loop(WALK, tick, FLEE_TICKS) : loop(IDLE, tick, IDLE_TICKS);
    return moving ? loop(WALK, tick, WALK_TICKS) : loop(IDLE, tick, IDLE_TICKS);
}

/**
 * Protesters, and a red outline on any road a protest is blocking. They face the
 * way they walk. The fog hides them like mutants. Presentation only: it receives
 * detached snapshots.
 */
export class EcologistLayer {
    #scene;
    #grid;
    #views = new Map(); // id -> {art, body, last, frame, flip}
    #sites;
    #siteViews = [];

    constructor(scene, grid) {
        this.#scene = scene;
        this.#grid = grid;
        this.#sites = scene.add.graphics().setDepth(SITE_DEPTH);
    }

    /** @param {{ecologists, blocked}} snapshot @param {{tick, corpseTicks, isSeen}} options */
    sync({ecologists, blocked}, {tick, corpseTicks, isSeen = null}) {
        const standing = new Set(ecologists.map(({id}) => id));
        for (const [id, view] of this.#views) {
            if (standing.has(id)) continue;
            view.art?.destroy();
            view.body.destroy();
            this.#views.delete(id);
        }
        for (const ecologist of ecologists) {
            const view = this.#views.get(ecologist.id) ?? this.#add(ecologist.id);
            const {x, y} = ecologist;
            const moving = view.last !== null && (view.last.x !== x || view.last.y !== y);
            if (moving && view.last.x !== x) view.flip = x < view.last.x;
            view.last = {x, y};
            view.frame = ecologistFrame(ecologist, moving, tick, corpseTicks);
            view.visible = isSeen ? isSeen(ecologist) : true;
            view.state = ecologist.state;
            view.body.setPosition(x, y).setVisible(view.visible && !view.art);
            if (view.art) {
                placeArt(view.art, 'ecologist', x, y);
                view.art.setFrame(view.frame).setFlipX(view.flip).setVisible(view.visible);
            }
        }
        this.#syncSites(blocked);
    }

    #syncSites(blocked) {
        const key = blocked.map(({col, row}) => `${col},${row}`).join('|');
        if (key === this.#siteViews.key) return;
        this.#sites.clear();
        this.#siteViews = blocked.map(({col, row}) => {
            const {x, y, width, height} = this.#grid.footprintRect({col, row, width: 1, height: 1});
            this.#sites.lineStyle(2, SITE_COLOR, SITE_ALPHA).strokeRect(x + 1, y + 1, width - 2, height - 2);
            return {col, row};
        });
        this.#siteViews.key = key;
    }

    #add(id) {
        const art = addArt(this.#scene, 'ecologist', DEPTH + 0.1);
        const body = this.#scene.add.circle(0, 0, BODY.radius, BODY.color).setStrokeStyle(2, BODY.stroke).setDepth(DEPTH);
        const view = {art, body, last: null, frame: 0, flip: false, visible: true, state: null};
        this.#views.set(id, view);
        return view;
    }

    /** QA: what is drawn. */
    views() {
        return {
            ecologists: [...this.#views].map(([id, {last, frame, flip, visible, state, art}]) => ({
                id, x: last?.x ?? null, y: last?.y ?? null, frame, flip, visible, state, art: Boolean(art),
            })),
            sites: this.#siteViews.map(({col, row}) => ({col, row})),
        };
    }
}
