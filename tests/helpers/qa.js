// tests/helpers/qa.js
//
// Reads window.__qa.getState() (see src/testShadow/QASurface.js) — a live
// snapshot computed on demand, never a value polled off the DOM. Use this
// for anything detailed (positions, per-entity state); use body(page) from
// canvas.js for the few coarse scalars markScene()/setBodyState() expose.

export const sample = (page) => page.evaluate(() => window.__qa.getState());
