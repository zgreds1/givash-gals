# Givash Gals — URL Routing, Compact Scores, Hover Explanations

Status: approved 2026-09-10.
Extends `2026-09-10-phased-penalties-and-results-home-design.md`, which shipped
the three scores this spec now compresses.

## 1. Problem

Four changes, requested together.

1. **Every view needs its own URL**, so the browser back button works. Today a
   tab click, a week change and a drill-down all mutate in-memory state and
   leave the address bar untouched, so Back leaves the site entirely.
2. **The three-score explanations move to hover**, replacing the `<details>` key
   panel that currently sits above the cards.
3. **The card collapses to one score line per team.** No `in play` row of its
   own, no `adjusted`/`raw` labels. The line reads `<in play> (<adjusted>)`.
4. **`raw` needs somewhere to go** — it goes into the hover.

Plus a fifth, found while investigating a stale Players tab (§7).

Items 1 and 3 interact in a way that is not obvious and is the most useful thing
in this spec: routing is what makes the hover possible at all. See §5.

## 2. What the card becomes

Per team, one line:

| Week state | Renders | Why |
|---|---|---|
| Open | `118.40 (98.40)` | in play, with adjusted parenthesised |
| Settled | `118.40` | in play **is** adjusted; `118.40 (118.40)` would be noise |

Dropping the parenthetical when settled is not only tidier — **its presence is a
fourth non-colour carrier of live-vs-settled**, alongside the dashed rule, the
hollow ring and the word "leading". A card with brackets is still moving.

Deleted: `scoreKey()` and its `<details>` panel, `SCORE_ROWS`, the shared label
column, and the `finished games` / `+ in progress` / `no +20s` captions.

`raw` no longer appears on the card. It appears in the hover (§5) and in the
drill-down, which keeps its three-row ladder — there is room there and no hover
is needed.

The provisional leader is still decided on `in play`, unchanged from the
previous spec §5.2.

## 3. Routing — `router.js`

A new module, pure except for one listener.

    parseHash(hash)  -> { tab, week, matchup }
    formatHash(view) -> '#/results/week/3/matchup/1'

Routes:

    #/results                              tab, default week from seasonStart
    #/results/week/3                       explicit week
    #/results/week/3/matchup/1             drill-down
    #/standings   #/players   #/rules      the other tabs

Unparseable, out-of-range or unknown values fall back to `#/results` rather than
erroring — a hand-edited URL must never blank the page.

**Hash, not paths.** The site is static on GitHub Pages, where a direct request
for `/results/week/3` 404s unless a `404.html` redirect shim is committed
alongside; that shim makes cold loads flicker. Hash URLs need no server
cooperation and cannot 404.

### 3.1 The URL becomes the single source of truth

Today view state lives in three places:

- the tab, in the DOM (`.active` class plus `hidden` on each `<section>`)
- `view.week` and `view.matchup`, in a closure inside `mountResults`
  (`results-view.js:638`)
- `weekChosen` (`results-view.js:622`), a flag meaning "has the visitor picked a
  week yet", which gates whether `paint()` recomputes the default

After this change there is one place. `hashchange` parses the URL and drives the
render; clicks *write* the URL and let the resulting `hashchange` do the render.

`weekChosen` disappears entirely. "No week in the URL" **is** the
default-week case, so the flag it stood in for is now expressed by the URL's own
shape rather than by a parallel boolean that could disagree with it.

### 3.2 What is addressable, and what is not

**Navigation gets URLs. Filters do not.**

Addressable: tab, week, matchup.
Not addressable: the Players tab's season picker, its search box, its
minimum-games stepper.

Drawn there because a search field that writes history makes Back useless —
every keystroke becomes an entry to step through. The season picker is on the
filter side of that line by consistency with the other two controls on the same
tab, not because it is less navigational.

### 3.3 No loops

Setting `location.hash` fires `hashchange`, which renders. Render never writes
the hash. That one-way rule is what keeps the cycle from closing.

A click that would produce the URL already showing is a no-op rather than a
duplicate history entry.

## 4. Navigation becomes links

Because a drill-down is now a real URL, opening one becomes an `<a href>` rather
than a JavaScript click handler on a `div[role="button"]`.

This is worth doing for its own sake — correct semantics, keyboard access,
open-in-new-tab, right-click, and middle-click all arrive free — but §5 is why
it is load-bearing.

The week picker's buttons and the drill-down's back control become links too.
The tab bar keeps `role="tab"` semantics, since a tablist is not a set of
document links, but each tab's activation writes the URL.

## 5. The hover, and why routing had to come first

The requirement is "hovering over a score says the explanation."

**The obstacle:** the card is currently `div[role="button"] tabindex="0"`. An
interactive element cannot be nested inside another interactive element — it is
invalid HTML and it breaks keyboard navigation. So as the card stands, a score
cannot be its own hover-and-focus target.

**The resolution:** §4 replaces the card-as-button with a link. A stretched link
covers the card for the click target, and the scores sit *above* it in stacking
order as siblings rather than descendants. Nothing is nested inside anything
interactive, so each score can be a real `<button type="button">`.

    ┌ card ─────────────────────────────────┐
    │  <a> stretched to cover the card ─────┼─ click anywhere → opens matchup
    │                                       │
    │  LilDaveIII   [118.40 (98.40)] ←──────┼─ <button>, above the link
    │  Nsaker       [133.60 (113.60)]       │   hover / focus / tap → explanation
    └───────────────────────────────────────┘

Behaviour, all three input modes:

| Input | On a score | Elsewhere on the card |
|---|---|---|
| Mouse | hover shows the explanation | click opens the matchup |
| Keyboard | focus shows the explanation | Enter on the link opens it |
| Touch | tap shows the explanation | tap opens the matchup |

**Touch is why the button matters.** Hover does not exist on a phone, and this
site is read on a phone during games. The same element responding to tap is not
a substitute for hover — it is hover, made to work where hover cannot.

### 5.1 The explanation

    in play    118.40   if it ended now
    adjusted    98.40   finished games only
    raw         78.40   no +20s at all

Delivered as a `role="tooltip"` element referenced by `aria-describedby` on the
score button, shown on `:hover`, on `:focus-visible`, and while the button is
toggled on. It is in the DOM at all times so screen readers can reach it,
visually hidden until shown.

On a settled week the `in play` line is omitted, matching the card.

### 5.2 Cost accepted

Three tab stops per card instead of one — the link plus two score buttons.
Nine per week at three matchups. Every one lands on something that does
something, which is the bar for a tab stop.

## 6. Deep links and first load

A cold load of `#/results/week/3/matchup/1` must render that view directly, not
render the default and then correct itself.

Ordering: parse the hash first, then `loadSnapshot()`, then mount the tab the
URL names. The Results mount already happens after the snapshot resolves
(previous spec §5.1) to avoid painting an empty state and repainting; that
ordering is unchanged, the mount target just comes from the URL.

A URL naming a week the snapshot has no data for renders that week's "not
published yet" state, exactly as clicking to it would.

## 7. The Players tab

Two changes, from a stale-archive investigation that turned out to be a wider
gap than the symptom suggested.

### 7.1 The cron ladder misses four days a week

Verified against the committed schedule on 2026-09-10:

    games by weekday, full season:  Sun 228 · Thu 20 · Mon 17 · Fri 4 · Wed 2 · Sat 2
    weeks containing a Thursday game:  17 of 18

    cron coverage before:  Sun 17-23 UTC · Mon 00-04 UTC · Tue 06 UTC · Tue 13 UTC

Nothing runs Wednesday through Saturday. **Thursday Night Football happens in 17
of 18 weeks and is never snapshotted**, so its results sit invisible in the
archive until Sunday afternoon.

Results does not care — it re-fetches the current week live. The Players
leaderboard does, because it is aggregated across weeks by the Action and never
computed in the browser.

Add:

    - cron: '0 6 * * 3,4,5,6'   # Wed-Sat 06:00 UTC — the morning after TNF
                                # and any midweek game

TNF kicks at 20:15 ET Thursday — 00:15 UTC Friday on EDT, 01:15 on EST — and
ends around 03:35–04:40 UTC. A 06:00 UTC Friday run clears it in either regime.
Combined with the existing entries this is daily coverage.

The root cause is worth recording: the ladder was designed around *when the
standings need to be right*, and the standings only care about completed weeks.
The leaderboard has a different freshness requirement — it wants every game, not
every week — and inherited a schedule built for the other consumer.

### 7.2 Open on a season that has data

`mountLeaderboard` currently opens on the newest entry in `LEADERBOARD_SEASONS`.
Early in a season that is an empty board reading "No games played yet in 2026",
with 2025's 709 players one unobvious click away.

It will instead open on the newest season whose board has rows, falling back
through the list. One extra fetch, and only when the newest season is empty.
Once the current season has data it wins again with no further requests.

This is a safety net, not the fix for the observed symptom — §7.1 is.

## 8. Testing

`router.js` is pure, so `parseHash`/`formatHash` take direct unit tests:
round-tripping, every route shape, and the malformed inputs that must fall back
to `#/results` rather than throw.

Behavioural coverage, through the existing stub-element technique:

- a hash naming a week renders that week; a hash naming a matchup renders the
  drill-down; a hash naming neither renders the default week
- `hashchange` re-renders without a click
- clicking a week writes the URL and does not render directly
- re-clicking the current view adds no history entry
- the score button's `aria-describedby` resolves to the tooltip, and the tooltip
  omits `in play` on a settled week
- a settled card renders `118.40` with no parenthetical; an open card renders
  `118.40 (98.40)`
- `mountLeaderboard` skips an empty season and opens on one with rows

Every `doesNotMatch` assertion carries a positive anchor on the same value —
three reviews on the previous branch found absence-only tests that passed on an
empty render.

## 9. Consequences accepted

- **This deletes shipped, reviewed work.** The `<details>` key panel and the
  three-row ladder were built and reviewed across two tasks on the previous
  branch. They are replaced deliberately.
- **`#` in every URL.** The cost of not needing server cooperation.
- **Three tab stops per card**, up from one (§5.2).
- **Filters are not addressable** (§3.2), so a shared link does not carry the
  recipient's search or season.
- **Hover explanations are invisible until interacted with.** The `<details>`
  panel was readable at a glance without action; a tooltip is not. That is the
  trade the request asks for, and the drill-down still explains everything in
  plain sight.
- **The daily cron roughly doubles Action runs**, from about 13 a week to about
  17. Each is a handful of API calls well inside Sleeper's limits.
