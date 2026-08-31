# Givash Gals — Player Leaderboard

**Date:** 2026-08-31
**League:** `Givash Gals`, Sleeper league `1395797781926408192`
**Status:** Design approved, pending implementation plan
**Builds on:** `docs/superpowers/specs/2026-08-19-givash-gals-standings-design.md`

## 1. Problem

The site publishes standings but says nothing about individual players. In an
inverted league the interesting question is the opposite of the usual one: not
who scores the most, but who reliably scores nothing — and, on the waiver wire,
which of those players is still available.



## 2. Scope

A **Players** tab on the live site, in the shape of Sleeper's own leaderboard:

- Two seasons behind a toggle — **2026** (live, filled in weekly) and **2025**
  (static history).
- Filterable by **availability**: all players, free agents only, or one manager's
  roster.
- League-adjusted columns only: `GP`, `Raw`, `+20s`, `True +20s`, `Saved`,
  `Adj Total`, `PPG`. No NFL box-score columns.
- **Only players with at least one game played that season appear.** Rookies and
  full-season absentees are absent by design; every row carries real numbers and
  nothing is a placeholder.

Explicitly out of scope: per-position box-score columns, a watch list, trends or
sparklines, projections, and any write operation against Sleeper.

## 3. Verified facts

Confirmed on 2026-08-31:

| Fact | Value |
| --- | --- |
| 2025 players with at least one game | 709 — WR 254, RB 154, TE 146, QB 81, K 42, DEF 32 |
| Serialised size of those rows, compact | ~92 KB |
| Size on disk, as written | **165 KB** — `writeStamped` pretty-prints (see §4.1) |
| `data/raw/*.json` present | `rosters`, `users`, `schedule` only |
| `wk{N}.json` / `opps{N}.json` present | **none** — the season has not started |
| Rosters' `players` arrays | all empty (league is `pre_draft`) |
| Weekly stats payload | ~570 KB per week |
| Engine agreement with Sleeper `pts_std` | 293/293 exact, worst delta 0.00 |

The empty `data/raw/` is what makes §4.3 cheap. It stops being true in week 1.

## 4. Architecture

### 4.1 Two data files, fetched lazily

| File | Written by | Lifecycle |
| --- | --- | --- |
| `data/leaderboard-2025.json` | `scripts/build-leaderboard.mjs --season 2025` | Built once, committed, never rebuilt |
| `data/leaderboard-2026.json` | `scripts/snapshot.mjs`, every run | Grows weekly to ~165 KB |

Both are fetched **only when the Players tab is first opened**, and each is
fetched at most once per page load. The standings view must not pay for a
feature the visitor has not asked for.

Shape — an object, not a bare array, so the file carries its own provenance:

```json
{
  "generatedAt": "2026-08-31T09:41:24.000Z",
  "season": "2025",
  "rows": [
    { "id": "NYJ", "name": "New York Jets", "team": "NYJ", "pos": "DEF",
      "gp": 17, "raw": 55, "pen": 1, "truePen": 0, "saved": 0,
      "total": 75, "ppg": 3.24 }
  ]
}
```

`rows` is pre-sorted ascending by `total`. Field meanings are unchanged from the
local board: `total` assumes the player was started every week (a missed week
costs `+PENALTY`), `ppg` averages adjusted points over played games only,
`truePen` counts penalties earned on the field, and `saved` counts zero-point
weeks spared by the opportunity rule.

`generatedAt` is written through the existing `writeStamped` helper so an
unchanged leaderboard does not produce an empty commit.

`writeStamped` pretty-prints with a two-space indent, which is why the file is
165 KB rather than the ~92 KB the rows serialise to compact. That is
deliberate: the Action rewrites the 2026 file ~13 times a week, and a
pretty-printed diff is the difference between a legible commit and one
900-column line.

### 4.2 The 2026 build costs no extra Sleeper calls

`snapshot.mjs` already fetches `/v1/stats/nfl/regular/{season}/{week}` for every
week `1..current` on every run — every week, every run, because Sleeper issues
retroactive stat corrections days after a game. It currently discards all of it
except a list of player ids. It will now also aggregate the leaderboard from
stats it already holds.

One genuinely new call per run: `/v1/league/{id}` for `scoring_settings`. Nine
calls a week against a ~1000/min limit. Only `{ scoring_settings }` is archived
to `data/raw/league.json`: the full league object carries `last_message_id` and
`last_message_time`, which change whenever anyone posts in the league chat, and
the Action's blanket `git add data/` would commit that churn for no reader. A
run that gets a league object with no `scoring_settings` fails immediately, in
front of the week loop, rather than throwing `Object.entries(undefined)` three
weeks in with `wk{N}.json` already rewritten.

**Both seasons are scored with the current league's scoring map.** The 2025
board answers "what would this player have been worth in *our* league", not
"what were they worth in whatever league they were in". Should the league change
its scoring settings, the 2025 file is stale until rebuilt by hand — an accepted
consequence, recorded in §7.

### 4.3 The week archive: two files, two questions

`opps{N}.json` (an id array) **stays**, and `stats{N}.json` is added beside it:

```json
{ "4046": { "pts": 12.34, "gp": 1, "opp": 1 } }
```

`pts` is the **raw** score under the league scoring map, before any penalty;
`gp` is Sleeper's games-played flag; `opp` is 1 when the player had a scoring
chance. Adjustment stays in `leaderboard.js`, so a change to the penalty never
invalidates the archive.

An earlier draft of this section replaced `opps{N}.json` outright, on the
grounds that two parallel per-week archive formats are one more thing to keep
in step. That was wrong, because the two files answer different questions and
so cannot be derived from one another:

- **`opps{N}.json` — the penalty rule.** Every id in the *raw* payload with a
  catch, pass completion, rush attempt, FG attempt or XP attempt, sorted. It is
  written before any slimming, ungated by `gp` and ungated by the player map,
  because the rule asks only whether a chance existed. Deriving it from the
  slim week would inherit `slimWeek`'s `gp >= 1` gate, and Sleeper's `gp` flag
  lags an in-progress game — the Sunday cron would archive an empty set and
  publish `+20`s that `app.js`'s live refresh, which reads `opportunitySet`
  straight off the raw payload, correctly withholds. Snapshot and live page
  would disagree on the load-bearing rule until Tuesday. `opportunitySet` in
  `rules.js` remains the single definition; `snapshot.mjs` only sorts its
  output.
- **`stats{N}.json` — the leaderboard.** Gated on `gp >= 1`, because the
  leaderboard counts games played, and restricted to ids `players-all.json`
  can name (§4.4). Measured against the real 2025 payloads: ~15 KB per week,
  **270 KB** for a full 18-week season.

Both exist so `--replay` still works offline. **No migration is required**:
`data/raw/` currently holds no week files at all.

### 4.4 Code layout

| File | Status | Responsibility |
| --- | --- | --- |
| `rules.js` | modified | Gains `hadOpportunity(stats)`. `opportunitySet` becomes a thin wrapper over it. |
| `leaderboard.js` | new, pure | `scoreWeek`, `adjustWeek`, `buildLeaderboard`, `slimWeek`, `slimForLeaderboard`. Imports the opportunity rule from `rules.js`. |
| `scripts/build-leaderboard.mjs` | new, committed | Season-agnostic CLI: `--season`, `--refresh`, `--saved-log`. Fetches past seasons with bare `fetch` — every path on the `sleeper.js` client hardcodes the current `SEASON`. |
| `scripts/snapshot.mjs` | modified | Writes `opps{N}.json`, `stats{N}.json`, `data/players-all.json` and `data/leaderboard-2026.json`. |
| `leaderboard-view.js` | new | The Players tab: a pure `selectRows` / `renderLeaderboard` pair plus a `mountLeaderboard` controller. |
| `index.html`, `style.css`, `app.js` | modified | Nav entry, styles, lazy mount. |
| `scripts/build-last-season.mjs` | retired | Superseded by `build-leaderboard.mjs`. |

**One definition of the opportunity rule.** It currently exists twice — in
`rules.js` and again in the local script. The duplicate is deleted, not copied
forward. A rule with two implementations will eventually have two behaviours.

**Two player maps, one Sleeper call.** `refreshPlayers` cuts both from the same
`/v1/players/nfl` payload:

| File | Filter | Size | Read by |
| --- | --- | --- | --- |
| `data/players-slim.json` | fantasy positions **and** `active` | 3231 entries, 179 KB | the standings engine, and `app.js` on **every page load** |
| `data/players-all.json` | fantasy positions only | 4265 entries, 233 KB | `slimWeek` and `buildSeasonLeaderboard`, at build time only |

Sleeper flips `active` to false the moment a player is cut. Building the season
board off the active-filtered map therefore erases a cut player's rows
entirely — his games and his accumulated `+20`s vanish from
`leaderboard-{season}.json` even though the archives still hold them, and those
are exactly the players this site exists to name.

The obvious fix — drop the `active` filter from `slimPlayers` — is the wrong
one: it would widen the map the browser downloads on every visit by ~57 KB to
solve a build-time problem. Hence two maps. `players-slim.json` is unchanged,
and `players-all.json` is never fetched by the browser.

`--replay` reads `players-all.json` too, and falls back to `players-slim.json`
with a printed warning if it is absent rather than crashing.

`last-season.html` and `last-season-saved.json` remain on disk, untouched and
still excluded from git. Nothing deletes them.

### 4.5 Ownership and the free-agent filter

Ownership is the union of every roster's `players` array. A player in no array
is a free agent.

**Rosters are fetched live from Sleeper when the tab is first opened**, not read
from `data/raw/rosters.json`. The cron covers Sunday evening through Tuesday
afternoon; a snapshot copy would be stale Wednesday through Saturday, which is
precisely when the waiver wire is being scouted. The committed copy is the
fallback when the live call fails, and the UI says which one it used.

The dropdown offers **All players**, **Free agents**, and one entry per manager,
labelled with the team names already in `data/standings.json`. An **Owner**
column shows the team name or `FA`. The filter applies to both season tabs:
"which currently-available player was worst last year" is the use case.

**Pre-draft the filter is inert.** Every `players` array is empty until the
draft, so Free agents and All are the same list. The view states this on screen
rather than letting a correct-but-identical list look broken.

### 4.6 The view

Controls, in one bar: season toggle `2026 | 2025`; position tabs
`All / QB / RB / WR / TE / FLEX / K / DEF`; the ownership dropdown; a
`Total | PPG` metric switch with the minimum-games stepper (§4.7) shown only
for PPG; a search box over name and team.

Columns are `#`, `Player`, `Team`, `Pos`, `Owner`, `GP`, `Raw`, `+20s`,
`True +20s`, `Saved`, `Adj Total`, `PPG`.

**Sorting.** Two modes. By default the table is sorted ascending by the active
metric — `Adj Total` or `PPG` — so rank 1 is the worst scorer, which in this
league is the top of the board. Clicking a column header overrides that: first
click sorts ascending, second descending, third clears back to the metric sort.
Ascending first on every column, for the same reason. `#` and `Owner` are not
sortable — `#` is not data, and the ownership dropdown groups by manager better
than a sort would.

**Ties break by adjusted total, worst first.** The comparator itself has no
tiebreaker; this holds because `Array.prototype.sort` is stable and `rows`
arrives pre-sorted ascending by `total` (§4.1). That is currently an accident of
two details lining up, so it is stated here and pinned by a test (§6.9) rather
than left to chance.

Filtering runs before sorting, and `#` is row position in the result — not a
global rank — so it always reads 1..N over what is on screen.

Filtering and sorting live in `selectRows(rows, view)`, a pure function the
tests call directly. `mountLeaderboard` owns the DOM and nothing else.

### 4.7 The minimum-games stepper

Shown only in PPG mode. A `−` button, a readout, and a `+` button:

    −  1+ games  +

**It defaults to 1**, so nothing is hidden until you choose to hide it. Each
press moves by one game. The range is 1 to the highest `gp` present in the
season's rows, and the buttons disable at each end rather than silently
no-opping — stepping past the top would empty the table with no explanation.

At 1 the PPG board is topped by players with a single game. That is understood
and intended: the stepper exists so the threshold is raised deliberately and
visibly, one game at a time, instead of being imposed by a default the reader
never chose.

## 5. Error handling and degenerate states

| Condition | Behaviour |
| --- | --- |
| 2026 has no played weeks | "No games played yet in 2026." No empty table. |
| `leaderboard-{season}.json` missing or malformed | That season's tab shows a load error; the other season and the rest of the site are unaffected. |
| Live roster fetch fails | Fall back to `data/raw/rosters.json`, and label the ownership control as showing snapshot data. |
| Both roster sources fail | Ownership control is disabled with an explanation. Rows still render, and the Owner column reads `—`, not `FA`: availability is unknown, and `FA` in the accent colour on every row is a positive claim the page cannot make. |
| All rosters empty (pre-draft) | Free-agent option remains selectable, with the note from §4.5. |
| A player id has no entry in `players-slim.json` | Row is skipped. A row cannot be drawn without a name and position. |

All rendered strings pass through the existing `esc` helper. Player and team
names come from Sleeper and are not trusted.

## 6. Testing

`test/last-season.test.js` — 13 tests, currently local-only — moves into the
committed suite as `test/leaderboard.test.js`, retargeted at `leaderboard.js`.

New coverage:

1. `hadOpportunity` has one definition and `opportunitySet` delegates to it.
2. `slimWeek` keeps only `players-slim` ids and only `gp >= 1`.
3. **Round trip:** a leaderboard built from live stats and one rebuilt from the
   archived `stats{N}.json` are deeply equal.
4. Ownership partitioning: rostered, free agent, and the all-empty pre-draft
   case.
5. `selectRows` purity: position tabs, FLEX, search, min-games, sort direction,
   and that it never mutates its input.
6. The empty-season state renders the message, not a table.
7. Escaping: a hostile player name, team name, or **owner label** renders
   inert. The owner label comes from the caller's `teams` map, which is
   Sleeper user metadata and no more trusted than the rest.
8. `writeStamped` still suppresses a no-op leaderboard commit.
9. **Tie ordering (§4.6):** rows tied on the sort key come out ordered by
   ascending `total`. Guards the stability assumption.
10. The stepper clamps: `−` at 1 and `+` at the season's highest `gp` are both
    no-ops, and the corresponding button reports itself disabled. The markup
    lives in an exported `stepperHtml(minGp, maxGp)` — which `controls()`
    calls, so there is one copy — precisely so this is assertable without a DOM.
11. A player present in `players-all.json` but absent from `players-slim.json`
    still gets a leaderboard row, with his games and his `+20`s intact (§4.4).
12. The ids archived to `opps{N}.json` for a raw payload equal
    `opportunitySet` of that payload: a player with a catch but `gp: 0` is
    still recorded as having been involved (§4.3).
14. A target and a pass attempt do **not** exempt: a receiver targeted eight
    times who catches none, and a quarterback who goes 0-for-5, both take the
    `+20` (`RULES.md`, "The +20 penalty").
13. With ownership unknown, the Owner column renders `—` and no row claims
    `FA` (§5).

The `pts_std` sanity check moves into `build-leaderboard.mjs` unchanged and
still throws if the engine ever diverges from Sleeper on covered lines.

## 7. Consequences accepted

- The Players tab costs one Sleeper call (rosters) the first time it is opened.
  Visitors who never open it pay nothing.
- `data/` grows by roughly **880 KB** over a full season, all figures measured
  against the real 2025 payloads rather than estimated: **270 KB** of
  `stats{N}.json`, **49 KB** of `opps{N}.json`, ~330 KB of leaderboards (two
  seasons × 165 KB, pretty-printed per §4.1), and 233 KB of
  `players-all.json`. That last is not a one-off: `refreshPlayers` rewrites it
  whenever the daily stamp goes stale, so repository *history* gains a fresh
  233 KB blob per refresh day — the same property `players-slim.json` already
  had, now doubled. The per-season build cache under `data/raw-{season}/`
  is ~23 MB and is **not** committed — `.gitignore` carries `data/raw-*/`,
  which deliberately does not match the committed `data/raw/`. The repository
  stays small enough for GitHub Pages.
- 2025 is frozen. If Sleeper restates a 2025 stat, the file is only corrected by
  rerunning `build-leaderboard.mjs --season 2025 --refresh` by hand.
- Rookies never appear until they play. This was chosen deliberately over
  placeholder rows.
- **The `Team` column shows a player's *current* NFL team, not the team he
  played for in the season on screen.** Both boards are built by scoring a
  season's stats against today's `players/nfl`, so a player who has since moved
  reads with his new team, and a player currently unsigned reads `—`: 74 of the
  709 rows on the 2025 board. Searching by team is therefore wrong for anyone
  who moved. Fixing it would mean an era-correct player map per season, which
  Sleeper does not publish; the alternative — freezing a copy of `players/nfl`
  per season — was judged not worth 14.6 MB in the repository for a column that
  is decoration on a history board.
