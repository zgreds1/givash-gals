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

test('an empty slot stays pending while any game has yet to kick off', () => {
  // wk5 has not kicked off: the slot can still be filled, so nothing lands.
  const wk5 = gameStates(SCHEDULE_LIVE, 5);
  const r = adjustedScore(mkEntry(1, 1, [['0', 0]]), WK3, PLAYERS, new Set(), wk5);
  assert.equal(r.adjusted, 0);
  assert.equal(r.inPlay, 0);
  assert.equal(r.penalties[0].phase, 'upcoming');
});

test('an empty slot stays pending while the last game is still to start', () => {
  // Most of the week is over; one game remains unplayed.
  const states = gameStates([
    { week: 3, home: 'HOU', away: 'CIN', status: 'complete' },
    { week: 3, home: 'KC', away: 'MIN', status: 'pre_game' },
  ], 3);
  const r = adjustedScore(mkEntry(1, 1, [['0', 0]]), WK3, PLAYERS, new Set(), states);
  assert.equal(r.adjusted, 0);
  assert.equal(r.penalties[0].phase, 'upcoming');
});

test('an empty slot settles once the last game of the week kicks off', () => {
  // LIVE3: HOU/CIN final, KC/MIN in progress - nothing left to kick off.
  const r = adjustedScore(mkEntry(1, 1, [['0', 0]]), WK3, PLAYERS, new Set(), LIVE3);
  assert.equal(r.adjusted, 20, 'no one can be added after the last kickoff');
  assert.equal(r.inPlay, 20);
  assert.equal(r.penalties[0].phase, 'final');
});

test('an empty slot with no schedule information is settled', () => {
  const r = adjustedScore(mkEntry(1, 1, [['0', 0]]), WK3, PLAYERS, new Set(), null);
  assert.equal(r.adjusted, 20);
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

/* --- How much football is left ---------------------------------------
 *
 * `yetToPlay` answers a question none of the three scores can: how much of
 * this lineup is still unresolved. It counts STARTERS whose own game has not
 * kicked off, which is deliberately a wider net than `penalties` casts — a
 * penalty is only ever recorded for a player who scored nothing, while a
 * starter who has not played yet may still end the week on any number at all.
 */

// KC has not kicked off; CIN has finished; MIN is mid-game. One week holding
// all three phases, so a count can only be right by reading each starter's
// own game rather than the week's.
const THREE_PHASE = gameStates([
  { week: 3, home: 'KC', away: 'DAL', status: 'pre_game' },
  { week: 3, home: 'CIN', away: 'BAL', status: 'complete' },
  { week: 3, home: 'MIN', away: 'GB', status: 'in_game' },
], 3);

test('a starter whose game has not kicked off is yet to play', () => {
  const r = adjustedScore(mkEntry(1, 1, [['1466', 0]]), WK3, PLAYERS, new Set(), THREE_PHASE);
  // Bass is BUF, which appears in no game above, so pick a KC player instead.
  assert.equal(r.yetToPlay, 0, 'BUF is absent from the schedule: nothing to wait for');

  const kc = adjustedScore(mkEntry(1, 1, [['KC', 0]]), WK3, PLAYERS, new Set(), THREE_PHASE);
  assert.equal(kc.yetToPlay, 1);
});

test('a starter whose game is in progress is not yet to play', () => {
  const r = adjustedScore(mkEntry(1, 1, [['4199', 0]]), WK3, PLAYERS, new Set(), THREE_PHASE);
  assert.equal(r.yetToPlay, 0, 'Jefferson is MIN: kicked off already');
});

test('a starter whose game is final is not yet to play', () => {
  const r = adjustedScore(mkEntry(1, 1, [['6804', 0]]), WK3, PLAYERS, new Set(), THREE_PHASE);
  assert.equal(r.yetToPlay, 0, 'Burrow is CIN: done');
});

test('a DEF not on bye is counted as yet to play despite its +20 exemption', () => {
  // The discriminator between "every starter" and "every PENALISED starter":
  // a DEF that has not kicked off records no penalty at all, yet it plainly
  // still has a game left to play.
  const r = adjustedScore(mkEntry(1, 1, [['KC', 0]]), WK3, PLAYERS, new Set(), THREE_PHASE);
  assert.deepEqual(r.penalties, [], 'DEF not on bye: no penalty to count');
  assert.equal(r.yetToPlay, 1);
});

test('an empty slot is never yet to play', () => {
  const r = adjustedScore(mkEntry(1, 1, [['0', 0]]), WK3, PLAYERS, new Set(), THREE_PHASE);
  assert.equal(r.yetToPlay, 0, 'no player means no game to wait for');
});

test('an unknown player id is never yet to play', () => {
  const r = adjustedScore(mkEntry(1, 1, [['999999', 0]]), WK3, PLAYERS, new Set(), THREE_PHASE);
  assert.equal(r.yetToPlay, 0, 'absent from the slim map means inactive');
});

test('yetToPlay counts each unplayed starter, not each unplayed game', () => {
  // Two KC starters share one kickoff. The number on the card says how many
  // PLAYERS are still to come, so this is 2, not 1.
  const r = adjustedScore(
    mkEntry(1, 1, [['KC', 0], ['KC', 0], ['6804', 0]]), WK3, PLAYERS, new Set(), THREE_PHASE,
  );
  assert.equal(r.yetToPlay, 2);
});

test('with no game information nothing is yet to play', () => {
  const r = adjustedScore(mkEntry(1, 1, MIXED), WK3, PLAYERS);
  assert.equal(r.yetToPlay, 0, 'states = null scores as if every game had finished');
});

/*
 * The count the cards and the standings print.
 *
 * It is deliberately NOT `penalties.length`: that array also holds the ones
 * still pending in games being played, and a card that counted those would
 * announce a +20 the league has not actually charged yet. The number tracks
 * `adjusted`, which is the same promise the score itself makes.
 */
test('settledPenalties counts only the +20s that have actually landed', () => {
  const r = adjustedScore(mkEntry(1, 1, MIXED), WK3, PLAYERS, new Set(), LIVE3);
  assert.equal(r.penalties.length, 2, 'two zeroed starters in all');
  assert.equal(r.settledPenalties, 1, 'but only the finished game has been charged');
  assert.equal(r.adjusted, r.raw + 20, 'and the count is what adjusted is built from');
});

test('settledPenalties ignores a zero whose game has not kicked off', () => {
  const wk5 = gameStates(SCHEDULE_LIVE, 5); // HOU/CIN pre_game
  const r = adjustedScore(mkEntry(1, 1, [['6804', 0]]), WK3, PLAYERS, new Set(), wk5);
  assert.equal(r.penalties.length, 1);
  assert.equal(r.settledPenalties, 0);
});

test('with no game information every +20 is settled, as the score already is', () => {
  const r = adjustedScore(mkEntry(1, 1, MIXED), WK3, PLAYERS);
  assert.equal(r.settledPenalties, 2);
  assert.equal(r.adjusted, r.raw + 40);
});

test('settledPenalties is zero, not absent, for a clean lineup', () => {
  const r = adjustedScore(mkEntry(1, 1, [['1466', 12.0]]), WK3, PLAYERS, new Set(), LIVE3);
  assert.equal(r.settledPenalties, 0);
});
