import {REFIT_COST} from '../core/buildingTypes.js';
import {addProxy} from '../testShadow/TestProxy.js';

// Right band, between the settlement panel and the power toggle. 116x84 is well
// over 44 CSS pixels at 844x390.
const BUTTON = {width: 116, height: 84};
const Y = 470;
const FLAG_X = 1098;
const DEMOLISH_X = 1218;
const RESET = {x: 1218, y: 560}; // beside the power toggle, which a Barracks narrows to leave room
// Where the Speed buttons sit at Night, so a late press at dawn can land here. That
// is one more reason a paid refit takes two presses.
const REFIT = {x: 1152, y: 650, width: 192, height: 84};
const STROKE = 0x90a4ae;
const FLAG_FILL = 0x37474f;
const DEMOLISH_FILL = 0x8e2b2b;
const CONFIRM_FILL = 0xe53935;
const CONFIRM_STROKE = 0xffeb3b;

/**
 * What a selected building offers besides its power switch: Demolish during Day,
 * and for a Barracks its rally flag and, once it has one, RESET FLAG, in Day and
 * Night, and a paid refit during Day. Presentation only.
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

    /** @param {{onFlag: () => void, onResetFlag: () => void, onDemolish: () => void, onRefit: () => void}} handlers */
    constructor(scene, {onFlag, onResetFlag, onDemolish, onRefit}) {
        this.#scene = scene;
        this.#flag = this.#button(FLAG_X, FLAG_FILL, 'set-flag', 'Set flag', onFlag);
        this.#reset = this.#button(RESET.x, FLAG_FILL, 'reset-flag', 'Reset flag', onResetFlag, RESET.y);
        this.#reset.text.setText('RESET\nFLAG');
        this.#onDemolish = onDemolish;
        this.#onRefit = onRefit;
        this.#demolish = this.#button(DEMOLISH_X, DEMOLISH_FILL, 'demolish', 'Demolish', () => this.#pressDemolish());
        this.#refit = this.#button(REFIT.x, FLAG_FILL, 'refit', 'Refit Barracks', () => this.#pressRefit(), REFIT.y, REFIT);
        this.#paintDemolish();
    }

    /**
     * @param {{id: string, flag?: object|null} | null} building the selected building, if any
     * @param {{canFlag: boolean, canDemolish: boolean, confirmDemolish: boolean, refitTo: string|null}} options
     *   refitTo - the role a refit would give this building, or null when it cannot have one
     */
    update(building, {canFlag, canDemolish, confirmDemolish, refitTo}) {
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
        if (canFlag) this.#flag.text.setText(building.flag ? 'Move\nflag' : 'Set\nflag');
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

    #button(x, fill, action, label, onPress, y = Y, {width, height} = BUTTON) {
        const rect = this.#scene.add.rectangle(x, y, width, height, fill)
            .setStrokeStyle(3, STROKE).setDepth(4).setVisible(false);
        const text = this.#scene.add.text(x, y, '', {fontFamily: 'monospace', fontSize: '18px', color: '#ffffff', align: 'center'})
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
