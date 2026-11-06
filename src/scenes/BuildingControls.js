import {REFIT_COST} from '../core/buildingTypes.js';
import {addProxy} from '../testShadow/TestProxy.js';

const STROKE = 0x90a4ae;
const FLAG_FILL = 0x37474f;
const DEMOLISH_FILL = 0x8e2b2b;
const CONFIRM_FILL = 0xe53935;
const CONFIRM_STROKE = 0xffeb3b;

/**
 * What a selected building offers besides its power switch: Demolish during Day,
 * and for a Barracks its rally flag and, once it has one, RESET FLAG, in Day and
 * Night, and a paid refit during Day. HQ's work flag uses the same two flag buttons,
 * labelled for its workers. Presentation only, and where each button
 * goes is the layout's business. On desktop Refit sits where Speed does at Night, so
 * a late press at dawn can land on it, which is one more reason it takes two presses.
 *
 * Demolishing a real building takes two presses, because nothing refunds a slip.
 * The first arms the button for that one building, and only the second acts. Any
 * selection change or the end of Day disarms it, and so does disarm(). Walls and
 * gates take one press, for fast base editing. A refit works the same way, because
 * it costs Credits and AP, and arming one disarms the other.
 */
export class BuildingControls {
    #scene;
    #flag;
    #reset;
    #refit;
    #demolish;
    #onDemolish;
    #onRefit;
    #targetId = null;
    #confirm = false;
    #armedId = null;
    #refitTargetId = null;
    #refitArmedId = null;
    #refitRole = null;

    /**
     * @param {{onFlag: () => void, onResetFlag: () => void, onDemolish: () => void, onRefit: () => void}} handlers
     * @param {{flag, reset, demolish, refit}} positions each {x, y, width, height}
     */
    constructor(scene, {onFlag, onResetFlag, onDemolish, onRefit}, {flag, reset, demolish, refit}) {
        this.#scene = scene;
        this.#flag = this.#button(flag, FLAG_FILL, 'set-flag', 'Set flag', onFlag);
        this.#reset = this.#button(reset, FLAG_FILL, 'reset-flag', 'Reset flag', onResetFlag);
        this.#reset.text.setText('RESET\nFLAG');
        this.#onDemolish = onDemolish;
        this.#onRefit = onRefit;
        this.#demolish = this.#button(demolish, DEMOLISH_FILL, 'demolish', 'Demolish', () => this.#pressDemolish());
        this.#refit = this.#button(refit, FLAG_FILL, 'refit', 'Refit Barracks', () => this.#pressRefit());
        this.#paintDemolish();
    }

    /**
     * @param {{id: string, flag?: object|null} | null} building the selected building, if any
     * @param {{canFlag: boolean, workers: boolean, canDemolish: boolean, confirmDemolish: boolean, refitTo: string|null}} options
     *   workers - the flag is HQ's work flag
     *   refitTo - the role a refit would give this building, or null when it cannot have one
     */
    update(building, {canFlag, workers, canDemolish, confirmDemolish, refitTo}) {
        this.#targetId = canDemolish ? building.id : null;
        this.#confirm = confirmDemolish;
        this.#refitTargetId = refitTo ? building.id : null;
        this.#refitRole = refitTo;
        if (this.#armedId !== this.#targetId || this.#refitArmedId !== this.#refitTargetId) this.disarm();
        this.#show(this.#flag, canFlag, building?.id);
        this.#show(this.#reset, canFlag && building.flag !== null, building?.id);
        this.#show(this.#demolish, canDemolish, building?.id);
        this.#show(this.#refit, Boolean(refitTo), building?.id);
        this.#paintRefit();
        if (canFlag) this.#labelFlags(building.flag, workers);
    }

    #labelFlags(flag, workers) {
        if (workers) this.#flag.text.setText(flag ? 'MOVE\nFLAG' : 'SEND\nWORKERS');
        else this.#flag.text.setText(flag ? 'Move\nflag' : 'Set\nflag');
        this.#reset.text.setText(workers ? 'RECALL\nWORKERS' : 'RESET\nFLAG');
    }

    /** Back to a plain Demolish button. Safe to call at any time. */
    disarm() {
        if (this.#armedId === null && this.#refitArmedId === null) return;
        this.#armedId = null;
        this.#refitArmedId = null;
        this.#paintDemolish();
        this.#paintRefit();
    }

    /** The rendered buttons, for QA. */
    view() {
        return {
            flagVisible: this.#flag.rect.visible,
            flagLabel: this.#flag.text.text,
            resetVisible: this.#reset.rect.visible,
            resetLabel: this.#reset.text.text,
            demolishVisible: this.#demolish.rect.visible,
            demolishLabel: this.#demolish.text.text,
            demolishArmed: this.#armedId,
            refitVisible: this.#refit.rect.visible,
            refitLabel: this.#refit.text.text,
            refitArmed: this.#refitArmedId,
        };
    }

    #pressRefit() {
        if (this.#refitArmedId !== this.#refitTargetId) {
            this.disarm();
            this.#refitArmedId = this.#refitTargetId;
            this.#paintRefit();
            return;
        }
        this.disarm();
        this.#onRefit();
    }

    #paintRefit() {
        const armed = this.#refitArmedId !== null;
        const {rect, text} = this.#refit;
        rect.setFillStyle(armed ? CONFIRM_FILL : FLAG_FILL).setStrokeStyle(3, armed ? CONFIRM_STROKE : STROKE);
        const label = armed ? 'CONFIRM' : `Refit: ${this.#refitRole?.toUpperCase()}`;
        text.setText(`${label}\n${REFIT_COST.credits}c · ${REFIT_COST.ap} AP`);
        this.#refit.proxy?.set({armed, role: this.#refitRole});
    }

    #pressDemolish() {
        if (this.#confirm && this.#armedId !== this.#targetId) {
            this.disarm();
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

    #button({x, y, width, height, fontSize = '18px', wrap}, fill, action, label, onPress) {
        const rect = this.#scene.add.rectangle(x, y, width, height, fill)
            .setStrokeStyle(3, STROKE).setDepth(4).setVisible(false);
        const text = this.#scene.add.text(x, y, '', {
            fontFamily: 'monospace', fontSize, color: '#ffffff', align: 'center', ...(wrap ? {wordWrap: {width: wrap}} : {}),
        })
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
