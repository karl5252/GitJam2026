// testShadow/PerfProbe.js
//
// window.__qa.perf — TEST_MODE-only measurement for the browser soak. It only
// observes: nothing is measured until start(), and stop() removes every
// listener and wrapper, so the object counts in counts() stay comparable.
//
// Reported separately, because they are different things:
//   frames        rAF-to-rAF intervals, as observed by the page
//   simulation    time inside stepSimulation, per tick
//   sceneUpdate   time inside scene.update, per frame (includes simulation)
//   renderCallbacks  time between Phaser's prerender and postrender events.
//                 This is CPU-side submission only, not GPU work.
//   unattributedMsPerFrame  what is left of the frame. It includes vsync wait,
//                 browser, compositor and GPU time, which callbacks cannot
//                 see. It is never assumed to be idle or to be rendering.
//
// Use it for real-time runs only. Frame numbers mean nothing under QA
// stepTicks(), which runs many ticks inside one frame.

const MAX_SAMPLES = 20000;

function summary(values) {
    if (values.length === 0) return {count: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0};
    const sorted = [...values].sort((a, b) => a - b);
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    const round = (n) => Math.round(n * 1000) / 1000;
    const total = sorted.reduce((sum, v) => sum + v, 0);
    return {count: sorted.length, mean: round(total / sorted.length), p50: round(at(0.5)), p95: round(at(0.95)), p99: round(at(0.99)), max: round(sorted.at(-1))};
}

const push = (list, value) => {
    if (list.length < MAX_SAMPLES) list.push(value);
};

const listenerTotal = (emitter) => emitter.eventNames().reduce((sum, name) => sum + emitter.listenerCount(name), 0);

export function createPerfProbe(scene) {
    let run = null;

    function start() {
        if (run) return;
        const state = {
            startedAt: performance.now(), frames: [], ticks: [], updates: [], renders: [],
            lastFrame: null, rafId: 0, updateStart: 0, renderStart: 0, peakObjects: 0,
        };
        const onFrame = (time) => {
            if (state.lastFrame !== null) push(state.frames, time - state.lastFrame);
            state.lastFrame = time;
            state.rafId = requestAnimationFrame(onFrame);
        };
        state.rafId = requestAnimationFrame(onFrame);

        const prototypeStep = scene.stepSimulation;
        scene.stepSimulation = function timedStep(tick) {
            const before = performance.now();
            prototypeStep.call(scene, tick);
            push(state.ticks, performance.now() - before);
        };
        state.onUpdate = () => { state.updateStart = performance.now(); };
        state.onPostUpdate = () => push(state.updates, performance.now() - state.updateStart);
        state.onPreRender = () => { state.renderStart = performance.now(); };
        state.onPostRender = () => {
            push(state.renders, performance.now() - state.renderStart);
            state.peakObjects = Math.max(state.peakObjects, scene.children.length);
        };
        scene.events.on('update', state.onUpdate);
        scene.events.on('postupdate', state.onPostUpdate);
        scene.game.events.on('prerender', state.onPreRender);
        scene.game.events.on('postrender', state.onPostRender);
        run = state;
    }

    function stop() {
        if (!run) return null;
        const state = run;
        run = null;
        cancelAnimationFrame(state.rafId);
        delete scene.stepSimulation; // back to the prototype method
        scene.events.off('update', state.onUpdate);
        scene.events.off('postupdate', state.onPostUpdate);
        scene.game.events.off('prerender', state.onPreRender);
        scene.game.events.off('postrender', state.onPostRender);

        const seconds = (performance.now() - state.startedAt) / 1000;
        const frames = summary(state.frames);
        const sceneUpdate = summary(state.updates);
        const renderCallbacks = summary(state.renders);
        return {
            seconds: Math.round(seconds * 100) / 100,
            frames,
            framesOver20ms: state.frames.filter((ms) => ms > 20).length,
            simulation: summary(state.ticks),
            ticksPerSecond: Math.round(state.ticks.length / seconds * 10) / 10,
            sceneUpdate,
            renderCallbacks,
            unattributedMsPerFrame: Math.round(Math.max(0, frames.mean - sceneUpdate.mean - renderCallbacks.mean) * 1000) / 1000,
            peakObjects: state.peakObjects,
            jsHeapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e5) / 10 : null,
        };
    }

    /** Live object and listener counts, for lifecycle checks. */
    function counts() {
        return {
            gameObjects: scene.children.length,
            sceneListeners: listenerTotal(scene.events),
            gameListeners: listenerTotal(scene.game.events),
            inputListeners: listenerTotal(scene.input),
            tweens: scene.tweens.getTweens().length,
            proxies: document.querySelectorAll('[data-action]').length,
        };
    }

    /** The renderer in use, so software and hardware results are never mixed. */
    function renderer() {
        const gl = document.createElement('canvas').getContext('webgl');
        const info = gl?.getExtension('WEBGL_debug_renderer_info');
        return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
    }

    return {start, stop, counts, renderer};
}
