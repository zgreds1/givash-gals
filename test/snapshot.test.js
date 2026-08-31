import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  archivedOpportunityIds,
  slimPlayers,
  buildSnapshot,
  buildSeasonLeaderboard,
  refreshPlayers,
  writeStamped,
} from '../scripts/snapshot.mjs';
import { opportunitySet } from '../rules.js';
import { slimForLeaderboard, slimWeek } from '../leaderboard.js';
import { mkEntry, SCHEDULE } from './helpers.js';

test('slimPlayers keeps only active skill players and three fields', () => {
  const raw = {
    6804: { position: 'QB', team: 'CIN', full_name: 'Joe Burrow', active: true, college: 'LSU' },
    9999: { position: 'OL', team: 'CIN', full_name: 'Some Lineman', active: true },
    8888: { position: 'RB', team: 'CIN', full_name: 'Retired Guy', active: false },
    HOU: { position: 'DEF', team: 'HOU', first_name: 'Houston', last_name: 'Texans', active: true },
  };
  const slim = slimPlayers(raw);
  assert.deepEqual(Object.keys(slim).sort(), ['6804', 'HOU']);
  assert.deepEqual(slim['6804'], { pos: 'QB', team: 'CIN', name: 'Joe Burrow' });
  assert.deepEqual(slim.HOU, { pos: 'DEF', team: 'HOU', name: 'Houston Texans' });
});

test('buildSnapshot resolves every supplied week and names the teams', () => {
  const players = { 4199: { pos: 'WR', team: 'MIN', name: 'Justin Jefferson' } };
  const solo = (r, m, p) => mkEntry(r, m, [['4199', p]]);
  const snap = buildSnapshot({
    rosters: [1, 2, 3, 4, 5].map((i) => ({ roster_id: i, owner_id: `u${i}` }))
      .concat([{ roster_id: 6, owner_id: null }]),
    users: [1, 2, 3, 4, 5].map((i) => ({ user_id: `u${i}`, display_name: `Team ${i}` })),
    schedule: SCHEDULE,
    players,
    weekPayloads: {
      3: [solo(1, 1, 142.6), solo(2, 1, 88.1), solo(3, 2, 118.3),
          solo(4, 2, 97.5), solo(5, 3, 101.2), solo(6, 3, 0)],
    },
  });

  assert.equal(snap.meta.ghostRosterId, 6);
  assert.equal(snap.weeks.length, 1);
  assert.equal(snap.weeks[0].median, 107.9);
  assert.equal(snap.standings.length, 5);
  assert.equal(snap.meta.teams['1'], 'Team 1');
  assert.equal(snap.meta.teams['6'], undefined);
});

test('buildSnapshot skips weeks with no scores', () => {
  const players = { 4199: { pos: 'WR', team: 'MIN', name: 'JJ' } };
  const solo = (r, m, p) => mkEntry(r, m, [['4199', p]]);
  const snap = buildSnapshot({
    rosters: [{ roster_id: 1, owner_id: 'u1' }, { roster_id: 2, owner_id: null }],
    users: [{ user_id: 'u1', display_name: 'Team 1' }],
    schedule: SCHEDULE,
    players,
    weekPayloads: { 3: [solo(1, 1, 0), solo(2, 1, 0)] },
  });
  assert.equal(snap.weeks[0].played, false);
  assert.equal(snap.standings.length, 0);
});

test('a team name falls back to the display name when no team_name is set', () => {
  const snap = buildSnapshot({
    rosters: [{ roster_id: 1, owner_id: 'u1' }],
    users: [{ user_id: 'u1', display_name: 'LilDaveIII', metadata: { team_name: 'The Gals' } }],
    schedule: SCHEDULE,
    players: {},
    weekPayloads: {},
  });
  assert.equal(snap.meta.teams['1'], 'The Gals');
});

test('buildSnapshot excludes any unowned roster from the teams map, not just the ghost', () => {
  const snap = buildSnapshot({
    rosters: [
      { roster_id: 1, owner_id: 'u1' },
      { roster_id: 2, owner_id: 'u2' },
      { roster_id: 3, owner_id: 'u3' },
      { roster_id: 4, owner_id: null },
      { roster_id: 5, owner_id: null },
      { roster_id: 6, owner_id: null },
    ],
    users: [
      { user_id: 'u1', display_name: 'Team 1' },
      { user_id: 'u2', display_name: 'Team 2' },
      { user_id: 'u3', display_name: 'Team 3' },
    ],
    schedule: SCHEDULE,
    players: {},
    weekPayloads: {},
  });
  assert.equal(snap.meta.ghostRosterId, 4);
  assert.equal(Object.keys(snap.meta.teams).length, 3);
  assert.equal(snap.meta.teams['5'], undefined);
  assert.equal(snap.meta.teams['6'], undefined);
});

test('refreshPlayers falls back to the cached maps when fetch rejects', async () => {
  const stampPath = new URL('../data/.players-stamp', import.meta.url);
  const slimPath = new URL('../data/players-slim.json', import.meta.url);
  const originalStamp = await readFile(stampPath, 'utf8');
  const cached = JSON.parse(await readFile(slimPath, 'utf8'));

  try {
    // Force staleness so refreshPlayers must actually attempt a fetch
    // instead of short-circuiting on the freshness check.
    await writeFile(stampPath, '2000-01-01');
    const rejecting = async () => {
      throw new Error('network down');
    };
    const result = await refreshPlayers(rejecting);
    assert.deepEqual(result.slim, cached);
    // players-all.json may not exist yet on a fresh clone; either way the run
    // must come back with a usable leaderboard map rather than aborting.
    assert.ok(Object.keys(result.all).length > 0);
  } finally {
    await writeFile(stampPath, originalStamp);
  }
});

test('writeStamped keeps the previous timestamp when the content is unchanged', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'givash-'));
  const file = path.join(dir, 'standings.json');
  try {
    const body = { ghostRosterId: 6, teams: { 1: 'Alpha' }, standings: [] };

    const first = await writeStamped(file, body, '2026-09-14T00:00:00.000Z');
    assert.equal(first.changed, true);
    assert.equal(first.generatedAt, '2026-09-14T00:00:00.000Z');
    const bytes = await readFile(file, 'utf8');

    // Same content, later clock: the file must not move a single byte, or
    // the Action's "commit only when data/ changed" guard can never fire.
    const second = await writeStamped(file, body, '2026-09-14T01:00:00.000Z');
    assert.equal(second.changed, false);
    assert.equal(second.generatedAt, '2026-09-14T00:00:00.000Z');
    assert.equal(await readFile(file, 'utf8'), bytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeStamped stamps a new timestamp as soon as the content differs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'givash-'));
  const file = path.join(dir, 'weeks.json');
  try {
    await writeStamped(file, { weeks: [] }, '2026-09-14T00:00:00.000Z');
    const r = await writeStamped(file, { weeks: [{ week: 1 }] }, '2026-09-14T01:00:00.000Z');
    assert.equal(r.changed, true);
    assert.equal(r.generatedAt, '2026-09-14T01:00:00.000Z');
    assert.equal(JSON.parse(await readFile(file, 'utf8')).generatedAt, '2026-09-14T01:00:00.000Z');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeStamped stamps fresh when the existing file is unreadable', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'givash-'));
  const file = path.join(dir, 'weeks.json');
  try {
    await writeFile(file, 'not json at all');
    const r = await writeStamped(file, { weeks: [] }, '2026-09-14T02:00:00.000Z');
    assert.equal(r.changed, true);
    assert.equal(r.generatedAt, '2026-09-14T02:00:00.000Z');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('buildSnapshot excludes every unowned roster from the engine, not just the ghost', () => {
  // The live 2026-08-19 shape: 3 managers, 3 empty slots. Excluding only
  // roster 4 fabricated a head-to-head between two ownerless teams and a
  // median line computed over their scores.
  const players = { 4199: { pos: 'WR', team: 'MIN', name: 'JJ' } };
  const solo = (r, m, p) => mkEntry(r, m, [['4199', p]]);
  const snap = buildSnapshot({
    rosters: [
      { roster_id: 1, owner_id: 'u1' },
      { roster_id: 2, owner_id: 'u2' },
      { roster_id: 3, owner_id: 'u3' },
      { roster_id: 4, owner_id: null },
      { roster_id: 5, owner_id: null },
      { roster_id: 6, owner_id: null },
    ],
    users: [1, 2, 3].map((i) => ({ user_id: `u${i}`, display_name: `Team ${i}` })),
    schedule: SCHEDULE,
    players,
    weekPayloads: {
      3: [solo(1, 1, 100), solo(4, 1, 20), solo(2, 2, 90),
          solo(5, 2, 30), solo(3, 3, 80), solo(6, 3, 40)],
    },
  });

  const wk = snap.weeks[0];
  assert.equal(wk.degenerate, true);
  assert.deepEqual(wk.matchups, []);
  assert.notEqual(wk.median, 60);            // the wrong-population line
  assert.deepEqual(Object.keys(wk.teams).sort(), ['1', '2', '3']);
  assert.deepEqual(snap.standings, []);      // and nothing accrues
  assert.equal(snap.meta.ghostRosterId, 4);  // still reported for display
});

test('buildSnapshot applies the opportunity rule from archived id lists', () => {
  const players = {
    4199: { pos: 'WR', team: 'MIN', name: 'Justin Jefferson' },
    8205: { pos: 'RB', team: 'ATL', name: 'Bijan Robinson' },
  };
  const rosters = [1, 2, 3, 4, 5]
    .map((i) => ({ roster_id: i, owner_id: `u${i}` }))
    .concat([{ roster_id: 6, owner_id: null }]);
  const users = [1, 2, 3, 4, 5].map((i) => ({ user_id: `u${i}`, display_name: `T${i}` }));
  // roster 1 starts a zeroed RB; everyone else scores normally
  const week = [
    mkEntry(1, 1, [['4199', 50], ['8205', 0]]),
    mkEntry(2, 1, [['4199', 60]]),
    mkEntry(3, 2, [['4199', 70]]),
    mkEntry(4, 2, [['4199', 80]]),
    mkEntry(5, 3, [['4199', 65]]),
    mkEntry(6, 3, [['4199', 0]]),
  ];
  const base = { rosters, users, schedule: SCHEDULE, players, weekPayloads: { 3: week } };

  const without = buildSnapshot(base);
  assert.equal(without.weeks[0].teams[1].adjusted, 70); // 50 raw + 20 penalty

  const withOpp = buildSnapshot({ ...base, opportunities: { 3: ['8205'] } });
  assert.equal(withOpp.weeks[0].teams[1].adjusted, 50); // caught a pass, so spared
  assert.deepEqual(withOpp.weeks[0].teams[1].penalties, []);
});

test('buildSeasonLeaderboard orders weeks by number, not by object key order', () => {
  const players = {
    A: { pos: 'QB', team: 'CIN', name: 'Quincy Back' },
    B: { pos: 'WR', team: 'NYJ', name: 'Wide Out' },
  };
  // Deliberately out of order: week 2 declared first.
  const slim = {
    2: { A: { pts: 4, gp: 1, opp: 0 } },
    1: { A: { pts: 6, gp: 1, opp: 0 }, B: { pts: 1, gp: 1, opp: 0 } },
  };
  const rows = buildSeasonLeaderboard(players, slim);
  const a = rows.find((r) => r.id === 'A');
  const b = rows.find((r) => r.id === 'B');
  assert.equal(a.gp, 2);
  assert.equal(a.raw, 10);
  // B missed week 2, so it takes one penalty — which only lands correctly if
  // the season is two weeks long rather than one.
  assert.equal(b.pen, 1);
  assert.equal(b.total, 21);
});

test('buildSeasonLeaderboard returns no rows for a season with no weeks', () => {
  assert.deepEqual(buildSeasonLeaderboard({ A: { pos: 'QB', team: 'CIN', name: 'Q' } }, {}), []);
});

test('an unchanged leaderboard does not restamp, so the Action commits nothing', async () => {
  // The cron runs ~13 times a week. A leaderboard that restamps on every run
  // would defeat the workflow's commit-only-on-change guard by itself.
  const dir = await mkdtemp(path.join(tmpdir(), 'lb-'));
  const file = path.join(dir, 'leaderboard-2026.json');
  const body = { season: '2026', rows: [{ id: 'A', total: 20 }] };

  const first = await writeStamped(file, body, '2026-09-14T00:00:00.000Z');
  const second = await writeStamped(file, body, '2026-09-14T01:00:00.000Z');

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(second.generatedAt, first.generatedAt);
  await rm(dir, { recursive: true, force: true });
});

test('the archived opportunity ids come off the raw payload, gp flag and all', () => {
  // Regression: deriving these from the slimmed week gated them on gp >= 1 and
  // on membership of the active player map. Neither is part of the penalty
  // rule, which asks only whether a chance existed. Sleeper's gp flag lags an
  // in-progress game, so the Sunday cron would have archived an empty set and
  // published +20s that app.js's live refresh correctly withholds.
  const raw = {
    A: { gp: 1, rec: 3 },       // caught passes, gp caught up
    B: { gp: 0, rec: 1 },       // caught a pass, gp has NOT caught up yet
    C: { rush_att: 2 },         // carried the ball, no gp field at all
    D: { gp: 1, rec_tgt: 4 },   // targeted 4 times, caught none: not a chance
    ZZ: { gp: 0, pass_cmp: 1 }, // completed a pass, in no player map
  };

  assert.deepEqual(archivedOpportunityIds(raw), ['A', 'B', 'C', 'ZZ']);
  // Pinned to rules.js by construction, not by a parallel implementation.
  assert.deepEqual(archivedOpportunityIds(raw), [...opportunitySet(raw)].sort());

  // The leaderboard's slim week keeps its own, narrower gate — and that is
  // exactly why the opportunity archive must not be derived from it.
  const map = { pos: 'WR', team: 'NYJ', name: 'Someone' };
  const players = { A: map, B: map, C: map, D: map };
  assert.deepEqual(Object.keys(slimWeek(raw, players, { rec: 1 })).sort(), ['A', 'D']);
});

test('a player cut mid-season keeps his row, because the board is built from players-all', () => {
  // Sleeper flips `active` to false the moment a player is cut, dropping him
  // out of players-slim. His games and his accumulated +20s are most of the
  // point of this board, so the season path reads the unfiltered map.
  const raw = {
    A: { position: 'QB', team: 'CIN', full_name: 'Quincy Back', active: true },
    C: { position: 'WR', team: 'NYJ', full_name: 'Cut Loose', active: false },
  };
  const slim = slimPlayers(raw);
  const all = slimForLeaderboard(raw);
  assert.equal(slim.C, undefined);
  assert.ok(all.C);

  const scoring = { pass_yd: 0.04, rec: 1 };
  const rawWeek = { A: { gp: 1, pass_yd: 250 }, C: { gp: 1 } };

  // The archive is slimmed against the same unfiltered map, or the cut
  // player's week would be gone before the leaderboard ever ran.
  assert.equal(slimWeek(rawWeek, slim, scoring).C, undefined);
  const weeks = { 1: slimWeek(rawWeek, all, scoring) };

  assert.equal(buildSeasonLeaderboard(slim, weeks).find((r) => r.id === 'C'), undefined);

  const row = buildSeasonLeaderboard(all, weeks).find((r) => r.id === 'C');
  assert.equal(row.name, 'Cut Loose');
  assert.equal(row.gp, 1);
  assert.equal(row.truePen, 1); // played, scored 0, had no chance
  assert.equal(row.total, 20);
});
