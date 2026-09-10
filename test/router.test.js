import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, formatHash } from '../router.js';

test('an empty or unknown hash is the default view', () => {
  for (const h of ['', '#', '#/', undefined, null, '#/nonsense', '#/results/../etc']) {
    assert.deepEqual(parseHash(h), { tab: 'results', week: null, matchup: null }, String(h));
  }
});

test('tabs, weeks and matchups parse', () => {
  for (const tab of ['results', 'standings', 'players', 'rules']) {
    assert.deepEqual(parseHash(`#/${tab}`), { tab, week: null, matchup: null });
  }
  assert.deepEqual(parseHash('#/results/week/3'), { tab: 'results', week: 3, matchup: null });
  assert.deepEqual(parseHash('#/results/week/3/matchup/1'), { tab: 'results', week: 3, matchup: 1 });
  assert.deepEqual(parseHash('#/standings/week/3'), { tab: 'standings', week: null, matchup: null });
});

test('a bad week is refused, not clamped', () => {
  // Clamping would silently show week 18 to someone who asked for week 40.
  for (const bad of ['#/results/week/0', '#/results/week/19', '#/results/week/abc', '#/results/week/3.5']) {
    assert.equal(parseHash(bad).week, null, bad);
  }
});

test('a matchup without a week is not addressable', () => {
  assert.equal(parseHash('#/results/matchup/1').matchup, null);
  assert.equal(parseHash('#/results/week/3/matchup/abc').matchup, null);
});

test('formatHash writes the shortest URL that says it', () => {
  assert.equal(formatHash(), '#/results');
  assert.equal(formatHash({ tab: 'nonsense' }), '#/results');
  assert.equal(formatHash({ tab: 'standings' }), '#/standings');
  assert.equal(formatHash({ tab: 'results', week: 3 }), '#/results/week/3');
  assert.equal(formatHash({ tab: 'results', week: 3, matchup: 1 }), '#/results/week/3/matchup/1');
  assert.equal(formatHash({ tab: 'results', matchup: 1 }), '#/results', 'no week, no matchup');
  assert.equal(formatHash({ tab: 'players', week: 3 }), '#/players');
});

test('every addressable view round-trips', () => {
  const views = [
    { tab: 'results', week: null, matchup: null },
    { tab: 'standings', week: null, matchup: null },
    { tab: 'players', week: null, matchup: null },
    { tab: 'rules', week: null, matchup: null },
    { tab: 'results', week: 1, matchup: null },
    { tab: 'results', week: 18, matchup: 0 },
    { tab: 'results', week: 7, matchup: 2 },
  ];
  for (const v of views) assert.deepEqual(parseHash(formatHash(v)), v, JSON.stringify(v));
});
