import { test } from 'node:test';
import assert from 'node:assert/strict';
import { standings } from '../rules.js';

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
