import {addProxy} from '../testShadow/TestProxy.js';

// Right band, between the settlement panel and the power toggle. 116x84 is well
// over 44 CSS pixels at 844x390.
const BUTTON = {width: 116, height: 84};
const Y = 470;
const FLAG_X = 1098;
const DEMOLISH_X = 1218;
const STROKE = 0x90a4ae;
const FLAG_FILL = 0x37474f;
const DEMOLISH_FILL = 0x8e2b2b;
const CONFIRM_FILL = 0xe53935;
const CONFIRM_STROKE = 0xffeb3b;

/**
 * What a selected building offers besides its power switch: Demolish during Day,
 * and for a Barracks its rally flag, in Day and Night. Presentation only.
 *
 * Demolishing a real building takes two presses, because nothing refunds a slip.
 * The first arms the button for that one building, and only the second acts. Any
 * selection change or the end of Day disarms it, and so does disarm(). Walls and
 * gates take one press, for fast base editing.
 */
export class BuildingControls {
    #scene;
    #flag;
    #demolish;
    #onDemolish;
    #targetId = null;
    #confirm = false;
    #armedId = null;

    /** @param {{onFlag: () => void, onDemolish: () => void}} handlers */
    constructor(scene, {onFlag, onDemolish}) {
        this.#scene = scene;
        this.#flag = this.#button(FLAG_X, FLAG_FILL, 'set-flag', 'Set flag', onFlag);
        this.#onDemolish = onDemolish;
        this.#demolish = this.#button(DEMOLISH_X, DEMOLISH_FILL, 'demolish', 'Demolish', () => this.#pressDemolish());
        this.#paintDemolish();
    }

    /**
     * @param {{id: string, flag?: object|null} | null} building the selected building, if any
     * @param {{canFlag: boolean, canDemolish: boolean, confirmDemolish: boolean}} options
     */
    update(building, {canFlag, canDemolish, confirmDemolish}) {
        this.#targetId = canDemolish ? building.id : null;
        this.#confirm = confirmDemolish;
        if (this.#armedId !== this.#targetId) this.disarm();
        this.#show(this.#flag, canFlag, building?.id);
        this.#show(this.#demolish, canDemolish, building?.id);
        if (canFlag) this.#flag.text.setText(building.flag ? 'Move\nflag' : 'Set\nflag');
    }

    /** Back to a plain Demolish button. Safe to call at any time. */
    disarm() {
        if (this.#armedId === null) return;
        this.#armedId = null;
        this.#paintDemolish();
    }

    /** The rendered buttons, for QA. */
    view() {
        return {
            flagVisible: this.#flag.rect.visible,
            flagLabel: this.#flag.text.text,
            demolishVisible: this.#demolish.rect.visible,
            demolishLabel: this.#demolish.text.text,
            demolishArmed: this.#armedId,
        };
    }

    #pressDemolish() {
        if (this.#confirm && this.#armedId !== this.#targetId) {
            this.#armedId = this.#targetId;
            this.#paintDemolish();
            return;
        }
        this.disarm();
        this.#onDemolish();
    }

    #paintDemolish() {
        const armed = this.#armedId !== null;
        const {rect, text} = this.#demolish;
        rect.setFillStyle(armed ? CONFIRM_FILL : DEMOLISH_FILL).setStrokeStyle(3, armed ? CONFIRM_STROKE : STROKE);
        text.setText(armed ? 'CONFIRM' : 'Demolish');
        this.#demolish.proxy?.set({armed});
    }

    #button(x, fill, action, label, onPress) {
        const rect = this.#scene.add.rectangle(x, Y, BUTTON.width, BUTTON.height, fill)
            .setStrokeStyle(3, STROKE).setDepth(4).setVisible(false);
        const text = this.#scene.add.text(x, Y, '', {fontFamily: 'monospace', fontSize: '18px', color: '#ffffff', align: 'center'})
            .setOrigin(0.5).setDepth(5).setVisible(false);
        rect.on('pointerdown', onPress);
        return {rect, text, action, label, proxy: null};
    }

    #show(button, visible, target) {
        const {rect, text, action, label} = button;
        rect.setVisible(visible);
        text.setVisible(visible);
        if (!visible) {
            rect.disableInteractive();
            button.proxy?.destroy();
            button.proxy = null;
            return;
        }
        rect.setInteractive({useHandCursor: true});
        button.proxy ??= addProxy(this.#scene, rect, action, {label});
        button.proxy.set({target, ...(button === this.#demolish ? {armed: this.#armedId !== null} : {})});
    }
}
