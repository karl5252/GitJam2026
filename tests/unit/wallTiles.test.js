import test from 'node:test';
import assert from 'node:assert/strict';
import {wallAppearance, WALL_FRAME} from '../../src/scenes/WallTiles.js';

function look(neighbors, hp = 100) {
    return wallAppearance({col: 10, row: 10, hp}, new Set(neighbors.map(([x, y]) => `${10 + x},${10 + y}`)));
}

test('isolated, straight and four corners have exact Aseprite frame indices', () => {
    assert.deepEqual(look([]), {frame: WALL_FRAME.horizontal, angle: 0});
    assert.deepEqual(look([[1, 0], [-1, 0]]), {frame: WALL_FRAME.horizontal, angle: 0});
    assert.deepEqual(look([[0, 1], [0, -1]]), {frame: WALL_FRAME.vertical, angle: 0});
    assert.equal(look([[0, -1], [1, 0]]).frame, WALL_FRAME.lowerLeft);
    assert.equal(look([[1, 0], [0, 1]]).frame, WALL_FRAME.upperLeft);
    assert.equal(look([[0, 1], [-1, 0]]).frame, WALL_FRAME.upperRight);
    assert.equal(look([[-1, 0], [0, -1]]).frame, WALL_FRAME.lowerRight);
});

test('T junctions, side-rotated junctions and cross depend on adjacent walls only', () => {
    assert.deepEqual(look([[-1, 0], [1, 0], [0, -1]]), {frame: WALL_FRAME.reverseT, angle: 0});
    assert.deepEqual(look([[-1, 0], [1, 0], [0, 1]]), {frame: WALL_FRAME.tee, angle: 0});
    assert.deepEqual(look([[0, -1], [0, 1], [1, 0]]), {frame: WALL_FRAME.reverseT, angle: 90});
    assert.deepEqual(look([[0, -1], [0, 1], [-1, 0]]), {frame: WALL_FRAME.reverseT, angle: -90});
    assert.equal(look([[0, -1], [0, 1], [-1, 0], [1, 0]]).frame, WALL_FRAME.cross);
});

test('damage overrides connectivity without changing world occupancy', () => {
    assert.equal(look([[0, -1], [1, 0]], 67).frame, WALL_FRAME.lowerLeft);
    assert.equal(look([[0, -1], [1, 0]], 66).frame, WALL_FRAME.damaged);
    assert.equal(look([[0, -1], [1, 0]], 33).frame, WALL_FRAME.rubble);
    assert.equal(look([[0, -1], [1, 0]], 0).frame, WALL_FRAME.rubble);
});
