import test from 'node:test';
import assert from 'node:assert/strict';
import {Grid, PlacementFailure} from '../../src/core/grid.js';
import {BUILDING_TYPES} from '../../src/core/buildingTypes.js';
import {BuildingPlacement, footprintAt, NO_SELECTION} from '../../src/core/buildingPlacement.js';
import {Economy, EconomyFailure} from '../../src/core/economy.js';

const setup = (resources) => {
    const grid = new Grid({cols: 24, rows: 16, tileSize: 32, originX: 256, originY: 104});
    const economy = new Economy(resources);
    return {grid, economy, placement: new BuildingPlacement(grid, economy)};
};

/** Everything a failed attempt must leave untouched. */
const fullState = ({grid, economy, placement}) => JSON.stringify({
    grid: grid.snapshot(), economy: economy.snapshot(), buildings: placement.buildings(),
});

const occupantsOf = (grid) => grid.snapshot().occupants;
const asOccupants = (buildings) => buildings.map(({id, col, row, width, height}) => ({id, col, row, width, height}));

// ---- footprintAt ------------------------------------------------------------

test('odd footprints are centred on the pointer cell', () => {
    assert.deepEqual(footprintAt(BUILDING_TYPES.outpost, {col: 5, row: 7}), {col: 5, row: 7, width: 1, height: 1});
    assert.deepEqual(footprintAt(BUILDING_TYPES.factory, {col: 5, row: 7}), {col: 4, row: 6, width: 3, height: 3});
});

test('even footprints put the pointer cell at the top-left of the central block', () => {
    assert.deepEqual(footprintAt({width: 2, height: 2}, {col: 5, row: 7}), {col: 5, row: 7, width: 2, height: 2});
    assert.deepEqual(footprintAt({width: 4, height: 2}, {col: 5, row: 7}), {col: 4, row: 7, width: 4, height: 2});
});

// ---- Mode -----------------------------------------------------------------------

test('starts outside placement mode', () => {
    const {placement} = setup();
    assert.equal(placement.selectedType, null);
    assert.equal(placement.isPlacing, false);
    assert.equal(placement.preview({col: 3, row: 3}), null);
});

test('select enters placement mode; cancel leaves it', () => {
    const {placement} = setup();
    assert.equal(placement.select('factory'), true);
    assert.equal(placement.selectedType, 'factory');
    assert.equal(placement.isPlacing, true);
    assert.equal(placement.select('outpost'), true);
    assert.equal(placement.selectedType, 'outpost');
    placement.cancel();
    assert.equal(placement.selectedType, null);
    assert.equal(placement.isPlacing, false);
});

test('select rejects unknown types and keeps the current mode', () => {
    const {placement} = setup();
    placement.select('outpost');
    assert.equal(placement.select('tower'), false);
    assert.equal(placement.selectedType, 'outpost');
});

test('placeAt without a selection fails with no-selection and changes nothing', () => {
    const {grid, placement} = setup();
    assert.deepEqual(placement.placeAt({col: 3, row: 3}), {ok: false, reason: NO_SELECTION});
    assert.deepEqual(placement.buildings(), []);
    assert.deepEqual(occupantsOf(grid), []);
});

// ---- Preview ----------------------------------------------------------------------

test('preview reports the grid validation result for the centred footprint', () => {
    const {placement} = setup();
    placement.select('factory');
    assert.deepEqual(placement.preview({col: 5, row: 5}), {footprint: {col: 4, row: 4, width: 3, height: 3}, ok: true});
    assert.deepEqual(placement.preview({col: 0, row: 5}), {
        footprint: {col: -1, row: 4, width: 3, height: 3}, ok: false, reason: PlacementFailure.OUT_OF_BOUNDS,
    });
    assert.equal(placement.preview(null), null);
});

test('preview matches grid.canPlace exactly and never mutates', () => {
    const {grid, placement} = setup();
    placement.select('outpost');
    placement.placeAt({col: 5, row: 5});
    placement.select('factory');
    for (const cell of [{col: 5, row: 5}, {col: 6, row: 6}, {col: 10, row: 10}, {col: 23, row: 15}, {col: 0, row: 0}]) {
        const p = placement.preview(cell);
        const {footprint, ...result} = p;
        assert.deepEqual(result, grid.canPlace(footprint));
    }
    assert.equal(placement.buildings().length, 1);
    assert.equal(occupantsOf(grid).length, 1);
});

// ---- Placement --------------------------------------------------------------------

test('valid factory placement occupies all nine cells', () => {
    const {grid, placement} = setup();
    placement.select('factory');
    const result = placement.placeAt({col: 10, row: 8});
    assert.deepEqual(result, {ok: true, building: {id: 'factory-1', type: 'factory', col: 9, row: 7, width: 3, height: 3, enabled: true}});
    for (let row = 7; row <= 9; row++) {
        for (let col = 9; col <= 11; col++) assert.equal(grid.occupantAt(col, row), 'factory-1');
    }
    assert.equal(grid.occupantAt(8, 8), null);
    assert.equal(grid.occupantAt(12, 8), null);
});

test('placement mode stays active after success; ids are deterministic', () => {
    const {placement} = setup();
    placement.select('outpost');
    assert.equal(placement.placeAt({col: 0, row: 0}).building.id, 'outpost-1');
    assert.equal(placement.selectedType, 'outpost');
    assert.equal(placement.placeAt({col: 2, row: 0}).building.id, 'outpost-2');
    placement.select('factory');
    assert.equal(placement.placeAt({col: 10, row: 10}).building.id, 'factory-3');
    assert.deepEqual(placement.buildings().map((b) => b.id), ['outpost-1', 'outpost-2', 'factory-3']);
});

test('overlapping placement is rejected without changing grid or buildings', () => {
    const {grid, placement} = setup();
    placement.select('factory');
    placement.placeAt({col: 10, row: 8});
    const gridBefore = JSON.stringify(grid.snapshot());
    const buildingsBefore = JSON.stringify(placement.buildings());

    assert.deepEqual(placement.placeAt({col: 12, row: 9}), {ok: false, reason: PlacementFailure.OCCUPIED, blockers: ['factory-1']});
    placement.select('outpost');
    assert.deepEqual(placement.placeAt({col: 10, row: 8}), {ok: false, reason: PlacementFailure.OCCUPIED, blockers: ['factory-1']});

    assert.equal(JSON.stringify(grid.snapshot()), gridBefore);
    assert.equal(JSON.stringify(placement.buildings()), buildingsBefore);
});

test('edge placement that crosses the grid boundary is rejected without changes', () => {
    const {grid, placement} = setup();
    placement.select('factory');
    for (const cell of [{col: 0, row: 5}, {col: 23, row: 5}, {col: 5, row: 0}, {col: 5, row: 15}]) {
        assert.deepEqual(placement.placeAt(cell), {ok: false, reason: PlacementFailure.OUT_OF_BOUNDS});
    }
    assert.deepEqual(placement.buildings(), []);
    assert.deepEqual(occupantsOf(grid), []);
    // Flush against the edge is fine.
    assert.equal(placement.placeAt({col: 1, row: 1}).ok, true);
    assert.equal(placement.placeAt({col: 22, row: 14}).ok, true);
});

test('a rejected attempt does not consume an id', () => {
    const {placement} = setup();
    placement.select('factory');
    placement.placeAt({col: 0, row: 0}); // out of bounds
    assert.equal(placement.placeAt({col: 5, row: 5}).building.id, 'factory-1');
});

test('adjacent buildings are accepted', () => {
    const {placement} = setup();
    placement.select('factory');
    placement.placeAt({col: 5, row: 5});
    placement.select('outpost');
    assert.equal(placement.placeAt({col: 7, row: 5}).ok, true);
    assert.equal(placement.placeAt({col: 3, row: 5}).ok, true);
});

test('buildings always mirror the grid occupants', () => {
    const {grid, placement} = setup();
    placement.select('factory');
    placement.placeAt({col: 5, row: 5});
    placement.placeAt({col: 6, row: 6}); // rejected
    placement.select('outpost');
    placement.placeAt({col: 20, row: 3});
    assert.deepEqual(asOccupants(placement.buildings()), occupantsOf(grid));
});

test('buildings() returns detached data', () => {
    const {grid, placement} = setup();
    placement.select('outpost');
    const {building} = placement.placeAt({col: 2, row: 2});
    building.col = 9;
    const list = placement.buildings();
    list[0].col = 9;
    list.push({id: 'fake'});
    assert.deepEqual(placement.buildings(), [{id: 'outpost-1', type: 'outpost', col: 2, row: 2, width: 1, height: 1, enabled: true}]);
    assert.equal(grid.occupantAt(2, 2), 'outpost-1');
    assert.deepEqual(JSON.parse(JSON.stringify(placement.buildings())), placement.buildings());
});

// ---- Economy integration -------------------------------------------------------

test('successful placement deducts the type cost exactly once', () => {
    const {economy, placement} = setup();
    placement.select('outpost');
    placement.placeAt({col: 2, row: 2});
    assert.deepEqual(economy.snapshot(), {credits: 900, ap: 4});
    placement.select('factory');
    placement.placeAt({col: 10, row: 8});
    assert.deepEqual(economy.snapshot(), {credits: 500, ap: 3});
});

test('insufficient credits on free cells: rejected, preview invalid, nothing changes', () => {
    const ctx = setup();
    const {grid, economy, placement} = ctx;
    placement.select('factory');
    placement.placeAt({col: 2, row: 2});
    placement.placeAt({col: 6, row: 2});
    assert.deepEqual(economy.snapshot(), {credits: 200, ap: 3});

    const cell = {col: 12, row: 10};
    const preview = placement.preview(cell);
    assert.deepEqual(preview, {
        footprint: {col: 11, row: 9, width: 3, height: 3}, ok: false, reason: EconomyFailure.INSUFFICIENT_CREDITS,
    });
    assert.deepEqual(grid.canPlace(preview.footprint), {ok: true}); // the cells themselves are free

    const before = fullState(ctx);
    assert.deepEqual(placement.placeAt(cell), {ok: false, reason: EconomyFailure.INSUFFICIENT_CREDITS});
    assert.equal(fullState(ctx), before);

    // An affordable type still works and receives the next id.
    placement.select('outpost');
    assert.equal(placement.placeAt(cell).building.id, 'outpost-3');
});

test('insufficient AP: a sixth outpost is rejected without changes', () => {
    const ctx = setup();
    const {economy, placement} = ctx;
    placement.select('outpost');
    for (let i = 0; i < 5; i++) assert.equal(placement.placeAt({col: i * 2, row: 0}).ok, true);
    assert.deepEqual(economy.snapshot(), {credits: 500, ap: 0});

    const before = fullState(ctx);
    assert.deepEqual(placement.preview({col: 20, row: 10}), {
        footprint: {col: 20, row: 10, width: 1, height: 1}, ok: false, reason: EconomyFailure.INSUFFICIENT_AP,
    });
    assert.deepEqual(placement.placeAt({col: 20, row: 10}), {ok: false, reason: EconomyFailure.INSUFFICIENT_AP});
    assert.equal(fullState(ctx), before);
});

test('spatial failures take precedence over resource failures', () => {
    const {placement} = setup({credits: 0, ap: 0});
    placement.select('factory');
    assert.equal(placement.preview({col: 0, row: 0}).reason, PlacementFailure.OUT_OF_BOUNDS);
    assert.equal(placement.placeAt({col: 0, row: 0}).reason, PlacementFailure.OUT_OF_BOUNDS);
    assert.equal(placement.placeAt({col: 5, row: 5}).reason, EconomyFailure.INSUFFICIENT_CREDITS);
});

test('no rejection of any kind mutates grid, balances, buildings or next id', () => {
    const ctx = setup({credits: 450, ap: 2});
    const {placement} = ctx;
    assert.equal(placement.placeAt({col: 5, row: 5}).reason, NO_SELECTION);
    placement.select('factory');
    placement.placeAt({col: 5, row: 5}); // factory-1 -> 50 credits, 1 AP left
    const before = fullState(ctx);

    const attempts = [
        ['factory', {col: 0, row: 0}, PlacementFailure.OUT_OF_BOUNDS],
        ['factory', {col: 6, row: 6}, PlacementFailure.OCCUPIED],
        ['factory', {col: 15, row: 10}, EconomyFailure.INSUFFICIENT_CREDITS],
        ['outpost', {col: 5, row: 5}, PlacementFailure.OCCUPIED],
        ['outpost', {col: 15, row: 10}, EconomyFailure.INSUFFICIENT_CREDITS],
    ];
    for (const [type, cell, reason] of attempts) {
        placement.select(type);
        assert.equal(placement.placeAt(cell).reason, reason, `${type} at ${JSON.stringify(cell)}`);
        assert.equal(fullState(ctx), before);
    }
});

test('preview never charges', () => {
    const {economy, placement} = setup();
    placement.select('factory');
    for (let i = 0; i < 10; i++) placement.preview({col: 5, row: 5});
    assert.deepEqual(economy.snapshot(), {credits: 1000, ap: 5});
});

test('construction gate: rejected first, select refused, nothing mutates', () => {
    let allowed = true;
    const grid = new Grid({cols: 24, rows: 16, tileSize: 32});
    const economy = new Economy({credits: 0, ap: 0});
    const placement = new BuildingPlacement(grid, economy, {isConstructionAllowed: () => allowed});
    assert.equal(placement.select('factory'), true);
    allowed = false;
    const before = JSON.stringify({g: grid.snapshot(), e: economy.snapshot(), b: placement.buildings()});
    // Gate precedes spatial (out-of-bounds) and economy (no credits) reasons.
    assert.equal(placement.placeAt({col: 0, row: 0}).reason, 'construction-disabled');
    assert.equal(placement.placeAt({col: 5, row: 5}).reason, 'construction-disabled');
    assert.equal(placement.preview({col: 5, row: 5}).reason, 'construction-disabled');
    assert.equal(placement.select('outpost'), false);
    assert.equal(JSON.stringify({g: grid.snapshot(), e: economy.snapshot(), b: placement.buildings()}), before);
    allowed = true;
    assert.equal(placement.placeAt({col: 5, row: 5}).reason, EconomyFailure.INSUFFICIENT_CREDITS);
});

test('no-selection still precedes the construction gate', () => {
    const placement = new BuildingPlacement(new Grid({cols: 4, rows: 4, tileSize: 32}), new Economy(), {isConstructionAllowed: () => false});
    assert.deepEqual(placement.placeAt({col: 1, row: 1}), {ok: false, reason: NO_SELECTION});
});

test('a failing economy commit rolls back the grid (all-or-nothing)', () => {
    const grid = new Grid({cols: 24, rows: 16, tileSize: 32});
    // A disagreeing economy: validation passes, the commit fails.
    const economy = {
        canAfford: () => ({ok: true}),
        spend: () => ({ok: false, reason: EconomyFailure.INSUFFICIENT_CREDITS}),
    };
    const placement = new BuildingPlacement(grid, economy);
    placement.select('factory');

    assert.deepEqual(placement.placeAt({col: 5, row: 5}), {ok: false, reason: EconomyFailure.INSUFFICIENT_CREDITS});
    assert.deepEqual(grid.snapshot().occupants, []);
    assert.equal(grid.occupantAt(5, 5), null);
    assert.deepEqual(placement.buildings(), []);

    economy.spend = () => ({ok: true});
    assert.equal(placement.placeAt({col: 5, row: 5}).building.id, 'factory-1'); // id was not consumed
});
