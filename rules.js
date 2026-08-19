// Pure league-rules engine. No I/O, no DOM, no clock.
// Imported unchanged by the browser and by scripts/snapshot.mjs.

import { PENALTY, EPS } from './config.js';

/** Round to 2 decimals. Tie detection relies on exact equality, so all
 *  scores are rounded before they are ever compared. */
export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * NFL teams idle in a given week.
 * A team is on bye if it appears in no game for that week.
 * @param {Array<{week:number, home:string, away:string}>} schedule
 * @param {number} week
 * @returns {Set<string>}
 */
export function byeTeams(schedule, week) {
  const all = new Set();
  const playing = new Set();
  for (const g of schedule) {
    all.add(g.home);
    all.add(g.away);
    if (g.week === week) {
      playing.add(g.home);
      playing.add(g.away);
    }
  }
  const byes = new Set();
  for (const t of all) if (!playing.has(t)) byes.add(t);
  return byes;
}

/**
 * A team's adjusted score: raw starter points plus PENALTY for each
 * starter that scored exactly zero.
 *
 * Exactly one exception: a DEF whose NFL team is NOT on bye is exempt,
 * because 0 is a legitimate defensive outcome under this league's
 * scoring settings (pts_allow_21_27 is 0.0).
 *
 * Negative scores pass through untouched — in a lowest-wins format a
 * negative is a reward, and this penalty exists to punish absent
 * lineups, not good ones.
 *
 * @param {{starters:string[], starters_points:number[]}} entry
 * @param {Set<string>} byes - NFL teams on bye this week
 * @param {Object<string,{pos:string,team:string,name:string}>} players
 */
export function adjustedScore(entry, byes, players) {
  const starters = entry.starters || [];
  const points = entry.starters_points || [];
  const penalties = [];
  let raw = 0;

  for (let i = 0; i < starters.length; i++) {
    const id = starters[i];
    const pts = points[i] ?? 0;
    raw += pts;

    if (Math.abs(pts) >= EPS) continue; // scored something, no penalty

    if (!id || id === '0') {
      penalties.push({ playerId: null, name: 'Empty slot', reason: 'empty-slot' });
      continue;
    }

    const meta = players[id];
    if (meta && meta.pos === 'DEF') {
      if (byes.has(meta.team)) {
        penalties.push({ playerId: id, name: meta.name, reason: 'bye-def' });
      }
      continue; // DEF not on bye: exempt
    }

    penalties.push({
      playerId: id,
      name: meta ? meta.name : `Unknown (${id})`,
      reason: 'zeroed',
    });
  }

  return {
    raw: round2(raw),
    adjusted: round2(raw + penalties.length * PENALTY),
    penalties,
  };
}
