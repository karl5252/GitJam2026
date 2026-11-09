/**
 * Where everything goes. Pure data, in logical pixels of the 1280x720 canvas, which
 * is what HUD coordinates always are. Two arrangements, chosen once per HUD:
 *
 *   DESKTOP  the bands round the grid, with every button always showing. Cells are
 *            82 logical pixels, 44 CSS pixels at 844x390.
 *   TOUCH    a phone in landscape: a thin top bar and two columns of controls, with
 *            a build drawer instead of a permanent menu. Controls are at least 90
 *            logical pixels, which is 45 CSS pixels at 740x360, the smallest
 *            viewport this targets.
 *
 * `viewport` is the screen rectangle the world is drawn in. The HUD never sits over
 * it, except for the drawer and the hint, which are both temporary. At the fitted
 * zoom the map is limited by height, so the columns take only spare width.
 */

const MENU_COLUMNS = [66, 190];
const MENU_TOP = 104;
const MENU_STEP = 84;
const menuSlot = (slot) => ({x: MENU_COLUMNS[slot % 2], y: MENU_TOP + Math.floor(slot / 2) * MENU_STEP});

const WIDE = {width: 192, height: 84};
const CELL = {width: 120, height: 82};
const ACTION = {width: 116, height: 84};
const ICON = {width: 48, height: 48}; // compact square icon buttons
/** Two icon buttons side by side in one action slot: REPAIR on the left, DESTROY on the right. */
const pairIn = ({x, y, width}, icon = ICON) => ({
    repair: {x: x - width / 2 + icon.width / 2 + 2, y, ...icon},
    demolish: {x: x + width / 2 - icon.width / 2 - 2, y, ...icon},
});
const SPEED = {width: 82, height: 84};
const CAMERA = {width: 92, height: 84};

const text = (x, y, fontSize, originX = 0, extra = {}) => ({x, y, fontSize, originX, ...extra});

/** Slots run left to right, top to bottom. Six rows end at y 565, clear of END DAY at y 578. */
// TASK 028, provisional: a seventh row for the Loudspeaker, with END DAY moved into the bottom band.
const DESKTOP_MENU = ['hq', 'outpost', 'factory', 'powerPlant', 'autocannon', 'road', 'wall', 'barracks', 'gateVertical', 'gateHorizontal', 'siegeCannon', 'mine', 'loudspeaker'];

export const DESKTOP = Object.freeze({
    touch: false,
    viewport: {x: 240, y: 88, width: 800, height: 544},
    dayZoom: null,
    text: {
        shift: text(640, 30, '24px', 0.5),
        resources: text(640, 70, '28px', 0.5),
        wave: text(16, 20, '20px'),
        pollution: text(1040, 16, '22px', 0, {lineSpacing: 4}),
        power: text(1040, 112, '20px', 0, {lineSpacing: 4}),
        hint: text(640, 94, '16px', 0.5),
        settlement: text(1040, 190, '20px', 0, {lineSpacing: 4}),
    },
    menu: Object.fromEntries(DESKTOP_MENU.map((id, slot) => [id, {...menuSlot(slot), ...CELL}])),
    endDay: {x: 360, y: 676, ...WIDE}, // the bottom band, left of the camera buttons, clear of the menu's seventh row
    cancel: {x: 1152, y: 560, ...WIDE},
    toggle: {x: 1152, y: 560, ...WIDE},
    narrowToggle: {x: 1098, y: 560, ...ACTION, height: 84},
    actions: {
        flag: {x: 1098, y: 470, ...ACTION},
        ...pairIn({x: 1218, y: 470, ...ACTION}), // the old Demolish slot holds both
        disperse: {x: 1218, y: 470, ...ACTION, fontSize: '16px', wrap: 110}, // a selected protest: nothing else is shown
        reset: {x: 1218, y: 560, ...ACTION},
        refit: {x: 1152, y: 650, ...WIDE},
    },
    speed: [1072, 1154, 1236].map((x) => ({x, y: 650, ...SPEED})),
    // Day: the bottom band right of the camera buttons, clear of Refit and END DAY.
    dayTime: {pause: {x: 836, y: 676, ...SPEED}, speed: {x: 922, y: 676, ...SPEED}},
    camera: {
        zoomOut: {x: 540, y: 676, ...CAMERA},
        fit: {x: 640, y: 676, ...CAMERA},
        zoomIn: {x: 740, y: 676, ...CAMERA},
    },
});

const TOUCH_SIZE = {width: 108, height: 90};
const LEFT = 56;
const RIGHT = 1224;
const ROWS = [107, 201, 295, 389, 483, 577, 671];
const left = (row) => ({x: LEFT, y: ROWS[row], ...TOUCH_SIZE});
// REPAIR and DESTROY on touch: two 90 px squares (45 CSS px at 740x360, the smallest
// target), so their row of the right column reaches further left than the others,
// and the world's viewport ends before it. The fit is limited by height on both maps,
// so the world loses no zoom.
const TOUCH_ICON = {width: 90, height: 90};
const PAIR_ROW = {x: 1278 - 94, y: ROWS[4], width: 188}; // x 1090..1278, flush with the column's right edge
const VIEW_RIGHT = PAIR_ROW.x - PAIR_ROW.width / 2 - 2;
const right = (row) => ({x: RIGHT, y: ROWS[row], ...TOUCH_SIZE});
const LABEL = {fontSize: '16px', wrap: 100};

/** Buildings by what they are for. Nothing here needs more than one press from the drawer. */
const DRAWER = [
    ['ECONOMY', ['hq', 'factory', 'powerPlant', 'mine']], // four fit a row
    ['DEFENCE', ['autocannon', 'siegeCannon', 'barracks', 'wall']],
    ['INFRASTRUCTURE', ['road', 'gateVertical', 'gateHorizontal', 'outpost']],
    ['PROPAGANDA', ['loudspeaker']],
];
// TASK 028, provisional: four rows in the drawer. 104 logical px is 52 CSS px at 740x360.
const DRAWER_CELL = {width: 228, height: 104};
const DRAWER_LEFT = 180;
const DRAWER_STEP = {x: 240, y: 140};
const DRAWER_TOP = 180;

export const TOUCH = Object.freeze({
    touch: true,
    viewport: {x: 112, y: 62, width: VIEW_RIGHT - 112, height: 658},
    dayZoom: 2,
    text: {
        shift: text(8, 6, '22px'),
        resources: text(8, 34, '22px'),
        wave: text(330, 36, '20px'), // beside Credits: the shift line needs the row above at Night
        pollution: text(790, 6, '20px', 0, {lineSpacing: 2}),
        power: text(990, 6, '20px', 0, {lineSpacing: 2}),
        hint: text(640, 86, '24px', 0.5, {backgroundColor: '#263238', padding: {x: 10, y: 4}}),
        settlement: text(120, 104, '22px', 0, {lineSpacing: 4}),
    },
    drawer: {
        panel: {x: (112 + VIEW_RIGHT) / 2, y: 372, width: VIEW_RIGHT - 112, height: 600}, // within the viewport
        open: left(0),
        labels: DRAWER.map(([label], row) => ({label, x: DRAWER_LEFT - 40, y: DRAWER_TOP - 82 + row * DRAWER_STEP.y})), // in the gap above each row
    },
    menu: Object.fromEntries(DRAWER.flatMap(([, ids], row) => ids.map((id, column) => [id, {
        x: DRAWER_LEFT + 74 + column * DRAWER_STEP.x, y: DRAWER_TOP + row * DRAWER_STEP.y, ...DRAWER_CELL,
    }]))),
    cancel: left(1),
    report: left(2),
    actions: {
        flag: {...left(3), ...LABEL},
        reset: {...left(4), ...LABEL},
        refit: {...right(3), ...LABEL},
        ...pairIn(PAIR_ROW, TOUCH_ICON), // the old Demolish slot, widened to the left
        disperse: {...PAIR_ROW, height: TOUCH_ICON.height, ...LABEL}, // the same row, for a selected protest
    },
    toggle: left(5),
    narrowToggle: left(5),
    endDay: left(6),
    speed: [3, 4, 5].map(right),
    dayTime: {pause: right(5), speed: right(6)}, // by Day, right(3) and right(4) hold Refit and Demolish
    camera: {zoomIn: right(0), fit: right(1), zoomOut: right(2)},
});

/** A phone in either orientation. A touch laptop has room for the desktop layout. */
export const isTouchViewport = ({coarsePointer, width, height}) => coarsePointer && Math.min(width, height) <= 540;

export const currentLayout = () => (isTouchViewport({
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    width: window.innerWidth,
    height: window.innerHeight,
}) ? TOUCH : DESKTOP);
