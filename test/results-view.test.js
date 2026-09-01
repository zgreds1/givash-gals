import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { displayWeek, pairsFromPayload, medianRosterId, lineupRows, slotFits, renderWeek, renderMatchupDetail, weekOptions, mountResults } from '../results-view.js';

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
  // A /winner/ assertion used to sit here. The upcoming branch has no code
  // path that can emit that string, so it could not fail; the played-week
  // guard below ("renders the upcoming fixtures even when it carries stale
  // scores") is what actually holds this branch to fixtures only.
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

const DETAIL_PLAYERS = {
  a: { name: 'Ann QB', pos: 'QB', team: 'CIN' },
  // Keyed '8205', not 'b': PLAYED's roster-1 penalty (defined by task 7,
  // shared and not redeclared here) names playerId '8205' as the player it
  // zeroed. Real penalties always carry the zeroed starter's own id
  // (rules.js adjustedScore), so the fixture's zeroed player must share
  // that id for the per-row +20 match to be testable at all.
  8205: { name: 'Bo RB', pos: 'RB', team: 'ATL' },
  z: { name: 'Zed WR', pos: 'WR', team: 'MIN' },
};
const DETAIL_POSITIONS = ['QB', 'RB', 'BN'];
const DETAIL_PAYLOAD = [
  { roster_id: 1, matchup_id: 1, starters: ['a', '8205'], starters_points: [17.4, 0],
    players: ['a', '8205', 'z'], players_points: { a: 17.4, 8205: 0, z: 8.1 } },
  { roster_id: 2, matchup_id: 1, starters: ['a', '8205'], starters_points: [9.2, 12.5],
    players: ['a', '8205'], players_points: { a: 9.2, 8205: 12.5 } },
];

// Bench length tracks entry.players.length per roster, which diverges the
// moment one team has dropped a player and the other has not — an ordinary
// mid-season state, not an edge case. Left carries 1 bench player, right
// carries 3, to catch lineupTable dropping any row past the shorter side.
const ROW_DROP_PLAYERS = {
  ...DETAIL_PLAYERS,
  lb1: { name: 'Lonnie Bench', pos: 'WR', team: 'MIN' },
  rb1: { name: 'Reed Bench One', pos: 'WR', team: 'MIN' },
  rb2: { name: 'Reed Bench Two', pos: 'WR', team: 'MIN' },
  rb3: { name: 'Reed Bench Three', pos: 'WR', team: 'MIN' },
};
const ROW_DROP_PAYLOAD = [
  { roster_id: 1, matchup_id: 1, starters: ['a', '8205'], starters_points: [10, 5],
    players: ['a', '8205', 'lb1'], players_points: { a: 10, 8205: 5, lb1: 3 } },
  { roster_id: 2, matchup_id: 1, starters: ['a', '8205'], starters_points: [7, 6],
    players: ['a', '8205', 'rb1', 'rb2', 'rb3'],
    players_points: { a: 7, 8205: 6, rb1: 1, rb2: 2, rb3: 4 } },
];

test('a head-to-head detail lists both lineups with the bench', () => {
  const html = renderMatchupDetail({
    week: 3, matchup: { type: 'h2h', rosterIds: [1, 2], winner: 2 },
    resolved: PLAYED, payload: DETAIL_PAYLOAD, teams: TEAMS,
    rosterPositions: DETAIL_POSITIONS, players: DETAIL_PLAYERS,
  });
  assert.match(html, /Ann QB/);
  assert.match(html, /17\.40/);

  // Split on the heading rather than asserting it exists: the <h3>Bench</h3>
  // is emitted unconditionally, so matching /Bench/i could never fail. What
  // is worth asserting is that the bench player is rendered UNDER it and not
  // among the starters, which a lineupRows regression could genuinely break.
  const [starters, bench] = html.split('<h3 class="lineup-head">Bench</h3>');
  assert.match(bench, /Zed WR/, 'the bench player sits under the Bench heading');
  assert.doesNotMatch(starters, /Zed WR/, 'and is not also listed as a starter');
});

test('a zeroed starter is marked with the penalty that made him one', () => {
  // This is the league's whole identity; a detail view that hid it would be
  // showing Sleeper's numbers, not this league's.
  const html = renderMatchupDetail({
    week: 3, matchup: { type: 'h2h', rosterIds: [1, 2], winner: 2 },
    resolved: PLAYED, payload: DETAIL_PAYLOAD, teams: TEAMS,
    rosterPositions: DETAIL_POSITIONS, players: DETAIL_PLAYERS,
  });
  assert.match(html, /\+20/);
});

test('a median detail shows the line and marks the two scores averaged', () => {
  const html = renderMatchupDetail({
    week: 3, matchup: { type: 'median', rosterId: 5, line: 107.9, result: 'W' },
    resolved: PLAYED, payload: DETAIL_PAYLOAD, teams: TEAMS,
    rosterPositions: DETAIL_POSITIONS, players: DETAIL_PLAYERS,
  });
  assert.match(html, /League median/);
  assert.match(html, /107\.90/);
  assert.match(html, /class="[^"]*used/, 'the two averaged scores are marked');
  assert.match(html, /avg of 2nd/);
});

test('the detail escapes team and player names', () => {
  const html = renderMatchupDetail({
    week: 3, matchup: { type: 'h2h', rosterIds: [1, 2], winner: 2 },
    resolved: PLAYED, payload: DETAIL_PAYLOAD,
    teams: { 1: '<script>x</script>', 2: 'Bravo' },
    rosterPositions: DETAIL_POSITIONS,
    players: { ...DETAIL_PLAYERS, a: { name: '<img src=x>', pos: 'QB', team: 'CIN' } },
  });
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img /);
  // Matching the escaped form alone would still pass if the raw markup were
  // also present unescaped elsewhere in the output — evidence that escaping
  // happened somewhere, not that the raw string is absent (task 7's Critical
  // finding, reproduced here so it can't regress unnoticed).
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img /);
});

test('a missing payload entry does not throw', () => {
  const html = renderMatchupDetail({
    week: 3, matchup: { type: 'h2h', rosterIds: [1, 9], winner: 1 },
    resolved: PLAYED, payload: DETAIL_PAYLOAD, teams: TEAMS,
    rosterPositions: DETAIL_POSITIONS, players: DETAIL_PLAYERS,
  });
  assert.match(html, /Ann QB/);
});

test('bench players beyond the shorter side are not dropped', () => {
  // lineupTable mapped over the left side and indexed the right side at the
  // same position, so any right-side row at an index >= left.length was
  // never visited: no error, no notice, the player just disappeared. Left
  // here carries 1 bench player, right carries 3.
  const html = renderMatchupDetail({
    week: 3, matchup: { type: 'h2h', rosterIds: [1, 2], winner: 2 },
    resolved: PLAYED, payload: ROW_DROP_PAYLOAD, teams: TEAMS,
    rosterPositions: DETAIL_POSITIONS, players: ROW_DROP_PLAYERS,
  });
  assert.match(html, /Lonnie Bench/, 'the shorter (left) bench is shown');
  assert.match(html, /Reed Bench One/);
  assert.match(html, /Reed Bench Two/, 'a row past the shorter side length is not dropped');
  assert.match(html, /Reed Bench Three/, 'a row past the shorter side length is not dropped');
});

test('the picker offers every week and marks the played ones', () => {
  const opts = weekOptions([{ week: 1, played: true }, { week: 2, played: false }], 18);
  assert.equal(opts.length, 18);
  assert.deepEqual(opts[0], { week: 1, played: true });
  assert.deepEqual(opts[1], { week: 2, played: false });
  assert.deepEqual(opts[17], { week: 18, played: false });
});

test('a mounted view reads state fresh, so a repaint reflects changes made after mounting', async () => {
  // mountResults must not freeze weeks/teams/ghostRosterId/rosterPositions
  // at mount time. state.weeks starts empty (nothing loaded yet, the tab
  // clicked before loadSnapshot even resolves), a played week is pushed in
  // afterwards, and repaint() must draw it without a remount — exactly what
  // refreshLive() finishing after someone has already opened the tab looks
  // like.
  let html = '';
  const el = {
    set innerHTML(v) { html = v; },
    get innerHTML() { return html; },
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  const state = {
    weeks: [],
    teams: { 1: 'Alpha', 2: 'Bravo' },
    ghostRosterId: 6,
    seasonStart: START,
    rosterPositions: [],
    livePayloads: {},
    json: async (url) => {
      if (url === 'data/pairings.json') return { pairings: {} };
      throw new Error(`unexpected fetch: ${url}`);
    },
    now: () => local(2026, 9, 9), // week 1
  };

  const { repaint } = await mountResults(el, state);
  assert.doesNotMatch(html, /Alpha/, 'nothing resolved yet: no team name in the initial paint');

  state.weeks.push({
    week: 1, played: true, degenerate: false,
    matchups: [{ type: 'h2h', rosterIds: [1, 2], winner: 1 }],
    teams: {
      1: { raw: 10, adjusted: 10, penalties: [] },
      2: { raw: 20, adjusted: 20, penalties: [] },
    },
  });

  await repaint();
  assert.match(html, /Alpha/, 'the newly-played week is visible after repaint, without remounting');
  assert.match(html, /10\.00/);
});

/**
 * A DOM-free stand-in for `el` that is just capable enough to drive
 * mountResults' own wiring: it scrapes `data-week`/`data-step` buttons and
 * `data-matchup` cards out of whatever HTML string was assigned, hands
 * wire() fake elements with a `dataset` and a settable `onclick`, and lets a
 * test fire that `onclick` itself to simulate a real click without a
 * browser.
 *
 * The matchup cards and the back button are scraped too, because until they
 * were the click -> detail -> back path had no coverage through
 * mountResults at all: `[data-matchup]` returned [], so no test could reach
 * paint()'s detail branch, which is where the concurrent-paint race and the
 * stale matchup index both lived.
 */
function makeStubEl() {
  let html = '';
  const weekButtons = [];
  const stepButtons = [];
  const matchupCards = [];
  let backButton = null;
  const scrape = (v, re, make, into) => {
    into.length = 0;
    let m;
    while ((m = re.exec(v))) into.push(make(m));
  };
  return {
    get innerHTML() { return html; },
    set innerHTML(v) {
      html = v;
      scrape(v, /data-week="(\d+)"/g, (m) => ({ dataset: { week: m[1] }, onclick: null }), weekButtons);
      scrape(
        v, /data-matchup="(\d+)"/g,
        (m) => ({ dataset: { matchup: m[1] }, onclick: null, onkeydown: null }),
        matchupCards,
      );
      stepButtons.length = 0;
      for (const step of ['-1', '1']) {
        if (v.includes(`data-step="${step}"`)) stepButtons.push({ dataset: { step }, onclick: null });
      }
      backButton = v.includes('data-back') ? { onclick: null } : null;
    },
    querySelectorAll(sel) {
      if (sel === '[data-week]') return weekButtons;
      if (sel === '[data-step]') return stepButtons;
      if (sel === '[data-matchup]') return matchupCards;
      return [];
    },
    querySelector(sel) {
      return sel === '[data-back]' ? backButton : null;
    },
  };
}

/** Let an internal, un-awaited paint() run to its next suspension point. */
const settle = () => new Promise((r) => setTimeout(r, 0));

test('the default week keeps recomputing from state.seasonStart until it arrives, not frozen at mount', async () => {
  // Mirrors loadSnapshot resolving after the tab was already clicked:
  // seasonStart is still null at mount (displayWeek degrades to week 1),
  // then arrives and a repaint lands, same as resultsRepaint firing at the
  // end of app.js's paint(). The picker must move to week 9, not stay on 1.
  const el = makeStubEl();
  const state = {
    weeks: [], teams: {}, ghostRosterId: 6, seasonStart: null, rosterPositions: [],
    livePayloads: {},
    json: async (url) => {
      if (url === 'data/pairings.json') return { pairings: {} };
      throw new Error(`unexpected fetch: ${url}`);
    },
    now: () => local(2026, 11, 4), // week 9, once seasonStart is known
  };

  const { repaint } = await mountResults(el, state);
  assert.match(el.innerHTML, /data-week="1" aria-pressed="true"/, 'seasonStart unknown: degrades to week 1');

  state.seasonStart = START;
  await repaint();
  assert.match(el.innerHTML, /data-week="9" aria-pressed="true"/, 'seasonStart landed: the picker corrects to the real current week');
});

test('a week the visitor already chose survives a repaint, even if seasonStart changes underneath it', async () => {
  const el = makeStubEl();
  const state = {
    weeks: [], teams: {}, ghostRosterId: 6, seasonStart: START, rosterPositions: [],
    livePayloads: {},
    json: async (url) => {
      if (url === 'data/pairings.json') return { pairings: {} };
      throw new Error(`unexpected fetch: ${url}`);
    },
    now: () => local(2026, 11, 4), // week 9
  };

  const { repaint } = await mountResults(el, state);
  assert.match(el.innerHTML, /data-week="9" aria-pressed="true"/);

  const week12 = el.querySelectorAll('[data-week]').find((b) => b.dataset.week === '12');
  week12.onclick(); // a real click: sets weekChosen and repaints internally
  await new Promise((r) => setTimeout(r, 0)); // let that internal paint() settle
  assert.match(el.innerHTML, /data-week="12" aria-pressed="true"/);

  // If the guard were missing, this would snap the default back to week 1.
  state.seasonStart = null;
  await repaint();
  assert.match(el.innerHTML, /data-week="12" aria-pressed="true"/, 'the chosen week is not overwritten by a later repaint');
});

// The two benches are independent, unordered lists: verified against the
// real archived week-1 payload, rosters 1 and 3, whose benches run
// RB|QB|RB|QB|TE and QB|QB|WR|WR|WR. The detail table prints one slot label
// per row for both sides, so labelling a bench row with a position printed
// the LEFT player's position over the right player in 4 of these 5 rows.
const BENCH_PLAYERS = {
  a: { name: 'Ann QB', pos: 'QB', team: 'CIN' },
  8205: { name: 'Bo RB', pos: 'RB', team: 'ATL' },
  l1: { name: 'Left One', pos: 'RB', team: 'MIN' },
  l2: { name: 'Left Two', pos: 'QB', team: 'MIN' },
  l3: { name: 'Left Three', pos: 'RB', team: 'MIN' },
  l4: { name: 'Left Four', pos: 'QB', team: 'MIN' },
  l5: { name: 'Left Five', pos: 'TE', team: 'MIN' },
  r1: { name: 'Right One', pos: 'QB', team: 'BUF' },
  r2: { name: 'Right Two', pos: 'QB', team: 'BUF' },
  r3: { name: 'Right Three', pos: 'WR', team: 'BUF' },
  r4: { name: 'Right Four', pos: 'WR', team: 'BUF' },
  r5: { name: 'Right Five', pos: 'WR', team: 'BUF' },
};
const BENCH_PAYLOAD = [
  { roster_id: 1, matchup_id: 1, starters: ['a', '8205'], starters_points: [10, 5],
    players: ['a', '8205', 'l1', 'l2', 'l3', 'l4', 'l5'],
    players_points: { a: 10, 8205: 5, l1: 1, l2: 2, l3: 3, l4: 4, l5: 5 } },
  { roster_id: 2, matchup_id: 1, starters: ['a', '8205'], starters_points: [7, 6],
    players: ['a', '8205', 'r1', 'r2', 'r3', 'r4', 'r5'],
    players_points: { a: 7, 8205: 6, r1: 1, r2: 2, r3: 3, r4: 4, r5: 5 } },
];

const slotLabels = (section) =>
  [...section.matchAll(/class="lineup-slot">([^<]*)</g)].map((m) => m[1]);

test('bench rows are labelled BN, never with one side position printed over the other', () => {
  const html = renderMatchupDetail({
    week: 3, matchup: { type: 'h2h', rosterIds: [1, 2], winner: 2 },
    resolved: PLAYED, payload: BENCH_PAYLOAD, teams: TEAMS,
    rosterPositions: DETAIL_POSITIONS, players: BENCH_PLAYERS,
  });
  const [starters, bench] = html.split('<h3 class="lineup-head">Bench</h3>');

  assert.deepEqual(
    slotLabels(bench), ['BN', 'BN', 'BN', 'BN', 'BN'],
    'a bench row names the slot, not a position belonging to only one of its two players',
  );
  // The starter path is untouched: those rows genuinely share a lineup slot.
  assert.deepEqual(slotLabels(starters), ['QB', 'RB']);
  assert.match(bench, /Left One/);
  assert.match(bench, /Right One/);
});

test('a tie against the median is drawn as a tie, not as a median win', () => {
  const html = renderMatchupDetail({
    week: 3, matchup: { type: 'median', rosterId: 5, line: 101.2, result: 'T' },
    resolved: PLAYED, payload: DETAIL_PAYLOAD, teams: TEAMS,
    rosterPositions: DETAIL_POSITIONS, players: DETAIL_PLAYERS,
  });
  assert.match(html, /League median/);
  assert.doesNotMatch(html, /winner/i, 'neither side wins a draw - as in playedCard and the h2h detail');
});

test('a loss to the median still marks the median as the winner', () => {
  // The other half of the tie fix: it must not have flattened result L too.
  const html = renderMatchupDetail({
    week: 3, matchup: { type: 'median', rosterId: 5, line: 107.9, result: 'L' },
    resolved: PLAYED, payload: DETAIL_PAYLOAD, teams: TEAMS,
    rosterPositions: DETAIL_POSITIONS, players: DETAIL_PLAYERS,
  });
  assert.match(html, /class="side line winner"/);
});

// Two unfilled starting slots and one zeroed starter: three separate +20s.
// rules.js records an empty slot as playerId: null, so it cannot be matched
// by id, and a lineup can hold more than one of them.
const EMPTY_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'BN'];
const EMPTY_PAYLOAD = [
  { roster_id: 1, matchup_id: 1, starters: ['0', '0', '8205', 'a'], starters_points: [0, 0, 0, 17.4],
    players: ['8205', 'a', 'z'], players_points: { 8205: 0, a: 17.4, z: 8.1 } },
  { roster_id: 2, matchup_id: 1, starters: ['a'], starters_points: [9.2],
    players: ['a'], players_points: { a: 9.2 } },
];
const EMPTY_RESOLVED = {
  ...PLAYED,
  teams: {
    ...PLAYED.teams,
    1: {
      raw: 17.4, adjusted: 77.4,
      penalties: [
        { playerId: null, name: 'Empty slot', reason: 'empty-slot' },
        { playerId: null, name: 'Empty slot', reason: 'empty-slot' },
        { playerId: '8205', name: 'Bo RB', reason: 'zeroed' },
      ],
    },
  },
};

test('every empty starting slot carries its own +20 in the drill-down', () => {
  const html = renderMatchupDetail({
    week: 3, matchup: { type: 'h2h', rosterIds: [1, 2], winner: 2 },
    resolved: EMPTY_RESOLVED, payload: EMPTY_PAYLOAD, teams: TEAMS,
    rosterPositions: EMPTY_POSITIONS, players: DETAIL_PLAYERS,
  });
  assert.equal(
    (html.match(/class="pen">\+20/g) || []).length, 3,
    'two empty slots and one zeroed starter are three penalties, and the drill-down must account for all of them',
  );
  // And the marks land on the empty rows, not on whoever happens to be first.
  const rows = html.split('<div class="lineup-row">').slice(1);
  const marked = rows.filter((r) => r.includes('class="pen"'));
  assert.equal(marked.length, 3);
  assert.equal(marked.filter((r) => r.includes('Empty slot')).length, 2);
  assert.match(marked.find((r) => !r.includes('Empty slot')), /Bo RB/);
});

// Two played weeks with unmistakably different scores, so a paint that
// renders the wrong one cannot be mistaken for the right one.
const RACE_WEEKS = [
  {
    week: 5, played: true, degenerate: false,
    matchups: [{ type: 'h2h', rosterIds: [1, 2], winner: 1 }],
    teams: { 1: { raw: 55, adjusted: 55, penalties: [] }, 2: { raw: 65, adjusted: 65, penalties: [] } },
  },
  {
    week: 7, played: true, degenerate: false,
    matchups: [{ type: 'h2h', rosterIds: [1, 2], winner: 2 }],
    teams: { 1: { raw: 77, adjusted: 77, penalties: [] }, 2: { raw: 87, adjusted: 87, penalties: [] } },
  },
];

test('a slow fetch that lands last cannot overwrite the week clicked after it', async () => {
  // Click a played week whose wk{N}.json is not cached yet, click a second
  // played week before the first fetch lands, then let the FIRST fetch
  // resolve last. Both paints were in flight with nothing ordering them, so
  // the stale one wrote week 5's scores under a picker highlighting week 7.
  const el = makeStubEl();
  const pending = new Map();
  const state = {
    weeks: RACE_WEEKS,
    teams: TEAMS,
    ghostRosterId: 6,
    seasonStart: START,
    rosterPositions: DETAIL_POSITIONS,
    livePayloads: {},
    json: async (url) => {
      if (url === 'data/pairings.json') return { pairings: {} };
      if (url === 'data/roster-players.json') return { players: DETAIL_PLAYERS };
      const m = /^data\/raw\/wk(\d+)\.json$/.exec(url);
      if (m) return new Promise((resolve) => pending.set(Number(m[1]), () => resolve(DETAIL_PAYLOAD)));
      throw new Error(`unexpected fetch: ${url}`);
    },
    now: () => local(2026, 9, 9), // week 1: neither of the two racing weeks
  };

  await mountResults(el, state);
  const weekBtn = (n) => el.querySelectorAll('[data-week]').find((b) => b.dataset.week === String(n));

  weekBtn(5).onclick();
  await settle();
  weekBtn(7).onclick();
  await settle();
  assert.deepEqual([...pending.keys()], [5, 7], 'both weeks are in flight at once');

  pending.get(7)();   // the newer click's fetch lands first
  await settle();
  pending.get(5)();   // and the older one lands last
  await settle();

  assert.match(el.innerHTML, /data-week="7" aria-pressed="true"/, 'the picker shows the week clicked last');
  assert.match(el.innerHTML, /77\.00/, 'and so do the scores beside it');
  assert.doesNotMatch(el.innerHTML, /55\.00/, "week 5's scores must not appear under week 7's picker");
});

// Week 1 and week 9, each with two matchups, so a stale index into the
// wrong week's array still finds a matchup there - it just finds the wrong
// one, which is exactly the silent failure being guarded against.
const DRIFT_WEEKS = [
  {
    week: 1, played: true, degenerate: false,
    matchups: [
      { type: 'h2h', rosterIds: [1, 2], winner: 2 },
      { type: 'h2h', rosterIds: [3, 4], winner: 3 },
    ],
    teams: {
      1: { raw: 10, adjusted: 10, penalties: [] }, 2: { raw: 20, adjusted: 20, penalties: [] },
      3: { raw: 30, adjusted: 30, penalties: [] }, 4: { raw: 40, adjusted: 40, penalties: [] },
    },
  },
  {
    week: 9, played: true, degenerate: false,
    matchups: [
      { type: 'h2h', rosterIds: [1, 3], winner: 1 },
      { type: 'h2h', rosterIds: [2, 4], winner: 4 },
    ],
    teams: {
      1: { raw: 11, adjusted: 11, penalties: [] }, 2: { raw: 22, adjusted: 22, penalties: [] },
      3: { raw: 33, adjusted: 33, penalties: [] }, 4: { raw: 44, adjusted: 44, penalties: [] },
    },
  },
];

test('a drill-down is not re-pointed at another week when the default week moves under it', async () => {
  // view.matchup is an index into the week that was on screen when the card
  // was clicked. Opening a card does not set weekChosen, so the next paint
  // still recomputes the default week from seasonStart - and used to carry
  // the old index into the new week's matchups.
  const el = makeStubEl();
  let clock = local(2026, 9, 9); // week 1
  const state = {
    weeks: DRIFT_WEEKS,
    teams: TEAMS,
    ghostRosterId: 6,
    seasonStart: START,
    rosterPositions: DETAIL_POSITIONS,
    livePayloads: {},
    json: async (url) => {
      if (url === 'data/pairings.json') return { pairings: {} };
      if (url === 'data/roster-players.json') return { players: DETAIL_PLAYERS };
      if (/^data\/raw\/wk\d+\.json$/.test(url)) return DETAIL_PAYLOAD;
      throw new Error(`unexpected fetch: ${url}`);
    },
    now: () => clock,
  };

  const { repaint } = await mountResults(el, state);
  assert.match(el.innerHTML, /data-week="1" aria-pressed="true"/);

  el.querySelectorAll('[data-matchup]')[1].onclick(); // week 1's second matchup
  await settle();
  assert.match(el.innerHTML, /data-back/, 'the drill-down is open');
  assert.match(el.innerHTML, /Delta/, "and it is week 1's second matchup, rosters 3 and 4");

  clock = local(2026, 11, 4); // the clock rolls on to week 9 under the open detail
  await repaint();

  assert.match(el.innerHTML, /data-week="9" aria-pressed="true"/, 'the week moves on');
  assert.doesNotMatch(el.innerHTML, /data-back/, "and the index into week 1's matchups goes with it");
});
