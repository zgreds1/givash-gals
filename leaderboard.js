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
 * The fantasy position a Sleeper player record plays at, or null.
 *
 * `position` is the NFL position, and for some players it is not a fantasy
 * one: Sleeper lists Hunter Luepke as `FB` with `fantasy_positions: ['RB']`.
 * Filtering on `position` alone drops him from every player map, and a
 * started player missing from the map is scored as an inactive zero - a
 * settled +20 before his game has even kicked off.
 *
 * @param {Object} p - one raw Sleeper player record
 * @returns {string|null}
 */
export function fantasyPosition(p) {
  if (POS_SET.has(p?.position)) return p.position;
  return (p?.fantasy_positions || []).find((f) => POS_SET.has(f)) || null;
}

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
    const pos = fantasyPosition(p);
    if (!pos) continue;
    const name =
      p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || id;
    out[id] = { pos, team: p.team || '—', name };
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
 * @param {Array<Map<string, 'final'|'live'|'upcoming'>>|null} phases - one
 *   gameStates() map per week, parallel to `weeks`. Omit it and every missed
 *   week charges, which is what the frozen 2025 archive wants.
 * @returns {Array<Object>} ascending by total — worst scorer first
 */
export function buildLeaderboard(players, weeks, savedLog = null, phases = null) {
  const rows = [];

  // Whether a whole week has finished, which is the only thing a player with
  // no fixture of his own can wait on. Computed once per week rather than per
  // player-week: 32 teams against 500-odd rows.
  //
  // A week with NO phase information — no schedule at all, or one predating
  // `status` — reads as finished. That is the same permissive reading
  // gameStates' other callers take of a missing status, and it is what keeps
  // a frozen season rescoring to the numbers it has always had.
  const weekSettled = weeks.map((_, w) => {
    const m = phases?.[w];
    if (!m) return true;
    for (const phase of m.values()) if (phase !== 'final') return false;
    return true;
  });

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
      // A missed week is only charged once there is nothing left to wait for.
      // Until then it counts toward NOTHING — not games played, not raw, not
      // a +20 — which is the stance RULES.md already takes on a starter whose
      // game is yet to start.
      //
      // Without this the snapshot's in-progress week, archived empty because
      // no game has produced a stat line yet, reads as 32 teams' worth of
      // absence: on 2026-09-22 all 517 rows carried a phantom +20 with every
      // week-3 fixture still `pre_game`. The uniform shift left the ORDER
      // untouched, which is why it survived; a Friday, with Thursday's
      // players scored and everyone else not, would have moved the ranking.
      //
      // Two different waits, because there are two ways to have no stat line:
      //   'upcoming'  his own game has not kicked off -> wait for that game
      //   no fixture  a bye, or no NFL team at all    -> wait for the WEEK
      // Nothing of a bye's is ever going to start, so the week finishing is
      // the only event that can settle it. A player absent from a game that
      // is under way ('live') or over ('final') is charged: his team took the
      // field without him.
      if (!played) {
        const phase = phases?.[w]?.get(p.team);
        if (phase === 'upcoming') continue;
        if (phase === undefined && !weekSettled[w]) continue;
      }
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
