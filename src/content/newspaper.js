/**
 * TASK 029, LA VOZ DE SAN PAPI: the morning newspaper's content, as plain data.
 * Pure: no Phaser, no clock, no randomness.
 *
 * TASK 034: the editorial is real now. The stories live in newspaperStories.js; this
 * module chooses them by the issue's number and last Night's report alone (see
 * stories() below), so the same issue always prints the same paper, nothing touches the
 * game's random numbers, and a story about the player's outpost runs only when true.
 *
 * An edition is built once, at the dawn after a Night, from that Night's frozen
 * settlement report, and is then only read: reopening it later in the Day shows
 * the same issue and the same figures, whatever has happened since.
 *
 * NewspaperLayer draws whatever it is given and computes nothing.
 *
 * Numbering: the issue is the new Day's (the HUD's "Day N"), and the reporting
 * period is the Night just completed, whose number is the settlement's `day`.
 */

import {CONTEXT_COLUMNS, LEADS, WORLD_COLUMNS, noticeForIssue} from './newspaperStories.js';

const mod = (n, m) => ((n % m) + m) % m;

/**
 * The issue's stories. The lead runs through LEADS in order, one per issue. The desktop's
 * three columns rotate through the world news three at a time, so neighbouring issues
 * differ; every other issue, one of them may instead report something that really
 * happened at the player's outpost last Night, chosen only when its facts hold.
 * @returns {{lead: object, columns: object[]}}
 */
export function stories({issue, settlement, delivered = 0}) {
    const counts = settlement.counts ?? {};
    const facts = {
        power: settlement.power.status,
        emitted: settlement.pollution.emitted,
        threat: settlement.pollution.threatLevel,
        producers: (counts.factory ?? 0) + (counts.mine ?? 0),
        delivered,
    };
    const columns = [];
    if (mod(issue, 2) === 0) {
        const happened = CONTEXT_COLUMNS.filter((story) => story.when(facts));
        if (happened.length > 0) columns.push(happened[mod(issue / 2, happened.length)]);
    }
    for (let i = 0; columns.length < 3; i++) columns.push(WORLD_COLUMNS[mod((issue - 1) * 3 + i, WORLD_COLUMNS.length)]);
    return {lead: LEADS[mod(issue - 1, LEADS.length)], columns};
}

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
    const {lead, columns} = stories({issue, settlement, delivered});
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
            id: lead.id,
            kicker: lead.kicker,
            headline: lead.headline,
            subhead: lead.subhead,
            // A photograph by asset id (src/scenes/newspaperArt.js): a later edition can
            // name another portrait, such as the bitten one after Night 99.
            photo: {asset: 'el-papi', caption: 'HIS EXCELLENCY, EL PAPI'},
            body: lead.body, // the desktop's story
            brief: lead.brief, // the phone's: shorter, ending on its own last line
        },
        columns: columns.map(({id, headline, body}) => ({id, headline, body})),
        figuresTitle: `CIFRAS OFICIALES · NIGHT\u00A0${night}`, // "NIGHT 1" never splits: a phone wraps before it
        figures,
        advert: {...noticeForIssue(issue)}, // a government notice in the desktop's small box, one per issue in turn
        footer: '«La verdad oficial» · Ministry of Information',
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
