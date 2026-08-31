# Player Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Sleeper-style **Players** tab to the Givash Gals site: two seasons behind a toggle, filterable by availability, showing league-adjusted scoring columns with the worst scorer ranked first.

**Architecture:** A new pure module `leaderboard.js` aggregates a season of weekly stats into one row per player. Two build paths write its output to JSON — `scripts/build-leaderboard.mjs` for the frozen 2025 file, `scripts/snapshot.mjs` for 2026 on every Action run. The browser never runs the engine; `leaderboard-view.js` fetches the JSON lazily when the tab is first opened and renders it. Filtering and sorting are a pure function so they can be tested without a DOM.

**Tech Stack:** Vanilla ES modules, zero runtime dependencies, Node 22 built-in `fetch` and `node:test`. No bundler, no framework. Tests run with `npm test` (`node --test test/*.test.js`).

**Spec:** `docs/superpowers/specs/2026-08-31-player-leaderboard-design.md`

## Global Constraints

- **Zero runtime dependencies.** No package may be added to `package.json`. Node 22 built-ins only.
- **No DOM in tests.** There is no jsdom in this project. Every function a test touches must be importable in plain Node. Follow the existing pattern in `app.js`: guard DOM work behind `if (typeof document !== 'undefined')` and export the pure parts.
- **One definition of the opportunity rule.** `OPPORTUNITY_STATS = ['rec_tgt', 'pass_att', 'rush_att', 'fga', 'xpa']` lives in `rules.js` and nowhere else.
- **`PENALTY = 20`, `EPS = 1e-9`** come from `config.js`. Never inline either value.
- **Low is good.** Every default sort in this feature is ascending. Rank 1 is the worst scorer.
- **Escape everything.** Player and team names come from Sleeper. All interpolated strings pass through `esc`.
- **Two-space indent, single quotes, semicolons, trailing commas in multiline literals.** Match the surrounding files.
- **Commit messages:** end every commit with the two trailer lines used throughout this repo:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011PA6rQeKHPcb1fEkiCQk1k
  ```
- **Do not commit** `last-season.html`, `last-season-saved.json`, `data/raw-2025/`, or `scripts/build-last-season.mjs`. They are listed in `.git/info/exclude` and must stay local.
- **Baseline:** the suite is at **112 passing tests** before Task 1. It must never go down, with one deliberate exception at Task 7 (below).
- **The stated test counts are local counts.** `npm test` globs `test/*.test.js`, which picks up `test/last-season.test.js` — 13 tests that are git-excluded and therefore invisible in CI. Every count in this plan includes them, so CI will report 13 fewer until Task 7 deletes that file and the two numbers converge.

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `config.js` | modify | Add `LEADERBOARD_SEASONS`. |
| `rules.js` | modify | Add `hadOpportunity`; `opportunitySet` delegates to it. |
| `leaderboard.js` | create | Pure season aggregation: `scoreWeek`, `adjustWeek`, `slimWeek`, `opportunityIds`, `slimForLeaderboard`, `buildLeaderboard`. |
| `leaderboard-view.js` | create | The Players tab. Pure `ownershipIndex` / `stepMinGp` / `selectRows` / `renderLeaderboard`, plus the `mountLeaderboard` controller. |
| `render.js` | modify | Export the existing private `esc` so one escaper serves both views. |
| `sleeper.js` | modify | Add the `league` endpoint. |
| `scripts/build-leaderboard.mjs` | create | Season-agnostic CLI that writes `data/leaderboard-{season}.json`. |
| `scripts/snapshot.mjs` | modify | Archive `stats{N}.json`; write `data/leaderboard-2026.json`. |
| `index.html`, `style.css`, `app.js` | modify | Nav entry, styles, lazy mount. |
| `README.md` | modify | Document the tab and its call cost. |
| `test/leaderboard.test.js` | create | Engine tests (13 ported + new). |
| `test/leaderboard-view.test.js` | create | View tests. |
| `test/rules.score.test.js` | modify | `hadOpportunity` tests. |
| `test/sleeper.test.js` | modify | Surface guard now includes `league`. |
| `test/snapshot.test.js` | modify | Archive-format tests. |

---

### Task 1: One definition of the opportunity rule

`rules.js` currently answers "which ids had an opportunity this week" but has no way to ask about a single stat line. `scripts/build-last-season.mjs` has its own private copy of exactly that predicate. Task 2 needs it, so it is lifted into `rules.js` first and the set-builder is rewritten to call it — leaving one implementation of the rule.

**Files:**
- Modify: `rules.js:39-70` (the `OPPORTUNITY_STATS` / `opportunitySet` block)
- Test: `test/rules.score.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `hadOpportunity(stats: Object|undefined) => boolean`, exported from `rules.js`. Returns true when any key in `OPPORTUNITY_STATS` is present and greater than 0.

- [ ] **Step 1: Write the failing tests**

Append to `test/rules.score.test.js`. Note the import line at the top of that file already pulls from `../rules.js` — add `hadOpportunity` to the existing import list rather than adding a second import statement.

```js
test('hadOpportunity recognises each of the five opportunity stats', () => {
  assert.equal(hadOpportunity({ rec_tgt: 1 }), true);
  assert.equal(hadOpportunity({ pass_att: 1 }), true);
  assert.equal(hadOpportunity({ rush_att: 1 }), true);
  assert.equal(hadOpportunity({ fga: 1 }), true);
  assert.equal(hadOpportunity({ xpa: 1 }), true);
});

test('hadOpportunity is false for a player who touched none of them', () => {
  assert.equal(hadOpportunity({ gp: 1, off_snp: 40, tkl: 2 }), false);
  assert.equal(hadOpportunity({}), false);
  assert.equal(hadOpportunity(undefined), false);
  assert.equal(hadOpportunity(null), false);
});

test('hadOpportunity ignores zeroed attempt stats', () => {
  assert.equal(
    hadOpportunity({ rec_tgt: 0, rush_att: 0, pass_att: 0, fga: 0, xpa: 0 }),
    false,
  );
});

test('opportunitySet delegates to hadOpportunity for every id', () => {
  const week = {
    A: { rec_tgt: 3 },
    B: { off_snp: 12 },
    C: { xpa: 1 },
    D: null,
  };
  assert.deepEqual([...opportunitySet(week)].sort(), ['A', 'C']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/rules.score.test.js`
Expected: FAIL — `hadOpportunity is not a function` (or a SyntaxError about a missing export, depending on Node's resolution order). Either failure is the correct RED state.

- [ ] **Step 3: Write the implementation**

In `rules.js`, replace the body of `opportunitySet` and add `hadOpportunity` immediately above it. Keep `OPPORTUNITY_STATS` exactly as it is.

```js
/**
 * Did this stat line represent a chance to score? A target, pass attempt,
 * rush attempt, field-goal attempt, or extra-point attempt all count: the
 * player was sent out to do something, so a 0 is failure rather than absence.
 *
 * @param {Object|undefined} stats - one player's week from Sleeper
 * @returns {boolean}
 */
export function hadOpportunity(stats) {
  if (!stats) return false;
  for (const k of OPPORTUNITY_STATS) {
    if ((stats[k] ?? 0) > 0) return true;
  }
  return false;
}

/**
 * Player ids that recorded at least one opportunity in a week's stats payload.
 * Kept here rather than in the data layer because what counts as an
 * opportunity is a league rule, not a transport detail.
 *
 * @param {Object<string, Object>} weekStats - Sleeper stats/nfl/regular/{yr}/{wk}
 * @returns {Set<string>}
 */
export function opportunitySet(weekStats) {
  const out = new Set();
  for (const [id, s] of Object.entries(weekStats || {})) {
    if (hadOpportunity(s)) out.add(id);
  }
  return out;
}
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, 116 tests. The 112 baseline plus the 4 added here.

- [ ] **Step 5: Commit**

```bash
git add rules.js test/rules.score.test.js
git commit -m "Extract hadOpportunity so the rule has one definition

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011PA6rQeKHPcb1fEkiCQk1k"
```

---

### Task 2: The pure leaderboard engine

`leaderboard.js` turns a season of weekly stats into one row per player. It is the only place the aggregation lives; both build scripts call it.

**Design note on the input shape.** The engine takes **slim** weeks — `{ playerId: { pts, gp, opp } }` — not raw Sleeper stats. Raw stats are converted once by `slimWeek`, which is also what gets archived to disk (Task 3). One input shape means the live path and the replay path cannot drift apart, because there is only one path.

**Files:**
- Create: `leaderboard.js`
- Test: `test/leaderboard.test.js`

**Interfaces:**
- Consumes: `round2`, `hadOpportunity` from `rules.js`; `PENALTY`, `EPS` from `config.js`.
- Produces:
  - `scoreWeek(stats, scoring) => number` — raw fantasy points, rounded to 2dp.
  - `adjustWeek(points, played, isDef, hadOpp) => { adj: number, penalized: boolean }`
  - `slimWeek(weekStats, players, scoring) => { [id]: { pts, gp, opp } }`
  - `slimForLeaderboard(rawPlayers) => { [id]: { pos, team, name } }`
  - `buildLeaderboard(players, weeks, savedLog = null) => Row[]`
  - `LEADERBOARD_POSITIONS: string[]`
  - Row: `{ id, name, team, pos, gp, raw, pen, truePen, saved, total, ppg }`

- [ ] **Step 1: Write the failing tests**

Create `test/leaderboard.test.js`.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adjustWeek,
  buildLeaderboard,
  scoreWeek,
  slimForLeaderboard,
  slimWeek,
} from '../leaderboard.js';

// Minimal scoring config; keys mirror real league keys but values are ours.
const SCORING = { pass_yd: 0.04, pass_td: 4, rec: 1, fgmiss: -1 };

const PLAYERS = {
  A: { pos: 'QB', team: 'CIN', name: 'Quincy Back' },
  B: { pos: 'DEF', team: 'HOU', name: 'Houston Texans' },
  D: { pos: 'WR', team: 'NYJ', name: 'Drops Everything' },
  E: { pos: 'WR', team: 'NYJ', name: 'Targeted Zero' },
};

test('scoreWeek multiplies raw stats by league weights and ignores unknown keys', () => {
  const stats = { gp: 1, pass_yd: 250, pass_td: 2, rec: 3, fgmiss: 1, junk_stat: 99 };
  // 250*0.04 + 2*4 + 3*1 + 1*(-1) = 10 + 8 + 3 - 1 = 20
  assert.equal(scoreWeek(stats, SCORING), 20);
});

test('scoreWeek handles floating point cleanly', () => {
  // 3 * 0.04 = 0.12000000000000001 without rounding
  assert.equal(scoreWeek({ pass_yd: 3 }, SCORING), 0.12);
});

test('a played week scoring exactly 0 with NO opportunity takes the penalty', () => {
  assert.deepEqual(adjustWeek(0, true, false, false), { adj: 20, penalized: true });
});

test('a played week scoring exactly 0 WITH an opportunity is exempt', () => {
  assert.deepEqual(adjustWeek(0, true, false, true), { adj: 0, penalized: false });
});

test('a DEF that played to a 0 is exempt regardless of opportunity', () => {
  assert.deepEqual(adjustWeek(0, true, true, false), { adj: 0, penalized: false });
});

test('a missed week is penalized even if the player somehow logged an attempt', () => {
  assert.deepEqual(adjustWeek(0, false, false, true), { adj: 20, penalized: true });
  assert.deepEqual(adjustWeek(0, false, true, false), { adj: 20, penalized: true });
});

test('negative scores pass through untouched', () => {
  assert.deepEqual(adjustWeek(-1, true, false, false), { adj: -1, penalized: false });
});

test('slimWeek keeps only known ids that actually played', () => {
  const raw = {
    A: { gp: 1, rec: 4 },
    D: { gp: 1, rec_tgt: 2 },
    E: { rec: 9 }, // no gp: did not play
    ZZ: { gp: 1, rec: 4 }, // unknown id
  };
  assert.deepEqual(slimWeek(raw, PLAYERS, SCORING), {
    A: { pts: 4, gp: 1, opp: 0 },
    D: { pts: 0, gp: 1, opp: 1 },
  });
});

test('slimWeek survives a null or missing payload', () => {
  assert.deepEqual(slimWeek(null, PLAYERS, SCORING), {});
  assert.deepEqual(slimWeek(undefined, PLAYERS, SCORING), {});
});

test('a kicker who nets 0 on extra points alone is marked as an opportunity', () => {
  // 1 made (+1) and 1 missed (-1) is exactly 0, but they were sent out to kick
  const raw = { A: { gp: 1, xpa: 2, xpm: 1, xpmiss: 1 } };
  assert.equal(slimWeek(raw, PLAYERS, { xpm: 1, xpmiss: -1 }).A.opp, 1);
  assert.equal(slimWeek(raw, PLAYERS, { xpm: 1, xpmiss: -1 }).A.pts, 0);
});

test('slimForLeaderboard keeps fantasy positions regardless of active flag', () => {
  const raw = {
    A: { position: 'QB', full_name: 'Quincy Back', team: 'CIN', active: true },
    R: { position: 'RB', first_name: 'Retired', last_name: 'Guy', team: null, active: false },
    X: { position: 'OL', full_name: 'Lineman Guy', team: 'CIN', active: true },
  };
  // A retired player still played last season; history must not rot.
  assert.deepEqual(slimForLeaderboard(raw), {
    A: { pos: 'QB', team: 'CIN', name: 'Quincy Back' },
    R: { pos: 'RB', team: '—', name: 'Retired Guy' },
  });
});

test('buildLeaderboard aggregates totals, PPG, and penalties per player', () => {
  const weeks = [
    // week 1: A scores 10; B (DEF) plays to a 0; D plays and scores 0 with no
    // chance; E plays, scores 0, but was targeted.
    {
      A: { pts: 10, gp: 1, opp: 0 },
      B: { pts: 0, gp: 1, opp: 0 },
      D: { pts: 0, gp: 1, opp: 0 },
      E: { pts: 0, gp: 1, opp: 1 },
    },
    // week 2: only B plays.
    { B: { pts: 5, gp: 1, opp: 0 } },
  ];
  const rows = buildLeaderboard(PLAYERS, weeks);

  const pick = (id) => {
    const r = rows.find((x) => x.id === id);
    return { gp: r.gp, raw: r.raw, pen: r.pen, truePen: r.truePen, saved: r.saved, total: r.total, ppg: r.ppg };
  };

  // wk1 10 played; wk2 missed -> +20. total 30, 1 penalty (0 true), ppg 10.
  assert.deepEqual(pick('A'), { gp: 1, raw: 10, pen: 1, truePen: 0, saved: 0, total: 30, ppg: 10 });
  // DEF 0 is exempt; 5 in wk2. total 5, no penalties, ppg 2.5.
  assert.deepEqual(pick('B'), { gp: 2, raw: 5, pen: 0, truePen: 0, saved: 0, total: 5, ppg: 2.5 });
  // wk1 a TRUE +20; wk2 missed -> +20 but not true. total 40, ppg 20.
  assert.deepEqual(pick('D'), { gp: 1, raw: 0, pen: 2, truePen: 1, saved: 0, total: 40, ppg: 20 });
  // targeted and scored 0 -> saved. wk2 missed -> +20.
  assert.deepEqual(pick('E'), { gp: 1, raw: 0, pen: 1, truePen: 0, saved: 1, total: 20, ppg: 0 });

  // ascending by total: lowest (best) first
  assert.deepEqual(rows.map((r) => r.id), ['B', 'E', 'A', 'D']);
});

test('buildLeaderboard drops players with no games and ids it cannot name', () => {
  const weeks = [{ A: { pts: 4, gp: 1, opp: 0 }, ZZ: { pts: 99, gp: 1, opp: 0 } }];
  const rows = buildLeaderboard(PLAYERS, weeks);
  assert.deepEqual(rows.map((r) => r.id), ['A']);
});

test('a free-agent player with no NFL team gets a placeholder, never null', () => {
  // players-slim.json really does carry team: null (e.g. an unsigned kicker),
  // and the view calls team.toLowerCase() when searching.
  const players = { F: { pos: 'K', team: null, name: 'Free Agent Kicker' } };
  const rows = buildLeaderboard(players, [{ F: { pts: 3, gp: 1, opp: 0 } }]);
  assert.equal(rows[0].team, '—');
});

test('buildLeaderboard fills the saved log when one is supplied', () => {
  const weeks = [{}, { E: { pts: 0, gp: 1, opp: 1 } }];
  const log = [];
  buildLeaderboard(PLAYERS, weeks, log);
  assert.deepEqual(log, [
    { week: 2, id: 'E', name: 'Targeted Zero', pos: 'WR', team: 'NYJ' },
  ]);
});

test('an empty season yields no rows rather than throwing', () => {
  assert.deepEqual(buildLeaderboard(PLAYERS, []), []);
});

test('a slim week survives a JSON round trip unchanged', () => {
  const raw = { A: { gp: 1, pass_yd: 3 }, D: { gp: 1, rec_tgt: 1 } };
  const slim = slimWeek(raw, PLAYERS, SCORING);
  const viaDisk = JSON.parse(JSON.stringify(slim));
  assert.deepEqual(buildLeaderboard(PLAYERS, [slim]), buildLeaderboard(PLAYERS, [viaDisk]));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/leaderboard.test.js`
Expected: FAIL — `Cannot find module '../leaderboard.js'`.

- [ ] **Step 3: Write the implementation**

Create `leaderboard.js` at the repo root, beside `rules.js`.

```js
// Pure season aggregation: many weeks of stats in, one row per player out.
//
// Imported by scripts/build-leaderboard.mjs and scripts/snapshot.mjs. The
// browser never runs this — it reads the JSON those scripts emit.
//
// The engine takes SLIM weeks ({ id: { pts, gp, opp } }), not raw Sleeper
// stats. Raw payloads are converted once, by slimWeek, and that same slim
// shape is what gets archived to disk. One input shape means the live path
// and the replay path cannot drift apart.

import { EPS, PENALTY } from './config.js';
import { hadOpportunity, round2 } from './rules.js';

export const LEADERBOARD_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const POS_SET = new Set(LEADERBOARD_POSITIONS);

/**
 * Raw fantasy points for one player-week under the league's scoring map.
 *
 * @param {Object} stats - one player's week from Sleeper
 * @param {Object<string, number>} scoring - league scoring_settings
 * @returns {number}
 */
export function scoreWeek(stats, scoring) {
  let pts = 0;
  for (const [key, weight] of Object.entries(scoring)) {
    const v = stats[key];
    if (typeof v === 'number' && v !== 0 && weight) pts += v * weight;
  }
  return round2(pts);
}

/**
 * League adjustment for one player-week.
 *
 * played + exactly 0 -> +PENALTY, unless EITHER
 *   - a DEF (0 is a legitimate DEF score), or
 *   - the player had an opportunity: they were used and simply failed,
 *     which the format does not punish.
 * missed week (bye, ruled out, scratch) -> 0 + PENALTY, DEF included.
 *
 * @returns {{ adj: number, penalized: boolean }}
 */
export function adjustWeek(points, played, isDef, hadOpp) {
  if (!played) return { adj: PENALTY, penalized: true };
  if (Math.abs(points) < EPS && !isDef && !hadOpp) {
    return { adj: round2(points + PENALTY), penalized: true };
  }
  return { adj: round2(points), penalized: false };
}

/**
 * Reduce one raw weekly stats payload to what the leaderboard needs.
 *
 * Restricted to ids the player map can name, and to lines that actually
 * played. `pts` is the RAW score, before any penalty: keeping adjustment out
 * of the archive means changing PENALTY never invalidates a stored week.
 *
 * @param {Object<string, Object>|null} weekStats
 * @param {Object<string, {pos: string, team: string, name: string}>} players
 * @param {Object<string, number>} scoring
 * @returns {Object<string, {pts: number, gp: number, opp: number}>}
 */
export function slimWeek(weekStats, players, scoring) {
  const out = {};
  for (const [id, s] of Object.entries(weekStats || {})) {
    if (!s || !players[id]) continue;
    if ((s.gp ?? 0) < 1) continue;
    out[id] = { pts: scoreWeek(s, scoring), gp: 1, opp: hadOpportunity(s) ? 1 : 0 };
  }
  return out;
}

/** Ids in a slim week that had a scoring chance, sorted for a stable archive. */
export function opportunityIds(slim) {
  return Object.keys(slim || {})
    .filter((id) => slim[id].opp)
    .sort();
}

/**
 * Slim the 14.6 MB players/nfl payload for leaderboard use.
 *
 * Unlike slimPlayers in scripts/snapshot.mjs this does NOT filter on
 * `active`. A player who retired after the season being built still played
 * that season, and dropping them would make history rot on every rebuild.
 *
 * @param {Object} rawPlayers - Sleeper /v1/players/nfl
 * @returns {Object<string, {pos: string, team: string, name: string}>}
 */
export function slimForLeaderboard(rawPlayers) {
  const out = {};
  for (const [id, p] of Object.entries(rawPlayers || {})) {
    if (!POS_SET.has(p.position)) continue;
    const name =
      p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || id;
    out[id] = { pos: p.position, team: p.team || '—', name };
  }
  return out;
}

/**
 * One row per player with at least one game played.
 *
 * total = "you started them every week": a missed week costs +PENALTY.
 * ppg   = adjusted points across played games only, divided by games played.
 *
 * @param {Object<string, {pos: string, team: string, name: string}>} players
 * @param {Array<Object<string, {pts: number, gp: number, opp: number}>>} weeks
 * @param {Array|null} savedLog - when supplied, one entry per zero-point week
 *   spared by the opportunity rule
 * @returns {Array<Object>} ascending by total — worst scorer first
 */
export function buildLeaderboard(players, weeks, savedLog = null) {
  const rows = [];

  for (const [id, p] of Object.entries(players)) {
    const isDef = p.pos === 'DEF';
    let gp = 0;
    let raw = 0;
    let adjPlayed = 0;
    let pen = 0;
    let truePen = 0; // penalties earned on the field: played and scored 0
    let saved = 0; // zero-point weeks spared by the opportunity rule
    let total = 0;

    for (let w = 0; w < weeks.length; w++) {
      const s = weeks[w][id];
      const played = !!s;
      const pts = played ? s.pts : 0;
      const opp = played && s.opp === 1;
      const { adj, penalized } = adjustWeek(pts, played, isDef, opp);
      total = round2(total + adj);
      if (penalized) pen += 1;
      if (!played) continue;

      gp += 1;
      raw = round2(raw + pts);
      adjPlayed = round2(adjPlayed + adj);
      if (penalized) truePen += 1;
      if (!penalized && !isDef && Math.abs(pts) < EPS && opp) {
        saved += 1;
        if (savedLog) {
          savedLog.push({ week: w + 1, id, name: p.name, pos: p.pos, team: p.team });
        }
      }
    }

    if (gp === 0) continue;

    rows.push({
      id,
      name: p.name,
      // players-slim.json carries team: null for unsigned players. The view
      // calls team.toLowerCase() when searching, so it must never be null.
      team: p.team || '—',
      pos: p.pos,
      gp,
      raw,
      pen,
      truePen,
      saved,
      total,
      ppg: round2(adjPlayed / gp),
    });
  }

  rows.sort((a, b) => a.total - b.total);
  return rows;
}
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, 133 tests.

- [ ] **Step 5: Commit**

```bash
git add leaderboard.js test/leaderboard.test.js
git commit -m "Add the pure leaderboard engine

Takes slim weeks rather than raw Sleeper stats, so the live and replay
paths share one code path instead of two that can drift.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011PA6rQeKHPcb1fEkiCQk1k"
```

---

### Task 3: Build the frozen 2025 file

A committed CLI replaces the local-only `scripts/build-last-season.mjs`. It is season-agnostic so 2025 is not a special case in code, only in lifecycle.

The `data/raw-2025/` cache already exists on disk (23 MB, `wk1.json`…`wk18.json`, `players.json`, `league.json`) and is excluded from git. Reuse those exact filenames so the build costs no network.

**Files:**
- Create: `scripts/build-leaderboard.mjs`
- Modify: `config.js`
- Generated: `data/leaderboard-2025.json` (committed)
- Delete from disk: nothing. `scripts/build-last-season.mjs` stays excluded but is no longer referenced.

**Interfaces:**
- Consumes: `buildLeaderboard`, `slimForLeaderboard`, `slimWeek` from `leaderboard.js`; `writeStamped` from `scripts/snapshot.mjs`; `round2` from `rules.js`; `API_BASE`, `LEAGUE_ID` from `config.js`.
- Produces: `LEADERBOARD_SEASONS = ['2026', '2025']` exported from `config.js`. `data/leaderboard-{season}.json` shaped `{ generatedAt, season, rows }`.

- [ ] **Step 1: Add the season list to `config.js`**

Append to `config.js`:

```js
// Seasons the Players tab offers, newest first. The current season is built
// by the Action; older ones are frozen files built by hand.
export const LEADERBOARD_SEASONS = [SEASON, '2025'];
```

- [ ] **Step 2: Write the build script**

Create `scripts/build-leaderboard.mjs`.

```js
#!/usr/bin/env node
// Builds data/leaderboard-{season}.json: one row per player, scored under
// THIS league's current settings, sorted ascending — worst scorer first.
//
//   node scripts/build-leaderboard.mjs --season 2025
//   node scripts/build-leaderboard.mjs --season 2025 --refresh
//   node scripts/build-leaderboard.mjs --season 2025 --saved-log out.json
//
// The per-week cache under data/raw-{season}/ is ~23 MB and is NOT committed;
// it exists so a rebuild costs no network. --refresh drops it.
//
// The current season is written by scripts/snapshot.mjs on every Action run,
// so this script is only for frozen history.

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { API_BASE, LEAGUE_ID } from '../config.js';
import { round2 } from '../rules.js';
import {
  buildLeaderboard,
  scoreWeek,
  slimForLeaderboard,
  slimWeek,
} from '../leaderboard.js';
import { writeStamped } from './snapshot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEEKS = 18;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

async function cachedFetch(cache, name, url) {
  const file = path.join(cache, name);
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const data = await res.json();
  await writeFile(file, JSON.stringify(data));
  return data;
}

/**
 * Sanity check: our multiplication vs Sleeper's own pts_std for week 1,
 * restricted to QB/RB/WR/TE lines the STD map fully covers (no kicking,
 * defensive, or special-teams stats — Sleeper's std includes keys for those
 * that this deliberately-minimal map omits).
 */
function sanityCheck(week1, players) {
  const STD = {
    pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2,
    rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
    rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
    fum_lost: -2,
  };
  const SKILL = new Set(['QB', 'RB', 'WR', 'TE']);
  let n = 0;
  let close = 0;
  let worst = 0;
  for (const [pid, s] of Object.entries(week1)) {
    if (!s.gp || typeof s.pts_std !== 'number') continue;
    if (!SKILL.has(players[pid]?.pos)) continue;
    if (s.st_ff || s.st_fum_rec || s.st_td || s.fum_rec_td || s.xpm || s.fgm) continue;
    const mine = scoreWeek(s, STD);
    const delta = Math.abs(mine - s.pts_std);
    n += 1;
    if (delta < 0.05) close += 1;
    if (delta > worst) worst = delta;
  }
  console.log(
    `sanity: ${close}/${n} skill players within 0.05 of Sleeper's pts_std ` +
      `(worst delta ${round2(worst)})`,
  );
  if (close < n) {
    throw new Error('sanity check failed: engine disagrees with Sleeper on covered lines');
  }
}

async function main() {
  const season = arg('--season');
  if (!season) throw new Error('usage: build-leaderboard.mjs --season <year>');

  const cache = path.join(ROOT, 'data', `raw-${season}`);
  if (process.argv.includes('--refresh')) await rm(cache, { recursive: true, force: true });
  await mkdir(cache, { recursive: true });

  const league = await cachedFetch(cache, 'league.json', `${API_BASE}/v1/league/${LEAGUE_ID}`);
  const rawPlayers = await cachedFetch(cache, 'players.json', `${API_BASE}/v1/players/nfl`);
  const players = slimForLeaderboard(rawPlayers);

  const weeks = [];
  for (let w = 1; w <= WEEKS; w++) {
    const stats = await cachedFetch(
      cache,
      `wk${w}.json`,
      `${API_BASE}/v1/stats/nfl/regular/${season}/${w}`,
    );
    if (w === 1) sanityCheck(stats, players);
    weeks.push(slimWeek(stats, players, league.scoring_settings));
    process.stdout.write(`\rweek ${w}/${WEEKS}   `);
  }
  console.log();

  const savedLogPath = arg('--saved-log');
  const savedLog = savedLogPath ? [] : null;
  const rows = buildLeaderboard(players, weeks, savedLog);

  const out = path.join(ROOT, 'data', `leaderboard-${season}.json`);
  const { changed } = await writeStamped(out, { season, rows }, new Date().toISOString());
  console.log(`${rows.length} players -> ${out} (${changed ? 'changed' : 'unchanged'})`);

  if (savedLogPath) {
    await writeFile(savedLogPath, JSON.stringify(savedLog, null, 1));
    console.log(`opportunity rule applied ${savedLog.length} times -> ${savedLogPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Build the 2025 file**

Run: `node scripts/build-leaderboard.mjs --season 2025`

Expected output, exactly:
- `sanity: 293/293 skill players within 0.05 of Sleeper's pts_std (worst delta 0)`
- `709 players -> ...data/leaderboard-2025.json (changed)`

**If the player count is not 709, stop and report it rather than committing.** 709 is the verified figure from the spec (WR 254, RB 154, TE 146, QB 81, K 42, DEF 32) and a different number means the engine changed behaviour during the port.

- [ ] **Step 4: Verify the file against the old local board**

Run:

```bash
node -e "
const fs=require('fs');
const h=fs.readFileSync('last-season.html','utf8');
const i=h.indexOf('const DATA =');const j=h.indexOf(';\n',i);
const old=JSON.parse(h.slice(i+12,j));
const now=JSON.parse(fs.readFileSync('data/leaderboard-2025.json','utf8')).rows;
const key=r=>[r.id,r.gp,r.raw,r.pen,r.truePen,r.saved,r.total,r.ppg].join('|');
const a=old.map(key).sort(), b=now.map(key).sort();
console.log('rows', old.length, now.length);
console.log('identical:', JSON.stringify(a)===JSON.stringify(b));
if(JSON.stringify(a)!==JSON.stringify(b)){
  for(let k=0;k<Math.max(a.length,b.length);k++) if(a[k]!==b[k]){console.log('first diff',a[k],'vs',b[k]);break;}
}
"
```

Expected: `rows 709 709` and `identical: true`.

This is the real test of the port. The old local board and the new committed engine must agree on every field of every row. **If it prints `false`, stop and report the first diff** — do not commit a leaderboard that disagrees with the one already verified against Sleeper.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, 133 tests. No new tests here — the verification in Step 4 is a one-time port check against a frozen artifact, not something to re-run forever.

- [ ] **Step 6: Commit**

```bash
git add config.js scripts/build-leaderboard.mjs data/leaderboard-2025.json
git commit -m "Build the frozen 2025 leaderboard

Row-for-row identical to the local board that was validated against
Sleeper's own pts_std (293/293 exact).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011PA6rQeKHPcb1fEkiCQk1k"
```

---

### Task 4: The Action builds the current season

`snapshot.mjs` already fetches every week's full stats on every run and throws away everything but a list of ids. This task keeps the points too, replaces the `opps{N}.json` archive with a richer `stats{N}.json`, and writes `data/leaderboard-2026.json`.

**No migration is needed:** `data/raw/` currently contains only `rosters.json`, `users.json`, and `schedule.json`. There are no week files to convert. Verify with `ls data/raw/` before starting; if `opps*.json` exist, stop and report — the plan's assumption has expired.

**Files:**
- Modify: `sleeper.js`
- Modify: `scripts/snapshot.mjs`
- Test: `test/sleeper.test.js`, `test/snapshot.test.js`
- Generated: `data/raw/league.json`, `data/leaderboard-2026.json`

**Interfaces:**
- Consumes: `buildLeaderboard`, `opportunityIds`, `slimWeek` from `leaderboard.js`.
- Produces: `buildSeasonLeaderboard(players, slimWeeks) => Row[]` exported from `scripts/snapshot.mjs`. `client.league()` on the Sleeper client. `data/raw/stats{N}.json` shaped `{ [id]: { pts, gp, opp } }`. `data/leaderboard-2026.json` shaped `{ generatedAt, season, rows }`.

- [ ] **Step 1: Write the failing tests**

In `test/sleeper.test.js`, update the surface guard (currently at line 118) and add an endpoint test:

```js
test('the client exposes only the endpoints the project uses', () => {
  const c = createClient({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  assert.deepEqual(
    Object.keys(c).sort(),
    ['get', 'league', 'matchups', 'rosters', 'schedule', 'state', 'stats', 'users'],
  );
});

test('league hits the league endpoint', async () => {
  const seen = [];
  const c = createClient({
    fetchImpl: async (url) => {
      seen.push(url);
      return { ok: true, json: async () => ({}) };
    },
    now: () => 0,
  });
  await c.league();
  assert.ok(seen[0].endsWith('/v1/league/1395797781926408192'), seen[0]);
});
```

Append to `test/snapshot.test.js` (add `buildSeasonLeaderboard` to the existing import block from `../scripts/snapshot.mjs`; `writeStamped` is already imported there):

```js
test('buildSeasonLeaderboard orders weeks by number, not by object key order', () => {
  const players = {
    A: { pos: 'QB', team: 'CIN', name: 'Quincy Back' },
    B: { pos: 'WR', team: 'NYJ', name: 'Wide Out' },
  };
  // Deliberately out of order: week 2 declared first.
  const slim = {
    2: { A: { pts: 4, gp: 1, opp: 0 } },
    1: { A: { pts: 6, gp: 1, opp: 0 }, B: { pts: 1, gp: 1, opp: 0 } },
  };
  const rows = buildSeasonLeaderboard(players, slim);
  const a = rows.find((r) => r.id === 'A');
  const b = rows.find((r) => r.id === 'B');
  assert.equal(a.gp, 2);
  assert.equal(a.raw, 10);
  // B missed week 2, so it takes one penalty — which only lands correctly if
  // the season is two weeks long rather than one.
  assert.equal(b.pen, 1);
  assert.equal(b.total, 21);
});

test('buildSeasonLeaderboard returns no rows for a season with no weeks', () => {
  assert.deepEqual(buildSeasonLeaderboard({ A: { pos: 'QB', team: 'CIN', name: 'Q' } }, {}), []);
});

test('an unchanged leaderboard does not restamp, so the Action commits nothing', async () => {
  // The cron runs ~13 times a week. A leaderboard that restamps on every run
  // would defeat the workflow's commit-only-on-change guard by itself.
  const dir = await mkdtemp(path.join(tmpdir(), 'lb-'));
  const file = path.join(dir, 'leaderboard-2026.json');
  const body = { season: '2026', rows: [{ id: 'A', total: 20 }] };

  const first = await writeStamped(file, body, '2026-09-14T00:00:00.000Z');
  const second = await writeStamped(file, body, '2026-09-14T01:00:00.000Z');

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(second.generatedAt, first.generatedAt);
  await rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/sleeper.test.js test/snapshot.test.js`
Expected: FAIL — the surface guard reports a missing `league` key, and `buildSeasonLeaderboard` is not exported.

- [ ] **Step 3: Add the league endpoint**

In `sleeper.js`, add to the returned client object, keeping alphabetical order with its neighbours:

```js
    league: () => get(`/v1/league/${LEAGUE_ID}`),
```

- [ ] **Step 4: Rework the snapshot script**

In `scripts/snapshot.mjs`:

Add to the imports:

```js
import { buildLeaderboard, opportunityIds, slimWeek } from '../leaderboard.js';
```

Add this exported helper next to `buildSnapshot`:

```js
/**
 * Aggregate a season of archived slim weeks into leaderboard rows.
 *
 * Weeks arrive as an object keyed by week number, which has no reliable
 * ordering, so they are sorted into a dense array first. Getting this wrong
 * would silently shorten the season and drop the missed-week penalties that
 * `total` depends on.
 *
 * @param {Object} players - slim player map
 * @param {Object<number, Object>} slimWeeks - keyed by week number
 */
export function buildSeasonLeaderboard(players, slimWeeks) {
  const nums = Object.keys(slimWeeks).map(Number).sort((a, b) => a - b);
  if (!nums.length) return [];
  const dense = [];
  for (let w = 1; w <= nums[nums.length - 1]; w++) dense.push(slimWeeks[w] || {});
  return buildLeaderboard(players, dense);
}
```

Replace `readOpps` with an archive reader:

```js
async function readSlimWeeks() {
  if (!existsSync(RAW)) return {};
  const out = {};
  for (const f of await readdir(RAW)) {
    const m = /^stats(\d+)\.json$/.exec(f);
    if (m) out[Number(m[1])] = JSON.parse(await readFile(path.join(RAW, f), 'utf8'));
  }
  return out;
}
```

In `main()`, declare `let league;` and `let slimWeeks = {};` alongside the other locals, then:

Replay branch — add:

```js
    league = JSON.parse(await readFile(path.join(RAW, 'league.json'), 'utf8'));
    slimWeeks = await readSlimWeeks();
    for (const [w, slim] of Object.entries(slimWeeks)) {
      opportunities[Number(w)] = opportunityIds(slim);
    }
```

and delete the `opportunities = await readOpps();` line.

Live branch — `players` must now be loaded *before* the week loop, because slimming a week needs the player map. Move `players = await refreshPlayers();` to sit immediately after the `state`/`currentWeek` block, and add `league` to the parallel fetch:

```js
    [rosters, users, schedule, league] = await Promise.all([
      client.rosters(),
      client.users(),
      client.schedule(),
      client.league(),
    ]);

    await writeFile(path.join(RAW, 'rosters.json'), JSON.stringify(rosters));
    await writeFile(path.join(RAW, 'users.json'), JSON.stringify(users));
    await writeFile(path.join(RAW, 'schedule.json'), JSON.stringify(schedule));
    await writeFile(path.join(RAW, 'league.json'), JSON.stringify(league));
```

Replace the body of the week loop's stats handling:

```js
      // Archive the slim per-player line rather than the ~570 KB raw payload:
      // points, whether they played, and whether they had a chance. That is
      // everything both the engine and the leaderboard need to replay a week.
      const slim = slimWeek(await client.stats(w), players, league.scoring_settings);
      slimWeeks[w] = slim;
      opportunities[w] = opportunityIds(slim);
      await writeFile(path.join(RAW, `stats${w}.json`), JSON.stringify(slim));
```

In the off-season rescue block, alongside `weekPayloads = await readRaw();` add:

```js
    if (current === 0) slimWeeks = await readSlimWeeks();
```

and derive `opportunities` from it the same way the replay branch does.

Finally, after the existing `writeStamped` calls for standings and weeks, add:

```js
  const rows = buildSeasonLeaderboard(players, slimWeeks);
  const lb = await writeStamped(
    path.join(DATA, `leaderboard-${SEASON}.json`),
    { season: SEASON, rows },
    now,
  );
```

Import `SEASON` from `../config.js` (the file currently imports only `API_BASE`), and extend the closing log line to mention the leaderboard:

```js
  console.log(
    `snapshot: ${snap.weeks.filter((x) => x.played).length} played weeks, ` +
      `ghost roster ${snap.meta.ghostRosterId}, ` +
      `${rows.length} players on the ${SEASON} board, ` +
      (s.changed || w.changed || lb.changed ? 'content changed' : 'content unchanged'),
  );
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, 137 tests.

- [ ] **Step 6: Run the snapshot for real and inspect it**

Run: `npm run snapshot`

It is preseason, so expect `no real weeks to archive`, an unchanged standings file, and `0 players on the 2026 board`. Then confirm the empty file is well-formed:

```bash
node -e "const d=require('./data/leaderboard-2026.json');console.log(d.season, Array.isArray(d.rows), d.rows.length)"
```

Expected: `2026 true 0`.

- [ ] **Step 7: Commit**

```bash
git add sleeper.js scripts/snapshot.mjs test/sleeper.test.js test/snapshot.test.js data/leaderboard-2026.json data/raw/league.json
git commit -m "Build the current-season leaderboard in the snapshot

The weekly stats were already being fetched and discarded. The archive
now keeps points alongside the opportunity flag, replacing opps{N}.json
with stats{N}.json — free to do now because no week files exist yet.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011PA6rQeKHPcb1fEkiCQk1k"
```

---

### Task 5: The view's pure half

Filtering, sorting, the stepper, and ownership are all decidable without a DOM, so they live in exported functions the tests call directly. Only Task 6 touches `document`.

**Files:**
- Create: `leaderboard-view.js`
- Modify: `render.js` (export `esc`)
- Test: `test/leaderboard-view.test.js`

**Interfaces:**
- Consumes: `esc` from `render.js`.
- Produces:
  - `POSITION_TABS: string[]`, `FLEX_POSITIONS: Set<string>`
  - `ownershipIndex(rosters, teams) => { ownerOf: Map<string,string>, labels: Map<string,string>, options: Array<{value,label}>, drafted: boolean }`
  - `stepMinGp(minGp, delta, maxGp) => number`
  - `selectRows(rows, view) => Row[]`
  - `renderLeaderboard(rows, view) => string`
  - `view` object: `{ tab, metric, minGp, q, sortKey, sortDir, owner, ownerOf, labels, emptyMessage }`

- [ ] **Step 1: Write the failing tests**

Create `test/leaderboard-view.test.js`.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ownershipIndex,
  renderLeaderboard,
  selectRows,
  stepMinGp,
} from '../leaderboard-view.js';

const row = (o) => ({
  id: 'x', name: 'X', team: 'NYJ', pos: 'WR',
  gp: 10, raw: 50, pen: 0, truePen: 0, saved: 0, total: 50, ppg: 5, ...o,
});

const ROWS = [
  row({ id: 'a', name: 'Alpha', pos: 'QB', gp: 17, total: 10, ppg: 1 }),
  row({ id: 'b', name: 'Bravo', pos: 'RB', gp: 2, total: 20, ppg: 2 }),
  row({ id: 'c', name: 'Charlie', pos: 'WR', gp: 9, total: 30, ppg: 3 }),
  row({ id: 'd', name: 'Delta', pos: 'DEF', team: 'KC', gp: 17, total: 40, ppg: 4 }),
];

test('the default sort is ascending by the active metric', () => {
  assert.deepEqual(selectRows(ROWS, { metric: 'total' }).map((r) => r.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(selectRows(ROWS, { metric: 'ppg' }).map((r) => r.id), ['a', 'b', 'c', 'd']);
});

test('an explicit sort key overrides the metric and honours direction', () => {
  const asc = selectRows(ROWS, { metric: 'total', sortKey: 'gp', sortDir: 1 });
  assert.deepEqual(asc.map((r) => r.id), ['b', 'c', 'a', 'd']);
  const desc = selectRows(ROWS, { metric: 'total', sortKey: 'gp', sortDir: -1 });
  assert.deepEqual(desc.map((r) => r.id), ['a', 'd', 'c', 'b']);
});

test('rows tied on the sort key stay ordered by ascending total', () => {
  // a and d are both gp 17; a has the lower total and must come first.
  const out = selectRows(ROWS, { sortKey: 'gp', sortDir: 1 });
  assert.deepEqual(out.slice(2).map((r) => r.id), ['a', 'd']);
});

test('string columns sort with localeCompare', () => {
  const out = selectRows(ROWS, { sortKey: 'name', sortDir: -1 });
  assert.deepEqual(out.map((r) => r.id), ['d', 'c', 'b', 'a']);
});

test('position tabs filter, and FLEX means RB, WR or TE', () => {
  assert.deepEqual(selectRows(ROWS, { tab: 'QB' }).map((r) => r.id), ['a']);
  assert.deepEqual(selectRows(ROWS, { tab: 'FLEX' }).map((r) => r.id), ['b', 'c']);
  assert.equal(selectRows(ROWS, { tab: 'All' }).length, 4);
});

test('the minimum-games filter applies to PPG only', () => {
  assert.equal(selectRows(ROWS, { metric: 'ppg', minGp: 10 }).length, 2);
  assert.equal(selectRows(ROWS, { metric: 'total', minGp: 10 }).length, 4);
});

test('search matches name or team, case insensitively', () => {
  assert.deepEqual(selectRows(ROWS, { q: 'rav' }).map((r) => r.id), ['b']);
  assert.deepEqual(selectRows(ROWS, { q: 'kc' }).map((r) => r.id), ['d']);
  assert.equal(selectRows(ROWS, { q: 'zzz' }).length, 0);
});

test('selectRows never mutates the array it is given', () => {
  const before = ROWS.map((r) => r.id);
  selectRows(ROWS, { sortKey: 'total', sortDir: -1 });
  assert.deepEqual(ROWS.map((r) => r.id), before);
});

test('the stepper clamps between 1 and the highest games played', () => {
  assert.equal(stepMinGp(1, -1, 17), 1);
  assert.equal(stepMinGp(1, 1, 17), 2);
  assert.equal(stepMinGp(17, 1, 17), 17);
  assert.equal(stepMinGp(5, -1, 17), 4);
  assert.equal(stepMinGp(1, 1, 0), 1); // empty season: no room to step
});

test('ownershipIndex maps every rostered player to its manager', () => {
  const rosters = [
    { roster_id: 1, owner_id: 'u1', players: ['a', 'b'] },
    { roster_id: 2, owner_id: 'u2', players: ['c'] },
    { roster_id: 6, owner_id: null, players: [] },
  ];
  const idx = ownershipIndex(rosters, { 1: 'Alpha FC', 2: 'Bravo FC' });
  assert.equal(idx.ownerOf.get('a'), '1');
  assert.equal(idx.ownerOf.get('c'), '2');
  assert.equal(idx.ownerOf.get('d'), undefined);
  assert.equal(idx.drafted, true);
  assert.deepEqual(idx.options.map((o) => o.label), [
    'All players', 'Free agents', 'Alpha FC', 'Bravo FC',
  ]);
});

test('ownershipIndex reports an undrafted league', () => {
  const idx = ownershipIndex(
    [{ roster_id: 1, owner_id: 'u1', players: [] }],
    { 1: 'Alpha FC' },
  );
  assert.equal(idx.drafted, false);
  assert.equal(idx.ownerOf.size, 0);
});

test('the owner filter separates free agents from rostered players', () => {
  const ownerOf = new Map([['a', '1'], ['b', '1'], ['c', '2']]);
  assert.deepEqual(selectRows(ROWS, { owner: 'fa', ownerOf }).map((r) => r.id), ['d']);
  assert.deepEqual(selectRows(ROWS, { owner: '1', ownerOf }).map((r) => r.id), ['a', 'b']);
  assert.equal(selectRows(ROWS, { owner: 'all', ownerOf }).length, 4);
});

test('an empty result renders the supplied message, not a table', () => {
  const html = renderLeaderboard([], { emptyMessage: 'No games played yet in 2026.' });
  assert.match(html, /No games played yet in 2026\./);
  assert.doesNotMatch(html, /<table/);
});

test('rank is row position after filtering, always starting at 1', () => {
  const html = renderLeaderboard(selectRows(ROWS, { tab: 'FLEX' }), {});
  const ranks = [...html.matchAll(/<td class="rank">(\d+)<\/td>/g)].map((m) => m[1]);
  assert.deepEqual(ranks, ['1', '2']);
});

test('hostile player and team names render inert', () => {
  const html = renderLeaderboard(
    [row({ name: '<img src=x onerror=alert(1)>', team: '<script>alert(1)</script>' })],
    { labels: new Map() },
  );
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img /);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img /);
});

test('the owner column shows the manager name or FA', () => {
  const view = { ownerOf: new Map([['a', '1']]), labels: new Map([['1', 'Alpha FC']]) };
  const html = renderLeaderboard([ROWS[0], ROWS[3]], view);
  assert.match(html, /Alpha FC/);
  assert.match(html, />FA</);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/leaderboard-view.test.js`
Expected: FAIL — `Cannot find module '../leaderboard-view.js'`.

- [ ] **Step 3: Export the escaper from `render.js`**

`render.js` line 5 declares `esc` privately. Add `export` so there is one escaper rather than two:

```js
export const esc = (s) =>
```

- [ ] **Step 4: Write the pure half of the view**

Create `leaderboard-view.js`. Write only the exports listed below in this step; `mountLeaderboard` arrives in Task 6.

```js
// The Players tab.
//
// Everything that decides WHAT to show is a pure function here, so it can be
// tested without a DOM. mountLeaderboard (below) is the only part that
// touches document, and it holds no logic worth testing.

import { esc } from './render.js';

export const POSITION_TABS = ['All', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
export const FLEX_POSITIONS = new Set(['RB', 'WR', 'TE']);

/** [key, label, numeric, sortable] */
const COLUMNS = [
  ['rank', '#', false, false],
  ['name', 'Player', false, true],
  ['team', 'Team', false, true],
  ['pos', 'Pos', false, true],
  ['owner', 'Owner', false, false],
  ['gp', 'GP', true, true],
  ['raw', 'Raw', true, true],
  ['pen', '+20s', true, true],
  ['truePen', 'True +20s', true, true],
  ['saved', 'Saved', true, true],
  ['total', 'Adj Total', true, true],
  ['ppg', 'PPG', true, true],
];

/**
 * Who owns whom, and what the ownership dropdown should offer.
 *
 * @param {Array} rosters - Sleeper /league/{id}/rosters
 * @param {Object<string, string>} teams - roster id -> team name
 * @returns {{ownerOf: Map<string,string>, labels: Map<string,string>,
 *            options: Array<{value: string, label: string}>, drafted: boolean}}
 */
export function ownershipIndex(rosters, teams = {}) {
  const ownerOf = new Map();
  const labels = new Map();
  const options = [
    { value: 'all', label: 'All players' },
    { value: 'fa', label: 'Free agents' },
  ];

  for (const r of rosters || []) {
    if (!r.owner_id) continue; // the ghost roster owns nobody
    const value = String(r.roster_id);
    const label = teams[value] || `Roster ${r.roster_id}`;
    labels.set(value, label);
    options.push({ value, label });
    for (const id of r.players || []) ownerOf.set(String(id), value);
  }

  return { ownerOf, labels, options, drafted: ownerOf.size > 0 };
}

/**
 * Move the minimum-games threshold, clamped to a range that always has
 * something in it. The buttons disable at the ends; this is the guard behind
 * them, so a stuck keyboard cannot empty the table.
 */
export function stepMinGp(minGp, delta, maxGp) {
  const top = Math.max(1, maxGp || 1);
  return Math.min(top, Math.max(1, minGp + delta));
}

/**
 * Filter and sort. Pure: the input array is never touched.
 *
 * Sorting has two modes. With no sortKey the table is ordered ascending by
 * the active metric, because in this league low is good and rank 1 is the
 * worst scorer. A clicked header overrides that.
 *
 * Ties fall back to ascending total, worst first. That works because sort is
 * stable and rows arrive pre-sorted by total; the tie test in
 * test/leaderboard-view.test.js exists so that assumption cannot quietly break.
 */
export function selectRows(rows, view = {}) {
  const {
    tab = 'All', metric = 'total', minGp = 1, q = '',
    sortKey = null, sortDir = 1, owner = 'all', ownerOf = null,
  } = view;

  let out = rows.filter((r) =>
    tab === 'All' ? true : tab === 'FLEX' ? FLEX_POSITIONS.has(r.pos) : r.pos === tab,
  );

  if (owner !== 'all') {
    out = out.filter((r) => {
      const o = ownerOf ? ownerOf.get(r.id) : undefined;
      return owner === 'fa' ? o === undefined : o === owner;
    });
  }

  if (metric === 'ppg') out = out.filter((r) => r.gp >= minGp);

  if (q) {
    const s = q.toLowerCase();
    out = out.filter(
      (r) => r.name.toLowerCase().includes(s) || r.team.toLowerCase().includes(s),
    );
  }

  const key = sortKey || metric;
  const dir = sortKey ? sortDir : 1;
  return out.sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    if (typeof va === 'string') return va.localeCompare(vb) * dir;
    return (va - vb) * dir;
  });
}

const money = (n) => n.toFixed(2);

export function renderLeaderboard(rows, view = {}) {
  if (!rows.length) {
    return `<p class="empty">${esc(view.emptyMessage || 'No players match these filters.')}</p>`;
  }

  const { sortKey = null, sortDir = 1, metric = 'total', ownerOf = null, labels = new Map() } = view;

  const head = COLUMNS.map(([k, label, num, sortable]) => {
    const arrow = sortKey === k ? ` <span class="dir">${sortDir === 1 ? '↑' : '↓'}</span>` : '';
    const cls = [num ? 'num' : '', sortable ? 'sortable' : ''].filter(Boolean).join(' ');
    return `<th class="${cls}" data-k="${k}">${label}${arrow}</th>`;
  }).join('');

  const body = rows
    .map((r, i) => {
      const value = ownerOf ? ownerOf.get(r.id) : undefined;
      const owner = value === undefined ? 'FA' : labels.get(value) || value;
      const cnt = (n) => (n ? `<b>${n}</b>` : '0');
      return `<tr>
        <td class="rank">${i + 1}</td>
        <td class="name">${esc(r.name)}</td>
        <td class="team">${esc(r.team)}</td>
        <td class="pos">${esc(r.pos)}</td>
        <td class="owner${value === undefined ? ' fa' : ''}">${esc(owner)}</td>
        <td class="num">${r.gp}</td>
        <td class="num">${money(r.raw)}</td>
        <td class="num pen">${cnt(r.pen)}</td>
        <td class="num pen">${cnt(r.truePen)}</td>
        <td class="num saved">${cnt(r.saved)}</td>
        <td class="num${metric === 'total' ? ' metric' : ''}">${money(r.total)}</td>
        <td class="num${metric === 'ppg' ? ' metric' : ''}">${money(r.ppg)}</td>
      </tr>`;
    })
    .join('');

  return `<table class="leaderboard">
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, 153 tests.

- [ ] **Step 6: Commit**

```bash
git add render.js leaderboard-view.js test/leaderboard-view.test.js
git commit -m "Add the pure half of the Players view

Filtering, sorting, the games stepper and ownership are all decidable
without a DOM, so they are testable functions rather than event handlers.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011PA6rQeKHPcb1fEkiCQk1k"
```

---

### Task 6: Wire the tab into the page

The controller: fetch on first open, hold the view state, re-render on every control change.

**Files:**
- Modify: `leaderboard-view.js` (append `mountLeaderboard`)
- Modify: `index.html`, `style.css`, `app.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: `POSITION_TABS`, `ownershipIndex`, `renderLeaderboard`, `selectRows`, `stepMinGp` from this module; `createClient` from `sleeper.js`; `LEADERBOARD_SEASONS` from `config.js`.
- Produces: `mountLeaderboard(el, { teams, json, client }) => Promise<void>`.

- [ ] **Step 1: Add the nav entry and section**

In `index.html`, add the button after the Results button and the section after the results section:

```html
        <button data-view="players">Players</button>
```

```html
      <section id="players" class="view" hidden></section>
```

Keep `Rules` last in both lists.

- [ ] **Step 2: Append the controller to `leaderboard-view.js`**

Add these imports to the top of the file:

```js
import { LEADERBOARD_SEASONS } from './config.js';
import { createClient } from './sleeper.js';
```

Append:

```js
async function defaultJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

/**
 * Mount the Players tab into `el`. Called once, the first time the tab is
 * opened, so a visitor who never looks at it pays nothing.
 *
 * Rosters come from Sleeper live rather than from the committed snapshot: the
 * cron only runs Sunday evening through Tuesday, and the free-agent list is
 * most useful precisely on the days the snapshot would be stale.
 */
export async function mountLeaderboard(el, { teams = {}, json = defaultJson, client } = {}) {
  const api = client || createClient();
  const seasons = LEADERBOARD_SEASONS;
  const cache = {};

  let rosters = [];
  let rosterSource = 'live';
  try {
    rosters = await api.rosters();
  } catch {
    try {
      rosters = await json('data/raw/rosters.json');
      rosterSource = 'snapshot';
    } catch {
      rosterSource = 'none';
    }
  }
  const idx = ownershipIndex(rosters, teams);

  const view = {
    season: seasons[0],
    tab: 'All',
    metric: 'total',
    minGp: 1,
    q: '',
    sortKey: null,
    sortDir: 1,
    owner: 'all',
    ownerOf: idx.ownerOf,
    labels: idx.labels,
  };

  async function rowsFor(season) {
    if (cache[season] === undefined) {
      try {
        cache[season] = (await json(`data/leaderboard-${season}.json`)).rows || [];
      } catch {
        cache[season] = null; // load failed; distinct from "loaded, empty"
      }
    }
    return cache[season];
  }

  function notes(rows) {
    const out = [];
    if (rosterSource === 'snapshot') {
      out.push('Rosters could not be fetched live; showing the last snapshot.');
    }
    if (rosterSource === 'none') {
      out.push('Rosters unavailable, so ownership is unknown.');
    }
    if (rosterSource !== 'none' && !idx.drafted) {
      out.push('The draft has not happened yet, so every player is a free agent.');
    }
    if (rows && rows.length) {
      out.push('Low is good — rank 1 is the worst scorer. Ties break by adjusted total.');
    }
    return out.length ? `<p class="note">${out.map(esc).join(' ')}</p>` : '';
  }

  function controls(rows, maxGp) {
    const on = (c) => (c ? ' class="on"' : '');
    const tabs = POSITION_TABS.map(
      (t) => `<button data-tab="${t}"${on(t === view.tab)}>${t}</button>`,
    ).join('');
    const seasonBtns = seasons
      .map((s) => `<button data-season="${s}"${on(s === view.season)}>${s}</button>`)
      .join('');
    const owners = idx.options
      .map(
        (o) =>
          `<option value="${esc(o.value)}"${o.value === view.owner ? ' selected' : ''}>` +
          `${esc(o.label)}</option>`,
      )
      .join('');
    const stepper =
      view.metric === 'ppg'
        ? `<span class="stepper">
             <button data-step="-1"${view.minGp <= 1 ? ' disabled' : ''}>&minus;</button>
             <span class="readout">${view.minGp}+ games</span>
             <button data-step="1"${view.minGp >= maxGp ? ' disabled' : ''}>+</button>
           </span>`
        : '';

    return `<div class="controls">
      <div class="tabs seasons">${seasonBtns}</div>
      <div class="tabs">${tabs}</div>
      <span class="spacer"></span>
      <select id="lb-owner"${rosterSource === 'none' ? ' disabled' : ''}>${owners}</select>
      <button data-metric="total"${on(view.metric === 'total')}>Total</button>
      <button data-metric="ppg"${on(view.metric === 'ppg')}>PPG</button>
      ${stepper}
      <input id="lb-q" placeholder="Search player / team" value="${esc(view.q)}" />
    </div>
    <div class="count">${rows ? `${rows.length} players` : ''}</div>`;
  }

  async function paint(focusSearch = false) {
    const all = await rowsFor(view.season);
    if (all === null) {
      el.innerHTML = `<p class="empty">Could not load the ${esc(view.season)} leaderboard.</p>`;
      wire();
      return;
    }

    const maxGp = all.reduce((m, r) => Math.max(m, r.gp), 1);
    if (view.minGp > maxGp) view.minGp = maxGp;

    const shown = selectRows(all, view);
    view.emptyMessage = all.length
      ? 'No players match these filters.'
      : `No games played yet in ${view.season}.`;

    el.innerHTML = controls(shown, maxGp) + notes(all) + renderLeaderboard(shown, view);
    wire();
    if (focusSearch) {
      const input = el.querySelector('#lb-q');
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  function wire() {
    for (const b of el.querySelectorAll('[data-season]')) {
      b.onclick = () => {
        view.season = b.dataset.season;
        view.sortKey = null;
        paint();
      };
    }
    for (const b of el.querySelectorAll('[data-tab]')) {
      b.onclick = () => {
        view.tab = b.dataset.tab;
        paint();
      };
    }
    for (const b of el.querySelectorAll('[data-metric]')) {
      b.onclick = () => {
        view.metric = b.dataset.metric;
        paint();
      };
    }
    for (const b of el.querySelectorAll('[data-step]')) {
      b.onclick = async () => {
        const all = (await rowsFor(view.season)) || [];
        const maxGp = all.reduce((m, r) => Math.max(m, r.gp), 1);
        view.minGp = stepMinGp(view.minGp, Number(b.dataset.step), maxGp);
        paint();
      };
    }
    const owner = el.querySelector('#lb-owner');
    if (owner) {
      owner.onchange = () => {
        view.owner = owner.value;
        paint();
      };
    }
    const q = el.querySelector('#lb-q');
    if (q) {
      q.oninput = () => {
        view.q = q.value;
        paint(true);
      };
    }
    for (const th of el.querySelectorAll('th.sortable')) {
      th.onclick = () => {
        const k = th.dataset.k;
        // Three states: ascending, descending, back to the metric sort.
        if (view.sortKey === k) {
          if (view.sortDir === -1) {
            view.sortKey = null;
            view.sortDir = 1;
          } else {
            view.sortDir = -1;
          }
        } else {
          view.sortKey = k;
          view.sortDir = 1;
        }
        paint();
      };
    }
  }

  await paint();
}
```

- [ ] **Step 3: Mount it lazily from `app.js`**

Add the import:

```js
import { mountLeaderboard } from './leaderboard-view.js';
```

Replace `wireNav` with:

```js
function wireNav() {
  let playersMounted = false;
  for (const btn of document.querySelectorAll('nav button')) {
    btn.addEventListener('click', () => {
      for (const b of document.querySelectorAll('nav button')) b.classList.remove('active');
      btn.classList.add('active');
      for (const v of document.querySelectorAll('.view')) v.hidden = true;
      $(btn.dataset.view).hidden = false;

      // The leaderboard costs a roster call and two JSON fetches, so it is
      // built the first time it is asked for and never again.
      if (btn.dataset.view === 'players' && !playersMounted) {
        playersMounted = true;
        mountLeaderboard($('players'), { teams: state.teams }).catch((e) => {
          console.error(e);
          $('players').innerHTML = '<p class="empty">Could not load the leaderboard.</p>';
        });
      }
    });
  }
}
```

- [ ] **Step 4: Add the styles**

Append to `style.css`:

```css
/* --- Players tab --------------------------------------------------- */

.controls {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  align-items: center;
  margin: 0 0 0.8rem;
}

.controls .tabs { display: flex; gap: 0.35rem; flex-wrap: wrap; }
.controls .spacer { flex: 1; }

.controls button,
.controls select,
.controls input {
  font: inherit;
  font-size: 0.85rem;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 0.3rem 0.75rem;
  cursor: pointer;
}

.controls button.on { color: var(--text); border-color: var(--accent); }
.controls button:disabled { opacity: 0.35; cursor: default; }
.controls select { border-radius: 8px; }
.controls input { cursor: text; border-radius: 8px; min-width: 11rem; }
.controls .seasons button { font-variant-numeric: tabular-nums; }

.stepper { display: inline-flex; align-items: center; gap: 0.3rem; }
.stepper .readout {
  font-size: 0.85rem;
  color: var(--muted);
  min-width: 5.5rem;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.count { color: var(--muted); font-size: 0.8rem; margin-bottom: 0.6rem; }
.note { color: var(--muted); font-size: 0.8rem; margin: 0 0 0.8rem; }

table.leaderboard { width: 100%; border-collapse: collapse; font-size: 0.9rem; }

table.leaderboard th {
  position: sticky;
  top: 0;
  background: var(--bg);
  text-align: left;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  padding: 0.5rem 0.4rem;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}

table.leaderboard th.sortable { cursor: pointer; }
table.leaderboard th.num, table.leaderboard td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
table.leaderboard td { padding: 0.45rem 0.4rem; border-bottom: 1px solid var(--line); }
table.leaderboard td.rank { color: var(--muted); width: 3rem; }
table.leaderboard td.name { font-weight: 600; }
table.leaderboard td.team, table.leaderboard td.pos, table.leaderboard td.owner {
  color: var(--muted);
}
table.leaderboard td.owner.fa { color: var(--accent); }
table.leaderboard td.pen b { color: var(--pen); font-weight: 600; }
table.leaderboard td.saved b { color: var(--win); font-weight: 600; }
table.leaderboard td.metric { color: var(--accent); }
table.leaderboard th .dir { opacity: 0.7; }

@media (max-width: 46rem) {
  table.leaderboard td.team, table.leaderboard th:nth-child(3) { display: none; }
}
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, 153 tests. No new tests: this task is DOM wiring, which this project does not test.

- [ ] **Step 6: Check it in a real browser**

Serve the site and drive it headlessly:

```bash
node --run-if-present serve 2>/dev/null || npx --yes http-server -p 8125 -s &
```

If `npx` is unavailable offline, use `python -m http.server 8125` from the repo root instead. Then open `http://localhost:8125/` in a browser and confirm, by hand:

1. The **Players** tab appears in the nav and the other three tabs still work.
2. Clicking Players loads a table; the season toggle shows `2026 | 2025` with 2026 active.
3. 2026 reads "No games played yet in 2026."
4. Switching to 2025 shows 709 players, rank 1 being the worst scorer.
5. Position tabs, the search box, and the ownership dropdown all filter.
6. Clicking `PPG` reveals the stepper at `1+ games` with `−` disabled; `+` steps to `2+`.
7. Clicking `GP` sorts ascending, again descending, a third time back to the metric sort.
8. The note "The draft has not happened yet, so every player is a free agent." is present.

Report any of these that fail rather than working around them.

- [ ] **Step 7: Update the README**

The README documents the site's structure and its Sleeper call budget. Add `leaderboard.js`, `leaderboard-view.js`, and `scripts/build-leaderboard.mjs` to the file list, and amend the call-count sentence to note that opening the Players tab costs one further call for rosters, once per page load.

- [ ] **Step 8: Commit**

```bash
git add index.html style.css app.js leaderboard-view.js README.md
git commit -m "Add the Players tab to the site

Mounted lazily on first open, so the standings page still costs three
Sleeper calls and visitors who never open it pay nothing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011PA6rQeKHPcb1fEkiCQk1k"
```

---

### Task 7: Retire the superseded local script

`scripts/build-last-season.mjs` and `test/last-season.test.js` are now dead: the engine lives in `leaderboard.js` and the CLI in `scripts/build-leaderboard.mjs`. Both dead files are in `.git/info/exclude`, so they are invisible to git and will rot silently unless dealt with deliberately.

`last-season.html` and `last-season-saved.json` **stay** — they are generated artifacts the user asked for and still reads.

**Files:**
- Delete: `scripts/build-last-season.mjs`, `test/last-season.test.js`
- Modify: `.git/info/exclude`

- [ ] **Step 1: Confirm nothing imports them**

Run: `grep -rn "build-last-season" --include=*.js --include=*.mjs --include=*.md --include=*.yml . | grep -v node_modules`

Expected: matches only inside `.git/info/exclude`, `last-season.html`, and the spec's prose. If any live source file still imports it, stop and report.

- [ ] **Step 2: Delete the two dead files**

```bash
rm scripts/build-last-season.mjs test/last-season.test.js
```

- [ ] **Step 3: Prune the exclude list**

Edit `.git/info/exclude` to drop the two deleted paths, leaving:

```
last-season.html
data/raw-2025/
last-season-saved.json
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, **140 tests** — 153 minus the 13 in the deleted `test/last-season.test.js`. That coverage moved to `test/leaderboard.test.js` in Task 2, so nothing is lost; the local count simply stops double-counting it. This is also the first run where the local and CI counts agree.

- [ ] **Step 5: Regenerate your saved-opportunity list from the new CLI**

Proves the replacement genuinely covers the old script's last remaining use:

```bash
node scripts/build-leaderboard.mjs --season 2025 --saved-log last-season-saved.json
```

Expected: `opportunity rule applied 360 times -> last-season-saved.json`.

**If the count is not 360, stop and report.** 360 is the verified 2025 figure (WR 210, TE 105, RB 24, QB 14, K 7).

- [ ] **Step 6: Commit**

There is nothing to stage — both deleted files were git-excluded. Confirm the tree is clean and report:

```bash
git status --short
```

Expected: empty output.

---

## Final verification

- [ ] `npm test` — 140 passing, 0 failing, locally and in CI alike.
- [ ] `git status --short` — clean.
- [ ] `node scripts/snapshot.mjs --replay` runs without error and leaves `data/` unchanged (`git status --short` still empty afterwards).
- [ ] `data/leaderboard-2025.json` has 709 rows; `data/leaderboard-2026.json` has 0 until week 1.
- [ ] Push to `main` and confirm the Pages deployment succeeds, then load `https://zgreds1.github.io/givash-gals/`, open **Players**, and re-run the eight browser checks from Task 6 Step 6 against the live site.
