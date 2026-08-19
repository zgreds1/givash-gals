import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slimPlayers, buildSnapshot } from '../scripts/snapshot.mjs';
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
