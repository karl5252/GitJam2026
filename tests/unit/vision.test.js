import test from 'node:test';
import assert from 'node:assert/strict';
import {calculatePower} from '../../src/core/power.js';
import {calculateSettlement} from '../../src/core/settlement.js';
import {FogOfWar, VISION_RADIUS, VisionState, buildingVision, fortificationTiles, startingKnown, unitVision, visionRadiusOf} from '../../src/core/vision.js';
import {BUILDING_TYPES} from '../../src/core/buildingTypes.js';
import {Grid} from '../../src/core/grid.js';
import {MapId, WORLD_MAPS, createTerrain} from '../../src/core/worldMap.js';

const {UNEXPLORED, EXPLORED, VISIBLE} = VisionState;
const COLS = 48;
const ROWS = 32;
const fog = (explored = []) => new FogOfWar({cols: COLS, rows: ROWS, explored});
const building = (type, col, row, extra = {}) => {
    const {width, height} = BUILDING_TYPES[type];
    return {id: `${type}-${col}-${row}`, type, col, row, width, height, enabled: true, ...extra};
};
const plant = () => building('powerPlant', 40, 28);
const hq = (col = 22, row = 16) => building('hq', col, row);
const see = (f, buildings) => f.setSources('buildings', buildingVision(buildings, calculatePower(buildings)));
const reach = (f, row, from) => {
    let col = from;
    while (f.stateAt(col + 1, row) === VISIBLE) col++;
    return col - from;
};

test('radii are ordered as designed: units and buildings alike, turrets more, Outposts most', () => {
    assert.equal(VISION_RADIUS.unit, VISION_RADIUS.building);
    assert.ok(VISION_RADIUS.turret > VISION_RADIUS.unit);
    assert.ok(VISION_RADIUS.outpost > VISION_RADIUS.turret);
});

test('every building type has the radius of its category', () => {
    for (const type of ['hq', 'factory', 'powerPlant', 'barracks']) assert.equal(visionRadiusOf(type), VISION_RADIUS.building, type);
    for (const type of ['autocannon', 'siegeCannon']) assert.equal(visionRadiusOf(type), VISION_RADIUS.turret, type);
    assert.equal(visionRadiusOf('outpost'), VISION_RADIUS.outpost);
    for (const type of ['wall', 'gateVertical', 'gateHorizontal']) assert.equal(visionRadiusOf(type), null, type);
});

test('HQ sees its radius beyond its footprint in tiles, circularly', () => {
    const f = fog();
    see(f, [hq()]);
    const r = VISION_RADIUS.building;
    assert.equal(f.stateAt(24 + r, 17), VISIBLE);
    assert.equal(f.stateAt(24 + r + 1, 17), UNEXPLORED);
    assert.equal(f.stateAt(22 - r, 17), VISIBLE);
    assert.equal(f.stateAt(22 - r - 1, 17), UNEXPLORED);
    assert.equal(f.stateAt(23, 18 + r), VISIBLE);
    assert.equal(f.stateAt(23, 18 + r + 1), UNEXPLORED);
    assert.equal(f.stateAt(24 + r, 18 + r), UNEXPLORED); // the corner of the box is outside the circle
});

test('on every seed HQ in the middle of the clearing sees the whole core, and the rest of the clearing starts explored', () => {
    const map = WORLD_MAPS[MapId.JUNGLE];
    for (const seed of [731, 1, 2, 3, 42, 99, 1000, 65535]) {
        const terrain = createTerrain(map, seed);
        const f = fog(startingKnown(terrain));
        const {center, core} = terrain;
        assert.equal(f.stateAt(center.col, center.row), EXPLORED);
        see(f, [hq(center.col - 1, center.row - 1)]);
        for (let row = core.row; row < core.row + core.height; row++) {
            for (let col = core.col; col < core.col + core.width; col++) assert.equal(f.stateAt(col, row), VISIBLE, `seed ${seed} at ${col},${row}`);
        }
        for (let row = 0; row < ROWS; row++) {
            for (let col = 0; col < COLS; col++) {
                if (terrain.kindAt(col, row) === 'clearing') assert.notEqual(f.stateAt(col, row), UNEXPLORED, `seed ${seed} at ${col},${row}`);
            }
        }
        assert.equal(f.stateAt(0, 0), UNEXPLORED);
    }
});

test('each source category sees exactly its own radius from a 1x1 tile', () => {
    for (const [type, radius] of [['autocannon', VISION_RADIUS.turret], ['outpost', VISION_RADIUS.outpost]]) {
        const f = fog();
        see(f, [plant(), building(type, 10, 10)]);
        assert.equal(reach(f, 10, 10), radius, type);
    }
    const units = fog();
    const grid = new Grid({cols: COLS, rows: ROWS, tileSize: 32});
    units.setSources('soldiers', unitVision([{x: 10 * 32 + 16, y: 10 * 32 + 16}], grid));
    assert.equal(reach(units, 10, 10), VISION_RADIUS.unit);
});

test('a Factory, Plant, Barracks and Siege Cannon see from their whole footprint', () => {
    for (const [type, radius] of [['factory', 6], ['powerPlant', 6], ['barracks', 6], ['siegeCannon', 7]]) {
        const f = fog();
        const b = building(type, 10, 10);
        see(f, [b]);
        assert.equal(reach(f, 10, 10 + b.width - 1), radius, type);
    }
});

test('an unpowered Factory and turret still see: only the Outpost needs power', () => {
    const f = fog();
    see(f, [building('factory', 10, 10), building('autocannon', 20, 20)]);
    assert.equal(f.stateAt(10, 10), VISIBLE);
    assert.equal(f.stateAt(20, 20), VISIBLE);
});

test('walls and gates scout nothing: their own tile is known, and not even that is visible', () => {
    const wall = building('wall', 10, 10);
    const gate = building('gateVertical', 12, 10);
    const f = fog();
    see(f, [wall, gate]);
    assert.equal(f.snapshot().counts[VISIBLE], 0);
    f.markExplored(fortificationTiles([wall, gate, hq()]));
    assert.equal(f.stateAt(10, 10), EXPLORED);
    assert.equal(f.stateAt(12, 10), EXPLORED);
    assert.equal(f.stateAt(11, 10), UNEXPLORED);
    assert.equal(f.stateAt(23, 17), UNEXPLORED);
});

test('markExplored never lowers a visible tile', () => {
    const f = fog();
    see(f, [hq()]);
    f.markExplored([{col: 23, row: 17}]);
    assert.equal(f.stateAt(23, 17), VISIBLE);
});

test('a powered Outpost extends what can be seen, as a union with HQ', () => {
    const f = fog();
    see(f, [hq(), plant()]);
    assert.equal(f.stateAt(23, 2), UNEXPLORED);
    see(f, [hq(), plant(), building('outpost', 23, 8)]);
    assert.equal(f.stateAt(23, 2), VISIBLE);
    assert.equal(f.stateAt(23, 17), VISIBLE);
});

const OUTPOST_TILE = {col: 10, row: 5};
const FAR = {col: 10 + VISION_RADIUS.outpost, row: 5};
const outpost = (extra) => building('outpost', OUTPOST_TILE.col, OUTPOST_TILE.row, extra);

const LOST = [
    ['switched off', () => [hq(), plant(), outpost({enabled: false})]],
    ['in low power', () => [hq(), building('factory', 2, 28), building('factory', 6, 28), building('factory', 10, 28), outpost()]],
    ['in a blackout', () => [outpost()]],
    ['destroyed', () => [hq(), plant()]],
];

for (const [how, buildings] of LOST) {
    test(`an Outpost ${how} stops revealing, and what it found stays explored`, () => {
        const f = fog();
        see(f, [hq(), plant(), outpost()]);
        assert.equal(f.stateAt(FAR.col, FAR.row), VISIBLE);
        see(f, buildings());
        assert.equal(f.stateAt(FAR.col, FAR.row), EXPLORED);
        assert.equal(f.stateAt(OUTPOST_TILE.col, OUTPOST_TILE.row), EXPLORED);
    });
}

test('an Outpost that was never powered discovers nothing, and power restored brings its vision back', () => {
    const f = fog();
    see(f, [outpost()]);
    assert.equal(f.stateAt(FAR.col, FAR.row), UNEXPLORED);
    see(f, [outpost(), plant()]);
    assert.equal(f.stateAt(FAR.col, FAR.row), VISIBLE);
});

test('a tile two sources see stays visible when one goes', () => {
    const f = fog();
    const [a, b] = [building('outpost', 10, 5), building('outpost', 14, 5)];
    see(f, [plant(), a, b]);
    see(f, [plant(), b]);
    assert.equal(f.stateAt(12, 5), VISIBLE);
});

test('a moving soldier carries its vision: tiles left behind go explored, tiles ahead go visible', () => {
    const grid = new Grid({cols: COLS, rows: ROWS, tileSize: 32});
    const f = fog();
    const at = (col, row) => unitVision([{x: col * 32 + 16, y: row * 32 + 16}], grid);
    f.setSources('soldiers', at(10, 10));
    assert.equal(f.stateAt(4, 10), VISIBLE);
    assert.equal(f.stateAt(22, 10), UNEXPLORED);
    f.setSources('soldiers', at(16, 10));
    assert.equal(f.stateAt(4, 10), EXPLORED);
    assert.equal(f.stateAt(22, 10), VISIBLE);
    f.setSources('soldiers', []); // dawn
    assert.equal(f.stateAt(22, 10), EXPLORED);
    assert.equal(f.snapshot().counts[VISIBLE], 0);
});

test('a unit that stays on its tile recalculates nothing, however much it moves inside it', () => {
    const grid = new Grid({cols: COLS, rows: ROWS, tileSize: 32});
    const f = fog();
    assert.equal(f.setSources('soldiers', unitVision([{x: 321, y: 321}], grid)), true);
    const {revision} = f;
    assert.equal(f.setSources('soldiers', unitVision([{x: 350, y: 349}], grid)), false);
    assert.equal(f.revision, revision);
    assert.equal(f.setSources('soldiers', unitVision([{x: 353, y: 349}], grid)), true);
});

test('another mobile group joins the union with no new code, and leaving takes only its own vision', () => {
    const grid = new Grid({cols: COLS, rows: ROWS, tileSize: 32});
    const f = fog();
    see(f, [hq()]);
    f.setSources('workers', unitVision([{x: 5 * 32, y: 5 * 32}], grid, 3));
    assert.equal(f.stateAt(5, 5), VISIBLE);
    assert.equal(f.stateAt(23, 17), VISIBLE);
    f.setSources('workers', []);
    assert.equal(f.stateAt(5, 5), EXPLORED);
    assert.equal(f.stateAt(23, 17), VISIBLE);
});

test('a unit off the map is no source, and a radius past the map edge is clipped', () => {
    const grid = new Grid({cols: COLS, rows: ROWS, tileSize: 32});
    assert.deepEqual(unitVision([{x: -5, y: 5}], grid), []);
    const f = fog();
    f.setSources('units', [{col: 0, row: 0, width: 1, height: 1, radius: 3}]);
    assert.equal(f.stateAt(0, 0), VISIBLE);
    assert.equal(f.stateAt(-1, 0), null);
});

test('visibility depends on sources alone: there is no camera, and identical states give identical fog', () => {
    assert.deepEqual(FogOfWar.length, 1); // one config: grid size and starting knowledge
    const buildings = [hq(), plant(), outpost()];
    const [a, b] = [fog(), fog()];
    see(a, buildings);
    see(b, buildings);
    assert.deepEqual(a.snapshot(), b.snapshot());
    assert.deepEqual(see(b, buildings), false);
});

test('off the map stateAt is null', () => {
    for (const [col, row] of [[-1, 0], [0, -1], [COLS, 0], [0, ROWS], [1.5, 2]]) assert.equal(fog().stateAt(col, row), null);
});

test('no Outposts and many: settlement charges nothing', () => {
    const buildings = [hq(), plant(), outpost(), building('outpost', 12, 5), building('outpost', 14, 5)];
    const {upkeep, net} = calculateSettlement(buildings);
    assert.deepEqual([upkeep, net], [0, 0]);
    assert.deepEqual([BUILDING_TYPES.outpost.cost, BUILDING_TYPES.outpost.power.demand], [{credits: 100, ap: 1}, 10]);
});
