import {addProxy, markModal} from '../testShadow/TestProxy.js';

const PANEL_COLOR = 0x101518;
const PANEL_ALPHA = 0.82;
const PANEL_DEPTH = 20;
const CONTENT_DEPTH = 21;
const RESTART_SIZE = {width: 240, height: 72};
const QUOTE = 'Your replacement will arrive tomorrow.';

/**
 * Game Over overlay. Presentation only. Nothing exists until show(), and the
 * scene restart destroys it all. The panel is interactive so that presses on
 * it count as UI, never as grid input.
 */
export class GameOverLayer {
    #scene;
    #onRestart;
    #views = null;

    constructor(scene, onRestart) {
        this.#scene = scene;
        this.#onRestart = onRestart;
    }

    /** @param {{completedShifts: number}} report */
    show({completedShifts}) {
        if (this.#views) return;
        const {width, height} = this.#scene.scale;
        const centerX = width / 2;
        const text = (y, content, fontSize, color) => this.#scene.add.text(centerX, y, content, {
            fontFamily: 'monospace',
            fontSize,
            color,
            align: 'center',
        }).setOrigin(0.5).setDepth(CONTENT_DEPTH);

        const panel = this.#scene.add.rectangle(0, 0, width, height, PANEL_COLOR, PANEL_ALPHA)
            .setOrigin(0, 0)
            .setDepth(PANEL_DEPTH)
            .setInteractive();
        const title = text(height / 2 - 150, 'HEADQUARTERS DESTROYED', '48px', '#ef9a9a');
        const quote = text(height / 2 - 70, `"${QUOTE}"`, '28px', '#eceff1');
        const stat = text(height / 2 + 10, `Completed shifts: ${completedShifts}`, '32px', '#ffffff');
        const button = this.#scene.add.rectangle(centerX, height / 2 + 120, RESTART_SIZE.width, RESTART_SIZE.height, 0x2e7d32)
            .setStrokeStyle(3, 0xa5d6a7)
            .setInteractive({useHandCursor: true})
            .setDepth(CONTENT_DEPTH);
        const label = text(button.y, 'RESTART', '32px', '#ffffff');
        button.once('pointerdown', () => this.#onRestart());
        addProxy(this.#scene, button, 'restart', {label: 'Restart'});
        markModal(this.#scene, 'game-over');
        this.#views = {panel, title, quote, stat, button, label};
    }

    /** The rendered overlay, for QA. */
    view() {
        if (!this.#views) return {visible: false};
        const {panel, title, quote, stat} = this.#views;
        return {visible: panel.visible, title: title.text, quote: quote.text, stat: stat.text};
    }
}
