# Givash Gals — Phased Penalties, Three Scores, Results as Home

Status: approved 2026-09-10.
Supersedes nothing; extends `2026-09-01-results-week-view-design.md`.

## 1. Problem

Five changes, requested together, that share one root cause.

1. Results should be the home page, not Standings.
2. Player names must not appear on the Results page. Seeing them requires
   clicking into a matchup.
3. Standings must only absorb a week from **Tuesday 10:00 Israel time**, because
   the week's games are not over before then.
4. A starter's +20 must not apply until **that player's own NFL game is
   complete**.
5. Each team on the Results page shows **three** scores, not one.

Items 3, 4 and 5 all say the same thing: a score is no longer a pure function of
a matchup payload. It now depends on **when you look at it**. `rules.js` has
never had that axis — its header promises "no I/O, no DOM, no clock" — so the
whole design is about admitting time without breaking that promise.

## 2. The three scores

Named, in the order they print, using the manager's own enumeration:

| # | Label | Rule | Used for |
|---|-------|------|----------|
| 1 | `adjusted` | raw + 20 per zeroed starter whose game has **finished** | The official score. Feeds standings, records, the median line. |
| 2 | `in play` | `adjusted` + 20 per zeroed starter whose game is **in progress** | Who is ahead if everything ended this second. Decides the provisional leader. |
| 3 | `raw` | starter points alone, no +20 of any kind | Context. |

A starter whose game **has not kicked off** counts toward neither 1 nor 2, even
if he currently shows 0.

Therefore `raw ≤ adjusted ≤ in play`, and once every relevant game is complete
`adjusted === in play` by construction. That identity is what makes the
provisional leader safe: the mark never jumps sides when it turns solid.

Worked example, LilDaveIII on a Sunday afternoon, raw 78.40:

    Deshaun Watson    0.00   game finished        -> +20
    Jonah Coleman     0.00   game in progress     -> +20 (pending)
    Travis Hunter     0.00   kicks off Monday     -> nothing
    C.J. Stroud      18.40
    ...

    adjusted =  98.40   (78.40 + 20)
    in play  = 118.40   (78.40 + 40)
    raw      =  78.40

`adjusted` keeps its existing name deliberately. `RULES.md`, the `rules.js`
field, and the standings column `Adj PF` all already say adjusted; renaming it
to "calculated" would desync three documents for no behaviour change.

## 3. Verified facts

Each was checked against the live API or the repository on 2026-09-10, not
assumed.

**3.1 Sleeper's schedule endpoint reports live game status.** `app.js` currently
claims the endpoint is "immutable for the season" and reads it from the
committed snapshot. The fixtures are immutable; `status` is not:

    committed data/raw/schedule.json (Sep 1):  { pre_game: 272, canceled: 1 }
    live /schedule/nfl/regular/2026 (Sep 10):  { pre_game: 271, complete: 1, canceled: 1 }

**3.2 Observed status values** are `pre_game`, `complete` and `canceled`.
`in_game` is documented by convention but was not observable at check time, so
the mapping is defensive rather than exhaustive (§4.1).

**3.3 The schedule carries a date but no kickoff time.** Per-game state must
come from `status`; it cannot be derived from a clock.

**3.4 A canceled game exists this season** — DAL/SEA, week 6, `game_id`
202610609. It is not hypothetical and must be handled.

**3.5 The week's calendar boundary is Wednesday.** `test/results-view.test.js`
already pins "Tue 15 Sep is still week 1; Wed 16 Sep opens week 2". A Tuesday
10:00 gate therefore fires *inside* week N's own display window: on Tuesday
morning the standings absorb week N while Results still shows it.

**3.6 The Israel gate opens before the archive is ready.** Tue 10:00 Israel is
Tue 03:00 ET. `snapshot.yml`'s cron ladder is Sun 13:00–19:00 ET, Sun 20:00–Mon
00:00 ET, then Tue 09:00 ET. The last run before the gate is **Monday midnight
ET, before Monday Night Football kicks off**. Without §7.2 this ships a
standings table missing MNF for six hours every week.

**3.7 Baseline is 192 passing tests.**

## 4. Engine changes — `rules.js`

Time enters as **data**, through the same seam `opportunities` already uses. The
module keeps its no-clock promise.

### 4.1 `gameStates(schedule, week)`

New pure export. Returns `Map<nflTeam, 'final'|'live'|'upcoming'>`.

    complete | canceled  -> 'final'
    pre_game             -> 'upcoming'
    anything else        -> 'live'
    team absent          -> no entry (bye)

The catch-all maps to `'live'` on purpose. An unexpected value — `halftime`,
`postponed`, a future rename — must fail toward "no penalty yet" rather than
invent 20 points. Inventing points is the only unrecoverable error here.

`byeTeams` is unchanged and still used for the DEF exemption. A team with no
entry in this map is on bye.

A companion export, `allGamesFinal(states)`, returns true when no entry is
`live` or `upcoming`. §5.2 uses it to decide whether a card is settled.

### 4.2 Penalty phase

Every starter that scores exactly 0 and is not already exempt (DEF not on bye,
or an opportunity recorded) is assigned a phase:

| Starter | Phase | Reason |
|---------|-------|--------|
| Empty slot | `final` | `RULES.md`: no opportunity can rescue an empty slot. |
| NFL team on bye | `final` | Absence, settled from kickoff. Preserves the bye-DEF rule. |
| Game `canceled` | `final` | The game is not happening; identical to a bye. |
| Not in the player map | `final` | Absent from the slim map means inactive, which is absence. Also preserves today's `Unknown (id)` behaviour rather than silently dropping a penalty. |
| Game complete | `final` | |
| Game in progress | `live` | |
| Not kicked off | `upcoming` | Counts toward nothing. |

### 4.3 `adjustedScore` return shape

    { raw, adjusted, inPlay, penalties: [{ playerId, name, reason, phase }] }

- `adjusted` = raw + 20 × (`final` penalties)
- `inPlay` = raw + 20 × (`final` + `live` penalties)
- `upcoming` penalties are recorded in the array (the drill-down shows them) but
  add to neither total.

Signature gains one optional trailing parameter:

    adjustedScore(entry, byes, players, opportunities = new Set(), states = null)

**`states = null` means "treat every game as final."** This single default is
what keeps the change additive: `--replay`, the 2025 archive, `snapshot.mjs`
and all 192 existing tests keep their current answers with no edit.

### 4.4 `resolveWeek`

Gains the same optional trailing `states` parameter and passes it down.
`teams[rosterId]` gains `inPlay`.

**No second set of matchups is emitted.** Emitting an official and a provisional
matchup array would roughly double `weeks.json` and defeat `writeStamped`'s
change-detection, filling history with churn. `resolveWeek` continues to compute
winners, the median line and the median result from `adjusted` only. The browser
derives the provisional picture at render time (§5.2).

### 4.5 `medianLine(values)`

New pure export: given an array of adjusted scores, return the average of the
2nd and 3rd highest, or `null` unless there are exactly four.

This is extracted, not invented. `rules.js:229` computes it and
`results-view.js:147` re-derives the same "indices 1 and 2" rule for display.
The view now needs a third caller for the in-play line, so one implementation
replaces what would otherwise be three.

## 5. View changes

### 5.1 Results becomes the home page

- `index.html`: Results tab moves first, takes `class="active"` and
  `aria-selected="true"`; Standings loses both. The `<section>` elements are
  reordered to match, so DOM order matches tab order.
- `#results` starts visible; `#standings` starts `hidden`.
- `app.js` mounts Results **immediately after `loadSnapshot()` resolves**, not on
  first click. Mounting before the snapshot lands would paint "not published
  yet" and then repaint — a visible flash on the landing view.
- Players stays lazily mounted; Rules is still rendered eagerly inside `paint()`,
  unchanged. `roster-players.json` is still fetched only on drill-down, so the
  only new critical-path request is `pairings.json` (2.4 KB, same origin).
- `<title>` and the meta description lead with results.

### 5.2 The matchup card

Three rows, always, in the order of §2. Nothing appears or disappears between
states; only the numbers, the emphasis and the rule style change.

Layout reuses the `left │ label │ right` grid `lineupTable` already establishes,
so each label prints once and both score columns stay tabular.

    ┌ in progress ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
       ○ LilDaveIII  leading                     Nsaker
            98.40      adjusted                  113.60
                       finished games
           118.40      in play                   133.60      <- decides
                       + in progress
            78.40      raw                        93.60
    └┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈›

**Emphasis is weight and ink, never size.** The deciding row — `in play` while
open, `adjusted` once settled — takes full ink and 600 weight. A size jump would
make a larger number read as "winning" in a league where low wins.

**A card is "settled" when every game in that week's schedule is final** — no
entry in `gameStates` maps to `live` or `upcoming`. This is deliberately *not*
the Tuesday gate: the card answers "can these numbers still change?", which is a
question about games, while the gate answers "does this count yet?", which is a
question about the clock. They normally coincide; a postponed game is exactly
the case where they must not. If the schedule is unavailable — the live fetch
failed and the committed copy is stale — the card falls back to
`isWeekFinal` so it degrades to the gate rather than showing a finished week as
permanently in progress.

**The provisional leader is judged on `in play`**, computed in the view:

- head-to-head: lower `inPlay` leads; equal is neither.
- median: the in-play line comes from `medianLine` over the four head-to-head
  teams' `inPlay` values; the median team leads if below it.

Once the week is final these agree with the engine's official result by the
identity in §2.

**Four carriers of settled-vs-open, none of them colour alone:**

1. Card's top rule: `solid` when settled, `dashed` while open.
2. Mark: hollow ring vs the existing solid check SVG.
3. Word: visible `leading` vs the existing visually-hidden `Winner`.
4. One `role="status" aria-atomic="true"` per week — *"Week 1 in progress.
   Leader shown on in play. Standings update Tuesday 10:00."*

Carrier 4 is a requirement, not a nicety: `ui-ux-pro-max` rates *Contextual Live
Badge Updates* High — one atomic status message, never a live region per number.
Six independently-announcing scores on a page that repaints during games would
be unusable with a screen reader.

### 5.3 Player names leave the card

`penaltyList` is **deleted**, along with its `.penalties` CSS. Nothing replaces
it on the card: the penalty total is already visible as `adjusted − raw`, and
the drill-down explains it properly.

A persistent `›` chevron is added to every clickable card. Today `.card.clickable`
signals itself only through `:hover` border-colour (`style.css:603`), which means
**on a touch device there is currently no affordance at all** that a card opens.
`ui-ux-pro-max` rates *Hover vs Tap* High. Requirement 2 makes the click
mandatory, so the affordance must be persistent.

### 5.4 The key panel

A `<details open>` above the cards, inside the Results view, listing all three
definitions in plain language. Not a tooltip — the site is read on phones during
games, where hover does not exist. `<details>` needs no JavaScript and is
keyboard- and screen-reader-native.

Each card label also carries a three-word caption: `finished games`,
`+ in progress`, `no +20s`.

### 5.5 The drill-down

Its header carries the **same three-row ladder** as the card, built from the same
function, so a click never changes which numbers are on screen — only what is
underneath them. For a median matchup the right-hand column keeps the line, its
`avg of 2nd & 3rd` sub-label and the four-score pool, and gains the in-play line
alongside the adjusted one.

Each starter gains phase tagging, which is the only place the difference between
the three scores is explained per player:

| Tag | Meaning |
|-----|---------|
| solid `+20` | `final` — locked, counts in `adjusted` |
| dashed `+20` | `live` — pending, counts in `in play` only, can still evaporate |
| dotted `not started` | `upcoming` — counts in neither |

The third tag deliberately does not name the kickoff day. The day would have to
be plumbed from the schedule into every lineup row, and "not started" already
says the only thing that matters: this zero is in neither total yet.

An exempt DEF gets no tag, unchanged.

### 5.6 Standings

- Caption becomes `Standings — lowest adjusted points wins, through week N`.
- A line beneath states when the next week joins: *"Week 2 joins Tuesday 22
  September, 10:00."*
- When no week has passed its gate, the existing empty state is shown.

## 6. The gate — new module `season.js`

`rules.js` promises no clock, and `displayWeek` already lives in
`results-view.js`. Putting the gate in either scatters the season calendar
across three files. One module owns week ↔ calendar arithmetic:

    displayWeek(now, seasonStart, lastWeek)   // moved verbatim from results-view.js
    weekGate(week, seasonStart)               // -> 2026091510
    isWeekFinal(week, seasonStart, now)
    finalWeeks(weeks, seasonStart, now)

`results-view.js` re-exports `displayWeek` so existing imports and tests keep
working; it is 25 KB and already doing too much, so this is a net reduction.

### 6.1 Gate arithmetic

Week N's gate is `seasonStart + (7N − 1) days`, at 10:00 Asia/Jerusalem.
`seasonStart` is Wednesday 2026-09-09, so `+6` days is Tuesday 2026-09-15 for
week 1, `+13` is Tuesday 2026-09-22 for week 2, and so on — every gate lands on
a Tuesday by construction, with no weekday arithmetic to get wrong.

### 6.2 Timezone, without a library

Never compute an offset. Format `now` into Jerusalem **wall-clock** parts with
`Intl.DateTimeFormat`, compose a comparable `YYYYMMDDHH` integer, and compare it
against the gate's `YYYYMMDD10`. DST becomes the formatter's problem.

Verified across Israel's 25 Oct 2026 DST end:

| Week | Gate | Fires at | Offset |
|------|------|----------|--------|
| 1 | Tue 15 Sep 10:00 | 07:00 UTC | UTC+3 (IDT) |
| 7 | Tue 27 Oct 10:00 | 08:00 UTC | UTC+2 (IST) |

The one-hour shift is absorbed with no branch and no dependency. The function
stays pure because `now` is an argument.

### 6.3 Degradation

If `seasonStart` is null — an old snapshot, or a `--replay` predating it —
**every week counts**. Blanking the standings on missing metadata would be worse
than the pre-change behaviour.

### 6.4 Application

`paint()` in `app.js` becomes:

    standings(finalWeeks(state.weeks, state.seasonStart, new Date()))

Only `standings` is gated. Results always shows live numbers; that is the whole
point of splitting the two.

## 7. Data and automation

### 7.1 The browser fetches the schedule live

`refreshLive` gains a fourth Sleeper call, `client.schedule()`, falling back to
the committed `data/raw/schedule.json` on any failure. Without it the browser
reads a snapshot up to an hour stale during Sunday games and applies +20s late.

Consequences: `app.js:99-105`'s "immutable for the season" comment is wrong and
is rewritten; `README.md`'s "three API calls per load" becomes four; the added
payload is ~27 KB.

### 7.2 The Action gains a cron

Per §3.6, add to `.github/workflows/snapshot.yml`:

    - cron: '0 6 * * 2'    # Tue 06:00 UTC — after the MNF whistle, before the gate

The existing Tue 09:00 ET run is kept for stat corrections.

**Corrected after the whole-branch review; the original value was 05:00 UTC.**
That figure was EDT arithmetic. §6.2's DST table analyses *Israel's* change and
never considered the United States': US DST ends Sunday 1 November 2026, inside
week 8, so from week 8 through week 18 Monday Night Football kicks at 20:15 EST
and ends nearer 04:25–04:40 UTC. Against a 05:00 UTC run that leaves about
twenty-five minutes — before Sleeper has to flip `status` to `complete`, and
less than nothing if the game goes to overtime.

The two windows the run has to fit between therefore each move by an hour, in
opposite halves of the season:

| | Weeks 1–7 | Weeks 8–18 |
|---|---|---|
| MNF ends (approx) | 03:35 UTC (EDT) | 04:25–04:40 UTC (EST) |
| Israel gate opens | 07:00 UTC (IDT) | 08:00 UTC (IST, after 25 Oct) |
| Run at 06:00 UTC | +2h25m after, 1h before | +1h20m after, 2h before |

06:00 UTC clears the whistle by at least 1h20m and beats the gate by at least
an hour in every week of the season. 05:00 UTC does neither for eleven of them.

### 7.3 `snapshot.mjs`

`buildSnapshot` passes `gameStates(schedule, w)` into `resolveWeek` for each
week. Since the Action already re-fetches and rewrites `data/raw/schedule.json`
on every non-replay run, archived weeks converge on all-final as the season
progresses, and a `--replay` of a finished season reproduces it exactly.

`weeks.json` grows by one number per team per week.

## 8. Testing

Every existing test must still pass unedited except where a signature moved
(`displayWeek`'s import) or a rendered string changed by design.

New coverage:

- `gameStates`: each status value; the catch-all mapping an unknown string to
  `live`; a bye team absent from the map; the real week-6 canceled game.
- `allGamesFinal`: true on an all-complete week; false when one game is
  `pre_game` and again when one is `live`; true on a week mixing `complete` and
  `canceled`.
- Card state: a settled card drawn for an all-final week; an in-progress card for
  a week holding one unplayed game **even after its Tuesday gate has passed**
  (the postponed-game case); the fallback to `isWeekFinal` when no schedule is
  available.
- Phase assignment: one case per row of §4.2's table.
- `adjustedScore`: `raw ≤ adjusted ≤ inPlay`; `adjusted === inPlay` when all
  games are final; `upcoming` zeros counted nowhere; `states = null` reproducing
  today's numbers on an existing fixture.
- `medianLine`: extracted behaviour identical to the current inline computation;
  `null` on a pool that is not exactly four.
- `weekGate` / `isWeekFinal`: the boundary minute on both sides for a week
  before and a week after the DST change (the table in §6.2); null `seasonStart`
  passing every week.
- `finalWeeks`: a mid-season `now` admitting exactly the weeks whose gate has
  passed.
- Card rendering: three rows in both states; no player name anywhere in the
  card's HTML; the chevron present on clickable cards only; the provisional
  leader following `inPlay` and disagreeing with `adjusted` where they differ.
- Drill-down: all three phase tags rendered.

## 9. Consequences accepted

- **The Results home page costs one extra critical-path request** (`pairings.json`,
  2.4 KB, same origin).
- **One extra Sleeper call per page load**, four instead of three.
- **`adjusted` changes meaning mid-week.** During a live week it is lower than
  today's number, because pending zeros are excluded. This is requirement 4, and
  the standings gate means no standings figure is ever computed from a
  part-scored week.
- **Tuesday stat corrections are still not chased.** The NFL revises stats on
  Tuesday and Wednesday, and a correction landing after the Tue 09:00 ET run is
  not picked up until the following Sunday. This is pre-existing behaviour, not
  introduced here, and is out of scope.
- **An unknown player is penalised immediately.** Preserves today's behaviour and
  fails toward the rule's intent — absence is the thing being punished.
