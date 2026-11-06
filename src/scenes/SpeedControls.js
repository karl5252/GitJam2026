import {SIMULATION_SPEEDS} from '../core/simulationClock.js';
import {addProxy} from '../testShadow/TestProxy.js';

const FILL = 0x37474f;
const STROKE = 0x90a4ae;
const SELECTED_STROKE = 0xffeb3b;

/**
 * Night speed buttons. Presentation only: the clock owns the selected speed, and a
 * press is only a request. Nothing used during Day sits where they do on desktop,
 * so a late press at dawn can never land on END DAY.
 */
export class SpeedControls {
    #scene;
    #buttons;
    #speed = 1;

    /**
     * @param {Phaser.Scene} scene
     * @param {(speed: number) => void} onSpeed
     * @param {Array<{x, y, width, height}>} positions one per speed
     */
    constructor(scene, onSpeed, positions) {
        this.#scene = scene;
        this.#buttons = SIMULATION_SPEEDS.map((speed, i) => {
            const {x, y, width, height} = positions[i];
            const rect = scene.add.rectangle(x, y, width, height, FILL).setDepth(4).setVisible(false);
            const text = scene.add.text(x, y, `${speed}×`, {fontFamily: 'monospace', fontSize: '24px', color: '#ffffff'})
                .setOrigin(0.5).setDepth(5).setVisible(false);
            rect.on('pointerdown', () => onSpeed(speed));
            return {speed, rect, text, proxy: null};
        });
    }

    setVisible(visible) {
        for (const button of this.#buttons) {
            const {speed, rect, text} = button;
            if (visible === rect.visible) continue;
            rect.setVisible(visible);
            text.setVisible(visible);
            if (visible) {
                rect.setInteractive({useHandCursor: true});
                button.proxy = addProxy(this.#scene, rect, `speed-${speed}`, {label: `Speed ${speed}x`});
            } else {
                rect.disableInteractive();
                button.proxy.destroy();
                button.proxy = null;
            }
        }
        if (visible) this.#refresh();
    }

    setSpeed(speed) {
        this.#speed = speed;
        this.#refresh();
    }

    /** The rendered buttons, for QA. */
    view() {
        return {
            visible: this.#buttons[0].rect.visible,
            selected: this.#buttons.find(({rect}) => rect.strokeColor === SELECTED_STROKE)?.speed ?? null,
            labels: this.#buttons.map(({text}) => text.text),
        };
    }

    #refresh() {
        for (const {speed, rect, proxy} of this.#buttons) {
            const selected = speed === this.#speed;
            rect.setStrokeStyle(3, selected ? SELECTED_STROKE : STROKE);
            proxy?.set({selected});
        }
    }
}
