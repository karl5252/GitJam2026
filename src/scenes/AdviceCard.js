import {addProxy} from '../testShadow/TestProxy.js';
import {HudButton, TONE} from './HudButton.js';
import {NEWSPAPER_PHOTOS} from './newspaperArt.js';

/**
 * TASK 033.3: one Presidential Advice tip, drawn in the HUD from State.ADVICE. Presentation
 * only: it shows what GameScene's PresidentialAdvice says and answers with OK and BOOK.
 * Desktop: a card in the band under the world. Touch: a ribbon along the world's bottom,
 * El Papi's portrait as its badge. Paper and ink as the Little Yellow Book's.
 *
 * Its paper takes a press, so a press on the card never falls through to the world; it is
 * there only while a tip shows, and nothing outside it is captured.
 */

const DEPTH = 10; // over the palette (5.5) and drawer (8), under tooltips, AUDIO, La Voz and the book
const SERIF = 'Georgia, "Times New Roman", Times, serif';
const PAPER = 0xf4e9c4;
const EDGE = 0x5a4708;
const BANANA = 0xf2cf1d;
const INK = '#2f2b10';
const RED = '#8e1b12';
const BOOK_TONE = 0x8a6d0a; // the rail's `i BOOK`

export class AdviceCard {
    #scene;
    #spec;
    #objects = [];
    #paper;
    #kicker = null;
    #title;
    #text;
    #more;
    #dismiss;
    #proxies = [];
    #tip = null;

    constructor(scene, spec, {onDismiss, onMore}) {
        this.#scene = scene;
        this.#spec = spec;
        const {x, y, width, height, pad, stripe} = spec;
        this.#paper = scene.add.rectangle(x, y, width, height, PAPER).setOrigin(0, 0).setStrokeStyle(3, EDGE).setInteractive();
        const band = scene.add.rectangle(x, y, stripe, height, BANANA).setOrigin(0, 0);
        this.#objects.push(this.#paper, band);
        let left = x + stripe + pad;
        if (spec.portrait) {
            const key = NEWSPAPER_PHOTOS['el-papi']?.key;
            if (key && scene.textures.exists(key)) {
                const source = scene.textures.get(key).getSourceImage();
                const top = Math.round(y + (height - source.height * spec.portrait) / 2);
                this.#objects.push(scene.add.image(left, top, key).setOrigin(0, 0).setScale(spec.portrait));
                left += source.width * spec.portrait + pad;
            }
        }
        const right = x + width - pad - spec.dismiss.width - pad - spec.more.width - pad;
        this.#textArea = {left, right};
        if (spec.kicker) {
            this.#kicker = scene.add.text(left, y + pad - 2, 'PRESIDENTIAL ADVICE ·', {fontFamily: SERIF, fontSize: `${spec.titleFont - 2}px`, fontStyle: 'bold', color: RED});
            this.#objects.push(this.#kicker);
        }
        this.#title = scene.add.text(left, y + pad - 2, '', {fontFamily: SERIF, fontSize: `${spec.titleFont}px`, fontStyle: 'bold', color: spec.kicker ? INK : RED});
        this.#text = scene.add.text(left, y, '', {fontFamily: SERIF, fontSize: `${spec.textFont}px`, color: INK, lineSpacing: 2, wordWrap: {width: right - left}});
        this.#objects.push(this.#title, this.#text);
        for (const object of this.#objects) object.setDepth(DEPTH);
        const midY = y + height / 2;
        const font = `${Math.min(spec.textFont, 22)}px`;
        this.#dismiss = new HudButton(scene, {x: x + width - pad - spec.dismiss.width / 2, y: midY, ...spec.dismiss, fontSize: font},
            {text: 'OK', tone: TONE.neutral, depth: DEPTH + 0.5, onPress: onDismiss});
        this.#more = new HudButton(scene, {x: x + width - pad - spec.dismiss.width - pad - spec.more.width / 2, y: midY, ...spec.more, fontSize: font},
            {text: 'BOOK', tone: BOOK_TONE, depth: DEPTH + 0.5, onPress: onMore});
        this.#setVisible(false);
    }

    #textArea;

    /** Show the state's tip, or nothing. Drawing the same tip again changes nothing. */
    render(state) {
        const tip = state?.visible ? state.tip : null;
        if ((tip?.id ?? null) === (this.#tip?.id ?? null)) return;
        this.#tip = tip;
        for (const proxy of this.#proxies) proxy.destroy();
        this.#proxies = [];
        if (!tip) {
            this.#setVisible(false);
            return;
        }
        const {left, right} = this.#textArea;
        this.#title.setText(tip.title).setX(this.#kicker ? this.#kicker.x + this.#kicker.width + 6 : left);
        // A long title steps down until it fits, never below the text's own size.
        let size = this.#spec.titleFont;
        this.#title.setFontSize(size);
        while (this.#title.x + this.#title.width > right && size > this.#spec.textFont) this.#title.setFontSize(--size);
        this.#text.setText(tip.text).setY(this.#title.y + this.#title.height + 2);
        this.#setVisible(true);
        const label = `Presidential Advice: ${tip.title}`;
        this.#proxies.push(addProxy(this.#scene, this.#paper, 'advice-card', {label}).set({tip: tip.id}));
        this.#proxies.push(addProxy(this.#scene, this.#more.rect, 'advice-more', {label: 'Open the Little Yellow Book'}).set({tip: tip.id}));
        this.#proxies.push(addProxy(this.#scene, this.#dismiss.rect, 'advice-dismiss', {label: 'Dismiss advice'}).set({tip: tip.id}));
    }

    #setVisible(visible) {
        for (const object of this.#objects) object.setVisible(visible);
        if (visible) this.#paper.setInteractive();
        else this.#paper.disableInteractive();
        this.#more.setVisible(visible);
        this.#dismiss.setVisible(visible);
    }

    /** What is really drawn: the tip, and whether every word stays on the card, clear of its buttons. */
    view() {
        if (!this.#tip) return {visible: false};
        const {x, y, width, height} = this.#spec;
        const area = this.#textArea;
        const overflow = [this.#kicker, this.#title, this.#text].filter(Boolean).filter((o) => {
            const b = o.getBounds();
            return b.x < area.left - 0.5 || b.right > area.right + 0.5 || b.y < y || b.bottom > y + height - 2;
        }).map((o) => o.text.slice(0, 30));
        return {
            visible: true,
            tip: this.#tip.id,
            title: this.#title.text,
            text: this.#text.text,
            box: {x, y, width, height},
            more: this.#more.box(),
            dismiss: this.#dismiss.box(),
            minFontPx: Math.min(this.#spec.textFont, this.#spec.titleFont),
            overflow,
        };
    }

    destroy() {
        for (const proxy of this.#proxies) proxy.destroy();
        for (const object of this.#objects) object.destroy();
        this.#more.destroy();
        this.#dismiss.destroy();
    }
}
