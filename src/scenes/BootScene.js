import Phaser from 'phaser';
import {preloadArt, ART, artKey} from './SpriteArt.js';
import {preloadOfficeArt, filterOfficeArt} from './OfficeMenuArt.js';
import {KILLDOZER} from './killdozerIcon.js';
import {filterNewspaperArt, preloadNewspaperArt} from './newspaperArt.js';
import {preloadEffects} from '../audio/audio.js';
import {filterCombatFx, preloadCombatFx} from './CombatFxLayer.js';

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
        this.load.image(KILLDOZER.key, KILLDOZER.path); // the DESTROY icon
        preloadNewspaperArt(this); // La Voz's photographs
        preloadEffects(this); // TASK 030: effects and voices; music follows the first gesture
        preloadCombatFx(this); // TASK 031: the three explosion strips
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
        filterNewspaperArt(this, nearest);
        filterCombatFx(this, nearest);
        if (nearest !== undefined && this.textures.exists(KILLDOZER.key)) this.textures.get(KILLDOZER.key).setFilter?.(nearest);
        this.scene.start('game');
    }
}
