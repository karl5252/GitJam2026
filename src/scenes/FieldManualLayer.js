import {addProxy, markModal} from '../testShadow/TestProxy.js';
import {ATTRIBUTION, COVER_PORTRAIT, SHORT_TITLE, SUBTITLE, TITLE, contents, manualPages} from '../content/fieldManual.js';
import {ART, artKey} from './SpriteArt.js';
import {BUILD_ICON, fitArt} from './uiArt.js';
import {NEWSPAPER_PHOTOS} from './newspaperArt.js';

/**
 * TASK 033.1: THE LITTLE BANANA-YELLOW BOOK OF EL PRESIDENTE COLONEL PAPI, drawn from
 * src/content/fieldManual.js. Presentation only: it reads content and changes nothing.
 *
 * A banana-yellow cover round two cream pages: the cover page with the contents, then
 * each chapter page, text on the left, pictures, figures and the Presidential Wisdom on
 * the right. CONTENTS, PREV, NEXT and CLOSE along the bottom of the cover. A full-screen
 * dimmer takes every press, so nothing under the book can be reached while it is open.
 * The HUD holds the world while it is open (the `manual` suspension reason) and closes
 * it on Escape. Two templates, like La Voz: desktop, and touch with every text at least
 * 24 logical px and every control at least 88 px tall.
 *
 * Each page is redrawn whole when it is turned, as La Voz is: there is little on it.
 */

const DEPTH = 60; // over the main menu's title (50-52) and every HUD control
const SERIF = 'Georgia, "Times New Roman", Times, serif';
const MONO = 'monospace';
const INK = '#2f2b10'; // dark olive
const RED = '#8e1b12';
const COVER_INK = '#3a2f05';
const BANANA = 0xf2cf1d;
const BANANA_DARK = 0x9a7b0a;
const COVER_EDGE = 0x5a4708;
const PAPER = 0xf4e9c4;
const PAPER_SHADE = 0xe2d39d;
const PLATE = 0xe9dba8;
const RULE = 0x2f2b10;
const BUTTON = 0x4b4513;
const BUTTON_TEXT = '#f6dc4a';

const TEMPLATES = Object.freeze({
    desktop: {
        book: {x: 60, y: 22, width: 1160, height: 676},
        band: 44, footer: 88, edge: 14, spine: 12, pad: 26, paraGap: 10,
        size: {band: 20, kicker: 15, heading: 28, body: 18, table: 15, fact: 16, wisdomLabel: 14, wisdom: 17, caption: 13,
            button: 20, toc: 21, title: 32, subtitle: 19, pageLabel: 18},
        art: 92, portraitScale: 2, tocRow: 62, tocColumns: 1, button: {width: 180, height: 60},
    },
    touch: {
        book: {x: 6, y: 4, width: 1268, height: 712},
        band: 48, footer: 116, edge: 10, spine: 10, pad: 22, paraGap: 8,
        size: {band: 26, kicker: 24, heading: 32, body: 24, table: 24, fact: 24, wisdomLabel: 24, wisdom: 24, caption: 24,
            button: 30, toc: 28, title: 34, subtitle: 26, pageLabel: 26},
        // Contents as a grid of tall cells: 44 CSS px is 88 logical px at 740x360, where the canvas scales by 0.5.
        art: 92, portraitScale: 2, tocRow: 132, tocColumns: 2, button: {width: 230, height: 100},
    },
});

export class FieldManualLayer {
    #scene;
    #onChange; // (open) => void: the HUD holds the world while the book is open
    #onSound; // (event) => void
    #tips; // TASK 033.3: {state: () => advice state, set: (on) => void, reset: () => void}, or null
    #pages = manualPages();
    #contents = contents(this.#pages);
    #page = 0;
    #layout = null;
    #views = null;
    #plates = []; // the pictures on the page as drawn: kind, frame and the bounds they were fitted by

    constructor(scene, {onChange = null, sound = null, tips = null} = {}) {
        this.#scene = scene;
        this.#onChange = onChange;
        this.#onSound = sound;
        this.#tips = tips;
    }

    /** The page with this heading, or the cover: where a Presidential Advice tip's BOOK leads. */
    pageOf(heading) {
        return Math.max(0, this.#pages.findIndex((page) => page.heading === heading));
    }

    /** Draw the open page again, as it now stands: the TIPS switch follows the setting. */
    refresh() {
        if (this.open) this.#redraw();
    }

    get open() {
        return this.#views !== null;
    }

    get pageCount() {
        return this.#pages.length;
    }

    /** Open on a page (the cover by default). Opening an open book only turns to that page. */
    show({touch, page = 0}) {
        const wasOpen = this.open;
        this.#layout = touch ? 'touch' : 'desktop';
        this.#page = this.#clamp(page);
        this.#redraw();
        markModal(this.#scene, 'manual');
        if (!wasOpen) this.#onChange?.(true);
    }

    close() {
        if (!this.open) return;
        this.#destroyViews();
        if (document.body.dataset.modal === 'manual') delete document.body.dataset.modal;
        this.#onChange?.(false);
    }

    goTo(page) {
        if (!this.open) return;
        const next = this.#clamp(page);
        if (next === this.#page) return;
        this.#page = next;
        this.#onSound?.('ui.click');
        this.#redraw();
    }

    next() {
        this.goTo(this.#page + 1);
    }

    prev() {
        this.goTo(this.#page - 1);
    }

    #clamp(page) {
        return Math.min(Math.max(0, Math.trunc(page) || 0), this.#pages.length - 1);
    }

    #destroyViews() {
        if (!this.#views) return;
        for (const object of this.#views.objects) object.destroy();
        for (const proxy of this.#views.proxies) proxy.destroy();
        this.#views = null;
    }

    #redraw() {
        this.#destroyViews();
        this.#plates = [];
        this.#views = this.#draw(this.#pages[this.#page], TEMPLATES[this.#layout]);
    }

    #draw(page, t) {
        const scene = this.#scene;
        const objects = [];
        const texts = [];
        const proxies = [];
        const buttons = {};
        const keep = (o, d = 1) => {
            objects.push(o.setDepth(DEPTH + d));
            return o;
        };
        const {width: W, height: H} = scene.scale;
        const {book, size} = t;

        // The dimmer takes every press; the cover takes its own, so nothing falls through.
        keep(scene.add.rectangle(0, 0, W, H, 0x000000, 0.66).setOrigin(0, 0).setInteractive(), 0);
        keep(scene.add.rectangle(book.x, book.y, book.width, book.height, BANANA).setOrigin(0, 0)
            .setStrokeStyle(4, COVER_EDGE).setInteractive());
        const g = keep(scene.add.graphics(), 1.5);
        // A stamped double frame on the cover, inside its edge.
        g.lineStyle(2, BANANA_DARK, 1).strokeRect(book.x + 5, book.y + 5, book.width - 10, book.height - 10);

        const top = book.y + t.band;
        const bottom = book.y + book.height - t.footer;
        const pageWidth = (book.width - 2 * t.edge - t.spine) / 2;
        const sides = {
            left: {x: book.x + t.edge, y: top, width: pageWidth, height: bottom - top},
            right: {x: book.x + t.edge + pageWidth + t.spine, y: top, width: pageWidth, height: bottom - top},
        };
        for (const side of Object.values(sides)) {
            keep(scene.add.rectangle(side.x, side.y, side.width, side.height, PAPER).setOrigin(0, 0).setStrokeStyle(2, COVER_EDGE));
        }
        // The spine's shadow, darkest at the fold.
        g.fillStyle(PAPER_SHADE, 1).fillRect(sides.left.x + pageWidth - 10, top + 1, 10, bottom - top - 2);
        g.fillStyle(PAPER_SHADE, 1).fillRect(sides.right.x, top + 1, 10, bottom - top - 2);
        g.fillStyle(COVER_EDGE, 1).fillRect(sides.left.x + pageWidth, top, t.spine, bottom - top);

        const text = (side, x, y, content, fontSize, {font = SERIF, color = INK, style = 'normal', align = 'left', originX = 0, wrap = null} = {}) => {
            const o = keep(scene.add.text(x, y, content, {
                fontFamily: font, fontSize: `${fontSize}px`, color, fontStyle: style, align, lineSpacing: 4,
                ...(wrap ? {wordWrap: {width: wrap}} : {}),
            }).setOrigin(originX, 0), 2);
            texts.push({o, size: fontSize, side});
            return o;
        };

        // The band: the short title, stamped.
        text('cover', book.x + book.width / 2, book.y + (t.band - size.band) / 2 - 2, SHORT_TITLE, size.band,
            {color: COVER_INK, style: 'bold', originX: 0.5});

        const content = page.kind === 'contents'
            ? this.#cover(sides, t, {text, keep, g, proxies})
            : this.#chapter(page, sides, t, {text, keep, g});

        this.#footer(page, book, bottom, t, {text, keep, proxies, buttons});
        return {objects, texts, proxies, buttons, sides, content, page};
    }

    /** The cover page: the full title, the portrait, and the contents, each a button. */
    #cover({left, right}, t, {text, keep, g, proxies}) {
        const {size, pad} = t;
        const inner = left.width - 2 * pad;
        const cx = left.x + left.width / 2;
        let y = left.y + pad * 0.6;
        const title = text('left', cx, y, TITLE, size.title, {style: 'bold', align: 'center', originX: 0.5, wrap: inner});
        y += title.height + 10;
        const subtitle = text('left', cx, y, SUBTITLE, size.subtitle, {style: 'italic', align: 'center', originX: 0.5, wrap: inner});
        y += subtitle.height + 16;
        const key = NEWSPAPER_PHOTOS[COVER_PORTRAIT.asset]?.key ?? null;
        const loaded = key !== null && this.#scene.textures.exists(key);
        const source = loaded ? this.#scene.textures.get(key).getSourceImage() : {width: 64, height: 96};
        const [pw, ph] = [source.width * t.portraitScale, source.height * t.portraitScale];
        if (loaded) keep(this.#scene.add.image(cx, y, key).setOrigin(0.5, 0).setScale(t.portraitScale), 2);
        g.lineStyle(3, RULE, 1).strokeRect(cx - pw / 2 - 3, y - 3, pw + 6, ph + 6);
        y += ph + 10;
        text('left', cx, y, COVER_PORTRAIT.caption, size.caption, {style: 'bold', align: 'center', originX: 0.5, wrap: inner});

        let ry = right.y + pad * 0.6;
        const heading = text('right', right.x + pad, ry, 'CONTENTS', size.heading, {style: 'bold'});
        ry += heading.height + 8;
        g.fillStyle(RULE, 1).fillRect(right.x + pad, ry, right.width - 2 * pad, 3);
        ry += 12;
        const gap = 8;
        const cellWidth = (right.width - 2 * pad - (t.tocColumns - 1) * gap) / t.tocColumns;
        const cellHeight = t.tocRow - gap;
        const rows = this.#contents.map((entry, i) => {
            const x = right.x + pad + (i % t.tocColumns) * (cellWidth + gap);
            const y = ry + Math.floor(i / t.tocColumns) * t.tocRow;
            const rect = keep(this.#scene.add.rectangle(x, y, cellWidth, cellHeight, PLATE).setOrigin(0, 0)
                .setStrokeStyle(2, RULE).setInteractive({useHandCursor: true}), 1.8);
            rect.on('pointerdown', () => this.goTo(entry.page));
            const number = text('right', x + cellWidth - 12, y + cellHeight / 2 - size.toc / 2 - 2, `${entry.page}`, size.toc, {originX: 1});
            const label = text('right', x + 12, y, `${entry.numeral}.  ${entry.title}`, size.toc,
                {style: 'bold', wrap: cellWidth - 36 - number.width});
            label.setY(y + (cellHeight - label.height) / 2);
            const proxy = addProxy(this.#scene, rect, `manual-chapter-${entry.id}`, {label: `Chapter ${entry.numeral}: ${entry.title}`});
            proxy.set({page: entry.page});
            proxies.push(proxy);
            return {id: entry.id, page: entry.page, box: {x: rect.x, y: rect.y, width: rect.width, height: rect.height}};
        });
        return {rows};
    }

    /** A chapter page: the words on the left; pictures, figures and the Wisdom on the right. */
    #chapter(page, {left, right}, t, {text, keep, g}) {
        const {size, pad} = t;
        let inner = left.width - 2 * pad;
        let y = left.y + pad * 0.6;
        const kicker = text('left', left.x + pad, y, `CHAPTER ${page.numeral} · ${page.chapterTitle.toUpperCase()}`, size.kicker,
            {color: RED, style: 'bold', wrap: inner});
        y += kicker.height + 6;
        const heading = text('left', left.x + pad, y, page.heading, size.heading, {style: 'bold', wrap: inner});
        y += heading.height + 8;
        g.fillStyle(RULE, 1).fillRect(left.x + pad, y, inner, 3);
        g.fillStyle(RULE, 1).fillRect(left.x + pad, y + 6, inner, 1);
        y += 16;
        for (const paragraph of page.text) {
            const o = text('left', left.x + pad, y, paragraph, size.body, {wrap: inner});
            y += o.height + t.paraGap;
        }

        inner = right.width - 2 * pad;
        let ry = right.y + pad * 0.6;
        if (page.art.length > 0) {
            const slot = inner / page.art.length;
            const box = Math.min(t.art, slot - 12);
            let tallest = 0;
            page.art.forEach(({kind, frame, visible, caption}, i) => {
                const cx = right.x + pad + slot * (i + 0.5);
                keep(this.#scene.add.rectangle(cx, ry + box / 2, box, box, PLATE).setStrokeStyle(2, RULE), 1.8);
                const image = this.#art(kind, frame, visible, cx, ry + box / 2, box - 12);
                if (image) keep(image, 2);
                const label = text('right', cx, ry + box + 6, caption, size.caption, {style: 'bold', align: 'center', originX: 0.5, wrap: slot - 8});
                tallest = Math.max(tallest, box + 6 + label.height);
            });
            ry += tallest + 14;
        }
        if (page.table) {
            const columns = page.table.header.map((_, c) => Math.max(...[page.table.header, ...page.table.rows].map((row) => row[c].length)));
            const line = (row) => row.map((cell, c) => (c === 0 ? cell.padEnd(columns[c]) : cell.padStart(columns[c]))).join(' ');
            const header = text('right', right.x + pad, ry, line(page.table.header), size.table, {font: MONO, color: RED, style: 'bold'});
            ry += header.height + 2;
            g.fillStyle(RULE, 1).fillRect(right.x + pad, ry, Math.min(inner, header.width), 2);
            ry += 4;
            for (const row of page.table.rows) {
                const o = text('right', right.x + pad, ry, line(row), size.table, {font: MONO});
                ry += o.height + 2;
            }
            ry += 12;
        }
        for (const {label, value} of page.facts) {
            const o = text('right', right.x + pad, ry, label, size.fact, {font: MONO});
            text('right', right.x + right.width - pad, ry, value, size.fact, {font: MONO, style: 'bold', originX: 1});
            g.fillStyle(PAPER_SHADE, 1).fillRect(right.x + pad, ry + o.height, inner, 1);
            ry += o.height + 4;
        }
        if (page.facts.length > 0) ry += 10;
        if (page.wisdom.length > 0) {
            const boxPad = 12;
            const start = ry;
            const x = right.x + pad + boxPad + 6;
            const wrap = inner - 2 * boxPad - 6;
            const label = text('right', x, ry + boxPad, 'PRESIDENTIAL WISDOM', size.wisdomLabel, {color: RED, style: 'bold'});
            let qy = label.y + label.height + 4;
            for (const quote of page.wisdom) {
                const o = text('right', x, qy, `“${quote}”`, size.wisdom, {style: 'italic', wrap});
                qy = o.y + o.height + 6;
            }
            const by = text('right', right.x + right.width - pad - boxPad, qy, ATTRIBUTION, size.wisdomLabel, {style: 'bold', originX: 1});
            ry = by.y + by.height + boxPad;
            g.lineStyle(2, RULE, 1).strokeRect(right.x + pad, start, inner, ry - start);
            g.fillStyle(0x8e1b12, 1).fillRect(right.x + pad, start, 6, ry - start);
        }
        return {leftBottom: y, rightBottom: ry};
    }

    /**
     * An existing sprite fitted into a square plate by its visible pixels: the page's own
     * bounds for its frame, else the build icon's when it is the icon's frame, else the frame.
     */
    #art(kind, frame, visible, x, y, box) {
        const spec = ART[kind];
        const key = artKey(kind);
        if (!spec || !this.#scene.textures.exists(key)) return null;
        const icon = BUILD_ICON[kind];
        const bounds = visible ?? (icon && icon.frame === frame ? icon.visible : {x: 0, y: 0, width: spec.frameWidth, height: spec.frameHeight});
        // A whole-number scale on whole pixels, as La Voz's portrait: a fractional one lets
        // the quad's edge sample the next frame of the sheet, a stray dot beside the plate.
        const scale = Math.max(1, Math.floor(fitArt(bounds, spec, {width: box, height: box}).scale));
        const left = Math.round(x - (bounds.x + bounds.width / 2) * scale);
        const top = Math.round(y - (bounds.y + bounds.height / 2) * scale);
        const image = this.#scene.add.image(left, top, key, frame).setOrigin(0, 0).setScale(scale);
        this.#plates.push({kind, frame: image.frame.name, bounds: {...bounds}});
        return image;
    }

    /** CONTENTS, PREV, the page, NEXT and CLOSE, on the cover below the pages. Only what can be used is shown. */
    #footer(page, book, bottom, t, {text, keep, proxies, buttons}) {
        const {width: bw, height: bh} = t.button;
        const y = bottom + (book.y + book.height - bottom) / 2;
        const last = this.#pages.length - 1;
        const add = (id, label, action, x, onPress) => {
            const rect = keep(this.#scene.add.rectangle(x, y, bw, bh, BUTTON).setStrokeStyle(3, BANANA_DARK).setInteractive({useHandCursor: true}), 2);
            rect.on('pointerdown', onPress);
            text('cover', x, y - t.size.button / 2 - 2, label, t.size.button, {color: BUTTON_TEXT, style: 'bold', originX: 0.5});
            const proxy = addProxy(this.#scene, rect, action, {label});
            proxy.set({page: this.#page});
            proxies.push(proxy);
            buttons[id] = {x: rect.x - bw / 2, y: rect.y - bh / 2, width: bw, height: bh};
        };
        const leftX = book.x + 24 + bw / 2;
        const rightX = book.x + book.width - 24 - bw / 2;
        const middle = book.x + book.width / 2;
        if (page.kind !== 'contents') add('contents', 'CONTENTS', 'manual-contents', leftX, () => this.goTo(0));
        if (this.#page > 0) add('prev', '◀ PREV', 'manual-prev', middle - bw / 2 - 90, () => this.prev());
        if (this.#page < last) add('next', 'NEXT ▶', 'manual-next', middle + bw / 2 + 90, () => this.next());
        add('close', 'CLOSE', 'close-manual', rightX, () => {
            this.#onSound?.('ui.back');
            this.close();
        });
        // TASK 033.3: Presidential Advice's switches, in the cover's two free places.
        const tips = this.#tips?.state() ?? null;
        if (page.kind === 'contents' && tips) {
            add('tips', tips.setting ? 'TIPS: ON' : 'TIPS: OFF', 'manual-tips', leftX, () => this.#tips.set(!tips.setting));
            proxies.at(-1).set({enabled: tips.setting});
            add('tipsReset', 'RESET TIPS', 'manual-tips-reset', middle - bw / 2 - 90, () => this.#tips.reset());
            proxies.at(-1).set({seen: tips.seen.length});
        }
        const label = page.kind === 'contents' ? 'CONTENTS' : `${this.#page} / ${last}`;
        text('cover', middle, y - t.size.pageLabel / 2 - 2, label, t.size.pageLabel, {color: COVER_INK, style: 'bold', originX: 0.5});
    }

    /**
     * What QA sees. `overflow` lists every text that leaves its page (or the cover), so a
     * page with too much copy fails its test on either layout.
     */
    view() {
        if (!this.#views) return {open: false, pageCount: this.#pages.length};
        const {texts, sides, buttons, content, page} = this.#views;
        const book = TEMPLATES[this.#layout].book;
        const pad = TEMPLATES[this.#layout].pad;
        const overflow = [];
        for (const {o, side} of texts) {
            const b = o.getBounds();
            const area = side === 'cover' ? book : sides[side];
            const limitBottom = side === 'cover' ? area.y + area.height : area.y + area.height - pad / 2;
            if (b.x < area.x - 0.5 || b.y < area.y - 0.5 || b.right > area.x + area.width + 0.5 || b.bottom > limitBottom + 0.5) {
                overflow.push({side, text: o.text.slice(0, 40)});
            }
        }
        return {
            open: true,
            layout: this.#layout,
            page: this.#page,
            pageCount: this.#pages.length,
            kind: page.kind,
            chapter: page.chapter,
            heading: page.heading,
            minFontPx: Math.min(...texts.map(({size}) => size)),
            overflow,
            book: {...book},
            buttons: Object.fromEntries(Object.entries(buttons).map(([id, box]) => [id, {...box}])),
            contents: content.rows ?? null,
            art: this.#plates.map((plate) => ({...plate, bounds: {...plate.bounds}})),
            text: texts.filter(({side}) => side !== 'cover').map(({o}) => o.text),
        };
    }
}
