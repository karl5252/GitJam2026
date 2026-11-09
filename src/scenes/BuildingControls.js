import {REFIT_COST} from '../core/buildingTypes.js';
import {addProxy} from '../testShadow/TestProxy.js';
import {HudButton, TONE} from './HudButton.js';
import {KILLDOZER, killdozerPlacement} from './killdozerIcon.js';
import {UI_ART, WRENCH_VISIBLE, fitArt} from './uiArt.js';

const PAUSED_ALPHA = 0.45; // as the HUD's dimmed buttons: readable, pressable, refused in the domain
const ICON_INK = 0xffffff;
const TOOLTIP_STYLE = {fontFamily: 'monospace', fontSize: '16px', color: '#ffffff', backgroundColor: '#263238', padding: {x: 6, y: 3}};
const DEPTH = 6;

/**
 * What a selected object offers, in the palette beside the left rail (TASK 032): only
 * the commands it accepts, stacked in a fixed order from the slot the caller gives,
 * after its power or speaker switch. Presentation only; what each press means is
 * decided elsewhere, and where the palette is, is the layout's business.
 *
 *   SET / MOVE FLAG (SEND WORKERS / MOVE FLAG on HQ), RESET FLAG (RECALL / SEND
 *   WORKERS on HQ), REFIT, REPAIR / STOP REPAIR, DESTROY, and DISPERSE for a protest.
 *
 * Demolishing a real building takes two presses, because nothing refunds a slip.
 * The first arms the button for that one building, and only the second acts. Any
 * selection change or the end of Day disarms it, and so does disarm(). Walls and
 * gates take one press, for fast base editing. A refit works the same way, because
 * it costs Credits and AP, and arming one disarms the other.
 *
 * DESTROY and REPAIR are icon buttons: the Killdozer on red and the supplied wrench
 * on green; STOP REPAIR is the wrench crossed out on red. On desktop they share one
 * slot, side by side; on touch each has its own. Each has an accessible name and, on
 * hover, a tooltip; an armed DESTROY keeps its CONFIRM tooltip showing. REPAIR is
 * dimmed, but still pressable so the reason shows, when no worker is free.
 */
export class BuildingControls {
    #scene;
    #layout;
    #paused = false;
    #flag;
    #reset;
    #refit;
    #demolish;
    #repair;
    #onDemolish;
    #onRefit;
    #targetId = null;
    #confirm = false;
    #armedId = null;
    #refitTargetId = null;
    #refitArmedId = null;
    #refitRole = null;
    #repairState = null; // {ordered, enabled, price}
    #disperse;
    #tooltip;
    #hovered = null;
    #used = 0;

    /**
     * @param {{onFlag, onResetFlag, onDemolish, onRefit, onRepair, onDisperse?}} handlers
     * @param {{slot: (i: number) => {x, y, width, height}, pair: boolean, icon: {width, height}, fontSize: string}} palette
     */
    constructor(scene, {onFlag, onResetFlag, onDemolish, onRefit, onRepair, onDisperse}, palette) {
        this.#scene = scene;
        this.#layout = palette;
        this.#tooltip = scene.add.text(0, 0, '', TOOLTIP_STYLE).setOrigin(0.5, 1).setDepth(12).setVisible(false);
        const at = {...palette.slot(0), fontSize: palette.fontSize};
        this.#flag = this.#button(at, TONE.neutral, 'set-flag', 'Set flag', onFlag);
        this.#reset = this.#button(at, TONE.neutral, 'reset-flag', 'Reset flag', onResetFlag);
        this.#reset.text.setText('RESET\nFLAG');
        this.#onDemolish = onDemolish;
        this.#onRefit = onRefit;
        const square = {...at, ...palette.icon};
        this.#demolish = this.#iconButton(square, TONE.danger, 'demolish', 'DESTROY', () => this.#pressDemolish(), this.#killdozer(square));
        this.#refit = this.#button({...at, fontSize: '14px'}, TONE.neutral, 'refit', 'Refit Barracks', () => this.#pressRefit());
        this.#repair = this.#iconButton(square, TONE.go, 'repair', 'REPAIR', () => onRepair?.(), this.#wrench(square));
        this.#repair.cross = scene.add.graphics().setDepth(DEPTH + 0.3).setVisible(false);
        // TASK 027.1: shown only while a protest is selected, when no building action is.
        this.#disperse = this.#button({...at, fontSize: '14px'}, TONE.go, 'disperse', 'DISPERSE', () => onDisperse?.());
        this.#paintDemolish();
    }

    /**
     * @param {{id: string, flag?: object|null} | null} building the selected building, if any
     * @param {{canFlag, workers, sent, canDemolish, confirmDemolish, refitTo, paused, repair, disperse}} options
     *   workers - the flag is HQ's work flag
     *   refitTo - the role a refit would give this building, or null when it cannot have one
     *   repair - {ordered, enabled, price} while REPAIR or STOP REPAIR applies, otherwise null
     *   disperse - {groupId, ordered, enabled} while a protest is selected, otherwise null
     * @param {number} start the first palette slot these buttons may use
     * @returns {number} the slots used
     */
    update(building, {canFlag, workers, sent = true, canDemolish, confirmDemolish, refitTo, paused = false, repair = null, disperse = null}, start = 0) {
        this.#paused = paused;
        this.#targetId = canDemolish ? building.id : null;
        this.#confirm = confirmDemolish;
        this.#refitTargetId = refitTo ? building.id : null;
        this.#refitRole = refitTo;
        this.#repairState = repair;
        if (this.#armedId !== this.#targetId || this.#refitArmedId !== this.#refitTargetId) this.disarm();

        const showReset = canFlag && building.flag !== null;
        const showRepair = Boolean(repair);
        let slot = start;
        const place = (button, shown) => {
            if (shown) this.#moveTo(button, this.#layout.slot(slot++));
        };
        place(this.#flag, canFlag);
        place(this.#reset, showReset);
        place(this.#refit, Boolean(refitTo));
        if (this.#layout.pair) {
            // One slot for both, REPAIR on the left and DESTROY on the right, whichever shows.
            if (showRepair || canDemolish) {
                const {x, y, width} = this.#layout.slot(slot++);
                const {width: size} = this.#layout.icon;
                this.#moveTo(this.#repair, {x: x - width / 2 + size / 2, y});
                this.#moveTo(this.#demolish, {x: x + width / 2 - size / 2, y});
            }
        } else {
            // Stacked: DESTROY always sits just below REPAIR's slot, shown or not, so the two keep their order.
            if (showRepair) this.#moveTo(this.#repair, this.#layout.slot(slot));
            if (showRepair || canDemolish) this.#moveTo(this.#demolish, this.#layout.slot(slot + (showRepair ? 1 : 0)));
            slot += (showRepair ? 1 : 0) + (canDemolish ? 1 : 0);
        }
        place(this.#disperse, Boolean(disperse));
        this.#used = slot - start;

        this.#show(this.#flag, canFlag, building?.id);
        this.#show(this.#reset, showReset, building?.id);
        this.#show(this.#demolish, canDemolish, building?.id);
        this.#show(this.#refit, Boolean(refitTo), building?.id);
        this.#paintRefit();
        this.#paintDemolish();
        if (canFlag) this.#labelFlags(building.flag, workers, sent);
        this.#show(this.#repair, showRepair, building?.id);
        if (repair) this.#paintRepair(repair);
        else this.#repair.cross.setVisible(false);
        this.#paintDisperse(disperse);
        this.#refreshTooltip();
        return this.#used;
    }

    /** DISPERSE on green, CANCEL DISPERSE on red; dimmed, still pressable for its reason, when it can only be refused. */
    #paintDisperse(disperse) {
        const button = this.#disperse;
        button.label = disperse?.ordered ? 'CANCEL DISPERSE' : 'DISPERSE';
        button.text.setText(disperse?.ordered ? 'CANCEL\nDISPERSE' : 'DISPERSE');
        button.setTone(disperse?.ordered ? TONE.stop : TONE.go);
        this.#show(button, Boolean(disperse), disperse?.groupId);
        if (!disperse) return;
        button.setAlpha((disperse.enabled ? 1 : 0.45) * (this.#paused ? PAUSED_ALPHA : 1));
        button.proxy?.label(button.label).set({ordered: disperse.ordered, enabled: disperse.enabled});
    }

    /** The wrench on green; STOP REPAIR, the wrench crossed out on red. Dimmed when a press can only be refused. */
    #paintRepair({ordered, enabled}) {
        const button = this.#repair;
        button.setTone(ordered ? TONE.stop : TONE.go);
        const alpha = enabled && !this.#paused ? 1 : PAUSED_ALPHA;
        button.setAlpha(alpha);
        drawCross(button.cross, button.box(), ordered);
        button.cross.setVisible(ordered && button.visible).setAlpha(alpha);
        button.label = ordered ? 'STOP REPAIR' : 'REPAIR';
        button.proxy?.label(button.label).set({ordered, enabled});
    }

    /** HQ's second button recalls a squad that is out, and sends one that is home to the flag already down. */
    #labelFlags(flag, workers, sent) {
        if (workers) this.#flag.text.setText(flag ? 'MOVE\nFLAG' : 'SEND\nWORKERS');
        else this.#flag.text.setText(flag ? 'MOVE\nFLAG' : 'SET\nFLAG');
        if (!workers) this.#reset.text.setText('RESET\nFLAG');
        else this.#reset.text.setText(sent ? 'RECALL\nWORKERS' : 'SEND\nWORKERS');
    }

    /** Back to a plain DESTROY button. Safe to call at any time. */
    disarm() {
        if (this.#armedId === null && this.#refitArmedId === null) return;
        this.#armedId = null;
        this.#refitArmedId = null;
        this.#paintDemolish();
        this.#paintRefit();
        this.#refreshTooltip();
    }

    /** The rendered buttons, for QA. Icon buttons report their state names as labels. */
    view() {
        const box = (button) => button.box();
        return {
            flagVisible: this.#flag.visible,
            flagLabel: this.#flag.text.text,
            resetVisible: this.#reset.visible,
            resetLabel: this.#reset.text.text,
            demolishVisible: this.#demolish.visible,
            demolishLabel: this.#armedId !== null ? 'CONFIRM' : 'Demolish',
            demolishArmed: this.#armedId,
            demolishBox: box(this.#demolish),
            refitVisible: this.#refit.visible,
            refitLabel: this.#refit.text.text,
            refitArmed: this.#refitArmedId,
            repairVisible: this.#repair.visible,
            repairLabel: this.#repair.label,
            repairAlpha: this.#repair.rect.alpha,
            repairBox: box(this.#repair),
            disperseVisible: this.#disperse.visible,
            disperseLabel: this.#disperse.label,
            disperseAlpha: this.#disperse.rect.alpha,
            disperseBox: box(this.#disperse),
            tooltip: this.#tooltip.visible ? this.#tooltip.text : null,
            paused: this.#paused,
            alpha: this.#flag.rect.alpha,
            slots: this.#used,
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
        const button = this.#refit;
        button.setTone(armed ? TONE.confirm : TONE.neutral).setSelected(armed);
        const label = armed ? 'CONFIRM' : `REFIT\n${this.#refitRole?.toUpperCase()}`;
        button.text.setText(`${label}\n${REFIT_COST.credits}c ${REFIT_COST.ap}AP`);
        button.proxy?.set({armed, role: this.#refitRole});
    }

    #pressDemolish() {
        if (this.#confirm && this.#armedId !== this.#targetId) {
            this.disarm();
            this.#armedId = this.#targetId;
            this.#paintDemolish();
            this.#refreshTooltip();
            return;
        }
        this.disarm();
        this.#onDemolish();
    }

    /** Armed: bright red with a yellow frame, and its CONFIRM tooltip stays up. */
    #paintDemolish() {
        const armed = this.#armedId !== null;
        this.#demolish.setTone(armed ? TONE.confirm : TONE.danger).setSelected(armed);
        this.#demolish.label = 'DESTROY';
        this.#demolish.proxy?.set({armed});
    }

    /** The tooltip of the hovered icon button, or an armed DESTROY's CONFIRM. */
    #refreshTooltip() {
        const armed = this.#armedId !== null && this.#demolish.visible;
        const button = armed ? this.#demolish : this.#hovered;
        if (!button || !button.visible) {
            this.#tooltip.setVisible(false);
            return;
        }
        let text = button.label;
        if (armed) text = 'CONFIRM DESTROY';
        else if (button === this.#repair && this.#repairState?.price != null && !this.#repairState.ordered) text = `REPAIR · ${this.#repairState.price}c`;
        const {x, y, height} = button.box();
        this.#tooltip.setText(text);
        // Beside the button where there is room, and never past the screen's edge.
        const half = this.#tooltip.width / 2 + 4;
        const tx = Math.min(Math.max(x, half), this.#scene.scale.width - half);
        this.#tooltip.setPosition(tx, y - height / 2 - 4).setVisible(true);
    }

    #killdozer({x, y, width, height}) {
        if (!this.#scene.textures.exists(KILLDOZER.key)) return null;
        const {scale, originX, originY} = killdozerPlacement();
        const size = Math.min(width, height);
        return this.#scene.add.image(x, y, KILLDOZER.key).setOrigin(originX, originY).setScale(scale * (size / 48) * 0.92);
    }

    #wrench({x, y, width, height}) {
        if (!this.#scene.textures.exists(UI_ART.wrench.key)) return null;
        const size = Math.min(width, height) * 0.72;
        const fit = fitArt(WRENCH_VISIBLE, {frameWidth: 48, frameHeight: 48}, {width: size, height: size});
        return this.#scene.add.image(x, y, UI_ART.wrench.key).setOrigin(fit.originX, fit.originY).setScale(fit.scale);
    }

    #button(spec, tone, action, label, onPress) {
        const button = new HudButton(this.#scene, spec, {tone, depth: DEPTH, onPress});
        button.action = action;
        button.label = label;
        button.proxy = null;
        button.setVisible(false);
        return button;
    }

    /** A square button whose picture is an icon; the square, not the picture, takes the press. */
    #iconButton(spec, tone, action, label, onPress, icon) {
        const button = new HudButton(this.#scene, spec, {tone, depth: DEPTH, onPress, icon});
        Object.assign(button, {action, label, proxy: null});
        button.setVisible(false);
        button.rect.on('pointerover', () => {
            this.#hovered = button;
            this.#refreshTooltip();
        });
        button.rect.on('pointerout', () => {
            if (this.#hovered === button) this.#hovered = null;
            this.#refreshTooltip();
        });
        return button;
    }

    /** A proxy keeps the place it was made at, so a button that moves gets a new one. */
    #moveTo(button, {x, y}) {
        const {x: oldX, y: oldY} = button.box();
        if (oldX === x && oldY === y) return;
        button.setPosition(x, y);
        button.cross?.clear();
        button.proxy?.destroy();
        button.proxy = null;
    }

    #show(button, visible, target) {
        button.setVisible(visible);
        if (!visible) {
            button.cross?.setVisible(false);
            button.proxy?.destroy();
            button.proxy = null;
            return;
        }
        button.setAlpha(this.#paused ? PAUSED_ALPHA : 1);
        button.proxy ??= addProxy(this.#scene, button.rect, button.action, {label: button.label});
        button.proxy.label(button.label).set({target, paused: this.#paused, ...(button === this.#demolish ? {armed: this.#armedId !== null} : {})});
    }
}

/** STOP REPAIR: a white cross over the wrench, drawn round the button's centre. */
function drawCross(graphics, {x, y, width, height}, crossed) {
    graphics.clear();
    if (!crossed) return;
    const r = Math.min(width, height) * 0.32;
    graphics.lineStyle(Math.max(3, r / 5), ICON_INK, 1);
    graphics.lineBetween(x - r, y - r, x + r, y + r);
    graphics.lineBetween(x + r, y - r, x - r, y + r);
}
