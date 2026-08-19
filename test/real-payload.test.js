import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveWeek, adjustedScore } from '../rules.js';

const REAL = JSON.parse(readFileSync(new URL('./fixtures/real-week.json', import.meta.url)));
const NO_BYES = new Set();
const NO_PLAYERS = {}; // every id unknown — the harshest case for adjustedScore

test('the engine resolves a real Sleeper payload without throwing', () => {
  const r = resolveWeek(1, REAL, new Set([6]), NO_BYES, NO_PLAYERS);
  assert.equal(r.week, 1);
  assert.equal(r.played, true);
  assert.equal(Object.keys(r.teams).length, 5); // ghost excluded
  assert.equal(r.matchups.length, 3);           // 2 h2h + 1 median
  assert.equal(r.medianPool.length, 4);
  assert.equal(typeof r.median, 'number');
});

test('raw score matches the points Sleeper itself reported', () => {
  for (const entry of REAL) {
    const { raw } = adjustedScore(entry, NO_BYES, NO_PLAYERS);
    assert.ok(
      Math.abs(raw - entry.points) < 0.05,
      `roster ${entry.roster_id}: engine ${raw} vs Sleeper ${entry.points}`,
    );
  }
});
