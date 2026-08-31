// The Players tab.
//
// Everything that decides WHAT to show is a pure function here, so it can be
// tested without a DOM. mountLeaderboard (below) is the only part that
// touches document, and it holds no logic worth testing.

import { esc } from './render.js';

export const POSITION_TABS = ['All', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
export const FLEX_POSITIONS = new Set(['RB', 'WR', 'TE']);

/** [key, label, numeric, sortable] */
const COLUMNS = [
  ['rank', '#', false, false],
  ['name', 'Player', false, true],
  ['team', 'Team', false, true],
  ['pos', 'Pos', false, true],
  ['owner', 'Owner', false, false],
  ['gp', 'GP', true, true],
  ['raw', 'Raw', true, true],
  ['pen', '+20s', true, true],
  ['truePen', 'True +20s', true, true],
  ['saved', 'Saved', true, true],
  ['total', 'Adj Total', true, true],
  ['ppg', 'PPG', true, true],
];

/**
 * Who owns whom, and what the ownership dropdown should offer.
 *
 * @param {Array} rosters - Sleeper /league/{id}/rosters
 * @param {Object<string, string>} teams - roster id -> team name
 * @returns {{ownerOf: Map<string,string>, labels: Map<string,string>,
 *            options: Array<{value: string, label: string}>, drafted: boolean}}
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

  return { ownerOf, labels, options, drafted: ownerOf.size > 0 };
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
 * Filter and sort. Pure: the input array is never touched.
 *
 * Sorting has two modes. With no sortKey the table is ordered ascending by
 * the active metric, because in this league low is good and rank 1 is the
 * worst scorer. A clicked header overrides that.
 *
 * Ties fall back to ascending total, worst first. That works because sort is
 * stable and rows arrive pre-sorted by total; the tie test in
 * test/leaderboard-view.test.js exists so that assumption cannot quietly break.
 */
export function selectRows(rows, view = {}) {
  const {
    tab = 'All', metric = 'total', minGp = 1, q = '',
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

  if (metric === 'ppg') out = out.filter((r) => r.gp >= minGp);

  if (q) {
    const s = q.toLowerCase();
    out = out.filter(
      (r) => r.name.toLowerCase().includes(s) || r.team.toLowerCase().includes(s),
    );
  }

  const key = sortKey || metric;
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

  const { sortKey = null, sortDir = 1, metric = 'total', ownerOf = null, labels = new Map() } = view;

  const head = COLUMNS.map(([k, label, num, sortable]) => {
    const arrow = sortKey === k ? ` <span class="dir">${sortDir === 1 ? '↑' : '↓'}</span>` : '';
    const cls = [num ? 'num' : '', sortable ? 'sortable' : ''].filter(Boolean).join(' ');
    return `<th class="${cls}" data-k="${k}">${label}${arrow}</th>`;
  }).join('');

  const body = rows
    .map((r, i) => {
      const value = ownerOf ? ownerOf.get(r.id) : undefined;
      const owner = value === undefined ? 'FA' : labels.get(value) || value;
      const cnt = (n) => (n ? `<b>${n}</b>` : '0');
      return `<tr>
        <td class="rank">${i + 1}</td>
        <td class="name">${esc(r.name)}</td>
        <td class="team">${esc(r.team)}</td>
        <td class="pos">${esc(r.pos)}</td>
        <td class="owner${value === undefined ? ' fa' : ''}">${esc(owner)}</td>
        <td class="num">${r.gp}</td>
        <td class="num">${money(r.raw)}</td>
        <td class="num pen">${cnt(r.pen)}</td>
        <td class="num pen">${cnt(r.truePen)}</td>
        <td class="num saved">${cnt(r.saved)}</td>
        <td class="num${metric === 'total' ? ' metric' : ''}">${money(r.total)}</td>
        <td class="num${metric === 'ppg' ? ' metric' : ''}">${money(r.ppg)}</td>
      </tr>`;
    })
    .join('');

  return `<table class="leaderboard">
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}
