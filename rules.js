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
 * Every excluded roster is stripped before anything is computed, so an
 * under-filled league never contributes an unowned score to the median.
 *
 * The format only resolves when the payload reduces to exactly two
 * head-to-head pairs plus at most one leftover. Anything else — Sleeper's
 * own playoff bracket from week 15, or too few owned rosters — is reported
 * as `degenerate: true` with **no** matchups at all. Emitting a partial
 * week would invent records out of a payload we cannot read.
 *
 * @param {number} week
 * @param {Array} matchups - raw Sleeper matchups/{week} payload
 * @param {Set<number>} excludedRosterIds - every roster with no owner
 * @param {Set<string>} byes
 * @param {Object} players
 */
export function resolveWeek(week, matchups, excludedRosterIds, byes, players) {
  const excluded = excludedRosterIds ?? new Set();

  const scored = matchups.map((m) => ({
    rosterId: m.roster_id,
    matchupId: m.matchup_id ?? null,
    ...adjustedScore(m, byes, players),
  }));

  const real = scored.filter((s) => !excluded.has(s.rosterId));

  const teams = {};
  for (const s of real) {
    teams[s.rosterId] = { raw: s.raw, adjusted: s.adjusted, penalties: s.penalties };
  }

  // Group by Sleeper's matchup_id, then strip excluded rosters from each group.
  const groups = new Map();
  for (const s of scored) {
    if (s.matchupId === null) continue;
    if (!groups.has(s.matchupId)) groups.set(s.matchupId, []);
    groups.get(s.matchupId).push(s);
  }

  const h2hPairs = [];
  const medianCandidates = [];
  let oversizedGroup = false;
  for (const pair of groups.values()) {
    const reals = pair.filter((s) => !excluded.has(s.rosterId));
    if (reals.length === 2) h2hPairs.push(reals);
    else if (reals.length === 1) medianCandidates.push(reals[0]);
    else if (reals.length > 2) oversizedGroup = true;
    // reals.length === 0: a group of excluded rosters only — nothing to score.
  }

  // Fallback: Sleeper omitted the ghost, so a real roster is unpaired.
  let leftovers = [];
  if (medianCandidates.length === 0) {
    const paired = new Set(h2hPairs.flat().map((s) => s.rosterId));
    leftovers = real.filter((s) => !paired.has(s.rosterId));
  }

  const candidates = medianCandidates.length ? medianCandidates : leftovers;
  const medianTeam = candidates.length === 1 ? candidates[0] : null;

  const degenerate = h2hPairs.length !== 2 || candidates.length > 1 || oversizedGroup;

  const medianPool = h2hPairs
    .flat()
    .map((s) => s.adjusted)
    .sort((a, b) => b - a);

  const median = medianPool.length === 4 ? round2((medianPool[1] + medianPool[2]) / 2) : null;

  const out = [];
  if (!degenerate) {
    for (const [a, b] of h2hPairs) {
      let winner = null;
      if (a.adjusted < b.adjusted) winner = a.rosterId;
      else if (b.adjusted < a.adjusted) winner = b.rosterId;
      out.push({ type: 'h2h', rosterIds: [a.rosterId, b.rosterId], winner });
    }

    // A median matchup without a line is not a matchup. Never award the
    // half-win a missing line would otherwise imply.
    if (medianTeam && median !== null) {
      let result = 'T';
      if (medianTeam.adjusted < median) result = 'W';
      else if (medianTeam.adjusted > median) result = 'L';
      out.push({ type: 'median', rosterId: medianTeam.rosterId, line: median, result });
    }
  }

  return {
    week,
    played: real.some((s) => Math.abs(s.raw) >= EPS),
    degenerate,
    median,
    medianPool,
    teams,
    matchups: out,
  };
}

/**
 * Season standings from resolved weeks.
 *
 * Sort order: win% descending, then adjusted points-for ASCENDING (lower
 * is better in this format), then head-to-head among the tied teams.
 * Teams that none of those separate are flagged rather than ordered by
 * accident.
 *
 * @param {WeekResult[]} weeks
 */
export function standings(weeks) {
  const rows = new Map();
  const ensure = (id) => {
    if (!rows.has(id)) {
      rows.set(id, {
        rosterId: id, w: 0, l: 0, t: 0, gp: 0,
        adjPF: 0, rawPF: 0,
        median: { w: 0, l: 0, t: 0 },
        unresolvedTie: false,
      });
    }
    return rows.get(id);
  };

  // rosterId -> opponentId -> {w,l,t}, used only for the H2H tiebreak
  const h2h = new Map();
  const noteH2H = (a, b, outcome) => {
    if (!h2h.has(a)) h2h.set(a, new Map());
    const m = h2h.get(a);
    if (!m.has(b)) m.set(b, { w: 0, l: 0, t: 0 });
    m.get(b)[outcome] += 1;
  };

  for (const wk of weeks) {
    // A degenerate week has no matchups, but its `teams` map is still
    // populated. Skipping it wholesale is what keeps adjusted points-for
    // from accruing for a week that was never actually resolved.
    if (!wk.played || wk.degenerate) continue;

    for (const [id, t] of Object.entries(wk.teams)) {
      const r = ensure(Number(id));
      r.adjPF = round2(r.adjPF + t.adjusted);
      r.rawPF = round2(r.rawPF + t.raw);
    }

    for (const m of wk.matchups) {
      if (m.type === 'h2h') {
        const [a, b] = m.rosterIds;
        const ra = ensure(a);
        const rb = ensure(b);
        ra.gp += 1;
        rb.gp += 1;
        if (m.winner === null) {
          ra.t += 1; rb.t += 1;
          noteH2H(a, b, 't'); noteH2H(b, a, 't');
        } else {
          const loser = m.winner === a ? b : a;
          (m.winner === a ? ra : rb).w += 1;
          (m.winner === a ? rb : ra).l += 1;
          noteH2H(m.winner, loser, 'w');
          noteH2H(loser, m.winner, 'l');
        }
      } else {
        const r = ensure(m.rosterId);
        r.gp += 1;
        if (m.result === 'W') { r.w += 1; r.median.w += 1; }
        else if (m.result === 'L') { r.l += 1; r.median.l += 1; }
        else { r.t += 1; r.median.t += 1; }
      }
    }
  }

  const list = [...rows.values()].map((r) => ({
    ...r,
    // Deliberately not rounded: the table prints three decimals, and a
    // 2-decimal value would render 2-1 as .670 instead of .667. Equal
    // records produce bit-identical quotients, so equality still holds.
    winPct: r.gp === 0 ? 0 : (r.w + 0.5 * r.t) / r.gp,
  }));

  const h2hPct = (a, b) => {
    const rec = h2h.get(a)?.get(b);
    if (!rec) return null;
    const g = rec.w + rec.l + rec.t;
    return g === 0 ? null : (rec.w + 0.5 * rec.t) / g;
  };

  list.sort((a, b) => {
    if (b.winPct !== a.winPct) return b.winPct - a.winPct;
    if (a.adjPF !== b.adjPF) return a.adjPF - b.adjPF; // lower is better
    const pa = h2hPct(a.rosterId, b.rosterId);
    const pb = h2hPct(b.rosterId, a.rosterId);
    if (pa !== null && pb !== null && pa !== pb) return pb - pa;
    return 0;
  });

  // Flag teams in equivalence classes. Partition by winPct and adjPF. A team
  // is flagged if there exists at least one OTHER team in its class that
  // head-to-head does not separate it from.
  const classes = new Map();
  for (const row of list) {
    const key = `${row.winPct}:${row.adjPF}`;
    if (!classes.has(key)) classes.set(key, []);
    classes.get(key).push(row);
  }

  for (const members of classes.values()) {
    if (members.length < 2) continue; // No tie possible in a class of 1

    // For each team in this class, check if it has any unresolved peer
    for (const a of members) {
      const unresolved = members.some((b) => {
        if (b === a) return false;
        const pa = h2hPct(a.rosterId, b.rosterId);
        const pb = h2hPct(b.rosterId, a.rosterId);
        const h2hSeparates = pa !== null && pb !== null && pa !== pb;
        return !h2hSeparates;
      });
      if (unresolved) {
        a.unresolvedTie = true;
      }
    }
  }

  return list;
}
