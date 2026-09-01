import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { displayWeek, pairsFromPayload, medianRosterId, lineupRows, slotFits, renderWeek } from '../results-view.js';

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

const POSITIONS = [
  'QB', 'QB', 'QB', 'RB', 'RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'WR',
  'TE', 'TE', 'FLEX', 'FLEX', 'FLEX', 'FLEX', 'K', 'DEF',
  'BN', 'BN', 'BN', 'BN', 'BN',
];

const PLAYERS = {
  a: { name: 'Ann QB', pos: 'QB', team: 'CIN' },
  b: { name: 'Bo RB', pos: 'RB', team: 'ATL' },
  c: { name: 'Cy WR', pos: 'WR', team: 'MIN' },
};

test('slots come from roster_positions, in order, and BN is not a slot', () => {
  const entry = { starters: ['a', 'b'], starters_points: [17.4, 24.9], players: ['a', 'b', 'c'],
                  players_points: { a: 17.4, b: 24.9, c: 8.1 } };
  const { starters, bench } = lineupRows(entry, POSITIONS, PLAYERS);

  assert.equal(starters.length, 2);
  assert.deepEqual(starters.map((r) => r.slot), ['QB', 'RB']);
  assert.deepEqual(starters.map((r) => r.points), [17.4, 24.9]);

  assert.equal(bench.length, 1);
  assert.equal(bench[0].name, 'Cy WR');
  assert.equal(bench[0].points, 8.1);
});

test('a player who cannot fill his slot is labelled by his own position', () => {
  // spec 6.1: starters[i] filling the i-th non-BN roster_positions entry was
  // verified against the real archived week-1 payload on 2026-09-01 (114
  // starters across 6 rosters, 0 mismatches). The cross-check below stays in
  // place anyway, as protection if Sleeper ever changes that ordering: a WR
  // sitting in a QB row would otherwise be shown as a QB on no evidence.
  const entry = { starters: ['c'], starters_points: [8.1], players: ['c'], players_points: { c: 8.1 } };
  const { starters } = lineupRows(entry, POSITIONS, PLAYERS);
  assert.equal(starters[0].slot, 'WR', 'a WR in the first QB slot is labelled WR');
});

test('FLEX accepts RB, WR and TE and nothing else', () => {
  assert.equal(slotFits('FLEX', 'RB'), true);
  assert.equal(slotFits('FLEX', 'WR'), true);
  assert.equal(slotFits('FLEX', 'TE'), true);
  assert.equal(slotFits('FLEX', 'QB'), false);
  assert.equal(slotFits('QB', 'QB'), true);
  assert.equal(slotFits('QB', 'RB'), false);
});

test('an unknown position never contradicts the slot', () => {
  // Half of "unknown" is not evidence of a mismatch.
  assert.equal(slotFits('QB', ''), true);
  assert.equal(slotFits('', 'QB'), true);
});

test('an empty starting slot is marked, not named "0"', () => {
  // Sleeper writes '0' into an unfilled slot, and an empty slot is exactly
  // what earns the +20 — it must be legible, not rendered as a player id.
  const entry = { starters: ['0'], starters_points: [0], players: [], players_points: {} };
  const { starters } = lineupRows(entry, POSITIONS, PLAYERS);
  assert.equal(starters[0].empty, true);
  assert.equal(starters[0].slot, 'QB', 'the slot is still known even when unfilled');
  assert.notEqual(starters[0].name, '0');
});

test('an id missing from the player map renders as the id, not as blank', () => {
  const entry = { starters: ['zz'], starters_points: [3], players: ['zz'], players_points: { zz: 3 } };
  const { starters } = lineupRows(entry, POSITIONS, PLAYERS);
  assert.equal(starters[0].name, 'zz');
});

test('the real 19/5 league shape round-trips', () => {
  const payload = JSON.parse(readFileSync('test/fixtures/league-week.json', 'utf8'));
  const { starters, bench } = lineupRows(payload[0], POSITIONS, {});
  assert.equal(starters.length, 19, '19 starters, per roster_positions');
  assert.equal(bench.length, 5, '5 bench');
  assert.equal(starters.at(-1).slot, 'DEF');
  assert.equal(starters.at(-2).slot, 'K');
});

const TEAMS = { 1: 'Alpha', 2: 'Bravo', 3: 'Delta', 4: 'Echo', 5: 'Foxtrot' };

const PLAYED = {
  week: 3, played: true, median: 107.9, medianPool: [142.6, 118.3, 97.5, 88.1],
  teams: {
    1: { raw: 122.6, adjusted: 142.6, penalties: [{ playerId: '8205', name: 'Bijan Robinson', reason: 'zeroed' }] },
    2: { raw: 88.1, adjusted: 88.1, penalties: [] },
    5: { raw: 101.2, adjusted: 101.2, penalties: [] },
  },
  matchups: [
    { type: 'h2h', rosterIds: [1, 2], winner: 2 },
    { type: 'median', rosterId: 5, line: 107.9, result: 'W' },
  ],
};

test('a played week shows both scores, the penalty and the winner', () => {
  const html = renderWeek({ week: 3, resolved: PLAYED, teams: TEAMS, detailAvailable: true });
  assert.match(html, /Bijan Robinson/);
  assert.match(html, /\+20/);
  assert.match(html, /122\.60/);
  assert.match(html, /142\.60/);
  assert.match(html, /class="[^"]*winner/);
});

test('the median card shows the line and the pool it came from', () => {
  const html = renderWeek({ week: 3, resolved: PLAYED, teams: TEAMS, detailAvailable: true });
  assert.match(html, /107\.90/);
  assert.match(html, /118\.30/);
  assert.match(html, /97\.50/);
});

test('an upcoming week shows the real pairings and who draws the median', () => {
  // No resolved week exists before kickoff; the pairings file is the source.
  const html = renderWeek({
    week: 1, resolved: undefined, pairs: [[1, 3], [2, 4], [5, 6]],
    ghostRosterId: 6, teams: TEAMS,
  });
  assert.match(html, /Alpha/);
  assert.match(html, /Delta/);
  assert.match(html, /League median/);
  assert.match(html, /Foxtrot/, 'roster 5 is paired with the ghost');
  assert.doesNotMatch(html, /winner/, 'nothing has been won yet');
  assert.doesNotMatch(html, /Roster 6/, 'the ghost roster is never named as an opponent');
});

test('a week with neither results nor pairings says so', () => {
  const html = renderWeek({ week: 7, resolved: undefined, pairs: [], teams: TEAMS });
  assert.match(html, /not published/i);
});

test('a degenerate week explains itself instead of rendering an empty shell', () => {
  const html = renderWeek({
    week: 3, resolved: { ...PLAYED, degenerate: true, matchups: [] }, teams: TEAMS,
  });
  assert.match(html, /do not fit the league format/i);
});

test('matchups are not clickable when the week has no archived payload', () => {
  const on = renderWeek({ week: 3, resolved: PLAYED, teams: TEAMS, detailAvailable: true });
  const off = renderWeek({ week: 3, resolved: PLAYED, teams: TEAMS, detailAvailable: false });
  assert.match(on, /data-matchup="0"/);
  assert.doesNotMatch(off, /data-matchup=/);
  assert.match(off, /no player detail/i, 'and it says why rather than going quiet');
});

test('a played week escapes a hostile team name and a hostile penalty player name', () => {
  // Regression guard for the esc() calls inside teamBlock/penaltyList, which
  // moved into this file in task 7. Reproduces the deleted
  // render.test.js coverage for the same call sites.
  const hostileTeams = { ...TEAMS, 1: '<script>alert(1)</script>' };
  const hostileWeek = {
    ...PLAYED,
    teams: {
      ...PLAYED.teams,
      1: {
        ...PLAYED.teams[1],
        penalties: [{ ...PLAYED.teams[1].penalties[0], name: '<img src=x onerror=alert(1)>' }],
      },
    },
  };

  const html = renderWeek({ week: 3, resolved: hostileWeek, teams: hostileTeams, detailAvailable: true });

  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img /);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img /);
});

test('an upcoming week escapes a hostile team name in a fixture', () => {
  // Regression guard for esc(name(a)) in the upcoming-fixtures branch,
  // which is new in task 7 and had no prior coverage of any kind.
  const hostileTeams = { ...TEAMS, 1: '<script>alert(1)</script>' };
  const html = renderWeek({
    week: 1, resolved: undefined, pairs: [[1, 3], [2, 4], [5, 6]],
    ghostRosterId: 6, teams: hostileTeams,
  });

  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('a week marked not-played renders the upcoming fixtures even when it carries stale scores', () => {
  // Matches the live shape of data/weeks.json for week 1: played: false but
  // with populated teams (adjusted: 360 for every side, since all 18
  // non-DEF starters have scored 0). If the played?.true guard ever
  // regressed to a truthiness check on `resolved`, this would render five
  // identical 360s as though they were real results.
  const html = renderWeek({
    week: 1,
    resolved: {
      week: 1, played: false, matchups: [],
      teams: {
        1: { raw: 360, adjusted: 360, penalties: [] },
        2: { raw: 360, adjusted: 360, penalties: [] },
        3: { raw: 360, adjusted: 360, penalties: [] },
        4: { raw: 360, adjusted: 360, penalties: [] },
        5: { raw: 360, adjusted: 360, penalties: [] },
      },
    },
    pairs: [[1, 3], [2, 4], [5, 6]],
    ghostRosterId: 6,
    teams: TEAMS,
  });

  assert.match(html, /Alpha/);
  assert.match(html, /League median/);
  assert.doesNotMatch(html, /360/);
});
