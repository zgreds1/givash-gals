# Givash Gals Standings Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static site that computes and publishes the real standings for a lowest-score-wins Sleeper fantasy league whose format Sleeper cannot represent.

**Architecture:** A dependency-free pure-function engine (`rules.js`) expresses every league rule and is imported unchanged by both the browser and a scheduled GitHub Action, so the live page and the committed archive can never disagree. The page paints instantly from a committed JSON snapshot, then re-fetches only the current week from Sleeper and recomputes client-side. Hosting is GitHub Pages — no server, no database, no secrets.

**Tech Stack:** Vanilla ES modules, Node 22 (built-in `fetch`, `node:test`), GitHub Actions, GitHub Pages. Zero npm dependencies at runtime and in tests.

**Spec:** `docs/superpowers/specs/2026-08-19-givash-gals-standings-design.md`

## Global Constraints

- **Zero runtime dependencies.** No npm packages in `rules.js`, `sleeper.js`, the site, or the tests. Node 22 supplies `fetch` and `node:test`.
- **`rules.js` is pure.** No `fetch`, no `fs`, no `Date.now()`, no globals, no DOM. It is imported by both browser and Node; anything impure breaks one of them.
- **Penalty constant is exactly `20`.** Zero test is `Math.abs(points) < 1e-9`.
- **All money-figures round to 2 decimals** via a shared `round2` helper. Exact equality drives tie detection, so rounding must happen before comparison.
- **Lower is better everywhere.** Head-to-head winner is the lower adjusted score; the standings tiebreak sorts adjusted points-for *ascending*.
- **League ID is `1395797781926408192`; season is `2026`.** Both live in one exported config object, never inline.
- **Ghost roster is never hardcoded.** It is always the roster whose `owner_id` is `null`.
- **The browser never fetches `players/nfl`** (14.6 MB). It reads the committed slim map.
- **Git identity for this repo is already set repo-local** to `zgreds1 <122018292+zgreds1@users.noreply.github.com>`. Do not touch the global git config.
- **Sleeper base URL is `https://api.sleeper.app`.** The schedule endpoint is `/schedule/nfl/regular/2026` (no `/v1` prefix); everything else is under `/v1`.

---

### Task 1: Scaffold and bye-week derivation

Establishes the test harness and lands the first engine function. Bye weeks gate the DEF exemption, so this comes first.

**Files:**
- Create: `package.json`
- Create: `config.js`
- Create: `rules.js`
- Create: `test/helpers.js`
- Create: `test/rules.byes.test.js`
- Create: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `LEAGUE_ID`, `SEASON`, `PENALTY`, `EPS` from `config.js`; `round2(n) -> number` and `byeTeams(schedule, week) -> Set<string>` from `rules.js`; `mkEntry`, `PLAYERS`, `SCHEDULE` from `test/helpers.js`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "givash-gals",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test test/",
    "snapshot": "node scripts/snapshot.mjs",
    "replay": "node scripts/snapshot.mjs --replay"
  }
}
```

`"type": "module"` makes every `.js` file an ES module, so the same files load in the browser via `<script type="module">` and in Node with no transpilation.

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
.DS_Store
*.log
```

`data/` is deliberately NOT ignored — the committed snapshot is the whole point of the archive.

- [ ] **Step 3: Create `config.js`**

```js
// Single source of truth for league identity and scoring constants.
// Imported by the engine, the site, and the snapshot script.

export const LEAGUE_ID = '1395797781926408192';
export const SEASON = '2026';
export const API_BASE = 'https://api.sleeper.app';

/** Points added to a team's score for each starter that scores exactly zero. */
export const PENALTY = 20;

/** Float tolerance for "exactly zero". Sleeper reports 1-2 decimal places. */
export const EPS = 1e-9;

/** Last week the site covers. No playoff bracket — 15-18 are ordinary weeks. */
export const LAST_WEEK = 18;
```

- [ ] **Step 4: Create `test/helpers.js`**

Real player IDs and real 2026 bye weeks, taken from the Sleeper API on 2026-08-19. KC is on bye in week 5, HOU in week 8.

```js
// Shared fixtures. Player IDs and bye weeks are real values from the
// Sleeper API, captured 2026-08-19.

/**
 * Build a Sleeper matchup entry.
 * @param {number} rosterId
 * @param {number|null} matchupId
 * @param {Array<[string, number]>} pairs - [playerId, points] per starter
 */
export function mkEntry(rosterId, matchupId, pairs) {
  return {
    roster_id: rosterId,
    matchup_id: matchupId,
    starters: pairs.map((p) => p[0]),
    starters_points: pairs.map((p) => p[1]),
    points: pairs.reduce((a, p) => a + p[1], 0),
  };
}

/** Slim player map, same shape the snapshot script emits. */
export const PLAYERS = {
  6804: { pos: 'QB', team: 'CIN', name: 'Joe Burrow' },
  8205: { pos: 'RB', team: 'ATL', name: 'Bijan Robinson' },
  4199: { pos: 'WR', team: 'MIN', name: 'Justin Jefferson' },
  1466: { pos: 'K', team: 'BUF', name: 'Tyler Bass' },
  HOU: { pos: 'DEF', team: 'HOU', name: 'Houston Texans' },
  KC: { pos: 'DEF', team: 'KC', name: 'Kansas City Chiefs' },
};

/**
 * Minimal 4-team schedule across 3 weeks.
 * KC sits out week 5; HOU sits out week 8. Everyone plays week 3.
 */
export const SCHEDULE = [
  { week: 3, home: 'HOU', away: 'CIN' },
  { week: 3, home: 'KC', away: 'MIN' },
  { week: 5, home: 'HOU', away: 'CIN' },
  { week: 8, home: 'KC', away: 'MIN' },
];
```

- [ ] **Step 5: Write the failing test**

Create `test/rules.byes.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byeTeams, round2 } from '../rules.js';
import { SCHEDULE } from './helpers.js';

test('no team is on bye in a week everyone plays', () => {
  assert.deepEqual([...byeTeams(SCHEDULE, 3)].sort(), []);
});

test('teams absent from a week are on bye', () => {
  assert.deepEqual([...byeTeams(SCHEDULE, 5)].sort(), ['KC', 'MIN']);
  assert.deepEqual([...byeTeams(SCHEDULE, 8)].sort(), ['CIN', 'HOU']);
});

test('every team is on bye in a week with no games', () => {
  assert.equal(byeTeams(SCHEDULE, 12).size, 4);
});

test('round2 rounds to two decimals', () => {
  assert.equal(round2(107.90000000001), 107.9);
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(-1), -1);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `node --test test/rules.byes.test.js`
Expected: FAIL — `Cannot find module '../rules.js'`

- [ ] **Step 7: Write minimal implementation**

Create `rules.js`:

```js
// Pure league-rules engine. No I/O, no DOM, no clock.
// Imported unchanged by the browser and by scripts/snapshot.mjs.

import { PENALTY, EPS } from './config.js';

/** Round to 2 decimals. Tie detection relies on exact equality, so all
 *  scores are rounded before they are ever compared. */
export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * NFL teams idle in a given week.
 * A team is on bye if it appears in no game for that week.
 * @param {Array<{week:number, home:string, away:string}>} schedule
 * @param {number} week
 * @returns {Set<string>}
 */
export function byeTeams(schedule, week) {
  const all = new Set();
  const playing = new Set();
  for (const g of schedule) {
    all.add(g.home);
    all.add(g.away);
    if (g.week === week) {
      playing.add(g.home);
      playing.add(g.away);
    }
  }
  const byes = new Set();
  for (const t of all) if (!playing.has(t)) byes.add(t);
  return byes;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `node --test test/rules.byes.test.js`
Expected: PASS, 4 tests

- [ ] **Step 9: Commit**

```bash
git add package.json .gitignore config.js rules.js test/
git commit -m "feat: scaffold engine with bye-week derivation"
```

---

### Task 2: Adjusted score and the +20 penalty

The heart of the format. Every downstream number depends on this being exactly right, so the test matrix is exhaustive.

**Files:**
- Modify: `rules.js` (append `adjustedScore`)
- Create: `test/rules.score.test.js`

**Interfaces:**
- Consumes: `round2` from `rules.js`; `PENALTY`, `EPS` from `config.js`; `mkEntry`, `PLAYERS`, `SCHEDULE` from `test/helpers.js`; `byeTeams` from `rules.js`.
- Produces: `adjustedScore(entry, byes, players) -> {raw:number, adjusted:number, penalties:Array<{playerId:string|null, name:string, reason:'zeroed'|'empty-slot'|'bye-def'}>}`.

- [ ] **Step 1: Write the failing test**

Create `test/rules.score.test.js`. The first test is the spec's §4.2 worked example verbatim.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustedScore, byeTeams } from '../rules.js';
import { mkEntry, PLAYERS, SCHEDULE } from './helpers.js';

const WK3 = byeTeams(SCHEDULE, 3); // nobody on bye
const WK8 = byeTeams(SCHEDULE, 8); // HOU and CIN on bye

// Spec section 4.2
const EXAMPLE = [
  ['6804', 18.4],  // QB Burrow
  ['8205', 0.0],   // RB Robinson  -> +20 zeroed
  ['0', 0.0],      // empty WR slot -> +20
  ['1466', -1.0],  // K Bass, missed FG -> kept negative
  ['HOU', 0.0],    // DEF, not on bye -> exempt
  ['4199', 76.2],  // filler
];

test('worked example from spec 4.2', () => {
  const r = adjustedScore(mkEntry(1, 1, EXAMPLE), WK3, PLAYERS);
  assert.equal(r.raw, 93.6);
  assert.equal(r.adjusted, 133.6);
  assert.equal(r.penalties.length, 2);
});

test('a DEF on bye is penalised like any other starter', () => {
  const r = adjustedScore(mkEntry(1, 1, EXAMPLE), WK8, PLAYERS);
  assert.equal(r.raw, 93.6);
  assert.equal(r.adjusted, 153.6);
  assert.equal(r.penalties.length, 3);
  assert.ok(r.penalties.some((p) => p.reason === 'bye-def'));
});

test('a DEF at zero and not on bye is exempt', () => {
  const r = adjustedScore(mkEntry(1, 1, [['HOU', 0.0]]), WK3, PLAYERS);
  assert.equal(r.adjusted, 0);
  assert.deepEqual(r.penalties, []);
});

test('an empty starter slot takes the penalty', () => {
  const r = adjustedScore(mkEntry(1, 1, [['0', 0.0]]), WK3, PLAYERS);
  assert.equal(r.adjusted, 20);
  assert.equal(r.penalties[0].reason, 'empty-slot');
});

test('negative scores are preserved and never penalised', () => {
  const r = adjustedScore(mkEntry(1, 1, [['1466', -1.0]]), WK3, PLAYERS);
  assert.equal(r.raw, -1);
  assert.equal(r.adjusted, -1);
  assert.deepEqual(r.penalties, []);
});

test('penalties stack per starter', () => {
  const four = [['8205', 0], ['4199', 0], ['6804', 0], ['0', 0]];
  const r = adjustedScore(mkEntry(1, 1, four), WK3, PLAYERS);
  assert.equal(r.adjusted, 80);
  assert.equal(r.penalties.length, 4);
});

test('penalties name the player responsible', () => {
  const r = adjustedScore(mkEntry(1, 1, [['8205', 0]]), WK3, PLAYERS);
  assert.deepEqual(r.penalties, [
    { playerId: '8205', name: 'Bijan Robinson', reason: 'zeroed' },
  ]);
});

test('an unknown player id at zero is penalised as a normal starter', () => {
  const r = adjustedScore(mkEntry(1, 1, [['999999', 0]]), WK3, PLAYERS);
  assert.equal(r.adjusted, 20);
  assert.equal(r.penalties[0].reason, 'zeroed');
  assert.match(r.penalties[0].name, /999999/);
});

test('a missing starters_points entry counts as zero', () => {
  const entry = { roster_id: 1, matchup_id: 1, starters: ['8205'], starters_points: [] };
  const r = adjustedScore(entry, WK3, PLAYERS);
  assert.equal(r.adjusted, 20);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/rules.score.test.js`
Expected: FAIL — `adjustedScore is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `rules.js`:

```js
/**
 * A team's adjusted score: raw starter points plus PENALTY for each
 * starter that scored exactly zero.
 *
 * Exactly one exception: a DEF whose NFL team is NOT on bye is exempt,
 * because 0 is a legitimate defensive outcome under this league's
 * scoring settings (pts_allow_21_27 is 0.0).
 *
 * Negative scores pass through untouched — in a lowest-wins format a
 * negative is a reward, and this penalty exists to punish absent
 * lineups, not good ones.
 *
 * @param {{starters:string[], starters_points:number[]}} entry
 * @param {Set<string>} byes - NFL teams on bye this week
 * @param {Object<string,{pos:string,team:string,name:string}>} players
 */
export function adjustedScore(entry, byes, players) {
  const starters = entry.starters || [];
  const points = entry.starters_points || [];
  const penalties = [];
  let raw = 0;

  for (let i = 0; i < starters.length; i++) {
    const id = starters[i];
    const pts = points[i] ?? 0;
    raw += pts;

    if (Math.abs(pts) >= EPS) continue; // scored something, no penalty

    if (!id || id === '0') {
      penalties.push({ playerId: null, name: 'Empty slot', reason: 'empty-slot' });
      continue;
    }

    const meta = players[id];
    if (meta && meta.pos === 'DEF') {
      if (byes.has(meta.team)) {
        penalties.push({ playerId: id, name: meta.name, reason: 'bye-def' });
      }
      continue; // DEF not on bye: exempt
    }

    penalties.push({
      playerId: id,
      name: meta ? meta.name : `Unknown (${id})`,
      reason: 'zeroed',
    });
  }

  return {
    raw: round2(raw),
    adjusted: round2(raw + penalties.length * PENALTY),
    penalties,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/rules.score.test.js`
Expected: PASS, 9 tests

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, 13 tests

- [ ] **Step 6: Commit**

```bash
git add rules.js test/rules.score.test.js
git commit -m "feat: adjusted score with +20 zero penalty and DEF bye exemption"
```

---

### Task 3: Week resolution and the median line

**Files:**
- Modify: `rules.js` (append `resolveWeek`)
- Create: `test/rules.week.test.js`

**Interfaces:**
- Consumes: `adjustedScore`, `round2` from `rules.js`.
- Produces: `resolveWeek(week, matchups, ghostRosterId, byes, players) -> WeekResult` where

```
WeekResult = {
  week: number,
  played: boolean,
  median: number|null,
  medianPool: number[],          // the 4 non-bye adjusted scores, sorted desc
  teams: { [rosterId]: {raw, adjusted, penalties} },
  matchups: Array<
    | {type:'h2h', rosterIds:[number,number], winner:number|null}   // null = tie
    | {type:'median', rosterId:number, line:number|null, result:'W'|'L'|'T'}
  >
}
```

Note this signature adds a leading `week` parameter to the spec's §6.1 listing so the result object is self-describing.

- [ ] **Step 1: Write the failing test**

Create `test/rules.week.test.js`. The median test uses the spec §4.4 numbers, so the assertion `median === 107.9` is the plan's canonical arithmetic check.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWeek, byeTeams } from '../rules.js';
import { mkEntry, PLAYERS, SCHEDULE } from './helpers.js';

const WK3 = byeTeams(SCHEDULE, 3);
const GHOST = 6;

/** One WR starter carrying the whole score — no penalties in play. */
const solo = (rosterId, matchupId, pts) =>
  mkEntry(rosterId, matchupId, [['4199', pts]]);

/** Spec 4.4: non-bye scores 142.6 / 118.3 / 97.5 / 88.1 -> line 107.9 */
function specWeek() {
  return [
    solo(1, 1, 142.6),
    solo(2, 1, 88.1),
    solo(3, 2, 118.3),
    solo(4, 2, 97.5),
    solo(5, 3, 101.2),           // median team
    mkEntry(6, 3, [['4199', 0]]), // ghost roster
  ];
}

test('median line is the average of the 2nd and 3rd highest non-bye scores', () => {
  const r = resolveWeek(3, specWeek(), GHOST, WK3, PLAYERS);
  assert.deepEqual(r.medianPool, [142.6, 118.3, 97.5, 88.1]);
  assert.equal(r.median, 107.9);
});

test('median team wins when below the line', () => {
  const r = resolveWeek(3, specWeek(), GHOST, WK3, PLAYERS);
  const m = r.matchups.find((x) => x.type === 'median');
  assert.equal(m.rosterId, 5);
  assert.equal(m.result, 'W');
});

test('median team loses when above the line and ties when equal', () => {
  const above = specWeek();
  above[4] = solo(5, 3, 120.0);
  assert.equal(
    resolveWeek(3, above, GHOST, WK3, PLAYERS).matchups.find((x) => x.type === 'median').result,
    'L',
  );

  const equal = specWeek();
  equal[4] = solo(5, 3, 107.9);
  assert.equal(
    resolveWeek(3, equal, GHOST, WK3, PLAYERS).matchups.find((x) => x.type === 'median').result,
    'T',
  );
});

test('the lower adjusted score wins a head-to-head', () => {
  const r = resolveWeek(3, specWeek(), GHOST, WK3, PLAYERS);
  const h2h = r.matchups.filter((x) => x.type === 'h2h');
  assert.equal(h2h.length, 2);
  assert.equal(h2h.find((m) => m.rosterIds.includes(1)).winner, 2);
  assert.equal(h2h.find((m) => m.rosterIds.includes(3)).winner, 4);
});

test('penalties decide a head-to-head, not raw points', () => {
  const ms = [
    // roster 1: raw 100, one zeroed starter -> adjusted 120
    mkEntry(1, 1, [['4199', 100], ['8205', 0]]),
    // roster 2: raw 110, clean -> adjusted 110 -> wins despite higher raw
    mkEntry(2, 1, [['4199', 110]]),
    solo(3, 2, 118.3),
    solo(4, 2, 97.5),
    solo(5, 3, 101.2),
    mkEntry(6, 3, [['4199', 0]]),
  ];
  const r = resolveWeek(3, ms, GHOST, WK3, PLAYERS);
  const m = r.matchups.find((x) => x.type === 'h2h' && x.rosterIds.includes(1));
  assert.equal(r.teams[1].adjusted, 120);
  assert.equal(r.teams[2].adjusted, 110);
  assert.equal(m.winner, 2);
});

test('an exact adjusted tie has no winner', () => {
  const ms = specWeek();
  ms[1] = solo(2, 1, 142.6);
  const r = resolveWeek(3, ms, GHOST, WK3, PLAYERS);
  assert.equal(r.matchups.find((x) => x.type === 'h2h' && x.rosterIds.includes(1)).winner, null);
});

test('the ghost roster is excluded from the median pool and from teams', () => {
  const r = resolveWeek(3, specWeek(), GHOST, WK3, PLAYERS);
  assert.equal(r.medianPool.length, 4);
  assert.ok(!r.medianPool.includes(20)); // ghost's penalised score never appears
  assert.equal(r.teams[GHOST], undefined);
});

test('a real roster with a null matchup_id is the median team', () => {
  const ms = [
    solo(1, 1, 142.6),
    solo(2, 1, 88.1),
    solo(3, 2, 118.3),
    solo(4, 2, 97.5),
    solo(5, null, 101.2), // Sleeper omitted the ghost entirely
  ];
  const r = resolveWeek(3, ms, GHOST, WK3, PLAYERS);
  const m = r.matchups.find((x) => x.type === 'median');
  assert.equal(m.rosterId, 5);
  assert.equal(r.median, 107.9);
});

test('a week with no scores is marked unplayed', () => {
  const ms = [1, 2, 3, 4, 5, 6].map((i) => mkEntry(i, Math.ceil(i / 2), [['4199', 0]]));
  const r = resolveWeek(3, ms, GHOST, WK3, PLAYERS);
  assert.equal(r.played, false);
});

test('a week with any score is marked played', () => {
  assert.equal(resolveWeek(3, specWeek(), GHOST, WK3, PLAYERS).played, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/rules.week.test.js`
Expected: FAIL — `resolveWeek is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `rules.js`:

```js
/**
 * Resolve one week into matchup outcomes.
 *
 * The league runs 6 roster slots for 5 managers, so Sleeper schedules
 * three matchups and one of them contains the unowned ghost roster. The
 * real team in that pairing plays the league median instead of an
 * opponent. If Sleeper instead omits the ghost, the leftover real roster
 * (null matchup_id, or unpaired) is the median team.
 *
 * @param {number} week
 * @param {Array} matchups - raw Sleeper matchups/{week} payload
 * @param {number|null} ghostRosterId - roster with owner_id === null
 * @param {Set<string>} byes
 * @param {Object} players
 */
export function resolveWeek(week, matchups, ghostRosterId, byes, players) {
  const scored = matchups.map((m) => ({
    rosterId: m.roster_id,
    matchupId: m.matchup_id ?? null,
    ...adjustedScore(m, byes, players),
  }));

  const real = scored.filter((s) => s.rosterId !== ghostRosterId);

  const teams = {};
  for (const s of real) {
    teams[s.rosterId] = { raw: s.raw, adjusted: s.adjusted, penalties: s.penalties };
  }

  // Group by Sleeper's matchup_id, then strip the ghost out of each group.
  const groups = new Map();
  for (const s of scored) {
    if (s.matchupId === null) continue;
    if (!groups.has(s.matchupId)) groups.set(s.matchupId, []);
    groups.get(s.matchupId).push(s);
  }

  const h2hPairs = [];
  let medianTeam = null;
  for (const pair of groups.values()) {
    const reals = pair.filter((s) => s.rosterId !== ghostRosterId);
    if (reals.length === 2) h2hPairs.push(reals);
    else if (reals.length === 1) medianTeam = reals[0];
  }

  // Fallback: Sleeper omitted the ghost, so a real roster is unpaired.
  if (!medianTeam) {
    const paired = new Set(h2hPairs.flat().map((s) => s.rosterId));
    medianTeam = real.find((s) => !paired.has(s.rosterId)) || null;
  }

  const medianPool = h2hPairs
    .flat()
    .map((s) => s.adjusted)
    .sort((a, b) => b - a);

  const median = medianPool.length === 4 ? round2((medianPool[1] + medianPool[2]) / 2) : null;

  const out = [];
  for (const [a, b] of h2hPairs) {
    let winner = null;
    if (a.adjusted < b.adjusted) winner = a.rosterId;
    else if (b.adjusted < a.adjusted) winner = b.rosterId;
    out.push({ type: 'h2h', rosterIds: [a.rosterId, b.rosterId], winner });
  }

  if (medianTeam) {
    let result = 'T';
    if (median !== null) {
      if (medianTeam.adjusted < median) result = 'W';
      else if (medianTeam.adjusted > median) result = 'L';
    }
    out.push({ type: 'median', rosterId: medianTeam.rosterId, line: median, result });
  }

  return {
    week,
    played: real.some((s) => Math.abs(s.raw) >= EPS),
    median,
    medianPool,
    teams,
    matchups: out,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/rules.week.test.js`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add rules.js test/rules.week.test.js
git commit -m "feat: week resolution with median matchup for the odd manager out"
```

---

### Task 4: Standings and tiebreaks

**Files:**
- Modify: `rules.js` (append `standings`)
- Create: `test/rules.standings.test.js`

**Interfaces:**
- Consumes: `WeekResult[]` from `resolveWeek`.
- Produces: `standings(weeks) -> StandingsRow[]` where

```
StandingsRow = {
  rosterId: number, w: number, l: number, t: number, gp: number,
  winPct: number,          // (w + 0.5t) / gp, 0 when gp === 0
  adjPF: number, rawPF: number,
  median: {w:number, l:number, t:number},
  unresolvedTie: boolean   // true when H2H could not separate
}
```

- [ ] **Step 1: Write the failing test**

Create `test/rules.standings.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { standings } from '../rules.js';

/** Hand-built WeekResults — standings() never touches raw Sleeper data. */
function week(n, teams, matchups) {
  return { week: n, played: true, median: 100, medianPool: [], teams, matchups };
}

const T = (adjusted, raw = adjusted) => ({ adjusted, raw, penalties: [] });

test('lower adjusted score earns the win, ties count half', () => {
  const rows = standings([
    week(1, { 1: T(90), 2: T(110), 3: T(95), 4: T(95), 5: T(80) }, [
      { type: 'h2h', rosterIds: [1, 2], winner: 1 },
      { type: 'h2h', rosterIds: [3, 4], winner: null },
      { type: 'median', rosterId: 5, line: 100, result: 'W' },
    ]),
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.rosterId, r]));
  assert.deepEqual([by[1].w, by[1].l, by[1].t], [1, 0, 0]);
  assert.deepEqual([by[2].w, by[2].l, by[2].t], [0, 1, 0]);
  assert.deepEqual([by[3].w, by[3].l, by[3].t], [0, 0, 1]);
  assert.equal(by[3].winPct, 0.5);
  assert.deepEqual([by[5].w, by[5].l, by[5].t], [1, 0, 0]);
});

test('a median win counts the same as a head-to-head win', () => {
  const rows = standings([
    week(1, { 1: T(90), 2: T(110), 3: T(95), 4: T(97), 5: T(80) }, [
      { type: 'h2h', rosterIds: [1, 2], winner: 1 },
      { type: 'h2h', rosterIds: [3, 4], winner: 3 },
      { type: 'median', rosterId: 5, line: 100, result: 'W' },
    ]),
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.rosterId, r]));
  assert.equal(by[5].winPct, 1);
  assert.deepEqual(by[5].median, { w: 1, l: 0, t: 0 });
  assert.deepEqual(by[1].median, { w: 0, l: 0, t: 0 });
});

test('points-for accumulates across weeks', () => {
  const rows = standings([
    week(1, { 1: T(90, 70), 2: T(110) }, [{ type: 'h2h', rosterIds: [1, 2], winner: 1 }]),
    week(2, { 1: T(60, 60), 2: T(120) }, [{ type: 'h2h', rosterIds: [1, 2], winner: 1 }]),
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.rosterId, r]));
  assert.equal(by[1].adjPF, 150);
  assert.equal(by[1].rawPF, 130);
  assert.equal(by[1].gp, 2);
});

test('equal records break on LOWER adjusted points-for', () => {
  const rows = standings([
    week(1, { 1: T(200), 2: T(300), 3: T(100), 4: T(400) }, [
      { type: 'h2h', rosterIds: [1, 2], winner: 1 },
      { type: 'h2h', rosterIds: [3, 4], winner: 3 },
    ]),
  ]);
  // 1 and 3 are both 1-0; roster 3 scored less, so it ranks first.
  assert.deepEqual(rows.map((r) => r.rosterId), [3, 1, 2, 4]);
});

test('head-to-head separates teams tied on record and points-for', () => {
  // A and B both finish 1-1 with 250 adjusted PF. They met in week 1 and A
  // won, so A must rank above B. This is the only path that reaches the
  // H2H comparator — record and points-for both fail to separate them.
  const rows = standings([
    week(1, { 1: T(100), 2: T(150), 3: T(200), 4: T(250) }, [
      { type: 'h2h', rosterIds: [1, 2], winner: 1 },
      { type: 'h2h', rosterIds: [3, 4], winner: 3 },
    ]),
    week(2, { 1: T(150), 2: T(100), 3: T(100), 4: T(150) }, [
      { type: 'h2h', rosterIds: [1, 3], winner: 3 },
      { type: 'h2h', rosterIds: [2, 4], winner: 2 },
    ]),
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.rosterId, r]));
  assert.equal(by[1].adjPF, 250);
  assert.equal(by[2].adjPF, 250);
  assert.equal(by[1].winPct, by[2].winPct);
  assert.ok(rows.indexOf(by[1]) < rows.indexOf(by[2]));
  assert.equal(by[1].unresolvedTie, false);
});

test('unplayed weeks are ignored entirely', () => {
  const w = week(1, { 1: T(90), 2: T(110) }, [{ type: 'h2h', rosterIds: [1, 2], winner: 1 }]);
  w.played = false;
  const rows = standings([w]);
  assert.equal(rows.length, 0);
});

test('teams tied on every criterion are flagged rather than ordered arbitrarily', () => {
  const rows = standings([
    // Rosters 1 and 3 are both 1-0 on 100 PF and never played each other.
    // Rosters 2 and 4 are given different PF so only one tie is flagged.
    week(1, { 1: T(100), 2: T(200), 3: T(100), 4: T(300) }, [
      { type: 'h2h', rosterIds: [1, 2], winner: 1 },
      { type: 'h2h', rosterIds: [3, 4], winner: 3 },
    ]),
  ]);
  const tied = rows.filter((r) => r.unresolvedTie).map((r) => r.rosterId);
  assert.deepEqual(tied.sort(), [1, 3]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/rules.standings.test.js`
Expected: FAIL — `standings is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `rules.js`:

```js
/**
 * Season standings from resolved weeks.
 *
 * Sort order: win% descending, then adjusted points-for ASCENDING (lower
 * is better in this format), then head-to-head among the tied teams.
 * Teams that none of those separate are flagged rather than ordered by
 * accident.
 *
 * @param {WeekResult[]} weeks
 */
export function standings(weeks) {
  const rows = new Map();
  const ensure = (id) => {
    if (!rows.has(id)) {
      rows.set(id, {
        rosterId: id, w: 0, l: 0, t: 0, gp: 0,
        adjPF: 0, rawPF: 0,
        median: { w: 0, l: 0, t: 0 },
        unresolvedTie: false,
      });
    }
    return rows.get(id);
  };

  // rosterId -> opponentId -> {w,l,t}, used only for the H2H tiebreak
  const h2h = new Map();
  const noteH2H = (a, b, outcome) => {
    if (!h2h.has(a)) h2h.set(a, new Map());
    const m = h2h.get(a);
    if (!m.has(b)) m.set(b, { w: 0, l: 0, t: 0 });
    m.get(b)[outcome] += 1;
  };

  for (const wk of weeks) {
    if (!wk.played) continue;

    for (const [id, t] of Object.entries(wk.teams)) {
      const r = ensure(Number(id));
      r.adjPF = round2(r.adjPF + t.adjusted);
      r.rawPF = round2(r.rawPF + t.raw);
    }

    for (const m of wk.matchups) {
      if (m.type === 'h2h') {
        const [a, b] = m.rosterIds;
        const ra = ensure(a);
        const rb = ensure(b);
        ra.gp += 1;
        rb.gp += 1;
        if (m.winner === null) {
          ra.t += 1; rb.t += 1;
          noteH2H(a, b, 't'); noteH2H(b, a, 't');
        } else {
          const loser = m.winner === a ? b : a;
          ensure(m.winner).w += 1;
          ensure(loser).l += 1;
          noteH2H(m.winner, loser, 'w');
          noteH2H(loser, m.winner, 'l');
        }
      } else {
        const r = ensure(m.rosterId);
        r.gp += 1;
        if (m.result === 'W') { r.w += 1; r.median.w += 1; }
        else if (m.result === 'L') { r.l += 1; r.median.l += 1; }
        else { r.t += 1; r.median.t += 1; }
      }
    }
  }

  const list = [...rows.values()].map((r) => ({
    ...r,
    winPct: r.gp === 0 ? 0 : round2((r.w + 0.5 * r.t) / r.gp),
  }));

  const h2hPct = (a, b) => {
    const rec = h2h.get(a)?.get(b);
    if (!rec) return null;
    const g = rec.w + rec.l + rec.t;
    return g === 0 ? null : (rec.w + 0.5 * rec.t) / g;
  };

  list.sort((a, b) => {
    if (b.winPct !== a.winPct) return b.winPct - a.winPct;
    if (a.adjPF !== b.adjPF) return a.adjPF - b.adjPF; // lower is better
    const pa = h2hPct(a.rosterId, b.rosterId);
    const pb = h2hPct(b.rosterId, a.rosterId);
    if (pa !== null && pb !== null && pa !== pb) return pb - pa;
    return 0;
  });

  // Flag any pair that survived every criterion.
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i];
    const b = list[i + 1];
    const pa = h2hPct(a.rosterId, b.rosterId);
    const pb = h2hPct(b.rosterId, a.rosterId);
    const h2hSeparates = pa !== null && pb !== null && pa !== pb;
    if (a.winPct === b.winPct && a.adjPF === b.adjPF && !h2hSeparates) {
      a.unresolvedTie = true;
      b.unresolvedTie = true;
    }
  }

  return list;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/rules.standings.test.js`
Expected: PASS, 7 tests

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, 30 tests

- [ ] **Step 6: Commit**

```bash
git add rules.js test/rules.standings.test.js
git commit -m "feat: standings with lowest-points-for and head-to-head tiebreaks"
```

---

### Task 5: Sleeper data layer with rate-limit guards

**Files:**
- Create: `sleeper.js`
- Create: `test/sleeper.test.js`

**Interfaces:**
- Consumes: `API_BASE`, `LEAGUE_ID`, `SEASON` from `config.js`.
- Produces: `createClient({fetchImpl, now, minIntervalMs}) -> {state, league, users, rosters, matchups, schedule, findGhostRosterId}`. Every method returns a Promise. `findGhostRosterId(rosters) -> number|null` is a pure helper exported separately too.

- [ ] **Step 1: Write the failing test**

Create `test/sleeper.test.js`. A fake clock and a counting fetch stub make the guards deterministic — no real network, no sleeping.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, findGhostRosterId } from '../sleeper.js';

function stub(payload) {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => payload };
  };
  return { fetchImpl, calls: () => calls };
}

test('the ghost roster is the one with a null owner', () => {
  const rosters = [
    { roster_id: 1, owner_id: 'a' },
    { roster_id: 2, owner_id: 'b' },
    { roster_id: 3, owner_id: null },
  ];
  assert.equal(findGhostRosterId(rosters), 3);
});

test('no ghost roster when every slot is owned', () => {
  assert.equal(findGhostRosterId([{ roster_id: 1, owner_id: 'a' }]), null);
});

test('the first unowned roster wins when several are empty', () => {
  const rosters = [
    { roster_id: 1, owner_id: 'a' },
    { roster_id: 4, owner_id: null },
    { roster_id: 3, owner_id: null },
  ];
  assert.equal(findGhostRosterId(rosters), 3); // lowest id, deterministic
});

test('concurrent identical requests share one fetch', async () => {
  const s = stub({ week: 3 });
  const c = createClient({ fetchImpl: s.fetchImpl, now: () => 0 });
  await Promise.all([c.state(), c.state(), c.state()]);
  assert.equal(s.calls(), 1);
});

test('a repeat request inside the interval is served from cache', async () => {
  const s = stub({ week: 3 });
  let clock = 0;
  const c = createClient({ fetchImpl: s.fetchImpl, now: () => clock, minIntervalMs: 30000 });
  await c.state();
  clock = 29999;
  await c.state();
  assert.equal(s.calls(), 1);
});

test('a repeat request after the interval refetches', async () => {
  const s = stub({ week: 3 });
  let clock = 0;
  const c = createClient({ fetchImpl: s.fetchImpl, now: () => clock, minIntervalMs: 30000 });
  await c.state();
  clock = 30001;
  await c.state();
  assert.equal(s.calls(), 2);
});

test('a failed request rejects and does not poison the in-flight map', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 429, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ week: 3 }) };
  };
  const c = createClient({ fetchImpl, now: () => 0 });
  await assert.rejects(() => c.state(), /429/);
  assert.deepEqual(await c.state(), { week: 3 });
});

test('matchups and schedule hit the documented paths', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return { ok: true, status: 200, json: async () => [] };
  };
  const c = createClient({ fetchImpl, now: () => 0 });
  await c.matchups(7);
  await c.schedule();
  assert.ok(seen[0].endsWith('/v1/league/1395797781926408192/matchups/7'));
  assert.ok(seen[1].endsWith('/schedule/nfl/regular/2026'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sleeper.test.js`
Expected: FAIL — `Cannot find module '../sleeper.js'`

- [ ] **Step 3: Write minimal implementation**

Create `sleeper.js`:

```js
// Sleeper HTTP layer. The only place in the project that touches the network.
//
// Two hard guards against Sleeper's IP block (their limit is under 1000
// calls/minute): a minimum interval between identical requests, and a
// single-in-flight lock so a burst of callers shares one round trip.
//
// This module deliberately never fetches /v1/players/nfl — that payload is
// 14.6 MB and Sleeper asks it be pulled at most once a day. The snapshot
// script fetches it and commits a slim map instead.

import { API_BASE, LEAGUE_ID, SEASON } from './config.js';

/** The roster nobody owns. Lowest id wins so the answer is stable. */
export function findGhostRosterId(rosters) {
  const unowned = rosters.filter((r) => !r.owner_id).map((r) => r.roster_id);
  return unowned.length ? Math.min(...unowned) : null;
}

export function createClient({
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  minIntervalMs = 30000,
} = {}) {
  const inflight = new Map();
  const cache = new Map(); // path -> {at, data}

  async function get(path) {
    if (inflight.has(path)) return inflight.get(path);

    const hit = cache.get(path);
    if (hit && now() - hit.at < minIntervalMs) return hit.data;

    const p = (async () => {
      const res = await fetchImpl(API_BASE + path);
      if (!res.ok) throw new Error(`Sleeper ${res.status} for ${path}`);
      const data = await res.json();
      cache.set(path, { at: now(), data });
      return data;
    })();

    inflight.set(path, p);
    try {
      return await p;
    } finally {
      inflight.delete(path);
    }
  }

  return {
    get,
    state: () => get('/v1/state/nfl'),
    league: () => get(`/v1/league/${LEAGUE_ID}`),
    users: () => get(`/v1/league/${LEAGUE_ID}/users`),
    rosters: () => get(`/v1/league/${LEAGUE_ID}/rosters`),
    matchups: (week) => get(`/v1/league/${LEAGUE_ID}/matchups/${week}`),
    schedule: () => get(`/schedule/nfl/regular/${SEASON}`),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sleeper.test.js`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add sleeper.js test/sleeper.test.js
git commit -m "feat: Sleeper client with in-flight lock and refetch floor"
```

---

### Task 6: Snapshot script

**Files:**
- Create: `scripts/snapshot.mjs`
- Create: `test/snapshot.test.js`

**Interfaces:**
- Consumes: `createClient`, `findGhostRosterId` from `sleeper.js`; `byeTeams`, `resolveWeek`, `standings` from `rules.js`; `API_BASE`, `LAST_WEEK` from `config.js`.
- Produces: `slimPlayers(raw) -> Object` and `buildSnapshot({rosters, users, schedule, players, weekPayloads}) -> {standings, weeks, meta}`, both exported for testing. `main()` performs the I/O.

- [ ] **Step 1: Write the failing test**

Create `test/snapshot.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slimPlayers, buildSnapshot } from '../scripts/snapshot.mjs';
import { mkEntry, SCHEDULE } from './helpers.js';

test('slimPlayers keeps only active skill players and three fields', () => {
  const raw = {
    6804: { position: 'QB', team: 'CIN', full_name: 'Joe Burrow', active: true, college: 'LSU' },
    9999: { position: 'OL', team: 'CIN', full_name: 'Some Lineman', active: true },
    8888: { position: 'RB', team: 'CIN', full_name: 'Retired Guy', active: false },
    HOU: { position: 'DEF', team: 'HOU', first_name: 'Houston', last_name: 'Texans', active: true },
  };
  const slim = slimPlayers(raw);
  assert.deepEqual(Object.keys(slim).sort(), ['6804', 'HOU']);
  assert.deepEqual(slim['6804'], { pos: 'QB', team: 'CIN', name: 'Joe Burrow' });
  assert.deepEqual(slim.HOU, { pos: 'DEF', team: 'HOU', name: 'Houston Texans' });
});

test('buildSnapshot resolves every supplied week and names the teams', () => {
  const players = { 4199: { pos: 'WR', team: 'MIN', name: 'Justin Jefferson' } };
  const solo = (r, m, p) => mkEntry(r, m, [['4199', p]]);
  const snap = buildSnapshot({
    rosters: [1, 2, 3, 4, 5].map((i) => ({ roster_id: i, owner_id: `u${i}` }))
      .concat([{ roster_id: 6, owner_id: null }]),
    users: [1, 2, 3, 4, 5].map((i) => ({ user_id: `u${i}`, display_name: `Team ${i}` })),
    schedule: SCHEDULE,
    players,
    weekPayloads: {
      3: [solo(1, 1, 142.6), solo(2, 1, 88.1), solo(3, 2, 118.3),
          solo(4, 2, 97.5), solo(5, 3, 101.2), solo(6, 3, 0)],
    },
  });

  assert.equal(snap.meta.ghostRosterId, 6);
  assert.equal(snap.weeks.length, 1);
  assert.equal(snap.weeks[0].median, 107.9);
  assert.equal(snap.standings.length, 5);
  assert.equal(snap.meta.teams['1'], 'Team 1');
  assert.equal(snap.meta.teams['6'], undefined);
});

test('buildSnapshot skips weeks with no scores', () => {
  const players = { 4199: { pos: 'WR', team: 'MIN', name: 'JJ' } };
  const solo = (r, m, p) => mkEntry(r, m, [['4199', p]]);
  const snap = buildSnapshot({
    rosters: [{ roster_id: 1, owner_id: 'u1' }, { roster_id: 2, owner_id: null }],
    users: [{ user_id: 'u1', display_name: 'Team 1' }],
    schedule: SCHEDULE,
    players,
    weekPayloads: { 3: [solo(1, 1, 0), solo(2, 1, 0)] },
  });
  assert.equal(snap.weeks[0].played, false);
  assert.equal(snap.standings.length, 0);
});

test('a team name falls back to the display name when no team_name is set', () => {
  const snap = buildSnapshot({
    rosters: [{ roster_id: 1, owner_id: 'u1' }],
    users: [{ user_id: 'u1', display_name: 'LilDaveIII', metadata: { team_name: 'The Gals' } }],
    schedule: SCHEDULE,
    players: {},
    weekPayloads: {},
  });
  assert.equal(snap.meta.teams['1'], 'The Gals');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/snapshot.test.js`
Expected: FAIL — `Cannot find module '../scripts/snapshot.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `scripts/snapshot.mjs`:

```js
#!/usr/bin/env node
// Fetches Sleeper, archives the raw payloads, and writes the computed
// snapshot the site paints from. Run by .github/workflows/snapshot.yml.
//
//   node scripts/snapshot.mjs            fetch + compute + write
//   node scripts/snapshot.mjs --replay   recompute from data/raw, no network
//
// Every week is re-fetched every run, not just the current one, because
// Sleeper issues retroactive stat corrections days after a game.

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { API_BASE, LAST_WEEK } from '../config.js';
import { createClient, findGhostRosterId } from '../sleeper.js';
import { byeTeams, resolveWeek, standings } from '../rules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const RAW = path.join(DATA, 'raw');

const SKILL = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

/** Reduce the 14.6 MB players payload to the three fields rules.js needs. */
export function slimPlayers(raw) {
  const out = {};
  for (const [id, p] of Object.entries(raw)) {
    if (!p.active || !SKILL.has(p.position)) continue;
    const name =
      p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || id;
    out[id] = { pos: p.position, team: p.team, name };
  }
  return out;
}

/** Pure: everything the site needs, computed from already-fetched data. */
export function buildSnapshot({ rosters, users, schedule, players, weekPayloads }) {
  const ghostRosterId = findGhostRosterId(rosters);

  const userById = Object.fromEntries(users.map((u) => [u.user_id, u]));
  const teams = {};
  for (const r of rosters) {
    if (r.roster_id === ghostRosterId) continue;
    const u = userById[r.owner_id];
    teams[String(r.roster_id)] =
      u?.metadata?.team_name || u?.display_name || `Roster ${r.roster_id}`;
  }

  const weeks = Object.keys(weekPayloads)
    .map(Number)
    .sort((a, b) => a - b)
    .map((w) =>
      resolveWeek(w, weekPayloads[w], ghostRosterId, byeTeams(schedule, w), players),
    );

  return { standings: standings(weeks), weeks, meta: { ghostRosterId, teams } };
}

async function readRaw() {
  if (!existsSync(RAW)) return {};
  const out = {};
  for (const f of await readdir(RAW)) {
    const m = /^wk(\d+)\.json$/.exec(f);
    if (m) out[Number(m[1])] = JSON.parse(await readFile(path.join(RAW, f), 'utf8'));
  }
  return out;
}

async function main() {
  const replay = process.argv.includes('--replay');
  await mkdir(RAW, { recursive: true });

  const client = createClient({ minIntervalMs: 0 });
  let rosters;
  let users;
  let schedule;
  let weekPayloads;
  let players;

  if (replay) {
    rosters = JSON.parse(await readFile(path.join(RAW, 'rosters.json'), 'utf8'));
    users = JSON.parse(await readFile(path.join(RAW, 'users.json'), 'utf8'));
    schedule = JSON.parse(await readFile(path.join(RAW, 'schedule.json'), 'utf8'));
    players = JSON.parse(await readFile(path.join(DATA, 'players-slim.json'), 'utf8'));
    weekPayloads = await readRaw();
  } else {
    const state = await client.state();
    const current = Math.min(Number(state.week) || 1, LAST_WEEK);

    [rosters, users, schedule] = await Promise.all([
      client.rosters(),
      client.users(),
      client.schedule(),
    ]);

    await writeFile(path.join(RAW, 'rosters.json'), JSON.stringify(rosters));
    await writeFile(path.join(RAW, 'users.json'), JSON.stringify(users));
    await writeFile(path.join(RAW, 'schedule.json'), JSON.stringify(schedule));

    weekPayloads = {};
    for (let w = 1; w <= current; w++) {
      const payload = await client.matchups(w);
      if (!Array.isArray(payload) || payload.length === 0) continue;
      weekPayloads[w] = payload;
      await writeFile(path.join(RAW, `wk${w}.json`), JSON.stringify(payload));
    }

    players = await refreshPlayers();
  }

  const snap = buildSnapshot({ rosters, users, schedule, players, weekPayloads });
  const generatedAt = new Date().toISOString();

  await writeFile(
    path.join(DATA, 'standings.json'),
    JSON.stringify({ generatedAt, ...snap.meta, standings: snap.standings }, null, 2),
  );
  await writeFile(
    path.join(DATA, 'weeks.json'),
    JSON.stringify({ generatedAt, weeks: snap.weeks }, null, 2),
  );

  console.log(
    `snapshot: ${snap.weeks.filter((w) => w.played).length} played weeks, ` +
      `ghost roster ${snap.meta.ghostRosterId}`,
  );
}

/** Pull players/nfl at most once a day and keep the slim map on disk. */
async function refreshPlayers() {
  const slimPath = path.join(DATA, 'players-slim.json');
  const stampPath = path.join(DATA, '.players-stamp');
  const today = new Date().toISOString().slice(0, 10);

  if (existsSync(slimPath) && existsSync(stampPath)) {
    if ((await readFile(stampPath, 'utf8')).trim() === today) {
      return JSON.parse(await readFile(slimPath, 'utf8'));
    }
  }

  const res = await fetch(`${API_BASE}/v1/players/nfl`);
  if (!res.ok) {
    if (existsSync(slimPath)) return JSON.parse(await readFile(slimPath, 'utf8'));
    throw new Error(`players/nfl ${res.status}`);
  }
  const slim = slimPlayers(await res.json());
  await writeFile(slimPath, JSON.stringify(slim));
  await writeFile(stampPath, today);
  return slim;
}

// Only run when invoked directly, so the test can import the pure functions.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/snapshot.test.js`
Expected: PASS, 4 tests

- [ ] **Step 5: Capture a real Sleeper payload as a fixture**

Spec §11 requires the engine be exercised against genuine Sleeper data
shapes, not only hand-written fixtures. League `1123252569876344832` is a
real 12-team 2025 league with completed weeks. Take its week 1, keep the
first six rosters, and renumber them 1–6:

```bash
mkdir -p test/fixtures
curl -s "https://api.sleeper.app/v1/league/1123252569876344832/matchups/1" \
  | node -e "
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      const all=JSON.parse(s).slice(0,6);
      const out=all.map((m,i)=>({...m, roster_id:i+1, matchup_id:Math.ceil((i+1)/2)}));
      process.stdout.write(JSON.stringify(out,null,1));
    })" > test/fixtures/real-week.json
node -e "const d=require('./test/fixtures/real-week.json');
  console.log(d.length,'entries,',d[0].starters.length,'starters')"
```

Expected: `6 entries, 10 starters`. The source league starts 10 rather than
our 18, which is exactly the point — the engine must not assume a roster
shape. (Verified 2026-08-19: all six entries reconcile to the nearest cent,
so the Step 7 test will pass.)

- [ ] **Step 6: Write the failing test against the real payload**

Create `test/real-payload.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveWeek, adjustedScore } from '../rules.js';

const REAL = JSON.parse(readFileSync(new URL('./fixtures/real-week.json', import.meta.url)));
const NO_BYES = new Set();
const NO_PLAYERS = {}; // every id unknown — the harshest case for adjustedScore

test('the engine resolves a real Sleeper payload without throwing', () => {
  const r = resolveWeek(1, REAL, 6, NO_BYES, NO_PLAYERS);
  assert.equal(r.week, 1);
  assert.equal(r.played, true);
  assert.equal(Object.keys(r.teams).length, 5); // ghost excluded
  assert.equal(r.matchups.length, 3);           // 2 h2h + 1 median
  assert.equal(r.medianPool.length, 4);
  assert.equal(typeof r.median, 'number');
});

test('raw score matches the points Sleeper itself reported', () => {
  for (const entry of REAL) {
    const { raw } = adjustedScore(entry, NO_BYES, NO_PLAYERS);
    assert.ok(
      Math.abs(raw - entry.points) < 0.05,
      `roster ${entry.roster_id}: engine ${raw} vs Sleeper ${entry.points}`,
    );
  }
});
```

The second test is the important one: it proves `starters_points` actually
sums to the `points` Sleeper publishes, which is the assumption the whole
`+20` mechanism rests on.

- [ ] **Step 7: Run test to verify it passes**

Run: `node --test test/real-payload.test.js`
Expected: PASS, 2 tests. If the second test fails, `starters_points` does not
reconcile with `points` and the engine's raw-score assumption is wrong —
stop and investigate before continuing.

- [ ] **Step 8: Run it against the live league**

Run: `node scripts/snapshot.mjs`
Expected: exits 0. The league is pre-draft as of 2026-08-19, so `matchups/{week}` returns `[]` and the output reads `snapshot: 0 played weeks, ghost roster <id or null>`. `data/players-slim.json` should be roughly 100–200 KB. This is the real smoke test — it proves the script survives an empty season.

- [ ] **Step 9: Run the whole suite**

Run: `npm test`
Expected: PASS, 44 tests

- [ ] **Step 10: Commit**

```bash
git add scripts/snapshot.mjs test/snapshot.test.js test/real-payload.test.js test/fixtures/ data/
git commit -m "feat: snapshot script with raw archive and offline replay"
```

---

### Task 7: GitHub repository, Action, and Pages

No code to test here; the deliverable is a green workflow run and a live URL.

**Files:**
- Create: `.github/workflows/snapshot.yml`

**Interfaces:**
- Consumes: `npm test` and `node scripts/snapshot.mjs` from earlier tasks.
- Produces: a published Pages site and a scheduled job that commits `data/`.

- [ ] **Step 1: Create the workflow**

```yaml
name: snapshot

on:
  schedule:
    - cron: '0 17-23 * * 0'   # Sun 1pm-7pm ET, during games
    - cron: '0 0-4 * * 1'     # Sun evening -> Mon midnight ET
    - cron: '0 13 * * 2'      # Tue 9am ET, sweep after Monday night
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: snapshot
  cancel-in-progress: false

jobs:
  snapshot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Run engine tests
        run: npm test

      - name: Fetch and compute
        run: node scripts/snapshot.mjs

      - name: Commit if anything changed
        run: |
          git config user.name  "givash-bot"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/
          if git diff --staged --quiet; then
            echo "no change"
          else
            git commit -m "snapshot: $(date -u +%Y-%m-%d\ %H:%M) UTC"
            git push
          fi
```

`npm test` runs before the fetch on purpose: a broken engine should fail the job rather than commit wrong standings into the archive.

- [ ] **Step 2: Verify the account and create the repository**

```bash
gh auth switch --user zgreds1
gh api user --jq .login    # must print: zgreds1
gh repo create givash-gals --public --source=. --remote=origin --push
```

- [ ] **Step 3: Confirm the commits are attributed correctly**

Run: `git log --format='%an <%ae>' | sort -u`
Expected: every line is `zgreds1 <122018292+zgreds1@users.noreply.github.com>`. If `zgredses` appears, the repo-local git identity was lost — reset it with `git config user.name zgreds1` and `git config user.email 122018292+zgreds1@users.noreply.github.com`, then amend.

- [ ] **Step 4: Enable Pages**

```bash
gh api -X POST repos/zgreds1/givash-gals/pages \
  -f 'source[branch]=main' -f 'source[path]=/'
gh api repos/zgreds1/givash-gals/pages --jq .html_url
```

Expected: prints `https://zgreds1.github.io/givash-gals/`

- [ ] **Step 5: Trigger the workflow manually and confirm it is green**

```bash
gh workflow run snapshot.yml
gh run watch
```

Expected: the run succeeds. With the league still pre-draft it will report "no change" or commit an empty-season snapshot — both are correct outcomes.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/snapshot.yml
git commit -m "ci: scheduled snapshot workflow and Pages hosting"
git push
```

---

### Task 8: Site shell and standings page

The three sections share one shell. This task lands the shell plus Standings; Results follows in Task 9.

**Note for the implementer:** invoke the `frontend-design` skill before writing `style.css`. The visual direction should be deliberate rather than default-Bootstrap — this is a site five friends will look at every Sunday.

**Files:**
- Create: `index.html`
- Create: `style.css`
- Create: `app.js`
- Create: `render.js`

**Interfaces:**
- Consumes: `createClient`, `findGhostRosterId` from `sleeper.js`; `byeTeams`, `resolveWeek`, `standings` from `rules.js`; `data/standings.json`, `data/weeks.json`, `data/players-slim.json`.
- Produces: `renderStandings(rows, teams) -> string` (HTML) from `render.js`; `loadSnapshot()` and `refreshLive()` from `app.js`.

- [ ] **Step 1: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Givash Gals</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <header>
      <h1>Givash Gals</h1>
      <p class="tagline">Lowest score wins.</p>
      <nav>
        <button data-view="standings" class="active">Standings</button>
        <button data-view="results">Results</button>
        <button data-view="rules">Rules</button>
      </nav>
      <p id="freshness" class="freshness">Loading…</p>
    </header>

    <main>
      <section id="standings" class="view"></section>
      <section id="results" class="view" hidden></section>
      <section id="rules" class="view" hidden></section>
    </main>

    <script type="module" src="app.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `render.js` with the standings table**

```js
// Pure HTML builders. No fetching, no state — easy to eyeball and to test.

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

export function renderStandings(rows, teams) {
  if (!rows.length) {
    return '<p class="empty">No games played yet. Standings appear after week 1.</p>';
  }

  const body = rows
    .map((r, i) => {
      const name = teams[String(r.rosterId)] || `Roster ${r.rosterId}`;
      const rank = r.unresolvedTie ? `T-${i + 1}` : String(i + 1);
      const med = `${r.median.w}-${r.median.l}-${r.median.t}`;
      return `<tr>
        <td class="rank">${esc(rank)}</td>
        <td class="team">${esc(name)}</td>
        <td>${r.w}-${r.l}-${r.t}</td>
        <td>${r.winPct.toFixed(3).replace(/^0/, '')}</td>
        <td class="num">${r.adjPF.toFixed(2)}</td>
        <td class="num muted">${r.rawPF.toFixed(2)}</td>
        <td class="num muted">${med}</td>
      </tr>`;
    })
    .join('');

  return `<table class="standings">
    <thead><tr>
      <th></th><th>Team</th><th>Record</th><th>Win%</th>
      <th class="num">Adj PF <span class="hint">(low is good)</span></th>
      <th class="num">Raw PF</th><th class="num">vs Median</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}
```

- [ ] **Step 3: Create `app.js`**

```js
// Page controller. Paints the committed snapshot immediately, then
// re-fetches only the current week from Sleeper and recomputes.

import { LAST_WEEK } from './config.js';
import { createClient, findGhostRosterId } from './sleeper.js';
import { byeTeams, resolveWeek, standings } from './rules.js';
import { renderStandings } from './render.js';

const state = { weeks: [], teams: {}, ghostRosterId: null, generatedAt: null, live: false };

const $ = (id) => document.getElementById(id);

async function json(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

function paint() {
  $('standings').innerHTML = renderStandings(standings(state.weeks), state.teams);
  const when = state.generatedAt ? new Date(state.generatedAt).toLocaleString() : 'unknown';
  $('freshness').textContent = state.live
    ? 'Live · updated just now'
    : `Snapshot · as of ${when}`;
  $('freshness').className = state.live ? 'freshness live' : 'freshness';
}

async function loadSnapshot() {
  const [s, w] = await Promise.all([json('data/standings.json'), json('data/weeks.json')]);
  state.teams = s.teams || {};
  state.ghostRosterId = s.ghostRosterId ?? null;
  state.generatedAt = s.generatedAt;
  state.weeks = w.weeks || [];
  paint();
}

async function refreshLive() {
  const client = createClient();
  const [st, rosters, schedule, players] = await Promise.all([
    client.state(),
    client.rosters(),
    client.schedule(),
    json('data/players-slim.json'),
  ]);

  const week = Math.min(Number(st.week) || 1, LAST_WEEK);
  const ghost = findGhostRosterId(rosters) ?? state.ghostRosterId;
  const payload = await client.matchups(week);
  if (!Array.isArray(payload) || payload.length === 0) return;

  const fresh = resolveWeek(week, payload, ghost, byeTeams(schedule, week), players);
  if (!fresh.played) return;

  state.weeks = state.weeks.filter((w) => w.week !== week).concat(fresh);
  state.weeks.sort((a, b) => a.week - b.week);
  state.live = true;
  paint();
}

function wireNav() {
  for (const btn of document.querySelectorAll('nav button')) {
    btn.addEventListener('click', () => {
      for (const b of document.querySelectorAll('nav button')) b.classList.remove('active');
      btn.classList.add('active');
      for (const v of document.querySelectorAll('.view')) v.hidden = true;
      $(btn.dataset.view).hidden = false;
    });
  }
}

wireNav();
loadSnapshot()
  .catch((e) => {
    console.error(e);
    $('freshness').textContent = 'Could not load the snapshot.';
  })
  .then(() => refreshLive())
  .catch((e) => console.warn('live refresh failed, snapshot still shown', e));

export { loadSnapshot, refreshLive };
```

The live refresh is deliberately chained so a failure leaves the snapshot on screen with its original timestamp — the page is never blank and never mislabels stale data as live.

- [ ] **Step 4: Create `style.css`**

This is a working baseline, not the final look. Invoke `frontend-design`
first and let it override the palette and type — but ship something that
renders correctly either way.

```css
:root {
  --bg: #0f1115;
  --panel: #171a21;
  --line: #262b36;
  --text: #e7e9ee;
  --muted: #8b94a7;
  --win: #4ade80;
  --pen: #f87171;
  --accent: #60a5fa;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}

header {
  padding: 1.5rem 1rem 0.75rem;
  border-bottom: 1px solid var(--line);
}

h1 { margin: 0; font-size: 1.6rem; letter-spacing: -0.02em; }

.tagline { margin: 0.15rem 0 1rem; color: var(--muted); font-size: 0.9rem; }

nav { display: flex; gap: 0.5rem; flex-wrap: wrap; }

nav button {
  background: var(--panel);
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 0.4rem 0.9rem;
  font: inherit;
  font-size: 0.9rem;
  cursor: pointer;
}

nav button.active { color: var(--text); border-color: var(--accent); }

.freshness { margin: 0.85rem 0 0; font-size: 0.8rem; color: var(--muted); }
.freshness.live { color: var(--win); }

main { padding: 1rem; max-width: 60rem; margin: 0 auto; }

.empty { color: var(--muted); padding: 2rem 0; text-align: center; }

table.standings { width: 100%; border-collapse: collapse; font-size: 0.95rem; }

.standings th {
  text-align: left;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  font-weight: 600;
  padding: 0.5rem 0.4rem;
  border-bottom: 1px solid var(--line);
}

.standings td { padding: 0.6rem 0.4rem; border-bottom: 1px solid var(--line); }

.standings .num, .standings th.num { text-align: right; font-variant-numeric: tabular-nums; }
.standings .rank { color: var(--muted); width: 2.5rem; }
.standings .team { font-weight: 600; }
.standings .muted { color: var(--muted); }
.hint { font-weight: 400; text-transform: none; letter-spacing: 0; opacity: 0.7; }

@media (max-width: 34rem) {
  .standings .muted { display: none; }
  main { padding: 0.75rem; }
}
```

- [ ] **Step 5: Surface degenerate league states (spec §10)**

The format assumes exactly 5 owned rosters in 6 slots. Both other states are
reachable and must be visible rather than silently producing wrong numbers.

Add the banner element to `index.html`, directly after `</header>`:

```html
<div id="banner" class="banner" hidden></div>
```

Add to `style.css`:

```css
.banner {
  margin: 1rem;
  padding: 0.7rem 0.9rem;
  border: 1px solid #b45309;
  background: #2a1e0c;
  color: #fcd34d;
  border-radius: 8px;
  font-size: 0.88rem;
}
```

Add to `app.js` — a pure function plus one call inside `paint()`:

```js
/** Returns a warning string when the league is not in the shape the
 *  format assumes, or null when everything is normal. */
export function leagueWarning(ownedCount, ghostRosterId) {
  if (ghostRosterId === null) {
    return 'All six roster slots are owned. There is no median matchup this ' +
           'season — every week is three straight head-to-head games.';
  }
  if (ownedCount < 5) {
    return `Only ${ownedCount} of 5 managers have joined. Standings are on ` +
           'hold until the league is full.';
  }
  return null;
}
```

```js
function paintBanner() {
  const msg = leagueWarning(Object.keys(state.teams).length, state.ghostRosterId);
  const el = $('banner');
  el.hidden = msg === null;
  el.textContent = msg || '';
}
```

Call `paintBanner()` as the last line of `paint()`.

Note `state.teams` already excludes the ghost roster (the snapshot's `meta.teams`
omits it), so its length is exactly the owned-manager count.

- [ ] **Step 6: Test the banner logic**

Create `test/app.test.js` (`test/render.test.js` does not exist until Task 9):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leagueWarning } from '../app.js';

test('no warning when the league is the expected shape', () => {
  assert.equal(leagueWarning(5, 6), null);
});

test('warns when every roster slot is owned', () => {
  assert.match(leagueWarning(6, null), /no median matchup/i);
});

test('warns when the league is not yet full', () => {
  assert.match(leagueWarning(3, 6), /3 of 5/);
});
```

`app.js` touches `document` at module scope via `wireNav()`, which would throw
under Node. Guard the bottom of `app.js` so the module stays importable:

```js
if (typeof document !== 'undefined') {
  wireNav();
  loadSnapshot()
    .catch((e) => {
      console.error(e);
      $('freshness').textContent = 'Could not load the snapshot.';
    })
    .then(() => refreshLive())
    .catch((e) => console.warn('live refresh failed, snapshot still shown', e));
}
```

Run: `node --test test/app.test.js`
Expected: PASS, 3 tests (they fail first if `leagueWarning` is missing).

- [ ] **Step 7: Verify in a browser**

Run: `python -m http.server 8125` from the project folder, then open `http://localhost:8125`.
Expected: the header renders, the three nav buttons switch sections, and Standings shows the "No games played yet" empty state (correct pre-season). With only 2 managers joined as of 2026-08-19, the amber banner should read "Only 2 of 5 managers have joined." No console errors.

- [ ] **Step 8: Commit**

```bash
git add index.html style.css app.js render.js test/app.test.js
git commit -m "feat: site shell, standings view, and league-state banner"
```

---

### Task 9: Results page

The page the league will actually argue over, so every `+20` must name the player that caused it.

**Files:**
- Modify: `render.js` (append `renderResults`)
- Modify: `app.js` (call it from `paint`)
- Modify: `index.html` (add a week picker)
- Create: `test/render.test.js`

**Interfaces:**
- Consumes: `WeekResult[]` from `rules.js`; `teams` map from the snapshot meta.
- Produces: `renderResults(weeks, teams) -> string` from `render.js`.

- [ ] **Step 1: Write the failing test**

Create `test/render.test.js`. `render.js` is pure string-building, so it tests in Node with no DOM.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderResults, renderStandings } from '../render.js';

const TEAMS = { 1: 'Alpha', 2: 'Bravo', 5: 'Echo' };

const WEEK = {
  week: 3,
  played: true,
  median: 107.9,
  medianPool: [142.6, 118.3, 97.5, 88.1],
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

test('every penalty names the player and the reason', () => {
  const html = renderResults([WEEK], TEAMS);
  assert.match(html, /Bijan Robinson/);
  assert.match(html, /\+20/);
});

test('both raw and adjusted scores are shown', () => {
  const html = renderResults([WEEK], TEAMS);
  assert.match(html, /122\.60/);
  assert.match(html, /142\.60/);
});

test('the median card shows the line and the pool', () => {
  const html = renderResults([WEEK], TEAMS);
  assert.match(html, /107\.90/);
  assert.match(html, /118\.30/);
  assert.match(html, /97\.50/);
});

test('the winner is marked', () => {
  const html = renderResults([WEEK], TEAMS);
  assert.match(html, /class="[^"]*winner/);
});

test('unplayed weeks render as upcoming, not as ties', () => {
  const html = renderResults([{ ...WEEK, played: false }], TEAMS);
  assert.match(html, /Not played yet/i);
  assert.doesNotMatch(html, /winner/);
});

test('team names are escaped', () => {
  const html = renderStandings(
    [{ rosterId: 1, w: 1, l: 0, t: 0, gp: 1, winPct: 1, adjPF: 100, rawPF: 100, median: { w: 0, l: 0, t: 0 }, unresolvedTie: false }],
    { 1: '<script>x</script>' },
  );
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/render.test.js`
Expected: FAIL — `renderResults is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `render.js`:

```js
const REASON = {
  zeroed: 'scored 0',
  'empty-slot': 'empty slot',
  'bye-def': 'DEF on bye',
};

const money = (n) => n.toFixed(2);

function penaltyList(penalties) {
  if (!penalties.length) return '';
  const items = penalties
    .map((p) => `<li><span class="pen">+20</span> ${esc(p.name)} <em>${esc(REASON[p.reason] || p.reason)}</em></li>`)
    .join('');
  return `<ul class="penalties">${items}</ul>`;
}

function teamBlock(rosterId, team, teams, isWinner) {
  const name = teams[String(rosterId)] || `Roster ${rosterId}`;
  return `<div class="side ${isWinner ? 'winner' : ''}">
    <div class="name">${esc(name)}</div>
    <div class="adj">${money(team.adjusted)}</div>
    <div class="raw">raw ${money(team.raw)}</div>
    ${penaltyList(team.penalties)}
  </div>`;
}

export function renderResults(weeks, teams) {
  if (!weeks.length) return '<p class="empty">No weeks to show yet.</p>';

  return weeks
    .slice()
    .sort((a, b) => b.week - a.week)
    .map((wk) => {
      if (!wk.played) {
        return `<article class="week"><h2>Week ${wk.week}</h2>
          <p class="empty">Not played yet.</p></article>`;
      }

      const cards = wk.matchups
        .map((m) => {
          if (m.type === 'h2h') {
            const [a, b] = m.rosterIds;
            return `<div class="card h2h">
              ${teamBlock(a, wk.teams[a], teams, m.winner === a)}
              <div class="vs">${m.winner === null ? 'TIE' : 'vs'}</div>
              ${teamBlock(b, wk.teams[b], teams, m.winner === b)}
            </div>`;
          }

          const pool = wk.medianPool
            .map((s, i) => `<span class="${i === 1 || i === 2 ? 'used' : ''}">${money(s)}</span>`)
            .join('');

          return `<div class="card median">
            ${teamBlock(m.rosterId, wk.teams[m.rosterId], teams, m.result === 'W')}
            <div class="vs">${m.result === 'T' ? 'TIE' : 'vs median'}</div>
            <div class="side line ${m.result === 'L' ? 'winner' : ''}">
              <div class="name">League median</div>
              <div class="adj">${m.line === null ? '—' : money(m.line)}</div>
              <div class="raw">avg of 2nd &amp; 3rd</div>
              <div class="pool">${pool}</div>
            </div>
          </div>`;
        })
        .join('');

      return `<article class="week"><h2>Week ${wk.week}</h2>${cards}</article>`;
    })
    .join('');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/render.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Wire it into the page**

In `app.js`, add the import and one line inside `paint()`:

```js
import { renderStandings, renderResults } from './render.js';
```

```js
function paint() {
  $('standings').innerHTML = renderStandings(standings(state.weeks), state.teams);
  $('results').innerHTML = renderResults(state.weeks, state.teams);
  // ...freshness label unchanged
}
```

- [ ] **Step 6: Add the styles**

Append to `style.css`:

```css
.week { margin: 0 0 2rem; }

.week h2 {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  margin: 0 0 0.6rem;
}

.card {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 0.75rem;
  align-items: start;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0.9rem;
  margin-bottom: 0.6rem;
}

.side { min-width: 0; }
.side .name { font-weight: 600; margin-bottom: 0.2rem; }

.side .adj {
  font-size: 1.5rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.side .raw { font-size: 0.78rem; color: var(--muted); }

/* The winner is the LOW score — make that unmissable. */
.side.winner .adj { color: var(--win); }
.side.winner .name::after { content: " ✓"; color: var(--win); }

.vs {
  align-self: center;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  text-align: center;
}

.penalties { list-style: none; margin: 0.5rem 0 0; padding: 0; font-size: 0.78rem; }
.penalties li { color: var(--muted); margin-bottom: 0.15rem; }
.penalties em { font-style: normal; opacity: 0.75; }
.pen { color: var(--pen); font-weight: 700; margin-right: 0.25rem; }

.pool { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.5rem; }

.pool span {
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0.05rem 0.35rem;
  opacity: 0.45;
}

/* The two scores that were actually averaged. */
.pool span.used { opacity: 1; color: var(--text); border-color: var(--accent); }

@media (max-width: 34rem) {
  .card { grid-template-columns: 1fr; }
  .vs { text-align: left; }
}
```

- [ ] **Step 7: Verify in a browser**

Run: `python -m http.server 8125`, open `http://localhost:8125`, click Results.
Expected: the empty state renders cleanly with no console errors.

- [ ] **Step 8: Run the whole suite and commit**

Run: `npm test`
Expected: PASS, 53 tests

```bash
git add render.js app.js index.html style.css test/render.test.js
git commit -m "feat: results view with itemised penalties and median breakdown"
```

---

### Task 10: Rules page and project documentation

**Files:**
- Create: `RULES.md`
- Create: `README.md`
- Modify: `render.js` (append `renderRules`)
- Modify: `app.js` (call it from `paint`)

**Interfaces:**
- Consumes: `PENALTY` from `config.js`.
- Produces: `renderRules() -> string` from `render.js`.

- [ ] **Step 1: Create `RULES.md`**

```markdown
# Givash Gals — league rules

Non-obvious scoring rules, stated exactly. Kept in lockstep with `rules.js`;
change one and change the other in the same commit.

## Lowest score wins

Every head-to-head matchup is won by the **lower** adjusted score. Equal
adjusted scores are a tie, worth 0.5 in the standings.

## The +20 penalty

Each starter that scores **exactly 0** adds **20 points** to your total.
"Exactly 0" means `Math.abs(points) < 1e-9`.

One exception: **a DEF that is not on bye is exempt.** A defense scoring 0 is
a legitimate outcome under this league's settings (`pts_allow_21_27` is 0.0),
so it is not punished. A DEF whose NFL team *is* on bye is penalised like
anyone else.

Deliberate consequences:

- **Negative scores are kept.** A kicker at -1 for a missed field goal stays
  at -1. A negative is a reward here; the penalty exists to punish absent
  lineups, not good ones.
- **An empty starter slot counts as 0 and takes +20.**
- **Penalties stack.** Four zeroes is +80.

### Worked example

    QB   Burrow      18.4
    RB   Robinson     0.0   -> +20  (scored 0)
    WR   (empty)      0.0   -> +20  (empty slot)
    K    Bass        -1.0          (missed FG, kept negative)
    DEF  HOU          0.0          (exempt, HOU not on bye in week 3)
    ...  rest                76.2

    Raw       = 93.6
    Penalties = +40
    Adjusted  = 133.6

In week 8, when Houston is on bye, that same DEF takes +20 and the adjusted
score is 153.6.

## The median matchup

The league has 5 managers in 6 roster slots. The roster nobody owns is the
**ghost roster**; it is excluded from everything. Each week the real team
Sleeper pairs against the ghost plays the **league median** instead of an
opponent.

The median is the average of the **2nd and 3rd highest adjusted scores among
the four teams playing head-to-head** that week. The ghost and the median
team are both excluded from that pool.

    median = (2nd highest + 3rd highest) / 2

The median team **wins if its adjusted score is below the line**, loses if
above, ties if exactly equal.

### Worked example

Non-bye adjusted scores: 142.6, 118.3, 97.5, 88.1.
2nd is 118.3, 3rd is 97.5, so the line is (118.3 + 97.5) / 2 = **107.9**.
A median team at 101.2 is below the line and **wins**.

Penalties are applied *before* the median is computed. Every score in the
system is an adjusted score — there is only one kind.

## Standings

- Record is W-L-T. A tie counts 0.5.
- A median win counts exactly the same as a head-to-head win.
- Win% is `(W + 0.5 x T) / (W + L + T)`.
- Tiebreaks, in order: win%, then **lowest** adjusted points-for, then
  head-to-head. Teams none of those separate are shown with a `T-` rank.

## Scope

Weeks 1-18 are all treated as regular-season weeks. There is no playoff
bracket — Sleeper's assumes 6 teams and highest-score-wins, so it cannot be
reused.
```

- [ ] **Step 2: Create `README.md`**

```markdown
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

The page paints instantly from `data/standings.json`, then re-fetches only
the current week from Sleeper and recomputes client-side — two API calls per
load. A scheduled Action archives the raw weekly payloads to `data/raw/` and
refreshes the snapshot. The Action is a safety net, not the freshness
mechanism; freshness comes from the live fetch.

`--replay` rescores the whole season from `data/raw/` with zero API calls, so
a mid-season rule change can be applied retroactively.
```

- [ ] **Step 3: Add `renderRules` to `render.js`**

Put this import at the **top** of `render.js`, above `esc` — not at the
bottom with the function:

```js
import { PENALTY } from './config.js';
```

Then append the function:

```js
export function renderRules() {
  return `<div class="rules">
    <h2>Lowest score wins</h2>
    <p>Every matchup goes to the <strong>lower</strong> adjusted score. An exact
       tie counts half a win.</p>

    <h2>The +${PENALTY} penalty</h2>
    <p>Each starter that scores <strong>exactly 0</strong> adds
       <strong>${PENALTY}</strong> to your total. Empty slots count as 0.
       Penalties stack.</p>
    <p><strong>Exception:</strong> a DEF that is not on bye is exempt — 0 is a
       legitimate defensive score in this league. A DEF on bye is not exempt.</p>
    <p>Negative scores are kept as-is. A kicker at &minus;1 stays at &minus;1;
       that is a reward, not something to punish.</p>

    <h2>The median matchup</h2>
    <p>Five managers occupy six roster slots. Each week the team Sleeper pairs
       against the empty roster plays the <strong>league median</strong>: the
       average of the 2nd and 3rd highest adjusted scores among the four teams
       playing each other.</p>
    <p>That team <strong>wins if it finishes below the line</strong>.</p>

    <h2>Standings</h2>
    <p>Win%, then <strong>lowest</strong> adjusted points-for, then
       head-to-head. A median win counts the same as any other win.</p>
  </div>`;
}
```

- [ ] **Step 4: Wire it into `paint()`**

```js
import { renderStandings, renderResults, renderRules } from './render.js';
```

```js
$('rules').innerHTML = renderRules();
```

- [ ] **Step 5: Verify and run the suite**

Run: `npm test` — Expected: PASS, 53 tests
Run: `python -m http.server 8125`, open the page, click Rules.
Expected: the rules render with `+20` in the heading, sourced from `PENALTY`.

- [ ] **Step 6: Commit and push**

```bash
git add RULES.md README.md render.js app.js
git commit -m "docs: rules page, RULES.md, and README"
git push
```

- [ ] **Step 7: Confirm the live site**

Open `https://zgreds1.github.io/givash-gals/`.
Expected: all three sections render. Standings and Results show their
pre-season empty states; Rules is fully populated.

---

## September checklist

Two things in this plan cannot be verified until the league fills and week 1
is played. Re-check both once real data exists:

1. **Does Sleeper schedule a matchup for the unowned roster?** `resolveWeek`
   handles both outcomes, but confirm which one actually happens and delete
   the dead branch.
2. **Is the ghost roster the one you expect?** `findGhostRosterId` takes the
   lowest unowned `roster_id`. Once exactly one roster is unowned this is
   unambiguous, but verify it before week 1 rather than after.
