# Givash Gals — Results as a Week View

**Date:** 2026-09-01
**League:** `Givash Gals`, Sleeper league `1395797781926408192`, 2026 NFL season
**Status:** Design approved, pending implementation plan
**Builds on:** `docs/superpowers/specs/2026-08-19-givash-gals-standings-design.md`

## 1. Problem

The Results tab renders every played week as one long descending list and stops
there. Three things are wrong with that:

1. **The season is invisible before it starts.** `data/weeks.json` holds only weeks
   the engine has resolved, so today — eight days before kickoff — the tab reads
   "No weeks to show yet." Sleeper already knows all 18 weeks of pairings; the site
   simply never asks.
2. **There is no way to look at one week.** Every week is on screen at once, and by
   December the most recent result sits under a growing pile.
3. **A matchup is a dead end.** A card shows two totals and a penalty list. It cannot
   answer "who actually scored what", which is the first question anyone asks.

The fix is to make Results a **single-week view**: a week picker covering all 18
weeks, defaulting to the current week and rolling over on Wednesdays, where clicking
a matchup opens a Sleeper-style detail with every player's points.

## 2. Verified facts

Confirmed against the Sleeper API on 2026-09-01.

| Fact | Value | How confirmed |
| --- | --- | --- |
| `season_start_date` | `2026-09-09` — **a Wednesday** | `/v1/state/nfl` |
| Current state | `week: 1`, `season_type: regular`, `season_has_scores: true` | `/v1/state/nfl` |
| Pairings for **future** weeks | Available for every week 1–18 | probed weeks 1, 5, 12, 18 |
| `roster_positions` | QB×3, RB×4, WR×4, TE×2, FLEX×4, K, DEF, BN×5 | `/v1/league/{id}` |
| `total_rosters` | 6, of which 5 owned | `/v1/league/{id}` |
| Size of one week's matchup payload | **3.9 KB** for 6 rosters | measured, `test/fixtures/real-week.json` |

**Correction to the 2026-08-19 spec.** That document records "Regular season start
2026-09-13 (week 1)". `2026-09-13` is a *Sunday* — the first Sunday of play. Sleeper's
own `season_start_date` is `2026-09-09`, the Wednesday before. Both are true
statements about different things; this design depends on the Wednesday, and §5
explains why that is load-bearing.

### 2.1 Future pairings, verified

Each `/matchups/{week}` entry carries `matchup_id` even before a ball is thrown, with
`points: 0.0`. Grouping by `matchup_id` yields the week's three pairs:

| Week | Pairs | Ghost (roster 6) is with | So the median team is |
| --- | --- | --- | --- |
| 1 | (1,3) (2,4) (5,6) | 5 | roster 5 |
| 2 | (1,2) (3,6) (4,5) | 3 | roster 3 |
| 5 | (1,4) (3,5) (2,6) | 2 | roster 2 |
| 12 | (1,2) (3,6) (4,5) | 3 | roster 3 |
| 18 | (1,6) (2,5) (3,4) | 1 | roster 1 |

Weeks 2 and 12 are identical, which is the expected shape rather than a bug: six
rosters make a five-week round robin, so weeks 2, 7, 12 and 17 repeat, as do 3, 8, 13
and 18. Week 18's pairs matching week 3's is the same cycle. This is a useful
consistency check on any regenerated `pairings.json`.

This is the same rule `resolveWeek` already applies to played weeks — the team paired
with an unowned roster plays the league median — so the upcoming view and the played
view agree by construction rather than by coincidence.

## 3. Scope

**In scope**

- A week picker over all 18 weeks, with prev/next stepping.
- Default week derived from the date, rolling over on Wednesday.
- Upcoming weeks showing real pairings, including who draws the median.
- A matchup detail view: starters **and bench**, per-player points, replacing the week
  view with a back link.
- A median-matchup detail variant showing the line and the pool it came from.

**Out of scope**

- Real stat lines (yards, TDs, receptions). Points only. Rejected during
  brainstorming as materially more work for a different display per position.
- Projections, win probability, or anything Sleeper computes that this league's rules
  would invalidate anyway.
- Any change to `rules.js`. The scoring engine is untouched by this work.
- Retrofitting detail views onto the 2025 archive. See §8.

## 4. Data

### 4.1 `data/pairings.json` — new

The full-season schedule, so the page can draw upcoming weeks without 18 API calls per
visitor.

```json
{
  "generatedAt": "2026-09-01T12:00:00.000Z",
  "pairings": { "1": [[1,3],[2,4],[5,6]], "2": [[1,2],[3,6],[4,5]] }
}
```

- Written by `scripts/snapshot.mjs`, which already runs on cron.
- Costs **18 extra `client.matchups(w)` calls per Action run**, and zero per page load.
- Roughly 1.5 KB. Written through `writeStamped`, so an unchanged schedule does not
  restamp and the Action's commit-on-change guard still works.
- Pairs are sorted within each pair and pairs sorted by first element, so a stable
  schedule produces a byte-stable file. Without this the Action would commit noise
  every run.

The ghost roster id is **not** duplicated here — `data/standings.json` already carries
`ghostRosterId`, and two sources for one fact is how they drift apart.

### 4.2 `data/roster-players.json` — new

`id -> {name, pos, team}` for every player who has appeared on a roster this season.
Roughly 10 KB.

This file exists **only because the detail view shows bench players.**
`data/players-slim.json` — already fetched on every page load — is filtered to
`active && SKILL.has(position)` by `slimPlayers`, deliberately, to keep 57 KB off
every visitor. Bench slots are exactly where inactive and IR players sit, so resolving
bench names against the slim map would print bare Sleeper ids.

The two alternatives were considered and rejected:

- Lazily fetch `data/players-all.json` (233 KB) on first matchup click — a large
  download on a phone for a handful of names.
- Widen `players-slim.json` — puts the cost on every visitor including those who never
  open Results.

**It must be built from the union of every player id in every archived week payload,
plus current rosters** — not from current rosters alone. A player dropped in week 5
still started in week 3, and his name must survive in that week's detail view.

### 4.3 `data/raw/wk{N}.json` — existing, newly read by the site

Already written by the snapshot (`writeFile(path.join(RAW, 'wk${w}.json'), …)`) with
the full payload: `starters`, `starters_points`, `players`, `players_points`. The site
has never read it. It now does, lazily, on matchup click — 3.9 KB measured.

For the **current** week the page uses the payload `refreshLive()` already fetches and
currently discards, so opening the live week's detail costs no request at all.

## 5. The Wednesday rollover

The requirement is that the displayed week advances on Wednesdays. Because Sleeper's
`season_start_date` is itself a Wednesday, this needs no weekday arithmetic:

```js
export function displayWeek(now, seasonStart, lastWeek = LAST_WEEK) {
  const days = Math.floor((now - seasonStart) / 86400000);
  return Math.min(lastWeek, Math.max(1, Math.floor(days / 7) + 1));
}
```

Verified against the real start date:

| Date | Day | Result |
| --- | --- | --- |
| 2026-09-01 | Tue | 1 (clamped up — preseason) |
| 2026-09-08 | Tue | 1 |
| **2026-09-09** | **Wed** | **1** |
| 2026-09-15 | Tue | 1 |
| **2026-09-16** | **Wed** | **2** |
| 2026-11-04 | Wed | 9 |
| 2027-01-05 | Tue | 17 |
| **2027-01-06** | **Wed** | **18** |
| 2027-02-01 | Mon | 18 (clamped down) |

Deliberately **not** derived from `/state/nfl`'s `week`: that field advances on
Sleeper's own schedule, which is Tuesday, and reading it would make the rollover a
property of Sleeper's timing rather than a rule this site states and tests. It also
would not be available before the first paint.

`season_start_date` is copied into `data/standings.json` by the snapshot so the page
can compute the default week from the committed snapshot alone, with no API call
before first paint.

**Timezone:** computed from the visitor's local midnight, not UTC. A visitor in Israel
is 10 hours ahead of US Eastern; using UTC would flip their week over on Tuesday
evening local time. The function takes `now` as an argument precisely so this is
testable at fixed instants.

## 6. Module structure

A new `results-view.js`, modelled directly on `leaderboard-view.js`, which already
establishes the pattern in this repo: everything that decides *what* to show is a pure
exported function; one `mount…` function is the only thing that touches `document`.

| Export | Purity | Responsibility |
| --- | --- | --- |
| `displayWeek(now, seasonStart, lastWeek)` | pure | §5 |
| `weekPairs(pairings, week)` | pure | the three pairs for a week |
| `medianRosterId(pairs, ghostRosterId)` | pure | who draws the median |
| `upcomingWeek(week, pairs, ghost, teams)` | pure | HTML for an unplayed week |
| `lineupRows(entry, rosterPositions, players)` | pure | slot-ordered starters + bench |
| `renderWeek(week, resolved, pairings, …)` | pure | one week, played or not |
| `renderMatchupDetail(…)` | pure | the drill-down, both variants |
| `mountResults(el, state)` | impure | selection state, lazy fetch, wiring |

`renderResults` leaves `render.js`. `renderStandings` and `renderRules` stay where they
are — they have no state and no fetching.

### 6.1 Slot ordering

`lineupRows` walks `roster_positions` in order, consuming from the entry's `starters`
array positionally, on the assumption that `starters[i]` corresponds to the *i*th
non-`BN` entry of `roster_positions`. Bench is then `players` minus `starters`.

**This assumption is unverified and must be checked against week 1.** It is the
conventional Sleeper behaviour and the fixture is consistent with it, but no played
2026 week exists to confirm it, and getting it wrong mislabels every slot — a WR shown
in a RB row. `lineupRows` must therefore cross-check each player's actual position
against the slot it lands in and fall back to labelling the row with the player's own
position when the two disagree, rather than trusting the index blindly.

`roster_positions` is **not currently archived** — `data/raw/league.json` is trimmed to
`scoring_settings` only. The snapshot must start keeping it. Hardcoding the current
19-slot layout is rejected: the 2026-08-19 spec records that this league already
changed from QB×2 to QB×3 mid-design, and a hardcoded layout would silently mislabel
every row when it changes again.

## 7. Interaction

- Week picker: 18 compact buttons in a horizontally scrollable row, plus prev/next.
  Reuses the `.controls` / `.tabs` styling the Players tab already has. Played weeks
  and upcoming weeks are visually distinct.
- The picker is a `role="tablist"`-free plain button group with `aria-pressed`,
  matching the season/position groups on the Players tab.
- Clicking a matchup replaces the panel with the detail and shows a back link.
- Back returns to the same week, not to the default week.
- The selected week is **not** put in the URL. Deep linking is out of scope; the site
  is a single page with no router, and adding history handling for one view is scope
  the request does not carry.

## 8. Degradation

Two cases must fail visibly rather than silently:

1. **2025 weeks have no detail, ever.** `data/raw-2025/` was built with `slimWeek`,
   which reduces a week to a player-id→points map. It has no rosters, no starters, no
   bench. Those matchups are not clickable and say why.
2. **2026 weeks archived before this change** have `wk{N}.json` but the snapshot may
   not yet have written `roster-players.json` covering them. A missing name renders as
   the Sleeper id rather than blanking the row.

A `wk{N}.json` fetch that 404s leaves the summary card in place with the drill-down
disabled. It does not blank the week.

## 9. Testing

Pure functions get unit tests with no DOM:

- `displayWeek` at each boundary in the §5 table, plus both clamps.
- `medianRosterId` for the four probed weeks in §2.1, and `null` when all six rosters
  are owned (the six-owned case the standings page already warns about).
- `lineupRows` against a fixture matching the **real** `roster_positions` — 19 starters
  and 5 bench — including a starter absent from the player map.
- `renderMatchupDetail` for both variants, including the `+20` marker on a zeroed
  starter and the pool highlighting on a median matchup.
- Existing `renderResults` tests in `test/render.test.js` are rewritten, not deleted:
  the assertions about penalties, raw-vs-adjusted display and the degenerate-week
  message still describe required behaviour.

### 9.1 What cannot be tested this session

**No 2026 week has been played.** The detail view will be exercised only against
fixtures until 2026-09-09. The one full-payload fixture in the repo
(`test/fixtures/real-week.json`) is a 17-player/10-starter roster and does **not**
match this league's 24/19 shape, so a new fixture must be built. First real proof is
week 1.

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| Sleeper reshuffles pairings mid-season | The snapshot refetches all 18 weeks every run, so the file self-heals on the next cron. |
| 18 extra API calls trip the rate limit | The client already enforces a minimum interval and single-flight; the Action is not latency-sensitive. Sleeper's limit is ~1000/min. |
| `roster-players.json` misses a name | Renders the Sleeper id, which is ugly but honest, rather than blanking. |
| Detail view is wrong in ways fixtures cannot reveal | Explicitly accepted. Stated in §9.1; verify against week 1. |
