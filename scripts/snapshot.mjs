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

import { API_BASE } from '../config.js';
import {
  createClient,
  currentWeek,
  findGhostRosterId,
  unownedRosterIds,
} from '../sleeper.js';
import { byeTeams, resolveWeek, standings, opportunitySet } from '../rules.js';

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
export function buildSnapshot({ rosters, users, schedule, players, weekPayloads, opportunities = {} }) {
  // Every unowned slot is stripped from the engine; the lowest one is still
  // reported as the ghost because that is what the page labels and explains.
  const ghostRosterId = findGhostRosterId(rosters);
  const excluded = unownedRosterIds(rosters);

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
      resolveWeek(
        w,
        weekPayloads[w],
        excluded,
        byeTeams(schedule, w),
        players,
        new Set(opportunities[w] || []),
      ),
    );

  return { standings: standings(weeks), weeks, meta: { ghostRosterId, teams } };
}

/**
 * Write `{generatedAt, ...body}` as JSON, but only stamp a new timestamp
 * when the substantive content actually changed.
 *
 * The Action commits whenever `data/` differs. An unconditional timestamp
 * makes every run differ, so the workflow's "commit only on change" guard
 * can never be true and history fills with ~13 empty commits a week.
 *
 * @param {string} file
 * @param {Object} body - everything except generatedAt, in key order
 * @param {string} now - ISO timestamp to use when the content is new
 * @returns {Promise<{generatedAt:string, changed:boolean}>}
 */
export async function writeStamped(file, body, now) {
  const next = JSON.stringify(body);
  let generatedAt = now;
  let changed = true;

  if (existsSync(file)) {
    try {
      const { generatedAt: prevAt, ...prevBody } = JSON.parse(await readFile(file, 'utf8'));
      if (prevAt && JSON.stringify(prevBody) === next) {
        generatedAt = prevAt;
        changed = false;
      }
    } catch {
      // Unreadable or malformed: treat it as new content and rewrite.
    }
  }

  await writeFile(file, JSON.stringify({ generatedAt, ...body }, null, 2));
  return { generatedAt, changed };
}

async function readOpps() {
  if (!existsSync(RAW)) return {};
  const out = {};
  for (const f of await readdir(RAW)) {
    const m = /^opps(\d+)\.json$/.exec(f);
    if (m) out[Number(m[1])] = JSON.parse(await readFile(path.join(RAW, f), 'utf8'));
  }
  return out;
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
  let opportunities = {};
  let players;

  if (replay) {
    rosters = JSON.parse(await readFile(path.join(RAW, 'rosters.json'), 'utf8'));
    users = JSON.parse(await readFile(path.join(RAW, 'users.json'), 'utf8'));
    schedule = JSON.parse(await readFile(path.join(RAW, 'schedule.json'), 'utf8'));
    players = JSON.parse(await readFile(path.join(DATA, 'players-slim.json'), 'utf8'));
    weekPayloads = await readRaw();
    opportunities = await readOpps();
  } else {
    const state = await client.state();
    // 0 during the preseason: /state/nfl counts preseason weeks in the same
    // field, and archiving those would publish a season of zeros.
    const current = currentWeek(state);
    if (current === 0) {
      console.log(
        `snapshot: season_type "${state.season_type}" — no real weeks to archive, ` +
          'rescoring whatever is already in data/raw',
      );
    }

    [rosters, users, schedule] = await Promise.all([
      client.rosters(),
      client.users(),
      client.schedule(),
    ]);

    await writeFile(path.join(RAW, 'rosters.json'), JSON.stringify(rosters));
    await writeFile(path.join(RAW, 'users.json'), JSON.stringify(users));
    await writeFile(path.join(RAW, 'schedule.json'), JSON.stringify(schedule));

    weekPayloads = {};
    opportunities = {};
    for (let w = 1; w <= current; w++) {
      const payload = await client.matchups(w);
      if (!Array.isArray(payload) || payload.length === 0) continue;
      weekPayloads[w] = payload;
      await writeFile(path.join(RAW, `wk${w}.json`), JSON.stringify(payload));

      // Archive only the ids that had a scoring chance, not the ~570 KB raw
      // stats payload: that id list is all the engine needs to replay a week.
      const ids = [...opportunitySet(await client.stats(w))].sort();
      opportunities[w] = ids;
      await writeFile(path.join(RAW, `opps${w}.json`), JSON.stringify(ids));
    }

    // Off-season: /state/nfl reports no real week, but a finished season is
    // still sitting in data/raw. Rescore the archive rather than publishing
    // an empty site over a completed 18 weeks. The cron runs year-round, so
    // without this the standings blank themselves some time in February.
    if (current === 0) weekPayloads = await readRaw();

    players = await refreshPlayers();
  }

  const snap = buildSnapshot({ rosters, users, schedule, players, weekPayloads, opportunities });
  const now = new Date().toISOString();

  const s = await writeStamped(
    path.join(DATA, 'standings.json'),
    { ...snap.meta, standings: snap.standings },
    now,
  );
  const w = await writeStamped(path.join(DATA, 'weeks.json'), { weeks: snap.weeks }, now);

  console.log(
    `snapshot: ${snap.weeks.filter((x) => x.played).length} played weeks, ` +
      `ghost roster ${snap.meta.ghostRosterId}, ` +
      (s.changed || w.changed ? 'content changed' : 'content unchanged'),
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
