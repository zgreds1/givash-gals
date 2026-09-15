// Page controller. Paints the committed snapshot immediately, then
// re-fetches only the current week from Sleeper and recomputes.

import { LAST_WEEK } from './config.js';
import { createClient, currentWeek, findGhostRosterId, unownedRosterIds } from './sleeper.js';
import {
  byeTeams, resolveWeek, standings, opportunitySet, gameStates, allGamesFinal, weekIsPlaying,
} from './rules.js';
import { finalWeeks, gateLabel, isWeekFinal } from './season.js';
import { parseHash, formatHash } from './router.js';
import { renderStandings, renderRules, bestDirFor } from './render.js';
import { mountLeaderboard } from './leaderboard-view.js';
import { mountResults } from './results-view.js';

const state = {
  weeks: [], teams: {}, ghostRosterId: null, generatedAt: null, live: false,
  livePayloads: {}, seasonStart: null, rosterPositions: [], schedule: null,
  route: { tab: 'results', week: null, matchup: null },
};

/** How often an open page re-asks Sleeper while games are still being played.
 *  Above the client's own 30s cache floor, so a poll and a focus event landing
 *  together cost one request rather than two. */
const REFRESH_MS = 60000;

/** Hoisted out of refreshLive so its 30s per-path cache survives between
 *  polls. A client built fresh on every call cached nothing that outlived the
 *  call, which made polling four uncached requests a minute. */
let sleeperClient = null;
const sleeper = () => (sleeperClient ??= createClient());

let refreshTimer = null;

// Set once mountResults resolves. Lets paint() push a redraw into an
// already-mounted Results tab when refreshLive() changes state under it,
// instead of only fixing the next click.
let resultsRepaint = null;

// Mounted lazily like Results, and idempotent for the same reason: applyRoute
// calls it on every route change, not just the first.
let playersMounted = false;
function mountPlayersTab() {
  if (playersMounted) return Promise.resolve();
  playersMounted = true;
  return mountLeaderboard($('players'), { teams: state.teams }).catch((e) => {
    console.error(e);
    $('players').innerHTML = '<p class="empty">Could not load the leaderboard.</p>';
  });
}

/**
 * Show the view the URL names.
 *
 * The only thing that paints. Clicks never call this — they write the hash and
 * let the hashchange it fires arrive here, which is what keeps the URL and the
 * screen from ever disagreeing. Render must never write the hash back, or the
 * cycle closes.
 */
function applyRoute(route) {
  for (const b of document.querySelectorAll('nav button')) {
    const on = b.dataset.view === route.tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  }
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== route.tab;

  if (route.tab === 'players') return mountPlayersTab();
  if (route.tab === 'results') {
    // mountResultsTab is a no-op after the first call, so this is the repaint
    // path on every subsequent route change.
    return mountResultsTab().then(() => { resultsRepaint?.(); });
  }
  return Promise.resolve();
}

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
    // Two conditions: the Tuesday gate AND every game actually final. The
    // calendar alone let week 1 into the standings while its Monday night game
    // was still pre_game in the data.
    const settled = finalWeeks(state.weeks, state.seasonStart, new Date(), weekGamesFinal);
    const through = settled.length ? Math.max(...settled.map((w) => w.week)) : null;
    const nextWeek = through === null ? 1 : through + 1;
    $('standings').innerHTML = renderStandings(standings(settled), state.teams, {
      sortKey: standingsSort.key,
      sortDir: standingsSort.dir,
      through,
      nextWeek: nextWeek <= LAST_WEEK ? nextWeek : null,
      nextGate: nextWeek <= LAST_WEEK ? gateLabel(nextWeek, state.seasonStart) : null,
      // Past its gate but still being played: the note must say so, or a table
      // that has visibly stopped moving on a Tuesday afternoon reads as broken.
      waitingOnGames: nextWeek <= LAST_WEEK
        && isWeekFinal(nextWeek, state.seasonStart, new Date())
        && weekGamesFinal(nextWeek) === false,
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
 * Whether every NFL game in `week` has finished, as far as we can tell.
 *
 * true / false / null, where null means "no schedule loaded, no idea" — which
 * is what the standings gate must be told rather than a guess, so it can admit
 * the week instead of blanking the table. See finalWeeks.
 */
function weekGamesFinal(week) {
  if (!state.schedule) return null;
  const states = gameStates(state.schedule, week);
  // An empty map means the schedule has no rows for that week at all, which is
  // absence of evidence; allGamesFinal already returns false for it, but false
  // here would withhold the week forever. Report it as unknown instead.
  if (states.size === 0) return null;
  return allGamesFinal(states);
}

/**
 * The weeks worth asking Sleeper about.
 *
 * `state.week` alone was not enough, and this is the bug that stranded a
 * Monday night game on the page for half a day. Sleeper rolls `week` to the
 * NEXT week once the current one's games are done — on a Tuesday it reads 2
 * while `display_week` still reads 1. refreshLive fetched week 2, found
 * nothing played, returned early, and so never touched the week the reader was
 * actually looking at. The week you are shown became unreachable by the live
 * path at exactly the moment its last game ended.
 *
 * Both, deduped: `display_week` is the week being shown, `week` is the one
 * coming up. In-season they are usually the same number and this costs one
 * extra request only in the window where it matters.
 */
function weeksToRefresh(st) {
  const shown = currentWeek({ ...st, week: st?.display_week });
  const next = currentWeek(st);
  return [...new Set([shown, next])].filter((w) => w >= 1);
}

/**
 * Pull one week from Sleeper and fold it into state. Returns true if the week
 * scored into something real, false if there was nothing to score.
 */
async function refreshWeek(client, week, rosters, schedule, players) {
  const excluded = unownedRosterIds(rosters);
  const [payload, weekStats] = await Promise.all([
    client.matchups(week),
    client.stats(week).catch(() => ({})),
  ]);
  if (!Array.isArray(payload) || payload.length === 0) return false;

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
  if (!fresh.played || fresh.degenerate) return false;

  state.weeks = state.weeks.filter((w) => w.week !== week).concat(fresh);
  state.weeks.sort((a, b) => a.week - b.week);
  return true;
}

/**
 * Refresh live data from Sleeper.
 *
 * Falls back to the committed snapshot on any failure — the page is readable
 * without this ever succeeding, which is why every error here is a warning
 * rather than a thrown one.
 *
 * Rosters still come from the committed snapshot. Reading them from the same
 * snapshot as the team names stops the page holding a fresh ghost id against a
 * stale name map.
 */
async function refreshLive() {
  const client = sleeper();
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

  const weeks = weeksToRefresh(st);
  if (weeks.length === 0) return; // preseason: nothing real to score yet

  // Kept on state so mountResults can decide whether a card is settled without
  // fetching the schedule a second time.
  state.schedule = schedule;
  state.ghostRosterId = findGhostRosterId(rosters) ?? state.ghostRosterId;

  let any = false;
  for (const week of weeks) {
    // Sequential rather than parallel: the client dedupes by path but not by
    // rate, and two weeks is not worth doubling the burst at Sleeper.
    // eslint-disable-next-line no-await-in-loop
    if (await refreshWeek(client, week, rosters, schedule, players)) any = true;
  }
  if (!any) return;

  state.live = true;
  paint();
  scheduleNextRefresh(weeks);
}

/**
 * Keep refreshing while there is still football to watch.
 *
 * The page used to fetch once on load and never again, so a phone left open
 * through a Sunday afternoon showed the same numbers all day. Now it polls,
 * but only while a refreshed week still has an unfinished game: once
 * everything is final the timer is not rearmed and the page goes quiet until
 * something brings it back. Midweek and in the offseason that is zero
 * requests.
 *
 * The arming test is weekIsPlaying, NOT "this week is not final". Those look
 * interchangeable and are not: a week that has not kicked off yet is also not
 * final, so the not-final version polled every minute from Tuesday through
 * Saturday for scores that could not move. See its comment in rules.js.
 *
 * REFRESH_MS is above the Sleeper client's own 30s cache floor, so a poll and
 * a focus event landing together cost one request, not two.
 */
function scheduleNextRefresh(weeks) {
  clearTimeout(refreshTimer);
  const playing = weeks.some((w) => weekIsPlaying(state.schedule, w));
  if (!playing) return;
  refreshTimer = setTimeout(() => {
    refreshLive().catch((e) => console.warn('live refresh failed', e));
  }, REFRESH_MS);
}

/**
 * A phone spends most of its life with the tab in the background, where timers
 * are throttled or stopped outright. Coming back to the tab is the moment the
 * numbers are most likely to be stale and most likely to be looked at, so it
 * gets an immediate refresh rather than waiting out the timer.
 */
function wireLiveRefresh() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    refreshLive().catch((e) => console.warn('live refresh failed', e));
  });
}

/**
 * Which column the standings are sorted by, held outside paint() so it
 * survives a repaint. paint() runs on every live refresh and on every tab
 * switch; state kept inside it would silently reset the reader's sort each
 * time the page got fresh numbers.
 *
 * `key: null` means the engine's own ranking - win% then adjusted points then
 * head to head - which is the only order that is actually the standings.
 */
const standingsSort = { key: null, dir: 1 };

/**
 * One delegated listener on the panel, wired once, because paint() replaces
 * the table's innerHTML on every repaint and per-header handlers would be
 * thrown away with it. The click lands on the <button> inside the <th> and
 * bubbles; closest() finds the header that owns it.
 *
 * Three states per column, matching the Players board: best-first, reversed,
 * then back to the real ranking. The third state matters here more than it
 * does there - it is the only way back to the actual standings once you have
 * sorted by something else.
 */
function wireStandingsSort() {
  $('standings').addEventListener('click', (e) => {
    const th = e.target.closest('th.sortable');
    if (!th || !$('standings').contains(th)) return;
    const k = th.dataset.k;
    if (standingsSort.key === k) {
      if (standingsSort.dir === -bestDirFor(k)) {
        standingsSort.key = null;
        standingsSort.dir = 1;
      } else {
        standingsSort.dir = -bestDirFor(k);
      }
    } else {
      standingsSort.key = k;
      // The FIRST tap puts the best team on top, whichever way "good" runs for
      // this column. Ascending-always would answer "who is winning?" for Adj PF
      // and the exact opposite for Record.
      standingsSort.dir = bestDirFor(k);
    }
    paint();
  });
}

function wireNav() {
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
      // Writes the URL and stops. The hashchange listener does the painting, so
      // a click and the back button take exactly the same path.
      location.hash = formatHash({ tab: btn.dataset.view });
    });
  }
}

if (typeof document !== 'undefined') {
  wireNav();
  wireStandingsSort();
  wireLiveRefresh();

  // Parsed before the snapshot so a cold load of a deep link knows where it is
  // going, and applied after so it paints against loaded data rather than
  // painting an empty state and correcting itself.
  //
  // Deliberately not written back on load: an empty hash already parses to the
  // default view, and writing one would push a history entry before the visitor
  // has navigated anywhere.
  state.route = parseHash(location.hash);

  window.addEventListener('hashchange', () => {
    state.route = parseHash(location.hash);
    applyRoute(state.route);
  });

  let snapshotLoaded = true;
  loadSnapshot()
    .catch((e) => {
      snapshotLoaded = false;
      console.error(e);
      $('freshness').hidden = false;
      $('freshness').textContent = 'Could not load the snapshot.';
    })
    .then(() => {
      if (snapshotLoaded) return applyRoute(state.route);
    })
    .then(() => {
      if (snapshotLoaded) return refreshLive();
    })
    .catch((e) => console.warn('live refresh failed, snapshot still shown', e));
}

export { loadSnapshot, refreshLive, weeksToRefresh };
