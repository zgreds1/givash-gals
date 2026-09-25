// Pure HTML builders. No fetching, no state — easy to eyeball and to test.

import { PENALTY } from './config.js';

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/**
 * The standings columns, in the order the table prints them.
 *
 * No Win% column, and records print W-L rather than W-L-T. The league settles
 * ties by hand - if one happens it gets looked at and adjusted - so a third
 * number that reads "0" in every row for an entire season is a column of
 * noise, and a percentage derived from it is the same noise one step removed.
 * winPct is NOT dropped from the engine: standings() still ranks on it first,
 * so the order of this table is unchanged. Only the column is gone.
 *
 * `[key, label, short, numeric, sortable, best]`. `short` is what the header
 * says on a phone, where "vs Median" is three times the width of the numbers
 * beneath it. `best` is the direction that puts the best team first.
 *
 * That last field exists because this league inverts the usual reading: the
 * LOWEST adjusted score wins, and a +20 is a punishment. A table sorting every
 * column ascending on the first tap would answer "who is winning?" for Adj PF
 * and the exact opposite for Record. Each column declaring its own direction
 * means one tap always puts the best team on top, whichever way "good" runs
 * for that stat.
 */
export const STANDINGS_COLUMNS = [
  ['rank', '#', '#', false, false, 0],
  ['team', 'Team', 'Team', false, true, 1],
  ['record', 'Record', 'W-L', false, true, -1],
  ['adjPF', 'Adj PF', 'Adj PF', true, true, 1],
  ['rawPF', 'Raw PF', 'Raw PF', true, true, 1],
  ['settledPenalties', `+${PENALTY}s`, `+${PENALTY}`, true, true, 1],
  ['median', 'vs Median', 'Med', true, true, -1],
];

/** Which direction puts the best team first for this column. */
export function bestDirFor(key) {
  const col = STANDINGS_COLUMNS.find(([k]) => k === key);
  return col ? col[5] : 1;
}

/**
 * The value a column sorts on.
 *
 * Record and vs Median print as "1-0-0" but neither sorts as a string:
 * "10-0-0" would land between "1-0-0" and "2-0-0". Both sort on wins with
 * losses breaking the tie the other way, so a better record is never placed
 * below a worse one that happens to share a win count.
 */
function sortValue(row, key, teams) {
  if (key === 'team') return teams[String(row.rosterId)] || `Roster ${row.rosterId}`;
  if (key === 'record') return row.w * 1000 - row.l;
  if (key === 'median') return row.median.w * 1000 - row.median.l;
  return row[key] ?? 0;
}

/**
 * Sort standings rows for display. Pure: the input array is never touched.
 *
 * With no `sortKey` the rows come back in the order standings() emitted them,
 * which is the real ranking - win% then adjusted points then head to head. A
 * clicked header overrides that for the VIEW only; it never changes who is
 * actually first, which is why the rank travels with the row and is computed
 * before this runs.
 *
 * Ties fall back to the engine order: Array.prototype.sort is stable, so rows
 * level on the clicked column keep their standings order instead of
 * rearranging on every repaint.
 */
export function sortStandings(rows, teams = {}, sortKey = null, sortDir = 1) {
  if (!sortKey) return [...rows];
  return [...rows].sort((a, b) => {
    const va = sortValue(a, sortKey, teams);
    const vb = sortValue(b, sortKey, teams);
    if (typeof va === 'string') return va.localeCompare(vb) * sortDir;
    return (va - vb) * sortDir;
  });
}

/**
 * The +PENALTY column is a whole count, not a points total: it says how many
 * times this team was charged. It sits beside the two PF columns because it
 * reconciles them - adjPF minus rawPF is exactly PENALTY x that cell - and a
 * reader comparing the three sees at a glance how much of a team's adjusted
 * total was self-inflicted.
 *
 * `?? 0` is for a row this module did not get from standings(), which always
 * sets the field - the archive case is resolved upstream, in
 * settledPenaltyCount. Here it only keeps a hand-built row from printing
 * "undefined" into the table.
 *
 * It is pointedly NOT `.muted`, which is the class the 34rem collapse hides.
 * Raw PF and vs Median drop off a phone; this column stays, because it is the
 * one that explains the gap between the two PF numbers, and the phone is where
 * this table is actually read.
 *
 * @param {Array} rows - standings rows, already sorted
 * @param {Object} teams - rosterId -> team name
 * @param {{through?:number|null, nextWeek?:number|null, nextGate?:string|null}} meta
 *   `through` is the last week that has passed its Tuesday gate; `nextWeek` and
 *   `nextGate` describe the one waiting. Both halves are optional: a snapshot
 *   with no seasonStart supplies neither.
 */
export function renderStandings(rows, teams, meta = {}) {
  const {
    through = null, nextWeek = null, nextGate = null, waitingOnGames = false,
    sortKey = null, sortDir = 1,
  } = meta;

  // Named, not left implicit: a table that has visibly stopped moving mid-week
  // reads as broken unless it says why. Two different reasons, two different
  // sentences — and the games one takes precedence, because once the clock has
  // passed, naming the gate time would point at a deadline already behind us
  // and explain nothing about why the week is still out.
  const note = nextWeek != null && waitingOnGames
    ? `<p class="gate-note">Week ${nextWeek} joins once its last game is final.</p>`
    : nextWeek != null && nextGate != null
      ? `<p class="gate-note">Week ${nextWeek} joins ${esc(nextGate)}.</p>`
      : '';

  if (!rows.length) {
    return '<p class="empty">No games played yet. Standings appear after week 1.</p>' + note;
  }

  // Rank is stamped from the INCOMING order, which is the engine's real
  // ranking, and then travels with the row through whatever sort the reader
  // asks for. Numbering the rows on screen instead would invent a ranking the
  // league does not have: sort by +20s and the fourth-placed team would be
  // labelled 1st, which is a claim about the season, not about the column.
  const ranked = rows.map((r, i) => ({
    ...r,
    rank: r.unresolvedTie ? `T-${i + 1}` : String(i + 1),
  }));

  const shown = sortStandings(ranked, teams, sortKey, sortDir);

  const body = shown
    .map((r) => {
      const name = teams[String(r.rosterId)] || `Roster ${r.rosterId}`;
      const med = `${r.median.w}-${r.median.l}`;
      const cell = (k, cls, val) =>
        `<td class="${cls}${sortKey === k ? ' sorted' : ''}">${val}</td>`;
      // The tint means "this team is leading", so it is attached to the row
      // whose RANK is 1, not to whichever row happens to be printed first. An
      // unresolved tie for first ("T-1") marks nobody: tinting one of them
      // would settle by accident the very tie the engine refused to settle.
      const leader = r.rank === '1' ? ' class="leader"' : '';
      return `<tr${leader}>
        <td class="rank">${esc(r.rank)}</td>
        <th class="team${sortKey === 'team' ? ' sorted' : ''}" scope="row">${esc(name)}</th>
        ${cell('record', 'record', `${r.w}-${r.l}`)}
        ${cell('adjPF', 'num adjpf', r.adjPF.toFixed(2))}
        ${cell('rawPF', 'num rawpf', r.rawPF.toFixed(2))}
        ${cell('settledPenalties', 'num pen20', r.settledPenalties ?? 0)}
        ${cell('median', 'num med', med)}
      </tr>`;
    })
    .join('');

  // A sortable header is a real <button> so it answers to the keyboard as well
  // as to a tap; its click bubbles to the <th>, which is where the view
  // listens, so there is still only one handler. aria-sort tells a screen
  // reader what the arrow tells everyone else. Same shape as the Players
  // board's headers, deliberately - one sorting idiom in this codebase.
  const head = STANDINGS_COLUMNS.map(([k, label, short, num, sortable]) => {
    const sorted = sortKey === k;
    const arrow = sorted
      ? ` <span class="dir" aria-hidden="true">${sortDir === 1 ? '↑' : '↓'}</span>`
      : '';
    const cls = [num ? 'num' : '', sortable ? 'sortable' : ''].filter(Boolean).join(' ');
    const aria = sorted ? ` aria-sort="${sortDir === 1 ? 'ascending' : 'descending'}"` : '';
    // Both spellings ship in the markup and CSS picks one, so the phone header
    // is not a second render path that can drift from the desktop one.
    const text = `<span class="lbl-full">${label}</span>`
      + `<span class="lbl-short">${short}</span>`;
    const inner = sortable
      ? `<button type="button" class="th-btn">${text}${arrow}</button>`
      : `${text}${arrow}`;
    return `<th class="${cls}" data-k="${k}" scope="col"${aria}>${inner}</th>`;
  }).join('');

  const caption = `Standings &mdash; lowest adjusted points wins${
    through != null ? `, through week ${through}` : ''
  }`;

  return `<div class="table-wrap"><table class="standings">
    <caption>${caption}</caption>
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table></div>${note}`;
}

export function renderRules() {
  return `<div class="rules">
    <h2>Lowest score wins</h2>
    <p>Every matchup goes to the <strong>lower</strong> adjusted score. An exact
       tie counts half a win.</p>

    <h2>The +${PENALTY} penalty</h2>
    <p>Each starter that scores <strong>exactly 0</strong> adds
       <strong>${PENALTY}</strong> to your total. Empty slots count as 0.
       Penalties stack.</p>
    <p><strong>Exception:</strong> a DEF that is not on bye is exempt — 0 is a
       legitimate defensive score in this league. A DEF on bye is not exempt.</p>
    <p><strong>Exception:</strong> a player who recorded a <strong>catch, pass
       completion, rush attempt, field-goal attempt or extra-point attempt</strong>
       is exempt. They were involved and failed, and the format punishes
       absence, not failure.</p>
    <p>The bar is a completed action, not an intention. A <strong>target</strong>
       and a <strong>pass attempt</strong> do not count — on either one the
       player may have done nothing at all. A receiver targeted eight times who
       catches none of them takes the +${PENALTY}; so does a quarterback who
       goes 0-for-5. An empty starter slot is never exempt.</p>
    <p>Negative scores are kept as-is. A kicker at &minus;1 stays at &minus;1;
       that is a reward, not something to punish.</p>

    <h2>When the +${PENALTY} lands</h2>
    <p>A +${PENALTY} only counts once <strong>that player's own NFL game is
       complete</strong>. A starter sitting on 0 at half-time has not cost you
       anything yet; he costs ${PENALTY} when his game ends still on 0.</p>
    <p>An <strong>empty slot</strong> lands when the <strong>last game of
       the week kicks off</strong>: until then you can still put someone in
       it, so it counts toward <strong>in play</strong> but not the official
       score.</p>
    <p>Some cases settle straight away, because no game is going to change
       them: a starter with no NFL game to
       wait for, whether his team is on bye or he has no team at all; and a
       game that is <strong>cancelled</strong>.</p>
    <p>So a team's score moves during the week, and Results shows three
       readings of it. All three count <em>every point every starter has
       scored so far</em>, players in the middle of a game included &mdash;
       what differs between them is only how many +${PENALTY}s they add.</p>
    <p><strong>adjusted</strong> adds a +${PENALTY} only for a zeroed starter
       whose game has <strong>finished</strong>. It is the official score, and
       the one the standings use. <strong>in play</strong> adds those, plus a
       +${PENALTY} for each zeroed starter whose game is
       <strong>happening right now</strong> &mdash; where you would land if
       everything ended this second. <strong>raw</strong> is the points alone,
       with no +${PENALTY} of any kind. A starter whose game has not kicked
       off is charged by neither of the first two.</p>
    <p>The standings themselves do not move mid-week: a week joins them on
       <strong>Tuesday at 10:00 Israel time</strong>, once its games are done
       and its adjusted scores have stopped changing.</p>

    <h2>The median matchup</h2>
    <p>Five managers occupy six roster slots. Each week the team Sleeper pairs
       against the empty roster plays the <strong>league median</strong>: the
       average of the 2nd and 3rd highest adjusted scores among the four teams
       playing each other.</p>
    <p>That team <strong>wins if it finishes below the line</strong>.</p>

    <h2>No playoffs</h2>
    <p>There is no playoff bracket. All <strong>18 weeks</strong> are
       regular-season weeks, and the standings after week 18 are the
       <strong>final rankings</strong> &mdash; whoever finishes on top has won
       the league.</p>

    <h2>Standings</h2>
    <p>Win%, then <strong>lowest</strong> adjusted points-for, then
       head-to-head. A median win counts the same as any other win.</p>
  </div>`;
}
