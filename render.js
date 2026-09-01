// Pure HTML builders. No fetching, no state — easy to eyeball and to test.

import { PENALTY } from './config.js';

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

export function renderStandings(rows, teams) {
  if (!rows.length) {
    return '<p class="empty">No games played yet. Standings appear after week 1.</p>';
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

  return `<div class="table-wrap"><table class="standings">
    <caption>Standings &mdash; lowest adjusted points wins</caption>
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
  </table></div>`;
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
