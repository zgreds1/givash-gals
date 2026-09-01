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

test('the day count is rounded, so a lost hour cannot shift the week', () => {
  // A spring-forward transition makes a day 23 hours long, so the raw
  // difference falls an hour short of a whole number of days and floors to
  // the previous week. 2027-03-03 -> 2027-04-28 is exactly 56 days apart by
  // the calendar, but 55.9583 by arithmetic across the 2027-03-14 shift:
  // week 8 without rounding, week 9 with it.
  //
  // Out of season deliberately — the only transition inside a Sep-Jan season
  // is the November fall-back, which overshoots instead and cannot fail. This
  // discriminates only where DST is observed; CI runs UTC, where it passes
  // either way. It is a regression guard for Math.round, not a coverage claim.
  assert.equal(displayWeek(local(2027, 4, 28), '2027-03-03'), 9);
});
