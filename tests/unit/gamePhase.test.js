import test from 'node:test';
import assert from 'node:assert/strict';
import {GamePhase, startGame} from '../../src/core/gamePhase.js';

test('phase values are stable and frozen', () => {
    assert.deepEqual({...GamePhase}, {READY: 'ready', STARTED: 'started', DEFEATED: 'defeated'});
    assert.ok(Object.isFrozen(GamePhase));
});

test('startGame moves READY to STARTED', () => {
    assert.equal(startGame(GamePhase.READY), GamePhase.STARTED);
});

test('startGame is idempotent once started', () => {
    assert.equal(startGame(GamePhase.STARTED), GamePhase.STARTED);
});
