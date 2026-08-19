import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWeek, byeTeams } from '../rules.js';
import { mkEntry, PLAYERS, SCHEDULE } from './helpers.js';

const WK3 = byeTeams(SCHEDULE, 3);
const EXCLUDED = new Set([6]);
const GHOST = 6;

/** One WR starter carrying the whole score — no penalties in play. */
const solo = (rosterId, matchupId, pts) =>
  mkEntry(rosterId, matchupId, [['4199', pts]]);

/** Spec 4.4: non-bye scores 142.6 / 118.3 / 97.5 / 88.1 -> line 107.9 */
function specWeek() {
  return [
    solo(1, 1, 142.6),
    solo(2, 1, 88.1),
    solo(3, 2, 118.3),
    solo(4, 2, 97.5),
    solo(5, 3, 101.2),           // median team
    mkEntry(6, 3, [['4199', 0]]), // ghost roster
  ];
}

test('median line is the average of the 2nd and 3rd highest non-bye scores', () => {
  const r = resolveWeek(3, specWeek(), EXCLUDED, WK3, PLAYERS);
  assert.deepEqual(r.medianPool, [142.6, 118.3, 97.5, 88.1]);
  assert.equal(r.median, 107.9);
});

test('median team wins when below the line', () => {
  const r = resolveWeek(3, specWeek(), EXCLUDED, WK3, PLAYERS);
  const m = r.matchups.find((x) => x.type === 'median');
  assert.equal(m.rosterId, 5);
  assert.equal(m.result, 'W');
});

test('median team loses when above the line and ties when equal', () => {
  const above = specWeek();
  above[4] = solo(5, 3, 120.0);
  assert.equal(
    resolveWeek(3, above, EXCLUDED, WK3, PLAYERS).matchups.find((x) => x.type === 'median').result,
    'L',
  );

  const equal = specWeek();
  equal[4] = solo(5, 3, 107.9);
  assert.equal(
    resolveWeek(3, equal, EXCLUDED, WK3, PLAYERS).matchups.find((x) => x.type === 'median').result,
    'T',
  );
});

test('the lower adjusted score wins a head-to-head', () => {
  const r = resolveWeek(3, specWeek(), EXCLUDED, WK3, PLAYERS);
  const h2h = r.matchups.filter((x) => x.type === 'h2h');
  assert.equal(h2h.length, 2);
  assert.equal(h2h.find((m) => m.rosterIds.includes(1)).winner, 2);
  assert.equal(h2h.find((m) => m.rosterIds.includes(3)).winner, 4);
});

test('penalties decide a head-to-head, not raw points', () => {
  const ms = [
    // roster 1: raw 100, one zeroed starter -> adjusted 120
    mkEntry(1, 1, [['4199', 100], ['8205', 0]]),
    // roster 2: raw 110, clean -> adjusted 110 -> wins despite higher raw
    mkEntry(2, 1, [['4199', 110]]),
    solo(3, 2, 118.3),
    solo(4, 2, 97.5),
    solo(5, 3, 101.2),
    mkEntry(6, 3, [['4199', 0]]),
  ];
  const r = resolveWeek(3, ms, EXCLUDED, WK3, PLAYERS);
  const m = r.matchups.find((x) => x.type === 'h2h' && x.rosterIds.includes(1));
  assert.equal(r.teams[1].adjusted, 120);
  assert.equal(r.teams[2].adjusted, 110);
  assert.equal(m.winner, 2);
});

test('an exact adjusted tie has no winner', () => {
  const ms = specWeek();
  ms[1] = solo(2, 1, 142.6);
  const r = resolveWeek(3, ms, EXCLUDED, WK3, PLAYERS);
  assert.equal(r.matchups.find((x) => x.type === 'h2h' && x.rosterIds.includes(1)).winner, null);
});

test('the ghost roster is excluded from the median pool and from teams', () => {
  const r = resolveWeek(3, specWeek(), EXCLUDED, WK3, PLAYERS);
  assert.equal(r.medianPool.length, 4);
  assert.ok(!r.medianPool.includes(20)); // ghost's penalised score never appears
  assert.equal(r.teams[GHOST], undefined);
});

test('a real roster with a null matchup_id is the median team', () => {
  const ms = [
    solo(1, 1, 142.6),
    solo(2, 1, 88.1),
    solo(3, 2, 118.3),
    solo(4, 2, 97.5),
    solo(5, null, 101.2), // Sleeper omitted the ghost entirely
  ];
  const r = resolveWeek(3, ms, EXCLUDED, WK3, PLAYERS);
  const m = r.matchups.find((x) => x.type === 'median');
  assert.equal(m.rosterId, 5);
  assert.equal(r.median, 107.9);
});

test('a week with no scores is marked unplayed', () => {
  const ms = [1, 2, 3, 4, 5, 6].map((i) => mkEntry(i, Math.ceil(i / 2), [['4199', 0]]));
  const r = resolveWeek(3, ms, EXCLUDED, WK3, PLAYERS);
  assert.equal(r.played, false);
});

test('a week with any score is marked played', () => {
  assert.equal(resolveWeek(3, specWeek(), EXCLUDED, WK3, PLAYERS).played, true);
});

// --- degenerate payloads -----------------------------------------------
//
// Sleeper groups matchup_ids by its own 6-team, highest-wins bracket from
// week 15 on, and before the league fills there are not enough owned
// rosters to make two pairs. Neither shape can be scored under this
// format, and inventing a partial result is worse than showing nothing.

test('a normal week is not degenerate', () => {
  assert.equal(resolveWeek(3, specWeek(), EXCLUDED, WK3, PLAYERS).degenerate, false);
});

test('two groups each holding one real roster are degenerate, not two median teams', () => {
  // Rosters 5 and 6 are both unowned, so groups 2 and 3 each reduce to a
  // single real team. The old code kept only the second and silently
  // dropped the first from matchups while still counting its points.
  const ms = [
    solo(1, 1, 142.6),
    solo(2, 1, 88.1),
    solo(3, 2, 118.3),
    solo(5, 2, 97.5),
    solo(4, 3, 101.2),
    solo(6, 3, 90.0),
  ];
  const r = resolveWeek(3, ms, new Set([5, 6]), WK3, PLAYERS);
  assert.equal(r.degenerate, true);
  assert.deepEqual(r.matchups, []);
});

test('a group containing only the ghost is degenerate when it leaves too few pairs', () => {
  const ms = [
    solo(1, 1, 142.6),
    solo(2, 1, 88.1),
    mkEntry(6, 2, [['4199', 0]]), // group 2 is the ghost, alone
    solo(3, 3, 118.3),
  ];
  const r = resolveWeek(3, ms, EXCLUDED, WK3, PLAYERS);
  assert.equal(r.degenerate, true);
  assert.deepEqual(r.matchups, []);
});

test('fewer than two head-to-head pairs is degenerate', () => {
  const ms = [solo(1, 1, 142.6), solo(2, 1, 88.1), solo(3, 2, 118.3)];
  const r = resolveWeek(3, ms, EXCLUDED, WK3, PLAYERS);
  assert.equal(r.degenerate, true);
  assert.deepEqual(r.matchups, []);
  assert.equal(r.median, null);
});

test('more than two real rosters in one group is degenerate', () => {
  const ms = [
    solo(1, 1, 142.6),
    solo(2, 1, 88.1),
    solo(3, 2, 118.3),
    solo(4, 2, 97.5),
    solo(5, 3, 101.2),
    solo(7, 3, 90.0),
    solo(8, 3, 80.0),
  ];
  const r = resolveWeek(3, ms, EXCLUDED, WK3, PLAYERS);
  assert.equal(r.degenerate, true);
  assert.deepEqual(r.matchups, []);
});

test('no median matchup is emitted when the line could not be computed', () => {
  // One pair plus a leftover: there is a median team but only two scores
  // in the pool, so there is no line and therefore no matchup to award.
  const ms = [solo(1, 1, 142.6), solo(2, 1, 88.1), solo(5, null, 101.2)];
  const r = resolveWeek(3, ms, EXCLUDED, WK3, PLAYERS);
  assert.equal(r.median, null);
  assert.equal(r.matchups.filter((m) => m.type === 'median').length, 0);
});

test('every unowned roster is excluded, not just the lowest-numbered one', () => {
  // The live 2026-08-19 state: 3 managers joined, 3 slots empty. Excluding
  // only roster 4 produced a median line of 60 over a population that
  // included two ownerless teams.
  const ms = [
    solo(1, 1, 100), solo(4, 1, 20),
    solo(2, 2, 90), solo(5, 2, 30),
    solo(3, 3, 80), solo(6, 3, 40),
  ];
  const r = resolveWeek(3, ms, new Set([4, 5, 6]), WK3, PLAYERS);
  assert.equal(r.degenerate, true);
  assert.deepEqual(r.matchups, []);
  assert.deepEqual(Object.keys(r.teams).sort(), ['1', '2', '3']);
  assert.deepEqual(r.medianPool, []);
  assert.notEqual(r.median, 60);
});

test('the five-owned shape resolves exactly as it did before the Set signature', () => {
  const r = resolveWeek(3, specWeek(), EXCLUDED, WK3, PLAYERS);
  assert.equal(r.degenerate, false);
  assert.equal(r.median, 107.9);
  assert.deepEqual(r.medianPool, [142.6, 118.3, 97.5, 88.1]);
  assert.deepEqual(Object.keys(r.teams).sort(), ['1', '2', '3', '4', '5']);
  assert.deepEqual(r.matchups, [
    { type: 'h2h', rosterIds: [1, 2], winner: 2 },
    { type: 'h2h', rosterIds: [3, 4], winner: 4 },
    { type: 'median', rosterId: 5, line: 107.9, result: 'W' },
  ]);
});
