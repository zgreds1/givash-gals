import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leagueWarning, showTables } from '../app.js';

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

// paint() suppression predicate. Below 5 owned rosters there is no honest
// table to draw, so the banner is shown alone.
test('tables are suppressed while the league is short of five managers', () => {
  assert.equal(showTables(1), false);
  assert.equal(showTables(3), false);
  assert.equal(showTables(4), false);
});

test('tables render for the normal shape and for a fully owned league', () => {
  assert.equal(showTables(5), true);
  assert.equal(showTables(6), true);
});

test('tables are not suppressed when nothing loaded — that path owns its own error', () => {
  assert.equal(showTables(0), true);
});
