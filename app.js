// Page controller. Paints the committed snapshot immediately, then
// re-fetches only the current week from Sleeper and recomputes.

import { LAST_WEEK } from './config.js';
import { createClient, currentWeek, findGhostRosterId, unownedRosterIds } from './sleeper.js';
import { byeTeams, resolveWeek, standings, opportunitySet, gameStates } from './rules.js';
import { finalWeeks, gateLabel } from './season.js';
import { renderStandings, renderRules } from './render.js';
import { mountLeaderboard } from './leaderboard-view.js';
import { mountResults } from './results-view.js';

const state = {
  weeks: [], teams: {}, ghostRosterId: null, generatedAt: null, live: false,
  livePayloads: {}, seasonStart: null, rosterPositions: [], schedule: null,
};

// Set once mountResults resolves. Lets paint() push a redraw into an
// already-mounted Results tab when refreshLive() changes state under it,
// instead of only fixing the next click.
let resultsRepaint = null;

const $ = (id) => document.getElementById(id);

// Results is the landing tab, so it is mounted at startup rather than on first
// click. Idempotent, because wireNav still calls it: if the snapshot fetch
// failed, startup skips the mount and the first click is what recovers it.
let resultsMounted = false;
function mountResultsTab() {
  if (resultsMounted) return Promise.resolve();
  resultsMounted = true;
  return mountResults($('results'), state)
    .then(({ repaint }) => { resultsRepaint = repaint; })
    .catch((e) => {
      console.error(e);
      $('results').innerHTML = '<p class="empty">Could not load the results.</p>';
    });
}

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
    // Only settled weeks reach standings(). Results keeps showing live numbers
    // — separating the two is the whole point of the gate.
    const settled = finalWeeks(state.weeks, state.seasonStart, new Date());
    const through = settled.length ? Math.max(...settled.map((w) => w.week)) : null;
    const nextWeek = through === null ? 1 : through + 1;
    $('standings').innerHTML = renderStandings(standings(settled), state.teams, {
      through,
      nextWeek: nextWeek <= LAST_WEEK ? nextWeek : null,
      nextGate: nextWeek <= LAST_WEEK ? gateLabel(nextWeek, state.seasonStart) : null,
    });
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
  // Delegates to the mounted view's own repaint rather than touching
  // $('results') directly, which would wipe whatever it is showing.
  resultsRepaint?.();
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
 * Four Sleeper calls, and only four: /state/nfl, matchups/{week},
 * stats/{week}, and schedule/nfl/regular/{season}. The stats call is what
 * makes the opportunity rule live — without it the page would show a +20 for
 * a player who has already caught a pass this afternoon — and it degrades to
 * {} rather than failing the refresh. The schedule call is what makes the
 * phased +20 live at all; see the comment at its call site below for why it
 * is fetched now instead of read only from the committed copy, and what it
 * falls back to when it fails.
 *
 * Rosters still come from the committed snapshot. Reading them from the same
 * snapshot as the team names stops the page holding a fresh ghost id against
 * a stale name map.
 */
async function refreshLive() {
  const client = createClient();
  const [st, rosters, schedule, players] = await Promise.all([
    client.state(),
    json('data/raw/rosters.json'),
    // The schedule's FIXTURES are immutable for the season, but its `status`
    // field is not — and status is the only live source for whether a player's
    // game has finished, which is what gates every +20. Checked 2026-09-10: the
    // committed snapshot read 272 pre_game while the endpoint read 271 pre_game
    // and 1 complete. Falls back to the committed copy, whose fixtures are
    // still correct for the bye rule even when its statuses are stale.
    client.schedule().catch(() => json('data/raw/schedule.json')),
    json('data/players-slim.json'),
  ]);

  const week = currentWeek(st);
  if (week === 0) return; // preseason: nothing real to score yet

  // Kept on state so mountResults can decide whether a card is settled without
  // fetching the schedule a second time.
  state.schedule = schedule;

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
    gameStates(schedule, week),
  );
  if (!fresh.played || fresh.degenerate) return;

  state.weeks = state.weeks.filter((w) => w.week !== week).concat(fresh);
  state.weeks.sort((a, b) => a.week - b.week);
  state.live = true;
  paint();
}

function wireNav() {
  let playersMounted = false;
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

      if (btn.dataset.view === 'results') mountResultsTab();
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
      // After loadSnapshot, never before: mounting first would paint "not
      // published by Sleeper yet" against an empty state.weeks and then repaint
      // — a visible flash on the page's own front door.
      if (snapshotLoaded) return mountResultsTab();
    })
    .then(() => {
      if (snapshotLoaded) return refreshLive();
    })
    .catch((e) => console.warn('live refresh failed, snapshot still shown', e));
}

export { loadSnapshot, refreshLive };
