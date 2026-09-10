# Phased Penalties, Three Scores, Results as Home — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a team's score depend on which NFL games have actually finished, show three readings of it per team, freeze the standings until Tuesday 10:00 Israel time, and put Results on the front door with player names behind a click.

**Architecture:** `rules.js` promises "no I/O, no DOM, no clock". Time therefore enters as **data**, through the same seam `opportunities` already uses: a new `states` map of NFL team → `final`/`live`/`upcoming`, threaded through `adjustedScore` and `resolveWeek`. That parameter defaults to `null` meaning *"treat every game as final"*, which reproduces today's numbers exactly and is what keeps `--replay`, the 2025 archive and all 192 existing tests green without edits. A new `season.js` owns week ↔ calendar arithmetic (the Tuesday gate and the existing `displayWeek`). The provisional live leader is derived in the view, so `weeks.json` gains one number per team and no duplicated matchup arrays.

**Tech Stack:** Vanilla ES modules, no build step. Node 22 (`node:test`, `node --test`, global `fetch`). `Intl.DateTimeFormat` for timezone work — no library. Fira Sans / Fira Code, CSS custom properties in `style.css`.

**Spec:** `docs/superpowers/specs/2026-09-10-phased-penalties-and-results-home-design.md`

## Global Constraints

- **Baseline is 192 passing tests.** `npm test` must be green after every task. No existing test may be edited except where a signature genuinely moved (`displayWeek`'s import) or a rendered string changed by design.
- **`states = null` means "every game is final."** Never change this default. It is the compatibility hinge for `--replay`, the 2025 archive, and every existing caller.
- **The `gameStates` catch-all maps to `'live'`, never `'final'`.** An unrecognised status must withhold a penalty, never invent 20 points.
- **`PENALTY` is 20 and `EPS` is 1e-9, both from `config.js`.** Never inline either.
- **All scores go through `round2` before comparison.** Tie detection relies on exact equality.
- **Colour is never the sole carrier of meaning.** Green (winner) always pairs with a check mark plus visually-hidden "Winner"; red always sits beside the literal text `+20`.
- **No emoji as icons.** SVG only (`design-system/givash-gals/MASTER.md`).
- **Touch targets ≥ 44×44px; every clickable thing has a persistent, non-hover affordance and a visible `:focus-visible`.**
- **Score labels are exactly `adjusted`, `in play`, `raw`,** in that order, with captions `finished games`, `+ in progress`, `no +20s`.
- Commit after every task. Never `--no-verify`.

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `rules.js` (modify) | Pure engine. Gains `gameStates`, `allGamesFinal`, `medianLine`; `adjustedScore`/`resolveWeek` gain phases and `inPlay`. | 1, 2, 3 |
| `season.js` (create) | Week ↔ calendar arithmetic. `displayWeek` (moved), `weekGate`, `isWeekFinal`, `finalWeeks`, `gateLabel`. Pure — `now` is always an argument. | 4 |
| `test/helpers.js` (modify) | Shared fixtures. Gains `SCHEDULE_LIVE`. | 1 |
| `index.html` (modify) | Tab order and landing panel. | 5 |
| `app.js` (modify) | Eager Results mount; live schedule fetch; gates standings through `finalWeeks`. | 5, 6 |
| `render.js` (modify) | `renderStandings` gains the "through week N" caption and gate note. | 6 |
| `results-view.js` (modify) | Three-score ladder, provisional leader, card states, key panel, drill-down phase tags. Sheds `displayWeek` and `penaltyList`. | 7, 8 |
| `style.css` (modify) | Card restructure, ladder, key panel, phase tags. | 7, 8 |
| `scripts/snapshot.mjs` (modify) | Passes `gameStates` into `resolveWeek`. | 9 |
| `.github/workflows/snapshot.yml` (modify) | Tue 05:00 UTC cron. | 9 |
| `RULES.md`, `README.md` (modify) | League rule + architecture docs. | 2, 9 |

---

### Task 1: Game state from the schedule

**Files:**
- Modify: `rules.js` (add exports near `byeTeams`, around line 33)
- Modify: `test/helpers.js` (append fixture)
- Test: `test/rules.gamestate.test.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `gameStates(schedule, week) -> Map<string, 'final'|'live'|'upcoming'>`
  - `allGamesFinal(states) -> boolean`

- [ ] **Step 1: Add the fixture**

Append to `test/helpers.js`:

```js
/**
 * The same 4-team weeks as SCHEDULE, with per-game status.
 * Week 3: HOU/CIN done, KC/MIN still playing. Week 5: not started.
 * Week 8: KC/MIN carries an unrecognised status on purpose.
 */
export const SCHEDULE_LIVE = [
  { week: 3, home: 'HOU', away: 'CIN', status: 'complete' },
  { week: 3, home: 'KC', away: 'MIN', status: 'in_game' },
  { week: 5, home: 'HOU', away: 'CIN', status: 'pre_game' },
  { week: 8, home: 'KC', away: 'MIN', status: 'halftime' },
];
```

- [ ] **Step 2: Write the failing tests**

Create `test/rules.gamestate.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameStates, allGamesFinal } from '../rules.js';
import { SCHEDULE_LIVE } from './helpers.js';

test('complete and canceled are both final', () => {
  const s = gameStates([
    { week: 1, home: 'HOU', away: 'CIN', status: 'complete' },
    { week: 1, home: 'DAL', away: 'SEA', status: 'canceled' },
  ], 1);
  assert.equal(s.get('HOU'), 'final');
  assert.equal(s.get('CIN'), 'final');
  assert.equal(s.get('DAL'), 'final', 'a canceled game is never happening: settled');
  assert.equal(s.get('SEA'), 'final');
});

test('pre_game is upcoming, in_game is live', () => {
  const s = gameStates(SCHEDULE_LIVE, 3);
  assert.equal(s.get('HOU'), 'final');
  assert.equal(s.get('KC'), 'live');
  assert.equal(gameStates(SCHEDULE_LIVE, 5).get('HOU'), 'upcoming');
});

test('an unrecognised status falls to live, never final', () => {
  // The only unrecoverable error is inventing 20 points from a string we
  // did not recognise. Withholding a penalty is recoverable.
  const s = gameStates(SCHEDULE_LIVE, 8);
  assert.equal(s.get('KC'), 'live');
  assert.equal(s.get('MIN'), 'live');
});

test('a team on bye gets no entry at all', () => {
  const s = gameStates(SCHEDULE_LIVE, 5);
  assert.equal(s.has('KC'), false, 'KC sits out week 5');
  assert.equal(s.has('MIN'), false);
});

test('other weeks are ignored', () => {
  assert.equal(gameStates(SCHEDULE_LIVE, 3).size, 4);
});

test('allGamesFinal is true only when nothing can still move', () => {
  assert.equal(allGamesFinal(gameStates(SCHEDULE_LIVE, 3)), false, 'KC/MIN still on');
  assert.equal(allGamesFinal(gameStates(SCHEDULE_LIVE, 5)), false, 'not kicked off');
  assert.equal(allGamesFinal(gameStates([
    { week: 1, home: 'HOU', away: 'CIN', status: 'complete' },
    { week: 1, home: 'DAL', away: 'SEA', status: 'canceled' },
  ], 1)), true, 'complete + canceled is finished');
});

test('allGamesFinal is false on an empty or missing map', () => {
  // Not "everything finished" — it is "we have no schedule", and the caller
  // must fall back to the calendar gate rather than declare the week over.
  assert.equal(allGamesFinal(new Map()), false);
  assert.equal(allGamesFinal(null), false);
});
```

- [ ] **Step 3: Run the tests, verify they fail**

Run: `node --test test/rules.gamestate.test.js`
Expected: FAIL — `gameStates is not a function`.

- [ ] **Step 4: Implement**

Add to `rules.js`, immediately after `byeTeams`:

```js
/**
 * Per-NFL-team game state for one week, read off Sleeper's schedule payload.
 *
 * The mapping is deliberately NOT exhaustive. `complete` and `canceled` are
 * settled and `pre_game` has not started; every other value — a `halftime` we
 * have never observed, a future rename — falls through to 'live'. Guessing
 * 'live' withholds a penalty that arrives a few minutes late. Guessing 'final'
 * invents 20 points out of a string we did not recognise, which is the one
 * error this format cannot recover from.
 *
 * A team appearing in no game that week is on bye and gets no entry, which is
 * how the caller tells "on bye" apart from "not kicked off yet".
 *
 * @param {Array<{week:number, home:string, away:string, status:string}>} schedule
 * @param {number} week
 * @returns {Map<string, 'final'|'live'|'upcoming'>}
 */
export function gameStates(schedule, week) {
  const out = new Map();
  for (const g of schedule || []) {
    if (g.week !== week) continue;
    const phase =
      g.status === 'complete' || g.status === 'canceled' ? 'final'
        : g.status === 'pre_game' ? 'upcoming'
          : 'live';
    out.set(g.home, phase);
    out.set(g.away, phase);
  }
  return out;
}

/**
 * True when nothing in this week's schedule can still move a score.
 *
 * An empty or missing map returns false, not true: that means the schedule is
 * unavailable, not that the week is over, and the caller must fall back to the
 * calendar gate rather than declare a week finished on no evidence.
 */
export function allGamesFinal(states) {
  if (!states || states.size === 0) return false;
  for (const phase of states.values()) if (phase !== 'final') return false;
  return true;
}
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, 192 + 7 = 199 tests.

- [ ] **Step 6: Commit**

```bash
git add rules.js test/helpers.js test/rules.gamestate.test.js
git commit -m "Read per-team game state off the NFL schedule"
```

---

### Task 2: Phased penalties in `adjustedScore`

**Files:**
- Modify: `rules.js:94-135` (`adjustedScore`)
- Modify: `RULES.md` (new section after "The +20 penalty")
- Test: `test/rules.phase.test.js` (create)

**Interfaces:**
- Consumes: `gameStates` from Task 1.
- Produces: `adjustedScore(entry, byes, players, opportunities = new Set(), states = null)` returning `{ raw, adjusted, inPlay, penalties: [{ playerId, name, reason, phase }] }` where `phase` is `'final' | 'live' | 'upcoming'`.

- [ ] **Step 1: Write the failing tests**

Create `test/rules.phase.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustedScore, byeTeams, gameStates } from '../rules.js';
import { mkEntry, PLAYERS, SCHEDULE, SCHEDULE_LIVE } from './helpers.js';

const WK3 = byeTeams(SCHEDULE, 3);   // nobody on bye
const WK8 = byeTeams(SCHEDULE, 8);   // HOU and CIN on bye
const LIVE3 = gameStates(SCHEDULE_LIVE, 3); // HOU/CIN final, KC/MIN live

// Burrow CIN (final), Robinson ATL (unknown to this week's schedule -> bye),
// Jefferson MIN (live).
const MIXED = [
  ['6804', 0.0],   // QB Burrow, CIN, game finished
  ['4199', 0.0],   // WR Jefferson, MIN, game in progress
  ['1466', 12.0],  // K Bass, scored
];

test('a zero in a finished game counts in both adjusted and in play', () => {
  const r = adjustedScore(mkEntry(1, 1, [['6804', 0]]), WK3, PLAYERS, new Set(), LIVE3);
  assert.equal(r.raw, 0);
  assert.equal(r.adjusted, 20);
  assert.equal(r.inPlay, 20);
  assert.equal(r.penalties[0].phase, 'final');
});

test('a zero in a game still being played counts in play only', () => {
  const r = adjustedScore(mkEntry(1, 1, [['4199', 0]]), WK3, PLAYERS, new Set(), LIVE3);
  assert.equal(r.adjusted, 0, 'not settled: the +20 has not landed');
  assert.equal(r.inPlay, 20);
  assert.equal(r.penalties[0].phase, 'live');
});

test('a zero in a game that has not kicked off counts in neither', () => {
  const wk5 = gameStates(SCHEDULE_LIVE, 5); // HOU/CIN pre_game
  const r = adjustedScore(mkEntry(1, 1, [['6804', 0]]), WK3, PLAYERS, new Set(), wk5);
  assert.equal(r.adjusted, 0);
  assert.equal(r.inPlay, 0);
  assert.equal(r.penalties[0].phase, 'upcoming');
});

test('the three scores order as raw <= adjusted <= inPlay', () => {
  const r = adjustedScore(mkEntry(1, 1, MIXED), WK3, PLAYERS, new Set(), LIVE3);
  assert.equal(r.raw, 12);
  assert.equal(r.adjusted, 32, 'Burrow only');
  assert.equal(r.inPlay, 52, 'Burrow + Jefferson');
  assert.ok(r.raw <= r.adjusted && r.adjusted <= r.inPlay);
});

test('an empty slot is settled the moment the week starts', () => {
  const wk5 = gameStates(SCHEDULE_LIVE, 5);
  const r = adjustedScore(mkEntry(1, 1, [['0', 0]]), WK3, PLAYERS, new Set(), wk5);
  assert.equal(r.adjusted, 20, 'no game can rescue an empty slot');
  assert.equal(r.penalties[0].phase, 'final');
});

test('a player whose team is on bye is settled, not pending', () => {
  // Robinson is ATL; ATL appears in no game in SCHEDULE_LIVE at all.
  const r = adjustedScore(mkEntry(1, 1, [['8205', 0]]), WK3, PLAYERS, new Set(), LIVE3);
  assert.equal(r.adjusted, 20, 'absence is the thing the rule punishes');
  assert.equal(r.penalties[0].phase, 'final');
});

test('a DEF on bye is still penalised, and settled', () => {
  const r = adjustedScore(mkEntry(1, 1, [['HOU', 0]]), WK8, PLAYERS, new Set(), LIVE3);
  assert.equal(r.adjusted, 20);
  assert.equal(r.penalties[0].reason, 'bye-def');
  assert.equal(r.penalties[0].phase, 'final');
});

test('a DEF not on bye stays exempt whatever its game is doing', () => {
  const r = adjustedScore(mkEntry(1, 1, [['KC', 0]]), WK3, PLAYERS, new Set(), LIVE3);
  assert.equal(r.adjusted, 0);
  assert.equal(r.inPlay, 0);
  assert.deepEqual(r.penalties, []);
});

test('an unknown player id is settled immediately', () => {
  // Absent from the slim map means inactive, which is absence.
  const r = adjustedScore(mkEntry(1, 1, [['999999', 0]]), WK3, PLAYERS, new Set(), LIVE3);
  assert.equal(r.adjusted, 20);
  assert.equal(r.penalties[0].phase, 'final');
});

test('the opportunity exemption still beats every phase', () => {
  const r = adjustedScore(
    mkEntry(1, 1, [['4199', 0]]), WK3, PLAYERS, new Set(['4199']), LIVE3,
  );
  assert.equal(r.inPlay, 0);
  assert.deepEqual(r.penalties, []);
});

test('states = null reproduces the pre-phase numbers exactly', () => {
  const r = adjustedScore(mkEntry(1, 1, MIXED), WK3, PLAYERS);
  assert.equal(r.adjusted, 52, 'every game treated as final');
  assert.equal(r.inPlay, 52);
  assert.ok(r.penalties.every((p) => p.phase === 'final'));
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `node --test test/rules.phase.test.js`
Expected: FAIL — `inPlay` is `undefined`.

- [ ] **Step 3: Implement**

Replace `adjustedScore` in `rules.js`. Extend its JSDoc with the phase rule, then:

```js
export function adjustedScore(
  entry, byes, players, opportunities = new Set(), states = null,
) {
  const starters = entry.starters || [];
  const points = entry.starters_points || [];
  const penalties = [];
  let raw = 0;

  // `states === null` means "no game information", which scores the week as if
  // every game had already finished — exactly the behaviour before phases
  // existed. That default is the compatibility hinge: --replay, the 2025
  // archive and every existing caller keep their answers with no edit.
  //
  // A team present in the week's schedule takes its game's phase. A team ABSENT
  // is on bye, and a bye is settled from kickoff: it is the purest form of the
  // absence this penalty exists to punish, so it must never sit pending
  // forever waiting for a game that is not being played.
  const phaseOf = (team) => (states === null ? 'final' : states.get(team) ?? 'final');

  for (let i = 0; i < starters.length; i++) {
    const id = starters[i];
    const pts = points[i] ?? 0;
    raw += pts;

    if (Math.abs(pts) >= EPS) continue; // scored something, no penalty

    if (!id || id === '0') {
      penalties.push({
        playerId: null, name: 'Empty slot', reason: 'empty-slot', phase: 'final',
      });
      continue;
    }

    const meta = players[id];
    if (meta && meta.pos === 'DEF') {
      if (byes.has(meta.team)) {
        penalties.push({
          playerId: id, name: meta.name, reason: 'bye-def', phase: 'final',
        });
      }
      continue; // DEF not on bye: exempt
    }

    // Given a chance and failed — the format punishes absence, not failure.
    if (opportunities.has(id)) continue;

    penalties.push({
      playerId: id,
      name: meta ? meta.name : `Unknown (${id})`,
      reason: 'zeroed',
      // No metadata means no team to look up. An id absent from the slim map
      // is an inactive player, which is absence, so it settles immediately.
      phase: meta ? phaseOf(meta.team) : 'final',
    });
  }

  const settled = penalties.filter((p) => p.phase === 'final').length;
  const started = penalties.filter((p) => p.phase !== 'upcoming').length;

  return {
    raw: round2(raw),
    adjusted: round2(raw + settled * PENALTY),
    inPlay: round2(raw + started * PENALTY),
    penalties,
  };
}
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS. The 11 new tests pass and **every existing `rules.score.test.js` assertion still holds**, because they call `adjustedScore` without `states`.

- [ ] **Step 5: Document the rule**

In `RULES.md`, immediately after the "Second exception: a DEF that is not on bye is exempt" paragraph, insert:

```markdown
### When the +20 lands

A penalty is only counted once **that player's own NFL game is complete**. A
starter sitting on 0 at half-time has not yet cost anything; he costs 20 when
his game ends still on 0.

Three cases settle immediately, because no game is going to change them:

- an **empty starter slot**, which no result can rescue;
- a player whose **NFL team is on bye**, or whose game was **cancelled** — both
  are absence, which is exactly what this rule punishes;
- a player **not in the league's player map**, who is inactive.

This makes a team's score a moving number during the week, so the site shows
three readings of it:

| Reading | Rule |
|---------|------|
| `adjusted` | +20 for each zeroed starter whose game has **finished**. The official score; the standings use this one. |
| `in play` | `adjusted` plus +20 for each zeroed starter whose game is **in progress**. Where the team lands if everything ended now. |
| `raw` | The points alone, with no +20 of any kind. |

A starter whose game has **not kicked off** counts toward neither `adjusted` nor
`in play`, even while showing 0.

Because penalties are only ever added as games finish, `raw <= adjusted <= in
play` always holds, and once every game is complete `adjusted` and `in play` are
the same number.
```

- [ ] **Step 6: Commit**

```bash
git add rules.js RULES.md test/rules.phase.test.js
git commit -m "Hold each +20 until that player's game is complete"
```

---

### Task 3: `inPlay` through `resolveWeek`, and one `medianLine`

**Files:**
- Modify: `rules.js:161-259` (`resolveWeek`), add `medianLine` export
- Test: `test/rules.week.test.js` (append)

**Interfaces:**
- Consumes: `adjustedScore` with phases (Task 2).
- Produces:
  - `medianLine(values) -> number|null` — average of 2nd and 3rd highest, `null` unless exactly four values.
  - `resolveWeek(week, matchups, excludedRosterIds, byes, players, opportunities = new Set(), states = null)`, with `teams[rosterId]` now `{ raw, adjusted, inPlay, penalties }`.

- [ ] **Step 1: Write the failing tests**

Append to `test/rules.week.test.js`:

```js
import { medianLine, gameStates } from '../rules.js';
import { SCHEDULE_LIVE } from './helpers.js';

test('medianLine averages the 2nd and 3rd highest', () => {
  assert.equal(medianLine([142.6, 118.3, 97.5, 88.1]), 107.9);
});

test('medianLine does not care about input order', () => {
  assert.equal(medianLine([88.1, 142.6, 97.5, 118.3]), 107.9);
});

test('medianLine refuses a pool that is not exactly four', () => {
  assert.equal(medianLine([1, 2, 3]), null);
  assert.equal(medianLine([1, 2, 3, 4, 5]), null);
  assert.equal(medianLine([]), null);
  assert.equal(medianLine(null), null);
});

test('resolveWeek carries inPlay for every real team', () => {
  const wk = resolveWeek(
    3,
    [
      mkEntry(1, 1, [['6804', 0]]),   // CIN, finished -> settles
      mkEntry(2, 1, [['4199', 0]]),   // MIN, live -> pending only
      mkEntry(3, 2, [['1466', 10]]),
      mkEntry(4, 2, [['1466', 20]]),
      mkEntry(5, 3, [['1466', 30]]),
      mkEntry(6, 3, [['1466', 0]]),
    ],
    new Set([6]),
    byeTeams(SCHEDULE, 3),
    PLAYERS,
    new Set(),
    gameStates(SCHEDULE_LIVE, 3),
  );
  assert.equal(wk.teams[1].adjusted, 20);
  assert.equal(wk.teams[1].inPlay, 20);
  assert.equal(wk.teams[2].adjusted, 0, 'game still on');
  assert.equal(wk.teams[2].inPlay, 20);
});

test('resolveWeek still decides winners on adjusted, never inPlay', () => {
  // Roster 2 is ahead on adjusted (0 vs 20) but level on nothing else. The
  // official result must not move just because a game is still running.
  const wk = resolveWeek(
    3,
    [
      mkEntry(1, 1, [['6804', 0]]),
      mkEntry(2, 1, [['4199', 0]]),
      mkEntry(3, 2, [['1466', 10]]),
      mkEntry(4, 2, [['1466', 20]]),
      mkEntry(5, 3, [['1466', 30]]),
      mkEntry(6, 3, [['1466', 0]]),
    ],
    new Set([6]),
    byeTeams(SCHEDULE, 3),
    PLAYERS,
    new Set(),
    gameStates(SCHEDULE_LIVE, 3),
  );
  const h2h = wk.matchups.find((m) => m.type === 'h2h' && m.rosterIds.includes(1));
  assert.equal(h2h.winner, 2, 'lower ADJUSTED wins; 0 beats 20');
});

test('omitting states reproduces the pre-phase week exactly', () => {
  const args = [
    3,
    [
      mkEntry(1, 1, [['6804', 0]]),
      mkEntry(2, 1, [['4199', 0]]),
      mkEntry(3, 2, [['1466', 10]]),
      mkEntry(4, 2, [['1466', 20]]),
      mkEntry(5, 3, [['1466', 30]]),
      mkEntry(6, 3, [['1466', 0]]),
    ],
    new Set([6]),
    byeTeams(SCHEDULE, 3),
    PLAYERS,
  ];
  const wk = resolveWeek(...args);
  assert.equal(wk.teams[1].adjusted, 20);
  assert.equal(wk.teams[2].adjusted, 20, 'every game treated as final');
  assert.equal(wk.teams[2].inPlay, 20);
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `node --test test/rules.week.test.js`
Expected: FAIL — `medianLine is not a function`.

- [ ] **Step 3: Implement**

Add above `resolveWeek` in `rules.js`:

```js
/**
 * The league median line: the average of the 2nd and 3rd highest scores among
 * the four teams playing head-to-head.
 *
 * Extracted rather than invented. The engine computed it inline and the view
 * re-derived the same "indices 1 and 2" rule to mark the pool; the in-play line
 * would have been a third copy. One implementation now serves all three.
 *
 * @param {number[]} values - exactly four adjusted scores, any order
 * @returns {number|null} null unless there are exactly four
 */
export function medianLine(values) {
  const pool = (values || []).slice().sort((a, b) => b - a);
  return pool.length === 4 ? round2((pool[1] + pool[2]) / 2) : null;
}
```

In `resolveWeek`:

1. Signature gains a trailing parameter:
```js
export function resolveWeek(
  week, matchups, excludedRosterIds, byes, players,
  opportunities = new Set(), states = null,
) {
```
2. Pass it down — replace line 174:
```js
    ...adjustedScore(m, byes, players, opportunities, states),
```
3. Carry `inPlay` — replace line 181:
```js
    teams[s.rosterId] = {
      raw: s.raw, adjusted: s.adjusted, inPlay: s.inPlay, penalties: s.penalties,
    };
```
4. Use the shared helper — replace line 229:
```js
  const median = medianLine(medianPool);
```

Leave `medianPool` sorted descending: the view renders it in that order to mark
the two values that were averaged.

Leave every winner and median comparison reading `adjusted`. The official result
must not move because a game is still running; the provisional live picture is
the view's job (Task 7).

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add rules.js test/rules.week.test.js
git commit -m "Carry inPlay through resolveWeek and share one medianLine"
```

---

### Task 4: `season.js` — the Tuesday gate

**Files:**
- Create: `season.js`
- Modify: `results-view.js:10-39` (delete `displayWeek`, import and re-export it)
- Test: `test/season.test.js` (create)

**Interfaces:**
- Consumes: `LAST_WEEK` from `config.js`.
- Produces:
  - `displayWeek(now, seasonStart, lastWeek = LAST_WEEK) -> number` (moved verbatim)
  - `weekGate(week, seasonStart) -> number|null` — `YYYYMMDDHH`
  - `isWeekFinal(week, seasonStart, now) -> boolean`
  - `finalWeeks(weeks, seasonStart, now) -> WeekResult[]`
  - `gateLabel(week, seasonStart) -> string|null` — e.g. `"Tuesday 22 September, 10:00"`

- [ ] **Step 1: Write the failing tests**

Create `test/season.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekGate, isWeekFinal, finalWeeks, gateLabel, displayWeek } from '../season.js';

const START = '2026-09-09'; // a Wednesday

test('every gate lands on the Tuesday that closes its week', () => {
  assert.equal(weekGate(1, START), 2026091510);  // Tue 15 Sep
  assert.equal(weekGate(2, START), 2026092210);  // Tue 22 Sep
  assert.equal(weekGate(7, START), 2026102710);  // Tue 27 Oct
  assert.equal(weekGate(18, START), 2027011210); // Tue 12 Jan
});

test('the gate opens at 10:00 Israel, to the minute', () => {
  // 07:00 UTC is 10:00 in Jerusalem while Israel is on IDT (UTC+3).
  assert.equal(isWeekFinal(1, START, new Date('2026-09-15T06:59:00Z')), false);
  assert.equal(isWeekFinal(1, START, new Date('2026-09-15T07:00:00Z')), true);
});

test('the gate follows Israel across its DST change with no offset arithmetic', () => {
  // Israel leaves DST on 25 Oct 2026, so week 7's identical 10:00 local gate
  // fires an hour later in UTC than week 1's. Nothing in the code knows this.
  assert.equal(isWeekFinal(7, START, new Date('2026-10-27T07:59:00Z')), false);
  assert.equal(isWeekFinal(7, START, new Date('2026-10-27T08:00:00Z')), true);
});

test('a week is not final the day before its gate', () => {
  assert.equal(isWeekFinal(1, START, new Date('2026-09-14T23:00:00Z')), false);
});

test('an unknown season start lets every week count', () => {
  // Blanking the standings on missing metadata is worse than the behaviour
  // this replaced.
  assert.equal(weekGate(1, null), null);
  assert.equal(isWeekFinal(1, null, new Date('2026-09-01T00:00:00Z')), true);
  assert.equal(isWeekFinal(9, 'not-a-date', new Date('2026-09-01T00:00:00Z')), true);
});

test('finalWeeks admits exactly the weeks whose gate has passed', () => {
  const weeks = [{ week: 1 }, { week: 2 }, { week: 3 }];
  const mid = new Date('2026-09-23T12:00:00Z'); // after wk2's gate, before wk3's
  assert.deepEqual(finalWeeks(weeks, START, mid).map((w) => w.week), [1, 2]);
});

test('finalWeeks is empty before the first gate', () => {
  assert.deepEqual(finalWeeks([{ week: 1 }], START, new Date('2026-09-13T12:00:00Z')), []);
});

test('finalWeeks tolerates a missing list', () => {
  assert.deepEqual(finalWeeks(null, START, new Date()), []);
});

test('gateLabel names the day a week joins', () => {
  assert.equal(gateLabel(2, START), 'Tuesday 22 September, 10:00');
  assert.equal(gateLabel(1, null), null);
});

test('displayWeek still works from its new home', () => {
  assert.equal(displayWeek(new Date(2026, 8, 15), START), 1, 'Tue, still week 1');
  assert.equal(displayWeek(new Date(2026, 8, 16), START), 2, 'Wed, week 2 opens');
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `node --test test/season.test.js`
Expected: FAIL — cannot find module `../season.js`.

- [ ] **Step 3: Create `season.js`**

```js
// The season calendar: which week the site shows, and when a week's result is
// settled enough to count in the standings.
//
// Pure, like rules.js — but where rules.js promises "no clock", this module IS
// the clock, kept honest by taking `now` as an argument everywhere. Nothing
// here reads Date.now(), so every boundary is testable to the minute.
//
// displayWeek lived in results-view.js. It moved here because it answers the
// same question from the same anchor as the gate does, and having the season
// calendar in two files invites the two halves to drift apart.

import { LAST_WEEK } from './config.js';

/** The league settles on Israel time: that is where most of the managers are. */
const TZ = 'Asia/Jerusalem';

/** Wall-clock hour, in TZ, at which a week's result joins the standings. */
const GATE_HOUR = 10;

/**
 * Which week the Results tab opens on.
 *
 * Sleeper's own season_start_date is a Wednesday (2026-09-09), so flooring the
 * offset into 7-day blocks lands the rollover on a Wednesday by construction —
 * there is no weekday arithmetic here to get wrong.
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

  // Both ends snapped to local midnight. Parsing the ISO string directly would
  // give UTC midnight and shift the rollover by a day for anyone west of
  // Greenwich; the league is played in two time zones.
  const start = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Rounded, not floored: a daylight-saving boundary between the two dates
  // makes the difference fall short of or overshoot a whole number of days.
  const days = Math.round((today - start) / 86400000);
  return Math.min(lastWeek, Math.max(1, Math.floor(days / 7) + 1));
}

const wallClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', hourCycle: 'h23',
});

const dayLabel = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long',
});

/**
 * `now` as a comparable YYYYMMDDHH integer on the league's clock.
 *
 * This deliberately never computes a UTC offset. Israel leaves DST in late
 * October, mid-season, so offset arithmetic would need a branch that this does
 * not have: formatting into wall-clock parts and comparing THOSE makes the
 * shift the formatter's problem. Week 1's gate fires at 07:00 UTC and week 7's
 * at 08:00 UTC, and no line of code is aware of the difference.
 */
function stamp(now) {
  const p = {};
  for (const part of wallClock.formatToParts(now)) p[part.type] = part.value;
  return Number(`${p.year}${p.month}${p.day}${p.hour}`);
}

/** The Tuesday that closes `week`, as a UTC-midnight Date. */
function gateDay(week, seasonStart) {
  const [y, m, d] = String(seasonStart ?? '').split('-').map(Number);
  if (!y || !m || !d) return null;
  // seasonStart is a Wednesday, so +(7*week - 1) days is always the Tuesday
  // that closes the week. Date.UTC absorbs the month overflow.
  return new Date(Date.UTC(y, m - 1, d + 7 * week - 1));
}

/**
 * When `week` joins the standings, as the same YYYYMMDDHH integer `stamp`
 * produces, or null when the season start is unknown.
 */
export function weekGate(week, seasonStart) {
  const day = gateDay(week, seasonStart);
  if (day === null) return null;
  const mm = String(day.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(day.getUTCDate()).padStart(2, '0');
  const hh = String(GATE_HOUR).padStart(2, '0');
  return Number(`${day.getUTCFullYear()}${mm}${dd}${hh}`);
}

/**
 * Has `week` passed its Tuesday 10:00 gate?
 *
 * An unknown season start returns true. Withholding every week on missing
 * metadata would blank the standings entirely, which is worse than the
 * behaviour this replaced.
 */
export function isWeekFinal(week, seasonStart, now) {
  const gate = weekGate(week, seasonStart);
  if (gate === null) return true;
  return stamp(now) >= gate;
}

/** The weeks the standings are allowed to see. */
export function finalWeeks(weeks, seasonStart, now) {
  return (weeks || []).filter((w) => isWeekFinal(w.week, seasonStart, now));
}

/**
 * Human label for when a week joins, e.g. "Tuesday 22 September, 10:00".
 *
 * Formatted here rather than in render.js so the locale is pinned in one place
 * and the string is testable without a DOM.
 */
export function gateLabel(week, seasonStart) {
  const day = gateDay(week, seasonStart);
  if (day === null) return null;
  return `${dayLabel.format(day)}, ${String(GATE_HOUR).padStart(2, '0')}:00`;
}
```

- [ ] **Step 4: Move `displayWeek` out of `results-view.js`**

Delete the `displayWeek` function and its JSDoc (`results-view.js:10-39`). At the
top of the file, alongside the existing imports:

```js
import { displayWeek } from './season.js';

// Re-exported from its new home in season.js so existing importers — and the
// tests that pin its week boundaries — keep working unchanged.
export { displayWeek };
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS. `test/results-view.test.js`'s ten existing `displayWeek`
assertions must still pass **unedited** — they now exercise the re-export.

- [ ] **Step 6: Commit**

```bash
git add season.js results-view.js test/season.test.js
git commit -m "Add season.js: the Tuesday 10:00 Israel standings gate"
```

---

### Task 5: Results becomes the home page

**Files:**
- Modify: `index.html:8-12` (meta), `index.html:33-45` (tabs), `index.html:51-56` (panels)
- Modify: `app.js:149-221` (mount order)
- Test: `test/app.test.js` (append)

**Interfaces:**
- Consumes: `mountResults` (unchanged).
- Produces: `mountResultsTab() -> Promise<void>`, module-scoped in `app.js` and idempotent.

- [ ] **Step 1: Reorder the tabs**

In `index.html`, put Results first and make it the selected tab:

```html
          <button role="tab" id="tab-results" aria-controls="results" aria-selected="true"
                  data-view="results" class="active" type="button">Results</button>
          <button role="tab" id="tab-standings" aria-controls="standings" aria-selected="false"
                  data-view="standings" type="button">Standings</button>
          <button role="tab" id="tab-players" aria-controls="players" aria-selected="false"
                  data-view="players" type="button">Players</button>
          <button role="tab" id="tab-rules" aria-controls="rules" aria-selected="false"
                  data-view="rules" type="button">Rules</button>
```

- [ ] **Step 2: Reorder the panels to match**

DOM order must follow tab order or the reading order contradicts the tab order:

```html
      <section id="results" class="view" role="tabpanel" aria-labelledby="tab-results" tabindex="0"></section>
      <section id="standings" class="view" role="tabpanel" aria-labelledby="tab-standings" tabindex="0" hidden></section>
      <section id="players" class="view" role="tabpanel" aria-labelledby="tab-players" tabindex="0" hidden></section>
      <section id="rules" class="view" role="tabpanel" aria-labelledby="tab-rules" tabindex="0" hidden></section>
```

Update the description meta to lead with results:

```html
      content="Results, standings and player leaderboards for the Givash Gals fantasy league, where the lowest score wins."
```

- [ ] **Step 3: Hoist the Results mount out of `wireNav`**

In `app.js`, add at module scope beside `resultsRepaint`:

```js
// Results is the landing tab, so it is mounted at startup rather than on first
// click. Idempotent, because wireNav still calls it: if the snapshot fetch
// failed, startup skips the mount and the first click is what recovers it.
let resultsMounted = false;
function mountResultsTab() {
  if (resultsMounted) return Promise.resolve();
  resultsMounted = true;
  return mountResults($('results'), state)
    .then(({ repaint }) => { resultsRepaint = repaint; })
    .catch((e) => {
      console.error(e);
      $('results').innerHTML = '<p class="empty">Could not load the results.</p>';
    });
}
```

In `wireNav`, delete the local `let resultsMounted = false;` and replace the
Results branch with:

```js
      if (btn.dataset.view === 'results') mountResultsTab();
```

- [ ] **Step 4: Mount it after the snapshot lands**

Replace the startup chain at the foot of `app.js`:

```js
if (typeof document !== 'undefined') {
  wireNav();
  let snapshotLoaded = true;
  loadSnapshot()
    .catch((e) => {
      snapshotLoaded = false;
      console.error(e);
      $('freshness').hidden = false;
      $('freshness').textContent = 'Could not load the snapshot.';
    })
    .then(() => {
      // After loadSnapshot, never before: mounting first would paint "not
      // published by Sleeper yet" against an empty state.weeks and then repaint
      // — a visible flash on the page's own front door.
      if (snapshotLoaded) return mountResultsTab();
    })
    .then(() => {
      if (snapshotLoaded) return refreshLive();
    })
    .catch((e) => console.warn('live refresh failed, snapshot still shown', e));
}
```

- [ ] **Step 5: Write the regression test**

Append to `test/app.test.js`:

```js
import { readFileSync } from 'node:fs';

test('Results is the landing tab and the first panel', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  const tabs = [...html.matchAll(/data-view="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(tabs, ['results', 'standings', 'players', 'rules']);

  const panels = [...html.matchAll(/<section id="(\w+)" class="view"/g)].map((m) => m[1]);
  assert.deepEqual(panels, tabs, 'DOM order must match tab order');

  assert.match(html, /id="tab-results"[^>]*aria-selected="true"/);
  assert.match(html, /id="tab-standings"[^>]*aria-selected="false"/);

  // The landing panel is the one that is NOT hidden.
  assert.match(html, /<section id="results" class="view"[^>]*tabindex="0"><\/section>/);
  assert.match(html, /<section id="standings" class="view"[^>]*hidden>/);
});
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add index.html app.js test/app.test.js
git commit -m "Put Results on the front door"
```

---

### Task 6: Live schedule, and the standings gate

**Files:**
- Modify: `app.js:60-80` (`paint`), `app.js:93-147` (`refreshLive`)
- Modify: `render.js:10-47` (`renderStandings`)
- Modify: `style.css` (append `.gate-note`)
- Test: `test/render.test.js` (append)

**Interfaces:**
- Consumes: `gameStates` (Task 1), `resolveWeek` (Task 3), `finalWeeks`/`gateLabel` (Task 4).
- Produces:
  - `renderStandings(rows, teams, meta = {})` where `meta` is `{ through?: number|null, nextWeek?: number|null, nextGate?: string|null }`.
  - `state.schedule` — the live schedule array, read by `mountResults` in Task 7.

- [ ] **Step 1: Write the failing tests**

Append to `test/render.test.js`:

```js
test('the standings caption says which week it is through', () => {
  const html = renderStandings(ROWS, TEAMS, { through: 4 });
  assert.match(html, /through week 4/);
});

test('the caption omits the clause when nothing has settled', () => {
  const html = renderStandings(ROWS, TEAMS, {});
  assert.match(html, /lowest adjusted points wins<\/caption>/);
  assert.doesNotMatch(html, /through week/);
});

test('a pending week names when it joins', () => {
  const html = renderStandings(ROWS, TEAMS, {
    through: 1, nextWeek: 2, nextGate: 'Tuesday 22 September, 10:00',
  });
  assert.match(html, /Week 2 joins Tuesday 22 September, 10:00\./);
});

test('the empty table still names the first gate', () => {
  // Before week 1 settles there are no rows, and "no games played yet" alone
  // reads as broken during a week that has visibly been played.
  const html = renderStandings([], TEAMS, {
    nextWeek: 1, nextGate: 'Tuesday 15 September, 10:00',
  });
  assert.match(html, /Week 1 joins Tuesday 15 September, 10:00\./);
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `node --test test/render.test.js`
Expected: FAIL — no "through week 4" in the output.

- [ ] **Step 3: Implement `renderStandings`**

In `render.js`, replace the signature and the two ends of the function:

```js
/**
 * @param {Array} rows - standings rows, already sorted
 * @param {Object} teams - rosterId -> team name
 * @param {{through?:number|null, nextWeek?:number|null, nextGate?:string|null}} meta
 *   `through` is the last week that has passed its Tuesday gate; `nextWeek` and
 *   `nextGate` describe the one waiting. Both halves are optional: a snapshot
 *   with no seasonStart supplies neither.
 */
export function renderStandings(rows, teams, meta = {}) {
  const { through = null, nextWeek = null, nextGate = null } = meta;

  // Named, not left implicit: a table that has visibly stopped moving mid-week
  // reads as broken unless it says why.
  const note = nextWeek && nextGate
    ? `<p class="gate-note">Week ${nextWeek} joins ${esc(nextGate)}.</p>`
    : '';

  if (!rows.length) {
    return '<p class="empty">No games played yet. Standings appear after week 1.</p>' + note;
  }

  const body = rows.map(/* ...unchanged... */).join('');

  const caption = `Standings &mdash; lowest adjusted points wins${
    through ? `, through week ${through}` : ''
  }`;

  return `<div class="table-wrap"><table class="standings">
    <caption>${caption}</caption>
    <thead>...unchanged...</thead>
    <tbody>${body}</tbody>
  </table></div>${note}`;
}
```

Append to `style.css` after the standings block:

```css
.gate-note {
  font-size: var(--t-2xs);
  color: var(--muted);
  margin: var(--space-md) 0 0;
}
```

- [ ] **Step 4: Gate the standings in `paint`**

In `app.js`, add the imports:

```js
import { byeTeams, resolveWeek, standings, opportunitySet, gameStates } from './rules.js';
import { finalWeeks, gateLabel } from './season.js';
```

Replace the standings branch of `paint()`:

```js
function paint() {
  const owned = Object.keys(state.teams).length;
  if (showTables(owned)) {
    // Only settled weeks reach standings(). Results keeps showing live numbers
    // — separating the two is the whole point of the gate.
    const settled = finalWeeks(state.weeks, state.seasonStart, new Date());
    const through = settled.length ? Math.max(...settled.map((w) => w.week)) : null;
    const nextWeek = through === null ? 1 : through + 1;
    $('standings').innerHTML = renderStandings(standings(settled), state.teams, {
      through,
      nextWeek: nextWeek <= LAST_WEEK ? nextWeek : null,
      nextGate: nextWeek <= LAST_WEEK ? gateLabel(nextWeek, state.seasonStart) : null,
    });
  } else {
    $('standings').innerHTML = '';
  }
  // ...rest unchanged...
}
```

Add `LAST_WEEK` to the `config.js` import in `app.js`.

- [ ] **Step 5: Fetch the schedule live**

In `refreshLive`, replace the schedule fetch inside the first `Promise.all`:

```js
    // The schedule's FIXTURES are immutable for the season, but its `status`
    // field is not — and status is the only live source for whether a player's
    // game has finished, which is what gates every +20. Checked 2026-09-10: the
    // committed snapshot read 272 pre_game while the endpoint read 271 pre_game
    // and 1 complete. Falls back to the committed copy, whose fixtures are
    // still correct for the bye rule even when its statuses are stale.
    client.schedule().catch(() => json('data/raw/schedule.json')),
```

Then, after `const week = currentWeek(st);` and its preseason guard:

```js
  // Kept on state so mountResults can decide whether a card is settled without
  // fetching the schedule a second time.
  state.schedule = schedule;
```

And pass the states into the engine:

```js
  const fresh = resolveWeek(
    week,
    payload,
    excluded,
    byeTeams(schedule, week),
    players,
    opportunitySet(weekStats),
    gameStates(schedule, week),
  );
```

Add `schedule: null` to the initial `state` object literal.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS. Existing `render.test.js` calls pass no `meta`, so they exercise
the defaults.

- [ ] **Step 7: Commit**

```bash
git add app.js render.js style.css test/render.test.js
git commit -m "Fetch game status live and hold the standings until Tuesday"
```

---

### Task 7: The three-score card

**Files:**
- Modify: `results-view.js` — delete `penaltyList` and `teamBlock`; rewrite `playedCard`, `renderWeek`; add `ladder`, `leaderOf`, `inPlayLine`, `scoreKey`, `weekStatus`; extend `mountResults`
- Modify: `style.css:409-530` (card block), append ladder + key panel rules
- Test: `test/results-view.test.js` (append)

**Interfaces:**
- Consumes: `medianLine`, `gameStates`, `allGamesFinal` (Tasks 1, 3); `isWeekFinal` (Task 4).
- Produces:
  - `inPlayLine(resolved) -> number|null`
  - `leaderOf(matchup, resolved, settled) -> number|'line'|null`
  - `renderWeek({ week, resolved, pairs, ghostRosterId, teams, detailAvailable, settled })`

- [ ] **Step 1: Write the failing tests**

Append to `test/results-view.test.js`:

```js
import { leaderOf, inPlayLine } from '../results-view.js';

const LIVE_WEEK = {
  week: 3, played: true, degenerate: false,
  median: 94.8, medianPool: [113.6, 98.4, 91.2, 84.8],
  teams: {
    1: { raw: 78.4, adjusted: 98.4, inPlay: 118.4, penalties: [] },
    2: { raw: 93.6, adjusted: 113.6, inPlay: 133.6, penalties: [] },
    3: { raw: 71.2, adjusted: 91.2, inPlay: 131.2, penalties: [] },
    4: { raw: 84.8, adjusted: 84.8, inPlay: 104.8, penalties: [] },
    5: { raw: 74.3, adjusted: 94.3, inPlay: 114.3, penalties: [] },
  },
  matchups: [
    { type: 'h2h', rosterIds: [1, 2], winner: 1 },
    { type: 'h2h', rosterIds: [3, 4], winner: 4 },
    // Internally consistent on purpose: adjusted 94.3 is below the adjusted
    // line of 94.8, so the engine's own result for this matchup is a win.
    { type: 'median', rosterId: 5, line: 94.8, result: 'W' },
  ],
};
const NAMES = { 1: 'LilDaveIII', 2: 'Nsaker', 3: 'aisrael615', 4: 'Balagan', 5: 'Nsanders10' };

test('the in-play line is drawn from the four in-play scores', () => {
  // 133.6, 131.2, 118.4, 104.8 -> (131.2 + 118.4) / 2
  assert.equal(inPlayLine(LIVE_WEEK), 124.8);
  assert.notEqual(inPlayLine(LIVE_WEEK), LIVE_WEEK.median,
    'the in-play line is its own number, not the adjusted one');
});

test('an open week picks its leader on in play', () => {
  assert.equal(leaderOf(LIVE_WEEK.matchups[0], LIVE_WEEK, false), 1);
  assert.equal(leaderOf(LIVE_WEEK.matchups[1], LIVE_WEEK, false), 4);
});

test('an open median matchup is judged against the in-play line', () => {
  // 114.3 against the in-play line of 124.8, NOT 94.3 against 94.8.
  assert.equal(leaderOf(LIVE_WEEK.matchups[2], LIVE_WEEK, false), 5);
});

test('a settled week defers to the engine result, never recomputes', () => {
  assert.equal(leaderOf(LIVE_WEEK.matchups[0], LIVE_WEEK, true), 1);
  assert.equal(leaderOf(LIVE_WEEK.matchups[2], LIVE_WEEK, true), 5, 'result W');
});

test('a settled median loss marks the line, not the team', () => {
  const lost = { ...LIVE_WEEK.matchups[2], result: 'L' };
  assert.equal(leaderOf(lost, LIVE_WEEK, true), 'line');
  assert.equal(leaderOf({ ...lost, result: 'T' }, LIVE_WEEK, true), null);
});

test('an open week can disagree with the settled result, and should', () => {
  // The whole reason leaderOf takes `settled`: a team can be behind on the
  // official adjusted line while ahead on in play, or the reverse. The live
  // view must not silently show the official answer.
  const behind = {
    ...LIVE_WEEK,
    teams: { ...LIVE_WEEK.teams, 5: { raw: 74.3, adjusted: 94.3, inPlay: 199.9 } },
  };
  assert.equal(leaderOf(LIVE_WEEK.matchups[2], behind, true), 5, 'official: a win');
  assert.equal(leaderOf(LIVE_WEEK.matchups[2], behind, false), 'line', 'live: behind');
});

test('an equal in-play pair leads nobody', () => {
  const tied = { ...LIVE_WEEK, teams: { ...LIVE_WEEK.teams, 2: { inPlay: 118.4 } } };
  assert.equal(leaderOf(LIVE_WEEK.matchups[0], tied, false), null);
});

test('the card prints all three scores in every state', () => {
  for (const settled of [true, false]) {
    const html = renderWeek({
      week: 3, resolved: LIVE_WEEK, teams: NAMES, detailAvailable: true, settled,
    });
    assert.match(html, /adjusted/, `settled=${settled}`);
    assert.match(html, /in play/, `settled=${settled}`);
    assert.match(html, /raw/, `settled=${settled}`);
    assert.match(html, /98\.40/);
    assert.match(html, /118\.40/);
    assert.match(html, /78\.40/);
  }
});

test('emphasis moves between the two states without anything disappearing', () => {
  const open = renderWeek({ week: 3, resolved: LIVE_WEEK, teams: NAMES, settled: false });
  const done = renderWeek({ week: 3, resolved: LIVE_WEEK, teams: NAMES, settled: true });
  assert.match(open, /class="lrow decides"[\s\S]*?in play/);
  assert.match(done, /class="lrow decides"[\s\S]*?adjusted/);
  assert.equal(
    (open.match(/class="lrow/g) || []).length,
    (done.match(/class="lrow/g) || []).length,
    'the same number of rows in both states',
  );
});

test('an open card carries the dashed rule and a hollow mark', () => {
  const html = renderWeek({ week: 3, resolved: LIVE_WEEK, teams: NAMES, settled: false });
  assert.match(html, /class="card live/);
  assert.match(html, /class="lead">leading</);
  assert.doesNotMatch(html, /win-mark/, 'no solid check until it is settled');
});

test('a settled card carries the solid check and its hidden name', () => {
  const html = renderWeek({ week: 3, resolved: LIVE_WEEK, teams: NAMES, settled: true });
  assert.match(html, /class="card settled/);
  assert.match(html, /win-mark/);
  assert.match(html, /<span class="sr-only">Winner<\/span>/);
  assert.doesNotMatch(html, />leading</);
});

test('no player name ever reaches the card', () => {
  const withPenalties = {
    ...LIVE_WEEK,
    teams: {
      ...LIVE_WEEK.teams,
      1: {
        raw: 78.4, adjusted: 98.4, inPlay: 118.4,
        penalties: [{ playerId: '6804', name: 'Joe Burrow', reason: 'zeroed', phase: 'final' }],
      },
    },
  };
  const html = renderWeek({
    week: 3, resolved: withPenalties, teams: NAMES, detailAvailable: true, settled: true,
  });
  assert.doesNotMatch(html, /Joe Burrow/, 'names live behind the click now');
  assert.doesNotMatch(html, /class="penalties"/);
});

test('a clickable card carries a persistent chevron, not a hover-only hint', () => {
  const on = renderWeek({ week: 3, resolved: LIVE_WEEK, teams: NAMES, detailAvailable: true });
  const off = renderWeek({ week: 3, resolved: LIVE_WEEK, teams: NAMES, detailAvailable: false });
  assert.match(on, /class="chev"/);
  assert.doesNotMatch(off, /class="chev"/);
});

test('the week carries exactly one status region', () => {
  const html = renderWeek({ week: 3, resolved: LIVE_WEEK, teams: NAMES, settled: false });
  assert.equal((html.match(/role="status"/g) || []).length, 1);
  assert.match(html, /Week 3 in progress/);
});

test('the key explains all three numbers on the page, not in a tooltip', () => {
  const html = renderWeek({ week: 3, resolved: LIVE_WEEK, teams: NAMES, settled: false });
  assert.match(html, /<details class="score-key" open>/);
  assert.doesNotMatch(html, /title="/, 'no tooltip: hover does nothing on a phone');
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `node --test test/results-view.test.js`
Expected: FAIL — `leaderOf is not a function`.

- [ ] **Step 3: Implement the ladder and the leader**

In `results-view.js`, add the imports:

```js
import { medianLine, gameStates, allGamesFinal } from './rules.js';
import { displayWeek, isWeekFinal } from './season.js';
```

Delete `penaltyList` (`results-view.js:159-169`) and `teamBlock`
(`results-view.js:198-207`) entirely. Add:

```js
/** The three readings, in the order the manager enumerated them. */
const SCORE_ROWS = [
  { key: 'adjusted', label: 'adjusted', cap: 'finished games' },
  { key: 'inPlay', label: 'in play', cap: '+ in progress' },
  { key: 'raw', label: 'raw', cap: 'no +20s' },
];

const cell = (side, key) =>
  side && typeof side[key] === 'number' ? money(side[key]) : '&mdash;';

/**
 * The three-score ladder for one matchup: left value, shared label, right value.
 *
 * Reuses the left | label | right shape of the lineup table below, so each label
 * prints once instead of once per side and both score columns stay tabular.
 *
 * `decides` takes ink and weight — never a larger size. In a league where the
 * LOW score wins, making the deciding number bigger would teach the eye exactly
 * the wrong thing.
 */
function ladder(left, right, decides) {
  return SCORE_ROWS.map(({ key, label, cap }) => {
    const cls = key === decides ? 'lrow decides' : 'lrow';
    return `<div class="${cls}">
      <span class="n l">${cell(left, key)}</span>
      <span class="lbl">${label}<span class="cap">${esc(cap)}</span></span>
      <span class="n r">${cell(right, key)}</span>
    </div>`;
  }).join('');
}

/**
 * The median line recomputed from the four head-to-head teams' in-play scores.
 *
 * Derived here rather than stored on the week: weeks.json would otherwise carry
 * a second line, a second pool and a second matchup array for every week, and
 * writeStamped's change detection would churn a commit every run.
 */
export function inPlayLine(resolved) {
  const ids = (resolved?.matchups || [])
    .filter((m) => m.type === 'h2h')
    .flatMap((m) => m.rosterIds);
  const pool = ids
    .map((id) => resolved?.teams?.[id]?.inPlay)
    .filter((v) => typeof v === 'number');
  return medianLine(pool);
}

/**
 * Who is ahead, and on which reading.
 *
 * A settled week defers to the engine's official result and never recomputes
 * it. An open week is judged on `inPlay` — the "if it ended now" number, which
 * is the honest live answer. Once every game is final the two agree by
 * construction, so the hollow mark never jumps sides as it turns solid.
 *
 * @returns {number|'line'|null} a rosterId, the literal 'line' when the median
 *   beats its opponent, or null for a tie.
 */
export function leaderOf(matchup, resolved, settled) {
  if (matchup.type === 'h2h') {
    const [a, b] = matchup.rosterIds;
    if (settled) return matchup.winner;
    const ia = resolved?.teams?.[a]?.inPlay;
    const ib = resolved?.teams?.[b]?.inPlay;
    if (typeof ia !== 'number' || typeof ib !== 'number') return null;
    if (ia < ib) return a;
    if (ib < ia) return b;
    return null;
  }

  if (settled) {
    if (matchup.result === 'W') return matchup.rosterId;
    if (matchup.result === 'L') return 'line';
    return null;
  }

  const line = inPlayLine(resolved);
  const me = resolved?.teams?.[matchup.rosterId]?.inPlay;
  if (line === null || typeof me !== 'number') return null;
  if (me < line) return matchup.rosterId;
  if (me > line) return 'line';
  return null;
}

/** Hollow while the week can still move; the existing solid check once it cannot. */
const LEAD_MARK = '<span class="lead-ring" aria-hidden="true"></span>';

function sideHead(name, side, isLeader, settled) {
  const cls = `tname ${side}${isLeader ? ' win' : ''}`;
  const mark = isLeader ? (settled ? WIN_MARK : LEAD_MARK) : '';
  const lead = isLeader && !settled ? '<span class="lead">leading</span>' : '';
  const body = side === 'l' ? `${esc(name)} ${mark}` : `${mark} ${esc(name)}`;
  return `<div class="${cls}">${body}${lead}</div>`;
}

/**
 * The one atomic status message for the week.
 *
 * Exactly one, deliberately. Six independently-announcing score elements on a
 * page that repaints during games is unusable with a screen reader; a single
 * aria-atomic sentence says the same thing once.
 */
function weekStatus(week, settled) {
  const msg = settled
    ? `<b>Week ${week} final.</b> Counted in the standings.`
    : `<b>Week ${week} in progress.</b> Leader shown on in play. Standings update Tuesday 10:00.`;
  return `<p class="week-status" role="status" aria-atomic="true">${msg}</p>`;
}

/**
 * What the three numbers mean, on the page rather than in a tooltip.
 *
 * A <details> and not a title attribute or a hover card: this site is read on a
 * phone during games, where hover does not exist. Open by default, collapsible,
 * and keyboard- and screen-reader-native with no JavaScript.
 */
function scoreKey() {
  return `<details class="score-key" open>
    <summary>What these three numbers mean</summary>
    <dl>
      <div><dt>adjusted</dt><dd>+20 for each starter on 0 whose game has
        <strong>finished</strong>. The official score &mdash; this is what the
        standings use.</dd></div>
      <div><dt>in play</dt><dd>Adjusted, plus +20 for each starter on 0 whose game
        is <strong>happening right now</strong>. Where you would land if everything
        ended this second. Starters who have not kicked off count in neither.</dd></div>
      <div><dt>raw</dt><dd>The points alone, with no +20 of any kind.</dd></div>
    </dl>
  </details>`;
}
```

- [ ] **Step 4: Rewrite `playedCard` and `renderWeek`**

Replace `playedCard`:

```js
function playedCard(m, index, wk, teams, detailAvailable, settled) {
  const name = (id) => teams[String(id)] || `Roster ${id}`;
  const hook = detailAvailable ? ` data-matchup="${index}" role="button" tabindex="0"` : '';
  const cls = `card ${settled ? 'settled' : 'live'}${detailAvailable ? ' clickable' : ''}`;
  const decides = settled ? 'adjusted' : 'inPlay';
  const leader = leaderOf(m, wk, settled);
  // Persistent, not a hover state: on a touch device a hover-only affordance is
  // no affordance at all, and this click is now the only route to player detail.
  const chev = detailAvailable ? '<span class="chev" aria-hidden="true">&rsaquo;</span>' : '';

  if (m.type === 'h2h') {
    const [a, b] = m.rosterIds;
    return `<div class="${cls}"${hook}>${chev}
      <div class="card-state"><span class="pip"></span>${settled ? 'final' : 'in progress'}</div>
      <div class="teams">
        ${sideHead(name(a), 'l', leader === a, settled)}
        <div class="vs">${settled && m.winner === null ? 'TIE' : 'vs'}</div>
        ${sideHead(name(b), 'r', leader === b, settled)}
      </div>
      <div class="ladder">${ladder(wk.teams[a], wk.teams[b], decides)}</div>
    </div>`;
  }

  const line = { adjusted: m.line, inPlay: inPlayLine(wk), raw: null };
  return `<div class="${cls}"${hook}>${chev}
    <div class="card-state"><span class="pip"></span>${settled ? 'final' : 'in progress'}</div>
    <div class="teams">
      ${sideHead(name(m.rosterId), 'l', leader === m.rosterId, settled)}
      <div class="vs">${settled && m.result === 'T' ? 'TIE' : 'vs median'}</div>
      ${sideHead('League median', 'r', leader === 'line', settled)}
    </div>
    <div class="ladder">${ladder(wk.teams[m.rosterId], line, decides)}
      <div class="pool-row"><span class="pool">${poolHtml(wk.medianPool)}</span></div>
    </div>
  </div>`;
}
```

In `renderWeek`, add `settled = false` to the destructured parameter and replace
the played branch:

```js
  if (resolved?.played) {
    const cards = resolved.matchups
      .map((m, i) => playedCard(m, i, resolved, teams, detailAvailable, settled))
      .join('');
    const note = detailAvailable
      ? ''
      : '<p class="note">This week was archived before player detail was kept, so there is no player detail to open.</p>';
    return weekStatus(week, settled) + scoreKey() + note + cards;
  }
```

- [ ] **Step 5: Decide `settled` inside `mountResults`**

Add to the module cache block, beside `let pairings = null;`:

```js
  let schedule = null;
```

Add beside `payloadFor`:

```js
  /**
   * The season schedule, preferring the live copy refreshLive stored on state.
   * The committed file is the fallback, and an empty array is the fallback to
   * that — a missing schedule must not stop the tab rendering.
   */
  async function scheduleFor() {
    if (state.schedule) return state.schedule;
    if (schedule) return schedule;
    try {
      schedule = await json('data/raw/schedule.json');
    } catch {
      schedule = [];
    }
    return schedule;
  }
```

In `paint()`, after `const resolved = byWeek.get(week);`:

```js
    // A card is settled when the GAMES are over, not when the standings gate has
    // opened. The card answers "can these numbers still change?"; the gate
    // answers "does this count yet?". They normally coincide — a postponed game
    // is exactly the case where they must not. With no schedule at all, fall
    // back to the gate rather than show a finished week as forever in progress.
    const states = gameStates(await scheduleFor(), week);
    const settled = states.size
      ? allGamesFinal(states)
      : isWeekFinal(week, state.seasonStart ?? null, now());
```

Pass `settled` into the `renderWeek` call in the same function.

- [ ] **Step 6: Rewrite the card CSS**

In `style.css`, replace the `.card` … `.penalties em` block (lines 425-530) with:

```css
/* Hairline-separated slips, not boxes: the rule that divides them is also what
 * carries the week's state, so no extra chrome is spent saying it. */
.card {
  position: relative;
  display: block;
  background: var(--card);
  border: 0;
  border-top: 1px solid var(--rule);
  padding: var(--space-lg) var(--space-3xl) var(--space-lg) var(--space-lg);
  transition: background 200ms ease;
}
.card:last-of-type { border-bottom: 1px solid var(--rule); }

/* Dashed while the week can still move, solid once every game is final. */
.card.live { border-top-style: dashed; }
.card.live:last-of-type { border-bottom-style: dashed; }

.card.clickable { cursor: pointer; }
.card.clickable:hover { background: #fbfdff; }
.card.clickable:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; }

.chev {
  position: absolute;
  right: var(--space-md);
  top: 50%;
  transform: translateY(-50%);
  color: var(--line-strong);
  font-size: var(--t-xl);
  line-height: 1;
}

.card-state {
  font: 400 var(--t-3xs) / 1 var(--font-data);
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-md);
}
.card-state .pip { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); }
.card.live .card-state .pip { background: transparent; border: 1px solid var(--muted); }

.teams,
.lrow {
  display: grid;
  grid-template-columns: 1fr minmax(5.5rem, auto) 1fr;
  align-items: baseline;
  gap: var(--space-sm) var(--space-md);
}
.teams { margin-bottom: var(--space-md); }

.tname { font-weight: 600; font-size: var(--t-sm); min-width: 0; overflow-wrap: anywhere; }
.tname.l { text-align: right; }
.tname.r { text-align: left; }
.tname.win { color: var(--win); }
.tname .lead {
  display: block;
  font: 400 var(--t-3xs) / 1.4 var(--font-data);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--win);
}

/* Hollow ring, so the live state is carried by SHAPE and not only by colour. */
.lead-ring {
  display: inline-block;
  width: 0.62em;
  height: 0.62em;
  border: 1.6px solid var(--win);
  border-radius: 50%;
  vertical-align: 0.02em;
}
.win-mark { flex: none; width: 1em; height: 1em; color: var(--win); }

.lrow { padding: var(--space-sm) 0; }
.lrow + .lrow { border-top: 1px solid var(--line); }
.lrow .n {
  font-family: var(--font-data);
  font-variant-numeric: tabular-nums;
  font-size: var(--t-base);
  color: var(--muted);
}
.lrow .n.l { text-align: right; }
.lrow .n.r { text-align: left; }
.lrow .lbl { font-size: var(--t-2xs); text-align: center; color: var(--muted); white-space: nowrap; }
.lrow .lbl .cap { display: block; font-size: var(--t-3xs); color: var(--muted); }

/* The deciding row takes ink and weight, never a larger size: low wins here, so
 * a bigger number must never read as a better one. */
.lrow.decides { background: #fcfdff; }
.lrow.decides .n { color: var(--ink); font-weight: 600; }
.lrow.decides .lbl { color: var(--ink); font-weight: 600; }

.pool-row { grid-column: 1 / -1; text-align: center; padding-top: var(--space-sm); }

/* The key: on the page, open by default. Not a tooltip — hover does not exist
 * on the phone this is read on during games. */
.score-key {
  border: 1px solid var(--line);
  background: var(--card);
  border-radius: var(--radius);
  margin-bottom: var(--space-lg);
  font-size: var(--t-2xs);
}
.score-key > summary {
  cursor: pointer;
  padding: var(--space-md) var(--space-lg);
  min-height: 44px;
  display: flex;
  align-items: center;
  font-weight: 600;
  color: var(--ink);
}
.score-key > summary:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; }
.score-key dl { margin: 0; padding: 0 var(--space-lg) var(--space-md); display: grid; gap: var(--space-md); }
.score-key dl > div { display: grid; grid-template-columns: 5.5rem 1fr; gap: var(--space-md); }
.score-key dt { font: 600 var(--t-2xs) / 1.5 var(--font-data); color: var(--ink); }
.score-key dd { margin: 0; color: var(--muted); }

.week-status {
  font-size: var(--t-2xs);
  color: var(--muted);
  border-left: 2px solid var(--line-strong);
  padding-left: var(--space-md);
  margin: 0 0 var(--space-lg);
}
.week-status b { color: var(--ink); font-weight: 600; }

@media (max-width: 34rem) {
  .teams, .lrow { grid-template-columns: 1fr minmax(4.6rem, auto) 1fr; }
  .score-key dl > div { grid-template-columns: 1fr; gap: var(--space-xs); }
}
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS. Existing `renderWeek` tests that assert on upcoming weeks and
degenerate weeks are untouched; any that asserted on `.side`/`.adj` markup for
played weeks must be updated to the new class names in this commit.

- [ ] **Step 8: Commit**

```bash
git add results-view.js style.css test/results-view.test.js
git commit -m "Show three scores per team and hide the lineup behind the click"
```

---

### Task 8: Phase tags in the drill-down

**Files:**
- Modify: `results-view.js` — `markPenalties`, `playerCell`, `renderMatchupDetail`
- Modify: `style.css` (append phase-tag rules)
- Test: `test/results-view.test.js` (append)

**Interfaces:**
- Consumes: `penalties[].phase` (Task 2), `ladder` (Task 7).
- Produces: lineup rows carrying `{ ...row, pen: boolean, phase: 'final'|'live'|'upcoming'|null }`.

- [ ] **Step 1: Write the failing tests**

Append to `test/results-view.test.js`:

```js
test('each starter penalty is tagged with the phase that explains it', () => {
  const resolved = {
    teams: {
      1: {
        raw: 0, adjusted: 20, inPlay: 40,
        penalties: [
          { playerId: '6804', name: 'Joe Burrow', reason: 'zeroed', phase: 'final' },
          { playerId: '4199', name: 'Justin Jefferson', reason: 'zeroed', phase: 'live' },
          { playerId: '8205', name: 'Bijan Robinson', reason: 'zeroed', phase: 'upcoming' },
        ],
      },
    },
    matchups: [{ type: 'h2h', rosterIds: [1, 2], winner: 1 }],
    medianPool: [],
  };
  const payload = [{
    roster_id: 1,
    starters: ['6804', '4199', '8205'],
    starters_points: [0, 0, 0],
    players: ['6804', '4199', '8205'],
    players_points: {},
  }];
  const html = renderMatchupDetail({
    week: 3,
    matchup: resolved.matchups[0],
    resolved,
    payload,
    teams: { 1: 'LilDaveIII', 2: 'Nsaker' },
    rosterPositions: ['QB', 'WR', 'RB'],
    players: PLAYERS,
  });
  assert.match(html, /class="pen locked">\+20</);
  assert.match(html, /class="pen pending">\+20</);
  assert.match(html, /class="pen waiting">not started</);
});

test('an empty slot keeps its own phase when several are penalised', () => {
  const resolved = {
    teams: {
      1: {
        raw: 0, adjusted: 40, inPlay: 40,
        penalties: [
          { playerId: null, name: 'Empty slot', reason: 'empty-slot', phase: 'final' },
          { playerId: null, name: 'Empty slot', reason: 'empty-slot', phase: 'final' },
        ],
      },
    },
    matchups: [{ type: 'h2h', rosterIds: [1, 2], winner: 1 }],
    medianPool: [],
  };
  const payload = [{
    roster_id: 1, starters: ['0', '0'], starters_points: [0, 0],
    players: [], players_points: {},
  }];
  const html = renderMatchupDetail({
    week: 3, matchup: resolved.matchups[0], resolved, payload,
    teams: { 1: 'A', 2: 'B' }, rosterPositions: ['QB', 'WR'], players: PLAYERS,
  });
  assert.equal((html.match(/class="pen locked"/g) || []).length, 2,
    'every empty slot earns its own +20, not just the first');
});

test('the detail header carries the same three-score ladder as the card', () => {
  const html = renderMatchupDetail({
    week: 3,
    matchup: LIVE_WEEK.matchups[0],
    resolved: LIVE_WEEK,
    payload: [{ roster_id: 1, starters: [], starters_points: [], players: [], players_points: {} }],
    teams: NAMES, rosterPositions: [], players: PLAYERS,
  });
  assert.match(html, /adjusted/);
  assert.match(html, /in play/);
  assert.match(html, /raw/);
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `node --test test/results-view.test.js`
Expected: FAIL — no `pen locked` in the output.

- [ ] **Step 3: Implement**

Replace `markPenalties`:

```js
/**
 * Tag each lineup row with the penalty phase that explains it.
 *
 * A `zeroed` or `bye-def` penalty names the player's own id, so those match by
 * id. An empty slot has no id to name — rules.js records it as playerId: null,
 * and the row Sleeper produces carries the '0' sentinel — so empties are paired
 * off positionally: the i-th empty starting slot takes the i-th empty-slot
 * penalty. A lineup can hold several, and every one earns its own +20, so this
 * consumes one penalty per empty row rather than marking only the first.
 *
 * Bench rows never carry the '0' sentinel (lineupRows filters it), so the
 * shared counter is only ever consumed by starters, which is the order the
 * penalties were recorded in.
 */
function markPenalties(lineup, penalties = []) {
  const byId = new Map(
    penalties
      .filter((p) => p.playerId !== null && p.playerId !== undefined)
      .map((p) => [String(p.playerId), p.phase || 'final']),
  );
  const empties = penalties
    .filter((p) => p.playerId === null || p.playerId === undefined)
    .map((p) => p.phase || 'final');

  let next = 0;
  const mark = (r) => {
    const phase = r.empty
      ? (next < empties.length ? empties[next++] : null)
      : (byId.get(r.id) ?? null);
    return { ...r, pen: phase !== null, phase };
  };
  return { starters: lineup.starters.map(mark), bench: lineup.bench.map(mark) };
}

/**
 * The three phases, as three visually distinct tags.
 *
 * This is the only view that says WHICH zero belongs to which of the three
 * scores, so the distinction has to survive without colour: solid fill, dashed
 * outline and dotted outline are three shapes, not three hues.
 */
const PHASE_TAG = {
  final: '<span class="pen locked">+20</span>',
  live: '<span class="pen pending">+20</span>' +
        '<span class="sr-only">pending: this game is still being played</span>',
  upcoming: '<span class="pen waiting">not started</span>',
};
```

Replace `playerCell`'s penalty line:

```js
function playerCell(row, align) {
  const pen = row.phase ? PHASE_TAG[row.phase] || '' : '';
  const nameCls = row.empty ? 'lineup-name empty' : 'lineup-name';
  return `<div class="lineup-side ${align}">
    <span class="${nameCls}">${esc(row.name)}</span>
    <span class="lineup-pts">${money(row.points)}</span>
    ${pen}
  </div>`;
}
```

In `renderMatchupDetail`, replace both `header` branches' score markup with the
shared ladder so a click never changes which numbers are on screen:

```js
  const rightSide = isMedian
    ? { adjusted: matchup.line, inPlay: inPlayLine(resolved), raw: null }
    : rightTeam;
  const rightName = isMedian ? 'League median' : name(rightId);
  const settled = matchup.type === 'median'
    ? matchup.result !== undefined
    : matchup.winner !== undefined;
  const decides = 'adjusted';
  const leader = leaderOf(matchup, resolved, true);

  const header = `<div class="detail-head">
    <div class="teams">
      ${sideHead(name(leftId), 'l', leader === leftId, true)}
      <div class="vs">${isMedian ? 'vs median' : 'vs'}</div>
      ${sideHead(rightName, 'r', leader === (isMedian ? 'line' : rightId), true)}
    </div>
    <div class="ladder">${ladder(leftTeam, rightSide, decides)}
      ${isMedian ? `<div class="pool-row"><span class="pool">${poolHtml(resolved?.medianPool)}</span></div>` : ''}
    </div>
  </div>`;
```

Append to `style.css`:

```css
/* Three shapes, not three colours: solid, dashed, dotted. */
.pen {
  font: 500 var(--t-3xs) / 1.4 var(--font-data);
  padding: 0.04em 0.3em;
  border-radius: 3px;
  white-space: nowrap;
  flex: none;
}
.pen.locked { background: var(--pen); color: var(--card); }
.pen.pending { border: 1px dashed var(--pen); color: var(--pen); }
.pen.waiting { border: 1px dotted var(--line-strong); color: var(--muted); }
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add results-view.js style.css test/results-view.test.js
git commit -m "Tag every zero in the drill-down with the phase that explains it"
```

---

### Task 9: Archive, automation and docs

**Files:**
- Modify: `scripts/snapshot.mjs:23` (import), `scripts/snapshot.mjs:70-83` (`buildSnapshot`)
- Modify: `.github/workflows/snapshot.yml:3-7` (cron)
- Modify: `README.md`
- Test: `test/snapshot.test.js` (append)

**Interfaces:**
- Consumes: `gameStates` (Task 1), `resolveWeek` (Task 3).
- Produces: `weeks.json` entries carrying `teams[id].inPlay` and `penalties[].phase`.

- [ ] **Step 1: Write the failing test**

Append to `test/snapshot.test.js`:

First extend the existing import line — `snapshot.test.js` currently pulls only
`mkEntry, SCHEDULE` from the helpers:

```js
import { mkEntry, PLAYERS, SCHEDULE } from './helpers.js';
```

Then append, following the file's own idiom of building rosters and users inline:

```js
// Five owned slots plus the ghost, the shape buildSnapshot's other tests use.
const LEAGUE = {
  rosters: [1, 2, 3, 4, 5].map((i) => ({ roster_id: i, owner_id: `u${i}` }))
    .concat([{ roster_id: 6, owner_id: null }]),
  users: [1, 2, 3, 4, 5].map((i) => ({ user_id: `u${i}`, display_name: `Team ${i}` })),
  players: PLAYERS,
  rosterPositions: [],
};

const WEEK3 = [
  mkEntry(1, 1, [['6804', 0]]),   // Burrow, CIN
  mkEntry(2, 1, [['4199', 0]]),   // Jefferson, MIN
  mkEntry(3, 2, [['1466', 10]]),
  mkEntry(4, 2, [['1466', 20]]),
  mkEntry(5, 3, [['1466', 30]]),
  mkEntry(6, 3, [['1466', 0]]),   // ghost, excluded
];

test('buildSnapshot scores each week against that week\'s game status', () => {
  const snap = buildSnapshot({
    ...LEAGUE,
    schedule: [
      { week: 3, home: 'HOU', away: 'CIN', status: 'complete' },
      { week: 3, home: 'KC', away: 'MIN', status: 'in_game' },
    ],
    weekPayloads: { 3: WEEK3 },
  });
  const wk = snap.weeks.find((w) => w.week === 3);
  assert.equal(wk.teams[1].adjusted, 20, 'CIN finished: the +20 has landed');
  assert.equal(wk.teams[1].inPlay, 20);
  assert.equal(wk.teams[2].adjusted, 0, 'MIN still playing');
  assert.equal(wk.teams[2].inPlay, 20);
});

test('a schedule carrying no status at all scores as fully settled', () => {
  // helpers.js's SCHEDULE has no status field, and every existing buildSnapshot
  // test passes it. Without the guard in Step 3 the catch-all maps all four
  // teams to 'live', every penalty becomes pending, and `adjusted` silently
  // loses 20 points per zeroed starter across the whole archive.
  const snap = buildSnapshot({
    ...LEAGUE,
    schedule: SCHEDULE,
    weekPayloads: { 3: WEEK3 },
  });
  const wk = snap.weeks.find((w) => w.week === 3);
  assert.equal(wk.teams[1].adjusted, 20, 'a status-less schedule keeps its penalties');
  assert.equal(wk.teams[2].adjusted, 20);
  assert.equal(wk.teams[1].inPlay, 20, 'and nothing is left pending');
});
```

> **Note for the implementer:** the second test fails against Task 1's
> implementation as written, and that failure is the point. `SCHEDULE` in
> `test/helpers.js` has no `status` field, so the deliberately-permissive
> catch-all — correct for an unrecognised *live* status — would read an archive
> as a game in progress. Step 3 is the fix. Do not "fix" it by weakening the
> catch-all: an unknown status must still map to `live`.

- [ ] **Step 2: Run the tests, verify they fail**

Run: `node --test test/snapshot.test.js`
Expected: FAIL on both — the first because `inPlay` is undefined, the second
because `adjusted` is 0.

- [ ] **Step 3: Implement, guarding the status-less archive**

In `rules.js`, make `gameStates` skip games that carry no status field at all:

```js
  for (const g of schedule || []) {
    if (g.week !== week) continue;
    // A game with NO status field is not a game with an unrecognised status —
    // it is a schedule that predates status entirely, so there is no live
    // information to act on. Skipping it leaves the team absent from the map,
    // which adjustedScore reads as settled, and a rescore keeps every penalty
    // it always had. The catch-all below stays permissive on purpose: it is
    // there for an unrecognised live status, which is a different thing.
    if (!g.status) continue;
    ...
  }
```

Add a matching case to `test/rules.gamestate.test.js`:

```js
test('a game with no status field is left out of the map entirely', () => {
  // Absent from the map reads as "settled" downstream, which is the right
  // answer for a schedule that carries no live information at all.
  const s = gameStates([{ week: 1, home: 'HOU', away: 'CIN' }], 1);
  assert.equal(s.size, 0);
  // But an unrecognised status is still live — the two must not be conflated.
  assert.equal(
    gameStates([{ week: 1, home: 'HOU', away: 'CIN', status: 'halftime' }], 1).get('HOU'),
    'live',
  );
});
```

In `scripts/snapshot.mjs`, extend the import on line 23:

```js
import { byeTeams, gameStates, opportunitySet, resolveWeek, standings } from '../rules.js';
```

and the `resolveWeek` call inside `buildSnapshot`:

```js
      resolveWeek(
        w,
        weekPayloads[w],
        excluded,
        byeTeams(schedule, w),
        players,
        new Set(opportunities[w] || []),
        gameStates(schedule, w),
      ),
```

- [ ] **Step 4: Add the cron**

In `.github/workflows/snapshot.yml`, add one line to the schedule block:

```yaml
on:
  schedule:
    - cron: '0 17-23 * * 0'   # Sun 1pm-7pm ET, during games
    - cron: '0 0-4 * * 1'     # Sun evening -> Mon midnight ET
    - cron: '0 5 * * 2'       # Tue 1am ET — after the MNF whistle (~03:35 UTC)
                              # and before the standings gate opens at 07:00 UTC
                              # (Tue 10:00 Israel). Without this the last run
                              # before the gate is Monday midnight ET, and the
                              # week joins the standings missing MNF entirely.
    - cron: '0 13 * * 2'      # Tue 9am ET, sweep for stat corrections
  workflow_dispatch:
```

- [ ] **Step 5: Update the README**

Replace the "How it works" paragraph's call count and add the new pieces:

```markdown
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

Rosters are read from `data/raw/`, not the API.
```

Add a section after "How it works":

```markdown
### Three scores, and when they move

A +20 only counts once that player's own NFL game is complete, so a team's score
is a moving number during the week. Results shows three readings of it —
`adjusted` (finished games only, the official score), `in play` (adjusted plus
games in progress) and `raw` (no +20 at all). `RULES.md` states the rule; the
Results tab explains it in a key that sits on the page rather than in a tooltip,
because the site is mostly read on a phone during games.

The standings do not move mid-week. A week joins at **Tuesday 10:00 Israel
time**, which `season.js` computes by comparing wall-clock parts from
`Intl.DateTimeFormat` rather than by any offset arithmetic — so Israel's
late-October DST change is absorbed with no branch and no dependency.
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Verify the archive really is unchanged**

Run: `node scripts/snapshot.mjs --replay && git diff --stat data/`
Expected: `data/weeks.json` differs **only** by added `inPlay` fields and
`phase` keys. No `adjusted`, `raw`, `winner`, `median` or record value may have
changed. If any has, stop — the compatibility default is broken.

- [ ] **Step 8: Commit**

```bash
git add scripts/snapshot.mjs rules.js .github/workflows/snapshot.yml README.md test/snapshot.test.js test/rules.gamestate.test.js
git commit -m "Score the archive against game status and close the Tuesday gap"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
|---|---|
| §2 three scores | 2 (engine), 7 (display) |
| §3.6 Action gap | 9 |
| §4.1 `gameStates` / `allGamesFinal` | 1 |
| §4.2 penalty phase table | 2 |
| §4.3 `adjustedScore` shape | 2 |
| §4.4 `resolveWeek`, no duplicate arrays | 3 |
| §4.5 `medianLine` | 3 |
| §5.1 Results as home | 5 |
| §5.2 card, leader, four state carriers | 7 |
| §5.3 names off the card, chevron | 7 |
| §5.4 key panel | 7 |
| §5.5 drill-down phases + shared header | 8 |
| §5.6 standings caption and gate note | 6 |
| §6 `season.js` | 4 |
| §7.1 live schedule | 6 |
| §7.2 cron | 9 |
| §7.3 snapshot | 9 |
| §8 testing | every task |

No gaps.

**2. Placeholder scan** — clean. Every code step carries real code; no "similar
to Task N"; no "add error handling".

**3. Type consistency**

- `phase` is `'final' | 'live' | 'upcoming'` in Tasks 2, 3, 7, 8. The literal
  `null` (no penalty) only ever appears on a *lineup row*, never on a penalty.
- `leaderOf` returns `number | 'line' | null` and is consumed that way in both
  Tasks 7 and 8.
- `gameStates` returns a `Map`, and every caller uses `.get`/`.size`.
- `renderStandings`'s third argument is `meta` with `{through, nextWeek, nextGate}`
  in both Task 6's implementation and its tests.
- `ladder(left, right, decides)` — `decides` is `'adjusted'` or `'inPlay'`,
  matching `SCORE_ROWS[].key`, in Tasks 7 and 8.

**Three issues found and fixed inline:**

1. **The status-less schedule.** `gameStates` as written in Task 1 sends a game
   with **no** `status` field through the catch-all to `'live'`. `SCHEDULE` in
   `test/helpers.js` has no status field and every existing `buildSnapshot` test
   passes it, so `adjusted` would silently shed 20 points per zeroed starter the
   moment Task 9 wired `gameStates` into the snapshot. Task 9 Step 3 adds the
   `if (!g.status) continue;` guard — distinct from the catch-all, which stays
   permissive for a genuinely unrecognised *live* status — with tests in both
   Task 1's and Task 9's files, and Step 7 as the belt-and-braces check.
2. **An inconsistent test fixture.** Task 7's `LIVE_WEEK` median matchup carried
   `line: 94.8` with `result: 'L'` while the team's adjusted score was 94.3 —
   below the line, so the engine would have recorded a win. Corrected to `'W'`,
   with the `'line'` and `'T'` outcomes moved to their own test, plus a new case
   proving the open and settled leaders genuinely can differ (which is the only
   reason `leaderOf` takes `settled` at all).
3. **Fixtures that did not exist.** Task 9's tests referenced `ROSTERS`, `USERS`
   and an imported `PLAYERS` that `test/snapshot.test.js` does not have; it
   imports only `mkEntry, SCHEDULE`. Rewritten to extend that import and build
   the league inline, matching the file's own idiom.
