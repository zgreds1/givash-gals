import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustedScore, byeTeams, opportunitySet, hadOpportunity } from '../rules.js';
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

// --- opportunity rule -------------------------------------------------------

test('opportunitySet collects every player with a scoring chance', () => {
  const stats = {
    tgt: { rec_tgt: 3 },
    passer: { pass_att: 12 },
    runner: { rush_att: 1 },
    kicker: { fga: 2 },
    xp: { xpa: 4 },
    blocker: { off_snp: 40, rec_tgt: 0, rush_att: 0 },
  };
  const s = opportunitySet(stats);
  assert.deepEqual([...s].sort(), ['kicker', 'passer', 'runner', 'tgt', 'xp']);
  assert.equal(s.has('blocker'), false);
});

test('a starter at zero WITH an opportunity is not penalised', () => {
  const entry = mkEntry(1, 1, [['8205', 0]]);
  const r = adjustedScore(entry, WK3, PLAYERS, new Set(['8205']));
  assert.equal(r.adjusted, 0);
  assert.deepEqual(r.penalties, []);
});

test('a starter at zero WITHOUT an opportunity is still penalised', () => {
  const entry = mkEntry(1, 1, [['8205', 0]]);
  const r = adjustedScore(entry, WK3, PLAYERS, new Set(['4199']));
  assert.equal(r.adjusted, 20);
  assert.equal(r.penalties[0].reason, 'zeroed');
});

test('an opportunity does not rescue an empty starter slot', () => {
  const r = adjustedScore(mkEntry(1, 1, [['0', 0]]), WK3, PLAYERS, new Set(['0']));
  assert.equal(r.adjusted, 20);
  assert.equal(r.penalties[0].reason, 'empty-slot');
});

test('an opportunity does not rescue a DEF on bye', () => {
  const r = adjustedScore(mkEntry(1, 1, [['HOU', 0]]), WK8, PLAYERS, new Set(['HOU']));
  assert.equal(r.adjusted, 20);
  assert.equal(r.penalties[0].reason, 'bye-def');
});

test('omitting the opportunity set penalises zeroes as before', () => {
  const r = adjustedScore(mkEntry(1, 1, [['8205', 0]]), WK3, PLAYERS);
  assert.equal(r.adjusted, 20);
});

test('hadOpportunity recognises each of the five opportunity stats', () => {
  assert.equal(hadOpportunity({ rec_tgt: 1 }), true);
  assert.equal(hadOpportunity({ pass_att: 1 }), true);
  assert.equal(hadOpportunity({ rush_att: 1 }), true);
  assert.equal(hadOpportunity({ fga: 1 }), true);
  assert.equal(hadOpportunity({ xpa: 1 }), true);
});

test('hadOpportunity is false for a player who touched none of them', () => {
  assert.equal(hadOpportunity({ gp: 1, off_snp: 40, tkl: 2 }), false);
  assert.equal(hadOpportunity({}), false);
  assert.equal(hadOpportunity(undefined), false);
  assert.equal(hadOpportunity(null), false);
});

test('hadOpportunity ignores zeroed attempt stats', () => {
  assert.equal(
    hadOpportunity({ rec_tgt: 0, rush_att: 0, pass_att: 0, fga: 0, xpa: 0 }),
    false,
  );
});

test('opportunitySet delegates to hadOpportunity for every id', () => {
  const week = {
    A: { rec_tgt: 3 },
    B: { off_snp: 12 },
    C: { xpa: 1 },
    D: null,
  };
  assert.deepEqual([...opportunitySet(week)].sort(), ['A', 'C']);
});
