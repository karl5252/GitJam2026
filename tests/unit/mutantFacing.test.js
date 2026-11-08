import test from 'node:test';
import assert from 'node:assert/strict';
import {BRUTE, MUTANT, SPITTER} from '../../src/core/mutants.js';
import {Grid} from '../../src/core/grid.js';
import {Facing, MUTANT_NATIVE_FACING, attackFocus, flipFor, nextFacing} from '../../src/scenes/mutantFacing.js';
import {MutantLayer} from '../../src/scenes/MutantLayer.js';

const {LEFT, RIGHT} = Facing;

test('every mutant sheet is authored facing right, so flipX means facing left', () => {
    for (const kind of ['runner', 'spitter', 'brute']) {
        assert.equal(MUTANT_NATIVE_FACING[kind], RIGHT, kind);
        assert.equal(flipFor(kind, RIGHT), false, kind);
        assert.equal(flipFor(kind, LEFT), true, kind);
    }
});

test('moving sets the facing, and standing still keeps the last one', () => {
    assert.equal(nextFacing(RIGHT, {x: 100, dx: -0.5, focus: null}), LEFT);
    assert.equal(nextFacing(LEFT, {x: 100, dx: 0.25, focus: null}), RIGHT);
    assert.equal(nextFacing(LEFT, {x: 100, dx: 0, focus: null}), LEFT, 'stationary keeps left');
    assert.equal(nextFacing(RIGHT, {x: 100, dx: 0, focus: null}), RIGHT, 'stationary keeps right');
    assert.equal(nextFacing(LEFT, {x: 100, dx: 0.05, focus: null}), LEFT, 'sub-pixel jitter is not a turn');
});

test('an attack faces its focus, whichever way the mutant last moved', () => {
    assert.equal(nextFacing(RIGHT, {x: 100, dx: 0, focus: {x: 60}}), LEFT);
    assert.equal(nextFacing(LEFT, {x: 100, dx: 0, focus: {x: 140}}), RIGHT);
    assert.equal(nextFacing(LEFT, {x: 100, dx: 0.5, focus: {x: 60}}), LEFT, 'the focus wins over movement');
    assert.equal(nextFacing(LEFT, {x: 100, dx: 0, focus: {x: 100}}), LEFT, 'straight above or below keeps the facing');
});

const grid = new Grid({cols: 24, rows: 16, tileSize: 32});
const world = (buildings, extra = {}) => ({
    byId: new Map(buildings.map((b) => [b.id, b])),
    rectOf: (b) => grid.footprintRect(b),
    tileSize: 32,
    ...extra,
});
const wallAt = (col) => ({id: 'wall-1', type: 'wall', col, row: 5, width: 1, height: 1});
const hq = {id: 'hq-1', type: 'hq', col: 10, row: 5, width: 3, height: 3};

test('melee focus follows the melee order: truck, unit, obstacle, target', () => {
    const attacking = {x: 200, y: 176, targetId: 'hq-1', obstacleId: 'wall-1', attackTimer: MUTANT.attackCooldownTicks - 5};
    const buildings = [hq, wallAt(5)]; // the wall is at x 160..192, to the left
    assert.equal(attackFocus(attacking, world(buildings)).x, 192);
    assert.deepEqual(attackFocus(attacking, world(buildings, {units: [{x: 212, y: 176}]})), {x: 212, y: 176});
    assert.deepEqual(attackFocus(attacking, world(buildings, {units: [{x: 212, y: 176}], trucks: [{x: 180, y: 176}]})), {x: 180, y: 176});
    assert.equal(attackFocus({...attacking, obstacleId: null}, world(buildings)).x, 320, 'its target, to the right');
});

test('no focus while walking, between Spitter shots, or just after a blow', () => {
    const buildings = [hq];
    const base = {x: 200, y: 176, targetId: 'hq-1', obstacleId: null};
    assert.equal(attackFocus({...base, attackTimer: MUTANT.attackCooldownTicks}, world(buildings)), null);
    assert.equal(attackFocus({...base, kind: BRUTE.kind, attackTimer: BRUTE.attackCooldownTicks}, world(buildings)), null);
    assert.notEqual(attackFocus({...base, kind: BRUTE.kind, attackTimer: BRUTE.attackCooldownTicks - 1}, world(buildings)), null);
    assert.equal(attackFocus({...base, kind: SPITTER.kind, shots: 3, aim: null, attackTimer: 10}, world(buildings)), null);
    assert.deepEqual(attackFocus({...base, kind: SPITTER.kind, shots: 3, aim: {x: 20, y: 5}, attackTimer: 10}, world(buildings)), {x: 20, y: 5});
});

/** Just enough of a Phaser scene to run MutantLayer: every setter chains, and setFlipX is remembered. */
function stubScene() {
    const object = () => {
        const target = {flipX: false, visible: true, x: 0, y: 0, scaleX: 1, rotation: 0};
        const proxy = new Proxy(target, {
            get(t, key) {
                if (key in t) return t[key];
                if (key === 'setFlipX') return (value) => ((t.flipX = value), proxy);
                if (key === 'setPosition') return (x, y) => ((t.x = x), (t.y = y), proxy);
                if (key === 'setVisible') return (value) => ((t.visible = value), proxy);
                return () => proxy;
            },
        });
        return proxy;
    };
    const add = new Proxy({}, {get: () => () => object()});
    return {add, textures: {exists: () => true}};
}

function views(layer) {
    return Object.fromEntries(layer.mutantViews().map((v) => [v.id, v]));
}

for (const kind of [undefined, SPITTER.kind, BRUTE.kind]) {
    const name = kind ?? 'runner';
    const extra = kind === SPITTER.kind ? {kind, shots: 0, aim: null} : kind ? {kind} : {};
    const cooldown = kind === BRUTE.kind ? BRUTE.attackCooldownTicks : MUTANT.attackCooldownTicks;
    const record = (id, x, more = {}) => ({id, x, y: 300, hp: 10, targetId: 'hq-1', obstacleId: null, attackTimer: cooldown, ...extra, ...more});

    test(`${name}: walks left and right, turns while chasing, holds when still, faces attacks on both sides`, () => {
        const layer = new MutantLayer(stubScene(), grid);
        const buildings = [hq]; // x 320..416
        const sync = (mutants, opts) => layer.sync(mutants, buildings, {tick: 1, isNight: true, ...opts});

        // Spawned on either side, each looks towards HQ.
        sync([record('a', 100), record('b', 600)]);
        assert.deepEqual([views(layer).a.facing, views(layer).a.flipX], [RIGHT, false]);
        assert.deepEqual([views(layer).b.facing, views(layer).b.flipX], [LEFT, true]);

        // Moving left, then turning to chase right.
        sync([record('a', 99), record('b', 599)]);
        assert.equal(views(layer).a.flipX, true, 'moving left mirrors the sheet');
        sync([record('a', 99.5), record('b', 599)]);
        assert.equal(views(layer).a.flipX, false, 'turning around');

        // Standing still keeps the last facing, even after a pause.
        sync([record('a', 99.5), record('b', 599)]);
        sync([record('a', 99.5), record('b', 599)]);
        assert.equal(views(layer).a.flipX, false);
        assert.equal(views(layer).b.flipX, true);

        // Attacking a soldier to its left, then one to its right, without moving.
        const attacking = {attackTimer: cooldown - 10};
        sync([record('a', 99.5, attacking)], {units: [{x: 92, y: 300}]});
        assert.equal(views(layer).a.flipX, true, 'faces the soldier on its left');
        sync([record('a', 99.5, attacking)], {units: [{x: 107, y: 300}]});
        assert.equal(views(layer).a.flipX, false, 'faces the soldier on its right');

        // A blow lands and the timer resets: still facing the same way.
        sync([record('a', 99.5)], {units: [{x: 107, y: 300}]});
        assert.equal(views(layer).a.flipX, false);
    });
}

test('a Spitter faces its aim during the telegraph, even one behind it', () => {
    const layer = new MutantLayer(stubScene(), grid);
    const spitter = (x, aim) => ({id: 's', kind: SPITTER.kind, x, y: 300, hp: 10, targetId: 'hq-1', obstacleId: null,
        shots: 5, aim, attackTimer: aim ? 20 : 100});
    layer.sync([spitter(100, null)], [hq], {tick: 1, isNight: true});
    assert.equal(views(layer).s.flipX, false);
    layer.sync([spitter(100, {x: 40, y: 300})], [hq], {tick: 2, isNight: true});
    assert.equal(views(layer).s.flipX, true, 'aims at a soldier on its left');
    layer.sync([spitter(100, null)], [hq], {tick: 3, isNight: true});
    assert.equal(views(layer).s.flipX, true, 'keeps facing it after the shot');
});
