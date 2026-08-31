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

None. Node 22 supplies `fetch` and `node:test`; the site is vanilla ES
modules. Nothing to install.

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
mechanism; freshness comes from the live fetch.

`--replay` rescores the whole season from `data/raw/` with zero API calls, so
a mid-season rule change can be applied retroactively.
