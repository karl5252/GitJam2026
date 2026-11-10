import Phaser from 'phaser';
import {Grid} from '../core/grid.js';
import {generateJungle} from '../core/terrain.js';
import {audioFor} from '../audio/audio.js';
import {TerrainLayer} from './TerrainLayer.js';
import {HeliLayer} from './HeliLayer.js';
import {addArt, placeArt} from './SpriteArt.js';
import {
    ENDING_TIMING, LA_GUARDIA, SPEECH, STAGE, endingFrame, endingLengthMs, speechStartMs, stageLayout,
} from './presidentialEnding.js';

export {LA_GUARDIA};

export function preloadEndingArt(scene) {
    const {key, path, frameWidth, frameHeight, spacing} = LA_GUARDIA;
    scene.load.spritesheet(key, path, {frameWidth, frameHeight, spacing});
}

export function filterEndingArt(scene, nearest) {
    if (nearest !== undefined && scene.textures.exists(LA_GUARDIA.key)) scene.textures.get(LA_GUARDIA.key).setFilter?.(nearest);
}

const ACTOR_DEPTH = 10; // + y / 1000: further south draws in front, HQ included
const depthAt = (y) => ACTOR_DEPTH + y / 1000;

/**
 * TASK 036: the ceremonial grounds, a scene of its own above GameScene and the (sleeping)
 * HUD. It draws presidentialEnding.js's frames, plays papi_final.ogg through the one
 * presidential voice, and follows the recording's playback position while it really
 * plays; otherwise its own clock, with subtitles. It never waits on audio, touches no
 * simulation and asks for no random number. When the timeline is done it calls
 * `onComplete` once; GameScene ends the run.
 */
export class EndingScene extends Phaser.Scene {
    constructor() {
        super('ending');
    }

    init({onComplete = () => {}, speed = 1} = {}) {
        this.onComplete = onComplete;
        this.speed = speed > 0 ? speed : 1;
        this.t = 0;
        this.speechMs = null;
        this.audio = 'pending'; // pending | playing | fallback
        this.completed = false;
        this.frameView = null;
    }

    create() {
        const {width, height} = this.scale;
        this.cameras.main.setBackgroundColor('#000000');
        // The grounds: a small jungle from the stage's own seed, every tree in view felled.
        const grid = new Grid({cols: STAGE.cols, rows: STAGE.rows, tileSize: STAGE.tileSize, originX: 0, originY: 0});
        const terrain = generateJungle({cols: STAGE.cols, rows: STAGE.rows, seed: STAGE.seed, spawnFrame: STAGE.spawnFrame});
        const survivors = new Set(STAGE.survivors.map(([c, r]) => `${c},${r}`));
        const felled = [];
        for (let row = 0; row < STAGE.rows; row++) {
            for (let col = 0; col < STAGE.cols; col++) {
                if (!survivors.has(`${col},${row}`) && terrain.clear(col, row)) felled.push({col, row});
            }
        }
        this.terrainLayer = new TerrainLayer(this, grid, terrain);
        this.terrainLayer.clearTiles(felled);
        this.felled = felled.length;

        const hq = grid.footprintRect(STAGE.hq);
        this.stage = stageLayout(hq);
        this.hqArt = addArt(this, 'hq', depthAt(hq.y + hq.height));
        placeArt(this.hqArt, 'hq', hq.x + hq.width / 2, hq.y + hq.height - 2);
        this.hqArt?.setFrame(0);

        this.heliLayer = new HeliLayer(this);
        this.president = addArt(this, 'elcolonel', ACTOR_DEPTH)?.setVisible(false) ?? null;
        this.guards = [0, 1].map(() => (this.textures.exists(LA_GUARDIA.key)
            ? this.add.sprite(0, 0, LA_GUARDIA.key, 0).setOrigin(0.5, LA_GUARDIA.originY).setScale(LA_GUARDIA.scale).setVisible(false)
            : null));
        this.crowd = this.stage.crowd.map(({kind}) => addArt(this, kind, ACTOR_DEPTH));
        this.brute = addArt(this, 'brute', ACTOR_DEPTH)?.setVisible(false) ?? null;

        // Screen-space: subtitles and the fade, on a camera of their own that never zooms.
        this.subtitle = this.add.text(width / 2, height - 40, '', {
            fontFamily: 'monospace', fontSize: '30px', color: '#fff8dc', align: 'center',
            backgroundColor: '#000000aa', padding: {x: 14, y: 8}, wordWrap: {width: width - 160},
        }).setOrigin(0.5, 1).setDepth(100).setVisible(false);
        this.fade = this.add.rectangle(0, 0, width, height, 0x000000, 1).setOrigin(0, 0).setDepth(101);
        // Every press lands here, so nothing under the ceremony hears it.
        this.blocker = this.add.zone(0, 0, width, height).setOrigin(0, 0).setInteractive();
        const screen = [this.subtitle, this.fade, this.blocker];
        this.ui = this.cameras.add(0, 0, width, height);
        this.cameras.main.ignore(screen);
        this.ui.ignore(this.children.list.filter((o) => !screen.includes(o)));

        this.events.once('shutdown', () => this.cleanUp());
        this.sync();
    }

    /** The recording, once: through the presidential voice, so no tip or unit talks over it. */
    #startSpeech() {
        const manager = audioFor(this.game);
        this.audio = manager?.speak(SPEECH.event) ? 'playing' : 'fallback';
    }

    /** Seconds into the recording while it really plays and can be heard; otherwise null. */
    #audiblePosition() {
        const manager = audioFor(this.game);
        const at = manager?.presidentPosition?.(SPEECH.event) ?? null;
        if (at === null || manager.muted || manager.volume('master') * manager.volume('voices') <= 0) return null;
        return at;
    }

    update(_time, delta) {
        if (this.completed) return;
        const step = Math.min(Math.max(0, delta), 100) * this.speed; // a tab coming back skips nothing
        if (this.speechMs === null) {
            this.t += step;
            if (this.t >= speechStartMs()) {
                this.speechMs = this.t - speechStartMs();
                this.#startSpeech();
            }
        } else {
            const position = this.audio === 'playing' ? audioFor(this.game)?.presidentPosition?.(SPEECH.event) ?? null : null;
            // The recording leads while it plays; the scene's own clock carries on otherwise.
            this.speechMs = position !== null ? Math.max(this.speechMs, position * 1000) : this.speechMs + step;
            this.t = speechStartMs() + this.speechMs;
        }
        this.sync();
        if (this.frameView.phase === 'done') this.#complete();
    }

    #complete() {
        if (this.completed) return;
        this.completed = true;
        audioFor(this.game)?.silence?.();
        this.onComplete();
    }

    /** TEST_MODE: jump the timeline to `ms`. The recording, if any, stops; the clock takes over. */
    seek(ms) {
        if (this.completed) return null;
        audioFor(this.game)?.silence?.();
        this.audio = this.speechMs === null && ms < speechStartMs() ? 'pending' : 'fallback';
        this.t = Math.min(Math.max(0, ms), endingLengthMs() - 1);
        this.speechMs = this.t >= speechStartMs() ? this.t - speechStartMs() : null;
        this.sync();
        return this.view();
    }

    sync() {
        const f = endingFrame(this.t, this.stage, this.speechMs);
        this.frameView = f;
        this.cameras.main.setZoom(f.camera.zoom).centerOn(f.camera.x, f.camera.y);
        this.heliLayer.sync(f.heli);
        const place = (sprite, kind, pose) => {
            if (!sprite) return;
            sprite.setVisible(pose.visible !== false);
            if (pose.visible === false) return;
            if (kind) placeArt(sprite, kind, pose.x, pose.y);
            else sprite.setPosition(pose.x, pose.y);
            sprite.setFrame(pose.frame).setFlipX(pose.flip).setDepth(depthAt(pose.y));
        };
        place(this.president, 'elcolonel', f.president);
        f.guards.forEach((pose, i) => place(this.guards[i], null, pose));
        f.crowd.forEach((pose, i) => place(this.crowd[i], pose.kind, pose));
        place(this.brute, 'brute', f.brute);
        // Brute in front of whoever it is eating.
        if (this.brute && f.brute.visible) this.brute.setDepth(depthAt(f.brute.y) + 0.01);
        const words = f.subtitle !== null && this.#audiblePosition() === null ? f.subtitle : null;
        this.subtitle.setText(words ?? '').setVisible(words !== null);
        this.fade.setAlpha(f.fade);
    }

    /** What QA reads. */
    view() {
        const f = this.frameView;
        if (!f) return null;
        const shown = (s) => Boolean(s?.visible);
        return {
            phase: f.phase,
            cue: f.cue,
            t: f.t,
            speechMs: f.speechMs,
            audio: this.audio,
            fade: f.fade,
            subtitle: this.subtitle.visible ? this.subtitle.text : null,
            camera: {...f.camera},
            felled: this.felled,
            hq: {drawn: Boolean(this.hqArt?.visible), texture: this.hqArt?.texture.key ?? null, ...this.stage.hq},
            heli: {...f.heli, drawn: this.heliLayer.view()},
            president: {...f.president, drawn: shown(this.president)},
            guards: this.guards.filter(Boolean).length,
            guardsShown: this.guards.filter(shown).length,
            guardTexture: this.guards[0]?.texture.key ?? null,
            guardStates: f.guards.map((g) => g.state),
            guardFrames: this.guards.map((g) => (g ? Number(g.frame.name) : null)),
            crowd: {
                workers: f.crowd.filter((a) => a.kind === 'worker').length,
                ecologists: f.crowd.filter((a) => a.kind === 'ecologist').length,
                drawn: this.crowd.filter(shown).length,
                states: [...new Set(f.crowd.map((a) => a.state))].sort(),
            },
            brute: {...f.brute, drawn: shown(this.brute)},
            completed: this.completed,
            timing: {speechStartMs: ENDING_TIMING.speechStartMs, lengthMs: endingLengthMs()},
        };
    }

    /** Shut down (the run ended, or restarted): the speech stops and every actor goes with the scene. */
    cleanUp() {
        if (this.audio === 'playing') audioFor(this.game)?.silence?.();
        this.heliLayer?.destroy();
        this.heliLayer = null;
        this.frameView = null;
    }
}
