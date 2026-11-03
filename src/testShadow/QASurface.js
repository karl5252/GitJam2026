// systems/QASurface.js
//
// THE observable contract for detailed, on-demand state — window.__qa.
// Playwright calls window.__qa.getState() and gets a live snapshot,
// computed at assert time. Nothing here is written to the DOM every frame.
//
// Reserve <body data-*> (markScene()/setBodyState() in TestProxy.js) for a
// FEW thick, HUD-level scalars worth polling with toHaveAttribute() —
// scene identity, phase, which input source is active. Put everything
// else — positions, per-entity detail, counts — behind this instead.
// Writing every tracked entity's x/y to the DOM every frame is wasted work
// for state nothing ever clicks; getState() costs nothing until a test
// actually calls it.
//
// Each scene supplies its own getState() function — what's worth exposing
// is entirely scene-specific, so this class only wires it up and tears it
// down on shutdown, the same shape across every scene that uses it.

import {TEST_MODE} from '../testMode.js';

export class QASurface {
    /**
     * @param {Phaser.Scene} scene - the scene that owns this surface
     * @param {() => object} getState - computes a fresh snapshot on demand
     */
    constructor(scene, getState) {
        this.scene = scene;
        if (!TEST_MODE) return;

        window.__qa = {getState: () => getState()};

        scene.events.once('shutdown', () => this.destroy());
    }

    destroy() {
        if (window.__qa) delete window.__qa;
        this.scene = null;
    }
}
