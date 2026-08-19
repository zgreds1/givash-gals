import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byeTeams, round2 } from '../rules.js';
import { SCHEDULE } from './helpers.js';

test('no team is on bye in a week everyone plays', () => {
  assert.deepEqual([...byeTeams(SCHEDULE, 3)].sort(), []);
});

test('teams absent from a week are on bye', () => {
  assert.deepEqual([...byeTeams(SCHEDULE, 5)].sort(), ['KC', 'MIN']);
  assert.deepEqual([...byeTeams(SCHEDULE, 8)].sort(), ['CIN', 'HOU']);
});

test('every team is on bye in a week with no games', () => {
  assert.equal(byeTeams(SCHEDULE, 12).size, 4);
});

test('round2 rounds to two decimals', () => {
  assert.equal(round2(107.90000000001), 107.9);
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(-1), -1);
});
