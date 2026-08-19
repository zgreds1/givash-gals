# Givash Gals — Lowest-Score-Wins Standings Site

**Date:** 2026-08-19
**League:** `Givash Gals`, Sleeper league `1395797781926408192`, 2026 NFL season
**Status:** Design approved, pending implementation plan

## 1. Problem

The league plays an inverted format that Sleeper cannot represent: the *lowest* score
wins each matchup, starters who score exactly zero incur a penalty, and because the
league has an odd number of real managers, one team each week plays the league median
instead of an opponent.

Sleeper will therefore report standings that are wrong in every particular — wrong
winners, wrong scores, wrong records. This project computes the real standings from
Sleeper's raw scoring data and publishes them as a website.

## 2. Verified league facts

Confirmed against the Sleeper API on 2026-08-19:

| Fact | Value |
| --- | --- |
| League name | `Givash Gals` |
| Season | 2026, `season_type: regular`, currently `pre_draft` |
| `total_rosters` | 6 |
| Real managers | 5 (one roster stays unowned) |
| Starters | 19 — QB×3, RB×4, WR×4, TE×2, FLEX×4, K×1, DEF×1 (confirmed from `data/raw/rosters.json`, re-confirmed against `roster_positions` 2026-08-19) |
| Bench | 5 |
| `playoff_week_start` | 15 |
| Regular season start | 2026-09-13 (week 1) |

The starter count is **not stable**: this spec was first written against 18 starters
(QB×2) and the league has since been changed to three QB slots. `rules.js` iterates the
actual `starters` array from each matchup entry and never assumes a count, so a further
roster-settings change needs no code change — only this row updating.

API capabilities confirmed by probe:

- `access-control-allow-origin: *` — the browser may call Sleeper directly.
- `matchups/{week}` returns `starters` and `starters_points` as parallel arrays, which
  is the only data source that can reproduce the zero-score penalty.
- `https://api.sleeper.app/schedule/nfl/regular/2026` returns 273 games across weeks
  1–18 for all 32 teams. NFL bye weeks are derived from it (a team is on bye in week N
  if it appears in no week-N game). No hardcoded bye table is required.
- `players/nfl` is 14.6 MB and Sleeper asks that it be fetched at most once per day.
  Reduced to the fields this project needs, it is 3,229 players / 112 KB raw /
  37 KB gzipped.

## 3. The ghost roster

The league keeps 6 roster slots for 5 managers. Exactly one roster will remain unowned
all season.

**That roster is identified at runtime as the roster whose `owner_id` is `null`.** It is
never hardcoded. As of 2026-08-19 rosters 3, 4, 5 and 6 are all unowned; once the fifth
manager joins, exactly one remains.

Sleeper will still schedule three matchups per week. The real team paired against the
ghost roster is that week's **median team**. The bye rotation is therefore inherited
from Sleeper's own schedule and requires no separate rotation logic.

The ghost roster is excluded from standings entirely. Its score is never counted, never
displayed, and never contributes to the median.

## 4. Scoring rules

### 4.1 Adjusted score

A team's adjusted score is the sum of its 19 starters' points, plus a **+20 penalty**
for each starter meeting the zero condition.

**Zero condition — a starter incurs +20 when its score is exactly 0**, tested as
`Math.abs(points) < 1e-9`, with one exception:

- **A DEF that is not on bye is exempt.** A defense scoring exactly 0 is a legitimate
  outcome of this league's scoring settings (`pts_allow_21_27: 0.0`), so it is not
  penalised. A DEF whose NFL team *is* on bye that week is penalised like any other
  starter.

Further clarifications, all deliberate:

- **Negative scores pass through untouched.** A kicker at −1 for a missed field goal
  stays at −1. In a lowest-wins format a negative score is a reward, and the penalty
  exists to punish absent lineups, not good ones.
- **An empty starter slot counts as 0 and incurs +20.** Sleeper represents an empty
  slot as player id `"0"`.
- A starter who plays and genuinely scores 0.0 is penalised. This is intended: it is the
  anti-tanking rule.
- The penalty is applied per starter, so a lineup with four zeroes takes +80.

### 4.2 Worked example

Starters and points, abbreviated to the relevant entries:

```
QB   Burrow      18.4
RB   Robinson     0.0   -> +20  (zeroed)
WR   (empty)      0.0   -> +20  (empty slot)
K    Bass        -1.0          (missed FG; negative kept)
DEF  HOU          0.0          (exempt — HOU not on bye in week 3)
...  remaining starters        76.2
```

Raw score = `18.4 + 0.0 + 0.0 + (-1.0) + 0.0 + 76.2` = **93.6**
Penalties = `+20 + 20` = **40**
Adjusted score = **133.6**

Had the same DEF been Houston in week 8 — when HOU is on bye — the DEF would also take
+20 and the adjusted score would be 153.6.

### 4.3 Matchup resolution

- **Head-to-head:** the **lower** adjusted score wins. Equal adjusted scores are a tie.
- **Median matchup:** the median team wins if its adjusted score is **below** the median
  line, loses if above, ties if exactly equal.

### 4.4 The median line

The median is computed from the **four non-bye teams' adjusted scores** — that is, the
four teams playing the two real head-to-head matchups. The ghost roster and the median
team itself are both excluded.

Sort those four adjusted scores descending and average the 2nd and 3rd:

```
median = (s[1] + s[2]) / 2
```

**Worked example.** Non-bye adjusted scores are 142.6, 118.3, 97.5, 88.1. Sorted
descending, the 2nd is 118.3 and the 3rd is 97.5, so the median line is
`(118.3 + 97.5) / 2` = **107.9**. A median team with an adjusted score of 101.2 is below
the line and **wins**. At 107.9 exactly it ties.

Penalties are applied *before* the median is computed. Every score in the system —
head-to-head, median input, median line, standings points-for — is an adjusted score.
There is exactly one kind of score.

## 5. Standings

- Record is **W-L-T**. A tie counts **0.5** toward the win column for sorting purposes
  and is displayed as a distinct T column.
- A median-matchup win counts identically to a head-to-head win.
- Win percentage is `(W + 0.5 × T) / (W + L + T)`, computed over weeks actually played.
- Sort order:
  1. Win percentage, descending
  2. Total adjusted points-for, **ascending** (lower is better, matching the format)
  3. Head-to-head record between the tied teams
  4. Unresolved ties are displayed with a `T-` prefix rather than broken arbitrarily
- The table also carries total raw points-for and a separate median-matchup record, both
  informational.

## 6. Architecture

Four units, each independently testable.

### 6.1 `rules.js` — the engine

A dependency-free ES module of pure functions. No I/O, no globals, no fetch. This is the
only place league rules are expressed, and it is imported unchanged by both the browser
and the GitHub Action, so the live page and the archive cannot disagree.

| Function | Signature | Purpose |
| --- | --- | --- |
| `byeTeams` | `(schedule, week) -> Set<string>` | NFL teams idle in a given week |
| `adjustedScore` | `(entry, byes, players) -> {raw, adjusted, penalties[]}` | Section 4.1; `penalties[]` carries `{playerId, name, reason}` where reason is one of `zeroed`, `empty-slot`, `bye-def` |
| `resolveWeek` | `(week, matchups, excludedRosterIds, byes, players) -> WeekResult` | Sections 4.3–4.4. `excludedRosterIds` is a `Set` of every unowned roster. Returns `degenerate: true` with no matchups when the payload cannot be read as two head-to-head pairs plus at most one median team |
| `standings` | `(weeks[]) -> StandingsRow[]` | Section 5 |

`resolveWeek` strips every roster in `excludedRosterIds`, then identifies the median team
as the single real roster left over. Defensively it also treats a real roster with
`matchup_id: null`, or a real roster left unpaired, as the median team — covering the
possibility that Sleeper omits unowned rosters from the matchups payload rather than
scheduling them. Three clean pairs with no leftover — all six slots owned — is equally readable and scores
as three straight head-to-head matchups with no median. Any other shape — two leftovers,
fewer than two pairs, a group of more than two real rosters, or Sleeper's own week-15
bracket — sets `degenerate: true` and emits no matchups at all;
`standings()` then skips that week entirely rather than accruing points-for for a week it
could not resolve.

### 6.2 `sleeper.js` — the data layer

Thin fetch wrapper over the endpoints in section 2. Enforces two hard guards against
rate limiting: a **30-second floor between refetches** and a **single-in-flight-request
lock** per endpoint. It never fetches `players/nfl`; it reads the committed slim map.

### 6.3 `scripts/snapshot.mjs` — the Action script

1. `GET /state/nfl` for the current week `N`. Weeks only count when `season_type` is
   `regular` or `post`; in the preseason `N` is 0 and nothing is archived.
2. `GET` league, users, rosters, and the 2026 schedule
3. `GET matchups/{1..N}` — every week, not just the current one, so that Sleeper's
   retroactive stat corrections propagate into past results. When `N` is 0 (preseason or
   off-season) the archive in `data/raw/` is rescored instead, so a finished season is
   never overwritten with an empty one
4. Write each response verbatim to `data/raw/wk{N}.json`
5. Once per day, fetch `players/nfl`, reduce it to active skill-position players as
   `{position, team, name}`, and write `data/players-slim.json`
6. Import `rules.js` and compute; write `data/standings.json` and `data/weeks.json`
7. `--replay` flag recomputes everything from `data/raw/` with zero API calls, so a
   mid-season rule amendment can rescore the full season offline

### 6.4 The site

Static, three sections behind one shell.

- **Standings** — the section 5 table.
- **Results** — every week, every matchup, as cards. Each card shows both teams' raw
  score, an itemised list of every +20 naming the player and the reason, the adjusted
  total, and the winner highlighted. The median card additionally shows all four
  contributing scores, marks which two were averaged, and draws the median line. This
  transparency is a hard requirement: the +20 rule will be disputed and the site must
  show its work.
- **Rules** — the format in plain language, rendering the same constants the engine uses.

## 7. Data flow

On page load:

1. Render immediately from committed `data/standings.json` and `data/weeks.json`, labelled
   with the snapshot timestamp.
2. Fetch `/state/nfl` and `matchups/{N}` for the current week only — two requests, and
   only two. Weeks 1..N−1 are settled and come from the snapshot, as do the rosters and
   the NFL schedule.
3. Recompute the current week with `rules.js`, merge, and relabel as live.

If step 2 or 3 fails, the snapshot remains on screen with its original timestamp. The
page is never blank and never silently stale-but-labelled-live.

## 8. Hosting and automation

- Repository `github.com/zgreds1/givash-gals`, GitHub Pages served from `main`.
- No server, no database, no secrets. Sleeper is the datastore and it is public and
  read-only.
- Scheduled Action (cron, UTC) plus `workflow_dispatch`:
  - `0 17-23 * * 0` — Sunday hourly during games
  - `0 0-4 * * 1` — Sunday night through Monday midnight ET
  - `0 13 * * 2` — Tuesday morning sweep after Monday night
- The job commits only when `data/` actually changed, keeping history as a clean
  one-commit-per-scoring-change log. `generatedAt` is carried forward unchanged when the
  substantive content is identical, so an unchanged run rewrites byte-identical files and
  the guard actually fires. The built-in `GITHUB_TOKEN` with `contents: write`
  covers the push; no user secrets are needed.
- The Action is a safety net, not the freshness mechanism. Freshness comes from the
  live fetch on page load.

## 9. Rate limiting

Sleeper's stated limit is under 1,000 calls per minute, enforced by IP block.

| Actor | Calls | Share of limit |
| --- | --- | --- |
| One Action run | ~24 over several seconds | 2.4% |
| One page load | 2 | 0.2% |

Mitigations: the browser never fetches the 14.6 MB player dump; the Action fetches it at
most once daily; the page reads the rosters and the NFL schedule from the committed
snapshot rather than the API; and the client enforces a 30-second refetch floor with an
in-flight lock.

Residual risk is that GitHub Actions runners use shared IPs and could inherit another
tenant's usage. This is non-fatal by construction — a failed Action leaves a stale
snapshot while the live page keeps working — and is handled with retry and exponential
backoff.

## 10. Error handling

- **Sleeper unreachable or rate-limited:** page falls back to the snapshot, clearly
  labelled with its age.
- **Week not yet played:** `matchups/{N}` returns entries with zero points. Weeks with no
  recorded scores are shown as upcoming, not as 0-0 ties. A week counts as played once at
  least one roster has a nonzero raw score.
- **Fewer than 5 owned rosters:** the site reports the league as not yet ready rather than
  computing a median over the wrong population. The standings and results tables are
  suppressed outright — the banner is shown alone — and every unowned roster is excluded
  from the engine, which leaves too few teams to form a week and marks it `degenerate`.
- **No ghost roster found** (all 6 slots owned): fall back to three straight head-to-head
  matchups and no median, surfacing a visible banner that the format assumption changed.
  Three clean pairs with nobody left over is an explicitly readable shape in `resolveWeek`
  — it is **not** degenerate — so the tables render normally underneath that banner.
- **Unknown player id** in `starters`: treated as a non-DEF starter, so a 0 incurs +20.
  Logged for visibility.

## 11. Testing

`node --test` over `rules.js`, following the existing `league-simulator/test-engine.mjs`
precedent in this Playground.

Required cases:

- DEF scoring 0 while not on bye — exempt
- DEF scoring 0 while on bye — +20
- Empty starter slot — +20
- Kicker at −1 — no penalty, negative preserved
- Multiple zeroes in one lineup — penalties stack
- Head-to-head where the higher raw score wins after penalties are applied
- Exact adjusted-score tie — recorded as a tie, 0.5 each
- Full synthetic week with the section 4.4 numbers, asserting the median line is 107.9
- Ghost roster excluded from the median population
- `matchup_id: null` fallback path for median-team identification
- Standings sort: win% first, then *ascending* adjusted points-for

Engine tests additionally replay real 2025 payloads from league `1123252569876344832`,
reshaped to 6 rosters, so the engine is exercised against genuine Sleeper data shapes
rather than only hand-written fixtures.

## 12. Business rules documentation

`RULES.md` in the project root states the format, the exact constants, and the worked
examples from sections 4.2 and 4.4, and is kept in lockstep with `rules.js`. This follows
the treatment used by `dankest-keepers/KEEPER_RULES.md`.

## 13. Scope

**In scope:** regular season weeks 1–18, standings, per-week results with full penalty
itemisation, and the rules page.

**Out of scope for this version:** a playoff bracket. Sleeper's bracket assumes 6 teams
and highest-score-wins, so it cannot be reused. Weeks 15–18 are displayed as ordinary
weeks in the standings and results. A lowest-wins bracket can be added once the playoff
format is decided.

Also out of scope: draft or keeper tooling, trade and waiver history, projections, and
any write operation against Sleeper.

## 14. Open risks

1. **Does Sleeper schedule matchups for an unowned roster?** Unverifiable until rosters
   fill and week 1 is played. `resolveWeek` handles both outcomes — ghost pairing and an
   unpaired or `null`-matchup real roster — so the expected worst case is a small fix in
   September rather than a redesign.
2. **The undocumented schedule endpoint.** `api.sleeper.app/schedule/nfl/regular/2026` is
   not in Sleeper's published docs and could change without notice. If it disappears, the
   fallback is a hardcoded 32-team bye table for 2026, which is nine lines of JSON and
   already derivable from the data captured on 2026-08-19.
3. **Fifth manager may not join.** The design assumes exactly 5 owned rosters. Section 10
   covers the degenerate states without crashing.
