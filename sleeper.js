// Sleeper HTTP layer. The only place in the project that touches the network.
//
// Two hard guards against Sleeper's IP block (their limit is under 1000
// calls/minute): a minimum interval between identical requests, and a
// single-in-flight lock so a burst of callers shares one round trip.
//
// This module deliberately never fetches /v1/players/nfl — that payload is
// 14.6 MB and Sleeper asks it be pulled at most once a day. The snapshot
// script fetches it and commits a slim map instead.

import { API_BASE, LEAGUE_ID, SEASON } from './config.js';

/** The roster nobody owns. Lowest id wins so the answer is stable. */
export function findGhostRosterId(rosters) {
  const unowned = rosters.filter((r) => !r.owner_id).map((r) => r.roster_id);
  return unowned.length ? Math.min(...unowned) : null;
}

export function createClient({
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  minIntervalMs = 30000,
} = {}) {
  const inflight = new Map();
  const cache = new Map(); // path -> {at, data}

  async function get(path) {
    if (inflight.has(path)) return inflight.get(path);

    const hit = cache.get(path);
    if (hit && now() - hit.at < minIntervalMs) return hit.data;

    const p = (async () => {
      const res = await fetchImpl(API_BASE + path);
      if (!res.ok) throw new Error(`Sleeper ${res.status} for ${path}`);
      const data = await res.json();
      cache.set(path, { at: now(), data });
      return data;
    })();

    inflight.set(path, p);
    try {
      return await p;
    } finally {
      inflight.delete(path);
    }
  }

  return {
    get,
    state: () => get('/v1/state/nfl'),
    league: () => get(`/v1/league/${LEAGUE_ID}`),
    users: () => get(`/v1/league/${LEAGUE_ID}/users`),
    rosters: () => get(`/v1/league/${LEAGUE_ID}/rosters`),
    matchups: (week) => get(`/v1/league/${LEAGUE_ID}/matchups/${week}`),
    schedule: () => get(`/schedule/nfl/regular/${SEASON}`),
  };
}
