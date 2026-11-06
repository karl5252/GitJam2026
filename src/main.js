import Phaser from 'phaser';
import {BootScene} from './scenes/BootScene.js';
import {GameScene} from './scenes/GameScene.js';
import {HUDScene} from './scenes/HUDScene.js';
import {installOrientationGuard} from './scenes/orientationGuard.js';
import {TEST_MODE} from './testMode.js';

/**
 * Phaser 4 ESM note: there is no global `window.Phaser` anymore. Every file
 * that touches Phaser.* (Scene, Math, etc.) must `import Phaser from 'phaser'`
 * explicitly — this file and every scene file do exactly that.
 *
 * dom: {createContainer: TEST_MODE} is required for scene.add.dom(...) to
 * work at all — without it, every addProxy() call is a no-op even in dev,
 * because Phaser never creates the DOM overlay to attach to. Gating creation
 * on TEST_MODE means production builds pay zero cost for a container they
 * never populate.
 *
 * Scale.FIT keeps the 1280x720 (16:9) game letterboxed inside any desktop
 * window or mobile landscape viewport. #game-root is inset by the safe areas in
 * index.html, so nothing lands under a notch.
 */
const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-root',
    width: 1280,
    height: 720,
    backgroundColor: '#263238',
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    dom: {createContainer: TEST_MODE},
    input: {activePointers: 3}, // the mouse and two fingers
    scene: [BootScene, GameScene, HUDScene],
});

installOrientationGuard(game);
