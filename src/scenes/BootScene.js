import Phaser from 'phaser';

/**
 * Deliberately empty for now — no assets yet. Extend preload() when real
 * art and audio are added, then hand off to the game scene.
 */
export class BootScene extends Phaser.Scene {
    constructor() {
        super('boot');
    }

    create() {
        this.scene.start('game');
    }
}
