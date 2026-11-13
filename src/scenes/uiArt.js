/**
 * TASK 032: what the HUD's buttons are made of. Pure data and arithmetic, so it can
 * be tested without Phaser. Presentation only: nothing here feeds a rule.
 *
 * Two supplied 32x32 frames, drawn with nearest-neighbour filtering at integer scale:
 *   building_button  a metal frame with a transparent opening (x 4..27, y 3..23) and a
 *                    light label plate below it (rows 24..27).
 *   action_button    the same metal with an open interior (x 4..27, y 3..27), stretched
 *                    as a nine-slice so text buttons of any size keep 1-pixel borders.
 */

export const UI_ART = Object.freeze({
    buildingButton: Object.freeze({key: 'papi-ui-building-button', path: 'assets/sprites/ui/building_button.png', size: 32}),
    actionButton: Object.freeze({key: 'papi-ui-action-button', path: 'assets/sprites/ui/action_button.png', size: 32}),
    wrench: Object.freeze({key: 'papi-ui-wrench', path: 'assets/sprites/ui/wrench.png', size: 48}),
});

/** The building button's parts, in source pixels of its 32x32 frame. */
export const BUILD_FRAME = Object.freeze({
    opening: Object.freeze({x: 4, y: 3, width: 24, height: 21}),
    art: Object.freeze({x: 5, y: 4, width: 22, height: 19}), // the opening less a pixel all round
    cost: Object.freeze({y: 3, height: 6}), // a strip across the top of the opening
    plate: Object.freeze({x: 6, y: 24, width: 21, height: 4}), // the light label plate
});

/** The action button's nine-slice borders, in source pixels. */
export const ACTION_FRAME = Object.freeze({left: 4, right: 4, top: 3, bottom: 4});

/** Muted category colours behind a building's art: {light, dark}. The frame itself stays neutral metal. */
export const CATEGORY = Object.freeze({
    industry: Object.freeze({light: 0xc7a34a, dark: 0x50462f}),
    military: Object.freeze({light: 0x829466, dark: 0x394638}),
    power: Object.freeze({light: 0x7aabca, dark: 0x334957}),
    propaganda: Object.freeze({light: 0xc2655d, dark: 0x513735}),
    neutral: Object.freeze({light: 0xa0a8a9, dark: 0x3d464a}),
});

export const BUILD_CATEGORY = Object.freeze({
    hq: 'neutral',
    factory: 'industry', mine: 'industry', road: 'industry',
    powerPlant: 'power',
    autocannon: 'military', siegeCannon: 'military', barracks: 'military', wall: 'military',
    gateVertical: 'military', gateHorizontal: 'military', outpost: 'military',
    loudspeaker: 'propaganda',
});

export const SHORT_LABEL = Object.freeze({
    hq: 'HQ', powerPlant: 'POWER', factory: 'FACTORY', mine: 'MINE', autocannon: 'AUTO', siegeCannon: 'SIEGE',
    barracks: 'BARRACKS', outpost: 'OUTPOST', loudspeaker: 'SPEAKER', road: 'ROAD', wall: 'WALL',
    gateVertical: 'GATE |', gateHorizontal: 'GATE -',
});

/**
 * The existing art each button shows: SpriteArt's sheet, the frame, and that frame's
 * visible bounds in source pixels (measured from the PNGs), so the art, not its
 * transparent padding, fills the opening. Road has no sprite: it is drawn as a road
 * tile, as RoadLayer draws one.
 */
export const BUILD_ICON = Object.freeze({
    hq: Object.freeze({kind: 'hq', frame: 0, visible: Object.freeze({x: 0, y: 1, width: 32, height: 39})}),
    factory: Object.freeze({kind: 'factory', frame: 0, visible: Object.freeze({x: 0, y: 0, width: 32, height: 31})}),
    powerPlant: Object.freeze({kind: 'powerPlant', frame: 0, visible: Object.freeze({x: 0, y: 0, width: 32, height: 34})}),
    mine: Object.freeze({kind: 'mine', frame: 0, visible: Object.freeze({x: 0, y: 3, width: 32, height: 28})}),
    barracks: Object.freeze({kind: 'barracks', frame: 0, visible: Object.freeze({x: 0, y: 1, width: 32, height: 27})}),
    outpost: Object.freeze({kind: 'outpost', frame: 0, visible: Object.freeze({x: 4, y: 5, width: 23, height: 59})}),
    loudspeaker: Object.freeze({kind: 'loudspeaker', frame: 0, visible: Object.freeze({x: 1, y: 5, width: 30, height: 67})}),
    wall: Object.freeze({kind: 'wall', frame: 0, visible: Object.freeze({x: 22, y: 21, width: 20, height: 23})}), // walls_v3 frame 0, the lone pillar
    gateHorizontal: Object.freeze({kind: 'gateHorizontal', frame: 0, visible: Object.freeze({x: 0, y: 17, width: 32, height: 31})}),
    gateVertical: Object.freeze({kind: 'gateVertical', frame: 0, visible: Object.freeze({x: 11, y: 0, width: 10, height: 48})}),
    autocannon: Object.freeze({kind: 'autocannon', frame: 5, visible: Object.freeze({x: 6, y: 3, width: 17, height: 24})}),
    siegeCannon: Object.freeze({kind: 'siegeCannon', frame: 5, visible: Object.freeze({x: 7, y: 5, width: 19, height: 27})}),
    road: null,
});

/** The wrench (REPAIR): 48x48, visible x 5..42, y 6..43. */
export const WRENCH_VISIBLE = Object.freeze({x: 5, y: 6, width: 38, height: 38});

/**
 * Scale and origin that fit `visible` (of a frame `frameWidth` x `frameHeight`) into
 * a box `size` px across at most, keeping its aspect ratio, centred on the point the
 * image is placed at.
 */
export function fitArt(visible, {frameWidth, frameHeight}, {width, height}) {
    const scale = Math.min(width / visible.width, height / visible.height);
    return {
        scale,
        originX: (visible.x + visible.width / 2) / frameWidth,
        originY: (visible.y + visible.height / 2) / frameHeight,
        width: visible.width * scale,
        height: visible.height * scale,
    };
}

/** "400c 1AP", or "25c": what a build costs, from the real price. */
export const costText = ({credits, ap = 0}) => (ap ? `${credits}c ${ap}AP` : `${credits}c`);

/**
 * What the player lacks for a price, for the button's warning, and nothing more:
 * the press still goes to the domain, which decides. Null when nothing is lacking.
 */
export function shortfall({credits, ap = 0}, economy) {
    if (!economy) return null;
    const lacks = [];
    if (credits > economy.credits) lacks.push('credits');
    if (ap > economy.ap) lacks.push('ap');
    return lacks.length ? lacks : null;
}
