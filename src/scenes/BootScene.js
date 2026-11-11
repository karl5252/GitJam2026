import Phaser from 'phaser';
import {preloadArt, ART, artKey} from './SpriteArt.js';
import {preloadOfficeArt, filterOfficeArt} from './OfficeMenuArt.js';
import {KILLDOZER} from './killdozerIcon.js';
import {UI_ART} from './uiArt.js';
import {filterNewspaperArt, preloadNewspaperArt} from './newspaperArt.js';
import {preloadEffects} from '../audio/audio.js';
import {filterCombatFx, preloadCombatFx} from './CombatFxLayer.js';
import {filterHeli, preloadHeli} from './HeliLayer.js';
import {filterEndingArt, preloadEndingArt} from './EndingScene.js';
import {ROAD_SOURCE, buildRoadTexture} from './RoadTiles.js';
import {VEGETATION_SHEET} from './vegetation.js';

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
        for (const {key, path} of Object.values(UI_ART)) this.load.image(key, path); // TASK 032: button frames, the wrench
        preloadNewspaperArt(this); // La Voz's photographs
        preloadEffects(this); // TASK 030: effects and voices; music follows the first gesture
        preloadCombatFx(this); // TASK 031: the three explosion strips
        preloadHeli(this); // TASK 035: the Presidential helicopter
        preloadEndingArt(this); // TASK 036: the Presidential guards
        this.load.image(ROAD_SOURCE.key, ROAD_SOURCE.path); // TASK 039: road autotiles
        this.load.image(VEGETATION_SHEET.key, VEGETATION_SHEET.path); // TASK 039: painted into the terrain
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
        filterHeli(this, nearest);
        filterEndingArt(this, nearest);
        buildRoadTexture(this, nearest);
        if (nearest !== undefined && this.textures.exists(KILLDOZER.key)) this.textures.get(KILLDOZER.key).setFilter?.(nearest);
        for (const {key} of Object.values(UI_ART)) {
            if (nearest !== undefined && this.textures.exists(key)) this.textures.get(key).setFilter?.(nearest);
        }
        this.scene.start('game');
    }
}
