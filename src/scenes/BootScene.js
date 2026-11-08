import Phaser from 'phaser';
import {preloadArt, ART, artKey} from './SpriteArt.js';
import {preloadOfficeArt, filterOfficeArt} from './OfficeMenuArt.js';

/**
 * Preloads the independent micro-scale PNG sprite sheets before starting the
 * game. Sprite drawing does not change domain rules or QA snapshots.
 */
export class BootScene extends Phaser.Scene {
    constructor() {
        super('boot');
    }

    preload() {
        preloadArt(this);
        preloadOfficeArt(this);
    }

    create() {
        // Keep unfiltered pixel edges when the world camera zooms.
        const nearest = Phaser.Textures?.FilterMode?.NEAREST;
        if (nearest !== undefined) {
            for (const kind of Object.keys(ART)) {
                if (this.textures.exists(artKey(kind))) this.textures.get(artKey(kind)).setFilter?.(nearest);
            }
        }
        filterOfficeArt(this, nearest);
        this.scene.start('game');
    }
}
