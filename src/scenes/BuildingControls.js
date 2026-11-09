import {REFIT_COST} from '../core/buildingTypes.js';
import {addProxy} from '../testShadow/TestProxy.js';
import {audioFor} from '../audio/audio.js';
import {KILLDOZER, killdozerPlacement} from './killdozerIcon.js';

const PAUSED_ALPHA = 0.45; // as the HUD's dimmed buttons: readable, pressable, refused in the domain
const STROKE = 0x90a4ae;
const FLAG_FILL = 0x37474f;
const DEMOLISH_FILL = 0x8e2b2b;
const CONFIRM_FILL = 0xe53935;
const CONFIRM_STROKE = 0xffeb3b;
const REPAIR_FILL = 0x2e7d32;
const STOP_FILL = 0xb71c1c;
const ICON_INK = 0xffffff;
const TOOLTIP_STYLE = {fontFamily: 'monospace', fontSize: '16px', color: '#ffffff', backgroundColor: '#263238', padding: {x: 6, y: 3}};

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
 *
 * DESTROY and REPAIR are compact square icon buttons, side by side in the Demolish
 * slot: the Killdozer, red, and a wrench, green; STOP REPAIR is the wrench crossed
 * out on red. Each has an accessible name and, on hover, a tooltip; an armed
 * DESTROY keeps its CONFIRM tooltip showing. REPAIR is dimmed, but still pressable
 * so the reason shows, when no worker is free. The whole square is the hit area.
 */
export class BuildingControls {
    #scene;
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

    /**
     * @param {{onFlag: () => void, onResetFlag: () => void, onDemolish: () => void, onRefit: () => void, onRepair: () => void,
     *          onDisperse?: () => void}} handlers
     * @param {{flag, reset, demolish, refit, repair, disperse?}} positions each {x, y, width, height}
     */
    constructor(scene, {onFlag, onResetFlag, onDemolish, onRefit, onRepair, onDisperse}, {flag, reset, demolish, refit, repair, disperse}) {
        this.#scene = scene;
        this.#tooltip = scene.add.text(0, 0, '', TOOLTIP_STYLE).setOrigin(0.5, 1).setDepth(9).setVisible(false);
        this.#flag = this.#button(flag, FLAG_FILL, 'set-flag', 'Set flag', onFlag);
        this.#reset = this.#button(reset, FLAG_FILL, 'reset-flag', 'Reset flag', onResetFlag);
        this.#reset.text.setText('RESET\nFLAG');
        this.#onDemolish = onDemolish;
        this.#onRefit = onRefit;
        this.#demolish = this.#iconButton(demolish, DEMOLISH_FILL, 'demolish', 'DESTROY', () => this.#pressDemolish(), this.#killdozer(demolish));
        this.#refit = this.#button(refit, FLAG_FILL, 'refit', 'Refit Barracks', () => this.#pressRefit());
        this.#repair = this.#iconButton(repair, REPAIR_FILL, 'repair', 'REPAIR', () => onRepair?.(), scene.add.graphics());
        // TASK 027.1: shown only while a protest is selected, when no building action is.
        this.#disperse = disperse ? this.#button(disperse, REPAIR_FILL, 'disperse', 'DISPERSE', () => onDisperse?.()) : null;
        this.#paintDemolish();
    }

    /**
     * @param {{id: string, flag?: object|null} | null} building the selected building, if any
     * @param {{canFlag: boolean, workers: boolean, canDemolish: boolean, confirmDemolish: boolean, refitTo: string|null}} options
     *   workers - the flag is HQ's work flag
     *   refitTo - the role a refit would give this building, or null when it cannot have one
     *   repair - {ordered, enabled, price} while REPAIR or STOP REPAIR applies, otherwise null
     *   disperse - {groupId, ordered, enabled} while a protest is selected, otherwise null
     */
    update(building, {canFlag, workers, sent = true, canDemolish, confirmDemolish, refitTo, paused = false, repair = null, disperse = null}) {
        this.#paused = paused;
        this.#targetId = canDemolish ? building.id : null;
        this.#confirm = confirmDemolish;
        this.#refitTargetId = refitTo ? building.id : null;
        this.#refitRole = refitTo;
        this.#repairState = repair;
        if (this.#armedId !== this.#targetId || this.#refitArmedId !== this.#refitTargetId) this.disarm();
        this.#show(this.#flag, canFlag, building?.id);
        this.#show(this.#reset, canFlag && building.flag !== null, building?.id);
        this.#show(this.#demolish, canDemolish, building?.id);
        this.#show(this.#refit, Boolean(refitTo), building?.id);
        this.#paintRefit();
        this.#paintDemolish();
        if (canFlag) this.#labelFlags(building.flag, workers, sent);
        this.#show(this.#repair, Boolean(repair), building?.id);
        if (repair) this.#paintRepair(repair);
        if (this.#disperse) this.#paintDisperse(disperse);
        this.#refreshTooltip();
    }

    /** DISPERSE on green, CANCEL DISPERSE on red; dimmed, still pressable for its reason, when it can only be refused. */
    #paintDisperse(disperse) {
        const button = this.#disperse;
        button.label = disperse?.ordered ? 'CANCEL DISPERSE' : 'DISPERSE';
        button.text.setText(disperse?.ordered ? 'CANCEL\nDISPERSE' : 'DISPERSE');
        button.rect.setFillStyle(disperse?.ordered ? STOP_FILL : REPAIR_FILL);
        this.#show(button, Boolean(disperse), disperse?.groupId);
        if (!disperse) return;
        const alpha = (disperse.enabled ? 1 : 0.45) * (this.#paused ? PAUSED_ALPHA : 1);
        button.rect.setAlpha(alpha);
        button.text.setAlpha(alpha);
        button.proxy?.label(button.label).set({ordered: disperse.ordered, enabled: disperse.enabled});
    }

    /** A wrench on green; STOP REPAIR, the wrench crossed out on red. Dimmed when a press can only be refused. */
    #paintRepair({ordered, enabled}) {
        const {rect, icon, spec} = this.#repair;
        rect.setFillStyle(ordered ? STOP_FILL : REPAIR_FILL);
        drawWrench(icon, spec, ordered);
        const alpha = enabled && !this.#paused ? 1 : PAUSED_ALPHA;
        rect.setAlpha(alpha);
        icon.setAlpha(alpha);
        this.#repair.label = ordered ? 'STOP REPAIR' : 'REPAIR';
        this.#repair.proxy?.label(this.#repair.label).set({ordered, enabled});
    }

    /** HQ's second button recalls a squad that is out, and sends one that is home to the flag already down. */
    #labelFlags(flag, workers, sent) {
        if (workers) this.#flag.text.setText(flag ? 'MOVE\nFLAG' : 'SEND\nWORKERS');
        else this.#flag.text.setText(flag ? 'Move\nflag' : 'Set\nflag');
        if (!workers) this.#reset.text.setText('RESET\nFLAG');
        else this.#reset.text.setText(sent ? 'RECALL\nWORKERS' : 'SEND\nWORKERS');
    }

    /** Back to a plain Demolish button. Safe to call at any time. */
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
        const box = ({rect}) => ({x: rect.x, y: rect.y, width: rect.width, height: rect.height});
        return {
            flagVisible: this.#flag.rect.visible,
            flagLabel: this.#flag.text.text,
            resetVisible: this.#reset.rect.visible,
            resetLabel: this.#reset.text.text,
            demolishVisible: this.#demolish.rect.visible,
            demolishLabel: this.#armedId !== null ? 'CONFIRM' : 'Demolish',
            demolishArmed: this.#armedId,
            demolishBox: box(this.#demolish),
            refitVisible: this.#refit.rect.visible,
            refitLabel: this.#refit.text.text,
            refitArmed: this.#refitArmedId,
            repairVisible: this.#repair.rect.visible,
            repairLabel: this.#repair.label,
            repairAlpha: this.#repair.rect.alpha,
            repairBox: box(this.#repair),
            disperseVisible: Boolean(this.#disperse?.rect.visible),
            disperseLabel: this.#disperse?.label ?? null,
            disperseAlpha: this.#disperse?.rect.alpha ?? null,
            disperseBox: this.#disperse ? box(this.#disperse) : null,
            tooltip: this.#tooltip.visible ? this.#tooltip.text : null,
            paused: this.#paused,
            alpha: this.#flag.rect.alpha,
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
            this.#refreshTooltip();
            return;
        }
        this.disarm();
        this.#onDemolish();
    }

    /** Armed: bright red with a yellow frame, and its CONFIRM tooltip stays up. */
    #paintDemolish() {
        const armed = this.#armedId !== null;
        const {rect} = this.#demolish;
        rect.setFillStyle(armed ? CONFIRM_FILL : DEMOLISH_FILL).setStrokeStyle(armed ? 4 : 3, armed ? CONFIRM_STROKE : STROKE);
        this.#demolish.label = 'DESTROY';
        this.#demolish.proxy?.set({armed});
    }

    /** The tooltip of the hovered icon button, or an armed DESTROY's CONFIRM. */
    #refreshTooltip() {
        const armed = this.#armedId !== null && this.#demolish.rect.visible;
        const button = armed ? this.#demolish : this.#hovered;
        if (!button || !button.rect.visible) {
            this.#tooltip.setVisible(false);
            return;
        }
        let text = button.label;
        if (armed) text = 'CONFIRM DESTROY';
        else if (button === this.#repair && this.#repairState?.price != null && !this.#repairState.ordered) text = `REPAIR · ${this.#repairState.price}c`;
        const {rect} = button;
        this.#tooltip.setText(text);
        // Above the button, but never past the screen's edge: DESTROY sits at the far right.
        const half = this.#tooltip.width / 2 + 4;
        const x = Math.min(Math.max(rect.x, half), this.#scene.scale.width - half);
        this.#tooltip.setPosition(x, rect.y - rect.height / 2 - 4).setVisible(true);
    }

    #killdozer({x, y, width}) {
        if (!this.#scene.textures.exists(KILLDOZER.key)) return null;
        const {scale, originX, originY} = killdozerPlacement();
        return this.#scene.add.image(x, y, KILLDOZER.key).setOrigin(originX, originY).setScale(scale * (width / 48)).setDepth(5).setVisible(false);
    }

    #button({x, y, width, height, fontSize = '18px', wrap}, fill, action, label, onPress) {
        const rect = this.#scene.add.rectangle(x, y, width, height, fill)
            .setStrokeStyle(3, STROKE).setDepth(4).setVisible(false);
        const text = this.#scene.add.text(x, y, '', {
            fontFamily: 'monospace', fontSize, color: '#ffffff', align: 'center', ...(wrap ? {wordWrap: {width: wrap}} : {}),
        })
            .setOrigin(0.5).setDepth(5).setVisible(false);
        rect.on('pointerdown', onPress);
        rect.on('pointerover', () => audioFor(this.#scene.game).play('ui.hover'));
        return {rect, text, action, label, proxy: null};
    }

    /** A square button whose picture is an icon; the rectangle, not the picture, takes the press. */
    #iconButton(spec, fill, action, label, onPress, icon) {
        const button = this.#button(spec, fill, action, label, onPress);
        button.icon = icon?.setDepth(5).setVisible(false) ?? null;
        button.spec = spec;
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

    #show(button, visible, target) {
        const {rect, text, icon, action} = button;
        rect.setVisible(visible);
        text.setVisible(visible);
        icon?.setVisible(visible);
        if (!visible) {
            rect.disableInteractive();
            button.proxy?.destroy();
            button.proxy = null;
            return;
        }
        rect.setInteractive({useHandCursor: true});
        const alpha = this.#paused ? PAUSED_ALPHA : 1;
        rect.setAlpha(alpha);
        text.setAlpha(alpha);
        icon?.setAlpha(alpha);
        button.proxy ??= addProxy(this.#scene, rect, action, {label: button.label});
        button.proxy.label(button.label).set({target, paused: this.#paused, ...(button === this.#demolish ? {armed: this.#armedId !== null} : {})});
    }
}

/** A white wrench, head up and right; crossed out for STOP REPAIR. Drawn round the button's centre. */
function drawWrench(graphics, {x, y, width}, crossed) {
    const unit = width / 48;
    graphics.clear();
    graphics.fillStyle(ICON_INK, crossed ? 0.45 : 1);
    // Handle: a thick bar from bottom-left towards the head.
    graphics.fillPoints([
        {x: x - 14 * unit, y: y + 10 * unit}, {x: x - 10 * unit, y: y + 14 * unit},
        {x: x + 6 * unit, y: y - 2 * unit}, {x: x + 2 * unit, y: y - 6 * unit},
    ], true);
    // Head: a ring with its jaw open to the top right.
    graphics.fillCircle(x + 7 * unit, y - 7 * unit, 9 * unit);
    graphics.fillStyle(crossed ? STOP_FILL : REPAIR_FILL, 1);
    graphics.fillRect(x + 7 * unit, y - 17 * unit, 7 * unit, 10 * unit);
    graphics.fillCircle(x + 7 * unit, y - 7 * unit, 3 * unit);
    if (crossed) {
        graphics.lineStyle(5 * unit, ICON_INK, 1);
        graphics.lineBetween(x - 15 * unit, y - 15 * unit, x + 15 * unit, y + 15 * unit);
        graphics.lineBetween(x + 15 * unit, y - 15 * unit, x - 15 * unit, y + 15 * unit);
    }
}
