import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ownershipIndex,
  renderLeaderboard,
  selectRows,
  stepMinGp,
} from '../leaderboard-view.js';

const row = (o) => ({
  id: 'x', name: 'X', team: 'NYJ', pos: 'WR',
  gp: 10, raw: 50, pen: 0, truePen: 0, saved: 0, total: 50, ppg: 5, ...o,
});

const ROWS = [
  row({ id: 'a', name: 'Alpha', pos: 'QB', gp: 17, total: 10, ppg: 1 }),
  row({ id: 'b', name: 'Bravo', pos: 'RB', gp: 2, total: 20, ppg: 2 }),
  row({ id: 'c', name: 'Charlie', pos: 'WR', gp: 9, total: 30, ppg: 3 }),
  row({ id: 'd', name: 'Delta', pos: 'DEF', team: 'KC', gp: 17, total: 40, ppg: 4 }),
];

test('the default sort is ascending by the active metric', () => {
  assert.deepEqual(selectRows(ROWS, { metric: 'total' }).map((r) => r.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(selectRows(ROWS, { metric: 'ppg' }).map((r) => r.id), ['a', 'b', 'c', 'd']);
});

test('an explicit sort key overrides the metric and honours direction', () => {
  const asc = selectRows(ROWS, { metric: 'total', sortKey: 'gp', sortDir: 1 });
  assert.deepEqual(asc.map((r) => r.id), ['b', 'c', 'a', 'd']);
  const desc = selectRows(ROWS, { metric: 'total', sortKey: 'gp', sortDir: -1 });
  assert.deepEqual(desc.map((r) => r.id), ['a', 'd', 'c', 'b']);
});

test('rows tied on the sort key stay ordered by ascending total', () => {
  // a and d are both gp 17; a has the lower total and must come first.
  const out = selectRows(ROWS, { sortKey: 'gp', sortDir: 1 });
  assert.deepEqual(out.slice(2).map((r) => r.id), ['a', 'd']);
});

test('string columns sort with localeCompare', () => {
  const out = selectRows(ROWS, { sortKey: 'name', sortDir: -1 });
  assert.deepEqual(out.map((r) => r.id), ['d', 'c', 'b', 'a']);
});

test('position tabs filter, and FLEX means RB, WR or TE', () => {
  assert.deepEqual(selectRows(ROWS, { tab: 'QB' }).map((r) => r.id), ['a']);
  assert.deepEqual(selectRows(ROWS, { tab: 'FLEX' }).map((r) => r.id), ['b', 'c']);
  assert.equal(selectRows(ROWS, { tab: 'All' }).length, 4);
});

test('the minimum-games filter applies to PPG only', () => {
  assert.equal(selectRows(ROWS, { metric: 'ppg', minGp: 10 }).length, 2);
  assert.equal(selectRows(ROWS, { metric: 'total', minGp: 10 }).length, 4);
});

test('search matches name or team, case insensitively', () => {
  assert.deepEqual(selectRows(ROWS, { q: 'rav' }).map((r) => r.id), ['b']);
  assert.deepEqual(selectRows(ROWS, { q: 'kc' }).map((r) => r.id), ['d']);
  assert.equal(selectRows(ROWS, { q: 'zzz' }).length, 0);
});

test('selectRows never mutates the array it is given', () => {
  const before = ROWS.map((r) => r.id);
  selectRows(ROWS, { sortKey: 'total', sortDir: -1 });
  assert.deepEqual(ROWS.map((r) => r.id), before);
});

test('the stepper clamps between 1 and the highest games played', () => {
  assert.equal(stepMinGp(1, -1, 17), 1);
  assert.equal(stepMinGp(1, 1, 17), 2);
  assert.equal(stepMinGp(17, 1, 17), 17);
  assert.equal(stepMinGp(5, -1, 17), 4);
  assert.equal(stepMinGp(1, 1, 0), 1); // empty season: no room to step
});

test('ownershipIndex maps every rostered player to its manager', () => {
  const rosters = [
    { roster_id: 1, owner_id: 'u1', players: ['a', 'b'] },
    { roster_id: 2, owner_id: 'u2', players: ['c'] },
    { roster_id: 6, owner_id: null, players: [] },
  ];
  const idx = ownershipIndex(rosters, { 1: 'Alpha FC', 2: 'Bravo FC' });
  assert.equal(idx.ownerOf.get('a'), '1');
  assert.equal(idx.ownerOf.get('c'), '2');
  assert.equal(idx.ownerOf.get('d'), undefined);
  assert.equal(idx.drafted, true);
  assert.deepEqual(idx.options.map((o) => o.label), [
    'All players', 'Free agents', 'Alpha FC', 'Bravo FC',
  ]);
});

test('ownershipIndex reports an undrafted league', () => {
  const idx = ownershipIndex(
    [{ roster_id: 1, owner_id: 'u1', players: [] }],
    { 1: 'Alpha FC' },
  );
  assert.equal(idx.drafted, false);
  assert.equal(idx.ownerOf.size, 0);
});

test('the owner filter separates free agents from rostered players', () => {
  const ownerOf = new Map([['a', '1'], ['b', '1'], ['c', '2']]);
  assert.deepEqual(selectRows(ROWS, { owner: 'fa', ownerOf }).map((r) => r.id), ['d']);
  assert.deepEqual(selectRows(ROWS, { owner: '1', ownerOf }).map((r) => r.id), ['a', 'b']);
  assert.equal(selectRows(ROWS, { owner: 'all', ownerOf }).length, 4);
});

test('an empty result renders the supplied message, not a table', () => {
  const html = renderLeaderboard([], { emptyMessage: 'No games played yet in 2026.' });
  assert.match(html, /No games played yet in 2026\./);
  assert.doesNotMatch(html, /<table/);
});

test('rank is row position after filtering, always starting at 1', () => {
  const html = renderLeaderboard(selectRows(ROWS, { tab: 'FLEX' }), {});
  const ranks = [...html.matchAll(/<td class="rank">(\d+)<\/td>/g)].map((m) => m[1]);
  assert.deepEqual(ranks, ['1', '2']);
});

test('hostile player and team names render inert', () => {
  const html = renderLeaderboard(
    [row({ name: '<img src=x onerror=alert(1)>', team: '<script>alert(1)</script>' })],
    { labels: new Map() },
  );
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img /);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img /);
});

test('the owner column shows the manager name or FA', () => {
  const view = { ownerOf: new Map([['a', '1']]), labels: new Map([['1', 'Alpha FC']]) };
  const html = renderLeaderboard([ROWS[0], ROWS[3]], view);
  assert.match(html, /Alpha FC/);
  assert.match(html, />FA</);
});
