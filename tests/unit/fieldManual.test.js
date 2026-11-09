import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getBuildingType} from '../../src/core/buildingTypes.js';
import {threatLevel} from '../../src/core/pollution.js';
import {ART} from '../../src/scenes/SpriteArt.js';
import {BUILD_ICON} from '../../src/scenes/uiArt.js';
import {DESKTOP, TOUCH} from '../../src/scenes/hudLayout.js';
import {Suspension, SuspendReason} from '../../src/scenes/suspension.js';
import {ATTRIBUTION, CHAPTERS, TABLE_HEADER, WISDOM, buildingRow, contents, manualPages, threatThresholds} from '../../src/content/fieldManual.js';

/** TASK 033.1: THE LITTLE YELLOW BOOK's content, its figures, and its place in the HUD. */

const overlaps = (p, q) => Math.abs(p.x - q.x) * 2 < p.width + q.width && Math.abs(p.y - q.y) * 2 < p.height + q.height;

/**
 * Every string literal in a source file, with each template's `${...}` taken out:
 * what is written in the copy itself, never what the game computes into it.
 */
function stringLiterals(source) {
    const found = [];
    let i = 0;
    const skipExpression = () => { // from just after `${` to just after its `}`
        let depth = 1;
        while (i < source.length && depth > 0) {
            const c = source[i++];
            if (c === '{') depth++;
            else if (c === '}') depth--;
            else if (c === '`') skipTemplate(null);
            else if (c === '\'' || c === '"') while (i < source.length && source[i++] !== c) if (source[i - 1] === '\\') i++;
        }
    };
    const skipTemplate = (out) => {
        let text = '';
        while (i < source.length && source[i] !== '`') {
            if (source[i] === '\\') {
                text += source[i + 1];
                i += 2;
            } else if (source[i] === '$' && source[i + 1] === '{') {
                i += 2;
                skipExpression();
                text += ' ';
            } else text += source[i++];
        }
        i++;
        out?.push(text);
    };
    while (i < source.length) {
        const c = source[i];
        if (c === '/' && source[i + 1] === '/') i = source.indexOf('\n', i) === -1 ? source.length : source.indexOf('\n', i);
        else if (c === '/' && source[i + 1] === '*') i = source.indexOf('*/', i) + 2;
        else if (c === '`') {
            i++;
            skipTemplate(found);
        } else if (c === '\'' || c === '"') {
            let text = '';
            i++;
            while (i < source.length && source[i] !== c) {
                if (source[i] === '\\') i++;
                text += source[i++];
            }
            i++;
            found.push(text);
        } else i++;
    }
    return found;
}

test('six chapters, as approved, each with pages that have a heading and words', () => {
    assert.deepEqual(CHAPTERS.map((c) => [c.numeral, c.title]), [
        ['I', 'The Republic Begins'],
        ['II', 'The Working Class'],
        ['III', 'Industrial Prosperity'],
        ['IV', 'The Riches of the Earth'],
        ['V', 'The Glorious Armed Forces'],
        ['VI', 'Environmental Progress'],
    ]);
    for (const chapter of CHAPTERS) {
        assert.ok(chapter.pages.length > 0, chapter.id);
        for (const page of chapter.pages) {
            assert.ok(page.heading, chapter.id);
            assert.ok(page.text.length > 0 && page.text.every((p) => typeof p === 'string' && p.length > 0), page.heading);
            for (const {kind} of page.art ?? []) assert.ok(ART[kind], `${page.heading}: ${kind} is an existing sprite`);
        }
    }
});

test('pages run cover first, then every chapter page in order; the contents lead to each chapter\'s first page', () => {
    const pages = manualPages();
    assert.equal(pages[0].kind, 'contents');
    assert.equal(pages.length, 1 + CHAPTERS.reduce((n, c) => n + c.pages.length, 0));
    for (const entry of contents(pages)) {
        assert.equal(pages[entry.page].chapter, entry.id);
        assert.equal(pages[entry.page].pageInChapter, 1);
        assert.equal(pages[entry.page - 1].chapter === entry.id, false, 'nothing of the chapter comes before it');
    }
});

test('every building table row is the building\'s real size, price, power and HP', () => {
    const shown = manualPages().flatMap((p) => p.table?.rows ?? []);
    assert.ok(shown.length >= 10);
    for (const row of shown) {
        const id = ['hq', 'powerPlant', 'factory', 'mine', 'autocannon', 'siegeCannon', 'barracks', 'wall', 'gateHorizontal', 'outpost', 'loudspeaker']
            .find((candidate) => getBuildingType(candidate).name === row[0]);
        const type = getBuildingType(id);
        assert.equal(row.length, TABLE_HEADER.length);
        assert.equal(row[1], `${type.width}x${type.height}`);
        assert.ok(row[2].startsWith(`${type.cost.credits}c`), `${id} price`);
        if (type.cost.ap) assert.ok(row[2].endsWith(`${type.cost.ap}AP`));
        assert.equal(row[3], type.power.supply ? `+${type.power.supply}` : type.power.demand ? `-${type.power.demand}` : '0');
        assert.equal(row[4], `${type.maxHp}`);
    }
    assert.deepEqual(buildingRow('factory'), ['Factory', '3x3', '400c 1AP', '-40', '300']); // today's values, read from the data
});

test('both cannons are drawn from frame 5 (aiming south-west) with that frame\'s own bounds; their build icons stay on frame 0', () => {
    const art = manualPages().flatMap((p) => p.art ?? []); // the cover has none
    const measured = { // each sheet's frame 5, measured from the PNG
        autocannon: {path: 'turrets/autocannon.png', visible: {x: 1, y: 5, width: 26, height: 23}},
        siegeCannon: {path: 'turrets/siege-cannon.png', visible: {x: 3, y: 6, width: 26, height: 26}},
    };
    for (const [kind, {path, visible}] of Object.entries(measured)) {
        const plates = art.filter((a) => a.kind === kind);
        assert.equal(plates.length, 1, kind);
        assert.equal(plates[0].frame, 5, kind);
        assert.deepEqual(plates[0].visible, visible, kind);
        const {frameWidth, frameHeight} = ART[kind];
        const sheet = readFileSync(new URL(`../../public/assets/sprites/${path}`, import.meta.url));
        assert.ok(sheet.readUInt32BE(16) / frameWidth > 5, `${kind}: frame 5 exists in the sheet`);
        assert.ok(visible.x >= 0 && visible.y >= 0 && visible.x + visible.width <= frameWidth && visible.y + visible.height <= frameHeight,
            `${kind}: the bounds lie inside one frame`);
    }
    assert.deepEqual(BUILD_ICON.autocannon, {kind: 'autocannon', frame: 0, visible: {x: 6, y: 3, width: 17, height: 24}});
    assert.deepEqual(BUILD_ICON.siegeCannon, {kind: 'siegeCannon', frame: 0, visible: {x: 7, y: 5, width: 19, height: 27}});
});

test('Presidential Wisdom: every supplied quote, word for word, on exactly one page, signed once per box', () => {
    const supplied = [
        'A nation without a Headquarters is merely a jungle with opinions.',
        'The sun rises for everyone. But it rises on MY orders!',
        'Workers are the backbone of San Papi. Naturally, I am the brain.',
        'A flag is an order. An explanation is an unnecessary expense.',
        'Every tree removed is one less tree plotting against progress!',
        'Every Credit earned belongs to the Republic. And the Republic belongs to me!',
        'I invented electricity! The Power Plant merely takes the credit.',
        'A road is a promise that someone else will do the walking.',
        'If the Earth has riches, keeping them buried is economic sabotage!',
        'Dig responsibly! And by responsibly, I mean FASTER!',
        'The perfect soldier never questions orders. Or runs out of ammunition.',
        'Our soldiers train in COUNTRY STROKE! Very advanced simulation! Very expensive!',
        'If the enemy is too close for artillery, the enemy has violated procedure!',
        'Pollution is the perfume of progress!',
        'Every citizen has the right to agree with me!',
        'Mutants are not a threat! They are merely unauthorized opposition!',
    ];
    const printed = manualPages().flatMap((p) => p.wisdom ?? []);
    assert.deepEqual([...printed].sort(), [...supplied].sort());
    assert.deepEqual(Object.values(WISDOM).sort(), [...supplied].sort());
    assert.equal(ATTRIBUTION, '— El Presidente Colonel Papi');
    const byHeading = Object.fromEntries(manualPages().filter((p) => p.kind === 'chapter').map((p) => [p.heading, p.wisdom]));
    assert.deepEqual(byHeading.Barracks, [WISDOM.barracks], 'COUNTRY STROKE goes with the Barracks');
    assert.deepEqual(byHeading.Cannons, [WISDOM.autocannon, WISDOM.siege]);
});

test('the Threat table is the game\'s own threatLevel, found by asking it', () => {
    const starts = threatThresholds();
    assert.equal(starts[0].from, 0);
    for (const {level, from} of starts.slice(1)) {
        assert.equal(threatLevel(from), level);
        assert.equal(threatLevel(from - 1), level - 1);
    }
});

test('no number is written into the copy: every figure comes from the game ("Day 0" is a phase, not a value)', () => {
    const source = readFileSync(new URL('../../src/content/fieldManual.js', import.meta.url), 'utf8');
    const literals = stringLiterals(source);
    assert.ok(literals.length > 50, 'the scanner sees the copy');
    const offenders = literals.filter((text) => /\d/.test(text.replaceAll('Day 0', '')));
    assert.deepEqual(offenders, []);
    // And the scanner would catch one.
    assert.deepEqual(stringLiterals("const a = 'costs 400 Credits'; const b = `${x} ok`;").filter((t) => /\d/.test(t)), ['costs 400 Credits']);
});

for (const [name, layout] of [['desktop', DESKTOP], ['touch', TOUCH]]) {
    test(`${name}: the book's \`i\` has its own rail slot, below the reserved PAPI DIRECTIVES slot, apart from every rail button`, () => {
        const {manual, directives, ...others} = layout.rail;
        assert.ok(manual, 'a slot of its own');
        assert.ok(directives, 'PAPI DIRECTIVES keeps its reserved slot');
        assert.equal(overlaps(manual, directives), false);
        assert.ok(manual.y > directives.y, 'below it');
        for (const [id, slot] of Object.entries(others)) assert.equal(overlaps(manual, slot), false, id);
        assert.ok(manual.height >= 84 && manual.width >= 84);
    });
}

test('suspension: the book is its own reason, so closing it releases nothing else', () => {
    const held = new Suspension();
    assert.equal(SuspendReason.MANUAL, 'manual');
    held.set(SuspendReason.BUILD, true);
    held.set(SuspendReason.MANUAL, true);
    assert.deepEqual(held.reasons(), ['build', 'manual']);
    held.set(SuspendReason.MANUAL, false);
    assert.deepEqual(held.reasons(), ['build']);
    assert.equal(held.set(SuspendReason.MANUAL, false), false, 'closing twice changes nothing');
});
