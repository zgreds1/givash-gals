# Results Week View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Results tab into a single-week view covering all 18 weeks — including
weeks not yet played — where clicking a matchup opens a Sleeper-style detail showing every
starter and bench player's points.

**Architecture:** A new `results-view.js` module mirrors the existing `leaderboard-view.js`
pattern: every decision is a pure exported function testable without a DOM, and a single
`mountResults` holds selection state and does the fetching. Two new committed files —
`data/pairings.json` (the 18-week schedule) and `data/roster-players.json` (names for bench
players) — are produced by `scripts/snapshot.mjs`, which already runs on cron. The
drill-down lazily reads `data/raw/wk{N}.json`, which the snapshot has always written and the
site has never read.

**Tech Stack:** Vanilla ES modules, no build step, no dependencies. `node --test` with
`node:assert/strict`. Node 22.

**Spec:** `docs/superpowers/specs/2026-09-01-results-week-view-design.md`

## Global Constraints

- **No dependencies.** The site is vanilla ES modules; `package.json` has no `dependencies`
  or `devDependencies` and must keep none.
- **No build step.** Files are served as written by GitHub Pages.
- **`rules.js` is not modified by any task in this plan.** The scoring engine is out of scope.
- **Run `npm test` before every commit.** The snapshot Action runs `npm test` as a gate; a
  red suite blocks the data refresh, not just CI.
- **18 weeks.** Import `LAST_WEEK` from `./config.js`; never write `18` as a literal.
- **Ghost roster id has one source:** `data/standings.json` `ghostRosterId`. Do not duplicate
  it into any new file.
- **`writeStamped` for every file under `data/`** that the Action commits, so unchanged
  content does not restamp and produce empty commits. Files under `data/raw/` use plain
  `writeFile`, matching what is already there.
- **Slot labels come from `roster_positions`**, never from a hardcoded lineup. The league
  changed from QB×2 to QB×3 once already.
- **Contrast floor 4.5:1** for any new text colour, per `style.css`'s header.
- Commit messages: sentence case, imperative, explaining *why*. Match the existing log.

---

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `results-view.js` | create | All Results-tab logic: week selection, pairings, lineups, rendering, mounting |
| `test/results-view.test.js` | create | Unit tests for every pure export above |
| `test/fixtures/league-week.json` | create | A matchup payload with this league's real 19/5 shape |
| `scripts/snapshot.mjs` | modify | Also write `pairings.json`, `roster-players.json`, `raw/state.json`, `roster_positions` |
| `render.js` | modify | `renderResults` removed; `renderStandings` and `renderRules` stay |
| `test/render.test.js` | modify | `renderResults` tests move to `test/results-view.test.js` |
| `app.js` | modify | Mount Results; keep the live payload instead of discarding it |
| `index.html` | modify | Results section becomes a mount point |
| `style.css` | modify | Week picker, upcoming week, detail table |

**Deviation from spec §6.** That table lists `weekPairs(pairings, week)` and
`upcomingWeek(week, pairs, ghost, teams)` as separate exports. This plan does not create
them: `weekPairs` would wrap a single object lookup, and `upcomingWeek` is one branch of
`renderWeek` that no caller needs on its own. Two exports fewer, same behaviour, and every
spec requirement is still covered by a task. Nothing else in the spec's table is dropped.

`results-view.js` is one file rather than three because that is what this repo does:
`leaderboard-view.js` holds the Players tab's pure logic *and* its mount in a single 430-line
module. Splitting Results across `results-model.js` / `results-render.js` / `results-mount.js`
would introduce a convention the codebase does not have.

---

### Task 1: The Wednesday rollover

**Files:**
- Create: `results-view.js`
- Create: `test/results-view.test.js`

**Interfaces:**
- Consumes: `LAST_WEEK` from `./config.js`
- Produces: `displayWeek(now: Date, seasonStart: string, lastWeek?: number) => number`

- [ ] **Step 1: Write the failing test**

Create `test/results-view.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayWeek } from '../results-view.js';

// Sleeper reports season_start_date 2026-09-09, which is a Wednesday. Every
// boundary below is therefore a Tue -> Wed rollover, which is the rule the
// league wants. Dates are constructed locally, not parsed from ISO strings,
// because new Date('2026-09-09') is UTC midnight and would shift the answer
// for anyone west of Greenwich.
const START = '2026-09-09';
const local = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0);

test('the displayed week rolls over on Wednesday', () => {
  assert.equal(displayWeek(local(2026, 9, 8), START), 1, 'Tue before kickoff');
  assert.equal(displayWeek(local(2026, 9, 9), START), 1, 'Wed, week 1 opens');
  assert.equal(displayWeek(local(2026, 9, 15), START), 1, 'Tue, still week 1');
  assert.equal(displayWeek(local(2026, 9, 16), START), 2, 'Wed, week 2 opens');
  assert.equal(displayWeek(local(2026, 11, 4), START), 9);
  assert.equal(displayWeek(local(2027, 1, 5), START), 17, 'Tue, still week 17');
  assert.equal(displayWeek(local(2027, 1, 6), START), 18, 'Wed, week 18 opens');
});

test('the week clamps at both ends of the season', () => {
  assert.equal(displayWeek(local(2026, 7, 1), START), 1, 'July: no season yet');
  assert.equal(displayWeek(local(2027, 2, 1), START), 18, 'February: season over');
});

test('a missing or malformed season start falls back to week 1', () => {
  // standings.json predates this field, so an older snapshot has no start
  // date. Week 1 is the honest default; NaN would render an empty picker.
  assert.equal(displayWeek(local(2026, 11, 4), undefined), 1);
  assert.equal(displayWeek(local(2026, 11, 4), 'not-a-date'), 1);
});

test('the rollover survives a daylight-saving shift', () => {
  // US DST ends 2026-11-01. Nov 4 is 56 days after Sep 9, but 56 * 86400000
  // ms apart it is not — the extra hour makes the raw division 55.96 days,
  // which floors to week 8 instead of 9 unless the day count is rounded.
  assert.equal(displayWeek(local(2026, 11, 4), START), 9);
  assert.equal(displayWeek(local(2026, 11, 3), START), 8);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test test/results-view.test.js`
Expected: FAIL — `Cannot find module '.../results-view.js'`

- [ ] **Step 3: Write the implementation**

Create `results-view.js`:

```js
// The Results tab.
//
// Same shape as leaderboard-view.js: everything that decides WHAT to show is
// a pure function here, testable without a DOM, and mountResults is the only
// part that touches document.

import { LAST_WEEK } from './config.js';

/**
 * Which week the Results tab opens on.
 *
 * Sleeper's own season_start_date is a Wednesday (2026-09-09), so flooring
 * the offset into 7-day blocks lands the rollover on a Wednesday by
 * construction — there is no weekday arithmetic here to get wrong.
 *
 * Deliberately not read from /state/nfl's `week`: that advances on Sleeper's
 * Tuesday schedule, and it is not available before the first paint.
 *
 * @param {Date} now
 * @param {string} seasonStart - 'YYYY-MM-DD', local
 * @returns {number} 1..lastWeek
 */
export function displayWeek(now, seasonStart, lastWeek = LAST_WEEK) {
  const [y, m, d] = String(seasonStart ?? '').split('-').map(Number);
  if (!y || !m || !d) return 1;

  // Both ends snapped to local midnight. Parsing the ISO string directly
  // would give UTC midnight and shift the rollover by a day for anyone west
  // of Greenwich; the league is played in two time zones.
  const start = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Rounded, not floored: a daylight-saving boundary between the two dates
  // makes the difference 23 or 25 hours short of a whole number of days.
  const days = Math.round((today - start) / 86400000);
  return Math.min(lastWeek, Math.max(1, Math.floor(days / 7) + 1));
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test test/results-view.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all tests pass, count is 151 + 4 = 155.

- [ ] **Step 6: Commit**

```bash
git add results-view.js test/results-view.test.js
git commit -m "Derive the displayed week from the season start date

The league wants the Results tab to advance on Wednesdays. Sleeper's
season_start_date is itself a Wednesday, so flooring the offset into
seven-day blocks puts the rollover on one without any weekday
arithmetic to get wrong.

Rounded rather than floored day count, because a daylight-saving
boundary leaves the two dates 23 or 25 hours short of a whole number of
days and would silently show the previous week for the rest of the
season."
```

---

### Task 2: Archive the season start date and the roster layout

The page needs `season_start_date` to compute the default week before its first paint, and
`roster_positions` to label lineup slots. Neither is archived today: `data/raw/league.json`
is deliberately trimmed to `scoring_settings`.

**Files:**
- Modify: `scripts/snapshot.mjs`
- Test: `test/snapshot.test.js`

**Interfaces:**
- Produces: `data/standings.json` gains `seasonStart: string` and `rosterPositions: string[]`
  inside the existing `meta` object, so it reaches the page through the file it already reads.

- [ ] **Step 1: Write the failing test**

Append to `test/snapshot.test.js`:

```js
test('buildSnapshot carries the season start and roster layout to the page', () => {
  // The page computes its default week from seasonStart before any API call,
  // and labels lineup slots from rosterPositions. Both have to ride along in
  // standings.json, which is the only file the page reads on first paint.
  const snap = buildSnapshot({
    rosters: [{ roster_id: 1, owner_id: 'u1', players: [] }, { roster_id: 2, players: [] }],
    users: [{ user_id: 'u1', display_name: 'Alpha' }],
    schedule: [],
    players: {},
    weekPayloads: {},
    state: { season_start_date: '2026-09-09' },
    rosterPositions: ['QB', 'RB', 'BN'],
  });

  assert.equal(snap.meta.seasonStart, '2026-09-09');
  assert.deepEqual(snap.meta.rosterPositions, ['QB', 'RB', 'BN']);
});

test('buildSnapshot tolerates a missing state, so --replay still works', () => {
  const snap = buildSnapshot({
    rosters: [{ roster_id: 1, owner_id: 'u1', players: [] }],
    users: [{ user_id: 'u1', display_name: 'Alpha' }],
    schedule: [], players: {}, weekPayloads: {},
  });
  assert.equal(snap.meta.seasonStart, null);
  assert.deepEqual(snap.meta.rosterPositions, []);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test test/snapshot.test.js`
Expected: FAIL — `snap.meta.seasonStart` is `undefined`, not `'2026-09-09'`.

- [ ] **Step 3: Widen `buildSnapshot`**

In `scripts/snapshot.mjs`, change the signature and the returned meta:

```js
export function buildSnapshot({
  rosters, users, schedule, players, weekPayloads,
  opportunities = {}, state = null, rosterPositions = [],
}) {
```

and the return:

```js
  return {
    standings: standings(weeks),
    weeks,
    meta: {
      ghostRosterId,
      teams,
      // The page's default week comes from here, so it can pick a week
      // before making any API call. Null on --replay when raw/state.json
      // predates this change.
      seasonStart: state?.season_start_date ?? null,
      rosterPositions,
    },
  };
```

- [ ] **Step 4: Archive `state.json` and the roster layout in the fetch branch**

In `main()`, in the `else` (non-replay) branch, alongside the existing `writeFile` calls for
`rosters.json` / `users.json` / `schedule.json`:

```js
    await writeFile(path.join(RAW, 'state.json'), JSON.stringify(state));
```

and widen the trimmed league write to keep the layout:

```js
    // Only the scoring map and the roster layout. The full league object
    // carries last_message_id and friends, which change whenever anyone
    // posts in the league chat, and the Action's blanket `git add data/`
    // would commit that churn for no reader.
    await writeFile(
      path.join(RAW, 'league.json'),
      JSON.stringify({
        scoring_settings: league.scoring_settings,
        roster_positions: league.roster_positions,
      }),
    );
```

- [ ] **Step 5: Read them back in the replay branch**

In the `if (replay)` branch, after the `schedule` read:

```js
    const statePath = path.join(RAW, 'state.json');
    state = existsSync(statePath)
      ? JSON.parse(await readFile(statePath, 'utf8'))
      : null;

    const leaguePath = path.join(RAW, 'league.json');
    league = existsSync(leaguePath)
      ? JSON.parse(await readFile(leaguePath, 'utf8'))
      : null;
```

Declare `let state;` beside the other `let` bindings at the top of `main()`.

- [ ] **Step 6: Pass them through at the call site**

```js
  const snap = buildSnapshot({
    rosters, users, schedule, players, weekPayloads, opportunities,
    state,
    rosterPositions: league?.roster_positions || [],
  });
```

- [ ] **Step 7: Run the tests**

Run: `npm test`
Expected: PASS, 157 tests.

- [ ] **Step 8: Commit**

```bash
git add scripts/snapshot.mjs test/snapshot.test.js
git commit -m "Archive the season start date and the roster layout

The Results tab picks its default week from the season start date and
labels lineup slots from roster_positions. Neither was archived:
raw/league.json is trimmed to scoring_settings, and /state/nfl was
fetched and discarded.

Both ride along in standings.json's meta, which is the one file the page
already reads before its first paint, so the default week needs no API
call. Both degrade to null/[] on --replay against an older archive."
```

---

### Task 3: Pairings and who draws the median

**Files:**
- Modify: `results-view.js`
- Modify: `test/results-view.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `pairsFromPayload(payload: Array) => number[][]` — sorted, stable
  - `medianRosterId(pairs: number[][], ghostRosterId: number|null) => number|null`

- [ ] **Step 1: Write the failing test**

Append to `test/results-view.test.js`:

```js
import { pairsFromPayload, medianRosterId } from '../results-view.js';

// Real week 1, probed from Sleeper on 2026-09-01. Every future week carries
// matchup_id with points 0, which is what makes an upcoming schedule
// possible at all.
const WEEK1 = [
  { roster_id: 1, matchup_id: 1, points: 0 },
  { roster_id: 2, matchup_id: 2, points: 0 },
  { roster_id: 3, matchup_id: 1, points: 0 },
  { roster_id: 4, matchup_id: 2, points: 0 },
  { roster_id: 5, matchup_id: 3, points: 0 },
  { roster_id: 6, matchup_id: 3, points: 0 },
];

test('pairs come out sorted, so an unchanged schedule is a byte-identical file', () => {
  assert.deepEqual(pairsFromPayload(WEEK1), [[1, 3], [2, 4], [5, 6]]);

  // Same week, entries shuffled and each pair reversed. The Action commits
  // whenever data/ differs, so an unsorted result would commit noise on
  // every run.
  const shuffled = [WEEK1[4], WEEK1[3], WEEK1[0], WEEK1[5], WEEK1[1], WEEK1[2]];
  assert.deepEqual(pairsFromPayload(shuffled), [[1, 3], [2, 4], [5, 6]]);
});

test('entries with no matchup_id are skipped, not paired', () => {
  const partial = [...WEEK1.slice(0, 4), { roster_id: 5, matchup_id: null, points: 0 }];
  assert.deepEqual(pairsFromPayload(partial), [[1, 3], [2, 4]]);
});

test('pairsFromPayload survives an empty or missing payload', () => {
  assert.deepEqual(pairsFromPayload([]), []);
  assert.deepEqual(pairsFromPayload(undefined), []);
});

test('the team paired with the ghost roster draws the median', () => {
  // Probed weeks, spec 2.1. Roster 6 is unowned.
  assert.equal(medianRosterId([[1, 3], [2, 4], [5, 6]], 6), 5, 'week 1');
  assert.equal(medianRosterId([[1, 2], [3, 6], [4, 5]], 6), 3, 'week 2');
  assert.equal(medianRosterId([[1, 4], [3, 5], [2, 6]], 6), 2, 'week 5');
  assert.equal(medianRosterId([[1, 6], [2, 5], [3, 4]], 6), 1, 'week 18');
});

test('there is no median team when every roster slot is owned', () => {
  // The standings page already warns about this shape: six owned rosters is
  // three straight head-to-head games and no median at all.
  assert.equal(medianRosterId([[1, 2], [3, 4], [5, 6]], null), null);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test test/results-view.test.js`
Expected: FAIL — `pairsFromPayload is not a function`.

- [ ] **Step 3: Implement both functions**

Append to `results-view.js`:

```js
/**
 * Group a matchup payload into its pairs by Sleeper's matchup_id.
 *
 * Works on a future week: Sleeper assigns matchup_id for the whole season up
 * front and reports points 0 until the games are played, which is what lets
 * the Results tab draw a schedule before kickoff.
 *
 * Output is sorted inside each pair and across pairs. The Action commits
 * whenever data/ differs, so an unstable order here would produce an empty
 * commit on every run.
 */
export function pairsFromPayload(payload) {
  const groups = new Map();
  for (const e of payload || []) {
    const id = e?.matchup_id ?? null;
    if (id === null) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(e.roster_id);
  }
  return [...groups.values()]
    .map((ids) => ids.slice().sort((a, b) => a - b))
    .sort((a, b) => a[0] - b[0]);
}

/**
 * The roster that plays the league median this week: whoever Sleeper paired
 * with the unowned roster.
 *
 * This is the same rule resolveWeek applies to a played week, which is why
 * the upcoming view and the played view cannot disagree about who is on the
 * median.
 */
export function medianRosterId(pairs, ghostRosterId) {
  if (ghostRosterId === null || ghostRosterId === undefined) return null;
  for (const pair of pairs || []) {
    if (!pair.includes(ghostRosterId)) continue;
    const others = pair.filter((id) => id !== ghostRosterId);
    return others.length === 1 ? others[0] : null;
  }
  return null;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS, 162 tests.

- [ ] **Step 5: Commit**

```bash
git add results-view.js test/results-view.test.js
git commit -m "Read a week's pairings, and who is on the median, from a payload

Sleeper assigns matchup_id for all 18 weeks before kickoff, with points
zero, so the same grouping that describes a played week also describes
an upcoming one. Deriving the median team from the pair containing the
unowned roster is the rule resolveWeek already applies, so the upcoming
view and the played view agree by construction.

Pairs are sorted inside and across, because the Action commits whenever
data/ differs and an unstable order would commit noise every run."
```

---

### Task 4: Write `data/pairings.json`

**Files:**
- Modify: `scripts/snapshot.mjs`
- Test: `test/snapshot.test.js`

**Interfaces:**
- Consumes: `pairsFromPayload` from Task 3
- Produces: `data/pairings.json` — `{generatedAt, pairings: {"1": [[1,3],[2,4],[5,6]], …}}`

- [ ] **Step 1: Write the failing test**

Append to `test/snapshot.test.js`:

```js
import { buildPairings } from '../scripts/snapshot.mjs';

test('buildPairings keys every fetched week and drops the empty ones', () => {
  // A week Sleeper has not generated yet comes back as [] rather than 404.
  // Keying it anyway would draw an upcoming week with no matchups in it.
  const out = buildPairings({
    1: [
      { roster_id: 1, matchup_id: 1 }, { roster_id: 3, matchup_id: 1 },
      { roster_id: 2, matchup_id: 2 }, { roster_id: 4, matchup_id: 2 },
      { roster_id: 5, matchup_id: 3 }, { roster_id: 6, matchup_id: 3 },
    ],
    2: [],
  });
  assert.deepEqual(Object.keys(out), ['1']);
  assert.deepEqual(out['1'], [[1, 3], [2, 4], [5, 6]]);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test test/snapshot.test.js`
Expected: FAIL — `buildPairings is not a function`.

- [ ] **Step 3: Add `buildPairings`**

In `scripts/snapshot.mjs`, import `pairsFromPayload` and add the pure builder next to
`buildSnapshot`:

```js
import { pairsFromPayload } from '../results-view.js';

/**
 * The whole season's schedule, keyed by week.
 *
 * Pure so it can be tested without the network; the fetching lives in main().
 * A week Sleeper has not generated returns [] rather than 404, and keying it
 * would draw an upcoming week containing no matchups.
 */
export function buildPairings(payloadsByWeek) {
  const out = {};
  for (const [week, payload] of Object.entries(payloadsByWeek || {})) {
    const pairs = pairsFromPayload(payload);
    if (pairs.length) out[week] = pairs;
  }
  return out;
}
```

- [ ] **Step 4: Fetch all 18 weeks in the non-replay branch**

In `main()`, after the existing `for (let w = 1; w <= current; w++)` loop closes, still inside
the `else` branch:

```js
    // The whole season's pairings, not just the played weeks: this is what
    // lets the Results tab show an upcoming schedule. 18 calls per Action
    // run, zero per page load. The client's single-flight cache makes the
    // weeks already fetched above free.
    const schedulePayloads = {};
    for (let w = 1; w <= LAST_WEEK; w++) {
      schedulePayloads[w] = await client.matchups(w).catch(() => []);
    }
    pairings = buildPairings(schedulePayloads);
```

Declare `let pairings = null;` beside the other `let` bindings, and import `LAST_WEEK`:

```js
import { API_BASE, LAST_WEEK, LEAGUE_ID, SEASON } from '../config.js';
```

- [ ] **Step 5: Write the file, but never clobber it on replay**

After the `weeks.json` write in `main()`:

```js
  // --replay has no network, so it must leave a good pairings.json alone
  // rather than overwrite it with nothing.
  if (pairings) {
    await writeStamped(path.join(DATA, 'pairings.json'), { pairings }, now);
  }
```

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: PASS, 163 tests.

- [ ] **Step 7: Generate the real file and eyeball it**

Run: `npm run snapshot`
Expected: `data/pairings.json` exists with 18 keys. Verify the cycle the spec records —
weeks 2 and 12 must be identical, as must 3 and 18:

```bash
node -e "
const p=require('fs').readFileSync('data/pairings.json','utf8');
const {pairings}=JSON.parse(p);
console.log('weeks:', Object.keys(pairings).length);
console.log('wk2 === wk12:', JSON.stringify(pairings['2'])===JSON.stringify(pairings['12']));
console.log('wk3 === wk18:', JSON.stringify(pairings['3'])===JSON.stringify(pairings['18']));
console.log('wk1:', JSON.stringify(pairings['1']));
"
```
Expected: `weeks: 18`, both comparisons `true`, `wk1: [[1,3],[2,4],[5,6]]`.

If either comparison is false, stop: the five-week round robin the spec verified does not
hold, and the median assignment needs re-checking before going further.

- [ ] **Step 8: Commit**

```bash
git add scripts/snapshot.mjs test/snapshot.test.js data/pairings.json
git commit -m "Archive the whole season's pairings, not just played weeks

The Results tab cannot show an upcoming schedule from weeks.json, which
holds only weeks the engine has resolved. Sleeper knows all 18 weeks of
pairings before kickoff, so the snapshot now asks for them.

Eighteen extra calls per Action run and none per page load, which is the
trade this is for. --replay leaves the file alone rather than
overwriting a good schedule with nothing, since it has no network."
```

---

### Task 5: Write `data/roster-players.json`

**Files:**
- Modify: `scripts/snapshot.mjs`
- Test: `test/snapshot.test.js`

**Interfaces:**
- Produces: `data/roster-players.json` — `{generatedAt, players: {id: {name, pos, team}}}`

- [ ] **Step 1: Write the failing test**

Append to `test/snapshot.test.js`:

```js
import { buildRosterPlayers } from '../scripts/snapshot.mjs';

test('roster players cover everyone who ever appeared, not just current rosters', () => {
  // A player dropped in week 5 still started in week 3, and the week 3
  // detail view has to name him. Building from current rosters alone would
  // print a bare Sleeper id in that row forever.
  const all = {
    p1: { pos: 'QB', team: 'CIN', full_name: 'Current Guy' },
    p2: { pos: 'RB', team: 'ATL', full_name: 'Dropped Guy' },
    p3: { pos: 'WR', team: 'MIN', full_name: 'Never Rostered' },
  };
  const out = buildRosterPlayers(
    all,
    [{ roster_id: 1, players: ['p1'] }],
    { 3: [{ roster_id: 1, starters: ['p2'], players: ['p1', 'p2'] }] },
  );

  assert.deepEqual(Object.keys(out).sort(), ['p1', 'p2']);
  assert.deepEqual(out.p2, { name: 'Dropped Guy', pos: 'RB', team: 'ATL' });
  assert.equal(out.p3, undefined, 'never rostered: not our problem to carry');
});

test('an unknown id still gets an entry, so the detail view can name the slot', () => {
  const out = buildRosterPlayers({}, [{ roster_id: 1, players: ['ghost'] }], {});
  assert.deepEqual(out.ghost, { name: 'ghost', pos: '', team: '' });
});

test('the empty starter slot is not a player and is never carried', () => {
  // Sleeper writes '0' into an unfilled starting slot. It is not an id.
  const out = buildRosterPlayers({}, [], { 1: [{ starters: ['0'], players: ['0'] }] });
  assert.deepEqual(out, {});
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test test/snapshot.test.js`
Expected: FAIL — `buildRosterPlayers is not a function`.

- [ ] **Step 3: Implement it**

Add to `scripts/snapshot.mjs`:

```js
/**
 * Names for every player the detail view might have to render.
 *
 * Built from the union of current rosters and every archived week, because
 * the detail view shows bench players and a player dropped in week 5 still
 * started in week 3. Current rosters alone would leave that row showing a
 * bare Sleeper id.
 *
 * This file exists at all because players-slim.json is filtered to active
 * skill players — which is exactly the filter that removes the inactive and
 * IR players who fill bench slots.
 */
export function buildRosterPlayers(playersAll, rosters, weekPayloads) {
  const ids = new Set();
  const add = (id) => {
    const s = String(id);
    // '0' is Sleeper's unfilled starting slot, not a player.
    if (s && s !== '0') ids.add(s);
  };

  for (const r of rosters || []) for (const id of r.players || []) add(id);
  for (const payload of Object.values(weekPayloads || {})) {
    for (const e of payload || []) {
      for (const id of e.players || []) add(id);
      for (const id of e.starters || []) add(id);
    }
  }

  const out = {};
  for (const id of [...ids].sort()) {
    const p = (playersAll || {})[id];
    const name =
      p?.full_name || `${p?.first_name || ''} ${p?.last_name || ''}`.trim() || id;
    out[id] = { name, pos: p?.position || '', team: p?.team || '' };
  }
  return out;
}
```

Note the sort: it makes the file byte-stable so `writeStamped` can tell a real change from a
reordering.

- [ ] **Step 4: Write it in `main()`**

After the `pairings.json` write:

```js
  const rp = await writeStamped(
    path.join(DATA, 'roster-players.json'),
    { players: buildRosterPlayers(playersAll, rosters, weekPayloads) },
    now,
  );
```

and add `rp.changed` to the `content changed` check in the closing `console.log`.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS, 166 tests.

- [ ] **Step 6: Generate it and check the size**

Run: `npm run snapshot && ls -l data/roster-players.json`
Expected: the file exists and is well under 50 KB. If it is larger than 100 KB the union is
picking up more than rostered players — stop and check `buildRosterPlayers`.

- [ ] **Step 7: Commit**

```bash
git add scripts/snapshot.mjs test/snapshot.test.js data/roster-players.json
git commit -m "Archive names for every player who has been on a roster

The matchup detail shows bench players, and players-slim.json — the map
the page already loads — is filtered to active skill players. That is
precisely the filter that removes the inactive and IR players who sit on
benches, so resolving those names against it prints bare Sleeper ids.

Built from the union of current rosters and every archived week, not
from current rosters, because a player dropped in week 5 still started
in week 3 and that week's detail has to name him. About 10 KB, against
233 KB for lazily fetching players-all.json on a phone."
```

---

### Task 6: Turn a payload entry into lineup rows

**Files:**
- Modify: `results-view.js`
- Modify: `test/results-view.test.js`
- Create: `test/fixtures/league-week.json`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `slotFits(slot: string, pos: string) => boolean`
  - `lineupRows(entry, rosterPositions: string[], players: object) => {starters: Row[], bench: Row[]}`
  - `Row = {id, name, pos, slot, points, empty}`

- [ ] **Step 1: Build the fixture**

The existing `test/fixtures/real-week.json` is a 10-starter/17-player roster and does **not**
match this league's 19/5 shape (spec §9.1). Create `test/fixtures/league-week.json` by
script so the shape cannot drift from `roster_positions`:

```bash
node -e "
const fs=require('fs');
const SLOTS=['QB','QB','QB','RB','RB','RB','RB','WR','WR','WR','WR','TE','TE','FLEX','FLEX','FLEX','FLEX','K','DEF'];
const mk=(rid,mid,off)=>{
  const starters=SLOTS.map((s,i)=>s==='DEF'?'KC':String(1000+off+i));
  const bench=[0,1,2,3,4].map(i=>String(2000+off+i));
  const pts={};
  starters.forEach((id,i)=>{pts[id]=Number(((i*3.7+off)%28).toFixed(2));});
  bench.forEach((id,i)=>{pts[id]=Number(((i*2.1+off)%14).toFixed(2));});
  return {roster_id:rid,matchup_id:mid,points:0,
    starters,starters_points:starters.map(id=>pts[id]),
    players:[...starters,...bench],players_points:pts};
};
fs.writeFileSync('test/fixtures/league-week.json',
  JSON.stringify([mk(1,1,0),mk(3,1,40),mk(2,2,80),mk(4,2,120),mk(5,3,160),mk(6,3,200)],null,1));
console.log('wrote', fs.statSync('test/fixtures/league-week.json').size, 'bytes');
"
```

- [ ] **Step 2: Write the failing test**

Append to `test/results-view.test.js`:

```js
import { readFileSync } from 'node:fs';
import { lineupRows, slotFits } from '../results-view.js';

const POSITIONS = [
  'QB', 'QB', 'QB', 'RB', 'RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'WR',
  'TE', 'TE', 'FLEX', 'FLEX', 'FLEX', 'FLEX', 'K', 'DEF',
  'BN', 'BN', 'BN', 'BN', 'BN',
];

const PLAYERS = {
  a: { name: 'Ann QB', pos: 'QB', team: 'CIN' },
  b: { name: 'Bo RB', pos: 'RB', team: 'ATL' },
  c: { name: 'Cy WR', pos: 'WR', team: 'MIN' },
};

test('slots come from roster_positions, in order, and BN is not a slot', () => {
  const entry = { starters: ['a', 'b'], starters_points: [17.4, 24.9], players: ['a', 'b', 'c'],
                  players_points: { a: 17.4, b: 24.9, c: 8.1 } };
  const { starters, bench } = lineupRows(entry, POSITIONS, PLAYERS);

  assert.equal(starters.length, 2);
  assert.deepEqual(starters.map((r) => r.slot), ['QB', 'RB']);
  assert.deepEqual(starters.map((r) => r.points), [17.4, 24.9]);

  assert.equal(bench.length, 1);
  assert.equal(bench[0].name, 'Cy WR');
  assert.equal(bench[0].points, 8.1);
});

test('a player who cannot fill his slot is labelled by his own position', () => {
  // spec 6.1: starters[i] lining up with the i-th non-BN roster_positions
  // entry is an assumption, not a documented guarantee. If Sleeper ever
  // reorders, trusting the index shows a WR sitting in a QB row. Showing
  // what the player actually is beats confidently showing a lie.
  const entry = { starters: ['c'], starters_points: [8.1], players: ['c'], players_points: { c: 8.1 } };
  const { starters } = lineupRows(entry, POSITIONS, PLAYERS);
  assert.equal(starters[0].slot, 'WR', 'a WR in the first QB slot is labelled WR');
});

test('FLEX accepts RB, WR and TE and nothing else', () => {
  assert.equal(slotFits('FLEX', 'RB'), true);
  assert.equal(slotFits('FLEX', 'WR'), true);
  assert.equal(slotFits('FLEX', 'TE'), true);
  assert.equal(slotFits('FLEX', 'QB'), false);
  assert.equal(slotFits('QB', 'QB'), true);
  assert.equal(slotFits('QB', 'RB'), false);
});

test('an unknown position never contradicts the slot', () => {
  // Half of "unknown" is not evidence of a mismatch.
  assert.equal(slotFits('QB', ''), true);
  assert.equal(slotFits('', 'QB'), true);
});

test('an empty starting slot is marked, not named "0"', () => {
  // Sleeper writes '0' into an unfilled slot, and an empty slot is exactly
  // what earns the +20 — it must be legible, not rendered as a player id.
  const entry = { starters: ['0'], starters_points: [0], players: [], players_points: {} };
  const { starters } = lineupRows(entry, POSITIONS, PLAYERS);
  assert.equal(starters[0].empty, true);
  assert.equal(starters[0].slot, 'QB', 'the slot is still known even when unfilled');
  assert.notEqual(starters[0].name, '0');
});

test('an id missing from the player map renders as the id, not as blank', () => {
  const entry = { starters: ['zz'], starters_points: [3], players: ['zz'], players_points: { zz: 3 } };
  const { starters } = lineupRows(entry, POSITIONS, PLAYERS);
  assert.equal(starters[0].name, 'zz');
});

test('the real 19/5 league shape round-trips', () => {
  const payload = JSON.parse(readFileSync('test/fixtures/league-week.json', 'utf8'));
  const { starters, bench } = lineupRows(payload[0], POSITIONS, {});
  assert.equal(starters.length, 19, '19 starters, per roster_positions');
  assert.equal(bench.length, 5, '5 bench');
  assert.equal(starters.at(-1).slot, 'DEF');
  assert.equal(starters.at(-2).slot, 'K');
});
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `node --test test/results-view.test.js`
Expected: FAIL — `lineupRows is not a function`.

- [ ] **Step 4: Implement**

Append to `results-view.js`:

```js
/** Sleeper writes this into a starting slot nobody filled. Not a player id. */
const EMPTY_SLOT = '0';

const FLEX_POSITIONS = new Set(['RB', 'WR', 'TE']);

/**
 * Can a player of position `pos` legally occupy slot `slot`?
 *
 * Unknown on either side returns true: half of "unknown" is not evidence of
 * a mismatch, and contradicting a slot on no evidence is worse than trusting
 * it.
 */
export function slotFits(slot, pos) {
  if (!slot || !pos) return true;
  if (slot === 'FLEX') return FLEX_POSITIONS.has(pos);
  return slot === pos;
}

/**
 * One matchup entry, split into slot-ordered starters and a bench.
 *
 * The i-th starter is assumed to fill the i-th non-BN roster_positions
 * entry. That is conventional Sleeper behaviour but is NOT documented, and
 * no played 2026 week existed to confirm it when this was written (spec
 * 6.1) — so each row is cross-checked against the player's real position and
 * falls back to labelling itself with that position rather than confidently
 * showing a WR in a QB row.
 */
export function lineupRows(entry, rosterPositions, players = {}) {
  const slots = (rosterPositions || []).filter((p) => p !== 'BN');
  const starterIds = entry?.starters || [];
  const starterPts = entry?.starters_points || [];
  const playerPts = entry?.players_points || {};

  const row = (id, slot, points) => {
    const key = String(id);
    if (key === EMPTY_SLOT) {
      return { id: key, name: 'Empty slot', pos: '', slot, points: Number(points || 0), empty: true };
    }
    const p = players[key];
    const pos = p?.pos || '';
    return {
      id: key,
      name: p?.name || key,
      pos,
      slot: slotFits(slot, pos) ? slot : pos,
      points: Number(points || 0),
      empty: false,
    };
  };

  const starters = starterIds.map((id, i) => row(id, slots[i] || '', starterPts[i]));

  const started = new Set(starterIds.map(String));
  const bench = (entry?.players || [])
    .map(String)
    .filter((id) => id !== EMPTY_SLOT && !started.has(id))
    .map((id) => row(id, players[id]?.pos || 'BN', playerPts[id]));

  return { starters, bench };
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS, 173 tests.

- [ ] **Step 6: Commit**

```bash
git add results-view.js test/results-view.test.js test/fixtures/league-week.json
git commit -m "Split a matchup entry into slot-ordered starters and bench

Slot labels come from roster_positions rather than a hardcoded lineup,
because this league has already changed from two QB slots to three and a
hardcoded layout would mislabel every row the next time.

That starters[i] fills the i-th non-BN slot is conventional Sleeper
behaviour, not a documented guarantee, and no played 2026 week exists to
confirm it. Each row is therefore cross-checked against the player's own
position and falls back to it on a mismatch: showing what a player
actually is beats confidently showing a WR in a QB row.

The fixture is generated against the real 19/5 shape; the existing
real-week.json is a 10/17 roster from a differently configured league."
```

---

### Task 7: Render one week, played or upcoming

**Files:**
- Modify: `results-view.js`
- Modify: `test/results-view.test.js`
- Modify: `style.css`

**Interfaces:**
- Consumes: `medianRosterId` (Task 3)
- Produces: `renderWeek({week, resolved, pairs, ghostRosterId, teams, detailAvailable}) => string`

- [ ] **Step 1: Write the failing test**

Append to `test/results-view.test.js`:

```js
import { renderWeek } from '../results-view.js';

const TEAMS = { 1: 'Alpha', 2: 'Bravo', 3: 'Delta', 4: 'Echo', 5: 'Foxtrot' };

const PLAYED = {
  week: 3, played: true, median: 107.9, medianPool: [142.6, 118.3, 97.5, 88.1],
  teams: {
    1: { raw: 122.6, adjusted: 142.6, penalties: [{ playerId: '8205', name: 'Bijan Robinson', reason: 'zeroed' }] },
    2: { raw: 88.1, adjusted: 88.1, penalties: [] },
    5: { raw: 101.2, adjusted: 101.2, penalties: [] },
  },
  matchups: [
    { type: 'h2h', rosterIds: [1, 2], winner: 2 },
    { type: 'median', rosterId: 5, line: 107.9, result: 'W' },
  ],
};

test('a played week shows both scores, the penalty and the winner', () => {
  const html = renderWeek({ week: 3, resolved: PLAYED, teams: TEAMS, detailAvailable: true });
  assert.match(html, /Bijan Robinson/);
  assert.match(html, /\+20/);
  assert.match(html, /122\.60/);
  assert.match(html, /142\.60/);
  assert.match(html, /class="[^"]*winner/);
});

test('the median card shows the line and the pool it came from', () => {
  const html = renderWeek({ week: 3, resolved: PLAYED, teams: TEAMS, detailAvailable: true });
  assert.match(html, /107\.90/);
  assert.match(html, /118\.30/);
  assert.match(html, /97\.50/);
});

test('an upcoming week shows the real pairings and who draws the median', () => {
  // No resolved week exists before kickoff; the pairings file is the source.
  const html = renderWeek({
    week: 1, resolved: undefined, pairs: [[1, 3], [2, 4], [5, 6]],
    ghostRosterId: 6, teams: TEAMS,
  });
  assert.match(html, /Alpha/);
  assert.match(html, /Delta/);
  assert.match(html, /League median/);
  assert.match(html, /Foxtrot/, 'roster 5 is paired with the ghost');
  assert.doesNotMatch(html, /winner/, 'nothing has been won yet');
  assert.doesNotMatch(html, /Roster 6/, 'the ghost roster is never named as an opponent');
});

test('a week with neither results nor pairings says so', () => {
  const html = renderWeek({ week: 7, resolved: undefined, pairs: [], teams: TEAMS });
  assert.match(html, /not published/i);
});

test('a degenerate week explains itself instead of rendering an empty shell', () => {
  const html = renderWeek({
    week: 3, resolved: { ...PLAYED, degenerate: true, matchups: [] }, teams: TEAMS,
  });
  assert.match(html, /do not fit the league format/i);
});

test('matchups are not clickable when the week has no archived payload', () => {
  const on = renderWeek({ week: 3, resolved: PLAYED, teams: TEAMS, detailAvailable: true });
  const off = renderWeek({ week: 3, resolved: PLAYED, teams: TEAMS, detailAvailable: false });
  assert.match(on, /data-matchup="0"/);
  assert.doesNotMatch(off, /data-matchup=/);
  assert.match(off, /no player detail/i, 'and it says why rather than going quiet');
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test test/results-view.test.js`
Expected: FAIL — `renderWeek is not a function`.

- [ ] **Step 3: Move the card renderers over and add the upcoming variant**

Move these five from `render.js` into `results-view.js` **unchanged** — they are at
`render.js:49` (`REASON`), `:55` (`money`), `:57` (`penaltyList`), `:72` (`WIN_MARK`) and
`:77` (`teamBlock`). Import `esc` from `./render.js`, as `leaderboard-view.js` already does.
Leave them in `render.js` for now; Task 9 Step 5 deletes them, once nothing there still
calls them. Then add:

```js
/**
 * One week of the Results tab.
 *
 * Three shapes, in this order of precedence: a resolved week the engine
 * scored; a week Sleeper has pairings for but nobody has played; and a week
 * we know nothing about, which says so rather than rendering blank.
 *
 * `detailAvailable` is false for weeks with no archived payload — the 2025
 * archive was slimmed to a points map and cannot reconstruct a lineup. Those
 * matchups lose their click rather than 404 on it.
 */
export function renderWeek({
  week, resolved, pairs = [], ghostRosterId = null, teams = {}, detailAvailable = false,
}) {
  const name = (id) => teams[String(id)] || `Roster ${id}`;

  if (resolved?.degenerate) {
    return `<p class="empty">Sleeper's pairings do not fit the league format this
      week, so nothing could be scored. The week is excluded from the standings.</p>`;
  }

  if (resolved?.played) {
    const cards = resolved.matchups
      .map((m, i) => playedCard(m, i, resolved, teams, detailAvailable))
      .join('');
    const note = detailAvailable
      ? ''
      : '<p class="note">This week was archived before player detail was kept, so there is no player detail to open.</p>';
    return note + cards;
  }

  if (!pairs.length) {
    return `<p class="empty">Week ${week} has not been published by Sleeper yet.</p>`;
  }

  const medianId = medianRosterId(pairs, ghostRosterId);
  const rows = pairs
    .filter((pair) => !pair.includes(ghostRosterId))
    .map(
      ([a, b]) => `<li class="fixture">
        <span class="side-name">${esc(name(a))}</span>
        <span class="vs">vs</span>
        <span class="side-name">${esc(name(b))}</span>
      </li>`,
    );

  if (medianId !== null) {
    rows.push(`<li class="fixture median">
      <span class="side-name">${esc(name(medianId))}</span>
      <span class="vs">vs</span>
      <span class="side-name">League median</span>
    </li>`);
  }

  return `<p class="upcoming-label">Upcoming</p><ul class="fixtures">${rows.join('')}</ul>`;
}
```

with `playedCard` holding the existing card markup from `renderResults`, plus the click hook:

```js
function playedCard(m, index, wk, teams, detailAvailable) {
  const hook = detailAvailable
    ? ` data-matchup="${index}" role="button" tabindex="0"`
    : '';
  const cls = detailAvailable ? 'card clickable' : 'card';

  if (m.type === 'h2h') {
    const [a, b] = m.rosterIds;
    return `<div class="${cls} h2h"${hook}>
      ${teamBlock(a, wk.teams[a], teams, m.winner === a)}
      <div class="vs">${m.winner === null ? 'TIE' : 'vs'}</div>
      ${teamBlock(b, wk.teams[b], teams, m.winner === b)}
    </div>`;
  }

  const pool = (wk.medianPool || [])
    .map((s, i) => `<span class="${i === 1 || i === 2 ? 'used' : ''}">${money(s)}</span>`)
    .join('');

  return `<div class="${cls} median"${hook}>
    ${teamBlock(m.rosterId, wk.teams[m.rosterId], teams, m.result === 'W')}
    <div class="vs">${m.result === 'T' ? 'TIE' : 'vs median'}</div>
    <div class="side line ${m.result === 'L' ? 'winner' : ''}">
      <div class="name">${m.result === 'L' ? WIN_MARK : ''}League median</div>
      <div class="adj">${m.line === null ? '—' : money(m.line)}</div>
      <div class="raw">avg of 2nd &amp; 3rd</div>
      <div class="pool">${pool}</div>
    </div>
  </div>`;
}
```

- [ ] **Step 4: Style the upcoming week and the clickable card**

Append to `style.css`, after the `.pool` rules:

```css
/* --- Upcoming weeks ------------------------------------------------ */

.upcoming-label {
  margin: 0 0 var(--space-lg);
  font: 500 var(--t-3xs) / 1 var(--font-data);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--accent);
}

.fixtures { list-style: none; margin: 0; padding: 0; }

.fixture {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: var(--space-lg);
  align-items: center;
  padding: var(--space-lg) var(--space-xl);
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  margin-bottom: var(--space-md);
  font-size: var(--t-sm);
}

.fixture .side-name { font-weight: 600; min-width: 0; }
.fixture .side-name:last-child { text-align: right; }
.fixture.median .side-name:last-child { color: var(--muted); font-weight: 500; }

.card.clickable { cursor: pointer; }
.card.clickable:hover { border-color: var(--secondary); }
.card.clickable:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }

@media (max-width: 34rem) {
  .fixture { grid-template-columns: 1fr; gap: var(--space-sm); text-align: left; }
  .fixture .side-name:last-child { text-align: left; }
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS, 179 tests.

- [ ] **Step 6: Commit**

```bash
git add results-view.js test/results-view.test.js style.css
git commit -m "Render a single week, played or upcoming

An upcoming week is drawn from the pairings file and names who draws the
median, so the schedule is visible before kickoff instead of the tab
reading 'No weeks to show yet' for the whole preseason.

The ghost roster is filtered out of the fixture list rather than shown
as an opponent: nobody plays it, the team paired with it plays the
league median, and naming 'Roster 6' would be a fixture that does not
exist.

A week with no archived payload keeps its cards but loses the click and
says why, rather than offering a drill-down that would 404."
```

---

### Task 8: The matchup detail

**Files:**
- Modify: `results-view.js`
- Modify: `test/results-view.test.js`
- Modify: `style.css`

**Interfaces:**
- Consumes: `lineupRows` (Task 6)
- Produces: `renderMatchupDetail({week, matchup, resolved, payload, teams, rosterPositions, players}) => string`

- [ ] **Step 1: Write the failing test**

Append to `test/results-view.test.js`:

`PLAYED` and `TEAMS` are already defined in this file by Task 7; do not redeclare them.

```js
import { renderMatchupDetail } from '../results-view.js';

const DETAIL_PLAYERS = {
  a: { name: 'Ann QB', pos: 'QB', team: 'CIN' },
  b: { name: 'Bo RB', pos: 'RB', team: 'ATL' },
  z: { name: 'Zed WR', pos: 'WR', team: 'MIN' },
};
const DETAIL_POSITIONS = ['QB', 'RB', 'BN'];
const DETAIL_PAYLOAD = [
  { roster_id: 1, matchup_id: 1, starters: ['a', 'b'], starters_points: [17.4, 0],
    players: ['a', 'b', 'z'], players_points: { a: 17.4, b: 0, z: 8.1 } },
  { roster_id: 2, matchup_id: 1, starters: ['a', 'b'], starters_points: [9.2, 12.5],
    players: ['a', 'b'], players_points: { a: 9.2, b: 12.5 } },
];

test('a head-to-head detail lists both lineups with the bench', () => {
  const html = renderMatchupDetail({
    week: 3, matchup: { type: 'h2h', rosterIds: [1, 2], winner: 2 },
    resolved: PLAYED, payload: DETAIL_PAYLOAD, teams: TEAMS,
    rosterPositions: DETAIL_POSITIONS, players: DETAIL_PLAYERS,
  });
  assert.match(html, /Ann QB/);
  assert.match(html, /Zed WR/, 'the bench is shown too');
  assert.match(html, /Bench/i);
  assert.match(html, /17\.40/);
});

test('a zeroed starter is marked with the penalty that made him one', () => {
  // This is the league's whole identity; a detail view that hid it would be
  // showing Sleeper's numbers, not this league's.
  const html = renderMatchupDetail({
    week: 3, matchup: { type: 'h2h', rosterIds: [1, 2], winner: 2 },
    resolved: PLAYED, payload: DETAIL_PAYLOAD, teams: TEAMS,
    rosterPositions: DETAIL_POSITIONS, players: DETAIL_PLAYERS,
  });
  assert.match(html, /\+20/);
});

test('a median detail shows the line and marks the two scores averaged', () => {
  const html = renderMatchupDetail({
    week: 3, matchup: { type: 'median', rosterId: 5, line: 107.9, result: 'W' },
    resolved: PLAYED, payload: DETAIL_PAYLOAD, teams: TEAMS,
    rosterPositions: DETAIL_POSITIONS, players: DETAIL_PLAYERS,
  });
  assert.match(html, /League median/);
  assert.match(html, /107\.90/);
  assert.match(html, /class="[^"]*used/, 'the two averaged scores are marked');
  assert.match(html, /avg of 2nd/);
});

test('the detail escapes team and player names', () => {
  const html = renderMatchupDetail({
    week: 3, matchup: { type: 'h2h', rosterIds: [1, 2], winner: 2 },
    resolved: PLAYED, payload: DETAIL_PAYLOAD,
    teams: { 1: '<script>x</script>', 2: 'Bravo' },
    rosterPositions: DETAIL_POSITIONS,
    players: { ...DETAIL_PLAYERS, a: { name: '<img src=x>', pos: 'QB', team: 'CIN' } },
  });
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img /);
});

test('a missing payload entry does not throw', () => {
  const html = renderMatchupDetail({
    week: 3, matchup: { type: 'h2h', rosterIds: [1, 9], winner: 1 },
    resolved: PLAYED, payload: DETAIL_PAYLOAD, teams: TEAMS,
    rosterPositions: DETAIL_POSITIONS, players: DETAIL_PLAYERS,
  });
  assert.match(html, /Ann QB/);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test test/results-view.test.js`
Expected: FAIL — `renderMatchupDetail is not a function`.

- [ ] **Step 3: Implement**

Append to `results-view.js`:

```js
const entryFor = (payload, rosterId) =>
  (payload || []).find((e) => e.roster_id === rosterId) || null;

const penaltyIds = (resolved, rosterId) =>
  new Set((resolved?.teams?.[rosterId]?.penalties || []).map((p) => String(p.playerId)));

function playerCell(row, penalised, align) {
  const pen = penalised ? '<span class="pen">+20</span>' : '';
  const nameCls = row.empty ? 'lineup-name empty' : 'lineup-name';
  return `<div class="lineup-side ${align}">
    <span class="${nameCls}">${esc(row.name)}</span>
    <span class="lineup-pts">${money(row.points)}</span>
    ${pen}
  </div>`;
}

function lineupTable(left, right, leftPen, rightPen) {
  return left
    .map((row, i) => {
      const other = right ? right[i] : null;
      return `<div class="lineup-row">
        ${playerCell(row, leftPen.has(row.id), 'left')}
        <span class="lineup-slot">${esc(row.slot || '—')}</span>
        ${other ? playerCell(other, rightPen.has(other.id), 'right') : '<span></span>'}
      </div>`;
    })
    .join('');
}

/**
 * The drill-down: one matchup, both lineups, starters then bench.
 *
 * A median matchup has no opposing roster, so the right-hand column becomes
 * the line and the four adjusted scores it was drawn from — the two that
 * were averaged marked, same treatment as the summary card's pool.
 */
export function renderMatchupDetail({
  week, matchup, resolved, payload, teams = {}, rosterPositions = [], players = {},
}) {
  const name = (id) => teams[String(id)] || `Roster ${id}`;
  const isMedian = matchup.type === 'median';
  const leftId = isMedian ? matchup.rosterId : matchup.rosterIds[0];
  const rightId = isMedian ? null : matchup.rosterIds[1];

  const left = lineupRows(entryFor(payload, leftId), rosterPositions, players);
  const right = rightId === null
    ? null
    : lineupRows(entryFor(payload, rightId), rosterPositions, players);

  const leftPen = penaltyIds(resolved, leftId);
  const rightPen = rightId === null ? new Set() : penaltyIds(resolved, rightId);

  const leftTeam = resolved?.teams?.[leftId];
  const rightTeam = rightId === null ? null : resolved?.teams?.[rightId];
  const leftWon = isMedian ? matchup.result === 'W' : matchup.winner === leftId;

  const pool = (resolved?.medianPool || [])
    .map((s, i) => `<span class="${i === 1 || i === 2 ? 'used' : ''}">${money(s)}</span>`)
    .join('');

  const header = isMedian
    ? `<div class="detail-head">
         <div class="side ${leftWon ? 'winner' : ''}">
           <div class="name">${leftWon ? WIN_MARK : ''}${esc(name(leftId))}</div>
           <div class="adj">${leftTeam ? money(leftTeam.adjusted) : '—'}</div>
         </div>
         <div class="side line ${leftWon ? '' : 'winner'}">
           <div class="name">League median</div>
           <div class="adj">${matchup.line === null ? '—' : money(matchup.line)}</div>
           <div class="raw">avg of 2nd &amp; 3rd</div>
           <div class="pool">${pool}</div>
         </div>
       </div>`
    : `<div class="detail-head">
         <div class="side ${leftWon ? 'winner' : ''}">
           <div class="name">${leftWon ? WIN_MARK : ''}${esc(name(leftId))}</div>
           <div class="adj">${leftTeam ? money(leftTeam.adjusted) : '—'}</div>
         </div>
         <div class="side ${!leftWon && matchup.winner !== null ? 'winner' : ''}">
           <div class="name">${!leftWon && matchup.winner !== null ? WIN_MARK : ''}${esc(name(rightId))}</div>
           <div class="adj">${rightTeam ? money(rightTeam.adjusted) : '—'}</div>
         </div>
       </div>`;

  return `<div class="detail">
    <button type="button" class="back" data-back>&larr; Week ${week}</button>
    ${header}
    <h3 class="lineup-head">Starters</h3>
    <div class="lineup">${lineupTable(left.starters, right?.starters ?? null, leftPen, rightPen)}</div>
    <h3 class="lineup-head">Bench</h3>
    <div class="lineup">${lineupTable(left.bench, right?.bench ?? null, leftPen, rightPen)}</div>
  </div>`;
}
```

- [ ] **Step 4: Style the detail**

Append to `style.css`:

```css
/* --- Matchup detail ------------------------------------------------ */

.back {
  appearance: none;
  background: none;
  border: 0;
  padding: var(--space-md) 0;
  margin-bottom: var(--space-lg);
  font: 500 var(--t-sm) / 1 var(--font-body);
  color: var(--primary);
  cursor: pointer;
}
.back:hover { text-decoration: underline; }

.detail-head {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-xl);
  padding-bottom: var(--space-lg);
  border-bottom: 2px solid var(--ink-display);
  margin-bottom: var(--space-lg);
}

.lineup-head {
  font: 600 var(--t-3xs) / 1 var(--font-data);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--muted);
  margin: var(--space-2xl) 0 var(--space-md);
}

.lineup-row {
  display: grid;
  grid-template-columns: 1fr 4rem 1fr;
  align-items: baseline;
  gap: var(--space-md);
  padding: var(--space-md) 0;
  border-bottom: 1px solid var(--line);
}

.lineup-slot {
  font: 500 var(--t-3xs) / 1 var(--font-data);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  text-align: center;
}

.lineup-side { display: flex; align-items: baseline; gap: var(--space-md); min-width: 0; }
.lineup-side.right { flex-direction: row-reverse; }

.lineup-name {
  font-size: var(--t-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lineup-name.empty { color: var(--muted); font-style: italic; }

.lineup-pts {
  font-family: var(--font-data);
  font-variant-numeric: tabular-nums;
  font-size: var(--t-xs);
  font-weight: 600;
  flex: none;
}

@media (max-width: 34rem) {
  .lineup-row { grid-template-columns: 1fr 3rem 1fr; gap: var(--space-sm); }
  .lineup-name { font-size: var(--t-2xs); }
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS, 184 tests.

- [ ] **Step 6: Commit**

```bash
git add results-view.js test/results-view.test.js style.css
git commit -m "Add the matchup drill-down

Starters and bench for both rosters, slot-labelled from roster_positions
and scored from the archived payload the snapshot has always written and
the site has never read.

Zeroed starters carry their +20 inline. A detail view that showed only
Sleeper's numbers would be describing a different league than the one
being played.

A median matchup has no opposing roster, so the right column becomes the
line and the four scores it was drawn from, with the two that were
averaged marked — the same treatment the summary card already gives the
pool, expanded."
```

---

### Task 9: Mount it and wire it up

**Files:**
- Modify: `results-view.js`
- Modify: `app.js`
- Modify: `index.html`
- Modify: `render.js`
- Modify: `test/render.test.js`
- Modify: `style.css`

**Interfaces:**
- Consumes: `displayWeek`, `renderWeek`, `renderMatchupDetail`
- Produces: `mountResults(el, {teams, weeks, ghostRosterId, seasonStart, rosterPositions, livePayloads}) => Promise<void>`

- [ ] **Step 1: Write the failing test for the week list**

Append to `test/results-view.test.js`:

```js
import { weekOptions } from '../results-view.js';

test('the picker offers every week and marks the played ones', () => {
  const opts = weekOptions([{ week: 1, played: true }, { week: 2, played: false }], 18);
  assert.equal(opts.length, 18);
  assert.deepEqual(opts[0], { week: 1, played: true });
  assert.deepEqual(opts[1], { week: 2, played: false });
  assert.deepEqual(opts[17], { week: 18, played: false });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test test/results-view.test.js`
Expected: FAIL — `weekOptions is not a function`.

- [ ] **Step 3: Add `weekOptions` and `mountResults`**

```js
/** Every week 1..lastWeek, flagged with whether the engine has scored it. */
export function weekOptions(weeks, lastWeek = LAST_WEEK) {
  const played = new Set((weeks || []).filter((w) => w.played).map((w) => w.week));
  const out = [];
  for (let w = 1; w <= lastWeek; w++) out.push({ week: w, played: played.has(w) });
  return out;
}

async function defaultJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

/**
 * Mount the Results tab into `el`.
 *
 * Holds three pieces of state: the selected week, the selected matchup
 * within it, and a lazy cache of raw week payloads. Everything else is
 * recomputed from the arguments on every paint, the same way
 * mountLeaderboard works.
 *
 * `livePayloads` is the current week's payload that refreshLive already
 * fetched, so opening the live week's detail costs no request.
 */
export async function mountResults(el, {
  teams = {}, weeks = [], ghostRosterId = null, seasonStart = null,
  rosterPositions = [], livePayloads = {}, json = defaultJson, now = () => new Date(),
} = {}) {
  const byWeek = new Map((weeks || []).map((w) => [w.week, w]));
  const cache = { ...livePayloads };
  let pairings = null;
  let players = null;

  const view = { week: displayWeek(now(), seasonStart), matchup: null };

  try {
    pairings = (await json('data/pairings.json')).pairings || {};
  } catch {
    pairings = {};   // no schedule: upcoming weeks say "not published yet"
  }

  async function payloadFor(week) {
    if (cache[week] !== undefined) return cache[week];
    try {
      cache[week] = await json(`data/raw/wk${week}.json`);
    } catch {
      cache[week] = null;   // never archived: the week loses its drill-down
    }
    return cache[week];
  }

  async function playerMap() {
    if (players) return players;
    try {
      players = (await json('data/roster-players.json')).players || {};
    } catch {
      players = {};
    }
    return players;
  }

  function picker() {
    const btns = weekOptions(weeks)
      .map(
        ({ week, played }) =>
          `<button type="button" data-week="${week}" aria-pressed="${week === view.week}"` +
          ` class="${week === view.week ? 'on' : ''}${played ? ' played' : ''}">${week}</button>`,
      )
      .join('');
    return `<div class="controls">
      <button type="button" data-step="-1" aria-label="Previous week"${view.week <= 1 ? ' disabled' : ''}>&larr;</button>
      <div class="tabs weeks" role="group" aria-label="Week">${btns}</div>
      <button type="button" data-step="1" aria-label="Next week"${view.week >= LAST_WEEK ? ' disabled' : ''}>&rarr;</button>
    </div>`;
  }

  async function paint() {
    const resolved = byWeek.get(view.week);
    const payload = resolved?.played ? await payloadFor(view.week) : null;

    if (view.matchup !== null && resolved?.played && payload) {
      el.innerHTML = renderMatchupDetail({
        week: view.week,
        matchup: resolved.matchups[view.matchup],
        resolved, payload, teams, rosterPositions,
        players: await playerMap(),
      });
    } else {
      el.innerHTML = picker() + renderWeek({
        week: view.week,
        resolved,
        pairs: pairings[String(view.week)] || [],
        ghostRosterId, teams,
        detailAvailable: Boolean(payload),
      });
    }
    wire();
  }

  function wire() {
    for (const b of el.querySelectorAll('[data-week]')) {
      b.onclick = () => { view.week = Number(b.dataset.week); view.matchup = null; paint(); };
    }
    for (const b of el.querySelectorAll('[data-step]')) {
      b.onclick = () => {
        const next = view.week + Number(b.dataset.step);
        view.week = Math.min(LAST_WEEK, Math.max(1, next));
        view.matchup = null;
        paint();
      };
    }
    for (const c of el.querySelectorAll('[data-matchup]')) {
      const open = () => { view.matchup = Number(c.dataset.matchup); paint(); };
      c.onclick = open;
      // The card is a div with role="button", so Enter and Space are ours
      // to implement — a real button cannot wrap this grid without
      // flattening it.
      c.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      };
    }
    const back = el.querySelector('[data-back]');
    if (back) back.onclick = () => { view.matchup = null; paint(); };
  }

  await paint();
}
```

- [ ] **Step 4: Style the week picker**

Append to `style.css`:

```css
.controls .weeks button {
  min-width: 2.25rem;
  padding: var(--space-md) var(--space-sm);
  font-family: var(--font-data);
  font-variant-numeric: tabular-nums;
}

/* A week with results reads differently from one that has not happened. */
.controls .weeks button.played { color: var(--ink); border-color: var(--line-strong); }
.controls .weeks button.on { color: var(--card); background: var(--primary); border-color: var(--primary); }
```

- [ ] **Step 5: Strip `renderResults` from `render.js`**

Delete `renderResults`, `REASON`, `money`, `penaltyList`, `teamBlock` and `WIN_MARK` from
`render.js` — they now live in `results-view.js`. Keep `esc`, `renderStandings` and
`renderRules`. Move the corresponding tests out of `test/render.test.js`; the assertions
about penalties, raw-versus-adjusted display and the degenerate-week message are already
reproduced in Task 7's tests, so delete the originals rather than duplicating them.

- [ ] **Step 6: Wire `app.js`**

Replace the `renderResults` call in `paint()`:

```js
  if (showTables(owned)) {
    $('standings').innerHTML = renderStandings(standings(state.weeks), state.teams);
  } else {
    $('standings').innerHTML = '';
  }
```

Keep the live payload instead of discarding it, inside `refreshLive()` after the fetch:

```js
  // Kept, not discarded: the Results detail for the live week reads this
  // instead of re-fetching data/raw/wk{N}.json, which the Action may not
  // have written yet anyway.
  state.livePayloads[week] = payload;
```

Add `livePayloads: {}`, `seasonStart: null` and `rosterPositions: []` to the initial `state`,
and populate the latter two in `loadSnapshot`:

```js
  state.seasonStart = s.seasonStart ?? null;
  state.rosterPositions = s.rosterPositions || [];
```

Mount Results lazily in `wireNav`, exactly as the Players tab already is:

```js
      if (btn.dataset.view === 'results' && !resultsMounted) {
        resultsMounted = true;
        mountResults($('results'), state).catch((e) => {
          console.error(e);
          $('results').innerHTML = '<p class="empty">Could not load the results.</p>';
        });
      }
```

with `let resultsMounted = false;` beside `playersMounted`.

**Results is the default-visible tab's neighbour, not the default tab** — Standings is
still what opens. Mounting Results lazily means a visitor who never clicks it pays for
neither `pairings.json` nor `roster-players.json`.

- [ ] **Step 7: Run the tests**

Run: `npm test`
Expected: PASS, **178**. `test/render.test.js` has 12 tests today, 7 of which call
`renderResults` and are deleted by Step 5; this task adds 1. So 151 + 34 added across
Tasks 1-9 − 7 removed = 178. If the count is 185 the deletion in Step 5 was skipped and
`renderResults` is still exported; if it is below 178, more was deleted than the
`renderResults` tests.

- [ ] **Step 8: Verify in a browser**

```bash
python -m http.server 8125
```

Open `http://localhost:8125`, click **Results**, and confirm:
- The picker shows 18 weeks and opens on week 1 (today is before kickoff).
- Every week 1–18 shows three fixtures, one of them against "League median".
- No week names "Roster 6".
- Stepping with the arrows disables at 1 and 18.
- Keyboard: Tab reaches the week buttons; Enter selects.

The drill-down **cannot be exercised** — no 2026 week is played, so no card is clickable.
That is expected, and is the limitation §9.1 of the spec records.

- [ ] **Step 9: Commit**

```bash
git add results-view.js app.js index.html render.js test/render.test.js test/results-view.test.js style.css
git commit -m "Make Results a single-week view with a drill-down

The tab opened on every played week at once and, before kickoff, on
nothing at all. It now opens on the current week — derived from the
season start date, so it turns over on Wednesday — with a picker across
all 18, and clicking a matchup opens both lineups.

renderResults leaves render.js for results-view.js, following
leaderboard-view.js: pure functions that decide what to show, one mount
that touches the DOM. render.js keeps renderStandings and renderRules,
which have neither state nor fetching.

Mounted lazily like the Players tab, so a visitor who never opens
Results downloads neither pairings.json nor roster-players.json. The
live week's detail reuses the payload refreshLive already fetches."
```

---

## Verification

After Task 9, the whole feature is in. Confirm:

1. `npm test` — 178 passing, and `grep -rn renderResults .` returns nothing outside
   this plan and the git history.
2. `npm run snapshot` — writes `pairings.json` and `roster-players.json`, and the
   console line still reports whether content changed.
3. `npm run replay` — succeeds without network and does **not** blank `pairings.json`.
   This is the regression most likely to slip through, because the Action runs the
   fetch path and only a human runs replay.
4. Browser: all 18 weeks selectable, upcoming weeks show fixtures, no "Roster 6".

**Left unverified until 2026-09-09:** every path through `renderMatchupDetail`,
`lineupRows` against real Sleeper data, and the `starters[i]` ↔ `roster_positions[i]`
assumption in spec §6.1. Re-check the first played week before trusting the drill-down.
