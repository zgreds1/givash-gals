# givash-gals

Results and standings for a Sleeper fantasy league whose format Sleeper
cannot represent: **lowest score wins**, starters who score exactly 0 add
+20, and because there are 5 managers, one team each week plays the league
median instead of an opponent.

Live at <https://zgreds1.github.io/givash-gals/>.

The league's scoring rules, with worked examples, are in [RULES.md](RULES.md)
— read that before touching `rules.js`.

## How to run

```powershell
npm test                          # engine tests, no network
node scripts/snapshot.mjs         # fetch Sleeper, write data/
node scripts/snapshot.mjs --replay  # recompute from data/raw, no network
python -m http.server 8125        # then open http://localhost:8125
```

## Dependencies

Nothing to install. Node 22 supplies `fetch` and `node:test`; the site is
vanilla ES modules with no build step.

The one runtime dependency is two Google Fonts — **Fira Sans** for prose and
**Fira Code** for every number — loaded from `fonts.googleapis.com` in
`index.html`. They are a progressive enhancement, not a requirement: the
stack falls back to the system UI sans and the system monospace, and because
the fallbacks are also tabular the tables do not reflow if the request is
blocked.

## Design

The look is an "editorial stat sheet": a light near-white ground, hairline
rules instead of boxes, and monospaced tabular numerals so columns of scores
line up. Its tokens come from the UI UX Pro Max design-system generator and
are recorded in `design-system/givash-gals/MASTER.md` — the palette, the type
pairing, the 8/10 density spacing scale.

`style.css` deviates from that file in exactly three places, all documented
in the file header: the accent, win and penalty colours are darkened, because
the generated values are *fill* colours and this site uses them as small text
on near-white, where they fail the 4.5:1 contrast floor.

Two colour meanings are load-bearing and never carried by colour alone. Green
marks the *lower* score — the winner in this league — and always arrives with
a shape and a word: a solid check mark and a visually-hidden "Winner" once the
week has finished, a hollow ring and a visible "leading" while its games are
still being played. Red marks a +20, solid once the penalty has landed and a
dashed outline while that player's game is still on, and both sit beside the
literal text `+20`; a zero whose game has not kicked off is neither, and says
"not started" in grey instead of showing a number.

Each score on a summary card carries a count of the +20s that team has
actually been charged, and the standings carry the season total in a `+20s`
column between Raw PF and vs Median. Both read the same engine field, and
both count **official** penalties only — the ones charged once a player's own
NFL game ended with nothing to his name. Pending +20s are deliberately absent
from the count: they already have a voice in the bracketed in-play score, and
counting them twice would announce a penalty as though it had happened. The
column reconciles the two beside it — `Adj PF` minus `Raw PF` is exactly 20 x
that cell — and unlike `Raw PF` it survives the phone collapse, because it is
the column that explains the gap.

The count is read through one shared helper, `settledPenaltyCount`, which
prefers the field the engine publishes and falls back to counting the stored
penalties by phase. That fallback is not defensive padding: `data/weeks.json`
is a committed artifact, so a week written before the field existed still has
every penalty and its phase, and reading zero off a week that plainly charged
five +20s would be worse than reading nothing. Only the 2025 archive, slimmed
to a points map, has nothing to count and reports 0.

### On a phone

Three layouts change shape below the fold-out widths, and each breakpoint is
chosen for a reason rather than rounded to a convention.

`.detail-head` was the worst of them. It held `1fr 1fr` at every width, and its
left half contains `.teams` — itself a three-column grid — so at 390px the
team-name track collapsed to about 40px and `overflow-wrap: anywhere` broke
"LilDaveIII" into one fragment per line while the score ladder ran off the
screen. It stacks at **40rem**, which hands `.tname` the full width back and
means `anywhere` never fires.

A lineup row keeps its two columns at every width, because the two columns
*are* the point: this is a head-to-head, and it is read by comparing your QB to
the other guy's QB on one line. An earlier pass stacked the two sides to buy
width and turned every row into a card holding two unrelated players, which
lost the comparison the screen exists for. The shape matches Sleeper's own
scoreboard — name and points either side of a slot label, points innermost so
the two columns of numbers flank the middle.

What actually made 390px unreadable was never the two columns. It was cramming
four things into each ~160px side: a name, a score, a +20 tag *and* a "scored 0"
caption — so names ellipsised to `Kim...` and the tag spilled into the slot
column as `RBscored 0`. Below 34rem the row keeps its shape and each side wraps
instead: name and points on the first line, tag and caption on a second, which
costs a line only on the rows that carry a penalty. The break is forced by a
zero-height `::after` with `flex-basis: 100%` sitting at the right point in the
`order` sequence, since the markup has no container around the tag pair. The
name flexes from `flex-basis: 0` rather than `auto`, or a long one
("Washington Commanders") claims the whole line and shoves its own score onto
the next while the opposing side keeps both on the first.

A score on a summary card is a real `<button>`, so that the tooltip behind it
answers to a tap where hover does not exist — and that is what put a hairline
through the numbers. An inline-block's baseline is the baseline of its *last*
line box, and at 390px each side of a card is about 116px, which
`213.24 (233.24)` cannot fit on one line. The bracket wrapped, the button's
baseline became that second line, and `.scores { align-items: baseline }`
hoisted the whole button up by a line to meet the one-line side opposite —
dragging the real score above the grid's own `border-top` so the rule drew
straight through it. The grid aligns on `start` instead, which no amount of
wrapping can move, and is pixel-identical whenever both sides are one line.

Two smaller rules finish it. Below 34rem the in-play bracket takes its own
line on *both* sides rather than wrapping on whichever one happened to
overflow, so a reader compares two numbers that sit in the same place. And the
caption under the score — the +20 count and the "to play" note — shares one
line separated by a middot only where it fits; below 34rem it stacks and drops
the middot, because `4 x +20 . 2 to play` does not fit 116px either and was
breaking as "2 to" / "play". Each note carries `white-space: nowrap`, so the
only break either can take is between them.

The standings stay a **table** at every width, and every column is sortable.

There is no Win% column and records print **W-L**, not W-L-T. The league
settles ties by hand — if one happens it gets looked at and adjusted — so a
third number that reads `0` in every row for a whole season is a column of
noise, and a percentage derived from it is that noise one step removed. Both
are display-only: `standings()` still counts ties and still ranks on win%
first, so the order of the table is unchanged.

They used to collapse to one labelled card per team below 34rem, on the
reasoning that seven columns will not fit 375px. Measured rather than assumed,
that is wrong: at `--t-2xs` all eight columns come to 366px inside a 390px
viewport, and they fit from 360px up. What the collapse cost was the whole
point of a standings table — four captioned rows per team and five screens of
scrolling, so comparing two teams' Adj PF meant holding one number in your head
while you scrolled to the other. Below 360px the table exceeds the page and
`.table-wrap`'s `overflow-x` scrolls the *table* rather than the document; it
is still a table.

Each header is a real `<button>` inside its `<th>`, the same idiom the Players
board uses, so there is one sorting mechanism in this codebase rather than two.
Three states per column: best-first, reversed, then back to the real ranking.

"Best first" is not one direction here. This league inverts the usual reading —
lowest adjusted score wins, and a +20 is a punishment — so a table that sorted
every column ascending would answer "who is winning?" for Adj PF and the exact
opposite for Record. Each column declares its own `best` direction and the
first tap uses it; nobody should tap twice to see who is ahead.

Two things follow from sorting that were invisible before it. The **rank**
column is stamped from the engine's order and travels with its row, so sorting
by +20s shows the leader as #1 sitting fourth in the list rather than renaming
the fewest-penalties team "1st" — a claim about the season that the column does
not support. And the **leader tint** moved from `tr:first-child` to a
`.leader` class for the same reason: `:first-child` was only ever the leader
while the table sat in standings order.

The player leaderboard becomes cards below **40rem**. That number is arithmetic,
not taste: the table's own `min-width` is 38rem (608px) and `main` spends 1rem
of padding a side, so the table first fits at 640px. Set at 34rem — where the
rest of the phone layout switches — the band from 545px to 639px got the table
back before there was room for it, side-scrolling 608px of columns through
513px of page. Hiding `<thead>` also hides the sort buttons, and side-scrolling
to a header was previously the only way to sort on a phone, so the card layout
brings its own sort `<select>` and direction toggle. They write the same
`view.sortKey` / `view.sortDir` the headers do, so the two cannot disagree.

The empty `.nojekyll` file at the root is load-bearing. GitHub Pages runs
Jekyll over the whole repository by default, and Jekyll's Liquid parser
treats `{{` as a variable opening — so a JSDoc line like
`{{ownerOf: Map<string,string>}}` inside `docs/` fails the *site* build. This
is a plain static site with no templating, so Jekyll is switched off entirely
rather than escaping braces in prose that has nothing to do with the site.

## How it works

`rules.js` is a pure engine holding every league rule. Both the browser and
the scheduled GitHub Action import it unchanged, so the live page and the
committed archive cannot disagree.

The page paints instantly from the committed snapshot — it recomputes the table
from `data/weeks.json` through the same engine, taking team names, the ghost
roster id and the snapshot timestamp from `data/standings.json`. It then
re-fetches the current week from Sleeper and recomputes client-side — four API
calls per load: `/state/nfl`, `matchups/{week}`, `stats/nfl/regular/{season}/{week}`
for the opportunity rule, and the season schedule.

The schedule call is the one that looks redundant and is not. Its *fixtures* are
immutable for the season, but its `status` field is live, and status is the only
source for whether a player's game has finished — which is what decides when a
+20 lands. It degrades to the committed `data/raw/schedule.json`, whose fixtures
are still correct for the bye rule.

Rosters are read from `data/raw/`, not the API. A scheduled Action archives the
raw weekly payloads to `data/raw/` and refreshes the snapshot. The Action is a
safety net, not the freshness mechanism; freshness comes from the live fetch.
Opening the Players tab costs one further call, for rosters, once per page
load — the tab is mounted lazily the first time it's clicked, so a visitor who
never opens it pays nothing.

`--replay` rescores the whole season from `data/raw/` with zero API calls, so
a mid-season rule change can be applied retroactively.

`leaderboard.js` is the pure per-player scoring engine behind the Players
tab: one row per player for a season, under this league's own rules.
`scripts/build-leaderboard.mjs` runs it over a season's archived weeks to
write `data/leaderboard-{season}.json`; `leaderboard-view.js` holds the
filtering, sorting and rendering that turns those rows into the table, plus
the DOM controller that mounts it.

The two penalty columns count different things, and the gap between them is
the point. `+20s` answers "what would starting him every week have cost",
so it charges a week he did not appear in at all; `True +20s` counts only the
ones earned on the field, playing to an exact 0. A missed week charges neither until there is
nothing left to wait for, and until then it is left out of `GP` and `Raw` as
well — the snapshot archives the in-progress week as soon as it starts,
empty, and without that gate every player in the league reads as absent from
it. That is the same stance `rules.js` takes on a starter whose game is yet
to start.

What counts as "nothing left to wait for" depends on why the line is missing.
A player whose own fixture is still `pre_game` waits on that fixture. A
player on a **bye**, or with no NFL team at all, has no fixture that can ever
start, so he waits on the whole week going final instead. A player missing
from a game already under way is charged: his team took the field without
him. Note this is stricter than the weekly score, where a bye settles
immediately — the leaderboard is a season aggregate rebuilt from scratch on
every run, so holding a bye back for a few days costs nothing and keeps a
week from being half-counted.

### Every view has a URL

`router.js` maps the address bar onto the view, so the browser's back button
works:

    #/results                        the default week
    #/results/week/3                 an explicit week
    #/results/week/3/matchup/1       a drill-down
    #/standings  #/players  #/rules  the other tabs

Hash URLs, not paths: the site is static on GitHub Pages, where a request for
`/results/week/3` 404s unless a redirect shim is committed alongside. Anything
unparseable, out of range or unknown falls back to `#/results` — a hand-edited
URL never blanks the page.

The URL is the only place the view lives. A click *writes* the hash and stops;
the `hashchange` it fires is what repaints, so a click and the back button take
exactly the same path and the address bar cannot disagree with the screen.
Render never writes the hash back, which is what keeps that cycle from closing.
Navigation is addressable; filters (the Players tab's search, season and
minimum-games controls) are not, because a search box that writes history makes
Back useless.

### Three scores, and when they move

A +20 only counts once that player's own NFL game is complete, so a team's score
is a moving number during the week. There are three readings of it — `adjusted`
(finished games only, the official score), `in play` (adjusted plus games in
progress) and `raw` (no +20 at all). `RULES.md` states the rule.

A Results card shows one line per team, `adjusted (in play)`, and draws the
bracket only when it would print a *different* number. The two readings are
equal by construction once a week is settled, and equal on a live week whenever
no zeroed starter is sitting in a game still being played — which is most of any
Sunday — so `98.40 (98.40)` is the same number twice and the second one teaches
nothing. The comparison is made on the formatted values, not the raw ones:
98.401 and 98.404 both print `98.40`, and the question is whether the reader
would see two identical strings.

That leaves the bracket saying something narrower and sharper than it used to.
It no longer means "this week can still move" — the dashed rule, the hollow
ring, the word "leading" and the card's own "in progress" all say that. It means
"there are +20s pending in games still being played, and this is where they
would land".

`adjusted` is the big number because it is the only one that has actually
happened. A +20 is charged when a player's **whole game** ends with no stats to
his name, so a starter sitting on 0.00 in a game still being played has not
been charged and may never be; `in play` is the projection of what the score
would be if every game stopped this instant. The green leader mark is read off
`adjusted` for the same reason, which means it cannot change sides at the
moment it turns from a hollow ring into a solid check — both states now read
the same number.

Under each score, a card also says how many of that team's starters have not
kicked off (`2 to play`), which is what says how much of the bracketed gap can
still move. It is silent at zero, and the League median never carries one: the
line is four other teams averaged, not a lineup. All three readings, `raw`
included, live in the explanation behind each score, which answers to hover, to
keyboard focus **and** to a tap — the last of those being the only one that
exists on the phone this is mostly read on during games. The drill-down keeps
all three in plain sight.

Because a drill-down is a URL, the card is a link stretched over it rather than
a `div[role="button"]`. That is what makes the hover possible at all: an
interactive element cannot nest inside another one, so while the card *was* the
button, a score could not be its own hover target.

## Staying current

The page reads live from Sleeper in the browser, and the committed snapshot is
the fallback for when that fails. Three things keep it honest, all of which
were added after a Monday night game sat stale on the page for half a day.

**The refresh follows the week you are looking at.** Sleeper rolls `week` to
the NEXT week once the current one's games are done, so on a Tuesday it reads
2 while `display_week` still reads 1. The refresh used to follow `week`
alone: it fetched week 2, found nothing played, returned early, and never
touched the week on screen — so a week stopped being refreshable at exactly
the moment its last game ended. It now refreshes both, deduped.

**An open page keeps up.** It used to fetch once on load and never again, so a
phone left open through a Sunday showed the same numbers all day. It now polls
every 60s, and refreshes immediately whenever the tab regains focus. The
arming test is `weekIsPlaying`, not "this week is not final" — those look
interchangeable and are not, because a week that has not kicked off is also
not final, and that version polled all week for scores that could not move.
Midweek and in the offseason it makes zero requests.

**The standings gate is a clock and a scoreboard.** `finalWeeks` takes a
`gamesFinal` predicate alongside the Tuesday gate. Unknown still admits the
week — refusing on absent metadata would blank the table, which is worse than
the staleness it guards against — but a week known to have a game still in
progress is held out, and the note says so rather than naming a deadline
already behind us.

The Action's cron also sweeps Tuesday 01:00-05:00 UTC hourly rather than
resting on a single 06:00 run. That run was meant to clear the 07:00 UTC gate
by an hour, but GitHub routinely delays this repo's scheduled runs by four
(06:00 crons have started at 10:34, 10:03 and 09:36). A one-hour margin
against four hours of jitter is not a margin.

The standings do not move mid-week. A week joins at **Tuesday 10:00 Israel
time**, which `season.js` computes by comparing wall-clock parts from
`Intl.DateTimeFormat` rather than by any offset arithmetic — so Israel's
late-October DST change is absorbed with no branch and no dependency.
