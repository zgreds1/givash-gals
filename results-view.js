// The Results tab.
//
// Same shape as leaderboard-view.js: everything that decides WHAT to show is
// a pure function here, testable without a DOM, and mountResults is the only
// part that touches document.

import { LAST_WEEK } from './config.js';
import { esc } from './render.js';
import { medianLine, gameStates, allGamesFinal } from './rules.js';
import { displayWeek, isWeekFinal } from './season.js';

// Re-exported from its new home in season.js so existing importers — and the
// tests that pin its week boundaries — keep working unchanged.
export { displayWeek };

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

/** Sleeper's own name for a bench slot, and what roster_positions calls it. */
const BENCH_SLOT = 'BN';

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

  // A bench row is labelled BN, not with the player's own position. The
  // detail table prints ONE slot label per row for both sides, which is
  // right for starters — they genuinely share a lineup slot — but the two
  // benches are independent, unordered lists of different lengths. Labelling
  // a bench row with a position would print the left player's position over
  // the right player's row: the same "a WR shown in an RB row" failure spec
  // 6.1 legislated against, arriving by a different route. Each row still
  // carries its own `pos` for any caller that wants it.
  const started = new Set(starterIds.map(String));
  const bench = (entry?.players || [])
    .map(String)
    .filter((id) => id !== EMPTY_SLOT && !started.has(id))
    .map((id) => ({ ...row(id, '', playerPts[id]), slot: BENCH_SLOT }));

  return { starters, bench };
}

const money = (n) => n.toFixed(2);

/* A check mark drawn as SVG rather than a glyph or an emoji: it inherits the
 * winner colour and font size, and the visually-hidden word carries the
 * meaning for screen readers (colour alone never does). */
const WIN_MARK =
  '<svg class="win-mark" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
  'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 10.5l4 4 8-9"/></svg><span class="sr-only">Winner</span>';

/**
 * The four adjusted scores the median line was drawn from, with the two that
 * were averaged marked.
 *
 * Indices 1 and 2 because rules.js sorts the pool descending and averages
 * the 2nd and 3rd — the league's median rule. Written once here rather than
 * once in the summary card and again in the drill-down, where the two copies
 * could drift apart.
 */
function poolHtml(medianPool) {
  return (medianPool || [])
    .map((s, i) => `<span class="${i === 1 || i === 2 ? 'used' : ''}">${money(s)}</span>`)
    .join('');
}

/** The three readings, in the order the manager enumerated them. */
const SCORE_ROWS = [
  { key: 'adjusted', label: 'adjusted', cap: 'finished games' },
  { key: 'inPlay', label: 'in play', cap: '+ in progress' },
  { key: 'raw', label: 'raw', cap: 'no +20s' },
];

const cell = (side, key) =>
  side && typeof side[key] === 'number' ? money(side[key]) : '&mdash;';

/**
 * The three-score ladder for one matchup: left value, shared label, right value.
 *
 * Reuses the left | label | right shape of the lineup table below, so each label
 * prints once instead of once per side and both score columns stay tabular.
 *
 * `decides` takes ink and weight — never a larger size. In a league where the
 * LOW score wins, making the deciding number bigger would teach the eye exactly
 * the wrong thing.
 */
function ladder(left, right, decides) {
  return SCORE_ROWS.map(({ key, label, cap }) => {
    const cls = key === decides ? 'lrow decides' : 'lrow';
    return `<div class="${cls}">
      <span class="n l">${cell(left, key)}</span>
      <span class="lbl">${label}<span class="cap">${esc(cap)}</span></span>
      <span class="n r">${cell(right, key)}</span>
    </div>`;
  }).join('');
}

/**
 * The median line recomputed from the four head-to-head teams' in-play scores.
 *
 * Derived here rather than stored on the week: weeks.json would otherwise carry
 * a second line, a second pool and a second matchup array for every week, and
 * writeStamped's change detection would churn a commit every run.
 */
export function inPlayLine(resolved) {
  const ids = (resolved?.matchups || [])
    .filter((m) => m.type === 'h2h')
    .flatMap((m) => m.rosterIds);
  const pool = ids
    .map((id) => resolved?.teams?.[id]?.inPlay)
    .filter((v) => typeof v === 'number');
  return medianLine(pool);
}

/**
 * Who is ahead, and on which reading.
 *
 * A settled week defers to the engine's official result and never recomputes
 * it. An open week is judged on `inPlay` — the "if it ended now" number, which
 * is the honest live answer. Once every game is final the two agree by
 * construction, so the hollow mark never jumps sides as it turns solid.
 *
 * @returns {number|'line'|null} a rosterId, the literal 'line' when the median
 *   beats its opponent, or null for a tie.
 */
export function leaderOf(matchup, resolved, settled) {
  if (matchup.type === 'h2h') {
    const [a, b] = matchup.rosterIds;
    if (settled) return matchup.winner;
    const ia = resolved?.teams?.[a]?.inPlay;
    const ib = resolved?.teams?.[b]?.inPlay;
    if (typeof ia !== 'number' || typeof ib !== 'number') return null;
    if (ia < ib) return a;
    if (ib < ia) return b;
    return null;
  }

  if (settled) {
    if (matchup.result === 'W') return matchup.rosterId;
    if (matchup.result === 'L') return 'line';
    return null;
  }

  const line = inPlayLine(resolved);
  const me = resolved?.teams?.[matchup.rosterId]?.inPlay;
  if (line === null || typeof me !== 'number') return null;
  if (me < line) return matchup.rosterId;
  if (me > line) return 'line';
  return null;
}

/** Hollow while the week can still move; the existing solid check once it cannot. */
const LEAD_MARK = '<span class="lead-ring" aria-hidden="true"></span>';

function sideHead(name, side, isLeader, settled) {
  const cls = `tname ${side}${isLeader ? ' win' : ''}`;
  const mark = isLeader ? (settled ? WIN_MARK : LEAD_MARK) : '';
  const lead = isLeader && !settled ? '<span class="lead">leading</span>' : '';
  const body = side === 'l' ? `${esc(name)} ${mark}` : `${mark} ${esc(name)}`;
  return `<div class="${cls}">${body}${lead}</div>`;
}

/**
 * The one atomic status message for the week.
 *
 * Exactly one, deliberately. Six independently-announcing score elements on a
 * page that repaints during games is unusable with a screen reader; a single
 * aria-atomic sentence says the same thing once.
 */
function weekStatus(week, settled) {
  const msg = settled
    ? `<b>Week ${week} final.</b> Counted in the standings.`
    : `<b>Week ${week} in progress.</b> Leader shown on in play. Standings update Tuesday 10:00.`;
  return `<p class="week-status" role="status" aria-atomic="true">${msg}</p>`;
}

/**
 * What the three numbers mean, on the page rather than in a tooltip.
 *
 * A <details> and not a title attribute or a hover card: this site is read on a
 * phone during games, where hover does not exist. Open by default, collapsible,
 * and keyboard- and screen-reader-native with no JavaScript.
 */
function scoreKey() {
  return `<details class="score-key" open>
    <summary>What these three numbers mean</summary>
    <dl>
      <div><dt>adjusted</dt><dd>+20 for each starter on 0 whose game has
        <strong>finished</strong>. The official score &mdash; this is what the
        standings use.</dd></div>
      <div><dt>in play</dt><dd>Adjusted, plus +20 for each starter on 0 whose game
        is <strong>happening right now</strong>. Where you would land if everything
        ended this second. Starters who have not kicked off count in neither.</dd></div>
      <div><dt>raw</dt><dd>The points alone, with no +20 of any kind.</dd></div>
    </dl>
  </details>`;
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
 *
 * `settled` says whether the week's GAMES are over, which is what decides
 * which of the three readings the card leans on. mountResults works it out;
 * it is not derivable from `resolved` alone.
 */
export function renderWeek({
  week, resolved, pairs = [], ghostRosterId = null, teams = {}, detailAvailable = false,
  settled = false,
}) {
  const name = (id) => teams[String(id)] || `Roster ${id}`;

  if (resolved?.degenerate) {
    return `<p class="empty">Sleeper's pairings do not fit the league format this
      week, so nothing could be scored. The week is excluded from the standings.</p>`;
  }

  if (resolved?.played) {
    const cards = resolved.matchups
      .map((m, i) => playedCard(m, i, resolved, teams, detailAvailable, settled))
      .join('');
    const note = detailAvailable
      ? ''
      : '<p class="note">This week was archived before player detail was kept, so there is no player detail to open.</p>';
    return weekStatus(week, settled) + scoreKey() + note + cards;
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

function playedCard(m, index, wk, teams, detailAvailable, settled) {
  const name = (id) => teams[String(id)] || `Roster ${id}`;
  const hook = detailAvailable ? ` data-matchup="${index}" role="button" tabindex="0"` : '';
  const cls = `card ${settled ? 'settled' : 'live'}${detailAvailable ? ' clickable' : ''}`;
  const decides = settled ? 'adjusted' : 'inPlay';
  const leader = leaderOf(m, wk, settled);
  // Persistent, not a hover state: on a touch device a hover-only affordance is
  // no affordance at all, and this click is now the only route to player detail.
  const chev = detailAvailable ? '<span class="chev" aria-hidden="true">&rsaquo;</span>' : '';

  if (m.type === 'h2h') {
    const [a, b] = m.rosterIds;
    return `<div class="${cls}"${hook}>${chev}
      <div class="card-state"><span class="pip"></span>${settled ? 'final' : 'in progress'}</div>
      <div class="teams">
        ${sideHead(name(a), 'l', leader === a, settled)}
        <div class="vs">${settled && m.winner === null ? 'TIE' : 'vs'}</div>
        ${sideHead(name(b), 'r', leader === b, settled)}
      </div>
      <div class="ladder">${ladder(wk.teams[a], wk.teams[b], decides)}</div>
    </div>`;
  }

  const line = { adjusted: m.line, inPlay: inPlayLine(wk), raw: null };
  return `<div class="${cls}"${hook}>${chev}
    <div class="card-state"><span class="pip"></span>${settled ? 'final' : 'in progress'}</div>
    <div class="teams">
      ${sideHead(name(m.rosterId), 'l', leader === m.rosterId, settled)}
      <div class="vs">${settled && m.result === 'T' ? 'TIE' : 'vs median'}</div>
      ${sideHead('League median', 'r', leader === 'line', settled)}
    </div>
    <div class="ladder">${ladder(wk.teams[m.rosterId], line, decides)}
      <div class="pool-row"><span class="pool">${poolHtml(wk.medianPool)}</span></div>
    </div>
  </div>`;
}

const entryFor = (payload, rosterId) =>
  (payload || []).find((e) => e.roster_id === rosterId) || null;

/**
 * Tag each row of a lineup with whether it earned a +20.
 *
 * A `zeroed` or `bye-def` penalty names the player's own id, so those match
 * by id. An empty slot has no id to name: rules.js records it as
 * `playerId: null`, and the row Sleeper produces for it carries the '0'
 * sentinel. Matching those by id marked nothing at all — String(null) is the
 * literal "null", which no row id equals — so the drill-down silently left
 * 20 points unexplained in the one view built to explain them.
 *
 * They are paired off positionally instead: the i-th empty starting slot
 * takes the i-th empty-slot penalty. A lineup can hold several empty slots
 * and every one of them earns its own +20, so this consumes one penalty per
 * empty row rather than marking only the first.
 */
function markPenalties(lineup, penalties = []) {
  const ids = new Set(
    penalties.filter((p) => p.playerId !== null && p.playerId !== undefined)
      .map((p) => String(p.playerId)),
  );
  let emptySlots = penalties.filter((p) => p.playerId === null || p.playerId === undefined).length;
  const mark = (r) => ({ ...r, pen: r.empty ? emptySlots-- > 0 : ids.has(r.id) });
  return { starters: lineup.starters.map(mark), bench: lineup.bench.map(mark) };
}

function playerCell(row, align) {
  const pen = row.pen ? '<span class="pen">+20</span>' : '';
  const nameCls = row.empty ? 'lineup-name empty' : 'lineup-name';
  return `<div class="lineup-side ${align}">
    <span class="${nameCls}">${esc(row.name)}</span>
    <span class="lineup-pts">${money(row.points)}</span>
    ${pen}
  </div>`;
}

function lineupTable(left, right) {
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
        ${row ? playerCell(row, 'left') : '<span></span>'}
        <span class="lineup-slot">${esc(slot)}</span>
        ${other ? playerCell(other, 'right') : '<span></span>'}
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

  const leftTeam = resolved?.teams?.[leftId];
  const rightTeam = rightId === null ? null : resolved?.teams?.[rightId];

  const left = markPenalties(
    lineupRows(entryFor(payload, leftId), rosterPositions, players),
    leftTeam?.penalties || [],
  );
  const right = rightId === null
    ? null
    : markPenalties(
      lineupRows(entryFor(payload, rightId), rosterPositions, players),
      rightTeam?.penalties || [],
    );

  const leftWon = isMedian ? matchup.result === 'W' : matchup.winner === leftId;
  // Not `!leftWon`: a tie against the median is a tie, not a loss. The
  // summary card and the head-to-head branch both already mark neither side
  // on a draw; this is the branch that used to call it a median win.
  const medianWon = matchup.result === 'L';

  const pool = poolHtml(resolved?.medianPool);

  const header = isMedian
    ? `<div class="detail-head">
         <div class="side ${leftWon ? 'winner' : ''}">
           <div class="name">${leftWon ? WIN_MARK : ''}${esc(name(leftId))}</div>
           <div class="adj">${leftTeam ? money(leftTeam.adjusted) : '—'}</div>
         </div>
         <div class="side line ${medianWon ? 'winner' : ''}">
           <div class="name">${medianWon ? WIN_MARK : ''}League median</div>
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
    <div class="lineup">${lineupTable(left.starters, right?.starters ?? null)}</div>
    <h3 class="lineup-head">Bench</h3>
    <div class="lineup">${lineupTable(left.bench, right?.bench ?? null)}</div>
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
 * `json`/`now` are the exception: injection points for tests, never
 * reassigned once mounted. `seasonStart` looks static — `loadSnapshot`
 * writes it once and never again — but it can still arrive AFTER mount,
 * since the tab is clickable before `loadSnapshot` resolves. Until the
 * visitor picks a week themselves, the default week is recomputed from
 * `state.seasonStart` on every paint, so it corrects itself the moment
 * the snapshot lands instead of staying wrong (week 1) for the session.
 *
 * Returns `{ repaint }` so the caller can force a redraw when `state`
 * changes underneath an already-mounted tab (a background refresh landing
 * while someone is looking at the tab) rather than only fixing the *next*
 * click. `view.week` and `view.matchup` live in this closure, not in
 * `state`, so a repaint redraws whatever the visitor was already looking
 * at instead of resetting them to the default week.
 */
export async function mountResults(el, state = {}) {
  const { json = defaultJson, now = () => new Date() } = state;

  // Set once a [data-week]/[data-step] click happens, below. Before that,
  // paint() keeps recomputing the default week from state.seasonStart, so
  // a mount that races loadSnapshot (seasonStart still null) self-corrects
  // once the snapshot lands instead of sticking on week 1 for the session.
  let weekChosen = false;

  // The module's own cache for weeks refreshLive never touched — distinct
  // from state.livePayloads, which is read fresh on every call instead of
  // copied in here, so a payload that arrives after mount is still picked
  // up the next time payloadFor asks for it.
  const cache = {};
  let pairings = null;
  let players = null;
  let schedule = null;

  const view = { week: displayWeek(now(), state.seasonStart ?? null), matchup: null };

  // Bumped by every paint(). A paint compares its own ticket against this
  // after its awaits and drops out if a newer paint has started — two clicks
  // in flight at once must not race to write the DOM.
  let generation = 0;

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

  /**
   * The season schedule, preferring the live copy refreshLive stored on state.
   * The committed file is the fallback, and an empty array is the fallback to
   * that — a missing schedule must not stop the tab rendering.
   */
  async function scheduleFor() {
    if (state.schedule) return state.schedule;
    if (schedule) return schedule;
    try {
      schedule = await json('data/raw/schedule.json');
    } catch {
      schedule = [];
    }
    return schedule;
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

  // Takes the week rather than reading view.week, so the picker cannot
  // disagree with the results drawn beside it in the same paint.
  function picker(current) {
    const btns = weekOptions(state.weeks)
      .map(
        ({ week, played }) =>
          `<button type="button" data-week="${week}" aria-pressed="${week === current}"` +
          ` class="${week === current ? 'on' : ''}${played ? ' played' : ''}">${week}</button>`,
      )
      .join('');
    return `<div class="controls">
      <button type="button" data-step="-1" aria-label="Previous week"${current <= 1 ? ' disabled' : ''}>&larr;</button>
      <div class="tabs weeks" role="group" aria-label="Week">${btns}</div>
      <button type="button" data-step="1" aria-label="Next week"${current >= LAST_WEEK ? ' disabled' : ''}>&rarr;</button>
    </div>`;
  }

  async function paint() {
    // Every paint takes a ticket. payloadFor can await a fetch that takes as
    // long as the network wants, and nothing stops a second click starting a
    // second paint while the first is still suspended — so whichever fetch
    // happens to resolve LAST used to win the innerHTML, which on a
    // first-visit-to-each-week click-through drew week 5's scores under a
    // picker highlighting week 7. Silently: no error, just the wrong week.
    // A paint that is no longer the newest one writes nothing.
    const ticket = ++generation;

    if (!weekChosen) {
      const auto = displayWeek(now(), state.seasonStart ?? null);
      // view.matchup is an index into THIS week's matchups. Moving the week
      // underneath it (seasonStart landing late, or the clock rolling over
      // while a drill-down is open) would index into a different week's
      // array — a different matchup, or nothing at all.
      if (auto !== view.week) view.matchup = null;
      view.week = auto;
    }

    // Read once, up front: everything below renders the week and matchup as
    // they were when this paint started, never a later paint's.
    const week = view.week;
    const matchupIndex = view.matchup;

    const byWeek = new Map((state.weeks || []).map((w) => [w.week, w]));
    const teams = state.teams || {};
    const ghostRosterId = state.ghostRosterId ?? null;
    const rosterPositions = state.rosterPositions || [];

    const resolved = byWeek.get(week);
    // A card is settled when the GAMES are over, not when the standings gate has
    // opened. The card answers "can these numbers still change?"; the gate
    // answers "does this count yet?". They normally coincide — a postponed game
    // is exactly the case where they must not. With no schedule at all, fall
    // back to the gate rather than show a finished week as forever in progress.
    const states = gameStates(await scheduleFor(), week);
    const settled = states.size
      ? allGamesFinal(states)
      : isWeekFinal(week, state.seasonStart ?? null, now());
    const payload = resolved?.played ? await payloadFor(week) : null;
    // `?.[]`, because refreshLive can replace state.weeks under an open
    // drill-down with a week that has fewer matchups than the index.
    const matchup = matchupIndex === null || !resolved?.played
      ? null
      : resolved.matchups?.[matchupIndex] ?? null;
    const isDetail = Boolean(matchup && payload);
    const playerNames = isDetail ? await playerMap() : null;

    // Both awaits are behind us; this is the last moment before the DOM is
    // written, so it is the only place the check needs to be.
    if (ticket !== generation) return;

    if (isDetail) {
      el.innerHTML = renderMatchupDetail({
        week, matchup,
        resolved, payload, teams, rosterPositions,
        players: playerNames,
      });
    } else {
      el.innerHTML = picker(week) + renderWeek({
        week,
        resolved,
        pairs: pairings[String(week)] || [],
        ghostRosterId, teams,
        detailAvailable: Boolean(payload),
        settled,
      });
    }
    wire();
  }

  function wire() {
    for (const b of el.querySelectorAll('[data-week]')) {
      b.onclick = () => { weekChosen = true; view.week = Number(b.dataset.week); view.matchup = null; paint(); };
    }
    for (const b of el.querySelectorAll('[data-step]')) {
      b.onclick = () => {
        weekChosen = true;
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
