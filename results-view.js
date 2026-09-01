// The Results tab.
//
// Same shape as leaderboard-view.js: everything that decides WHAT to show is
// a pure function here, testable without a DOM, and mountResults is the only
// part that touches document.

import { LAST_WEEK } from './config.js';
import { esc } from './render.js';

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

const REASON = {
  zeroed: 'scored 0',
  'empty-slot': 'empty slot',
  'bye-def': 'DEF on bye',
};

const money = (n) => n.toFixed(2);

function penaltyList(penalties) {
  if (!penalties.length) return '';
  const items = penalties
    .map(
      (p) =>
        `<li><span class="pen">+20</span><span class="who">${esc(p.name)}</span>` +
        `<em>${esc(REASON[p.reason] || p.reason)}</em></li>`,
    )
    .join('');
  return `<ul class="penalties">${items}</ul>`;
}

/* A check mark drawn as SVG rather than a glyph or an emoji: it inherits the
 * winner colour and font size, and the visually-hidden word carries the
 * meaning for screen readers (colour alone never does). */
const WIN_MARK =
  '<svg class="win-mark" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
  'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 10.5l4 4 8-9"/></svg><span class="sr-only">Winner</span>';

function teamBlock(rosterId, team, teams, isWinner) {
  const name = teams[String(rosterId)] || `Roster ${rosterId}`;
  return `<div class="side ${isWinner ? 'winner' : ''}">
    <div class="name">${isWinner ? WIN_MARK : ''}${esc(name)}</div>
    <div class="adj">${money(team.adjusted)}</div>
    <div class="raw">raw ${money(team.raw)}</div>
    ${penaltyList(team.penalties)}
  </div>`;
}

/**
 * One week of the Results tab.
 *
 * Three shapes, in this order of precedence: a resolved week the engine
 * scored; a week Sleeper has pairings for but nobody has played; and a week
 * we know nothing about, which says so rather than rendering blank.
 *
 * `detailAvailable` is false for weeks with no archived payload — the 2025
 * archive was slimmed to a points map and cannot reconstruct a lineup. Those
 * matchups lose their click rather than 404 on it.
 */
export function renderWeek({
  week, resolved, pairs = [], ghostRosterId = null, teams = {}, detailAvailable = false,
}) {
  const name = (id) => teams[String(id)] || `Roster ${id}`;

  if (resolved?.degenerate) {
    return `<p class="empty">Sleeper's pairings do not fit the league format this
      week, so nothing could be scored. The week is excluded from the standings.</p>`;
  }

  if (resolved?.played) {
    const cards = resolved.matchups
      .map((m, i) => playedCard(m, i, resolved, teams, detailAvailable))
      .join('');
    const note = detailAvailable
      ? ''
      : '<p class="note">This week was archived before player detail was kept, so there is no player detail to open.</p>';
    return note + cards;
  }

  if (!pairs.length) {
    return `<p class="empty">Week ${week} is not published by Sleeper yet.</p>`;
  }

  const medianId = medianRosterId(pairs, ghostRosterId);
  const rows = pairs
    .filter((pair) => !pair.includes(ghostRosterId))
    .map(
      ([a, b]) => `<li class="fixture">
        <span class="side-name">${esc(name(a))}</span>
        <span class="vs">vs</span>
        <span class="side-name">${esc(name(b))}</span>
      </li>`,
    );

  if (medianId !== null) {
    rows.push(`<li class="fixture median">
      <span class="side-name">${esc(name(medianId))}</span>
      <span class="vs">vs</span>
      <span class="side-name">League median</span>
    </li>`);
  }

  return `<p class="upcoming-label">Upcoming</p><ul class="fixtures">${rows.join('')}</ul>`;
}

function playedCard(m, index, wk, teams, detailAvailable) {
  const hook = detailAvailable
    ? ` data-matchup="${index}" role="button" tabindex="0"`
    : '';
  const cls = detailAvailable ? 'card clickable' : 'card';

  if (m.type === 'h2h') {
    const [a, b] = m.rosterIds;
    return `<div class="${cls} h2h"${hook}>
      ${teamBlock(a, wk.teams[a], teams, m.winner === a)}
      <div class="vs">${m.winner === null ? 'TIE' : 'vs'}</div>
      ${teamBlock(b, wk.teams[b], teams, m.winner === b)}
    </div>`;
  }

  const pool = (wk.medianPool || [])
    .map((s, i) => `<span class="${i === 1 || i === 2 ? 'used' : ''}">${money(s)}</span>`)
    .join('');

  return `<div class="${cls} median"${hook}>
    ${teamBlock(m.rosterId, wk.teams[m.rosterId], teams, m.result === 'W')}
    <div class="vs">${m.result === 'T' ? 'TIE' : 'vs median'}</div>
    <div class="side line ${m.result === 'L' ? 'winner' : ''}">
      <div class="name">${m.result === 'L' ? WIN_MARK : ''}League median</div>
      <div class="adj">${m.line === null ? '—' : money(m.line)}</div>
      <div class="raw">avg of 2nd &amp; 3rd</div>
      <div class="pool">${pool}</div>
    </div>
  </div>`;
}

const entryFor = (payload, rosterId) =>
  (payload || []).find((e) => e.roster_id === rosterId) || null;

const penaltyIds = (resolved, rosterId) =>
  new Set((resolved?.teams?.[rosterId]?.penalties || []).map((p) => String(p.playerId)));

function playerCell(row, penalised, align) {
  const pen = penalised ? '<span class="pen">+20</span>' : '';
  const nameCls = row.empty ? 'lineup-name empty' : 'lineup-name';
  return `<div class="lineup-side ${align}">
    <span class="${nameCls}">${esc(row.name)}</span>
    <span class="lineup-pts">${money(row.points)}</span>
    ${pen}
  </div>`;
}

function lineupTable(left, right, leftPen, rightPen) {
  // left and right can differ in length: bench length tracks
  // entry.players.length per roster, which diverges the moment one side has
  // dropped a player and the other has not. Mapping over left alone would
  // silently drop any right-side row past left.length.
  const rowCount = Math.max(left.length, right ? right.length : 0);
  const rows = [];
  for (let i = 0; i < rowCount; i++) {
    const row = left[i] || null;
    const other = right ? right[i] : null;
    const slot = (row || other)?.slot || '—';
    rows.push(`<div class="lineup-row">
        ${row ? playerCell(row, leftPen.has(row.id), 'left') : '<span></span>'}
        <span class="lineup-slot">${esc(slot)}</span>
        ${other ? playerCell(other, rightPen.has(other.id), 'right') : '<span></span>'}
      </div>`);
  }
  return rows.join('');
}

/**
 * The drill-down: one matchup, both lineups, starters then bench.
 *
 * A median matchup has no opposing roster, so the right-hand column becomes
 * the line and the four adjusted scores it was drawn from — the two that
 * were averaged marked, same treatment as the summary card's pool.
 */
export function renderMatchupDetail({
  week, matchup, resolved, payload, teams = {}, rosterPositions = [], players = {},
}) {
  const name = (id) => teams[String(id)] || `Roster ${id}`;
  const isMedian = matchup.type === 'median';
  const leftId = isMedian ? matchup.rosterId : matchup.rosterIds[0];
  const rightId = isMedian ? null : matchup.rosterIds[1];

  const left = lineupRows(entryFor(payload, leftId), rosterPositions, players);
  const right = rightId === null
    ? null
    : lineupRows(entryFor(payload, rightId), rosterPositions, players);

  const leftPen = penaltyIds(resolved, leftId);
  const rightPen = rightId === null ? new Set() : penaltyIds(resolved, rightId);

  const leftTeam = resolved?.teams?.[leftId];
  const rightTeam = rightId === null ? null : resolved?.teams?.[rightId];
  const leftWon = isMedian ? matchup.result === 'W' : matchup.winner === leftId;

  const pool = (resolved?.medianPool || [])
    .map((s, i) => `<span class="${i === 1 || i === 2 ? 'used' : ''}">${money(s)}</span>`)
    .join('');

  const header = isMedian
    ? `<div class="detail-head">
         <div class="side ${leftWon ? 'winner' : ''}">
           <div class="name">${leftWon ? WIN_MARK : ''}${esc(name(leftId))}</div>
           <div class="adj">${leftTeam ? money(leftTeam.adjusted) : '—'}</div>
         </div>
         <div class="side line ${leftWon ? '' : 'winner'}">
           <div class="name">League median</div>
           <div class="adj">${matchup.line === null ? '—' : money(matchup.line)}</div>
           <div class="raw">avg of 2nd &amp; 3rd</div>
           <div class="pool">${pool}</div>
         </div>
       </div>`
    : `<div class="detail-head">
         <div class="side ${leftWon ? 'winner' : ''}">
           <div class="name">${leftWon ? WIN_MARK : ''}${esc(name(leftId))}</div>
           <div class="adj">${leftTeam ? money(leftTeam.adjusted) : '—'}</div>
         </div>
         <div class="side ${!leftWon && matchup.winner !== null ? 'winner' : ''}">
           <div class="name">${!leftWon && matchup.winner !== null ? WIN_MARK : ''}${esc(name(rightId))}</div>
           <div class="adj">${rightTeam ? money(rightTeam.adjusted) : '—'}</div>
         </div>
       </div>`;

  return `<div class="detail">
    <button type="button" class="back" data-back>&larr; Week ${week}</button>
    ${header}
    <h3 class="lineup-head">Starters</h3>
    <div class="lineup">${lineupTable(left.starters, right?.starters ?? null, leftPen, rightPen)}</div>
    <h3 class="lineup-head">Bench</h3>
    <div class="lineup">${lineupTable(left.bench, right?.bench ?? null, leftPen, rightPen)}</div>
  </div>`;
}

/** Every week 1..lastWeek, flagged with whether the engine has scored it. */
export function weekOptions(weeks, lastWeek = LAST_WEEK) {
  const played = new Set((weeks || []).filter((w) => w.played).map((w) => w.week));
  const out = [];
  for (let w = 1; w <= lastWeek; w++) out.push({ week: w, played: played.has(w) });
  return out;
}

async function defaultJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

/**
 * Mount the Results tab into `el`.
 *
 * Takes the live `state` object itself, not a snapshot of its fields.
 * `weeks`, `teams`, `ghostRosterId`, `rosterPositions` and `livePayloads`
 * are all read fresh from `state` inside `paint()`, because — unlike
 * mountLeaderboard's `teams`, written once and never reassigned —
 * `refreshLive()` in app.js replaces `state.weeks` wholesale and keeps
 * mutating `state.livePayloads` for as long as the page is open. Capturing
 * any of those by value at mount time would freeze the tab against
 * whatever `state` looked like at the moment someone first clicked it,
 * which on game day is exactly the moment least likely to have the
 * current week's data yet.
 *
 * `seasonStart` and `json`/`now` are the exceptions: `seasonStart` is
 * written once by `loadSnapshot` before the tab can be clicked and never
 * changes again, and `json`/`now` are injection points for tests, not
 * live data.
 *
 * Returns `{ repaint }` so the caller can force a redraw when `state`
 * changes underneath an already-mounted tab (a background refresh landing
 * while someone is looking at the tab) rather than only fixing the *next*
 * click. `view.week` and `view.matchup` live in this closure, not in
 * `state`, so a repaint redraws whatever the visitor was already looking
 * at instead of resetting them to the default week.
 */
export async function mountResults(el, state = {}) {
  const { seasonStart = null, json = defaultJson, now = () => new Date() } = state;

  // The module's own cache for weeks refreshLive never touched — distinct
  // from state.livePayloads, which is read fresh on every call instead of
  // copied in here, so a payload that arrives after mount is still picked
  // up the next time payloadFor asks for it.
  const cache = {};
  let pairings = null;
  let players = null;

  const view = { week: displayWeek(now(), seasonStart), matchup: null };

  try {
    pairings = (await json('data/pairings.json')).pairings || {};
  } catch {
    pairings = {};   // no schedule: upcoming weeks say "not published yet"
  }

  async function payloadFor(week) {
    const live = state.livePayloads || {};
    if (live[week] !== undefined) return live[week];
    if (cache[week] !== undefined) return cache[week];
    try {
      cache[week] = await json(`data/raw/wk${week}.json`);
    } catch {
      cache[week] = null;   // never archived: the week loses its drill-down
    }
    return cache[week];
  }

  async function playerMap() {
    if (players) return players;
    try {
      players = (await json('data/roster-players.json')).players || {};
    } catch {
      players = {};
    }
    return players;
  }

  function picker() {
    const btns = weekOptions(state.weeks)
      .map(
        ({ week, played }) =>
          `<button type="button" data-week="${week}" aria-pressed="${week === view.week}"` +
          ` class="${week === view.week ? 'on' : ''}${played ? ' played' : ''}">${week}</button>`,
      )
      .join('');
    return `<div class="controls">
      <button type="button" data-step="-1" aria-label="Previous week"${view.week <= 1 ? ' disabled' : ''}>&larr;</button>
      <div class="tabs weeks" role="group" aria-label="Week">${btns}</div>
      <button type="button" data-step="1" aria-label="Next week"${view.week >= LAST_WEEK ? ' disabled' : ''}>&rarr;</button>
    </div>`;
  }

  async function paint() {
    const byWeek = new Map((state.weeks || []).map((w) => [w.week, w]));
    const teams = state.teams || {};
    const ghostRosterId = state.ghostRosterId ?? null;
    const rosterPositions = state.rosterPositions || [];

    const resolved = byWeek.get(view.week);
    const payload = resolved?.played ? await payloadFor(view.week) : null;

    if (view.matchup !== null && resolved?.played && payload) {
      el.innerHTML = renderMatchupDetail({
        week: view.week,
        matchup: resolved.matchups[view.matchup],
        resolved, payload, teams, rosterPositions,
        players: await playerMap(),
      });
    } else {
      el.innerHTML = picker() + renderWeek({
        week: view.week,
        resolved,
        pairs: pairings[String(view.week)] || [],
        ghostRosterId, teams,
        detailAvailable: Boolean(payload),
      });
    }
    wire();
  }

  function wire() {
    for (const b of el.querySelectorAll('[data-week]')) {
      b.onclick = () => { view.week = Number(b.dataset.week); view.matchup = null; paint(); };
    }
    for (const b of el.querySelectorAll('[data-step]')) {
      b.onclick = () => {
        const next = view.week + Number(b.dataset.step);
        view.week = Math.min(LAST_WEEK, Math.max(1, next));
        view.matchup = null;
        paint();
      };
    }
    for (const c of el.querySelectorAll('[data-matchup]')) {
      const open = () => { view.matchup = Number(c.dataset.matchup); paint(); };
      c.onclick = open;
      // The card is a div with role="button", so Enter and Space are ours
      // to implement — a real button cannot wrap this grid without
      // flattening it.
      c.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      };
    }
    const back = el.querySelector('[data-back]');
    if (back) back.onclick = () => { view.matchup = null; paint(); };
  }

  await paint();
  return { repaint: paint };
}
