import test from 'node:test';
import assert from 'node:assert/strict';
import {Grid} from '../../src/core/grid.js';
import {firstSolid} from '../../src/core/lineOfFire.js';

/**
 * What a shot hits. The map has its origin at 0,0, so tile 5,5 is x 160-192 and
 * y 160-192. A Vertical Gate passes along x, between its west and east faces, and
 * a Horizontal Gate along y, between its north and south faces.
 */

const SIZE = {wall: 1, gateVertical: 1, gateHorizontal: 1, factory: 3};

function scene(list, {open = []} = {}) {
    const grid = new Grid({cols: 24, rows: 16, tileSize: 32, originX: 0, originY: 0});
    const buildings = list.map(([type, col, row], i) => {
        const size = SIZE[type];
        const building = {id: `${type}-${i + 1}`, type, col, row, width: size, height: size};
        assert.equal(grid.place(building.id, building).ok, true);
        return building;
    });
    const byId = new Map(buildings.map((building) => [building.id, building]));
    const isOpenGate = (id) => open.includes(id);
    return (from, to) => firstSolid(from, to, {grid, buildings, byId, isOpenGate});
}

const at = (x, y) => ({x, y});

// ---- Plain obstructions -----------------------------------------------------

test('a clear line hits nothing', () => {
    assert.equal(scene([['wall', 5, 5]])(at(100, 100), at(300, 100)), null);
});

test('the first solid thing on the line is the only thing hit', () => {
    const shot = scene([['wall', 8, 5], ['wall', 5, 5], ['factory', 10, 4]]);
    const hit = shot(at(100, 176), at(400, 176));
    assert.equal(hit.building.id, 'wall-2');
    assert.deepEqual([hit.x, hit.y], [160, 176]);
    assert.equal(shot(at(450, 176), at(100, 176)).building.id, 'factory-3', 'from the other side');
});

test('a line ending on a footprint hits it, and a line stopping short does not', () => {
    const shot = scene([['wall', 5, 5]]);
    assert.equal(shot(at(100, 176), at(160, 176)).building.id, 'wall-1');
    assert.equal(shot(at(100, 176), at(159.5, 176)), null);
});

test('a line along a tile line touches the tiles on both sides', () => {
    const shot = scene([['wall', 5, 4]]);
    assert.equal(shot(at(100, 160), at(300, 160)).building.id, 'wall-1');
});

test('two walls touching at a corner leave no gap', () => {
    const shot = scene([['wall', 5, 5], ['wall', 6, 6]]);
    // Through their shared corner at 192,192, and only there.
    assert.ok(shot(at(160, 224), at(224, 160)));
});

test('a real gap lets a shot through, and only through it', () => {
    const shot = scene([['wall', 5, 4], ['wall', 5, 6]]);
    assert.equal(shot(at(100, 176), at(300, 176)), null);
    assert.equal(shot(at(100, 170), at(300, 182)), null);
    assert.ok(shot(at(100, 130), at(300, 222)), 'a steeper line meets a wall');
});

test('equally near buildings go to the earliest in the list', () => {
    const shot = scene([['wall', 5, 5], ['wall', 5, 4]]);
    assert.equal(shot(at(100, 160), at(300, 160)).building.id, 'wall-1');
    const swapped = scene([['wall', 5, 4], ['wall', 5, 5]]);
    assert.equal(swapped(at(100, 160), at(300, 160)).building.id, 'wall-1');
});

test('lines from outside the map are traced like any other', () => {
    const shot = scene([['wall', 0, 8]]);
    assert.equal(shot(at(-0.5, 272), at(200, 272)).building.id, 'wall-1');
    assert.equal(shot(at(-0.5, 200), at(-0.5, 400)), null, 'beyond the map there is nothing to hit');
});

// ---- Checkerboards and staggered lines --------------------------------------

test('no line crosses a checkerboard two tiles deep, not even an exact diagonal', () => {
    const cells = [];
    for (let col = 0; col < 24; col++) {
        for (const row of [7, 8]) if ((col + row) % 2 === 0) cells.push(['wall', col, row]);
    }
    const shot = scene(cells);
    let lines = 0;
    for (let x = 200; x <= 560; x += 3.5) {
        for (let to = 200; to <= 560; to += 12.5) {
            assert.ok(shot(at(x, 200), at(to, 320)), `${x} to ${to}`);
            lines++;
        }
    }
    assert.ok(lines > 1000);
    for (let x = 192; x <= 544; x += 32) {
        assert.ok(shot(at(x, 224 - 32), at(x + 160, 352)), `the diagonal from ${x}`);
        assert.ok(shot(at(x + 160, 192), at(x, 352)), `the other diagonal from ${x}`);
    }
});

test('a staggered wall leaks only where a line really fits between its pieces', () => {
    const shot = scene([['wall', 5, 5], ['wall', 7, 6]]);
    assert.equal(shot(at(200, 100), at(200, 300)), null, 'straight through the stagger');
    assert.equal(shot(at(100, 192), at(300, 192)).building.id, 'wall-1', 'along the line between them');
});

// ---- Gates ------------------------------------------------------------------

const VERTICAL = [['gateVertical', 5, 5]];
const HORIZONTAL = [['gateHorizontal', 5, 5]];
const OPEN_VERTICAL = {open: ['gateVertical-1']};
const OPEN_HORIZONTAL = {open: ['gateHorizontal-1']};

test('a shut gate is solid whichever way it faces', () => {
    assert.equal(scene(VERTICAL)(at(100, 176), at(300, 176)).building.id, 'gateVertical-1');
    assert.equal(scene(HORIZONTAL)(at(176, 100), at(176, 300)).building.id, 'gateHorizontal-1');
});

test('an open gate passes a shot along its passage, for both orientations and both directions', () => {
    const vertical = scene(VERTICAL, OPEN_VERTICAL);
    assert.equal(vertical(at(100, 176), at(300, 176)), null);
    assert.equal(vertical(at(300, 176), at(100, 176)), null);
    const horizontal = scene(HORIZONTAL, OPEN_HORIZONTAL);
    assert.equal(horizontal(at(176, 100), at(176, 300)), null);
    assert.equal(horizontal(at(176, 300), at(176, 100)), null);
});

test('an open gate is solid across its passage', () => {
    assert.equal(scene(VERTICAL, OPEN_VERTICAL)(at(176, 100), at(176, 300)).building.id, 'gateVertical-1');
    assert.equal(scene(HORIZONTAL, OPEN_HORIZONTAL)(at(100, 176), at(300, 176)).building.id, 'gateHorizontal-1');
});

test('a diagonal shot passes an open gate only by crossing both passage faces', () => {
    const vertical = scene(VERTICAL, OPEN_VERTICAL);
    assert.equal(vertical(at(100, 165), at(250, 187)), null, 'in by the west face, out by the east');
    assert.equal(vertical(at(250, 165), at(100, 187)), null, 'in by the east face, out by the west');
    const horizontal = scene(HORIZONTAL, OPEN_HORIZONTAL);
    assert.equal(horizontal(at(165, 100), at(187, 250)), null, 'in by the north face, out by the south');
    assert.equal(horizontal(at(165, 250), at(187, 100)), null, 'in by the south face, out by the north');
});

test('side entry is blocked even when the line mostly runs along the passage', () => {
    // Longer in x than in y, so a test of the dominant axis alone would let this
    // through. It enters by the north post, not the west face.
    const vertical = scene(VERTICAL, OPEN_VERTICAL);
    assert.equal(vertical(at(140, 150), at(260, 190)).building.id, 'gateVertical-1', 'in from the north');
    assert.equal(vertical(at(140, 200), at(260, 164)).building.id, 'gateVertical-1', 'in from the south');
    assert.equal(vertical(at(100, 176), at(260, 216)).building.id, 'gateVertical-1', 'out by the south post');
    const horizontal = scene(HORIZONTAL, OPEN_HORIZONTAL);
    assert.equal(horizontal(at(150, 140), at(190, 260)).building.id, 'gateHorizontal-1', 'in from the west');
    assert.equal(horizontal(at(200, 140), at(164, 260)).building.id, 'gateHorizontal-1', 'in from the east');
    assert.equal(horizontal(at(176, 100), at(216, 260)).building.id, 'gateHorizontal-1', 'out by the east post');
});

test('a line that clips a corner of an open gate is blocked', () => {
    // Each of these touches the gate at exactly one corner.
    for (const [from, to] of [
        [at(100, 220), at(220, 100)], // 160,160
        [at(132, 100), at(252, 220)], // 192,160
        [at(100, 132), at(220, 252)], // 160,192
        [at(132, 252), at(252, 132)], // 192,192
    ]) {
        assert.equal(scene(VERTICAL, OPEN_VERTICAL)(from, to).building.id, 'gateVertical-1');
        assert.equal(scene(HORIZONTAL, OPEN_HORIZONTAL)(from, to).building.id, 'gateHorizontal-1');
    }
});

test('a line along the post of an open gate is blocked', () => {
    assert.equal(scene(VERTICAL, OPEN_VERTICAL)(at(100, 160), at(300, 160)).building.id, 'gateVertical-1');
    assert.equal(scene(VERTICAL, OPEN_VERTICAL)(at(100, 192), at(300, 192)).building.id, 'gateVertical-1');
    assert.equal(scene(HORIZONTAL, OPEN_HORIZONTAL)(at(160, 100), at(160, 300)).building.id, 'gateHorizontal-1');
});

test('a shot that stops in the doorway or on a face has not passed', () => {
    const vertical = scene(VERTICAL, OPEN_VERTICAL);
    assert.equal(vertical(at(100, 176), at(176, 176)).building.id, 'gateVertical-1');
    assert.equal(vertical(at(100, 176), at(160, 176)).building.id, 'gateVertical-1');
});

test('the walls beside an open gate still stop a shot that misses the doorway', () => {
    const shot = scene([['gateVertical', 5, 5], ['wall', 5, 4], ['wall', 5, 6]], OPEN_VERTICAL);
    assert.equal(shot(at(100, 176), at(300, 176)), null);
    assert.equal(shot(at(100, 120), at(300, 240)).building.id, 'wall-2', 'into the wall, before the gate');
});

test('a building behind an open gate is the first solid thing', () => {
    const shot = scene([['gateVertical', 5, 5], ['wall', 8, 5]], OPEN_VERTICAL);
    assert.equal(shot(at(100, 176), at(400, 176)).building.id, 'wall-2');
});

test('a gate that shut on the shooter does not stop it shooting out', () => {
    const shot = scene([['gateVertical', 5, 5], ['wall', 8, 5]]);
    assert.equal(shot(at(176, 176), at(400, 176)).building.id, 'wall-2');
});
