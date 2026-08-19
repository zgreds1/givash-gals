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

/**
 * Resolve one week into matchup outcomes.
 *
 * The league runs 6 roster slots for 5 managers, so Sleeper schedules
 * three matchups and one of them contains the unowned ghost roster. The
 * real team in that pairing plays the league median instead of an
 * opponent. If Sleeper instead omits the ghost, the leftover real roster
 * (null matchup_id, or unpaired) is the median team.
 *
 * @param {number} week
 * @param {Array} matchups - raw Sleeper matchups/{week} payload
 * @param {number|null} ghostRosterId - roster with owner_id === null
 * @param {Set<string>} byes
 * @param {Object} players
 */
export function resolveWeek(week, matchups, ghostRosterId, byes, players) {
  const scored = matchups.map((m) => ({
    rosterId: m.roster_id,
    matchupId: m.matchup_id ?? null,
    ...adjustedScore(m, byes, players),
  }));

  const real = scored.filter((s) => s.rosterId !== ghostRosterId);

  const teams = {};
  for (const s of real) {
    teams[s.rosterId] = { raw: s.raw, adjusted: s.adjusted, penalties: s.penalties };
  }

  // Group by Sleeper's matchup_id, then strip the ghost out of each group.
  const groups = new Map();
  for (const s of scored) {
    if (s.matchupId === null) continue;
    if (!groups.has(s.matchupId)) groups.set(s.matchupId, []);
    groups.get(s.matchupId).push(s);
  }

  const h2hPairs = [];
  let medianTeam = null;
  for (const pair of groups.values()) {
    const reals = pair.filter((s) => s.rosterId !== ghostRosterId);
    if (reals.length === 2) h2hPairs.push(reals);
    else if (reals.length === 1) medianTeam = reals[0];
  }

  // Fallback: Sleeper omitted the ghost, so a real roster is unpaired.
  if (!medianTeam) {
    const paired = new Set(h2hPairs.flat().map((s) => s.rosterId));
    medianTeam = real.find((s) => !paired.has(s.rosterId)) || null;
  }

  const medianPool = h2hPairs
    .flat()
    .map((s) => s.adjusted)
    .sort((a, b) => b - a);

  const median = medianPool.length === 4 ? round2((medianPool[1] + medianPool[2]) / 2) : null;

  const out = [];
  for (const [a, b] of h2hPairs) {
    let winner = null;
    if (a.adjusted < b.adjusted) winner = a.rosterId;
    else if (b.adjusted < a.adjusted) winner = b.rosterId;
    out.push({ type: 'h2h', rosterIds: [a.rosterId, b.rosterId], winner });
  }

  if (medianTeam) {
    let result = 'T';
    if (median !== null) {
      if (medianTeam.adjusted < median) result = 'W';
      else if (medianTeam.adjusted > median) result = 'L';
    }
    out.push({ type: 'median', rosterId: medianTeam.rosterId, line: median, result });
  }

  return {
    week,
    played: real.some((s) => Math.abs(s.raw) >= EPS),
    median,
    medianPool,
    teams,
    matchups: out,
  };
}
