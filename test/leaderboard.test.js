import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adjustWeek,
  buildLeaderboard,
  scoreWeek,
  slimForLeaderboard,
  slimWeek,
} from '../leaderboard.js';

// Minimal scoring config; keys mirror real league keys but values are ours.
const SCORING = { pass_yd: 0.04, pass_td: 4, rec: 1, fgmiss: -1 };

const PLAYERS = {
  A: { pos: 'QB', team: 'CIN', name: 'Quincy Back' },
  B: { pos: 'DEF', team: 'HOU', name: 'Houston Texans' },
  D: { pos: 'WR', team: 'NYJ', name: 'Drops Everything' },
  E: { pos: 'WR', team: 'NYJ', name: 'Targeted Zero' },
  F: { pos: 'WR', team: 'NYJ', name: 'Hands Of Stone' },
};

test('scoreWeek multiplies raw stats by league weights and ignores unknown keys', () => {
  const stats = { gp: 1, pass_yd: 250, pass_td: 2, rec: 3, fgmiss: 1, junk_stat: 99 };
  // 250*0.04 + 2*4 + 3*1 + 1*(-1) = 10 + 8 + 3 - 1 = 20
  assert.equal(scoreWeek(stats, SCORING), 20);
});

test('scoreWeek handles floating point cleanly', () => {
  // 3 * 0.04 = 0.12000000000000001 without rounding
  assert.equal(scoreWeek({ pass_yd: 3 }, SCORING), 0.12);
});

test('a played week scoring exactly 0 with NO opportunity takes the penalty', () => {
  assert.deepEqual(adjustWeek(0, true, false, false), { adj: 20, penalized: true });
});

test('a played week scoring exactly 0 WITH an opportunity is exempt', () => {
  assert.deepEqual(adjustWeek(0, true, false, true), { adj: 0, penalized: false });
});

test('a DEF that played to a 0 is exempt regardless of opportunity', () => {
  assert.deepEqual(adjustWeek(0, true, true, false), { adj: 0, penalized: false });
});

test('a missed week is penalized even if the player somehow logged an attempt', () => {
  assert.deepEqual(adjustWeek(0, false, false, true), { adj: 20, penalized: true });
  assert.deepEqual(adjustWeek(0, false, true, false), { adj: 20, penalized: true });
});

test('negative scores pass through untouched', () => {
  assert.deepEqual(adjustWeek(-1, true, false, false), { adj: -1, penalized: false });
});

test('slimWeek keeps only known ids that actually played', () => {
  const raw = {
    A: { gp: 1, rec: 4 }, // caught 4, scored 4
    D: { gp: 1, rush_att: 2 }, // scores nothing under SCORING, but he ran
    F: { gp: 1, rec_tgt: 6 }, // targeted 6 times, caught none: not a chance
    E: { rec: 9 }, // no gp: did not play
    ZZ: { gp: 1, rec: 4 }, // unknown id
  };
  assert.deepEqual(slimWeek(raw, PLAYERS, SCORING), {
    A: { pts: 4, gp: 1, opp: 1 },
    D: { pts: 0, gp: 1, opp: 1 },
    F: { pts: 0, gp: 1, opp: 0 },
  });
});

test('slimWeek survives a null or missing payload', () => {
  assert.deepEqual(slimWeek(null, PLAYERS, SCORING), {});
  assert.deepEqual(slimWeek(undefined, PLAYERS, SCORING), {});
});

test('a kicker who nets 0 on extra points alone is marked as an opportunity', () => {
  // 1 made (+1) and 1 missed (-1) is exactly 0, but they were sent out to kick
  const raw = { A: { gp: 1, xpa: 2, xpm: 1, xpmiss: 1 } };
  assert.equal(slimWeek(raw, PLAYERS, { xpm: 1, xpmiss: -1 }).A.opp, 1);
  assert.equal(slimWeek(raw, PLAYERS, { xpm: 1, xpmiss: -1 }).A.pts, 0);
});

test('slimForLeaderboard keeps fantasy positions regardless of active flag', () => {
  const raw = {
    A: { position: 'QB', full_name: 'Quincy Back', team: 'CIN', active: true },
    R: { position: 'RB', first_name: 'Retired', last_name: 'Guy', team: null, active: false },
    X: { position: 'OL', full_name: 'Lineman Guy', team: 'CIN', active: true },
    F: { position: 'FB', fantasy_positions: ['RB'], full_name: 'Full Back', team: 'DAL', active: true },
  };
  // A retired player still played last season; history must not rot.
  assert.deepEqual(slimForLeaderboard(raw), {
    A: { pos: 'QB', team: 'CIN', name: 'Quincy Back' },
    R: { pos: 'RB', team: '—', name: 'Retired Guy' },
    F: { pos: 'RB', team: 'DAL', name: 'Full Back' },
  });
});

test('buildLeaderboard aggregates totals, PPG, and penalties per player', () => {
  const weeks = [
    // week 1: A scores 10; B (DEF) plays to a 0; D plays and scores 0 with no
    // chance; E plays, scores 0, but caught a pass.
    {
      A: { pts: 10, gp: 1, opp: 0 },
      B: { pts: 0, gp: 1, opp: 0 },
      D: { pts: 0, gp: 1, opp: 0 },
      E: { pts: 0, gp: 1, opp: 1 },
    },
    // week 2: only B plays.
    { B: { pts: 5, gp: 1, opp: 0 } },
  ];
  const rows = buildLeaderboard(PLAYERS, weeks);

  const pick = (id) => {
    const r = rows.find((x) => x.id === id);
    return { gp: r.gp, raw: r.raw, pen: r.pen, truePen: r.truePen, saved: r.saved, total: r.total, ppg: r.ppg };
  };

  // wk1 10 played; wk2 missed -> +20. total 30, 1 penalty (0 true), ppg 10.
  assert.deepEqual(pick('A'), { gp: 1, raw: 10, pen: 1, truePen: 0, saved: 0, total: 30, ppg: 10 });
  // DEF 0 is exempt; 5 in wk2. total 5, no penalties, ppg 2.5.
  assert.deepEqual(pick('B'), { gp: 2, raw: 5, pen: 0, truePen: 0, saved: 0, total: 5, ppg: 2.5 });
  // wk1 a TRUE +20; wk2 missed -> +20 but not true. total 40, ppg 20.
  assert.deepEqual(pick('D'), { gp: 1, raw: 0, pen: 2, truePen: 1, saved: 0, total: 40, ppg: 20 });
  // caught a pass and scored 0 -> saved. wk2 missed -> +20.
  assert.deepEqual(pick('E'), { gp: 1, raw: 0, pen: 1, truePen: 0, saved: 1, total: 20, ppg: 0 });

  // ascending by total: lowest (best) first
  assert.deepEqual(rows.map((r) => r.id), ['B', 'E', 'A', 'D']);
});

test('buildLeaderboard drops players with no games and ids it cannot name', () => {
  const weeks = [{ A: { pts: 4, gp: 1, opp: 0 }, ZZ: { pts: 99, gp: 1, opp: 0 } }];
  const rows = buildLeaderboard(PLAYERS, weeks);
  assert.deepEqual(rows.map((r) => r.id), ['A']);
});

test('a free-agent player with no NFL team gets a placeholder, never null', () => {
  // players-slim.json really does carry team: null (e.g. an unsigned kicker),
  // and the view calls team.toLowerCase() when searching.
  const players = { F: { pos: 'K', team: null, name: 'Free Agent Kicker' } };
  const rows = buildLeaderboard(players, [{ F: { pts: 3, gp: 1, opp: 0 } }]);
  assert.equal(rows[0].team, '—');
});

test('buildLeaderboard fills the saved log when one is supplied', () => {
  const weeks = [{}, { E: { pts: 0, gp: 1, opp: 1 } }];
  const log = [];
  buildLeaderboard(PLAYERS, weeks, log);
  assert.deepEqual(log, [
    { week: 2, id: 'E', name: 'Targeted Zero', pos: 'WR', team: 'NYJ' },
  ]);
});

test('an empty season yields no rows rather than throwing', () => {
  assert.deepEqual(buildLeaderboard(PLAYERS, []), []);
});

test('a slim week survives a JSON round trip unchanged', () => {
  const raw = { A: { gp: 1, pass_yd: 3 }, D: { gp: 1, rec: 1 } };
  const slim = slimWeek(raw, PLAYERS, SCORING);
  const viaDisk = JSON.parse(JSON.stringify(slim));
  assert.deepEqual(buildLeaderboard(PLAYERS, [slim]), buildLeaderboard(PLAYERS, [viaDisk]));
});

// A week whose games have not kicked off is archived empty, and every player
// in the league is "missing" from it. Charging that as an absence put a +20 on
// all 517 rows of the live board on 2026-09-22, week 3, before a ball was
// thrown. Phases come straight from gameStates(): 'upcoming' withholds.

test('a missed week the player\'s NFL team has not kicked off counts toward nothing', () => {
  const weeks = [{ A: { pts: 10, gp: 1, opp: 0 } }, {}];
  const phases = [new Map([['CIN', 'final']]), new Map([['CIN', 'upcoming']])];
  const [a] = buildLeaderboard({ A: PLAYERS.A }, weeks, null, phases);
  assert.deepEqual(
    { gp: a.gp, raw: a.raw, pen: a.pen, truePen: a.truePen, total: a.total, ppg: a.ppg },
    { gp: 1, raw: 10, pen: 0, truePen: 0, total: 10, ppg: 10 },
  );
});

test('a missed week whose game is in progress still charges: he is absent from a game being played', () => {
  const weeks = [{ A: { pts: 10, gp: 1, opp: 0 } }, {}];
  const phases = [new Map([['CIN', 'final']]), new Map([['CIN', 'live']])];
  const [a] = buildLeaderboard({ A: PLAYERS.A }, weeks, null, phases);
  assert.equal(a.pen, 1);
  assert.equal(a.total, 30);
});

test('a bye charges once every fixture in the week is final', () => {
  const weeks = [{ A: { pts: 10, gp: 1, opp: 0 } }, {}];
  // CIN is on bye in week 2 — no entry — and the rest of the week is done.
  const phases = [new Map([['CIN', 'final']]), new Map([['HOU', 'final']])];
  const [a] = buildLeaderboard({ A: PLAYERS.A }, weeks, null, phases);
  assert.equal(a.pen, 1);
  assert.equal(a.total, 30);
});

test('a bye withholds while any fixture in the week is still to come', () => {
  const weeks = [{ A: { pts: 10, gp: 1, opp: 0 } }, {}];
  const phases = [
    new Map([['CIN', 'final']]),
    new Map([['HOU', 'final'], ['NYJ', 'upcoming']]),
  ];
  const [a] = buildLeaderboard({ A: PLAYERS.A }, weeks, null, phases);
  assert.deepEqual({ gp: a.gp, raw: a.raw, pen: a.pen, total: a.total }, {
    gp: 1, raw: 10, pen: 0, total: 10,
  });
});

test('a bye withholds while a fixture in the week is in progress', () => {
  const weeks = [{ A: { pts: 10, gp: 1, opp: 0 } }, {}];
  const phases = [
    new Map([['CIN', 'final']]),
    new Map([['HOU', 'final'], ['NYJ', 'live']]),
  ];
  const [a] = buildLeaderboard({ A: PLAYERS.A }, weeks, null, phases);
  assert.equal(a.pen, 0);
  assert.equal(a.total, 10);
});

test('with no phases supplied every missed week charges, so the frozen 2025 archive rescores identically', () => {
  const weeks = [{ A: { pts: 10, gp: 1, opp: 0 } }, {}];
  const [a] = buildLeaderboard({ A: PLAYERS.A }, weeks);
  assert.equal(a.pen, 1);
  assert.equal(a.total, 30);
});

test('a player with no NFL team waits on the week, exactly as a bye does', () => {
  // He has no fixture of his own to settle, so the same gate applies: nothing
  // of his can start, and the wait is on the week finishing.
  const players = { F: { pos: 'K', team: null, name: 'Free Agent Kicker' } };
  const weeks = [{ F: { pts: 3, gp: 1, opp: 0 } }, {}];
  const running = [new Map([['CIN', 'final']]), new Map([['CIN', 'upcoming']])];
  assert.equal(buildLeaderboard(players, weeks, null, running)[0].pen, 0);

  const done = [new Map([['CIN', 'final']]), new Map([['CIN', 'final']])];
  assert.equal(buildLeaderboard(players, weeks, null, done)[0].pen, 1);
});
