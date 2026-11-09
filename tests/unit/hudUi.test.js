import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {BUILDING_TYPES} from '../../src/core/buildingTypes.js';
import {ART} from '../../src/scenes/SpriteArt.js';
import {DESKTOP, DRAWER_ROWS, TOUCH} from '../../src/scenes/hudLayout.js';
import {KILLDOZER} from '../../src/scenes/killdozerIcon.js';
import {BUILD_CATEGORY, BUILD_FRAME, BUILD_ICON, CATEGORY, SHORT_LABEL, UI_ART, WRENCH_VISIBLE, costText, fitArt, shortfall} from '../../src/scenes/uiArt.js';

/** TASK 032: the HUD's pure parts. Button art, prices, and where everything goes. */

const MENU_IDS = ['hq', 'outpost', 'factory', 'powerPlant', 'autocannon', 'road', 'wall', 'barracks', 'gateVertical', 'gateHorizontal', 'siegeCannon', 'mine', 'loudspeaker'];
const overlaps = (p, q) => Math.abs(p.x - q.x) * 2 < p.width + q.width && Math.abs(p.y - q.y) * 2 < p.height + q.height;

/** The visible bounds of one frame of a PNG in public/: 8-bit RGBA or palette, as the art is. */
function frameBounds(path, frameWidth, frameHeight) {
    const b = readFileSync(new URL(`../../public/${path}`, import.meta.url));
    const w = b.readUInt32BE(16);
    const h = b.readUInt32BE(20);
    const colorType = b[25];
    const idat = [];
    let trns = null;
    for (let p = 8; p < b.length;) {
        const len = b.readUInt32BE(p);
        const type = b.toString('ascii', p + 4, p + 8);
        if (type === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + len));
        if (type === 'tRNS') trns = b.subarray(p + 8, p + 8 + len);
        p += 12 + len;
    }
    const bpp = colorType === 6 ? 4 : 1;
    const stride = w * bpp;
    const raw = inflateSync(Buffer.concat(idat));
    const out = Buffer.alloc(h * stride);
    for (let y = 0; y < h; y++) {
        const filter = raw[y * (stride + 1)];
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? out[y * stride + x - bpp] : 0;
            const up = y ? out[(y - 1) * stride + x] : 0;
            const c = y && x >= bpp ? out[(y - 1) * stride + x - bpp] : 0;
            let v = raw[y * (stride + 1) + 1 + x];
            if (filter === 1) v += a;
            else if (filter === 2) v += up;
            else if (filter === 3) v += (a + up) >> 1;
            else if (filter === 4) {
                const pp = a + up - c;
                const [pa, pb, pc] = [Math.abs(pp - a), Math.abs(pp - up), Math.abs(pp - c)];
                v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
            }
            out[y * stride + x] = v & 255;
        }
    }
    const alpha = (x, y) => (colorType === 6 ? out[y * stride + x * 4 + 3] : (trns && out[y * w + x] < trns.length ? trns[out[y * w + x]] : 255));
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -1, -1];
    for (let y = 0; y < frameHeight; y++) {
        for (let x = 0; x < frameWidth; x++) {
            if (alpha(x, y) <= 16) continue;
            [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
        }
    }
    return {x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1};
}

test('every build button has a category, a short label and its existing art, measured from the PNGs', () => {
    for (const id of MENU_IDS) {
        assert.ok(CATEGORY[BUILD_CATEGORY[id]], `${id} has a category`);
        assert.ok(SHORT_LABEL[id], `${id} has a short label`);
        assert.ok(SHORT_LABEL[id].length <= 8, `${id}'s label fits the plate`);
        const icon = BUILD_ICON[id];
        if (id === 'road') {
            assert.equal(icon, null, 'Road has no sprite: it is drawn');
            continue;
        }
        const {path, frameWidth, frameHeight} = ART[icon.kind];
        assert.deepEqual(icon.visible, frameBounds(`assets/sprites/${path}`, frameWidth, frameHeight), `${id}'s bounds`);
    }
    assert.deepEqual(Object.keys(BUILD_CATEGORY).sort(), [...MENU_IDS].sort());
    assert.deepEqual(BUILD_CATEGORY, {
        hq: 'neutral', factory: 'industry', mine: 'industry', road: 'industry', powerPlant: 'power',
        autocannon: 'military', siegeCannon: 'military', barracks: 'military', wall: 'military',
        gateVertical: 'military', gateHorizontal: 'military', outpost: 'military', loudspeaker: 'propaganda',
    });
});

test('the icons keep their measured bounds: the wrench, and the Killdozer since its art changed', () => {
    assert.deepEqual(WRENCH_VISIBLE, frameBounds('assets/sprites/ui/wrench.png', 48, 48));
    assert.deepEqual(KILLDOZER.visible, frameBounds('assets/sprites/ui/killdozer.png', 48, 48));
    for (const {path, size} of Object.values(UI_ART)) assert.deepEqual(frameBounds(path, size, size).width <= size, true);
    // The building frame's opening is transparent, and its art box sits inside it.
    const {opening, art} = BUILD_FRAME;
    assert.ok(art.x >= opening.x && art.y >= opening.y && art.x + art.width <= opening.x + opening.width && art.y + art.height <= opening.y + opening.height);
});

test('fitArt keeps the aspect ratio and fills the long side; tall towers and wide walls both fit', () => {
    const box = {width: 66, height: 57};
    for (const id of MENU_IDS.filter((i) => BUILD_ICON[i])) {
        const {visible, kind} = BUILD_ICON[id];
        const fit = fitArt(visible, ART[kind], box);
        assert.ok(fit.width <= box.width + 1e-9 && fit.height <= box.height + 1e-9, `${id} inside`);
        assert.ok(Math.abs(fit.width - box.width) < 1e-9 || Math.abs(fit.height - box.height) < 1e-9, `${id} fills a side`);
        assert.ok(Math.abs(fit.width / fit.height - visible.width / visible.height) < 1e-9, `${id} keeps its ratio`);
    }
    const tower = fitArt(BUILD_ICON.loudspeaker.visible, ART.loudspeaker, box);
    assert.equal(tower.height, 57);
});

test('prices come from the real costs, and a shortfall names what is missing without deciding anything', () => {
    assert.equal(costText(BUILDING_TYPES.factory.cost), '400c 1AP');
    assert.equal(costText(BUILDING_TYPES.wall.cost), '25c');
    assert.equal(costText({credits: 2, ap: 0}), '2c');
    assert.equal(shortfall({credits: 400, ap: 1}, {credits: 400, ap: 1}), null);
    assert.deepEqual(shortfall({credits: 400, ap: 1}, {credits: 399, ap: 1}), ['credits']);
    assert.deepEqual(shortfall({credits: 400, ap: 1}, {credits: -5, ap: 0}), ['credits', 'ap']);
    assert.equal(shortfall({credits: 400, ap: 1}, null), null);
});

for (const [name, layout] of [['desktop', DESKTOP], ['touch', TOUCH]]) {
    test(`${name}: the drawer keeps its categories, four to a row, inside its panel and clear of the rails`, () => {
        assert.deepEqual(DRAWER_ROWS.map(([label]) => label), ['ECONOMY', 'DEFENCE', 'INFRASTRUCTURE', 'PROPAGANDA']);
        assert.deepEqual(Object.keys(layout.menu).sort(), [...MENU_IDS].sort());
        const {panel} = layout.drawer;
        const size = 32 * layout.drawer.scale;
        const buttons = Object.values(layout.menu);
        for (const b of buttons) {
            assert.equal(b.width, size);
            assert.ok(b.x - size / 2 >= panel.x && b.x + size / 2 <= panel.x + panel.width, 'inside the panel, across');
            assert.ok(b.y - size / 2 >= panel.y && b.y + size / 2 <= panel.y + panel.height, 'inside the panel, down');
            assert.ok(b.y + size / 2 <= 720, 'on screen');
        }
        for (const [, ids] of DRAWER_ROWS) assert.ok(new Set(ids.map((id) => layout.menu[id].y)).size === 1, 'one line per category');
        buttons.forEach((p, i) => buttons.slice(i + 1).forEach((q) => assert.equal(overlaps(p, q), false)));
        for (const rail of Object.values(layout.rail)) assert.equal(buttons.some((b) => overlaps(b, rail)), false);
    });

    test(`${name}: the rails and the palette stay off the world, apart from one another`, () => {
        const world = layout.viewport;
        const worldBox = {x: world.x + world.width / 2, y: world.y + world.height / 2, width: world.width, height: world.height};
        const fixed = [
            ...Object.values(layout.rail), ...Object.values(layout.camera), ...layout.speed, layout.audio.open,
            ...[0, 1, 2, 3, 4, 5].map(layout.palette.slot),
        ];
        for (const box of fixed) assert.equal(overlaps(box, worldBox), false, JSON.stringify(box));
        const dayFixed = [...Object.values(layout.rail), ...Object.values(layout.camera), layout.dayTime.pause, layout.dayTime.speed, layout.audio.open];
        dayFixed.forEach((p, i) => dayFixed.slice(i + 1).forEach((q) => assert.equal(overlaps(p, q), false, `${JSON.stringify(p)} / ${JSON.stringify(q)}`)));
        const slots = [0, 1, 2, 3, 4, 5].map(layout.palette.slot);
        for (const slot of slots) assert.ok(slot.y + slot.height / 2 <= 720, 'six slots fit: a Barracks needs them all on touch');
        if (layout.touch) {
            // 44 CSS px at 684x400, the smallest scale this targets (0.534): 83 logical px.
            for (const box of [...fixed, ...dayFixed]) assert.ok(Math.min(box.width, box.height) >= 83, JSON.stringify(box));
        }
    });
}

test('the desktop world keeps its viewport, so the fitted camera is unchanged', () => {
    assert.deepEqual(DESKTOP.viewport, {x: 240, y: 88, width: 800, height: 544});
    assert.ok(TOUCH.viewport.width >= 968, 'touch keeps the height-limited fit on the open map (544 * 658 / 544 = 658 tall needs 968 wide)');
});

test('suspension: each reason is its own, so closing one never releases another, and nothing is toggled blindly', async () => {
    const {Suspension, SuspendReason} = await import('../../src/scenes/suspension.js');
    const held = new Suspension();
    assert.equal(held.active, false);
    assert.equal(held.set(SuspendReason.BUILD, true), true);
    assert.equal(held.set(SuspendReason.BUILD, true), false, 'a second open changes nothing');
    held.set(SuspendReason.AUDIO, true);
    held.set(SuspendReason.AUDIO, false);
    assert.equal(held.active, true, 'AUDIO closing leaves BUILD holding the world');
    assert.deepEqual(held.reasons(), ['build']);
    held.set(SuspendReason.ORIENTATION, true);
    held.set(SuspendReason.BUILD, false);
    assert.deepEqual(held.reasons(), ['orientation']);
    assert.equal(held.set('pause', true), false, 'the manual PAUSE is the clock\'s, never a reason here');
    held.clear();
    assert.equal(held.active, false);
});
