# givash-gals

Standings and results for a Sleeper fantasy league whose format Sleeper
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

Two colour meanings are load-bearing and never carried by colour alone:
green marks the *lower* score (the winner in this league) and is always
accompanied by a check mark and a visually-hidden "Winner"; red marks a +20
penalty and always sits next to the literal text `+20`.

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

The page paints instantly from the committed snapshot — it recomputes the
table from `data/weeks.json` through the same engine, taking team names, the
ghost roster id and the snapshot timestamp from `data/standings.json`. It
then re-fetches only the current week from Sleeper and recomputes
client-side — three API calls per load: `/state/nfl`, `matchups/{week}`, and
`stats/nfl/regular/{season}/{week}` for the opportunity rule.
Rosters and the NFL schedule are read from `data/raw/`, not the API. A
scheduled Action archives the raw weekly payloads to `data/raw/` and
refreshes the snapshot. The Action is a safety net, not the freshness
mechanism; freshness comes from the live fetch. Opening the Players tab costs
one further call, for rosters, once per page load — the tab is mounted lazily
the first time it's clicked, so a visitor who never opens it pays nothing.

`--replay` rescores the whole season from `data/raw/` with zero API calls, so
a mid-season rule change can be applied retroactively.

`leaderboard.js` is the pure per-player scoring engine behind the Players
tab: one row per player for a season, under this league's own rules.
`scripts/build-leaderboard.mjs` runs it over a season's archived weeks to
write `data/leaderboard-{season}.json`; `leaderboard-view.js` holds the
filtering, sorting and rendering that turns those rows into the table, plus
the DOM controller that mounts it.
