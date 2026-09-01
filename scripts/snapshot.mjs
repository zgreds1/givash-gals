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

import { API_BASE, LAST_WEEK, LEAGUE_ID, SEASON } from '../config.js';
import {
  createClient,
  currentWeek,
  findGhostRosterId,
  unownedRosterIds,
} from '../sleeper.js';
import { byeTeams, opportunitySet, resolveWeek, standings } from '../rules.js';
import { buildLeaderboard, slimForLeaderboard, slimWeek } from '../leaderboard.js';
import { pairsFromPayload } from '../results-view.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const RAW = path.join(DATA, 'raw');

const SKILL = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

/**
 * Reduce the 14.6 MB players payload to the three fields rules.js needs.
 *
 * The `active` filter is deliberate and must stay: app.js fetches
 * players-slim.json on every page load, and dropping the filter would put
 * ~57 KB on every visitor. The leaderboard, which does need cut players,
 * reads the unfiltered players-all.json instead — see refreshPlayers.
 */
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
export function buildSnapshot({
  rosters, users, schedule, players, weekPayloads,
  opportunities = {}, state = null, rosterPositions = [],
}) {
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

  return {
    standings: standings(weeks),
    weeks,
    meta: {
      ghostRosterId,
      teams,
      // The page's default week comes from here, so it can pick a week
      // before making any API call. Null on --replay when raw/state.json
      // predates this change.
      seasonStart: state?.season_start_date ?? null,
      rosterPositions,
    },
  };
}

/**
 * The whole season's schedule, keyed by week.
 *
 * Pure so it can be tested without the network; the fetching lives in main().
 * A week Sleeper has not generated returns [] rather than 404, and keying it
 * would draw an upcoming week containing no matchups.
 */
export function buildPairings(payloadsByWeek) {
  const out = {};
  for (const [week, payload] of Object.entries(payloadsByWeek || {})) {
    const pairs = pairsFromPayload(payload);
    if (pairs.length) out[week] = pairs;
  }
  return out;
}

/**
 * Aggregate a season of archived slim weeks into leaderboard rows.
 *
 * Weeks arrive as an object keyed by week number, which has no reliable
 * ordering, so they are sorted into a dense array first. Getting this wrong
 * would silently shorten the season and drop the missed-week penalties that
 * `total` depends on.
 *
 * @param {Object} players - slim player map
 * @param {Object<number, Object>} slimWeeks - keyed by week number
 */
export function buildSeasonLeaderboard(players, slimWeeks) {
  const nums = Object.keys(slimWeeks).map(Number).sort((a, b) => a - b);
  if (!nums.length) return [];
  const dense = [];
  for (let w = 1; w <= nums[nums.length - 1]; w++) dense.push(slimWeeks[w] || {});
  return buildLeaderboard(players, dense);
}

/**
 * Names for every player the detail view might have to render.
 *
 * Built from the union of current rosters and every archived week, because
 * the detail view shows bench players and a player dropped in week 5 still
 * started in week 3. Current rosters alone would leave that row showing a
 * bare Sleeper id.
 *
 * This file exists at all because players-slim.json is filtered to active
 * skill players — which is exactly the filter that removes the inactive and
 * IR players who fill bench slots.
 *
 * @param {Object} playersAll - slimForLeaderboard's output, {id: {pos, team,
 *   name}} — NOT a raw Sleeper record. There is no full_name/position here.
 */
export function buildRosterPlayers(playersAll, rosters, weekPayloads) {
  const ids = new Set();
  const add = (id) => {
    const s = String(id);
    // '0' is Sleeper's unfilled starting slot, not a player.
    if (s && s !== '0') ids.add(s);
  };

  for (const r of rosters || []) for (const id of r.players || []) add(id);
  for (const payload of Object.values(weekPayloads || {})) {
    for (const e of payload || []) {
      for (const id of e.players || []) add(id);
      for (const id of e.starters || []) add(id);
    }
  }

  const out = {};
  for (const id of [...ids].sort()) {
    // playersAll is slimForLeaderboard's output - {pos, team, name} - not a
    // raw Sleeper record. Reading full_name/position here would silently
    // yield the bare id for every player, which is the exact failure this
    // file exists to prevent.
    const p = (playersAll || {})[id];
    out[id] = { name: p?.name || id, pos: p?.pos || '', team: p?.team || '' };
  }
  return out;
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

async function readSlimWeeks() {
  if (!existsSync(RAW)) return {};
  const out = {};
  for (const f of await readdir(RAW)) {
    const m = /^stats(\d+)\.json$/.exec(f);
    if (m) out[Number(m[1])] = JSON.parse(await readFile(path.join(RAW, f), 'utf8'));
  }
  return out;
}

/**
 * The opportunity ids archived for one week: every id in the RAW payload that
 * had a scoring chance.
 *
 * Derived from the raw payload, NOT from the slimmed week. slimWeek drops any
 * line with gp < 1 and any id the player map cannot name, and neither gate
 * belongs to the penalty rule: the rule asks only whether a chance existed. If
 * Sleeper's gp flag lags an in-progress game, deriving from the slim week
 * would archive an empty set and publish +20s that app.js's live refresh —
 * which reads opportunitySet off the raw payload — correctly withholds.
 *
 * @param {Object<string, Object>|null} rawStats - Sleeper stats/nfl/regular/{yr}/{wk}
 * @returns {Array<string>} sorted, so the archive is byte-stable
 */
export function archivedOpportunityIds(rawStats) {
  return [...opportunitySet(rawStats)].sort();
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
  let league;
  let state;
  let weekPayloads;
  let opportunities = {};
  let slimWeeks = {};
  let players;
  let playersAll;
  let pairings = null;

  if (replay) {
    rosters = JSON.parse(await readFile(path.join(RAW, 'rosters.json'), 'utf8'));
    users = JSON.parse(await readFile(path.join(RAW, 'users.json'), 'utf8'));
    schedule = JSON.parse(await readFile(path.join(RAW, 'schedule.json'), 'utf8'));

    const statePath = path.join(RAW, 'state.json');
    state = existsSync(statePath)
      ? JSON.parse(await readFile(statePath, 'utf8'))
      : null;

    const leaguePath = path.join(RAW, 'league.json');
    league = existsSync(leaguePath)
      ? JSON.parse(await readFile(leaguePath, 'utf8'))
      : null;

    players = JSON.parse(await readFile(path.join(DATA, 'players-slim.json'), 'utf8'));

    const allPath = path.join(DATA, 'players-all.json');
    if (existsSync(allPath)) {
      playersAll = JSON.parse(await readFile(allPath, 'utf8'));
    } else {
      playersAll = players;
      console.log(
        'replay: data/players-all.json is missing — falling back to ' +
          'players-slim.json, so any player Sleeper has since marked inactive ' +
          'will be absent from the leaderboard. Run without --replay to write it.',
      );
    }

    weekPayloads = await readRaw();
    slimWeeks = await readSlimWeeks();
    opportunities = await readOpps();
  } else {
    state = await client.state();
    // 0 during the preseason: /state/nfl counts preseason weeks in the same
    // field, and archiving those would publish a season of zeros.
    const current = currentWeek(state);
    if (current === 0) {
      console.log(
        `snapshot: season_type "${state.season_type}" — no real weeks to archive, ` +
          'rescoring whatever is already in data/raw',
      );
    }

    ({ slim: players, all: playersAll } = await refreshPlayers());

    [rosters, users, schedule, league] = await Promise.all([
      client.rosters(),
      client.users(),
      client.schedule(),
      client.league(),
    ]);

    // Fail here rather than three weeks into the loop, after wk{N}.json has
    // already been rewritten: scoreWeek would throw Object.entries(undefined)
    // deep inside slimWeek with nothing pointing at the cause.
    if (!league?.scoring_settings) {
      throw new Error(
        `league ${LEAGUE_ID} returned no scoring_settings; cannot score a week without it`,
      );
    }

    await writeFile(path.join(RAW, 'rosters.json'), JSON.stringify(rosters));
    await writeFile(path.join(RAW, 'users.json'), JSON.stringify(users));
    await writeFile(path.join(RAW, 'schedule.json'), JSON.stringify(schedule));
    await writeFile(path.join(RAW, 'state.json'), JSON.stringify(state));
    // Only the scoring map and the roster layout. The full league object
    // carries last_message_id and friends, which change whenever anyone
    // posts in the league chat, and the Action's blanket `git add data/`
    // would commit that churn for no reader.
    await writeFile(
      path.join(RAW, 'league.json'),
      JSON.stringify({
        scoring_settings: league.scoring_settings,
        roster_positions: league.roster_positions,
      }),
    );

    weekPayloads = {};
    opportunities = {};
    for (let w = 1; w <= current; w++) {
      const payload = await client.matchups(w);
      if (!Array.isArray(payload) || payload.length === 0) continue;
      weekPayloads[w] = payload;
      await writeFile(path.join(RAW, `wk${w}.json`), JSON.stringify(payload));

      const rawStats = await client.stats(w);

      // The penalty rule's archive: every id with a chance, straight off the
      // raw payload, ungated by gp or by the player map. See
      // archivedOpportunityIds for why it cannot come from the slim week.
      const ids = archivedOpportunityIds(rawStats);
      opportunities[w] = ids;
      await writeFile(path.join(RAW, `opps${w}.json`), JSON.stringify(ids));

      // The leaderboard's archive: the slim per-player line rather than the
      // ~570 KB raw payload — points, whether they played, whether they had a
      // chance. Built against playersAll so a player cut mid-season keeps the
      // games and the +20s he already earned.
      const slim = slimWeek(rawStats, playersAll, league.scoring_settings);
      slimWeeks[w] = slim;
      await writeFile(path.join(RAW, `stats${w}.json`), JSON.stringify(slim));
    }

    // The whole season's pairings, not just the played weeks: this is what
    // lets the Results tab show an upcoming schedule. At most 18 calls per
    // Action run, zero per page load.
    //
    // The played weeks are reused from the loop above rather than refetched.
    // Not because the client would cache them — it would not: sleeper.js
    // gates its cache on `now() - hit.at < minIntervalMs`, and the snapshot
    // constructs its client with minIntervalMs: 0, so that cache never hits.
    // The payload is already in hand, so ask for the unplayed weeks only.
    const schedulePayloads = {};
    for (let w = 1; w <= LAST_WEEK; w++) {
      schedulePayloads[w] = weekPayloads[w] ?? (await client.matchups(w).catch(() => []));
    }
    pairings = buildPairings(schedulePayloads);

    // Off-season: /state/nfl reports no real week, but a finished season is
    // still sitting in data/raw. Rescore the archive rather than publishing
    // an empty site over a completed 18 weeks.
    if (current === 0) {
      weekPayloads = await readRaw();
      slimWeeks = await readSlimWeeks();
      opportunities = await readOpps();
    }
  }

  const snap = buildSnapshot({
    rosters, users, schedule, players, weekPayloads, opportunities,
    state,
    rosterPositions: league?.roster_positions || [],
  });
  const now = new Date().toISOString();

  const s = await writeStamped(
    path.join(DATA, 'standings.json'),
    { ...snap.meta, standings: snap.standings },
    now,
  );
  const w = await writeStamped(path.join(DATA, 'weeks.json'), { weeks: snap.weeks }, now);

  // --replay has no network, so it must leave a good pairings.json alone
  // rather than overwrite it with nothing.
  if (pairings) {
    await writeStamped(path.join(DATA, 'pairings.json'), { pairings }, now);
  }

  // Unlike pairings.json, playersAll/rosters/weekPayloads are all in scope
  // on --replay too, so this one can and should be written every run.
  const rp = await writeStamped(
    path.join(DATA, 'roster-players.json'),
    { players: buildRosterPlayers(playersAll, rosters, weekPayloads) },
    now,
  );

  // playersAll, not players: a player cut mid-season drops out of the active
  // map, and naming him is most of the point of this board.
  const rows = buildSeasonLeaderboard(playersAll, slimWeeks);
  const lb = await writeStamped(
    path.join(DATA, `leaderboard-${SEASON}.json`),
    { season: SEASON, rows },
    now,
  );

  console.log(
    `snapshot: ${snap.weeks.filter((x) => x.played).length} played weeks, ` +
      `ghost roster ${snap.meta.ghostRosterId}, ` +
      `${rows.length} players on the ${SEASON} board, ` +
      (s.changed || w.changed || rp.changed || lb.changed ? 'content changed' : 'content unchanged'),
  );
}

/**
 * Pull players/nfl at most once a day and keep TWO maps on disk, both cut
 * from the same payload, so this still costs exactly one Sleeper call.
 *
 *   players-slim.json  active fantasy-position players (~179 KB). The
 *                      standings engine and the browser read this one, so it
 *                      stays as narrow as it has always been.
 *   players-all.json   the same map without the `active` filter (~236 KB).
 *                      Build-time only. A player cut mid-season goes inactive
 *                      on Sleeper, and without this his games and his +20s
 *                      would vanish from the leaderboard.
 *
 * @returns {Promise<{slim: Object, all: Object}>}
 */
export async function refreshPlayers(fetchImpl = fetch) {
  const slimPath = path.join(DATA, 'players-slim.json');
  const allPath = path.join(DATA, 'players-all.json');
  const stampPath = path.join(DATA, '.players-stamp');
  const today = new Date().toISOString().slice(0, 10);

  // Cached only when BOTH maps are present: a fresh stamp beside a missing
  // players-all.json would otherwise skip the fetch and never write it.
  const cached = async () => ({
    slim: JSON.parse(await readFile(slimPath, 'utf8')),
    all: existsSync(allPath)
      ? JSON.parse(await readFile(allPath, 'utf8'))
      : JSON.parse(await readFile(slimPath, 'utf8')),
  });

  if (existsSync(slimPath) && existsSync(allPath) && existsSync(stampPath)) {
    if ((await readFile(stampPath, 'utf8')).trim() === today) return cached();
  }

  let raw;
  try {
    const res = await fetchImpl(`${API_BASE}/v1/players/nfl`);
    if (!res.ok) throw new Error(`players/nfl ${res.status}`);
    raw = await res.json();
  } catch (e) {
    // Network failure (DNS, TLS, timeout) or a bad HTTP status: both are
    // recoverable as long as yesterday's maps are still on disk. A day-old
    // player map is still good enough to score a week, and it beats aborting
    // the whole run over one flaky endpoint, so degrade rather than abort.
    if (existsSync(slimPath)) return cached();
    throw e;
  }

  const slim = slimPlayers(raw);
  const all = slimForLeaderboard(raw);
  await writeFile(slimPath, JSON.stringify(slim));
  await writeFile(allPath, JSON.stringify(all));
  await writeFile(stampPath, today);
  return { slim, all };
}

// Only run when invoked directly, so the test can import the pure functions.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
