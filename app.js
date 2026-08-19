// Page controller. Paints the committed snapshot immediately, then
// re-fetches only the current week from Sleeper and recomputes.

import { createClient, currentWeek, findGhostRosterId, unownedRosterIds } from './sleeper.js';
import { byeTeams, resolveWeek, standings } from './rules.js';
import { renderStandings, renderResults, renderRules } from './render.js';

const state = { weeks: [], teams: {}, ghostRosterId: null, generatedAt: null, live: false };

const $ = (id) => document.getElementById(id);

async function json(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

/** Returns a warning string when the league is not in the shape the
 *  format assumes, or null when everything is normal. */
export function leagueWarning(ownedCount, ghostRosterId) {
  if (ownedCount === 0) return null; // no league data loaded; caller owns the error UI
  if (ghostRosterId === null) {
    return 'All six roster slots are owned. There is no median matchup this ' +
           'season — every week is three straight head-to-head games.';
  }
  if (ownedCount < 5) {
    return `Only ${ownedCount} of 5 managers have joined. Standings are on ` +
           'hold until the league is full.';
  }
  return null;
}

/**
 * Below 5 owned rosters the median is computed over the wrong population,
 * so there is no honest table to draw: the banner stands alone. Six owned
 * rosters is a different, still-scorable shape (three straight head-to-head
 * matchups) and keeps its tables.
 */
export function showTables(ownedCount) {
  return !(ownedCount > 0 && ownedCount < 5);
}

function paintBanner() {
  const msg = leagueWarning(Object.keys(state.teams).length, state.ghostRosterId);
  const el = $('banner');
  el.hidden = msg === null;
  el.textContent = msg || '';
}

function paint() {
  const owned = Object.keys(state.teams).length;
  if (showTables(owned)) {
    $('standings').innerHTML = renderStandings(standings(state.weeks), state.teams);
    $('results').innerHTML = renderResults(state.weeks, state.teams);
  } else {
    $('standings').innerHTML = '';
    $('results').innerHTML = '';
  }
  $('rules').innerHTML = renderRules();
  const when = state.generatedAt ? new Date(state.generatedAt).toLocaleString() : 'unknown';
  $('freshness').textContent = state.live
    ? 'Live · updated just now'
    : `Snapshot · as of ${when}`;
  $('freshness').className = state.live ? 'freshness live' : 'freshness';
  paintBanner();
}

async function loadSnapshot() {
  const [s, w] = await Promise.all([json('data/standings.json'), json('data/weeks.json')]);
  state.teams = s.teams || {};
  state.ghostRosterId = s.ghostRosterId ?? null;
  state.generatedAt = s.generatedAt;
  state.weeks = w.weeks || [];
  paint();
}

/**
 * Two Sleeper calls, and only two: /state/nfl and matchups/{week}.
 *
 * Rosters and the NFL schedule come from the committed snapshot instead.
 * The schedule endpoint is undocumented and immutable for the season, so
 * fetching it on every page load risks a 404 that would kill the live
 * refresh and buys nothing. Reading rosters from the same snapshot as the
 * team names also stops the page holding a fresh ghost id against a stale
 * name map.
 */
async function refreshLive() {
  const client = createClient();
  const [st, rosters, schedule, players] = await Promise.all([
    client.state(),
    json('data/raw/rosters.json'),
    json('data/raw/schedule.json'),
    json('data/players-slim.json'),
  ]);

  const week = currentWeek(st);
  if (week === 0) return; // preseason: nothing real to score yet

  state.ghostRosterId = findGhostRosterId(rosters) ?? state.ghostRosterId;
  const excluded = unownedRosterIds(rosters);
  const payload = await client.matchups(week);
  if (!Array.isArray(payload) || payload.length === 0) return;

  const fresh = resolveWeek(week, payload, excluded, byeTeams(schedule, week), players);
  if (!fresh.played || fresh.degenerate) return;

  state.weeks = state.weeks.filter((w) => w.week !== week).concat(fresh);
  state.weeks.sort((a, b) => a.week - b.week);
  state.live = true;
  paint();
}

function wireNav() {
  for (const btn of document.querySelectorAll('nav button')) {
    btn.addEventListener('click', () => {
      for (const b of document.querySelectorAll('nav button')) b.classList.remove('active');
      btn.classList.add('active');
      for (const v of document.querySelectorAll('.view')) v.hidden = true;
      $(btn.dataset.view).hidden = false;
    });
  }
}

if (typeof document !== 'undefined') {
  wireNav();
  let snapshotLoaded = true;
  loadSnapshot()
    .catch((e) => {
      snapshotLoaded = false;
      console.error(e);
      $('freshness').textContent = 'Could not load the snapshot.';
    })
    .then(() => {
      if (snapshotLoaded) return refreshLive();
    })
    .catch((e) => console.warn('live refresh failed, snapshot still shown', e));
}

export { loadSnapshot, refreshLive };
