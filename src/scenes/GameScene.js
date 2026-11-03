import Phaser from 'phaser';
import {GamePhase, startGame} from '../core/gamePhase.js';
import {addProxy, markScene, setBodyState} from '../testShadow/TestProxy.js';
import {QASurface} from '../testShadow/QASurface.js';

/**
 * Placeholder scene for PAPI Industries: The Green Shift. No gameplay yet —
 * a title and a Start button that moves the phase from READY to STARTED.
 *
 * Test Shadow usage:
 *   - addProxy('start') — the button is genuinely clicked, so it gets a
 *     click-passthrough DOM proxy.
 *   - markScene()/setBodyState() — coarse `data-phase` on <body>.
 *   - QASurface — detailed snapshot via window.__qa.getState().
 */
export class GameScene extends Phaser.Scene {
    constructor() {
        super('game');
    }

    create() {
        const {width, height} = this.scale;
        this.phase = GamePhase.READY;

        this.add.text(width / 2, height / 2 - 120, 'PAPI Industries: The Green Shift', {
            fontFamily: 'monospace',
            fontSize: '48px',
            color: '#c8e6c9',
        }).setOrigin(0.5);

        this.startButton = this.add.rectangle(width / 2, height / 2 + 40, 240, 72, 0x2e7d32)
            .setStrokeStyle(3, 0xa5d6a7)
            .setInteractive({useHandCursor: true});
        this.add.text(this.startButton.x, this.startButton.y, 'START', {
            fontFamily: 'monospace',
            fontSize: '32px',
            color: '#ffffff',
        }).setOrigin(0.5);

        this.startButton.on('pointerdown', () => {
            this.phase = startGame(this.phase);
            setBodyState({phase: this.phase});
        });

        addProxy(this, this.startButton, 'start', {label: 'Start'});

        // Instantiated BEFORE markScene: the QA surface should exist by the
        // time a test sees data-scene appear.
        this.qa = new QASurface(this, () => ({
            scene: this.scene.key,
            phase: this.phase,
            width: this.scale.width,
            height: this.scale.height,
        }));

        markScene(this, {phase: this.phase});
    }
}
