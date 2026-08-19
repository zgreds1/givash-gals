import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  slimPlayers,
  buildSnapshot,
  refreshPlayers,
  writeStamped,
} from '../scripts/snapshot.mjs';
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

test('refreshPlayers falls back to the cached slim map when fetch rejects', async () => {
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
    assert.deepEqual(result, cached);
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
