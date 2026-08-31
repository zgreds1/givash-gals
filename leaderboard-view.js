// The Players tab.
//
// Everything that decides WHAT to show is a pure function here, so it can be
// tested without a DOM. mountLeaderboard (below) is the only part that
// touches document, and it holds no logic worth testing.

import { esc } from './render.js';
import { LEADERBOARD_SEASONS } from './config.js';
import { createClient } from './sleeper.js';

export const POSITION_TABS = ['All', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
export const FLEX_POSITIONS = new Set(['RB', 'WR', 'TE']);

/** [key, label, numeric, sortable, hint] — hint becomes a title tooltip */
const COLUMNS = [
  ['rank', '#', false, false],
  ['name', 'Player', false, true],
  ['team', 'Team', false, true],
  ['pos', 'Pos', false, true],
  ['owner', 'Owner', false, false],
  ['gp', 'GP', true, true],
  ['raw', 'Raw', true, true],
  ['pen', '+20s', true, true],
  [
    'truePen',
    'True +20s',
    true,
    true,
    'Zeros he was there for: games he actually played and still scored exactly 0. ' +
      'A week he missed entirely counts in +20s but not here.',
  ],
  ['total', 'Total', true, true],
  ['ppg', 'PPG', true, true],
];

/**
 * Who owns whom, and what the ownership dropdown should offer.
 *
 * @param {Array} rosters - Sleeper /league/{id}/rosters
 * @param {Object<string, string>} teams - roster id -> team name
 * @returns {{ownerOf: Map<string,string>, labels: Map<string,string>,
 *            options: Array<{value: string, label: string}>}}
 */
export function ownershipIndex(rosters, teams = {}) {
  const ownerOf = new Map();
  const labels = new Map();
  const options = [
    { value: 'all', label: 'All players' },
    { value: 'fa', label: 'Free agents' },
  ];

  for (const r of rosters || []) {
    if (!r.owner_id) continue; // the ghost roster owns nobody
    const value = String(r.roster_id);
    const label = teams[value] || `Roster ${r.roster_id}`;
    labels.set(value, label);
    options.push({ value, label });
    for (const id of r.players || []) ownerOf.set(String(id), value);
  }

  return { ownerOf, labels, options };
}

/**
 * Move the minimum-games threshold, clamped to a range that always has
 * something in it. The buttons disable at the ends; this is the guard behind
 * them, so a stuck keyboard cannot empty the table.
 */
export function stepMinGp(minGp, delta, maxGp) {
  const top = Math.max(1, maxGp || 1);
  return Math.min(top, Math.max(1, minGp + delta));
}

/**
 * The minimum-games stepper's markup. Split out of the mount closure so a
 * test can assert the disabled ends (spec §6.10) without a DOM; controls()
 * calls this, so there is only ever one copy of the markup.
 *
 * Both arguments are internal numbers, never Sleeper strings.
 */
export function stepperHtml(minGp, maxGp) {
  const top = Math.max(1, maxGp || 1);
  return `<span class="stepper">
             <button type="button" data-step="-1"${minGp <= 1 ? ' disabled' : ''}
                     aria-label="Lower the minimum games played">&minus;</button>
             <span class="readout">${minGp}+ games</span>
             <button type="button" data-step="1"${minGp >= top ? ' disabled' : ''}
                     aria-label="Raise the minimum games played">+</button>
           </span>`;
}

/** The column the board is ranked by when no header has been clicked. */
export const DEFAULT_SORT = 'total';

/**
 * Filter and sort. Pure: the input array is never touched.
 *
 * Sorting has two modes. With no sortKey the table is ordered ascending by
 * total, because in this league low is good and rank 1 is the worst scorer.
 * A clicked header overrides that.
 *
 * Ties fall back to ascending total, worst first. That works because sort is
 * stable and rows arrive pre-sorted by total; the tie test in
 * test/leaderboard-view.test.js exists so that assumption cannot quietly break.
 */
export function selectRows(rows, view = {}) {
  const {
    tab = 'All', minGp = 1, q = '',
    sortKey = null, sortDir = 1, owner = 'all', ownerOf = null,
  } = view;

  let out = rows.filter((r) =>
    tab === 'All' ? true : tab === 'FLEX' ? FLEX_POSITIONS.has(r.pos) : r.pos === tab,
  );

  if (owner !== 'all') {
    out = out.filter((r) => {
      const o = ownerOf ? ownerOf.get(r.id) : undefined;
      return owner === 'fa' ? o === undefined : o === owner;
    });
  }

  // The threshold applies to every column, not just PPG. A player with two
  // games is noise in a total-points ranking too, and the stepper is now
  // always on screen, so a filter that silently did nothing would be a lie.
  out = out.filter((r) => r.gp >= minGp);

  if (q) {
    const s = q.toLowerCase();
    out = out.filter(
      (r) => r.name.toLowerCase().includes(s) || r.team.toLowerCase().includes(s),
    );
  }

  const key = sortKey || DEFAULT_SORT;
  const dir = sortKey ? sortDir : 1;
  return out.sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    if (typeof va === 'string') return va.localeCompare(vb) * dir;
    return (va - vb) * dir;
  });
}

const money = (n) => n.toFixed(2);

export function renderLeaderboard(rows, view = {}) {
  if (!rows.length) {
    return `<p class="empty">${esc(view.emptyMessage || 'No players match these filters.')}</p>`;
  }

  const {
    sortKey = null, sortDir = 1,
    ownerOf = null, labels = new Map(), ownershipKnown = true,
  } = view;

  // Highlight whichever column the board is actually ranked by, which is
  // Total until a header is clicked. Pinning the highlight to Total would
  // point at the wrong column the moment someone sorts by PPG.
  const rankedBy = sortKey || DEFAULT_SORT;

  // A sortable header is a real <button> so it is reachable and operable by
  // keyboard; its click bubbles to the <th>, which is where wire() listens,
  // so there is still only one handler. aria-sort tells a screen reader what
  // the arrow glyph tells everyone else.
  const head = COLUMNS.map(([k, label, num, sortable, hint]) => {
    const sorted = sortKey === k;
    const arrow = sorted
      ? ` <span class="dir" aria-hidden="true">${sortDir === 1 ? '↑' : '↓'}</span>`
      : '';
    const cls = [num ? 'num' : '', sortable ? 'sortable' : ''].filter(Boolean).join(' ');
    const tip = hint ? ` title="${esc(hint)}"` : '';
    const aria = sorted ? ` aria-sort="${sortDir === 1 ? 'ascending' : 'descending'}"` : '';
    const inner = sortable
      ? `<button type="button" class="th-btn">${label}${arrow}</button>`
      : `${label}${arrow}`;
    return `<th class="${cls}"${tip} data-k="${k}" scope="col"${aria}>${inner}</th>`;
  }).join('');

  const body = rows
    .map((r, i) => {
      const value = ownerOf ? ownerOf.get(r.id) : undefined;
      // When both roster sources failed, availability is unknown, not free —
      // an accent-coloured "FA" on every row is a positive claim we cannot
      // make (spec §5).
      const isFa = ownershipKnown && value === undefined;
      const owner = !ownershipKnown ? '—' : isFa ? 'FA' : labels.get(value) || value;
      const cnt = (n) => (n ? `<b>${n}</b>` : '0');
      return `<tr>
        <td class="rank">${i + 1}</td>
        <td class="name">${esc(r.name)}</td>
        <td class="team">${esc(r.team)}</td>
        <td class="pos">${esc(r.pos)}</td>
        <td class="owner${isFa ? ' fa' : ''}">${esc(owner)}</td>
        <td class="num">${r.gp}</td>
        <td class="num">${money(r.raw)}</td>
        <td class="num pen">${cnt(r.pen)}</td>
        <td class="num pen">${cnt(r.truePen)}</td>
        <td class="num${rankedBy === 'total' ? ' metric' : ''}">${money(r.total)}</td>
        <td class="num${rankedBy === 'ppg' ? ' metric' : ''}">${money(r.ppg)}</td>
      </tr>`;
    })
    .join('');

  return `<div class="table-wrap"><table class="leaderboard">
    <caption class="sr-only">Player leaderboard, ranked by ${
      rankedBy === 'ppg' ? 'points per game' : 'total points'
    }, lowest first</caption>
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

async function defaultJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

/**
 * Mount the Players tab into `el`. Called once, the first time the tab is
 * opened, so a visitor who never looks at it pays nothing.
 *
 * Rosters come from Sleeper live rather than from the committed snapshot: the
 * cron only runs Sunday evening through Tuesday, and the free-agent list is
 * most useful precisely on the days the snapshot would be stale.
 */
export async function mountLeaderboard(el, { teams = {}, json = defaultJson, client } = {}) {
  const api = client || createClient();
  const seasons = LEADERBOARD_SEASONS;
  const cache = {};

  let rosters = [];
  let rosterSource = 'live';
  try {
    rosters = await api.rosters();
  } catch {
    try {
      rosters = await json('data/raw/rosters.json');
      rosterSource = 'snapshot';
    } catch {
      rosterSource = 'none';
    }
  }
  const idx = ownershipIndex(rosters, teams);

  const view = {
    season: seasons[0],
    tab: 'All',
    minGp: 1,
    q: '',
    sortKey: null,
    sortDir: 1,
    owner: 'all',
    ownerOf: idx.ownerOf,
    labels: idx.labels,
    // Both roster sources failed: the Owner column says "—", not "FA".
    ownershipKnown: rosterSource !== 'none',
  };

  async function rowsFor(season) {
    if (cache[season] === undefined) {
      try {
        cache[season] = (await json(`data/leaderboard-${season}.json`)).rows || [];
      } catch {
        // Leave nothing cached, so toggling away and back retries. Caching
        // the failure would make one flaky fetch permanent for the page.
        delete cache[season];
        return null; // distinct from "loaded, empty"
      }
    }
    return cache[season];
  }

  /**
   * Only degraded states get a note. The board explains itself otherwise, and
   * a standing explainer above every table is a line you stop reading by the
   * second visit. These two are different: they say the data is not what it
   * normally is, and without them a degraded board looks like a healthy one.
   */
  function notes() {
    const out = [];
    if (rosterSource === 'snapshot') {
      out.push('Rosters could not be fetched live; showing the last snapshot.');
    }
    if (rosterSource === 'none') {
      out.push('Rosters unavailable, so ownership is unknown.');
    }
    return out.length ? `<p class="note">${out.map(esc).join(' ')}</p>` : '';
  }

  function seasonBar() {
    const btns = seasons
      .map(
        (s) =>
          `<button type="button" data-season="${s}" aria-pressed="${s === view.season}"` +
          `${s === view.season ? ' class="on"' : ''}>${s}</button>`,
      )
      .join('');
    return `<div class="tabs seasons" role="group" aria-label="Season">${btns}</div>`;
  }

  function controls(rows, maxGp) {
    const on = (c) => (c ? ' class="on"' : '');
    const tabs = POSITION_TABS.map(
      (t) =>
        `<button type="button" data-tab="${t}" aria-pressed="${t === view.tab}"${on(
          t === view.tab,
        )}>${t}</button>`,
    ).join('');
    const owners = idx.options
      .map(
        (o) =>
          `<option value="${esc(o.value)}"${o.value === view.owner ? ' selected' : ''}>` +
          `${esc(o.label)}</option>`,
      )
      .join('');
    const stepper = stepperHtml(view.minGp, maxGp);

    return `<div class="controls">
      ${seasonBar()}
      <div class="tabs" role="group" aria-label="Position">${tabs}</div>
      <span class="spacer"></span>
      <select id="lb-owner" aria-label="Filter by owner"${
        rosterSource === 'none' ? ' disabled' : ''
      }>${owners}</select>
      ${stepper}
      <input id="lb-q" type="search" aria-label="Search player or team"
             placeholder="Search player / team" value="${esc(view.q)}" />
    </div>
    <div class="count" role="status">${rows ? `${rows.length} players` : ''}</div>`;
  }

  async function paint(focusSearch = false) {
    const all = await rowsFor(view.season);
    if (all === null) {
      el.innerHTML = `<div class="controls">${seasonBar()}</div>
        <p class="empty">Could not load the ${esc(view.season)} leaderboard.</p>`;
      wire();
      return;
    }

    const maxGp = all.reduce((m, r) => Math.max(m, r.gp), 1);
    if (view.minGp > maxGp) view.minGp = maxGp;

    const shown = selectRows(all, view);
    // Not escaped here: renderLeaderboard escapes the whole message.
    view.emptyMessage = all.length
      ? 'No players match these filters.'
      : `No games played yet in ${view.season}.`;

    el.innerHTML = controls(shown, maxGp) + notes() + renderLeaderboard(shown, view);
    wire();
    if (focusSearch) {
      const input = el.querySelector('#lb-q');
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  function wire() {
    for (const b of el.querySelectorAll('[data-season]')) {
      b.onclick = () => {
        view.season = b.dataset.season;
        view.sortKey = null;
        paint();
      };
    }
    for (const b of el.querySelectorAll('[data-tab]')) {
      b.onclick = () => {
        view.tab = b.dataset.tab;
        paint();
      };
    }
    for (const b of el.querySelectorAll('[data-step]')) {
      b.onclick = async () => {
        const all = (await rowsFor(view.season)) || [];
        const maxGp = all.reduce((m, r) => Math.max(m, r.gp), 1);
        view.minGp = stepMinGp(view.minGp, Number(b.dataset.step), maxGp);
        paint();
      };
    }
    const owner = el.querySelector('#lb-owner');
    if (owner) {
      owner.onchange = () => {
        view.owner = owner.value;
        paint();
      };
    }
    const q = el.querySelector('#lb-q');
    if (q) {
      q.oninput = () => {
        view.q = q.value;
        paint(true);
      };
    }
    for (const th of el.querySelectorAll('th.sortable')) {
      th.onclick = () => {
        const k = th.dataset.k;
        // Three states: ascending, descending, back to the default sort.
        if (view.sortKey === k) {
          if (view.sortDir === -1) {
            view.sortKey = null;
            view.sortDir = 1;
          } else {
            view.sortDir = -1;
          }
        } else {
          view.sortKey = k;
          view.sortDir = 1;
        }
        paint();
      };
    }
  }

  await paint();
}
