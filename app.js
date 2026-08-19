// Page controller. Paints the committed snapshot immediately, then
// re-fetches only the current week from Sleeper and recomputes.

import { LAST_WEEK } from './config.js';
import { createClient, findGhostRosterId } from './sleeper.js';
import { byeTeams, resolveWeek, standings } from './rules.js';
import { renderStandings } from './render.js';

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

function paintBanner() {
  const msg = leagueWarning(Object.keys(state.teams).length, state.ghostRosterId);
  const el = $('banner');
  el.hidden = msg === null;
  el.textContent = msg || '';
}

function paint() {
  $('standings').innerHTML = renderStandings(standings(state.weeks), state.teams);
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

async function refreshLive() {
  const client = createClient();
  const [st, rosters, schedule, players] = await Promise.all([
    client.state(),
    client.rosters(),
    client.schedule(),
    json('data/players-slim.json'),
  ]);

  const week = Math.min(Number(st.week) || 1, LAST_WEEK);
  const ghost = findGhostRosterId(rosters) ?? state.ghostRosterId;
  const payload = await client.matchups(week);
  if (!Array.isArray(payload) || payload.length === 0) return;

  const fresh = resolveWeek(week, payload, ghost, byeTeams(schedule, week), players);
  if (!fresh.played) return;

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
  loadSnapshot()
    .catch((e) => {
      console.error(e);
      $('freshness').textContent = 'Could not load the snapshot.';
    })
    .then(() => refreshLive())
    .catch((e) => console.warn('live refresh failed, snapshot still shown', e));
}

export { loadSnapshot, refreshLive };
