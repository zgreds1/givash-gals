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
| Serialised size of those rows | ~92 KB |
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
| `data/leaderboard-2026.json` | `scripts/snapshot.mjs`, every run | Grows weekly to ~92 KB |

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

### 4.2 The 2026 build costs no extra Sleeper calls

`snapshot.mjs` already fetches `/v1/stats/nfl/regular/{season}/{week}` for every
week `1..current` on every run — every week, every run, because Sleeper issues
retroactive stat corrections days after a game. It currently discards all of it
except a list of player ids. It will now also aggregate the leaderboard from
stats it already holds.

One genuinely new call per run: `/v1/league/{id}` for `scoring_settings`,
archived to `data/raw/league.json`. Nine calls a week against a ~1000/min limit.

**Both seasons are scored with the current league's scoring map.** The 2025
board answers "what would this player have been worth in *our* league", not
"what were they worth in whatever league they were in". Should the league change
its scoring settings, the 2025 file is stale until rebuilt by hand — an accepted
consequence, recorded in §7.

### 4.3 The week archive becomes one file

`opps{N}.json` (an id array) is replaced by `stats{N}.json`:

```json
{ "4046": { "pts": 12.34, "gp": 1, "opp": 1 } }
```

`pts` is the **raw** score under the league scoring map, before any penalty;
`gp` is Sleeper's games-played flag; `opp` is 1 when the player had a scoring
chance. Adjustment stays in `leaderboard.js`, so a change to the penalty never
invalidates the archive.

Restricted to ids present in `data/players-slim.json` — roughly 600 entries,
~18 KB per week, ~325 KB for a full season. Starters are always fantasy-position
players, so restricting the set cannot lose an opportunity that mattered.

This exists so `--replay` still works offline. It replaces rather than
supplements `opps{N}.json` because two parallel per-week archive formats would
be one more thing to keep in step for no gain. **No migration is required**:
`data/raw/` currently holds no week files at all.

`opportunitySet` gains a sibling that reads this shape; the id set for a week is
`Object.keys(stats).filter((id) => stats[id].opp)`.

### 4.4 Code layout

| File | Status | Responsibility |
| --- | --- | --- |
| `rules.js` | modified | Gains `hadOpportunity(stats)`. `opportunitySet` becomes a thin wrapper over it. |
| `leaderboard.js` | new, pure | `scoreWeek`, `adjustWeek`, `buildLeaderboard`, `slimWeek`. Imports the opportunity rule from `rules.js`. |
| `scripts/build-leaderboard.mjs` | new, committed | Season-agnostic CLI: `--season`, `--refresh`, `--saved-log`. |
| `scripts/snapshot.mjs` | modified | Writes `stats{N}.json` and `data/leaderboard-2026.json`. |
| `leaderboard-view.js` | new | The Players tab: a pure `selectRows` / `renderLeaderboard` pair plus a `mountLeaderboard` controller. |
| `index.html`, `style.css`, `app.js` | modified | Nav entry, styles, lazy mount. |
| `scripts/build-last-season.mjs` | retired | Superseded by `build-leaderboard.mjs`. |

**One definition of the opportunity rule.** It currently exists twice — in
`rules.js` and again in the local script. The duplicate is deleted, not copied
forward. A rule with two implementations will eventually have two behaviours.

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
| Both roster sources fail | Ownership control is disabled with an explanation. Rows still render; availability is simply unknown. |
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
7. Escaping: a hostile player or team name renders inert.
8. `writeStamped` still suppresses a no-op leaderboard commit.
9. **Tie ordering (§4.6):** rows tied on the sort key come out ordered by
   ascending `total`. Guards the stability assumption.
10. The stepper clamps: `−` at 1 and `+` at the season's highest `gp` are both
    no-ops, and the corresponding button reports itself disabled.

The `pts_std` sanity check moves into `build-leaderboard.mjs` unchanged and
still throws if the engine ever diverges from Sleeper on covered lines.

## 7. Consequences accepted

- The Players tab costs one Sleeper call (rosters) the first time it is opened.
  Visitors who never open it pay nothing.
- `data/` grows by ~325 KB of week archives plus ~184 KB of leaderboards over a
  full season. The repository stays small enough for GitHub Pages.
- 2025 is frozen. If Sleeper restates a 2025 stat, the file is only corrected by
  rerunning `build-leaderboard.mjs --season 2025 --refresh` by hand.
- Rookies never appear until they play. This was chosen deliberately over
  placeholder rows.
