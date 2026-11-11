import {addProxy} from '../testShadow/TestProxy.js';
import {HudButton, TONE} from './HudButton.js';

/**
 * TASK 044: the office menu's campaign controls, hosted by HUDScene beside START, BOOK
 * and SOUND, in the same row of HUD buttons. CONTINUE is shown only while GameScene
 * offers a valid save for this world; START asks first when that would end it. The
 * menu changes nothing itself: it emits the HUD's commands through the callbacks.
 */

/** Left of START, in the row's free space (BOOK ends at x 228, START begins at 510). */
export const CONTINUE_BUTTON = Object.freeze({x: 369, y: 668, width: 260, height: 88});
const NOTICE_Y = 604; // just above the row, over the floor
const DIALOG = Object.freeze({width: 760, height: 330, y: 360});

/** Why a save could not be used, in the player's words. */
export const MENU_NOTICES = Object.freeze({
    'restore-failed': 'The campaign could not be restored. Your save was kept.',
    'malformed': 'The saved campaign could not be read.',
    'invalid-checkpoint': 'The saved campaign could not be read.',
    'unsupported-version': 'The saved campaign is from another version of the game.',
    'incompatible-world': 'The saved campaign belongs to another world.',
    'no-save': 'There is no saved campaign.',
    'campaign-ended': 'That campaign has ended.',
});

/** CONTINUE's label: the HUD's Day N, or the Presidential Visit that the Day 100 dawn leads to. */
export const continueLabel = ({day, ending}) => (ending ? 'CONTINUE\nTHE VISIT' : `CONTINUE\nDAY ${day}`);

export class CampaignMenu {
    #scene;
    #depth;
    #onContinue;
    #onNewGame;
    #offer = null;
    #dialog = null;

    /**
     * @param {Phaser.Scene} scene
     * @param {{depth: number, onContinue: () => void, onNewGame: () => void}} options
     */
    constructor(scene, {depth, onContinue, onNewGame}) {
        this.#scene = scene;
        this.#depth = depth;
        this.#onContinue = onContinue;
        this.#onNewGame = onNewGame;
        this.continueButton = new HudButton(scene, {...CONTINUE_BUTTON, fontSize: '26px'}, {
            text: 'CONTINUE', tone: TONE.go, depth, onPress: () => this.#onContinue(),
        }).setVisible(false);
        this.continueProxy = addProxy(scene, this.continueButton.rect, 'continue', {label: 'Continue'}).show(false);
        // Readable on a phone: large type on its own dark band, never over a button.
        this.noticeBand = scene.add.rectangle(scene.scale.width / 2, NOTICE_Y, 1040, 50, 0x101914, 0.86).setDepth(depth).setVisible(false); // the longest notice, 56 characters at 28 px, fits
        this.notice = scene.add.text(scene.scale.width / 2, NOTICE_Y, '', {
            fontFamily: 'monospace', fontSize: '28px', color: '#ffcc80', align: 'center', fontStyle: 'bold',
        }).setOrigin(0.5).setDepth(depth + 0.1).setVisible(false);
    }

    /** Is there a campaign that START would end? */
    get offered() {
        return this.#offer !== null;
    }

    /** GameScene's State.CAMPAIGN: {offer: {day, ending} | null, notice} */
    setOffer({offer, notice}) {
        this.#offer = offer ?? null;
        this.continueButton.setVisible(Boolean(offer));
        if (offer) this.continueButton.setLabel(continueLabel(offer));
        this.continueProxy.show(Boolean(offer)).label(offer ? continueLabel(offer).replace('\n', ' ') : 'Continue');
        const text = notice ? MENU_NOTICES[notice] ?? 'The saved campaign could not be used.' : '';
        this.notice.setText(text).setVisible(text !== '');
        this.noticeBand.setVisible(text !== '');
        if (!offer) this.closeConfirm();
    }

    /** START with a saved campaign: ask first. */
    openConfirm() {
        if (this.#dialog) return;
        const scene = this.#scene;
        const {width, height} = scene.scale;
        const depth = this.#depth + 2;
        const top = DIALOG.y - DIALOG.height / 2;
        const parts = [
            scene.add.rectangle(0, 0, width, height, 0x000000, 0.6).setOrigin(0, 0).setDepth(depth).setInteractive(), // takes every other press
            scene.add.rectangle(width / 2, DIALOG.y, DIALOG.width, DIALOG.height, 0x14231d, 0.97).setStrokeStyle(4, 0xb88a3a).setDepth(depth),
            scene.add.text(width / 2, top + 58, 'START A NEW CAMPAIGN?', {
                fontFamily: 'monospace', fontSize: '38px', color: '#f8d88b', fontStyle: 'bold',
            }).setOrigin(0.5).setDepth(depth + 0.1),
            scene.add.text(width / 2, top + 132, 'Your current campaign progress will be lost.', {
                fontFamily: 'monospace', fontSize: '26px', color: '#ffffff', align: 'center', wordWrap: {width: DIALOG.width - 60},
            }).setOrigin(0.5).setDepth(depth + 0.1),
        ];
        const buttonY = top + DIALOG.height - 78;
        const cancel = new HudButton(scene, {x: width / 2 - 180, y: buttonY, width: 300, height: 88, fontSize: '26px'}, {
            text: 'CANCEL', tone: TONE.neutral, depth: depth + 0.5, onPress: () => this.closeConfirm(),
        });
        const confirm = new HudButton(scene, {x: width / 2 + 180, y: buttonY, width: 300, height: 88, fontSize: '24px'}, {
            text: 'START NEW GAME', tone: TONE.danger, depth: depth + 0.5, onPress: () => {
                this.closeConfirm();
                this.#onNewGame();
            },
        });
        const proxies = [
            addProxy(scene, cancel.rect, 'cancel-new-game', {label: 'Cancel'}),
            addProxy(scene, confirm.rect, 'confirm-new-game', {label: 'Start new game'}),
        ];
        this.#dialog = {parts, buttons: [cancel, confirm], proxies};
    }

    closeConfirm() {
        if (!this.#dialog) return;
        for (const part of this.#dialog.parts) part.destroy();
        for (const button of this.#dialog.buttons) button.destroy();
        for (const proxy of this.#dialog.proxies) proxy.destroy();
        this.#dialog = null;
    }

    /** What is really on screen, for QA. */
    view() {
        return {
            continueVisible: this.continueButton.visible,
            continueLabel: this.#offer ? this.continueButton.text.text : null,
            confirmOpen: Boolean(this.#dialog),
            notice: this.notice.visible ? this.notice.text : null,
        };
    }

    destroy() {
        this.closeConfirm();
        this.continueButton.destroy();
        this.continueProxy.destroy();
        this.noticeBand.destroy();
        this.notice.destroy();
    }
}
