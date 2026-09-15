import { test } from 'node:test';
import assert from 'node:assert/strict';
import { standings, round2 } from '../rules.js';
import { PENALTY } from '../config.js';

/** Hand-built WeekResults — standings() never touches raw Sleeper data. */
function week(n, teams, matchups) {
  return { week: n, played: true, median: 100, medianPool: [], teams, matchups };
}

const T = (adjusted, raw = adjusted) => ({ adjusted, raw, penalties: [] });

test('lower adjusted score earns the win, ties count half', () => {
  const rows = standings([
    week(1, { 1: T(90), 2: T(110), 3: T(95), 4: T(95), 5: T(80) }, [
      { type: 'h2h', rosterIds: [1, 2], winner: 1 },
      { type: 'h2h', rosterIds: [3, 4], winner: null },
      { type: 'median', rosterId: 5, line: 100, result: 'W' },
    ]),
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.rosterId, r]));
  assert.deepEqual([by[1].w, by[1].l, by[1].t], [1, 0, 0]);
  assert.deepEqual([by[2].w, by[2].l, by[2].t], [0, 1, 0]);
  assert.deepEqual([by[3].w, by[3].l, by[3].t], [0, 0, 1]);
  assert.equal(by[3].winPct, 0.5);
  assert.deepEqual([by[5].w, by[5].l, by[5].t], [1, 0, 0]);
});

test('a median win counts the same as a head-to-head win', () => {
  const rows = standings([
    week(1, { 1: T(90), 2: T(110), 3: T(95), 4: T(97), 5: T(80) }, [
      { type: 'h2h', rosterIds: [1, 2], winner: 1 },
      { type: 'h2h', rosterIds: [3, 4], winner: 3 },
      { type: 'median', rosterId: 5, line: 100, result: 'W' },
    ]),
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.rosterId, r]));
  assert.equal(by[5].winPct, 1);
  assert.deepEqual(by[5].median, { w: 1, l: 0, t: 0 });
  assert.deepEqual(by[1].median, { w: 0, l: 0, t: 0 });
});

test('points-for accumulates across weeks', () => {
  const rows = standings([
    week(1, { 1: T(90, 70), 2: T(110) }, [{ type: 'h2h', rosterIds: [1, 2], winner: 1 }]),
    week(2, { 1: T(60, 60), 2: T(120) }, [{ type: 'h2h', rosterIds: [1, 2], winner: 1 }]),
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.rosterId, r]));
  assert.equal(by[1].adjPF, 150);
  assert.equal(by[1].rawPF, 130);
  assert.equal(by[1].gp, 2);
});

test('equal records break on LOWER adjusted points-for', () => {
  const rows = standings([
    week(1, { 1: T(200), 2: T(300), 3: T(100), 4: T(400) }, [
      { type: 'h2h', rosterIds: [1, 2], winner: 1 },
      { type: 'h2h', rosterIds: [3, 4], winner: 3 },
    ]),
  ]);
  // 1 and 3 are both 1-0; roster 3 scored less, so it ranks first.
  assert.deepEqual(rows.map((r) => r.rosterId), [3, 1, 2, 4]);
});

test('head-to-head separates teams tied on record and points-for', () => {
  // A and B both finish 1-1 with 250 adjusted PF. They met in week 1 and A
  // won, so A must rank above B. This is the only path that reaches the
  // H2H comparator — record and points-for both fail to separate them.
  const rows = standings([
    week(1, { 1: T(100), 2: T(150), 3: T(200), 4: T(250) }, [
      { type: 'h2h', rosterIds: [1, 2], winner: 1 },
      { type: 'h2h', rosterIds: [3, 4], winner: 3 },
    ]),
    week(2, { 1: T(150), 2: T(100), 3: T(100), 4: T(150) }, [
      { type: 'h2h', rosterIds: [1, 3], winner: 3 },
      { type: 'h2h', rosterIds: [2, 4], winner: 2 },
    ]),
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.rosterId, r]));
  assert.equal(by[1].adjPF, 250);
  assert.equal(by[2].adjPF, 250);
  assert.equal(by[1].winPct, by[2].winPct);
  assert.ok(rows.indexOf(by[1]) < rows.indexOf(by[2]));
  assert.equal(by[1].unresolvedTie, false);
});

test('unplayed weeks are ignored entirely', () => {
  const w = week(1, { 1: T(90), 2: T(110) }, [{ type: 'h2h', rosterIds: [1, 2], winner: 1 }]);
  w.played = false;
  const rows = standings([w]);
  assert.equal(rows.length, 0);
});

test('teams tied on every criterion are flagged rather than ordered arbitrarily', () => {
  const rows = standings([
    // Rosters 1 and 3 are both 1-0 on 100 PF and never played each other.
    // Rosters 2 and 4 are given different PF so only one tie is flagged.
    week(1, { 1: T(100), 2: T(200), 3: T(100), 4: T(300) }, [
      { type: 'h2h', rosterIds: [1, 2], winner: 1 },
      { type: 'h2h', rosterIds: [3, 4], winner: 3 },
    ]),
  ]);
  const tied = rows.filter((r) => r.unresolvedTie).map((r) => r.rosterId);
  assert.deepEqual(tied.sort(), [1, 3]);
});

test('three-way tie with partial H2H data flags all unresolved pairs', () => {
  // Rosters 1, 2, 3 all finish 1-1 on 200 adjusted PF. Roster 1 never played
  // 2 or 3. Roster 2 beat roster 3. All three should be flagged because 1
  // cannot be separated from either 2 or 3.
  const rows = standings([
    week(1, { 1: T(100), 2: T(100), 3: T(100), 4: T(300) }, [
      { type: 'h2h', rosterIds: [1, 4], winner: 1 },
      { type: 'h2h', rosterIds: [2, 3], winner: 2 },
    ]),
    week(2, { 1: T(100), 2: T(100), 3: T(100), 4: T(300), 5: T(300) }, [
      { type: 'h2h', rosterIds: [1, 5], winner: 5 },
      { type: 'h2h', rosterIds: [2, 4], winner: 4 },
      { type: 'h2h', rosterIds: [3, 5], winner: 3 },
    ]),
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.rosterId, r]));
  assert.equal(by[1].winPct, by[2].winPct);
  assert.equal(by[1].winPct, by[3].winPct);
  assert.equal(by[1].adjPF, 200);
  assert.equal(by[2].adjPF, 200);
  assert.equal(by[3].adjPF, 200);
  // All three should be flagged: 1 cannot separate from 2 or 3, even though
  // 2 and 3 can separate from each other
  assert.equal(by[1].unresolvedTie, true);
  assert.equal(by[2].unresolvedTie, true);
  assert.equal(by[3].unresolvedTie, true);
});

test('a team H2H-separated from all tied peers is not flagged', () => {
  const rows = standings([
    week(1, { 1: T(100), 2: T(100), 3: T(100) }, [
      { type: 'h2h', rosterIds: [1, 2], winner: 1 },
      { type: 'median', rosterId: 3, line: 100, result: 'W' },
    ]),
    week(2, { 1: T(100), 2: T(100), 3: T(100) }, [
      { type: 'h2h', rosterIds: [1, 3], winner: 1 },
      { type: 'median', rosterId: 2, line: 100, result: 'W' },
    ]),
    week(3, { 1: T(100), 2: T(100), 3: T(100) }, [
      { type: 'median', rosterId: 1, line: 100, result: 'L' },
      { type: 'median', rosterId: 2, line: 100, result: 'W' },
      { type: 'median', rosterId: 3, line: 100, result: 'W' },
    ]),
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.rosterId, r]));
  // All three tie at 2-1 on 300 adjPF. Roster 1 beat both others head-to-head,
  // so its rank is not arbitrary and it must not carry a T- prefix.
  assert.equal(by[1].unresolvedTie, false);
  // Rosters 2 and 3 never met, so nothing separates them.
  assert.equal(by[2].unresolvedTie, true);
  assert.equal(by[3].unresolvedTie, true);
});

test('a degenerate week contributes nothing at all, not even points-for', () => {
  // The bug this guards: a degenerate week has no matchups but still has a
  // populated teams map, so points-for accrued while gp stayed 0 and a
  // phantom 0-0-0 row appeared beside real records.
  const bad = week(2, { 1: T(90), 2: T(110), 3: T(95) }, []);
  bad.degenerate = true;

  const rows = standings([
    week(1, { 1: T(100), 2: T(120) }, [{ type: 'h2h', rosterIds: [1, 2], winner: 1 }]),
    bad,
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.rosterId, r]));
  assert.equal(rows.length, 2);          // roster 3 never appears
  assert.equal(by[3], undefined);
  assert.equal(by[1].adjPF, 100);        // not 190
  assert.equal(by[1].gp, 1);
});

test('a played but degenerate week is skipped even when it is the only week', () => {
  const bad = week(1, { 1: T(90), 2: T(110) }, []);
  bad.degenerate = true;
  assert.deepEqual(standings([bad]), []);
});

test('win% is not rounded to two decimals', () => {
  const rows = standings([
    week(1, { 1: T(90), 2: T(110) }, [{ type: 'h2h', rosterIds: [1, 2], winner: 1 }]),
    week(2, { 1: T(90), 2: T(110) }, [{ type: 'h2h', rosterIds: [1, 2], winner: 1 }]),
    week(3, { 1: T(120), 2: T(100) }, [{ type: 'h2h', rosterIds: [1, 2], winner: 2 }]),
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.rosterId, r]));
  assert.deepEqual([by[1].w, by[1].l], [2, 1]);
  assert.equal(by[1].winPct.toFixed(3), '0.667'); // not 0.670
});

/*
 * The season +20 column.
 *
 * Counted per week off the same field the week's adjusted score was built
 * from, so the column and Adj PF can never tell different stories: across
 * every counted week, adjPF - rawPF is exactly PENALTY x this total.
 */
test('the +20 total accumulates across weeks', () => {
  const P = (adjusted, raw, settledPenalties) => ({
    adjusted, raw, settledPenalties, penalties: [],
  });
  const rows = standings([
    week(1, { 1: P(110, 90, 1), 2: P(120, 120, 0) },
      [{ type: 'h2h', rosterIds: [1, 2], winner: 1 }]),
    week(2, { 1: P(150, 90, 3), 2: P(130, 110, 1) },
      [{ type: 'h2h', rosterIds: [1, 2], winner: 2 }]),
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.rosterId, r]));
  assert.equal(by[1].settledPenalties, 4);
  assert.equal(by[2].settledPenalties, 1);
  // The identity that keeps the column honest against the two PF columns.
  for (const r of rows) {
    assert.equal(round2(r.adjPF - r.rawPF), r.settledPenalties * PENALTY);
  }
});

test('a week nobody played contributes no +20s', () => {
  const rows = standings([
    { ...week(1, { 1: { adjusted: 0, raw: 0, settledPenalties: 9, penalties: [] } }, []), played: false },
  ]);
  assert.equal(rows.length, 0);
});

test('a degenerate week contributes no +20s, as it contributes no points', () => {
  const rows = standings([
    week(1, { 1: { adjusted: 110, raw: 90, settledPenalties: 1, penalties: [] },
      2: { adjusted: 120, raw: 120, settledPenalties: 0, penalties: [] } },
    [{ type: 'h2h', rosterIds: [1, 2], winner: 1 }]),
    { ...week(2, { 1: { adjusted: 200, raw: 100, settledPenalties: 5, penalties: [] } }, []), degenerate: true },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.rosterId, r]));
  assert.equal(by[1].settledPenalties, 1, 'the degenerate week is skipped whole');
});

test('an archived week with no +20 count reads as zero rather than NaN', () => {
  const rows = standings([
    week(1, { 1: { adjusted: 110, raw: 90 }, 2: { adjusted: 120, raw: 120 } },
      [{ type: 'h2h', rosterIds: [1, 2], winner: 1 }]),
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.rosterId, r]));
  assert.equal(by[1].settledPenalties, 0);
});

/*
 * weeks.json is a committed artifact. A week written before the engine
 * published a count still carries the penalties it was built from, phases and
 * all, so the count is recoverable and must be recovered - reading 0 off a
 * week that plainly charged five +20s is worse than reading nothing.
 */
test('a week from before the count existed is counted off its penalties', () => {
  const archived = (adjusted, raw, phases) => ({
    adjusted, raw, penalties: phases.map((phase, i) => ({ playerId: String(i), phase })),
  });
  const rows = standings([
    week(1, {
      1: archived(130, 90, ['final', 'final', 'live']),
      2: archived(120, 120, []),
    }, [{ type: 'h2h', rosterIds: [1, 2], winner: 2 }]),
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.rosterId, r]));
  assert.equal(by[1].settledPenalties, 2, 'the live one has not been charged');
  assert.equal(by[2].settledPenalties, 0);
});

test('a published count wins over a recount, and they agree anyway', () => {
  const rows = standings([
    week(1, {
      1: { adjusted: 130, raw: 90, settledPenalties: 2,
        penalties: [{ playerId: '1', phase: 'final' }, { playerId: '2', phase: 'final' }] },
      2: { adjusted: 120, raw: 120, settledPenalties: 0, penalties: [] },
    }, [{ type: 'h2h', rosterIds: [1, 2], winner: 2 }]),
  ]);
  assert.equal(rows.find((r) => r.rosterId === 1).settledPenalties, 2);
});
