/**
 * TASK 029, LA VOZ DE SAN PAPI: the morning newspaper's content, as plain data.
 * Pure: no Phaser, no clock, no randomness.
 *
 * An edition is built once, at the dawn after a Night, from that Night's frozen
 * settlement report, and is then only read: reopening it later in the Day shows
 * the same issue and the same figures, whatever has happened since.
 *
 * Everything editorial is PLACEHOLDER for now (TBD, Lorem ipsum, temporary
 * headlines). Later tasks replace these sources; the shape stays, and so does
 * NewspaperLayer, which draws whatever it is given and computes nothing.
 *
 * Numbering: the issue is the new Day's (the HUD's "Day N"), and the reporting
 * period is the Night just completed, whose number is the settlement's `day`.
 */

const LOREM = [
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
    'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
    'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
    'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
];

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const POWER_LABELS = Object.freeze({normal: 'NORMAL', 'low-power': 'LOW POWER', blackout: 'BLACKOUT'});

/**
 * @param {{issue: number, settlement: object, delivered?: number}} input
 *   issue - the new Day's number as the HUD shows it
 *   settlement - ShiftCycle.lastSettlement: the completed Night's frozen report
 *   delivered - Credits trucks delivered in that cycle (Logistics.lastNight.credits)
 * @returns {Readonly<object>} the edition
 */
export function edition({issue, settlement, delivered = 0}) {
    const night = settlement.day;
    const {pollution} = settlement;
    const figures = [
        ['Income', signed(settlement.gross + delivered)],
        ['Upkeep', signed(-settlement.upkeep)],
        ['Net', signed(settlement.net + delivered)],
        ['Credits', String(settlement.creditsAfter)],
        ['Power', POWER_LABELS[settlement.power.status] ?? settlement.power.status],
        ['Pollution', `${pollution.after} (${signed(pollution.emitted)})`],
        ['Threat', String(pollution.threatLevel)],
    ].map(([label, value]) => Object.freeze({label, value}));
    return deepFreeze({
        masthead: 'LA VOZ DE SAN PAPI',
        motto: '«La única voz que necesitas» · Propiedad de PAPI Industries',
        issue,
        night,
        dateLine: `No. ${issue} · Día ${issue} · Reporting Night ${night}`,
        price: '1 Crédito',
        banner: '¡VIVA PAPI!',
        lead: {
            kicker: 'EDICIÓN OFICIAL (TBD)',
            headline: 'HEADLINE PLACEHOLDER: PAPI OPENS A NEW ERA (TBD)',
            subhead: 'Subhead TBD. Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
            // A photograph by asset id (src/scenes/newspaperArt.js): a later edition can
            // name another portrait, such as the bitten one after Night 99.
            photo: {asset: 'el-papi', caption: 'HIS EXCELLENCY, EL PAPI'},
            body: `${LOREM[0]} ${LOREM[1]}`,
        },
        columns: [
            {headline: 'COLUMN ONE (TBD)', body: `${LOREM[2]} ${LOREM[3]}`},
            {headline: 'COLUMN TWO (TBD)', body: `${LOREM[1]} ${LOREM[0]}`},
            {headline: 'COLUMN THREE (TBD)', body: `${LOREM[3]} ${LOREM[2]}`},
        ],
        figuresTitle: `CIFRAS OFICIALES · NIGHT ${night}`,
        figures,
        advert: {headline: 'ADVERTISEMENT (TBD)', body: 'Placeholder advert. Lorem ipsum dolor sit amet.'},
        footer: '«Slogan TBD» · Printed by order of the Ministry of Information',
    });
}

function deepFreeze(value) {
    if (value && typeof value === 'object') {
        for (const child of Object.values(value)) deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}

/**
 * Cut text to at most `maxLines` lines of about `charsPerLine` characters, on word
 * boundaries, ending in an ellipsis when anything was left out. Pure, so a long
 * placeholder can never push a layout off its page.
 * @returns {string} the lines, joined with newlines
 */
export function fitLines(text, charsPerLine, maxLines) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (let i = 0; i < words.length; i++) {
        const next = line ? `${line} ${words[i]}` : words[i];
        if (next.length <= charsPerLine || !line) {
            line = next;
            continue;
        }
        lines.push(line);
        line = words[i];
        if (lines.length === maxLines) {
            lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.,;:]?$/, '')}…`;
            return lines.join('\n');
        }
    }
    if (line) lines.push(line);
    return lines.join('\n');
}
