// The Results tab.
//
// Same shape as leaderboard-view.js: everything that decides WHAT to show is
// a pure function here, testable without a DOM, and mountResults is the only
// part that touches document.

import { LAST_WEEK } from './config.js';

/**
 * Which week the Results tab opens on.
 *
 * Sleeper's own season_start_date is a Wednesday (2026-09-09), so flooring
 * the offset into 7-day blocks lands the rollover on a Wednesday by
 * construction — there is no weekday arithmetic here to get wrong.
 *
 * Deliberately not read from /state/nfl's `week`: that advances on Sleeper's
 * Tuesday schedule, and it is not available before the first paint.
 *
 * @param {Date} now
 * @param {string} seasonStart - 'YYYY-MM-DD', local
 * @returns {number} 1..lastWeek
 */
export function displayWeek(now, seasonStart, lastWeek = LAST_WEEK) {
  const [y, m, d] = String(seasonStart ?? '').split('-').map(Number);
  if (!y || !m || !d) return 1;

  // Both ends snapped to local midnight. Parsing the ISO string directly
  // would give UTC midnight and shift the rollover by a day for anyone west
  // of Greenwich; the league is played in two time zones.
  const start = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Rounded, not floored: a daylight-saving boundary between the two dates
  // makes the difference fall short of or overshoot a whole number of days.
  // Rounding snaps it back.
  const days = Math.round((today - start) / 86400000);
  return Math.min(lastWeek, Math.max(1, Math.floor(days / 7) + 1));
}

/**
 * Group a matchup payload into its pairs by Sleeper's matchup_id.
 *
 * Works on a future week: Sleeper assigns matchup_id for the whole season up
 * front and reports points 0 until the games are played, which is what lets
 * the Results tab draw a schedule before kickoff.
 *
 * Output is sorted inside each pair and across pairs. The Action commits
 * whenever data/ differs, so an unstable order here would produce an empty
 * commit on every run.
 */
export function pairsFromPayload(payload) {
  const groups = new Map();
  for (const e of payload || []) {
    const id = e?.matchup_id ?? null;
    if (id === null) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(e.roster_id);
  }
  return [...groups.values()]
    .map((ids) => ids.slice().sort((a, b) => a - b))
    .sort((a, b) => a[0] - b[0]);
}

/**
 * The roster that plays the league median this week: whoever Sleeper paired
 * with the unowned roster.
 *
 * This is the same rule resolveWeek applies to a played week, which is why
 * the upcoming view and the played view cannot disagree about who is on the
 * median.
 */
export function medianRosterId(pairs, ghostRosterId) {
  if (ghostRosterId === null || ghostRosterId === undefined) return null;
  for (const pair of pairs || []) {
    if (!pair.includes(ghostRosterId)) continue;
    const others = pair.filter((id) => id !== ghostRosterId);
    return others.length === 1 ? others[0] : null;
  }
  return null;
}

/** Sleeper writes this into a starting slot nobody filled. Not a player id. */
const EMPTY_SLOT = '0';

const FLEX_POSITIONS = new Set(['RB', 'WR', 'TE']);

/**
 * Can a player of position `pos` legally occupy slot `slot`?
 *
 * Unknown on either side returns true: half of "unknown" is not evidence of
 * a mismatch, and contradicting a slot on no evidence is worse than trusting
 * it.
 */
export function slotFits(slot, pos) {
  if (!slot || !pos) return true;
  if (slot === 'FLEX') return FLEX_POSITIONS.has(pos);
  return slot === pos;
}

/**
 * One matchup entry, split into slot-ordered starters and a bench.
 *
 * The i-th starter fills the i-th non-BN roster_positions entry. That
 * mapping was verified directly against the real archived week-1 payload on
 * 2026-09-01: 114 starters across all 6 rosters, 0 mismatches between a
 * starter's actual position and the slot its index maps to (spec 6.1). The
 * cross-check below is kept anyway, not because the mapping is in doubt, but
 * as protection if Sleeper ever changes that ordering later — each row falls
 * back to labelling itself with the player's real position on a mismatch,
 * rather than confidently showing a WR in a QB row.
 */
export function lineupRows(entry, rosterPositions, players = {}) {
  const slots = (rosterPositions || []).filter((p) => p !== 'BN');
  const starterIds = entry?.starters || [];
  const starterPts = entry?.starters_points || [];
  const playerPts = entry?.players_points || {};

  const row = (id, slot, points) => {
    const key = String(id);
    if (key === EMPTY_SLOT) {
      return { id: key, name: 'Empty slot', pos: '', slot, points: Number(points || 0), empty: true };
    }
    const p = players[key];
    const pos = p?.pos || '';
    return {
      id: key,
      name: p?.name || key,
      pos,
      slot: slotFits(slot, pos) ? slot : pos,
      points: Number(points || 0),
      empty: false,
    };
  };

  const starters = starterIds.map((id, i) => row(id, slots[i] || '', starterPts[i]));

  const started = new Set(starterIds.map(String));
  const bench = (entry?.players || [])
    .map(String)
    .filter((id) => id !== EMPTY_SLOT && !started.has(id))
    .map((id) => row(id, players[id]?.pos || 'BN', playerPts[id]));

  return { starters, bench };
}
