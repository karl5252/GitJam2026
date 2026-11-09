/**
 * Where everything goes. Pure data, in logical pixels of the 1280x720 canvas, which
 * is what HUD coordinates always are. TASK 032 gives desktop and touch one structure:
 *
 *   top bar     economy on the left, the time and phase in the middle (the wave below
 *               it at Night), the environment on the right: Pollution, Threat, Power.
 *   left rail   BUILD, CANCEL while placing, REPORT, a reserved slot for the future
 *               PAPI DIRECTIVES, the `i` for THE LITTLE YELLOW BOOK below it, and
 *               END DAY at the bottom. Nothing replaces BUILD.
 *   palette     beside the rail: the selected object's name, HP and state, and only
 *               the commands it accepts, stacked. Gone when nothing is selected.
 *   drawer      BUILD opens it next to the rail, over the palette and the world's
 *               edge, by category. It closes on a choice.
 *   right rail  the camera (ZOOM+, FIT, ZOOM-), then the Night speeds or the Day's
 *               PAUSE and speed, and AUDIO at the bottom.
 *
 * DESKTOP keeps every band it had, so the world's viewport, and with it the fitted
 * camera, is exactly as before. TOUCH is a phone in landscape: controls at least 88
 * logical pixels, 44 CSS pixels at 684x400 and 740x360, the smallest it targets.
 *
 * `viewport` is the screen rectangle the world is drawn in. The HUD never sits over
 * it, except for the drawer, the hint and the audio panel, which are all temporary.
 */

const text = (x, y, fontSize, originX = 0, extra = {}) => ({x, y, fontSize, originX, ...extra});

/** Buildings by what they are for, on both layouts. Four fit a row. */
export const DRAWER_ROWS = Object.freeze([
    ['ECONOMY', ['hq', 'factory', 'powerPlant', 'mine']],
    ['DEFENCE', ['autocannon', 'siegeCannon', 'barracks', 'wall']],
    ['INFRASTRUCTURE', ['road', 'gateVertical', 'gateHorizontal', 'outpost']],
    ['PROPAGANDA', ['loudspeaker']],
]);

/**
 * The drawer's grid, for any number of columns that fit: fewer columns when there is
 * less room, and a row that does not fit wraps onto the next line under its heading.
 */
function drawerGrid({left, top, scale, gap, headingHeight, columns}) {
    const size = 32 * scale;
    const menu = {};
    const labels = [];
    let y = top;
    for (const [label, ids] of DRAWER_ROWS) {
        labels.push({label, x: left + gap, y});
        y += headingHeight;
        ids.forEach((id, i) => {
            const column = i % columns;
            const line = Math.floor(i / columns);
            menu[id] = {x: left + gap + size / 2 + column * (size + gap), y: y + size / 2 + line * (size + gap), width: size, height: size};
        });
        y += Math.ceil(ids.length / columns) * (size + gap);
    }
    return {menu, labels, bottom: y, right: left + gap + columns * (size + gap)};
}

// ---- Desktop --------------------------------------------------------------------

const D_RAIL = {x: 52, width: 92, height: 84};
const D_PALETTE = {x: 172, width: 120, height: 56, top: 186, step: 64};
const D_RIGHT = {x: 1160, columns: [1084, 1160, 1236]};
const D_DRAWER = drawerGrid({left: 106, top: 98, scale: 3, gap: 12, headingHeight: 22, columns: 4});

export const DESKTOP = Object.freeze({
    touch: false,
    viewport: {x: 240, y: 88, width: 800, height: 544},
    dayZoom: null,
    bands: [
        {x: 0, y: 0, width: 1280, height: 88}, // the top bar
        {x: 0, y: 88, width: 104, height: 632}, // the left rail
        {x: 1040, y: 88, width: 240, height: 632}, // the right rail
        {x: 104, y: 632, width: 936, height: 88}, // under the world
    ],
    text: {
        resources: text(20, 28, '26px'),
        shift: text(640, 26, '22px', 0.5),
        wave: text(640, 62, '20px', 0.5),
        pollution: text(928, 12, '20px', 0, {lineSpacing: 4}),
        power: text(1100, 12, '20px', 0, {lineSpacing: 4}),
        hint: text(640, 94, '16px', 0.5),
        settlement: text(1050, 278, '18px', 0, {lineSpacing: 4}),
    },
    rail: {
        build: {x: D_RAIL.x, y: 136, width: D_RAIL.width, height: D_RAIL.height},
        cancel: {x: D_RAIL.x, y: 228, width: D_RAIL.width, height: D_RAIL.height},
        report: {x: D_RAIL.x, y: 320, width: D_RAIL.width, height: D_RAIL.height},
        directives: {x: D_RAIL.x, y: 412, width: D_RAIL.width, height: D_RAIL.height}, // reserved, never shown yet
        manual: {x: D_RAIL.x, y: 504, width: D_RAIL.width, height: D_RAIL.height}, // TASK 033.1: THE LITTLE YELLOW BOOK
        endDay: {x: D_RAIL.x, y: 664, width: D_RAIL.width, height: D_RAIL.height},
    },
    palette: {
        panel: {x: 106, y: 90, width: 132, height: 540},
        header: text(112, 96, '14px', 0, {lineSpacing: 2, wrap: 122}),
        slot: (i) => ({x: D_PALETTE.x, y: D_PALETTE.top + i * D_PALETTE.step, width: D_PALETTE.width, height: D_PALETTE.height}),
        pair: true, // REPAIR and DESTROY share a slot
        icon: {width: 56, height: 56},
        fontSize: '15px',
    },
    drawer: {
        panel: {x: 106, y: 90, width: D_DRAWER.right - 106, height: D_DRAWER.bottom - 90 + 4},
        labels: D_DRAWER.labels,
        scale: 3,
        costFont: '12px',
        labelFont: '12px',
        headingFont: '15px',
    },
    menu: D_DRAWER.menu,
    camera: {
        zoomOut: {x: D_RIGHT.columns[0], y: 136, width: 72, height: 76},
        fit: {x: D_RIGHT.columns[1], y: 136, width: 72, height: 76},
        zoomIn: {x: D_RIGHT.columns[2], y: 136, width: 72, height: 76},
    },
    speed: D_RIGHT.columns.map((x) => ({x, y: 226, width: 72, height: 76})),
    dayTime: {pause: {x: 1104, y: 226, width: 120, height: 76}, speed: {x: 1222, y: 226, width: 92, height: 76}},
    audio: {
        open: {x: D_RIGHT.x, y: 664, width: 200, height: 84},
        panel: {x: 640, y: 360, width: 560, height: 360},
        slider: {width: 300, height: 44, knob: 30},
        fontSize: '22px',
    },
    // TASK 033.3: Presidential Advice, in the band under the world, clear of the rails.
    advice: {
        x: 112, y: 638, width: 920, height: 76, pad: 12, stripe: 10,
        kicker: true, portrait: null, titleFont: 16, textFont: 15,
        more: {width: 92, height: 56}, dismiss: {width: 64, height: 56},
    },
});

// ---- Touch ----------------------------------------------------------------------

const ROWS = [109, 203, 297, 391, 485, 579, 673];
const T_SIZE = {width: 92, height: 88};
const T_LEFT = 50;
const T_RIGHT = 1229;
const left = (row) => ({x: T_LEFT, y: ROWS[row], ...T_SIZE});
const right = (row) => ({x: T_RIGHT, y: ROWS[row], ...T_SIZE});
const T_PALETTE = {x: 152, top: 168, step: 94};
const T_VIEW = {x: 204, right: 1176};
const T_DRAWER = drawerGrid({left: 102, top: 68, scale: 4, gap: 12, headingHeight: 24, columns: 4});

export const TOUCH = Object.freeze({
    touch: true,
    viewport: {x: T_VIEW.x, y: 62, width: T_VIEW.right - T_VIEW.x, height: 658},
    dayZoom: 2,
    bands: [
        {x: 0, y: 0, width: 1280, height: 62},
        {x: 0, y: 62, width: 102, height: 658}, // the left rail
        {x: 102, y: 62, width: 102, height: 658}, // the palette's column
        {x: T_VIEW.right, y: 62, width: 1280 - T_VIEW.right, height: 658}, // the right rail
    ],
    text: {
        resources: text(8, 18, '20px'),
        shift: text(620, 16, '20px', 0.5),
        wave: text(620, 44, '18px', 0.5),
        pollution: text(880, 6, '18px', 0, {lineSpacing: 2}),
        power: text(1070, 6, '18px', 0, {lineSpacing: 2}),
        hint: text((T_VIEW.x + T_VIEW.right) / 2, 86, '24px', 0.5, {backgroundColor: '#263238', padding: {x: 10, y: 4}}),
        settlement: text(212, 72, '22px', 0, {lineSpacing: 4}),
    },
    rail: {
        build: left(0),
        cancel: left(1),
        report: left(2),
        directives: left(3), // reserved, never shown yet
        manual: left(4), // TASK 033.1: THE LITTLE YELLOW BOOK
        endDay: left(6),
    },
    palette: {
        panel: {x: 102, y: 62, width: 102, height: 658},
        header: text(106, 66, '15px', 0, {lineSpacing: 2, wrap: 96}),
        slot: (i) => ({x: T_PALETTE.x, y: T_PALETTE.top + i * T_PALETTE.step, ...T_SIZE}),
        pair: false, // stacked: two 88 px squares do not fit side by side
        icon: {width: 88, height: 88},
        fontSize: '16px',
    },
    drawer: {
        panel: {x: 102, y: 64, width: T_DRAWER.right - 102, height: 652},
        labels: T_DRAWER.labels,
        scale: 4,
        costFont: '16px',
        labelFont: '16px',
        headingFont: '20px',
    },
    menu: T_DRAWER.menu,
    camera: {zoomIn: right(0), fit: right(1), zoomOut: right(2)},
    speed: [3, 4, 5].map(right),
    dayTime: {pause: right(3), speed: right(4)},
    audio: {
        open: right(6),
        panel: {x: 690, y: 390, width: 760, height: 620},
        slider: {width: 380, height: 88, knob: 56},
        fontSize: '28px',
    },
    // TASK 033.3: Presidential Advice, a ribbon along the bottom of the world, between the
    // palette's column and the right rail. El Papi's portrait is its badge; text 24 px.
    advice: {
        x: T_VIEW.x + 4, y: 578, width: T_VIEW.right - T_VIEW.x - 8, height: 138, pad: 10, stripe: 10,
        kicker: false, portrait: 1, titleFont: 26, textFont: 24,
        // Each at least 88 px both ways (44 CSS px at 740x360), and no wider: the longest
        // title needs 626 px at 24 px, and the words get what the buttons leave.
        more: {width: 110, height: 96}, dismiss: {width: 92, height: 96},
    },
});

/** A phone in either orientation. A touch laptop has room for the desktop layout. */
export const isTouchViewport = ({coarsePointer, width, height}) => coarsePointer && Math.min(width, height) <= 540;

export const currentLayout = () => (isTouchViewport({
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    width: window.innerWidth,
    height: window.innerHeight,
}) ? TOUCH : DESKTOP);
