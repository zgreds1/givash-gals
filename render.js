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

const REASON = {
  zeroed: 'scored 0',
  'empty-slot': 'empty slot',
  'bye-def': 'DEF on bye',
};

const money = (n) => n.toFixed(2);

function penaltyList(penalties) {
  if (!penalties.length) return '';
  const items = penalties
    .map((p) => `<li><span class="pen">+20</span> ${esc(p.name)} <em>${esc(REASON[p.reason] || p.reason)}</em></li>`)
    .join('');
  return `<ul class="penalties">${items}</ul>`;
}

function teamBlock(rosterId, team, teams, isWinner) {
  const name = teams[String(rosterId)] || `Roster ${rosterId}`;
  return `<div class="side ${isWinner ? 'winner' : ''}">
    <div class="name">${esc(name)}</div>
    <div class="adj">${money(team.adjusted)}</div>
    <div class="raw">raw ${money(team.raw)}</div>
    ${penaltyList(team.penalties)}
  </div>`;
}

export function renderResults(weeks, teams) {
  if (!weeks.length) return '<p class="empty">No weeks to show yet.</p>';

  return weeks
    .slice()
    .sort((a, b) => b.week - a.week)
    .map((wk) => {
      if (!wk.played) {
        return `<article class="week"><h2>Week ${wk.week}</h2>
          <p class="empty">Not played yet.</p></article>`;
      }

      const cards = wk.matchups
        .map((m) => {
          if (m.type === 'h2h') {
            const [a, b] = m.rosterIds;
            return `<div class="card h2h">
              ${teamBlock(a, wk.teams[a], teams, m.winner === a)}
              <div class="vs">${m.winner === null ? 'TIE' : 'vs'}</div>
              ${teamBlock(b, wk.teams[b], teams, m.winner === b)}
            </div>`;
          }

          const pool = wk.medianPool
            .map((s, i) => `<span class="${i === 1 || i === 2 ? 'used' : ''}">${money(s)}</span>`)
            .join('');

          return `<div class="card median">
            ${teamBlock(m.rosterId, wk.teams[m.rosterId], teams, m.result === 'W')}
            <div class="vs">${m.result === 'T' ? 'TIE' : 'vs median'}</div>
            <div class="side line ${m.result === 'L' ? 'winner' : ''}">
              <div class="name">League median</div>
              <div class="adj">${m.line === null ? '—' : money(m.line)}</div>
              <div class="raw">avg of 2nd &amp; 3rd</div>
              <div class="pool">${pool}</div>
            </div>
          </div>`;
        })
        .join('');

      return `<article class="week"><h2>Week ${wk.week}</h2>${cards}</article>`;
    })
    .join('');
}
