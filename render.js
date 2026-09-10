// Pure HTML builders. No fetching, no state — easy to eyeball and to test.

import { PENALTY } from './config.js';

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/**
 * @param {Array} rows - standings rows, already sorted
 * @param {Object} teams - rosterId -> team name
 * @param {{through?:number|null, nextWeek?:number|null, nextGate?:string|null}} meta
 *   `through` is the last week that has passed its Tuesday gate; `nextWeek` and
 *   `nextGate` describe the one waiting. Both halves are optional: a snapshot
 *   with no seasonStart supplies neither.
 */
export function renderStandings(rows, teams, meta = {}) {
  const { through = null, nextWeek = null, nextGate = null } = meta;

  // Named, not left implicit: a table that has visibly stopped moving mid-week
  // reads as broken unless it says why.
  const note = nextWeek != null && nextGate != null
    ? `<p class="gate-note">Week ${nextWeek} joins ${esc(nextGate)}.</p>`
    : '';

  if (!rows.length) {
    return '<p class="empty">No games played yet. Standings appear after week 1.</p>' + note;
  }

  const body = rows
    .map((r, i) => {
      const name = teams[String(r.rosterId)] || `Roster ${r.rosterId}`;
      const rank = r.unresolvedTie ? `T-${i + 1}` : String(i + 1);
      const med = `${r.median.w}-${r.median.l}-${r.median.t}`;
      // data-label is what each cell is called once the table collapses to
      // one card per team under 34rem and the header row is hidden.
      return `<tr>
        <td class="rank">${esc(rank)}</td>
        <th class="team" scope="row">${esc(name)}</th>
        <td class="record" data-label="Record">${r.w}-${r.l}-${r.t}</td>
        <td class="pct" data-label="Win%">${r.winPct.toFixed(3).replace(/^0/, '')}</td>
        <td class="num adjpf" data-label="Adj PF">${r.adjPF.toFixed(2)}</td>
        <td class="num muted" data-label="Raw PF">${r.rawPF.toFixed(2)}</td>
        <td class="num muted" data-label="vs Median">${med}</td>
      </tr>`;
    })
    .join('');

  const caption = `Standings &mdash; lowest adjusted points wins${
    through != null ? `, through week ${through}` : ''
  }`;

  return `<div class="table-wrap"><table class="standings">
    <caption>${caption}</caption>
    <thead><tr>
      <th scope="col"><span class="sr-only">Rank</span></th>
      <th scope="col">Team</th>
      <th scope="col">Record</th>
      <th scope="col">Win%</th>
      <th class="num" scope="col">Adj PF <span class="hint">low is good</span></th>
      <th class="num" scope="col">Raw PF</th>
      <th class="num" scope="col">vs Median</th>
    </tr></thead>
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
    <p>Some cases settle straight away, because no game is going to change
       them: an <strong>empty slot</strong>; a starter with no NFL game to
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
