// systems/TestProxy.js
//
// Exposes canvas UI as measurable DOM elements so Playwright can find them
// with getBounds() and click through with page.mouse.click().
//
// The proxies deliberately do NOT handle clicks. pointer-events is off, so
// the click falls through to the canvas and Phaser's own pointerdown handler
// runs — meaning tests exercise the real input path, not a test-only shim.
//
// Reserve this for elements that are genuinely clickable. Something that's
// only ever tracked (never clicked) doesn't belong here — see QASurface.js
// for that case; a DOM div with pointer-events:none earns its cost only
// when the click-passthrough it enables is actually needed.
//
// Everything here no-ops when TEST_MODE is false.

import {TEST_MODE} from '../testMode.js';

// Outside TEST_MODE a proxy is this: every method a real proxy has, doing nothing.
// label() was missing, so any control that relabels its proxy threw in a normal
// session (found in TASK 030: the menu's SOUND button stopped the HUD, and all audio).
const NOOP = Object.freeze({
    node: null, set() {
        return NOOP;
    }, label() {
        return NOOP;
    }, show() {
        return NOOP;
    }, destroy() {
    }
});

/**
 * Create a DOM stand-in that tracks a Game Object's screen rectangle.
 *
 * Positioned from getBounds() with origin (0,0), so it works regardless of
 * the source object's origin — sprite buttons (0.5) and the language labels
 * (0, 0.5) both land correctly.
 *
 * @param scene       Phaser scene
 * @param gameObject  the thing being mirrored (image, text, rectangle)
 * @param action      stable id for tests, e.g. 'play', 'difficulty-hard'.
 *                    Use this in selectors, NOT the label — labels change
 *                    with the language.
 * @param opts.label  aria-label (human-readable, may be localised)
 * @param opts.type   data-type, defaults to 'button'
 * @param opts.state  initial data-* props
 */
export function addProxy(scene, gameObject, action, opts = {}) {
    if (!TEST_MODE) return NOOP;

    const b = gameObject.getBounds();

    const dom = scene.add.dom(b.x, b.y, 'div');
    dom.setOrigin(0, 0);
    dom.pointerEvents = 'none'; // MUST be set on the GO — DOMElement rewrites
                                // node.style every frame and would clobber CSS.

    const node = dom.node;
    node.style.width = `${b.width}px`;
    node.style.height = `${b.height}px`;
    node.dataset.type = opts.type ?? 'button';
    node.dataset.action = action;
    node.setAttribute('role', 'button');
    if (opts.label) node.setAttribute('aria-label', opts.label);

    dom.updateSize(); // re-measure after styling, or Phaser centres against a
                      // stale box and the proxy sits half a tile off.

    const api = {
        dom,
        node,
        /** write data-* props, only on change */
        set(props = {}) {
            for (const [k, v] of Object.entries(props)) {
                const s = String(v);
                if (node.dataset[k] !== s) node.dataset[k] = s;
            }
            return api;
        },
        label(text) {
            node.setAttribute('aria-label', text);
            return api;
        },
        /** For a control that exists but is out of sight, like a closed drawer's. */
        show(visible) {
            dom.setVisible(visible);
            return api;
        },
        destroy() {
            dom.destroy();
        },
    };

    if (opts.state) api.set(opts.state);
    return api;
}

/**
 * Reflect scene-level state onto <body> so tests can assert without
 * reaching into any particular element.
 *   markScene(this, {difficulty: 'normal', lang: 'en'})
 */
export function markScene(scene, state = {}) {
    if (!TEST_MODE) return;

    const key = scene.scene.key;
    const stateKeys = Object.keys(state);

    document.body.dataset.scene = key;
    setBodyState(state);

    scene.events.once('shutdown', () => {
        if (document.body.dataset.scene === key) {
            delete document.body.dataset.scene;
        }

        for (const stateKey of stateKeys) {
            delete document.body.dataset[stateKey];
        }
    });
}

/** Update <body data-*> without touching data-scene. */
export function setBodyState(state = {}) {
    if (!TEST_MODE) return;
    for (const [k, v] of Object.entries(state)) {
        document.body.dataset[k] = String(v);
    }
}

/**
 * For scenes launched OVER another (Controls sits on top of a paused
 * MainMenu). Uses data-modal so it doesn't stomp data-scene.
 */
export function markModal(scene, name) {
    if (!TEST_MODE) return;
    document.body.dataset.modal = name;
    scene.events.once('shutdown', () => {
        if (document.body.dataset.modal === name) {
            delete document.body.dataset.modal;
        }
    });
}

/** For non-scene overlays (credits). Returns a close fn. */
export function markOverlay(name) {
    if (!TEST_MODE) return () => {
    };
    document.body.dataset.overlay = name;
    return () => {
        if (document.body.dataset.overlay === name) {
            delete document.body.dataset.overlay;
        }
    };
}
