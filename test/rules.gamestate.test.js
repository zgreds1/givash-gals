import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameStates, allGamesFinal } from '../rules.js';
import { SCHEDULE_LIVE } from './helpers.js';

test('complete and canceled are both final', () => {
  const s = gameStates([
    { week: 1, home: 'HOU', away: 'CIN', status: 'complete' },
    { week: 1, home: 'DAL', away: 'SEA', status: 'canceled' },
  ], 1);
  assert.equal(s.get('HOU'), 'final');
  assert.equal(s.get('CIN'), 'final');
  assert.equal(s.get('DAL'), 'final', 'a canceled game is never happening: settled');
  assert.equal(s.get('SEA'), 'final');
});

test('pre_game is upcoming, in_game is live', () => {
  const s = gameStates(SCHEDULE_LIVE, 3);
  assert.equal(s.get('HOU'), 'final');
  assert.equal(s.get('KC'), 'live');
  assert.equal(gameStates(SCHEDULE_LIVE, 5).get('HOU'), 'upcoming');
});

test('an unrecognised status falls to live, never final', () => {
  // The only unrecoverable error is inventing 20 points from a string we
  // did not recognise. Withholding a penalty is recoverable.
  const s = gameStates(SCHEDULE_LIVE, 8);
  assert.equal(s.get('KC'), 'live');
  assert.equal(s.get('MIN'), 'live');
});

test('a team on bye gets no entry at all', () => {
  const s = gameStates(SCHEDULE_LIVE, 5);
  assert.equal(s.has('KC'), false, 'KC sits out week 5');
  assert.equal(s.has('MIN'), false);
});

test('other weeks are ignored', () => {
  assert.equal(gameStates(SCHEDULE_LIVE, 3).size, 4);
});

test('allGamesFinal is true only when nothing can still move', () => {
  assert.equal(allGamesFinal(gameStates(SCHEDULE_LIVE, 3)), false, 'KC/MIN still on');
  assert.equal(allGamesFinal(gameStates(SCHEDULE_LIVE, 5)), false, 'not kicked off');
  assert.equal(allGamesFinal(gameStates([
    { week: 1, home: 'HOU', away: 'CIN', status: 'complete' },
    { week: 1, home: 'DAL', away: 'SEA', status: 'canceled' },
  ], 1)), true, 'complete + canceled is finished');
});

test('allGamesFinal is false on an empty or missing map', () => {
  // Not "everything finished" — it is "we have no schedule", and the caller
  // must fall back to the calendar gate rather than declare the week over.
  assert.equal(allGamesFinal(new Map()), false);
  assert.equal(allGamesFinal(null), false);
});
