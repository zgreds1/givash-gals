#!/usr/bin/env node
// Fetches Sleeper, archives the raw payloads, and writes the computed
// snapshot the site paints from. Run by .github/workflows/snapshot.yml.
//
//   node scripts/snapshot.mjs            fetch + compute + write
//   node scripts/snapshot.mjs --replay   recompute from data/raw, no network
//
// Every week is re-fetched every run, not just the current one, because
// Sleeper issues retroactive stat corrections days after a game.

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { API_BASE, LAST_WEEK } from '../config.js';
import { createClient, findGhostRosterId } from '../sleeper.js';
import { byeTeams, resolveWeek, standings } from '../rules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const RAW = path.join(DATA, 'raw');

const SKILL = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

/** Reduce the 14.6 MB players payload to the three fields rules.js needs. */
export function slimPlayers(raw) {
  const out = {};
  for (const [id, p] of Object.entries(raw)) {
    if (!p.active || !SKILL.has(p.position)) continue;
    const name =
      p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || id;
    out[id] = { pos: p.position, team: p.team, name };
  }
  return out;
}

/** Pure: everything the site needs, computed from already-fetched data. */
export function buildSnapshot({ rosters, users, schedule, players, weekPayloads }) {
  const ghostRosterId = findGhostRosterId(rosters);

  const userById = Object.fromEntries(users.map((u) => [u.user_id, u]));
  const teams = {};
  for (const r of rosters) {
    if (!r.owner_id) continue;
    const u = userById[r.owner_id];
    teams[String(r.roster_id)] =
      u?.metadata?.team_name || u?.display_name || `Roster ${r.roster_id}`;
  }

  const weeks = Object.keys(weekPayloads)
    .map(Number)
    .sort((a, b) => a - b)
    .map((w) =>
      resolveWeek(w, weekPayloads[w], ghostRosterId, byeTeams(schedule, w), players),
    );

  return { standings: standings(weeks), weeks, meta: { ghostRosterId, teams } };
}

async function readRaw() {
  if (!existsSync(RAW)) return {};
  const out = {};
  for (const f of await readdir(RAW)) {
    const m = /^wk(\d+)\.json$/.exec(f);
    if (m) out[Number(m[1])] = JSON.parse(await readFile(path.join(RAW, f), 'utf8'));
  }
  return out;
}

async function main() {
  const replay = process.argv.includes('--replay');
  await mkdir(RAW, { recursive: true });

  const client = createClient({ minIntervalMs: 0 });
  let rosters;
  let users;
  let schedule;
  let weekPayloads;
  let players;

  if (replay) {
    rosters = JSON.parse(await readFile(path.join(RAW, 'rosters.json'), 'utf8'));
    users = JSON.parse(await readFile(path.join(RAW, 'users.json'), 'utf8'));
    schedule = JSON.parse(await readFile(path.join(RAW, 'schedule.json'), 'utf8'));
    players = JSON.parse(await readFile(path.join(DATA, 'players-slim.json'), 'utf8'));
    weekPayloads = await readRaw();
  } else {
    const state = await client.state();
    const current = Math.min(Number(state.week) || 1, LAST_WEEK);

    [rosters, users, schedule] = await Promise.all([
      client.rosters(),
      client.users(),
      client.schedule(),
    ]);

    await writeFile(path.join(RAW, 'rosters.json'), JSON.stringify(rosters));
    await writeFile(path.join(RAW, 'users.json'), JSON.stringify(users));
    await writeFile(path.join(RAW, 'schedule.json'), JSON.stringify(schedule));

    weekPayloads = {};
    for (let w = 1; w <= current; w++) {
      const payload = await client.matchups(w);
      if (!Array.isArray(payload) || payload.length === 0) continue;
      weekPayloads[w] = payload;
      await writeFile(path.join(RAW, `wk${w}.json`), JSON.stringify(payload));
    }

    players = await refreshPlayers();
  }

  const snap = buildSnapshot({ rosters, users, schedule, players, weekPayloads });
  const generatedAt = new Date().toISOString();

  await writeFile(
    path.join(DATA, 'standings.json'),
    JSON.stringify({ generatedAt, ...snap.meta, standings: snap.standings }, null, 2),
  );
  await writeFile(
    path.join(DATA, 'weeks.json'),
    JSON.stringify({ generatedAt, weeks: snap.weeks }, null, 2),
  );

  console.log(
    `snapshot: ${snap.weeks.filter((w) => w.played).length} played weeks, ` +
      `ghost roster ${snap.meta.ghostRosterId}`,
  );
}

/** Pull players/nfl at most once a day and keep the slim map on disk. */
export async function refreshPlayers(fetchImpl = fetch) {
  const slimPath = path.join(DATA, 'players-slim.json');
  const stampPath = path.join(DATA, '.players-stamp');
  const today = new Date().toISOString().slice(0, 10);

  if (existsSync(slimPath) && existsSync(stampPath)) {
    if ((await readFile(stampPath, 'utf8')).trim() === today) {
      return JSON.parse(await readFile(slimPath, 'utf8'));
    }
  }

  let raw;
  try {
    const res = await fetchImpl(`${API_BASE}/v1/players/nfl`);
    if (!res.ok) throw new Error(`players/nfl ${res.status}`);
    raw = await res.json();
  } catch (e) {
    // Network failure (DNS, TLS, timeout) or a bad HTTP status: both are
    // recoverable as long as yesterday's slim map is still on disk. Only
    // the rosters/users/schedule/matchups already archived this run are
    // more valuable than a day-old player map, so degrade rather than abort.
    if (existsSync(slimPath)) return JSON.parse(await readFile(slimPath, 'utf8'));
    throw e;
  }

  const slim = slimPlayers(raw);
  await writeFile(slimPath, JSON.stringify(slim));
  await writeFile(stampPath, today);
  return slim;
}

// Only run when invoked directly, so the test can import the pure functions.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
