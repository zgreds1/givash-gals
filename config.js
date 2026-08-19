// Single source of truth for league identity and scoring constants.
// Imported by the engine, the site, and the snapshot script.

export const LEAGUE_ID = '1395797781926408192';
export const SEASON = '2026';
export const API_BASE = 'https://api.sleeper.app';

/** Points added to a team's score for each starter that scores exactly zero. */
export const PENALTY = 20;

/** Float tolerance for "exactly zero". Sleeper reports 1-2 decimal places. */
export const EPS = 1e-9;

/** Last week the site covers. No playoff bracket — 15-18 are ordinary weeks. */
export const LAST_WEEK = 18;
