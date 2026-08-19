import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leagueWarning } from '../app.js';

test('no warning when the league is the expected shape', () => {
  assert.equal(leagueWarning(5, 6), null);
});

test('warns when every roster slot is owned', () => {
  assert.match(leagueWarning(6, null), /no median matchup/i);
});

test('warns when the league is not yet full', () => {
  assert.match(leagueWarning(3, 6), /3 of 5/);
});

test('no warning when no league data has loaded (empty teams, no ghost)', () => {
  assert.equal(leagueWarning(0, null), null);
});

test('no warning when no league data has loaded (empty teams, ghost set)', () => {
  assert.equal(leagueWarning(0, 4), null);
});
