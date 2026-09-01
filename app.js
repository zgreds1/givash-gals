// Page controller. Paints the committed snapshot immediately, then
// re-fetches only the current week from Sleeper and recomputes.

import { createClient, currentWeek, findGhostRosterId, unownedRosterIds } from './sleeper.js';
import { byeTeams, resolveWeek, standings, opportunitySet } from './rules.js';
import { renderStandings, renderRules } from './render.js';
import { mountLeaderboard } from './leaderboard-view.js';
import { mountResults } from './results-view.js';

const state = {
  weeks: [], teams: {}, ghostRosterId: null, generatedAt: null, live: false,
  livePayloads: {}, seasonStart: null, rosterPositions: [],
};

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
  } else {
    $('standings').innerHTML = '';
  }
  $('rules').innerHTML = renderRules();
  // Only the live badge earns header space. The snapshot's timestamp used to
  // sit here, but writeStamped deliberately keeps the old stamp when nothing
  // substantive changed — so a correct, current page would advertise a date
  // over a week old and read as broken. Silence is the honest default; the
  // element stays for the live badge and for load errors.
  $('freshness').textContent = state.live ? 'Live · updated just now' : '';
  $('freshness').className = state.live ? 'freshness live' : 'freshness';
  $('freshness').hidden = !state.live;
  paintBanner();
}

async function loadSnapshot() {
  const [s, w] = await Promise.all([json('data/standings.json'), json('data/weeks.json')]);
  state.teams = s.teams || {};
  state.ghostRosterId = s.ghostRosterId ?? null;
  state.generatedAt = s.generatedAt;
  state.weeks = w.weeks || [];
  state.seasonStart = s.seasonStart ?? null;
  state.rosterPositions = s.rosterPositions || [];
  paint();
}

/**
 * Three Sleeper calls, and only three: /state/nfl, matchups/{week}, and
 * stats/{week}. The stats call is what makes the opportunity rule live —
 * without it the page would show a +20 for a player who has already caught a
 * pass this afternoon — and it degrades to {} rather than failing the refresh.
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
  // Opportunity stats must be live: a stale set would show a +20 for a player
  // who has already caught a pass this afternoon.
  const [payload, weekStats] = await Promise.all([
    client.matchups(week),
    client.stats(week).catch(() => ({})),
  ]);
  if (!Array.isArray(payload) || payload.length === 0) return;

  // Kept, not discarded: the Results detail for the live week reads this
  // instead of re-fetching data/raw/wk{N}.json, which the Action may not
  // have written yet anyway.
  state.livePayloads[week] = payload;

  const fresh = resolveWeek(
    week,
    payload,
    excluded,
    byeTeams(schedule, week),
    players,
    opportunitySet(weekStats),
  );
  if (!fresh.played || fresh.degenerate) return;

  state.weeks = state.weeks.filter((w) => w.week !== week).concat(fresh);
  state.weeks.sort((a, b) => a.week - b.week);
  state.live = true;
  paint();
}

function wireNav() {
  let playersMounted = false;
  let resultsMounted = false;
  const buttons = [...document.querySelectorAll('nav button')];

  // role="tablist" promises arrow-key movement between tabs. Every tab stays
  // in the tab order (manual activation), so this only adds the arrows.
  const arrows = { ArrowLeft: -1, ArrowRight: 1, Home: 'first', End: 'last' };
  for (const [i, btn] of buttons.entries()) {
    btn.addEventListener('keydown', (e) => {
      const move = arrows[e.key];
      if (move === undefined) return;
      e.preventDefault();
      const next =
        move === 'first' ? 0
        : move === 'last' ? buttons.length - 1
        : (i + move + buttons.length) % buttons.length;
      buttons[next].focus();
    });
  }

  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      for (const b of document.querySelectorAll('nav button')) {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      }
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      for (const v of document.querySelectorAll('.view')) v.hidden = true;
      $(btn.dataset.view).hidden = false;

      // The leaderboard costs a roster call and two JSON fetches, so it is
      // built the first time it is asked for and never again.
      if (btn.dataset.view === 'players' && !playersMounted) {
        playersMounted = true;
        mountLeaderboard($('players'), { teams: state.teams }).catch((e) => {
          console.error(e);
          $('players').innerHTML = '<p class="empty">Could not load the leaderboard.</p>';
        });
      }

      // Mounted lazily, like the leaderboard above: a visitor who never
      // opens Results downloads neither pairings.json nor
      // roster-players.json.
      if (btn.dataset.view === 'results' && !resultsMounted) {
        resultsMounted = true;
        mountResults($('results'), state).catch((e) => {
          console.error(e);
          $('results').innerHTML = '<p class="empty">Could not load the results.</p>';
        });
      }
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
      $('freshness').hidden = false;
      $('freshness').textContent = 'Could not load the snapshot.';
    })
    .then(() => {
      if (snapshotLoaded) return refreshLive();
    })
    .catch((e) => console.warn('live refresh failed, snapshot still shown', e));
}

export { loadSnapshot, refreshLive };
