/**
 * World camera maths. Pure: no Phaser, so it can be tested in Node, and it is
 * always right at once, where Phaser's own matrix only catches up on the next
 * render. Nothing here touches the simulation: a view only decides what is shown.
 *
 * A view is {zoom, x, y}, with x and y the world point at the centre of the
 * viewport. A viewport is the screen rectangle the world is drawn in, in logical
 * pixels. `world` is the rectangle the camera may show.
 */

export const fitZoom = (viewport, world) => Math.min(viewport.width / world.width, viewport.height / world.height);

const clampAxis = (center, half, start, size) => {
    if (size <= half * 2) return start + size / 2;
    return Math.min(Math.max(center, start + half), start + size - half);
};

/** Keep the view on the world: too small to fill it, the world is centred. */
export function clampView({zoom, x, y}, viewport, world) {
    return {
        zoom,
        x: clampAxis(x, viewport.width / 2 / zoom, world.x, world.width),
        y: clampAxis(y, viewport.height / 2 / zoom, world.y, world.height),
    };
}

export const fitView = (viewport, world) => ({
    zoom: fitZoom(viewport, world),
    x: world.x + world.width / 2,
    y: world.y + world.height / 2,
});

export const screenToWorld = ({zoom, x, y}, viewport, point) => ({
    x: x + (point.x - viewport.x - viewport.width / 2) / zoom,
    y: y + (point.y - viewport.y - viewport.height / 2) / zoom,
});

export const worldToScreen = ({zoom, x, y}, viewport, point) => ({
    x: viewport.x + viewport.width / 2 + (point.x - x) * zoom,
    y: viewport.y + viewport.height / 2 + (point.y - y) * zoom,
});

export const inViewport = (viewport, {x, y}) => x >= viewport.x && x < viewport.x + viewport.width
    && y >= viewport.y && y < viewport.y + viewport.height;

/** Zoom keeping the world point under `anchor` where it is, as far as the limits allow. */
export function zoomAt(view, viewport, world, factor, anchor, maxZoom) {
    const zoom = Math.min(Math.max(view.zoom * factor, fitZoom(viewport, world)), maxZoom);
    const held = screenToWorld(view, viewport, anchor);
    return clampView({
        zoom,
        x: held.x - (anchor.x - viewport.x - viewport.width / 2) / zoom,
        y: held.y - (anchor.y - viewport.y - viewport.height / 2) / zoom,
    }, viewport, world);
}

/** Drag the world by screen pixels. */
export const panBy = (view, viewport, world, dx, dy) => clampView(
    {zoom: view.zoom, x: view.x - dx / view.zoom, y: view.y - dy / view.zoom}, viewport, world,
);
