import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustedScore, byeTeams, gameStates } from '../rules.js';
import { mkEntry, PLAYERS, SCHEDULE, SCHEDULE_LIVE } from './helpers.js';

const WK3 = byeTeams(SCHEDULE, 3);   // nobody on bye
const WK8 = byeTeams(SCHEDULE, 8);   // HOU and CIN on bye
const LIVE3 = gameStates(SCHEDULE_LIVE, 3); // HOU/CIN final, KC/MIN live

// HOU's own game still being played. The cases below that must settle on the
// spot — a bye DEF, an unknown id — pass this instead of LIVE3, where HOU is
// already 'final' and any phase at all would look right.
const HOU_LIVE = gameStates([{ week: 3, home: 'HOU', away: 'CIN', status: 'in_game' }], 3);

// One zero whose game has finished, one whose game is still on, and one
// starter who scored — enough to separate all three readings.
const MIXED = [
  ['6804', 0.0],   // QB Burrow, CIN, game finished
  ['4199', 0.0],   // WR Jefferson, MIN, game in progress
  ['1466', 12.0],  // K Bass, BUF, scored
];

test('a zero in a finished game counts in both adjusted and in play', () => {
  const r = adjustedScore(mkEntry(1, 1, [['6804', 0]]), WK3, PLAYERS, new Set(), LIVE3);
  assert.equal(r.raw, 0);
  assert.equal(r.adjusted, 20);
  assert.equal(r.inPlay, 20);
  assert.equal(r.penalties[0].phase, 'final');
});

test('a zero in a game still being played counts in play only', () => {
  const r = adjustedScore(mkEntry(1, 1, [['4199', 0]]), WK3, PLAYERS, new Set(), LIVE3);
  assert.equal(r.adjusted, 0, 'not settled: the +20 has not landed');
  assert.equal(r.inPlay, 20);
  assert.equal(r.penalties[0].phase, 'live');
});

test('a zero in a game that has not kicked off counts in neither', () => {
  const wk5 = gameStates(SCHEDULE_LIVE, 5); // HOU/CIN pre_game
  const r = adjustedScore(mkEntry(1, 1, [['6804', 0]]), WK3, PLAYERS, new Set(), wk5);
  assert.equal(r.adjusted, 0);
  assert.equal(r.inPlay, 0);
  assert.equal(r.penalties[0].phase, 'upcoming');
});

test('the three scores order as raw <= adjusted <= inPlay', () => {
  const r = adjustedScore(mkEntry(1, 1, MIXED), WK3, PLAYERS, new Set(), LIVE3);
  assert.equal(r.raw, 12);
  assert.equal(r.adjusted, 32, 'Burrow only');
  assert.equal(r.inPlay, 52, 'Burrow + Jefferson');
  assert.ok(r.raw <= r.adjusted && r.adjusted <= r.inPlay);
});

test('an empty slot is settled the moment the week starts', () => {
  // wk5 has not kicked off, so a slot taking its phase from anywhere but the
  // literal would land on 'upcoming' and leave both readings at 0.
  const wk5 = gameStates(SCHEDULE_LIVE, 5);
  const r = adjustedScore(mkEntry(1, 1, [['0', 0]]), WK3, PLAYERS, new Set(), wk5);
  assert.equal(r.adjusted, 20, 'no game can rescue an empty slot');
  assert.equal(r.inPlay, 20);
  assert.equal(r.penalties[0].phase, 'final');
});

test('a player whose team is on bye is settled, not pending', () => {
  // Robinson is ATL; ATL appears in no game in SCHEDULE_LIVE at all.
  const r = adjustedScore(mkEntry(1, 1, [['8205', 0]]), WK3, PLAYERS, new Set(), LIVE3);
  assert.equal(r.adjusted, 20, 'absence is the thing the rule punishes');
  assert.equal(r.penalties[0].phase, 'final');
});

test('a DEF on bye is still penalised, and settled', () => {
  // The bye set and the states map disagree on purpose: HOU is on bye in week
  // 8 and mid-game in HOU_LIVE. That is the only combination that tells the
  // hardcoded 'final' apart from a schedule lookup — under LIVE3, HOU reads
  // 'final' either way and the assertion could not fail.
  const r = adjustedScore(mkEntry(1, 1, [['HOU', 0]]), WK8, PLAYERS, new Set(), HOU_LIVE);
  assert.equal(r.adjusted, 20);
  assert.equal(r.penalties[0].reason, 'bye-def');
  assert.equal(r.penalties[0].phase, 'final');
});

test('a DEF not on bye stays exempt whatever its game is doing', () => {
  const r = adjustedScore(mkEntry(1, 1, [['KC', 0]]), WK3, PLAYERS, new Set(), LIVE3);
  assert.equal(r.adjusted, 0);
  assert.equal(r.inPlay, 0);
  assert.deepEqual(r.penalties, []);
});

test('an unknown player id is settled immediately', () => {
  // Absent from the slim map means inactive, which is absence. 999999 has no
  // team to look up, so nothing but the literal can produce 'final' here —
  // and adjusted drops to 0 the moment that literal becomes 'live'.
  const r = adjustedScore(mkEntry(1, 1, [['999999', 0]]), WK3, PLAYERS, new Set(), HOU_LIVE);
  assert.equal(r.adjusted, 20);
  assert.equal(r.inPlay, 20);
  assert.equal(r.penalties[0].phase, 'final');
});

test('the opportunity exemption still beats every phase', () => {
  const r = adjustedScore(
    mkEntry(1, 1, [['4199', 0]]), WK3, PLAYERS, new Set(['4199']), LIVE3,
  );
  assert.equal(r.inPlay, 0);
  assert.deepEqual(r.penalties, []);
});

test('states = null reproduces the pre-phase numbers exactly', () => {
  const r = adjustedScore(mkEntry(1, 1, MIXED), WK3, PLAYERS);
  assert.equal(r.adjusted, 52, 'every game treated as final');
  assert.equal(r.inPlay, 52);
  assert.ok(r.penalties.every((p) => p.phase === 'final'));
});

test('a canceled game is settled like a finished one', () => {
  // CIN plays DAL in week 3, but the game was canceled. Burrow (CIN QB) scores 0.
  const schedule = [
    { week: 3, home: 'CIN', away: 'DAL', status: 'canceled' },
  ];
  const canceled = gameStates(schedule, 3);
  const r = adjustedScore(mkEntry(1, 1, [['6804', 0]]), WK3, PLAYERS, new Set(), canceled);
  assert.equal(r.adjusted, 20, 'a canceled game is final: penalty landed');
  assert.equal(r.inPlay, 20);
  assert.equal(r.penalties[0].phase, 'final');
});
