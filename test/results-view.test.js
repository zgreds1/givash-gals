import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayWeek, pairsFromPayload, medianRosterId } from '../results-view.js';

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

// Real week 1, probed from Sleeper on 2026-09-01. Every future week carries
// matchup_id with points 0, which is what makes an upcoming schedule
// possible at all.
const WEEK1 = [
  { roster_id: 1, matchup_id: 1, points: 0 },
  { roster_id: 2, matchup_id: 2, points: 0 },
  { roster_id: 3, matchup_id: 1, points: 0 },
  { roster_id: 4, matchup_id: 2, points: 0 },
  { roster_id: 5, matchup_id: 3, points: 0 },
  { roster_id: 6, matchup_id: 3, points: 0 },
];

test('pairs come out sorted, so an unchanged schedule is a byte-identical file', () => {
  assert.deepEqual(pairsFromPayload(WEEK1), [[1, 3], [2, 4], [5, 6]]);

  // Same week, entries shuffled and each pair reversed. The Action commits
  // whenever data/ differs, so an unsorted result would commit noise on
  // every run.
  const shuffled = [WEEK1[4], WEEK1[3], WEEK1[0], WEEK1[5], WEEK1[1], WEEK1[2]];
  assert.deepEqual(pairsFromPayload(shuffled), [[1, 3], [2, 4], [5, 6]]);
});

test('entries with no matchup_id are skipped, not paired', () => {
  const partial = [...WEEK1.slice(0, 4), { roster_id: 5, matchup_id: null, points: 0 }];
  assert.deepEqual(pairsFromPayload(partial), [[1, 3], [2, 4]]);
});

test('pairsFromPayload survives an empty or missing payload', () => {
  assert.deepEqual(pairsFromPayload([]), []);
  assert.deepEqual(pairsFromPayload(undefined), []);
});

test('the team paired with the ghost roster draws the median', () => {
  // Probed weeks, spec 2.1. Roster 6 is unowned.
  assert.equal(medianRosterId([[1, 3], [2, 4], [5, 6]], 6), 5, 'week 1');
  assert.equal(medianRosterId([[1, 2], [3, 6], [4, 5]], 6), 3, 'week 2');
  assert.equal(medianRosterId([[1, 4], [3, 5], [2, 6]], 6), 2, 'week 5');
  assert.equal(medianRosterId([[1, 6], [2, 5], [3, 4]], 6), 1, 'week 18');
});

test('there is no median team when every roster slot is owned', () => {
  // The standings page already warns about this shape: six owned rosters is
  // three straight head-to-head games and no median at all.
  assert.equal(medianRosterId([[1, 2], [3, 4], [5, 6]], null), null);
});
