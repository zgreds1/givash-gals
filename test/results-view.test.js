import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayWeek } from '../results-view.js';

// Sleeper reports season_start_date 2026-09-09, which is a Wednesday. Every
// boundary below is therefore a Tue -> Wed rollover, which is the rule the
// league wants. Dates are constructed locally, not parsed from ISO strings,
// because new Date('2026-09-09') is UTC midnight and would shift the answer
// for anyone west of Greenwich.
const START = '2026-09-09';
const local = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0);

test('the displayed week rolls over on Wednesday', () => {
  assert.equal(displayWeek(local(2026, 9, 8), START), 1, 'Tue before kickoff');
  assert.equal(displayWeek(local(2026, 9, 9), START), 1, 'Wed, week 1 opens');
  assert.equal(displayWeek(local(2026, 9, 15), START), 1, 'Tue, still week 1');
  assert.equal(displayWeek(local(2026, 9, 16), START), 2, 'Wed, week 2 opens');
  assert.equal(displayWeek(local(2026, 11, 4), START), 9);
  assert.equal(displayWeek(local(2027, 1, 5), START), 17, 'Tue, still week 17');
  assert.equal(displayWeek(local(2027, 1, 6), START), 18, 'Wed, week 18 opens');
});

test('the week clamps at both ends of the season', () => {
  assert.equal(displayWeek(local(2026, 7, 1), START), 1, 'July: no season yet');
  assert.equal(displayWeek(local(2027, 2, 1), START), 18, 'February: season over');
});

test('a missing or malformed season start falls back to week 1', () => {
  // standings.json predates this field, so an older snapshot has no start
  // date. Week 1 is the honest default; NaN would render an empty picker.
  assert.equal(displayWeek(local(2026, 11, 4), undefined), 1);
  assert.equal(displayWeek(local(2026, 11, 4), 'not-a-date'), 1);
});

test('the rollover survives a daylight-saving shift', () => {
  // US DST ends 2026-11-01. Nov 4 is 56 days after Sep 9, but 56 * 86400000
  // ms apart it is not — the extra hour makes the raw division 55.96 days,
  // which floors to week 8 instead of 9 unless the day count is rounded.
  assert.equal(displayWeek(local(2026, 11, 4), START), 9);
  assert.equal(displayWeek(local(2026, 11, 3), START), 8);
});
