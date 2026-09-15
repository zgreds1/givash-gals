import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderStandings, sortStandings, bestDirFor, STANDINGS_COLUMNS } from '../render.js';

/*
 * Standings sorting.
 *
 * The league inverts the usual reading — LOW adjusted points wins — so "best
 * first" is not one direction for every column. Each column declares which way
 * `good` runs and the first tap uses it; nobody should have to tap twice to
 * see who is winning.
 */
const ROWS = [
  // Deliberately in true standings order, as standings() emits them.
  { rosterId: 1, w: 1, l: 0, t: 0, gp: 1, winPct: 1, adjPF: 128.88, rawPF: 48.88,
    settledPenalties: 4, median: { w: 0, l: 0, t: 0 }, unresolvedTie: false },
  { rosterId: 5, w: 1, l: 0, t: 0, gp: 1, winPct: 1, adjPF: 163.94, rawPF: 63.94,
    settledPenalties: 5, median: { w: 1, l: 0, t: 0 }, unresolvedTie: false },
  { rosterId: 2, w: 1, l: 0, t: 0, gp: 1, winPct: 1, adjPF: 207.28, rawPF: 107.28,
    settledPenalties: 5, median: { w: 0, l: 0, t: 0 }, unresolvedTie: false },
  { rosterId: 3, w: 0, l: 1, t: 0, gp: 1, winPct: 0, adjPF: 181.74, rawPF: 141.74,
    settledPenalties: 2, median: { w: 0, l: 0, t: 0 }, unresolvedTie: false },
  { rosterId: 4, w: 0, l: 1, t: 0, gp: 1, winPct: 0, adjPF: 209.24, rawPF: 89.24,
    settledPenalties: 6, median: { w: 0, l: 0, t: 0 }, unresolvedTie: false },
];
const TEAMS = { 1: 'LilDaveIII', 5: 'Nsanders10', 2: 'Kirko chains', 3: 'Nsaker', 4: "Ben-Gvir's balagan" };

const ids = (rows) => rows.map((r) => r.rosterId);

test('no sort key leaves the engine order untouched', () => {
  assert.deepEqual(ids(sortStandings(ROWS, TEAMS, null, 1)), [1, 5, 2, 3, 4]);
});

test('sortStandings never mutates the rows it is given', () => {
  const before = ids(ROWS);
  sortStandings(ROWS, TEAMS, 'adjPF', -1);
  assert.deepEqual(ids(ROWS), before);
});

test('every stat column declares which direction is best', () => {
  // Low adjusted points wins, and a +20 is a penalty, so both are ascending.
  assert.equal(bestDirFor('adjPF'), 1);
  assert.equal(bestDirFor('rawPF'), 1);
  assert.equal(bestDirFor('settledPenalties'), 1);
  // More wins is better.
  assert.equal(bestDirFor('winPct'), -1);
  assert.equal(bestDirFor('record'), -1);
  assert.equal(bestDirFor('median'), -1);
});

test('the first tap on Adj PF puts the lowest score on top', () => {
  assert.deepEqual(ids(sortStandings(ROWS, TEAMS, 'adjPF', bestDirFor('adjPF'))), [1, 5, 3, 2, 4]);
});

test('the first tap on +20s puts the fewest penalties on top', () => {
  const out = sortStandings(ROWS, TEAMS, 'settledPenalties', bestDirFor('settledPenalties'));
  assert.deepEqual(out.map((r) => r.settledPenalties), [2, 4, 5, 5, 6]);
  assert.equal(out[0].rosterId, 3, 'Nsaker, on two');
});

test('the first tap on Record puts the most wins on top', () => {
  const out = sortStandings(ROWS, TEAMS, 'record', bestDirFor('record'));
  assert.deepEqual(out.map((r) => r.w), [1, 1, 1, 0, 0]);
});

test('reversing the direction reverses the order', () => {
  const best = ids(sortStandings(ROWS, TEAMS, 'adjPF', 1));
  const worst = ids(sortStandings(ROWS, TEAMS, 'adjPF', -1));
  assert.deepEqual(worst, [...best].reverse());
});

test('Team sorts by name, not by roster id', () => {
  const out = sortStandings(ROWS, TEAMS, 'team', 1);
  assert.deepEqual(out.map((r) => TEAMS[r.rosterId]),
    ["Ben-Gvir's balagan", 'Kirko chains', 'LilDaveIII', 'Nsaker', 'Nsanders10']);
});

/*
 * The # column is the STANDINGS position, not the row's place in whatever
 * order is on screen. Sorting by +20s must not invent a ranking the league
 * does not have — nobody is "1st by +20s".
 */
test('the rank column keeps the true standings position under any sort', () => {
  const html = renderStandings(ROWS, TEAMS, { sortKey: 'settledPenalties', sortDir: 1 });
  const order = [...html.matchAll(/<td class="rank">([^<]*)<\/td>/g)].map((m) => m[1]);
  assert.deepEqual(order, ['4', '1', '2', '3', '5'],
    'Nsaker is 4th in the standings even when it sorts first on +20s');
});

test('an unresolved tie keeps its T- prefix when sorted', () => {
  const tied = ROWS.map((r, i) => (i === 1 ? { ...r, unresolvedTie: true } : r));
  const html = renderStandings(tied, TEAMS, { sortKey: 'adjPF', sortDir: -1 });
  assert.match(html, /<td class="rank">T-2<\/td>/);
});

test('every column that carries a stat is sortable', () => {
  const notSortable = STANDINGS_COLUMNS.filter(([, , , , can]) => !can).map(([k]) => k);
  assert.deepEqual(notSortable, ['rank'], 'only the rank column is not a stat');
});

test('a sortable header is a real button carrying its key', () => {
  const html = renderStandings(ROWS, TEAMS, {});
  for (const [k, , , , can] of STANDINGS_COLUMNS) {
    if (!can) continue;
    assert.match(html, new RegExp(`data-k="${k}"`), `${k} header is addressable`);
  }
  assert.match(html, /<button type="button" class="th-btn">/);
});

test('the sorted header announces itself to a screen reader and to the eye', () => {
  const asc = renderStandings(ROWS, TEAMS, { sortKey: 'adjPF', sortDir: 1 });
  assert.match(asc, /data-k="adjPF"[^>]*aria-sort="ascending"/);
  assert.match(asc, /<span class="dir" aria-hidden="true">↑<\/span>/);
  const desc = renderStandings(ROWS, TEAMS, { sortKey: 'adjPF', sortDir: -1 });
  assert.match(desc, /data-k="adjPF"[^>]*aria-sort="descending"/);
  assert.match(desc, /<span class="dir" aria-hidden="true">↓<\/span>/);
});

test('only the sorted column carries aria-sort', () => {
  const html = renderStandings(ROWS, TEAMS, { sortKey: 'adjPF', sortDir: 1 });
  assert.equal((html.match(/aria-sort=/g) || []).length, 1);
});

test('with no sort key no header claims to be sorted', () => {
  const html = renderStandings(ROWS, TEAMS, {});
  assert.doesNotMatch(html, /aria-sort=/);
});

/*
 * The leader tint follows the LEADER, not the top row.
 *
 * It used to be `tbody tr:first-child`, which is the same thing only while the
 * table is in standings order. Sorted by +20s the tint sat on whichever team
 * had fewest penalties and announced it as the league leader.
 */
test('the leader row is marked by rank, not by position', () => {
  const html = renderStandings(ROWS, TEAMS, { sortKey: 'settledPenalties', sortDir: 1 });
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g).filter((r) => r.includes('class="rank"'));
  const leaderIdx = rows.findIndex((r) => / class="leader"/.test(r));
  assert.notEqual(leaderIdx, 0, 'the first row here is Nsaker, on two +20s');
  assert.match(rows[leaderIdx], /<td class="rank">1<\/td>/, 'the tint is on the actual leader');
  assert.equal(rows.filter((r) => / class="leader"/.test(r)).length, 1, 'exactly one leader');
});

test('the leader is still marked in the default order', () => {
  const html = renderStandings(ROWS, TEAMS, {});
  const tbody = html.slice(html.indexOf('<tbody>'));
  const first = tbody.match(/<tr[^>]*>/)[0];
  assert.match(first, /class="leader"/);
});

test('an unresolved tie for first marks no single leader', () => {
  // T-1 is not "first"; it is "we could not separate these". Tinting one of
  // them would settle by accident a tie the engine refused to settle.
  const tied = ROWS.map((r, i) => (i < 2 ? { ...r, unresolvedTie: true } : r));
  const html = renderStandings(tied, TEAMS, {});
  assert.doesNotMatch(html, /class="leader"/);
});
