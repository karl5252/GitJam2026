/**
 * TASK 028: Loudspeaker Towers. The HQ network switch, coverage against protesters,
 * noise memory and mutant bias, on the real jungle map in the ACTIVE cycle through
 * the soak harness in GameScene's tick order.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {getBuildingType} from '../../src/core/buildingTypes.js';
import {GAME_PAUSED, INVALID_STATE} from '../../src/core/buildingPlacement.js';
import {EcologistState} from '../../src/core/ecologists.js';
import {LOUDSPEAKER} from '../../src/core/loudspeakers.js';
import {LOUDSPEAKER_BIAS, MINE_BIAS, TARGET_BIAS, selectTarget} from '../../src/core/mutants.js';
import {calculatePower} from '../../src/core/power.js';
import {Shift} from '../../src/core/shiftCycle.js';
import {digestOf} from '../soak/harness.js';
import {MAP, protestBase, run, toFirstDay} from './protestBase.js';

const towers = (w) => w.placement.buildings().filter(({type}) => type === 'loudspeaker');
const group = (w) => w.ecologists.snapshot().groups[0];

test('the approved provisional values', () => {
    const {cost, power, maxHp, width, height, pollutionPerNight, switchable} = getBuildingType('loudspeaker');
    assert.deepEqual({cost, power, maxHp, width, height, pollutionPerNight, switchable}, {
        cost: {credits: 250, ap: 1}, power: {supply: 0, demand: 15}, maxHp: 100, width: 1, height: 1, pollutionPerNight: 0, switchable: false,
    });
    assert.deepEqual({...LOUDSPEAKER}, {radius: 3});
    assert.deepEqual({...LOUDSPEAKER_BIAS}, {loud: 384, silent: 0});
    assert.equal(TARGET_BIAS.loudspeaker, LOUDSPEAKER_BIAS.silent);
});

test('one HQ switch for every tower: ON by default, new towers follow it, no tower switches alone', () => {
    const {w, terrain} = protestBase();
    const {col, row} = terrain.center;
    assert.equal(w.placement.loudspeakerNetwork, true);
    assert.equal(w.place('loudspeaker', col + 2, row - 4).ok, true);
    const demand = () => calculatePower(w.placement.buildings()).demand;
    const on = demand();
    assert.deepEqual(w.placement.setLoudspeakerNetwork(false), {ok: true, on: false});
    assert.equal(demand(), on - 15, 'an OFF tower draws nothing');
    assert.equal(w.place('loudspeaker', col - 2, row - 4).ok, true);
    assert.deepEqual(towers(w).map((t) => t.enabled), [false, false], 'the new one inherits OFF');
    assert.equal(w.placement.setEnabled(towers(w)[0].id, true).reason, INVALID_STATE);
    assert.equal(w.placement.setLoudspeakerNetwork(true).ok, true);
    assert.deepEqual(towers(w).map((t) => t.enabled), [true, true]);
    toFirstDay(w);
    w.clock.pause();
    assert.equal(w.placement.setLoudspeakerNetwork(false).reason, GAME_PAUSED);
});

test('a tower operates only when switched on and powered', () => {
    const {w, terrain} = protestBase();
    assert.equal(w.place('loudspeaker', terrain.center.col + 2, terrain.center.row - 4).ok, true);
    const [tower] = towers(w);
    toFirstDay(w);
    run(w, 2);
    assert.equal(w.loudspeakers.isOperating(tower.id), true);
    const plant = w.placement.buildings().find(({type}) => type === 'powerPlant');
    assert.equal(w.placement.setEnabled(plant.id, false).ok, true); // HQ's 20 cannot carry the Factory and the tower: LOW_POWER
    run(w, 1);
    assert.equal(w.loudspeakers.isOperating(tower.id), false);
    assert.equal(w.loudspeakers.covers(tower), false);
});

test('protesters never choose a site within 3 tiles of an operating tower, and block nothing', () => {
    const {w, site} = protestBase();
    assert.equal(w.place('loudspeaker', site.col, site.row - 2).ok, true); // d = 2: the only route tile is covered
    toFirstDay(w);
    let blocked = 0;
    run(w, 3600, () => {
        blocked += w.ecologists.snapshot().blocked.length;
        return w.cycle.shift !== Shift.DAY;
    });
    const {totals} = w.ecologists.snapshot();
    assert.equal(totals.groups, 1);
    assert.equal(blocked, 0);
    assert.ok(!w.loudspeakers.covers(w.ecologists.snapshot().groups[0]?.site ?? {col: 0, row: 0}), 'their site is out of reach');
});

test('a protest within reach breaks up the tick a tower starts operating; an outstanding DISPERSE ends cleanly', () => {
    const {w, site} = protestBase();
    toFirstDay(w);
    run(w, 3600, () => w.ecologists.snapshot().blocked.length > 0);
    const id = group(w).id;
    assert.equal(w.workers.orderDisperse(id).ok, true);
    assert.equal(w.place('loudspeaker', site.col - 1, site.row + 3).ok, true); // d^2 = 10: just out of reach
    run(w, 5);
    assert.equal(group(w).state, EcologistState.PROTESTING, 'out of reach changes nothing');
    assert.equal(w.place('loudspeaker', site.col, site.row + 3).ok, true); // d = 3: in reach
    run(w, 1);
    assert.equal(group(w).state, EcologistState.FLEEING);
    assert.deepEqual(w.ecologists.snapshot().blocked, []);
    assert.equal(w.ecologists.snapshot().totals.repelled, 1);
    run(w, 1);
    assert.deepEqual(w.workers.dispersals(), [], 'the order ended without dispersing anyone again');
    assert.equal(w.ecologists.snapshot().totals.dispersed, 0);
});

test('noise memory: a tower that broadcast by Day stays loud that Night, switched off or not; a silent Day leaves none', () => {
    const {w, terrain} = protestBase();
    assert.equal(w.place('loudspeaker', terrain.center.col + 2, terrain.center.row - 4).ok, true);
    const [tower] = towers(w);
    toFirstDay(w);
    run(w, 10);
    assert.equal(w.placement.setLoudspeakerNetwork(false).ok, true); // ten ticks of broadcast, then silence
    run(w, 4000, () => w.cycle.shift === Shift.NIGHT);
    assert.equal(w.cycle.shift, Shift.NIGHT);
    assert.equal(w.loudspeakers.isOperating(tower.id), false);
    assert.equal(w.loudspeakers.isLoud(tower.id), true, 'remembered from its Day');
    run(w, 4000, () => w.cycle.shift === Shift.DAY);
    run(w, 4000, () => w.cycle.shift === Shift.NIGHT); // a whole Day OFF
    assert.equal(w.loudspeakers.isLoud(tower.id), false, 'a silent Day leaves no noise');
    assert.equal(w.placement.setLoudspeakerNetwork(true).ok, true);
    run(w, 1);
    assert.equal(w.loudspeakers.isLoud(tower.id), true, 'broadcasting at Night is loud at once');
});

test('an unpowered tower makes no noise memory, whatever the switch says', () => {
    const {w, terrain} = protestBase();
    assert.equal(w.place('loudspeaker', terrain.center.col + 2, terrain.center.row - 4).ok, true);
    const [tower] = towers(w);
    const plant = w.placement.buildings().find(({type}) => type === 'powerPlant');
    assert.equal(w.placement.setEnabled(plant.id, false).ok, true);
    toFirstDay(w);
    run(w, 4000, () => w.cycle.shift === Shift.NIGHT);
    assert.equal(w.placement.loudspeakerNetwork, true);
    assert.equal(w.loudspeakers.isLoud(tower.id), false);
});

test('384 outbids HQ by 128 px and a working Mine by 192 px; a silent tower bids nothing', () => {
    const grid = {footprintRect: ({col, row, width, height}) => ({x: col * 10, y: row * 10, width: width * 10, height: height * 10})};
    const point = {x: 0, y: 0};
    const hq = {id: 'hq-1', type: 'hq', col: 10, row: 0, width: 3, height: 3}; // 100 px
    const at = (px) => ({id: 'loudspeaker-9', type: 'loudspeaker', col: px / 10, row: 0, width: 1, height: 1});
    const loud = new Set(['loudspeaker-9']);
    assert.equal(selectTarget(point, [hq, at(220)], grid, null, loud), 'loudspeaker-9'); // 220 - 384 < 100 - 256
    assert.equal(selectTarget(point, [hq, at(240)], grid, null, loud), 'hq-1');
    assert.equal(selectTarget(point, [hq, at(20)], grid, null, new Set()), 'hq-1', 'silent: 20 - 0 > 100 - 256');
    const mine = {id: 'mine-2', type: 'mine', col: 10, row: 0, width: 2, height: 2};
    assert.equal(selectTarget(point, [mine, at(290)], grid, new Set(['mine-2']), loud), 'loudspeaker-9'); // 290 - 384 < 100 - 192
    assert.equal(selectTarget(point, [mine, at(300)], grid, new Set(['mine-2']), loud), 'mine-2', 'ties go to the higher bias');
    assert.ok(LOUDSPEAKER_BIAS.loud > MINE_BIAS.active);
});

test('a mutant locked on a loud tower keeps its lock when the network is switched off', () => {
    const tower = {col: 32, row: 17}; // the clearing's east end, near the frame
    const index = MAP.spawnFrame.cols + (tower.row - MAP.spawnFrame.row); // the east edge, on the tower's row
    const rng = {nextInt: () => index, next: () => 0, snapshot: () => ({})};
    const {w} = protestBase({schedule: [60], rng});
    toFirstDay(w); // built by Day: Night 1's mutant would have taken a tower built in Day 0
    assert.equal(w.place('loudspeaker', tower.col, tower.row).ok, true);
    const [{id}] = towers(w);
    run(w, 4000, () => w.cycle.shift === Shift.NIGHT);
    run(w, 60);
    assert.equal(w.mutants.snapshot()[0].targetId, id);
    assert.equal(w.placement.setLoudspeakerNetwork(false).ok, true);
    let kept = true;
    run(w, 1500, () => {
        const [m] = w.mutants.snapshot();
        if (m) kept &&= m.targetId === id;
        return !w.placement.buildings().some((b) => b.id === id);
    });
    assert.ok(kept);
    assert.equal(w.placement.buildings().some((b) => b.id === id), false, 'and it fell');
    run(w, 1); // the next tick reads the buildings again
    assert.equal(w.loudspeakers.snapshot().towers.length, 0, 'a fallen tower covers and remembers nothing');
});

test('with no tower at all nothing changes, and the same Day replays tick for tick', () => {
    const trace = (tower) => {
        const {w, terrain} = protestBase({pollution: 80});
        if (tower) w.place('loudspeaker', terrain.center.col + 2, terrain.center.row - 4);
        toFirstDay(w);
        const lines = [];
        run(w, 3700, () => {
            lines.push(JSON.stringify([w.ecologists.snapshot(), w.loudspeakers.snapshot()]));
        });
        return digestOf(lines.join('\n'));
    };
    assert.equal(trace(true), trace(true));
    assert.equal(trace(false), trace(false));
    const {w} = protestBase();
    toFirstDay(w);
    run(w, 50);
    assert.deepEqual(w.loudspeakers.snapshot(), {radius: 3, towers: []});
});

test('tower art: one tile wide, standing on its tile, and sorted with everything else by the row it ends on', async () => {
    const {ART} = await import('../../src/scenes/SpriteArt.js');
    const {artDepth} = await import('../../src/scenes/BuildingArtLayer.js');
    const {gateDepth} = await import('../../src/scenes/GateLayer.js');
    assert.deepEqual(ART.outpost, {path: 'buildings/outpost.png', frameWidth: 32, frameHeight: 64, scale: 1, offsetX: 0, offsetY: 2, originY: 1});
    assert.deepEqual(ART.loudspeaker, {path: 'buildings/loudspeaker.png', frameWidth: 32, frameHeight: 72, scale: 1, offsetX: 0, offsetY: 2, originY: 1});
    const tower = (row) => artDepth({row, height: 1});
    const factory = (row) => artDepth({row, height: 3}); // ends two rows lower
    assert.equal(tower(5), gateDepth(5), 'the gates\' scale');
    assert.ok(tower(3) < factory(2), 'a tower north of a building\'s last row draws behind it');
    assert.ok(tower(6) > factory(2), 'one south of it draws in front');
    assert.ok(tower(0) > 1 && artDepth({row: 29, height: 3}) < 2, 'over the footprints, under trucks and the selection highlight');
});
