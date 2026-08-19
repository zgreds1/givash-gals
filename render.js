// Pure HTML builders. No fetching, no state — easy to eyeball and to test.

const esc = (s) =>
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
      return `<tr>
        <td class="rank">${esc(rank)}</td>
        <td class="team">${esc(name)}</td>
        <td>${r.w}-${r.l}-${r.t}</td>
        <td>${r.winPct.toFixed(3).replace(/^0/, '')}</td>
        <td class="num">${r.adjPF.toFixed(2)}</td>
        <td class="num muted">${r.rawPF.toFixed(2)}</td>
        <td class="num muted">${med}</td>
      </tr>`;
    })
    .join('');

  return `<table class="standings">
    <thead><tr>
      <th></th><th>Team</th><th>Record</th><th>Win%</th>
      <th class="num">Adj PF <span class="hint">(low is good)</span></th>
      <th class="num">Raw PF</th><th class="num">vs Median</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}
