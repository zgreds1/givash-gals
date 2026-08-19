import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustedScore, byeTeams } from '../rules.js';
import { mkEntry, PLAYERS, SCHEDULE } from './helpers.js';

const WK3 = byeTeams(SCHEDULE, 3); // nobody on bye
const WK8 = byeTeams(SCHEDULE, 8); // HOU and CIN on bye

// Spec section 4.2
const EXAMPLE = [
  ['6804', 18.4],  // QB Burrow
  ['8205', 0.0],   // RB Robinson  -> +20 zeroed
  ['0', 0.0],      // empty WR slot -> +20
  ['1466', -1.0],  // K Bass, missed FG -> kept negative
  ['HOU', 0.0],    // DEF, not on bye -> exempt
  ['4199', 76.2],  // filler
];

test('worked example from spec 4.2', () => {
  const r = adjustedScore(mkEntry(1, 1, EXAMPLE), WK3, PLAYERS);
  assert.equal(r.raw, 93.6);
  assert.equal(r.adjusted, 133.6);
  assert.equal(r.penalties.length, 2);
});

test('a DEF on bye is penalised like any other starter', () => {
  const r = adjustedScore(mkEntry(1, 1, EXAMPLE), WK8, PLAYERS);
  assert.equal(r.raw, 93.6);
  assert.equal(r.adjusted, 153.6);
  assert.equal(r.penalties.length, 3);
  assert.ok(r.penalties.some((p) => p.reason === 'bye-def'));
});

test('a DEF at zero and not on bye is exempt', () => {
  const r = adjustedScore(mkEntry(1, 1, [['HOU', 0.0]]), WK3, PLAYERS);
  assert.equal(r.adjusted, 0);
  assert.deepEqual(r.penalties, []);
});

test('an empty starter slot takes the penalty', () => {
  const r = adjustedScore(mkEntry(1, 1, [['0', 0.0]]), WK3, PLAYERS);
  assert.equal(r.adjusted, 20);
  assert.equal(r.penalties[0].reason, 'empty-slot');
});

test('negative scores are preserved and never penalised', () => {
  const r = adjustedScore(mkEntry(1, 1, [['1466', -1.0]]), WK3, PLAYERS);
  assert.equal(r.raw, -1);
  assert.equal(r.adjusted, -1);
  assert.deepEqual(r.penalties, []);
});

test('penalties stack per starter', () => {
  const four = [['8205', 0], ['4199', 0], ['6804', 0], ['0', 0]];
  const r = adjustedScore(mkEntry(1, 1, four), WK3, PLAYERS);
  assert.equal(r.adjusted, 80);
  assert.equal(r.penalties.length, 4);
});

test('penalties name the player responsible', () => {
  const r = adjustedScore(mkEntry(1, 1, [['8205', 0]]), WK3, PLAYERS);
  assert.deepEqual(r.penalties, [
    { playerId: '8205', name: 'Bijan Robinson', reason: 'zeroed' },
  ]);
});

test('an unknown player id at zero is penalised as a normal starter', () => {
  const r = adjustedScore(mkEntry(1, 1, [['999999', 0]]), WK3, PLAYERS);
  assert.equal(r.adjusted, 20);
  assert.equal(r.penalties[0].reason, 'zeroed');
  assert.match(r.penalties[0].name, /999999/);
});

test('a missing starters_points entry counts as zero', () => {
  const entry = { roster_id: 1, matchup_id: 1, starters: ['8205'], starters_points: [] };
  const r = adjustedScore(entry, WK3, PLAYERS);
  assert.equal(r.adjusted, 20);
});
