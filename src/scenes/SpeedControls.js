import {SIMULATION_SPEEDS} from '../core/simulationClock.js';
import {addProxy} from '../testShadow/TestProxy.js';
import {HudButton} from './HudButton.js';

/**
 * Night speed buttons, on the right rail. Presentation only: the clock owns the
 * selected speed, and a press is only a request. Nothing used during Day sits where
 * they do, so a late press at dawn can never land on END DAY.
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
            const button = new HudButton(scene, {...positions[i], fontSize: '24px'}, {text: `${speed}×`, onPress: () => onSpeed(speed)});
            button.setVisible(false);
            return {speed, button, proxy: null};
        });
    }

    setVisible(visible) {
        for (const entry of this.#buttons) {
            const {speed, button} = entry;
            if (visible === button.visible) continue;
            button.setVisible(visible);
            if (visible) entry.proxy = addProxy(this.#scene, button.rect, `speed-${speed}`, {label: `Speed ${speed}x`});
            else {
                entry.proxy?.destroy();
                entry.proxy = null;
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
            visible: this.#buttons[0].button.visible,
            selected: this.#buttons.find(({button}) => button.selected)?.speed ?? null,
            labels: this.#buttons.map(({button}) => button.text.text),
        };
    }

    #refresh() {
        for (const {speed, button, proxy} of this.#buttons) {
            const selected = speed === this.#speed;
            button.setSelected(selected);
            proxy?.set({selected});
        }
    }
}
