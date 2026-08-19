import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, findGhostRosterId } from '../sleeper.js';

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
