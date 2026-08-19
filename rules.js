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
