// The URL is the view.
//
// Pure: a hash string in, an object out, or the reverse. No DOM, no listener,
// no reading of `location` — the caller owns all of that.
//
// Hash rather than paths because the site is static on GitHub Pages, where a
// direct request for /results/week/3 is a 404 unless a redirect shim is
// committed alongside. A hash never reaches the server at all.

import { LAST_WEEK } from './config.js';

const TABS = ['results', 'standings', 'players', 'rules'];

/** The view an empty, unknown or malformed hash resolves to. */
const DEFAULT_ROUTE = { tab: 'results', week: null, matchup: null };

const isIndex = (s) => /^\d+$/.test(s);

/**
 * Parse a location hash into the view it names.
 *
 * Anything unreadable resolves to the default view rather than throwing: a
 * hand-edited or truncated URL must never blank the page. Out-of-range weeks
 * are REFUSED, not clamped — clamping would silently show week 18 to someone
 * who asked for week 40, a confidently wrong answer where falling back to the
 * default week is merely an unhelpful one.
 *
 * @param {string} hash - e.g. '#/results/week/3/matchup/1'
 * @returns {{tab:string, week:number|null, matchup:number|null}}
 */
export function parseHash(hash) {
  const parts = String(hash ?? '').replace(/^#\/?/, '').split('/').filter(Boolean);

  const tab = parts[0];
  if (!TABS.includes(tab)) return { ...DEFAULT_ROUTE };
  if (tab !== 'results') return { tab, week: null, matchup: null };

  let week = null;
  if (parts[1] === 'week' && isIndex(parts[2])) {
    const n = Number(parts[2]);
    if (n >= 1 && n <= LAST_WEEK) week = n;
  }

  // A matchup is an index into a specific week's matchups, so it cannot be
  // addressed without one. `#/results/matchup/1` names nothing.
  let matchup = null;
  if (week !== null && parts[3] === 'matchup' && isIndex(parts[4])) {
    matchup = Number(parts[4]);
  }

  return { tab, week, matchup };
}

/**
 * Format a view as the shortest hash that names it.
 *
 * Shortest matters: `#/results` and `#/results/week/1` would be different
 * history entries for what may be the same screen, so the default week is
 * expressed by its ABSENCE rather than by a number that could disagree with
 * whatever the season calendar computes.
 */
export function formatHash(view = {}) {
  const { tab, week = null, matchup = null } = view;
  const t = TABS.includes(tab) ? tab : 'results';

  if (t !== 'results' || week === null) return `#/${t}`;
  const base = `#/results/week/${week}`;
  return matchup === null ? base : `${base}/matchup/${matchup}`;
}
