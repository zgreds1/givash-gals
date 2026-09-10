// Shared fixtures. Player IDs and bye weeks are real values from the
// Sleeper API, captured 2026-08-19.

/**
 * Build a Sleeper matchup entry.
 * @param {number} rosterId
 * @param {number|null} matchupId
 * @param {Array<[string, number]>} pairs - [playerId, points] per starter
 */
export function mkEntry(rosterId, matchupId, pairs) {
  return {
    roster_id: rosterId,
    matchup_id: matchupId,
    starters: pairs.map((p) => p[0]),
    starters_points: pairs.map((p) => p[1]),
    points: pairs.reduce((a, p) => a + p[1], 0),
  };
}

/** Slim player map, same shape the snapshot script emits. */
export const PLAYERS = {
  6804: { pos: 'QB', team: 'CIN', name: 'Joe Burrow' },
  8205: { pos: 'RB', team: 'ATL', name: 'Bijan Robinson' },
  4199: { pos: 'WR', team: 'MIN', name: 'Justin Jefferson' },
  1466: { pos: 'K', team: 'BUF', name: 'Tyler Bass' },
  HOU: { pos: 'DEF', team: 'HOU', name: 'Houston Texans' },
  KC: { pos: 'DEF', team: 'KC', name: 'Kansas City Chiefs' },
};

/**
 * Minimal 4-team schedule across 3 weeks.
 * KC sits out week 5; HOU sits out week 8. Everyone plays week 3.
 */
export const SCHEDULE = [
  { week: 3, home: 'HOU', away: 'CIN' },
  { week: 3, home: 'KC', away: 'MIN' },
  { week: 5, home: 'HOU', away: 'CIN' },
  { week: 8, home: 'KC', away: 'MIN' },
];

/**
 * The same 4-team weeks as SCHEDULE, with per-game status.
 * Week 3: HOU/CIN done, KC/MIN still playing. Week 5: not started.
 * Week 8: KC/MIN carries an unrecognised status on purpose.
 */
export const SCHEDULE_LIVE = [
  { week: 3, home: 'HOU', away: 'CIN', status: 'complete' },
  { week: 3, home: 'KC', away: 'MIN', status: 'in_game' },
  { week: 5, home: 'HOU', away: 'CIN', status: 'pre_game' },
  { week: 8, home: 'KC', away: 'MIN', status: 'halftime' },
];
