/**
 * TASK 033.1: THE LITTLE BANANA-YELLOW BOOK OF EL PRESIDENTE COLONEL PAPI.
 * Pure data and pure functions, no Phaser: FieldManualLayer draws what this returns.
 *
 * The copy here is short, accurate PLACEHOLDER instruction. The final propaganda copy
 * replaces it later, in this file only; the layer never needs to change for that.
 *
 * Every number shown comes from the game's own constants and building data, through
 * `${...}` or the table and fact helpers below. A string literal in this file must
 * never contain a digit (tests/unit/fieldManual.test.js checks it), so a balance
 * change can never leave the book quoting an old value. "Day 0" is the one exception:
 * it is the name of a phase, not a value.
 *
 * Schema (CHAPTERS):
 *   {id, numeral, title, pages: [page]}
 *   page: {
 *     heading,            the page's title
 *     text: [string],     paragraphs, in order
 *     art?: [{kind, frame?, visible?, caption}],   existing sprites (SpriteArt's ART kinds);
 *                         a frame other than the build icon's gives its own visible
 *                         bounds {x, y, width, height}, measured from the PNG
 *     buildings?: [id],   a table of size, cost, power and HP, read from buildingTypes
 *     facts?: [[label, value]],          short game-backed figures
 *     wisdom?: [string],  the Presidential Wisdom box: WISDOM's quotes, then ATTRIBUTION once
 *   }
 * Add a page by adding an object to a chapter's `pages`; add a chapter by adding one
 * to CHAPTERS. Too much text on a page shows as `overflow` in QA's fieldManualView,
 * and tests/e2e/field-manual.spec.js fails on it for every page and both layouts:
 * split the page in two.
 */
import {ROAD_COST, REFIT_COST, getBuildingType} from '../core/buildingTypes.js';
import {MAX_BARRACKS} from '../core/buildingPlacement.js';
import {STARTING_RESOURCES} from '../core/economy.js';
import {AUTOCANNON} from '../core/autocannons.js';
import {SIEGE} from '../core/siegeCannons.js';
import {INFANTRY, ROCKET} from '../core/infantry.js';
import {LOGISTICS, MINE_OUTPUT} from '../core/logistics.js';
import {CLEARING, DISPERSE, REPAIR, WORKER} from '../core/workers.js';
import {ECOLOGIST} from '../core/ecologists.js';
import {LOUDSPEAKER} from '../core/loudspeakers.js';
import {threatLevel} from '../core/pollution.js';
import {BRUTE_WAVE, SPITTER_WAVE} from '../core/waves.js';
import {DAY_AP, DAY_TICKS, DUSK_TICKS, NIGHT_TICKS} from '../core/shiftCycle.js';
import {TICK_RATE} from '../core/simulationClock.js';
import {TILE_SIZE} from '../core/worldMap.js';
import {VISION_RADIUS} from '../core/vision.js';

export const TITLE = 'THE LITTLE BANANA-YELLOW BOOK OF EL PRESIDENTE COLONEL PAPI';
export const SHORT_TITLE = 'THE LITTLE YELLOW BOOK';
export const SUBTITLE = 'An Official Guide to Industry, Prosperity and Unquestionable Leadership';
export const COVER_PORTRAIT = Object.freeze({asset: 'el-papi', caption: 'HIS EXCELLENCY, EL PRESIDENTE'});
export const ATTRIBUTION = '— El Presidente Colonel Papi';
/** Presidential Wisdom, as supplied, word for word. Each page names the ones it prints. */
export const WISDOM = Object.freeze({
    hq: 'A nation without a Headquarters is merely a jungle with opinions.',
    day: 'The sun rises for everyone. But it rises on MY orders!',
    workers: 'Workers are the backbone of San Papi. Naturally, I am the brain.',
    flags: 'A flag is an order. An explanation is an unnecessary expense.',
    trees: 'Every tree removed is one less tree plotting against progress!',
    economy: 'Every Credit earned belongs to the Republic. And the Republic belongs to me!',
    power: 'I invented electricity! The Power Plant merely takes the credit.',
    roads: 'A road is a promise that someone else will do the walking.',
    deposits: 'If the Earth has riches, keeping them buried is economic sabotage!',
    mining: 'Dig responsibly! And by responsibly, I mean FASTER!',
    autocannon: 'The perfect soldier never questions orders. Or runs out of ammunition.',
    barracks: 'Our soldiers train in COUNTRY STROKE! Very advanced simulation! Very expensive!',
    siege: 'If the enemy is too close for artillery, the enemy has violated procedure!',
    pollution: 'Pollution is the perfume of progress!',
    ecologists: 'Every citizen has the right to agree with me!',
    mutants: 'Mutants are not a threat! They are merely unauthorized opposition!',
});

const seconds = (ticks) => `${ticks / TICK_RATE} s`;
const tiles = (px) => `${px / TILE_SIZE} tiles`;
const price = ({credits, ap = 0}) => (ap ? `${credits}c ${ap}AP` : `${credits}c`);
const repairShare = `${Math.round((100 * REPAIR.share.numerator) / REPAIR.share.denominator)}%`;
const bruteNight = Math.min(...BRUTE_WAVE.tiers.map(({fromNight}) => fromNight));
const name = (id) => getBuildingType(id).name;
const flagAp = WORKER.flagCost.ap;

/** Where each Threat Level starts, found by asking the game's own threatLevel(). */
export function threatThresholds() {
    const starts = [{level: threatLevel(0), from: 0}];
    for (let pollution = 1; pollution <= 10000; pollution++) {
        const level = threatLevel(pollution);
        if (level !== starts.at(-1).level) starts.push({level, from: pollution});
    }
    return starts;
}

export const CHAPTERS = Object.freeze([
    {
        id: 'republic',
        numeral: 'I',
        title: 'The Republic Begins',
        pages: [
            {
                heading: 'Headquarters first',
                text: [
                    'A new game starts on Day 0, the initial deployment. No clock runs: take as long as you like.',
                    `Open BUILD and place ${name('hq')} in the clearing. Nothing else can be built until it stands. It comes with a free ring of road around it.`,
                    'If HQ is destroyed, the game is over.',
                    'When your first buildings are ready, press END DAY.',
                ],
                art: [{kind: 'hq', caption: 'HQ'}],
                buildings: ['hq'],
                facts: [['Starting Credits', STARTING_RESOURCES.credits], ['Starting AP', STARTING_RESOURCES.ap]],
                wisdom: [WISDOM.hq],
            },
            {
                heading: 'Day, Dusk and Night',
                text: [
                    'END DAY on Day 0 leads straight into Dusk and the first Night.',
                    'Every later Day runs on the clock. PAUSE it to look around, change its speed, or press END DAY to fast-forward the rest of it. Nothing can be built while the Day is paused.',
                    'Dusk calls the workers home. At Night mutants attack and your defences fight on their own; you cannot build.',
                    `At dawn the Night is settled and AP is restored to ${DAY_AP}.`,
                ],
                art: [{kind: 'runner', caption: 'MUTANT'}],
                facts: [['Day', seconds(DAY_TICKS)], ['Dusk', seconds(DUSK_TICKS)], ['Night', seconds(NIGHT_TICKS)], ['AP each dawn', DAY_AP]],
                wisdom: [WISDOM.day],
            },
        ],
    },
    {
        id: 'workers',
        numeral: 'II',
        title: 'The Working Class',
        pages: [
            {
                heading: 'Workers and the work flag',
                text: [
                    `HQ has a squad of ${WORKER.squadSize} workers. Select HQ and press SEND WORKERS, then choose a tile: the work flag goes there and the squad walks to it.`,
                    `A new flag, or moving it, costs ${flagAp} AP. Sending the squad back to the flag already down is free.`,
                    'Workers go out only while a Day is running, never in Day 0 or at Night. RECALL WORKERS brings them home; Dusk does too.',
                    'Mutants can hurt workers. Anyone lost is replaced at dawn.',
                ],
                art: [{kind: 'worker', caption: 'WORKER'}],
                facts: [['Squad', WORKER.squadSize], ['Worker HP', WORKER.maxHp], ['Flag', `${flagAp} AP`]],
                wisdom: [WISDOM.workers, WISDOM.flags],
            },
            {
                heading: 'Clearing the jungle',
                text: [
                    'Dense jungle blocks buildings and roads. It does not stop mutants.',
                    `Workers at the flag clear the jungle within ${CLEARING.radius} tiles of it, one tile each at a time, and it stays cleared. Cleared ground can be built on.`,
                    'Every cleared tile adds Pollution.',
                ],
                art: [{kind: 'worker', frame: 8, caption: 'CLEARING'}],
                facts: [['Work radius', `${CLEARING.radius} tiles`], ['Per tile', seconds(CLEARING.ticksPerTile)], ['Pollution per tile', CLEARING.pollutionPerTile]],
                wisdom: [WISDOM.trees],
            },
            {
                heading: 'Repairs and demolition',
                text: [
                    'Select a damaged building and press REPAIR. A free worker walks over and repairs it, paying as the work is done. Repairs need a running Day.',
                    `A full repair costs ${repairShare} of the building's price. HQ costs ${REPAIR.hqCreditsPerHp} Credit per HP.`,
                    'If the Credits run out, the repair stops. Press STOP REPAIR to end it yourself.',
                    'DESTROY removes a building by Day, free, with no refund. HQ cannot be destroyed.',
                ],
                art: [{kind: 'worker', frame: 10, caption: 'REPAIRING'}],
                facts: [['Full repair', `${repairShare} of price`], ['HQ repair', `${REPAIR.hqCreditsPerHp}c per HP`]],
            },
        ],
    },
    {
        id: 'industry',
        numeral: 'III',
        title: 'Industrial Prosperity',
        pages: [
            {
                heading: 'Credits and AP',
                text: [
                    'Credits pay for buildings, roads and repairs. AP, Action Points, limit how many orders you give in a Day: most buildings cost AP as well as Credits.',
                    `AP is restored to ${DAY_AP} at every dawn and does not carry over.`,
                    `Each new road tile costs ${ROAD_COST.credits} Credits. Walls cost no AP.`,
                    'Credits come from deliveries: trucks bringing goods to HQ.',
                ],
                facts: [['AP each dawn', DAY_AP], ['Road tile', price(ROAD_COST)], [name('wall'), price(getBuildingType('wall').cost)]],
                wisdom: [WISDOM.economy],
            },
            {
                heading: 'Power',
                text: [
                    'HQ and Power Plants generate power. Most other buildings use it.',
                    'When demand is higher than generation, the whole grid is on LOW POWER and every building that uses power stops, cannons included.',
                    'The game asks before you build something that would cause LOW POWER. A selected building can be switched off to save power.',
                ],
                art: [{kind: 'powerPlant', caption: 'POWER PLANT'}],
                buildings: ['hq', 'powerPlant'],
                wisdom: [WISDOM.power],
            },
            {
                heading: 'Factories, roads and trucks',
                text: [
                    `A powered Factory makes a load of goods every ${seconds(LOGISTICS.loadTicks)} and stores up to ${LOGISTICS.storageLoads}.`,
                    `Its truck drives each load to HQ by road and earns ${LOGISTICS.creditsPerLoad} Credits when it arrives.`,
                    "The Factory's dock, on its right side, must be a road connected to HQ's ring. Trucks work by Day, Dusk and Night.",
                    'Mutants can destroy a truck and its cargo; a new truck follows.',
                ],
                art: [{kind: 'factory', caption: 'FACTORY'}, {kind: 'truck', caption: 'TRUCK'}],
                buildings: ['factory'],
                facts: [['Per load', `${LOGISTICS.creditsPerLoad}c`]],
                wisdom: [WISDOM.roads],
            },
            {
                heading: 'On the Glorious Exports of San Papi',
                text: [
                    'The Republic of San Papi proudly exports two sacred pillars of national prosperity: bananas and El Presidente Papi™ Banana Ketchup.',
                    'These mighty exports are the foundation of our prosperity, the envy of lesser nations, and the shining proof of Papist excellence.',
                    'Both are personally blessed, approved, and undoubtedly admired by El Presidente himself.',
                    'According to the Ministry of Truth, the Ministry of Agriculture, and the Ministry of Taste, both are officially certified muy delicioso.',
                ],
                wisdom: [
                    'When you buy Papi, you support Papi. When you support Papi, you support progress.',
                ],
            },
        ],
    },
    {
        id: 'mining',
        numeral: 'IV',
        title: 'The Riches of the Earth',
        pages: [
            {
                heading: 'Deposits',
                text: [
                    'Ore deposits lie under the jungle around the clearing. Rust-coloured stains and stones on the canopy give them away.',
                    'Send workers to clear the jungle over a deposit to reveal the ore.',
                    'Deposits never run out.',
                ],
                art: [{kind: 'worker', frame: 8, caption: 'PROSPECTING'}],
                wisdom: [WISDOM.deposits],
            },
            {
                heading: 'The Mine',
                text: [
                    `A Mine is ${getBuildingType('mine').width}x${getBuildingType('mine').height}, and all of its tiles must be on one cleared deposit. One Mine per deposit.`,
                    "Its dock is on its bottom side and must be a road connected to HQ's ring.",
                    `A powered Mine sends a load every ${seconds(MINE_OUTPUT.loadTicks)}, worth ${MINE_OUTPUT.creditsPerLoad} Credits at HQ.`,
                    'A working Mine draws mutants. Defend it.',
                ],
                art: [{kind: 'mine', caption: 'MINE'}],
                buildings: ['mine'],
                facts: [['Per load', `${MINE_OUTPUT.creditsPerLoad}c`]],
                wisdom: [WISDOM.mining],
            },
        ],
    },
    {
        id: 'military',
        numeral: 'V',
        title: 'The Glorious Armed Forces',
        pages: [
            {
                heading: 'Cannons',
                text: [
                    'Cannons fire by themselves at Night, at mutants in range. They need power.',
                    'The Autocannon fires fast and often. The Siege Cannon fires heavy shells with a long reload, prefers Brutes, and cannot hit anything too close to it.',
                ],
                // Frame 5 aims south-west, each gun's best side; their visible pixels, measured from the PNGs.
                art: [{kind: 'autocannon', frame: 5, visible: {x: 1, y: 5, width: 26, height: 23}, caption: 'AUTOCANNON'},
                    {kind: 'siegeCannon', frame: 5, visible: {x: 3, y: 6, width: 26, height: 26}, caption: 'SIEGE CANNON'}],
                buildings: ['autocannon', 'siegeCannon'],
                facts: [['Autocannon range', tiles(AUTOCANNON.range)], ['Siege range', `${SIEGE.minRange / TILE_SIZE} to ${SIEGE.range / TILE_SIZE} tiles`]],
                wisdom: [WISDOM.autocannon, WISDOM.siege],
            },
            {
                heading: 'Barracks',
                text: [
                    `Each Night a powered Barracks sends ${INFANTRY.squadSize} soldiers to its rally flag. By Day they stay inside.`,
                    'Select a Barracks and press FLAG to choose where they stand, Day or Night. Its exit, on its left side, must be a connected road.',
                    `REFIT turns it into a rocket squad of ${ROCKET.squadSize}, strong against Brutes, for ${price(REFIT_COST)}.`,
                ],
                art: [{kind: 'barracks', caption: 'BARRACKS'}, {kind: 'rifleman', caption: 'RIFLE'}, {kind: 'rocketman', caption: 'ROCKET'}],
                buildings: ['barracks'],
                facts: [['Most Barracks', MAX_BARRACKS], ['Refit', price(REFIT_COST)]],
                wisdom: [WISDOM.barracks],
            },
            {
                heading: 'Walls, gates and outposts',
                text: [
                    'Mutants must break through walls or walk round them. Gates go on straight roads and open for trucks and soldiers; a mutant can slip through while one is open.',
                    `Spitters, from Night ${SPITTER_WAVE.firstNight}, attack from a distance. Brutes, from Night ${bruteNight}, smash through walls.`,
                    `A powered Outpost watches the jungle up to ${VISION_RADIUS.outpost} tiles away.`,
                ],
                art: [{kind: 'wall', caption: 'WALL'}, {kind: 'spitter', caption: 'SPITTER'}, {kind: 'brute', caption: 'BRUTE'}],
                buildings: ['wall', 'gateHorizontal', 'outpost'],
                wisdom: [WISDOM.mutants],
            },
        ],
    },
    {
        id: 'environment',
        numeral: 'VI',
        title: 'Environmental Progress',
        pages: [
            {
                heading: 'Pollution and Threat',
                text: [
                    'Powered Factories, Power Plants and Mines emit Pollution every Night. Clearing jungle adds more. Pollution never goes down.',
                    'Pollution sets the Threat Level, and a higher Threat sends more mutants. Waves also grow as the Nights go by.',
                ],
                facts: [
                    ...['factory', 'powerPlant', 'mine'].map((id) => [`${name(id)} per Night`, getBuildingType(id).pollutionPerNight]),
                    ...threatThresholds().map(({level, from}) => [`Threat ${level}`, `from ${from}`]),
                ],
                wisdom: [WISDOM.pollution],
            },
            {
                heading: 'Ecologists and Loudspeakers',
                text: [
                    `By Day, once a working Factory or Mine has a road to HQ, ecologists come to block it. More groups come as Pollution rises, up to ${ECOLOGIST.maxGroups} a Day. Trucks wait until they leave.`,
                    `Walls and gates keep them out. Select a protest and press DISPERSE to send ${DISPERSE.workers} workers.`,
                    `Or build a Loudspeaker: no protest lasts within ${LOUDSPEAKER.radius} tiles of a working tower. HQ's SPEAKERS switch controls every tower.`,
                    'A tower that broadcast by Day draws mutants that Night.',
                ],
                art: [{kind: 'ecologist', caption: 'ECOLOGIST'}, {kind: 'loudspeaker', caption: 'LOUDSPEAKER'}],
                buildings: ['loudspeaker'],
                wisdom: [WISDOM.ecologists],
            },
        ],
    },

]);

/** One row of the building table: what the drawer and the game charge, from buildingTypes. */
export function buildingRow(id) {
    const type = getBuildingType(id);
    const {supply, demand} = type.power;
    const power = supply > 0 ? `+${supply}` : demand > 0 ? `-${demand}` : `${demand}`;
    return [type.name, `${type.width}x${type.height}`, price(type.cost), power, `${type.maxHp}`];
}
export const TABLE_HEADER = Object.freeze(['', 'SIZE', 'COST', 'POWER', 'HP']);

/**
 * Every page in reading order, resolved to plain strings. Page 0 is the cover with the
 * contents; each chapter's first page is where its contents entry leads.
 */
export function manualPages(chapters = CHAPTERS) {
    const pages = [{kind: 'contents', chapter: null, heading: 'CONTENTS'}];
    for (const chapter of chapters) {
        chapter.pages.forEach((page, i) => pages.push({
            kind: 'chapter',
            chapter: chapter.id,
            numeral: chapter.numeral,
            chapterTitle: chapter.title,
            pageInChapter: i + 1,
            pagesInChapter: chapter.pages.length,
            heading: page.heading,
            text: [...page.text],
            art: (page.art ?? []).map(({kind, frame = 0, visible = null, caption}) => ({kind, frame, visible: visible && {...visible}, caption})),
            table: page.buildings?.length ? {header: [...TABLE_HEADER], rows: page.buildings.map(buildingRow)} : null,
            facts: (page.facts ?? []).map(([label, value]) => ({label, value: `${value}`})),
            wisdom: [...(page.wisdom ?? [])],
        }));
    }
    return pages;
}

/** The contents: each chapter and the page its entry opens. */
export function contents(pages = manualPages()) {
    return CHAPTERS.map(({id, numeral, title}) => ({id, numeral, title, page: pages.findIndex((p) => p.chapter === id)}));
}
