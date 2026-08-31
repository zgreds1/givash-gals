import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, currentWeek, findGhostRosterId, unownedRosterIds } from '../sleeper.js';

function stub(payload) {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => payload };
  };
  return { fetchImpl, calls: () => calls };
}

test('the ghost roster is the one with a null owner', () => {
  const rosters = [
    { roster_id: 1, owner_id: 'a' },
    { roster_id: 2, owner_id: 'b' },
    { roster_id: 3, owner_id: null },
  ];
  assert.equal(findGhostRosterId(rosters), 3);
});

test('no ghost roster when every slot is owned', () => {
  assert.equal(findGhostRosterId([{ roster_id: 1, owner_id: 'a' }]), null);
});

test('the first unowned roster wins when several are empty', () => {
  const rosters = [
    { roster_id: 1, owner_id: 'a' },
    { roster_id: 4, owner_id: null },
    { roster_id: 3, owner_id: null },
  ];
  assert.equal(findGhostRosterId(rosters), 3); // lowest id, deterministic
});

test('concurrent identical requests share one fetch', async () => {
  const s = stub({ week: 3 });
  const c = createClient({ fetchImpl: s.fetchImpl, now: () => 0 });
  await Promise.all([c.state(), c.state(), c.state()]);
  assert.equal(s.calls(), 1);
});

test('a repeat request inside the interval is served from cache', async () => {
  const s = stub({ week: 3 });
  let clock = 0;
  const c = createClient({ fetchImpl: s.fetchImpl, now: () => clock, minIntervalMs: 30000 });
  await c.state();
  clock = 29999;
  await c.state();
  assert.equal(s.calls(), 1);
});

test('a repeat request after the interval refetches', async () => {
  const s = stub({ week: 3 });
  let clock = 0;
  const c = createClient({ fetchImpl: s.fetchImpl, now: () => clock, minIntervalMs: 30000 });
  await c.state();
  clock = 30001;
  await c.state();
  assert.equal(s.calls(), 2);
});

test('a failed request rejects and does not poison the in-flight map', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 429, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ week: 3 }) };
  };
  const c = createClient({ fetchImpl, now: () => 0 });
  await assert.rejects(() => c.state(), /429/);
  assert.deepEqual(await c.state(), { week: 3 });
});

test('matchups and schedule hit the documented paths', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return { ok: true, status: 200, json: async () => [] };
  };
  const c = createClient({ fetchImpl, now: () => 0 });
  await c.matchups(7);
  await c.schedule();
  assert.ok(seen[0].endsWith('/v1/league/1395797781926408192/matchups/7'));
  assert.ok(seen[1].endsWith('/schedule/nfl/regular/2026'));
});

test('unownedRosterIds returns every empty slot, not just the ghost', () => {
  const rosters = [
    { roster_id: 1, owner_id: 'a' },
    { roster_id: 2, owner_id: 'b' },
    { roster_id: 3, owner_id: 'c' },
    { roster_id: 4, owner_id: null },
    { roster_id: 5, owner_id: null },
    { roster_id: 6, owner_id: null },
  ];
  assert.deepEqual([...unownedRosterIds(rosters)].sort(), [4, 5, 6]);
  assert.equal(findGhostRosterId(rosters), 4); // still the lowest, for display
});

test('unownedRosterIds is empty when every slot is owned', () => {
  assert.equal(unownedRosterIds([{ roster_id: 1, owner_id: 'a' }]).size, 0);
});

test('preseason weeks are not real weeks', () => {
  assert.equal(currentWeek({ week: 2, season_type: 'pre' }), 0);
  assert.equal(currentWeek({ week: 3, season_type: 'off' }), 0);
  assert.equal(currentWeek(undefined), 0);
});

test('regular and post season weeks count, clamped to the last covered week', () => {
  assert.equal(currentWeek({ week: 1, season_type: 'regular' }), 1);
  assert.equal(currentWeek({ week: 14, season_type: 'regular' }), 14);
  assert.equal(currentWeek({ week: 22, season_type: 'post' }), 18);
  assert.equal(currentWeek({ week: 0, season_type: 'regular' }), 0);
});

test('the client exposes only the endpoints the project uses', () => {
  const c = createClient({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  assert.deepEqual(
    Object.keys(c).sort(),
    ['get', 'matchups', 'rosters', 'schedule', 'state', 'stats', 'users'],
  );
});

test('stats hits the weekly stats endpoint for the configured season', async () => {
  const seen = [];
  const c = createClient({
    fetchImpl: async (url) => {
      seen.push(url);
      return { ok: true, json: async () => ({}) };
    },
    now: () => 0,
  });
  await c.stats(7);
  assert.ok(seen[0].endsWith('/v1/stats/nfl/regular/2026/7'), seen[0]);
});
