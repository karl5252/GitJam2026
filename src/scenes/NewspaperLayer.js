import {addProxy, markModal} from '../testShadow/TestProxy.js';
import {fitLines} from '../content/newspaper.js';
import {NEWSPAPER_PHOTOS} from './newspaperArt.js';

/**
 * TASK 029: LA VOZ DE SAN PAPI, drawn from an edition (src/content/newspaper.js).
 * Presentation only: it computes nothing and changes nothing. A full-screen dimmer
 * takes every press, so nothing under it can be reached while the paper is open;
 * only CONTINUE closes it (Escape is GameScene's, through the same command).
 * Two templates share one edition: a broadsheet on desktop, a front page on touch.
 */

const DEPTH = 18; // over every HUD control, under Game Over (20)
const SERIF = 'Georgia, "Times New Roman", Times, serif';
const MONO = 'monospace';
const INK = '#1b140c';
const RED = '#a31515';
const PAPER = 0xefe6cf;
const PAPER_EDGE = 0x3e2f1c;
const SPECKLE = 0x8d7b5a;
const RULE = 0x1b140c;
const BUTTON = 0x7f1d1d;

/** Where everything goes, in logical px. Touch text is at least 24 px: 12 CSS px at 740x360. */
const TEMPLATES = Object.freeze({
    desktop: {
        page: {x: 90, y: 30, width: 1100, height: 660},
        size: {date: 16, banner: 20, masthead: 64, motto: 16, kicker: 14, headline: 32, subhead: 18, body: 16, columnHead: 18, column: 15, figures: 18, footer: 15, button: 26},
        lead: {width: 740, photoScale: 2, bodyLines: 6},
        side: {width: 280},
        columns: {count: 3, chars: 30, lines: 4},
        advert: true,
        button: {width: 280, height: 72},
    },
    touch: {
        page: {x: 16, y: 8, width: 1248, height: 704},
        size: {date: 24, banner: 26, masthead: 76, motto: 24, kicker: 24, headline: 42, subhead: 26, body: 26, columnHead: 26, column: 24, figures: 28, footer: 24, button: 34},
        lead: {width: 780, photoScale: 3, bodyLines: 4, brief: true}, // TASK 034: the phone prints the story's brief
        side: {width: 390},
        columns: {count: 0},
        advert: false,
        button: {width: 340, height: 104},
    },
});

export class NewspaperLayer {
    #scene;
    #onContinue;
    #views = null;
    #state = null; // {edition, reason, layout}

    #makeSound;

    /** @param {{sound?: (spec, depth) => object | null}} [options] sound draws HUD's SOUND button (TASK 030) */
    constructor(scene, onContinue, {sound = null} = {}) {
        this.#scene = scene;
        this.#onContinue = onContinue;
        this.#makeSound = sound;
    }

    get open() {
        return this.#views !== null;
    }

    /** Draw the edition. Showing the same one again changes nothing. */
    show(edition, {reason, touch}) {
        const layout = touch ? 'touch' : 'desktop';
        if (this.#views && this.#state.edition === edition && this.#state.layout === layout) return;
        this.hide();
        this.#state = {edition, reason, layout};
        this.#views = this.#draw(edition, TEMPLATES[layout]);
        markModal(this.#scene, 'newspaper');
    }

    hide() {
        if (!this.#views) return;
        for (const object of this.#views.objects) object.destroy();
        this.#views.proxy?.destroy();
        if (this.#views.sound) {
            this.#views.sound.rect.destroy();
            this.#views.sound.label.destroy();
            this.#views.sound.proxy.destroy();
        }
        this.#views = null;
        if (document.body.dataset.modal === 'newspaper') delete document.body.dataset.modal;
    }

    #draw(e, t) {
        const scene = this.#scene;
        const objects = [];
        const texts = [];
        const regions = {}; // TASK 034: where each kind of text must stay, for QA's overflow check
        let region = 'page';
        const keep = (o) => {
            objects.push(o.setDepth(DEPTH + 1));
            return o;
        };
        const text = (x, y, content, size, {font = SERIF, color = INK, style = 'normal', align = 'left', originX = 0, wrap = null} = {}) => {
            const o = keep(scene.add.text(x, y, content, {
                fontFamily: font, fontSize: `${size}px`, color, fontStyle: style, align, ...(wrap ? {wordWrap: {width: wrap}} : {}),
            }).setOrigin(originX, 0));
            texts.push({o, size, region});
            return o;
        };
        const {width: W, height: H} = scene.scale;
        const {page, size} = t;
        regions.page = {x: page.x, right: page.x + page.width};

        // The dimmer takes every press; the paper and its speckles.
        const dimmer = scene.add.rectangle(0, 0, W, H, 0x000000, 0.62).setOrigin(0, 0).setDepth(DEPTH).setInteractive();
        objects.push(dimmer);
        keep(scene.add.rectangle(page.x, page.y, page.width, page.height, PAPER).setOrigin(0, 0).setStrokeStyle(3, PAPER_EDGE));
        const g = keep(scene.add.graphics());
        g.fillStyle(SPECKLE, 0.18);
        let seed = 7;
        for (let i = 0; i < 420; i++) {
            seed = (seed * 1103515245 + 12345) >>> 0;
            const sx = page.x + 6 + (seed % (page.width - 12));
            const sy = page.y + 6 + ((seed >>> 11) % (page.height - 12));
            g.fillRect(sx, sy, 1 + (seed >>> 29), 1);
        }
        const rule = (y, thick = 2) => g.fillStyle(RULE, 1).fillRect(page.x + 18, y, page.width - 36, thick);
        const left = page.x + 24;
        const right = page.x + page.width - 24;

        // Masthead.
        let y = page.y + 12;
        text(left, y, `${e.dateLine}`, size.date);
        text(page.x + page.width / 2, y - 2, e.banner, size.banner, {color: RED, style: 'bold', originX: 0.5});
        text(right, y, e.price, size.date, {originX: 1});
        y += size.date + 10;
        rule(y, 3);
        y += 6;
        const masthead = text(page.x + page.width / 2, y, e.masthead, size.masthead, {style: 'bold', originX: 0.5});
        y += size.masthead + 6;
        text(page.x + page.width / 2, y, e.motto, size.motto, {style: 'italic', originX: 0.5});
        y += size.motto + 10;
        rule(y, 4);
        rule(y + 7, 1);
        y += 18;

        // The lead: the photograph in a black frame with its caption, the story beside it;
        // the official figures beside both.
        const top = y;
        const sideX = right - t.side.width;
        regions.lead = {x: left, right: sideX - 14};
        regions.side = {x: sideX, right};
        region = 'lead';
        const photo = this.#photo(e.lead.photo, left, y, t.lead.photoScale, objects, g);
        const caption = text(left, photo.y + photo.height + 6, e.lead.photo.caption, Math.max(size.kicker, size.body - 4),
            {style: 'bold', wrap: photo.width, align: 'center'});
        caption.setX(left + (photo.width - caption.width) / 2);
        const tx = left + photo.width + 18;
        const textWidth = t.lead.width - photo.width - 18;
        let ty = y;
        text(tx, ty, e.lead.kicker, size.kicker, {color: RED, style: 'bold'});
        ty += size.kicker + 6;
        const headline = text(tx, ty, e.lead.headline, size.headline, {style: 'bold', wrap: textWidth});
        ty += headline.height + 6;
        text(tx, ty, fitLines(e.lead.subhead, Math.floor(textWidth / (size.subhead * 0.5)), 1), size.subhead, {style: 'italic'});
        ty += size.subhead + 10;
        const story = text(tx, ty, fitLines(t.lead.brief ? e.lead.brief : e.lead.body, Math.floor(textWidth / (size.body * 0.5)), t.lead.bodyLines), size.body);
        y = Math.max(caption.y + caption.height, ty + story.height) + 14;

        g.fillStyle(RULE, 1).fillRect(sideX - 14, top, 2, y - top);
        region = 'side';
        text(sideX, top, e.figuresTitle, size.kicker + 2, {style: 'bold', wrap: t.side.width});
        let fy = top + (size.kicker + 2) * 2 + 10;
        const figureTexts = e.figures.map(({label, value}) => {
            const o = text(sideX, fy, `${label.padEnd(10)}${value.padStart(9)}`, size.figures, {font: MONO});
            fy += size.figures + 8;
            return o.text;
        });

        // Columns and the advert (desktop).
        if (t.columns.count > 0) {
            rule(y - 6, 2);
            const colWidth = (page.width - 48 - t.side.width - 14) / t.columns.count;
            e.columns.slice(0, t.columns.count).forEach((col, i) => {
                const cx = left + i * colWidth;
                region = `column${i}`;
                regions[region] = {x: cx, right: cx + colWidth - 8};
                text(cx, y, col.headline, size.columnHead, {style: 'bold'});
                text(cx, y + size.columnHead + 6, fitLines(col.body, t.columns.chars, t.columns.lines), size.column);
                if (i > 0) g.fillStyle(RULE, 1).fillRect(cx - 8, y, 1, 100);
            });
            if (t.advert) {
                region = 'side';
                g.lineStyle(2, RULE, 1).strokeRect(sideX, y, t.side.width, 100);
                text(sideX + t.side.width / 2, y + 10, e.advert.headline, size.columnHead, {style: 'bold', originX: 0.5});
                text(sideX + 12, y + 38, fitLines(e.advert.body, 30, 2), size.column, {style: 'italic'});
            }
        }

        // Footer and CONTINUE.
        const {width: bw, height: bh} = t.button;
        const by = page.y + page.height - bh / 2 - 16;
        const footerTop = by - bh / 2 - 10;
        rule(footerTop, 2);
        region = 'footer';
        const soundWidth = this.#makeSound ? Math.max(150, bh * 1.6) + 16 : 0; // room for SOUND (TASK 030)
        text(left, by - size.footer / 2, fitLines(e.footer, Math.floor((page.width - bw - soundWidth - 80) / (size.footer * 0.55)), 1), size.footer, {style: 'italic'});
        const button = keep(scene.add.rectangle(right - bw / 2, by, bw, bh, BUTTON).setStrokeStyle(3, 0xf5e6c4).setInteractive({useHandCursor: true}));
        text(button.x, by - size.button / 2 - 2, 'CONTINUE', size.button, {color: '#fff8e1', style: 'bold', originX: 0.5});
        button.on('pointerdown', () => this.#onContinue());
        const proxy = addProxy(scene, button, 'close-newspaper', {label: 'Continue'});
        // TASK 030: SOUND ON / OFF beside CONTINUE, the same height.
        const sound = this.#makeSound?.({x: right - bw - 16 - Math.max(150, bh * 1.6) / 2, y: by, width: Math.max(150, bh * 1.6), height: bh}, DEPTH + 2) ?? null;
        return {objects, texts, regions, footerTop, proxy, button, masthead, headline, story, figureTexts, photo, caption, sound};
    }

    /**
     * The edition's photograph at a whole-number scale, so its pixels stay square,
     * with its own aspect ratio and transparency, in a black frame. A missing
     * texture leaves the frame empty, never a broken page.
     */
    #photo({asset}, x, y, scale, objects, g) {
        const key = NEWSPAPER_PHOTOS[asset]?.key ?? null;
        const loaded = key !== null && this.#scene.textures.exists(key);
        const source = loaded ? this.#scene.textures.get(key).getSourceImage() : {width: 64, height: 96};
        const [width, height] = [source.width * scale, source.height * scale];
        if (loaded) objects.push(this.#scene.add.image(x, y, key).setOrigin(0, 0).setScale(scale).setDepth(DEPTH + 1));
        g.lineStyle(3, RULE, 1).strokeRect(x - 2, y - 2, width + 4, height + 4);
        return {asset, key, loaded, x, y, width, height, scale};
    }

    /** What QA sees. */
    view() {
        if (!this.#views) return {open: false};
        const {texts, regions, footerTop, button, masthead, headline, story, figureTexts, photo, caption} = this.#views;
        // TASK 034: every text inside its own region and above the footer, and nothing cut short.
        const overflow = [];
        for (const {o, region} of texts) {
            const b = o.getBounds();
            const area = regions[region] ?? regions.page;
            const below = region === 'footer' ? false : b.bottom > footerTop + 0.5;
            if (b.x < area.x - 0.5 || b.right > area.right + 0.5 || below || o.text.includes('…')) {
                overflow.push({region, text: o.text.slice(0, 40)});
            }
        }
        return {
            open: true,
            reason: this.#state.reason,
            layout: this.#state.layout,
            issue: this.#state.edition.issue,
            night: this.#state.edition.night,
            masthead: masthead.text,
            headline: headline.text,
            figures: figureTexts,
            photo: {...photo, caption: caption.text},
            minFontPx: Math.min(...texts.map(({size}) => size)),
            overflow,
            lead: {id: this.#state.edition.lead.id, kicker: this.#state.edition.lead.kicker},
            columns: this.#state.edition.columns.map(({id}) => id).slice(0, TEMPLATES[this.#state.layout].columns.count),
            story: story.text, // the lead story as printed: the desktop's body, or the phone's brief
            continueBox: {x: button.x - button.width / 2, y: button.y - button.height / 2, width: button.width, height: button.height},
        };
    }
}
