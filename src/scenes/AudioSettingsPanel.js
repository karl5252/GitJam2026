import {addProxy} from '../testShadow/TestProxy.js';
import {HudButton, TONE} from './HudButton.js';

const DEPTH = 14; // over the drawer and the palette, under La Voz (18) and Game Over (20)
const CHANNELS = Object.freeze([
    ['master', 'MASTER'],
    ['music', 'MUSIC'],
    ['sfx', 'SFX'],
    ['voices', 'VOICES'],
]);
const STEP = 0.05;
const TRACK = 0x1c262b;
const FILL = 0xc7a34a;
const KNOB = 0xf5f5f5;

/**
 * TASK 032: the audio settings, a compact panel over the HUD. Four sliders and MUTE,
 * all through the existing SoundManager (`setVolume`, `setMuted`), which saves them
 * as settings version 2. Presentation only; the M key still mutes, and the panel
 * follows it. A press outside the panel closes it and does nothing else.
 */
export class AudioSettingsPanel {
    #scene;
    #manager;
    #spec;
    #objects = [];
    #rows = [];
    #mute;
    #close;
    #dragging = null;
    #open = false;
    #proxies = [];
    #shown = null; // what was last drawn, so a frame changes nothing when nothing changed
    #onChange; // (open) => void: the HUD holds the world while the panel is open

    constructor(scene, manager, spec, {onChange = null} = {}) {
        this.#onChange = onChange;
        this.#scene = scene;
        this.#manager = manager;
        this.#spec = spec;
        const {x, y, width, height} = spec.panel;
        const font = spec.fontSize;
        const dimmer = scene.add.rectangle(0, 0, scene.scale.width, scene.scale.height, 0x000000, 0.45).setOrigin(0, 0)
            .setDepth(DEPTH).setInteractive();
        dimmer.on('pointerdown', () => this.close());
        const panel = scene.add.rectangle(x, y, width, height, 0x263238, 0.98).setStrokeStyle(4, 0xc7a34a).setDepth(DEPTH)
            .setInteractive(); // a press on the panel is the panel's
        const title = scene.add.text(x, y - height / 2 + 34, 'AUDIO', {fontFamily: 'monospace', fontSize: font, fontStyle: 'bold', color: '#f8d88b'})
            .setOrigin(0.5).setDepth(DEPTH + 1);
        this.#objects.push(dimmer, panel, title);
        const {slider} = spec;
        const top = y - height / 2 + 34 + slider.height * 1.1;
        const rowStep = slider.height * 1.15;
        const labelX = x - width / 2 + 24;
        const trackX = x - width / 2 + width * 0.28;
        CHANNELS.forEach(([channel, name], i) => {
            const rowY = top + i * rowStep;
            const label = scene.add.text(labelX, rowY, name, {fontFamily: 'monospace', fontSize: font, color: '#ffffff'})
                .setOrigin(0, 0.5).setDepth(DEPTH + 1);
            const track = scene.add.rectangle(trackX, rowY, slider.width, slider.height, 0x000000, 0).setOrigin(0, 0.5)
                .setDepth(DEPTH + 1).setInteractive({useHandCursor: true});
            const groove = scene.add.rectangle(trackX, rowY, slider.width, Math.max(8, slider.height / 5), TRACK)
                .setOrigin(0, 0.5).setStrokeStyle(2, 0x90a4ae).setDepth(DEPTH + 1);
            const fill = scene.add.rectangle(trackX, rowY, 0, Math.max(8, slider.height / 5), FILL).setOrigin(0, 0.5).setDepth(DEPTH + 2);
            const knob = scene.add.rectangle(trackX, rowY, slider.knob * 0.6, slider.knob, KNOB).setStrokeStyle(2, 0x101010).setDepth(DEPTH + 3);
            const value = scene.add.text(trackX + slider.width + 16, rowY, '', {fontFamily: 'monospace', fontSize: font, color: '#c8e6c9'})
                .setOrigin(0, 0.5).setDepth(DEPTH + 1);
            track.on('pointerdown', (pointer) => {
                this.#dragging = channel;
                this.#setFromPointer(channel, pointer);
            });
            this.#rows.push({channel, name, track, groove, fill, knob, value, x: trackX, width: slider.width});
            this.#objects.push(label, track, groove, fill, knob, value);
        });
        const buttonY = top + CHANNELS.length * rowStep + slider.height * 0.2;
        const buttonSize = {width: width * 0.36, height: Math.max(76, slider.height)};
        this.#mute = new HudButton(scene, {x: x - width * 0.21, y: buttonY, ...buttonSize, fontSize: font},
            {depth: DEPTH + 1, onPress: () => this.#toggleMute()});
        this.#close = new HudButton(scene, {x: x + width * 0.21, y: buttonY, ...buttonSize, fontSize: font},
            {text: 'CLOSE', depth: DEPTH + 1, onPress: () => this.close()});
        scene.input.on('pointermove', this.#onMove, this);
        scene.input.on('pointerup', this.#onUp, this);
        scene.events.once('shutdown', () => {
            scene.input.off('pointermove', this.#onMove, this);
            scene.input.off('pointerup', this.#onUp, this);
        });
        this.#setVisible(false);
    }

    get open() {
        return this.#open;
    }

    toggle() {
        if (this.#open) this.close();
        else this.show();
    }

    show() {
        if (this.#open) return;
        this.#open = true;
        this.#setVisible(true);
        this.#onChange?.(true);
        this.#rows.forEach(({channel, name, track}) => this.#proxies.push(
            addProxy(this.#scene, track, `audio-volume-${channel}`, {label: `${name} volume`, type: 'slider'})));
        this.#proxies.push(addProxy(this.#scene, this.#mute.rect, 'audio-mute', {label: 'Mute'}));
        this.#proxies.push(addProxy(this.#scene, this.#close.rect, 'close-audio', {label: 'Close audio settings'}));
        this.#shown = null;
        this.render();
    }

    close() {
        if (!this.#open) return;
        this.#open = false;
        this.#dragging = null;
        this.#onChange?.(false);
        for (const proxy of this.#proxies) proxy.destroy();
        this.#proxies = [];
        this.#setVisible(false);
    }

    /** Each frame while open, so the M key or anything else that changes a setting shows at once. */
    render() {
        if (!this.#open) return;
        const state = this.#state();
        const key = JSON.stringify(state);
        if (key === this.#shown) return;
        this.#shown = key;
        for (const row of this.#rows) {
            const level = state.volumes[row.channel];
            row.fill.setSize(row.width * level, row.fill.height);
            row.knob.setPosition(row.x + row.width * level, row.track.y);
            row.value.setText(`${Math.round(level * 100)}%`);
            const alpha = state.muted ? 0.5 : 1;
            for (const part of [row.fill, row.knob, row.value]) part.setAlpha(alpha);
        }
        this.#mute.setLabel(state.muted ? 'SOUND OFF' : 'MUTE').setTone(state.muted ? TONE.stop : TONE.neutral).setSelected(state.muted);
        const [mute] = this.#proxies.slice(CHANNELS.length);
        this.#proxies.slice(0, CHANNELS.length).forEach((proxy, i) => proxy.set({value: Math.round(state.volumes[CHANNELS[i][0]] * 100)}));
        mute?.set({muted: state.muted}).label(state.muted ? 'Unmute' : 'Mute');
    }

    view() {
        return {open: this.#open, ...this.#state()};
    }

    #state() {
        return {
            muted: this.#manager.muted,
            volumes: Object.fromEntries(CHANNELS.map(([channel]) => [channel, this.#manager.volume(channel)])),
        };
    }

    #toggleMute() {
        if (!this.#manager.toggleMute()) this.#manager.play('ui.toggle');
        this.render();
    }

    #setFromPointer(channel, pointer) {
        const row = this.#rows.find((r) => r.channel === channel);
        const raw = (pointer.x - row.x) / row.width;
        const level = Math.round(Math.min(1, Math.max(0, raw)) / STEP) * STEP;
        if (Math.abs(level - this.#manager.volume(channel)) > 1e-9) this.#manager.setVolume(channel, Number(level.toFixed(2)));
        this.render();
    }

    #onMove(pointer) {
        if (this.#dragging && pointer.isDown) this.#setFromPointer(this.#dragging, pointer);
    }

    #onUp() {
        if (!this.#dragging) return;
        const channel = this.#dragging;
        this.#dragging = null;
        // A click at the new level; music is its own feedback.
        if (channel !== 'music') this.#manager.play('ui.click');
    }

    #setVisible(visible) {
        for (const object of this.#objects) {
            object.setVisible(visible);
            if (object.input) {
                if (visible) object.setInteractive();
                else object.disableInteractive();
            }
        }
        this.#mute.setVisible(visible);
        this.#close.setVisible(visible);
    }
}
