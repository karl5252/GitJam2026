import {SIMULATION_SPEEDS} from '../core/simulationClock.js';
import {addProxy} from '../testShadow/TestProxy.js';

// Right band, below the power toggle. Nothing used during Day sits here, so a
// late press at dawn can never land on END DAY. 82x84 is about 44 CSS pixels
// at 844x390.
const BUTTON = {width: 82, height: 84};
const FIRST_X = 1072;
const Y = 650;
const FILL = 0x37474f;
const STROKE = 0x90a4ae;
const SELECTED_STROKE = 0xffeb3b;

/** Night speed buttons. Presentation only: the clock owns the selected speed. */
export class SpeedControls {
    #scene;
    #clock;
    #buttons;

    constructor(scene, clock) {
        this.#scene = scene;
        this.#clock = clock;
        this.#buttons = SIMULATION_SPEEDS.map((speed, i) => {
            const x = FIRST_X + i * BUTTON.width;
            const rect = scene.add.rectangle(x, Y, BUTTON.width, BUTTON.height, FILL).setDepth(4).setVisible(false);
            const text = scene.add.text(x, Y, `${speed}×`, {fontFamily: 'monospace', fontSize: '24px', color: '#ffffff'})
                .setOrigin(0.5).setDepth(5).setVisible(false);
            rect.on('pointerdown', () => {
                clock.setSpeed(speed);
                this.#refresh();
            });
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
            const selected = speed === this.#clock.speed;
            rect.setStrokeStyle(3, selected ? SELECTED_STROKE : STROKE);
            proxy?.set({selected});
        }
    }
}
