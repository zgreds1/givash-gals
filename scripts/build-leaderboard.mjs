#!/usr/bin/env node
// Builds data/leaderboard-{season}.json: one row per player, scored under
// THIS league's current settings, sorted ascending — worst scorer first.
//
//   node scripts/build-leaderboard.mjs --season 2025
//   node scripts/build-leaderboard.mjs --season 2025 --refresh
//   node scripts/build-leaderboard.mjs --season 2025 --saved-log out.json
//
// The per-week cache under data/raw-{season}/ is ~23 MB and is NOT committed;
// it exists so a rebuild costs no network. --refresh drops it.
//
// The current season is written by scripts/snapshot.mjs on every Action run,
// so this script is only for frozen history.

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { API_BASE, LEAGUE_ID } from '../config.js';
import { round2 } from '../rules.js';
import {
  buildLeaderboard,
  scoreWeek,
  slimForLeaderboard,
  slimWeek,
} from '../leaderboard.js';
import { writeStamped } from './snapshot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEEKS = 18;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

async function cachedFetch(cache, name, url) {
  const file = path.join(cache, name);
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const data = await res.json();
  await writeFile(file, JSON.stringify(data));
  return data;
}

/**
 * Sanity check: our multiplication vs Sleeper's own pts_std for week 1,
 * restricted to QB/RB/WR/TE lines the STD map fully covers (no kicking,
 * defensive, or special-teams stats — Sleeper's std includes keys for those
 * that this deliberately-minimal map omits).
 */
function sanityCheck(week1, players) {
  const STD = {
    pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2,
    rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
    rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
    fum_lost: -2,
  };
  const SKILL = new Set(['QB', 'RB', 'WR', 'TE']);
  let n = 0;
  let close = 0;
  let worst = 0;
  for (const [pid, s] of Object.entries(week1)) {
    if (!s.gp || typeof s.pts_std !== 'number') continue;
    if (!SKILL.has(players[pid]?.pos)) continue;
    if (s.st_ff || s.st_fum_rec || s.st_td || s.fum_rec_td || s.xpm || s.fgm) continue;
    const mine = scoreWeek(s, STD);
    const delta = Math.abs(mine - s.pts_std);
    n += 1;
    if (delta < 0.05) close += 1;
    if (delta > worst) worst = delta;
  }
  console.log(
    `sanity: ${close}/${n} skill players within 0.05 of Sleeper's pts_std ` +
      `(worst delta ${round2(worst)})`,
  );
  if (close < n) {
    throw new Error('sanity check failed: engine disagrees with Sleeper on covered lines');
  }
}

async function main() {
  const season = arg('--season');
  if (!season) throw new Error('usage: build-leaderboard.mjs --season <year>');

  const cache = path.join(ROOT, 'data', `raw-${season}`);
  if (process.argv.includes('--refresh')) await rm(cache, { recursive: true, force: true });
  await mkdir(cache, { recursive: true });

  const league = await cachedFetch(cache, 'league.json', `${API_BASE}/v1/league/${LEAGUE_ID}`);
  const rawPlayers = await cachedFetch(cache, 'players.json', `${API_BASE}/v1/players/nfl`);
  const players = slimForLeaderboard(rawPlayers);

  const weeks = [];
  for (let w = 1; w <= WEEKS; w++) {
    const stats = await cachedFetch(
      cache,
      `wk${w}.json`,
      `${API_BASE}/v1/stats/nfl/regular/${season}/${w}`,
    );
    if (w === 1) sanityCheck(stats, players);
    weeks.push(slimWeek(stats, players, league.scoring_settings));
    process.stdout.write(`\rweek ${w}/${WEEKS}   `);
  }
  console.log();

  const savedLogPath = arg('--saved-log');
  const savedLog = savedLogPath ? [] : null;
  const rows = buildLeaderboard(players, weeks, savedLog);

  const out = path.join(ROOT, 'data', `leaderboard-${season}.json`);
  const { changed } = await writeStamped(out, { season, rows }, new Date().toISOString());
  console.log(`${rows.length} players -> ${out} (${changed ? 'changed' : 'unchanged'})`);

  if (savedLogPath) {
    await writeFile(savedLogPath, JSON.stringify(savedLog, null, 1));
    console.log(`opportunity rule applied ${savedLog.length} times -> ${savedLogPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
