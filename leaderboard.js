// Pure season aggregation: many weeks of stats in, one row per player out.
//
// Imported by scripts/build-leaderboard.mjs and scripts/snapshot.mjs. The
// browser never runs this — it reads the JSON those scripts emit.
//
// The engine takes SLIM weeks ({ id: { pts, gp, opp } }), not raw Sleeper
// stats. Raw payloads are converted once, by slimWeek, and that same slim
// shape is what gets archived to disk. One input shape means the live path
// and the replay path cannot drift apart.

import { EPS, PENALTY } from './config.js';
import { hadOpportunity, round2 } from './rules.js';

export const LEADERBOARD_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const POS_SET = new Set(LEADERBOARD_POSITIONS);

/**
 * Raw fantasy points for one player-week under the league's scoring map.
 *
 * @param {Object} stats - one player's week from Sleeper
 * @param {Object<string, number>} scoring - league scoring_settings
 * @returns {number}
 */
export function scoreWeek(stats, scoring) {
  let pts = 0;
  for (const [key, weight] of Object.entries(scoring)) {
    const v = stats[key];
    if (typeof v === 'number' && v !== 0 && weight) pts += v * weight;
  }
  return round2(pts);
}

/**
 * League adjustment for one player-week.
 *
 * played + exactly 0 -> +PENALTY, unless EITHER
 *   - a DEF (0 is a legitimate DEF score), or
 *   - the player had an opportunity: they were used and simply failed,
 *     which the format does not punish.
 * missed week (bye, ruled out, scratch) -> 0 + PENALTY, DEF included.
 *
 * @returns {{ adj: number, penalized: boolean }}
 */
export function adjustWeek(points, played, isDef, hadOpp) {
  if (!played) return { adj: PENALTY, penalized: true };
  if (Math.abs(points) < EPS && !isDef && !hadOpp) {
    return { adj: round2(points + PENALTY), penalized: true };
  }
  return { adj: round2(points), penalized: false };
}

/**
 * Reduce one raw weekly stats payload to what the leaderboard needs.
 *
 * Restricted to ids the player map can name, and to lines that actually
 * played. `pts` is the RAW score, before any penalty: keeping adjustment out
 * of the archive means changing PENALTY never invalidates a stored week.
 *
 * The `gp` gate answers "did this count as a game played", which is the
 * leaderboard's question. It is NOT the penalty rule's question — that one
 * asks only whether a chance existed, and is archived separately from the
 * raw payload (see scripts/snapshot.mjs). Do not conflate the two.
 *
 * @param {Object<string, Object>|null} weekStats
 * @param {Object<string, {pos: string, team: string, name: string}>} players
 * @param {Object<string, number>} scoring
 * @returns {Object<string, {pts: number, gp: number, opp: number}>}
 */
export function slimWeek(weekStats, players, scoring) {
  const out = {};
  for (const [id, s] of Object.entries(weekStats || {})) {
    if (!s || !players[id]) continue;
    if ((s.gp ?? 0) < 1) continue;
    out[id] = { pts: scoreWeek(s, scoring), gp: 1, opp: hadOpportunity(s) ? 1 : 0 };
  }
  return out;
}

/**
 * Slim the 14.6 MB players/nfl payload for leaderboard use.
 *
 * Unlike slimPlayers in scripts/snapshot.mjs this does NOT filter on
 * `active`. A player who retired after the season being built still played
 * that season, and dropping them would make history rot on every rebuild.
 *
 * @param {Object} rawPlayers - Sleeper /v1/players/nfl
 * @returns {Object<string, {pos: string, team: string, name: string}>}
 */
export function slimForLeaderboard(rawPlayers) {
  const out = {};
  for (const [id, p] of Object.entries(rawPlayers || {})) {
    if (!POS_SET.has(p.position)) continue;
    const name =
      p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || id;
    out[id] = { pos: p.position, team: p.team || '—', name };
  }
  return out;
}

/**
 * One row per player with at least one game played.
 *
 * total = "you started them every week": a missed week costs +PENALTY.
 * ppg   = adjusted points across played games only, divided by games played.
 *
 * @param {Object<string, {pos: string, team: string, name: string}>} players
 * @param {Array<Object<string, {pts: number, gp: number, opp: number}>>} weeks
 * @param {Array|null} savedLog - when supplied, one entry per zero-point week
 *   spared by the opportunity rule
 * @returns {Array<Object>} ascending by total — worst scorer first
 */
export function buildLeaderboard(players, weeks, savedLog = null) {
  const rows = [];

  for (const [id, p] of Object.entries(players)) {
    const isDef = p.pos === 'DEF';
    let gp = 0;
    let raw = 0;
    let adjPlayed = 0;
    let pen = 0;
    let truePen = 0; // penalties earned on the field: played and scored 0
    let saved = 0; // zero-point weeks spared by the opportunity rule
    let total = 0;

    for (let w = 0; w < weeks.length; w++) {
      const s = weeks[w][id];
      const played = !!s;
      const pts = played ? s.pts : 0;
      const opp = played && s.opp === 1;
      const { adj, penalized } = adjustWeek(pts, played, isDef, opp);
      total = round2(total + adj);
      if (penalized) pen += 1;
      if (!played) continue;

      gp += 1;
      raw = round2(raw + pts);
      adjPlayed = round2(adjPlayed + adj);
      if (penalized) truePen += 1;
      if (!penalized && !isDef && Math.abs(pts) < EPS && opp) {
        saved += 1;
        if (savedLog) {
          savedLog.push({ week: w + 1, id, name: p.name, pos: p.pos, team: p.team });
        }
      }
    }

    if (gp === 0) continue;

    rows.push({
      id,
      name: p.name,
      // players-slim.json carries team: null for unsigned players. The view
      // calls team.toLowerCase() when searching, so it must never be null.
      team: p.team || '—',
      pos: p.pos,
      gp,
      raw,
      pen,
      truePen,
      saved,
      total,
      ppg: round2(adjPlayed / gp),
    });
  }

  rows.sort((a, b) => a.total - b.total);
  return rows;
}
