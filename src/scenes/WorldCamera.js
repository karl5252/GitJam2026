import {clampView, fitView, fitZoom, inViewport, panBy, screenToWorld, worldToScreen, zoomAt} from './cameraView.js';

const MAX_ZOOM = 3.2;
const STEP = 1.25;

/**
 * GameScene's main camera, drawn in the viewport the layout leaves beside the HUD.
 * The HUD has its own scene and camera, so nothing here can move it. On desktop the
 * fitted view is exactly the unzoomed screen, so a world point keeps its old pixel.
 */
export class WorldCamera {
    #camera;
    #viewport;
    #world;
    #dayZoom;
    #view;

    /**
     * @param {Phaser.Cameras.Scene2D.Camera} camera
     * @param {{viewport: {x, y, width, height}, dayZoom: number|null}} layout
     * @param {{x, y, width, height}} world what the camera may show
     */
    constructor(camera, {viewport, dayZoom}, world) {
        this.#camera = camera;
        this.#viewport = viewport;
        this.#world = world;
        this.#dayZoom = dayZoom;
        camera.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
        this.fit();
    }

    fit() {
        this.#show(fitView(this.#viewport, this.#world));
    }

    /** Frame part of the world. It is a view like any other: the player can still zoom out past it. */
    showArea(area) {
        this.#show(clampView(fitView(this.#viewport, area), this.#viewport, this.#world));
    }

    /** Closer in for placing buildings, where the layout asks for it. Otherwise the view stays. */
    showDay(focus) {
        if (this.#dayZoom === null) return;
        this.#show(clampView({zoom: this.#dayZoom, ...focus}, this.#viewport, this.#world));
    }

    zoomIn(anchor) {
        this.zoomBy(STEP, anchor);
    }

    zoomOut(anchor) {
        this.zoomBy(1 / STEP, anchor);
    }

    zoomBy(factor, anchor = this.#center()) {
        this.#show(zoomAt(this.#view, this.#viewport, this.#world, factor, anchor, MAX_ZOOM));
    }

    panBy(dx, dy) {
        this.#show(panBy(this.#view, this.#viewport, this.#world, dx, dy));
    }

    /** The world point under a screen point, or null outside the viewport. */
    worldAt(point) {
        return inViewport(this.#viewport, point) ? screenToWorld(this.#view, this.#viewport, point) : null;
    }

    /** Is this world point on screen right now? */
    isVisible(point) {
        return inViewport(this.#viewport, this.screenAt(point));
    }

    screenAt(point) {
        return worldToScreen(this.#view, this.#viewport, point);
    }

    snapshot() {
        return {...this.#view, viewport: {...this.#viewport}, fitZoom: fitZoom(this.#viewport, this.#world), maxZoom: MAX_ZOOM};
    }

    #center() {
        return {x: this.#viewport.x + this.#viewport.width / 2, y: this.#viewport.y + this.#viewport.height / 2};
    }

    #show(view) {
        this.#view = view;
        this.#camera.setZoom(view.zoom);
        this.#camera.centerOn(view.x, view.y);
    }
}
