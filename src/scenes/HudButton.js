import {audioFor} from '../audio/audio.js';
import {artKey, ART} from './SpriteArt.js';
import {ACTION_FRAME, BUILD_CATEGORY, BUILD_FRAME, BUILD_ICON, CATEGORY, SHORT_LABEL, UI_ART, fitArt} from './uiArt.js';

/**
 * TASK 032: the HUD's two kinds of button. Presentation only: a press is handed to
 * `onPress`, and whatever it asks for is decided elsewhere.
 *
 * Each keeps a plain rectangle, `rect`, as its hit area and its QA handle: proxies are
 * made from it, and its `visible` and `alpha` are the button's. Its stroke is the
 * selected (yellow) or hover outline, and invisible otherwise.
 */

export const TONE = Object.freeze({
    neutral: 0x2b3a42,
    go: 0x2e7d32,
    danger: 0x7f1d1d,
    confirm: 0xd32f2f,
    stop: 0xb71c1c,
    earth: 0x5d4037,
    on: 0x2f5d3a,
});
export const SELECTED_STROKE = 0xffeb3b;
const HOVER_STROKE = 0xe0e0e0;
const FRAME_SCALE = 2; // the nine-slice's source pixels, at a whole multiple

/** A text or icon button in the stretched metal action frame. */
export class HudButton {
    #scene;
    #parts;
    #selected = false;
    #hovered = false;
    #visible = true;

    /**
     * @param {Phaser.Scene} scene
     * @param {{x, y, width, height, fontSize?, wrap?}} spec
     * @param {{text?: string, tone?: number, depth?: number, onPress?: () => void, hover?: boolean, icon?: object}} options
     */
    constructor(scene, spec, {text = '', tone = TONE.neutral, depth = 4, onPress = null, hover = true, icon = null} = {}) {
        this.#scene = scene;
        const {x, y, width, height, fontSize = '20px', wrap} = spec;
        this.spec = {...spec};
        this.rect = scene.add.rectangle(x, y, width, height, 0x000000, 0)
            .setStrokeStyle(3, HOVER_STROKE, 0)
            .setDepth(depth + 0.3)
            .setInteractive({useHandCursor: true});
        this.fill = scene.add.rectangle(x, y, width - 4, height - 4, tone).setDepth(depth);
        this.frame = scene.textures.exists(UI_ART.actionButton.key)
            ? scene.add.nineslice(x, y, UI_ART.actionButton.key, undefined, width / FRAME_SCALE, height / FRAME_SCALE,
                ACTION_FRAME.left, ACTION_FRAME.right, ACTION_FRAME.top, ACTION_FRAME.bottom)
                .setScale(FRAME_SCALE).setDepth(depth + 0.1)
            : null;
        if (!this.frame) this.fill.setStrokeStyle(3, 0x90a4ae); // no art: a plain frame
        this.text = scene.add.text(x, y - (this.frame ? 1 : 0), text, {
            fontFamily: 'monospace', fontSize, color: '#ffffff', align: 'center', fontStyle: 'bold',
            stroke: '#101010', strokeThickness: 3, ...(wrap ? {wordWrap: {width: wrap}} : {}),
        }).setOrigin(0.5).setDepth(depth + 0.2);
        this.icon = icon?.setDepth(depth + 0.2) ?? null;
        this.pressed = scene.add.rectangle(x, y, width - 8, height - 8, 0x000000, 0.28).setDepth(depth + 0.25).setVisible(false);
        this.#parts = [this.fill, this.frame, this.text, this.icon].filter(Boolean);
        this.rect.on('pointerdown', () => {
            this.pressed.setVisible(this.#visible);
            onPress?.();
        });
        const release = () => this.pressed.setVisible(false);
        this.rect.on('pointerup', release);
        this.rect.on('pointerout', () => {
            release();
            this.#hovered = false;
            this.#paintStroke();
        });
        this.rect.on('pointerover', () => {
            this.#hovered = true;
            this.#paintStroke();
            if (hover) audioFor(scene.game).play('ui.hover');
        });
    }

    get visible() {
        return this.#visible;
    }

    get selected() {
        return this.#selected;
    }

    setVisible(visible) {
        this.#visible = visible;
        this.rect.setVisible(visible);
        for (const part of this.#parts) part.setVisible(visible);
        if (visible) this.rect.setInteractive({useHandCursor: true});
        else {
            this.rect.disableInteractive();
            this.pressed.setVisible(false);
            this.#hovered = false;
            this.#paintStroke();
        }
        return this;
    }

    setAlpha(alpha) {
        this.rect.setAlpha(alpha);
        for (const part of this.#parts) part.setAlpha(alpha);
        return this;
    }

    setTone(color) {
        this.fill.setFillStyle(color);
        return this;
    }

    setLabel(text) {
        this.text.setText(text);
        return this;
    }

    setSelected(selected) {
        this.#selected = selected;
        this.#paintStroke();
        return this;
    }

    /** Moving a button: the caller drops its proxy, which keeps the place it was made at. */
    setPosition(x, y) {
        this.spec.x = x;
        this.spec.y = y;
        for (const part of [this.rect, this.fill, this.frame, this.pressed]) part?.setPosition(x, y);
        this.text.setPosition(x, y - (this.frame ? 1 : 0));
        this.icon?.setPosition?.(x, y);
        return this;
    }

    setSize(width, height) {
        this.spec.width = width;
        this.spec.height = height;
        this.rect.setSize(width, height);
        this.rect.geom?.setSize?.(width, height);
        this.rect.input?.hitArea?.setSize?.(width, height);
        this.fill.setSize(width - 4, height - 4);
        this.pressed.setSize(width - 8, height - 8);
        this.frame?.setSize(width / FRAME_SCALE, height / FRAME_SCALE);
        return this;
    }

    box() {
        const {x, y, width, height} = this.spec;
        return {x, y, width, height};
    }

    #paintStroke() {
        if (this.#selected) this.rect.setStrokeStyle(4, SELECTED_STROKE, 1);
        else this.rect.setStrokeStyle(3, HOVER_STROKE, this.#hovered && this.#visible ? 0.7 : 0);
    }

    destroy() {
        for (const part of [this.rect, this.pressed, ...this.#parts]) part.destroy();
    }
}

const INSUFFICIENT_INK = 0xff8a80;
const COST_COLOR = '#fff3c4';

/**
 * A construction button: the building_button frame at a whole-number scale, the
 * building's own art fitted into its opening over a muted category colour, the live
 * price across the top and a short name on the label plate. The art is never tinted.
 */
export class BuildButton {
    #scene;
    #parts;
    #visible = true;
    #hovered = false;
    #selected = false;
    #state = {};

    /**
     * @param {Phaser.Scene} scene
     * @param {string} id the building type, or 'road'
     * @param {{x, y}} at the centre
     * @param {{scale: number, depth: number, costFont: string, labelFont: string, onPress: () => void,
     *          onHover?: (id: string|null) => void}} options
     */
    constructor(scene, id, {x, y}, {scale, depth, costFont, labelFont, onPress, onHover = null}) {
        this.#scene = scene;
        this.id = id;
        this.scale = scale;
        const size = UI_ART.buildingButton.size * scale;
        const px = (sx) => x - size / 2 + sx * scale; // source x to screen x
        const py = (sy) => y - size / 2 + sy * scale;
        const {opening, art, cost, plate} = BUILD_FRAME;
        const colors = CATEGORY[BUILD_CATEGORY[id] ?? 'neutral'];
        this.category = BUILD_CATEGORY[id] ?? 'neutral';
        this.rect = scene.add.rectangle(x, y, size, size, 0x000000, 0).setStrokeStyle(3, HOVER_STROKE, 0)
            .setDepth(depth + 0.5).setInteractive({useHandCursor: true});
        const openX = px(opening.x + opening.width / 2);
        const openY = py(opening.y + opening.height / 2);
        this.background = scene.add.rectangle(openX, openY, opening.width * scale, opening.height * scale, colors.dark).setDepth(depth);
        this.glow = scene.add.ellipse(openX, py(art.y + art.height * 0.62), art.width * scale * 0.9, art.height * scale * 0.55, colors.light, 0.32)
            .setDepth(depth + 0.05);
        const box = {width: art.width * scale, height: art.height * scale};
        this.art = this.#addArt(id, px(art.x + art.width / 2), py(art.y + art.height / 2), box, depth + 0.1);
        this.hatch = scene.add.graphics().setDepth(depth + 0.15).setVisible(false);
        this.#drawHatch(px(opening.x), py(opening.y), opening.width * scale, opening.height * scale);
        this.frame = scene.textures.exists(UI_ART.buildingButton.key)
            ? scene.add.image(x, y, UI_ART.buildingButton.key).setScale(scale).setDepth(depth + 0.2)
            : scene.add.rectangle(x, y, size - 4, size - 4).setStrokeStyle(3, 0x90a4ae).setDepth(depth + 0.2);
        this.costStrip = scene.add.rectangle(openX, py(cost.y + cost.height / 2), opening.width * scale, cost.height * scale, 0x000000, 0.55)
            .setDepth(depth + 0.25);
        this.cost = scene.add.text(openX, py(cost.y + cost.height / 2), '', {
            fontFamily: 'monospace', fontSize: costFont, fontStyle: 'bold', color: COST_COLOR, stroke: '#101010', strokeThickness: 2,
        }).setOrigin(0.5).setDepth(depth + 0.3);
        this.label = scene.add.text(px(plate.x + plate.width / 2), py(plate.y + plate.height / 2), SHORT_LABEL[id] ?? id, {
            fontFamily: 'monospace', fontSize: labelFont, fontStyle: 'bold', color: '#ffffff', stroke: '#101010', strokeThickness: 3,
        }).setOrigin(0.5).setDepth(depth + 0.3);
        this.pressed = scene.add.rectangle(x, y, size - 8, size - 8, 0x000000, 0.3).setDepth(depth + 0.4).setVisible(false);
        this.#parts = [this.background, this.glow, this.art, this.frame, this.costStrip, this.cost, this.label].filter(Boolean);
        this.rect.on('pointerdown', () => {
            this.pressed.setVisible(this.#visible);
            onPress();
        });
        const release = () => this.pressed.setVisible(false);
        this.rect.on('pointerup', release);
        this.rect.on('pointerover', () => {
            this.#hovered = true;
            this.#paintStroke();
            audioFor(scene.game).play('ui.hover');
            onHover?.(id);
        });
        this.rect.on('pointerout', () => {
            release();
            this.#hovered = false;
            this.#paintStroke();
            onHover?.(null);
        });
    }

    get visible() {
        return this.#visible;
    }

    /**
     * @param {{state: 'available'|'locked'|'built', selected: boolean, paused: boolean, price: string, lacks: string[]|null}} state
     */
    render({state, selected, paused, price, lacks}) {
        this.#state = {state, selected, paused, price, lacks};
        this.#selected = selected;
        const built = state === 'built';
        const short = !built && lacks !== null;
        this.cost.setText(built ? 'BUILT' : price).setColor(short ? '#ff8a80' : COST_COLOR);
        this.hatch.setVisible(this.#visible && short);
        const alpha = state === 'available' && !paused ? 1 : 0.45;
        this.setAlpha(alpha);
        this.#paintStroke();
    }

    view() {
        const {state = null, selected = false, price = null, lacks = null} = this.#state;
        return {
            visible: this.#visible, label: this.label.text, cost: this.cost.text, state, selected,
            affordable: lacks === null, lacks, alpha: this.rect.alpha, category: this.category,
            art: this.art?.texture?.key ?? (this.id === 'road' ? 'road' : null),
            box: {x: this.rect.x, y: this.rect.y, width: this.rect.width, height: this.rect.height},
        };
    }

    setVisible(visible) {
        this.#visible = visible;
        this.rect.setVisible(visible);
        for (const part of this.#parts) part.setVisible(visible);
        this.hatch.setVisible(visible && this.#state.lacks != null && this.#state.state !== 'built');
        if (visible) this.rect.setInteractive({useHandCursor: true});
        else {
            this.rect.disableInteractive();
            this.pressed.setVisible(false);
            this.#hovered = false;
            this.#paintStroke();
        }
        return this;
    }

    setAlpha(alpha) {
        this.rect.setAlpha(alpha);
        for (const part of this.#parts) part.setAlpha(alpha);
        this.hatch.setAlpha(alpha);
        return this;
    }

    #paintStroke() {
        if (this.#selected) this.rect.setStrokeStyle(4, SELECTED_STROKE, 1);
        else this.rect.setStrokeStyle(3, HOVER_STROKE, this.#hovered && this.#visible ? 0.75 : 0);
    }

    /** The building's existing sprite, frame 0, fitted with its aspect ratio kept; a road tile for Road. */
    #addArt(id, x, y, box, depth) {
        const icon = BUILD_ICON[id];
        if (!icon) return id === 'road' ? this.#roadTile(x, y, box, depth) : null;
        const key = artKey(icon.kind);
        if (!this.#scene.textures.exists(key)) return null;
        const {frameWidth, frameHeight} = ART[icon.kind];
        const fit = fitArt(icon.visible, {frameWidth, frameHeight}, box);
        return this.#scene.add.image(x, y, key, icon.frame).setOrigin(fit.originX, fit.originY).setScale(fit.scale).setDepth(depth);
    }

    /** No road sprite exists: a short stretch of road, in RoadLayer's colours. */
    #roadTile(x, y, {width, height}, depth) {
        const g = this.#scene.add.graphics().setDepth(depth);
        const side = Math.min(width, height) * 0.8;
        g.fillStyle(0x5d5d5d, 1).fillRect(x - width / 2, y - side / 2, width, side);
        g.fillStyle(0x7a7a7a, 1).fillRect(x - width / 2, y - side / 2, width, 3).fillRect(x - width / 2, y + side / 2 - 3, width, 3);
        g.fillStyle(0xe0c34a, 1);
        for (let dx = -width / 2 + 4; dx < width / 2 - 6; dx += 14) g.fillRect(x + dx, y - 2, 8, 4);
        return g;
    }

    /** Insufficient Credits or AP: diagonal hatching over the opening, so it never rests on colour alone. */
    #drawHatch(left, top, width, height) {
        const g = this.hatch;
        g.lineStyle(3, INSUFFICIENT_INK, 0.8);
        for (let d = 8; d < width + height; d += 14) {
            const x1 = left + Math.max(0, d - height);
            const y1 = top + Math.min(d, height);
            const x2 = left + Math.min(d, width);
            const y2 = top + Math.max(0, d - width);
            g.lineBetween(x1, y1, x2, y2);
        }
    }

    destroy() {
        for (const part of [this.rect, this.hatch, this.pressed, ...this.#parts]) part.destroy();
    }
}
