# URL Routing, Compact Scores and Hover Explanations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every view its own URL so the browser back button works, collapse each team's three scores to one line reading `<in play> (<adjusted>)`, and move the explanations into a hover that also answers to keyboard focus and touch.

**Architecture:** A new pure `router.js` translates between the URL hash and `{ tab, week, matchup }`. The URL becomes the single source of truth: `hashchange` parses it into `state.route` and drives the render, while clicks *write* the URL and let the resulting event do the rendering. Because a drill-down is now a real URL, opening one becomes an `<a href>` instead of a `div[role="button"]` — and that is what finally allows each score to be its own `<button>` for the hover, since nothing is nested inside anything interactive any more.

**Tech Stack:** Vanilla ES modules, no build step. Node 22 (`node:test`, `node --test`). Hash routing, no history API beyond `location.hash`. Fira Sans / Fira Code, CSS custom properties in `style.css`.

**Spec:** `docs/superpowers/specs/2026-09-10-url-routing-and-compact-scores-design.md`

## Global Constraints

- **Baseline is 270 passing tests on `main`.** `npm test` must be green after every task.
- **Render never writes the hash.** Setting `location.hash` fires `hashchange`, which renders; if render wrote the hash the cycle would close. One-way, always.
- **Navigation gets URLs; filters do not.** Tab, week and matchup are addressable. The Players tab's season picker, search box and min-games stepper are not.
- **An unparseable, out-of-range or unknown hash falls back to `#/results`.** A hand-edited URL must never blank the page or throw.
- **`router.js` is pure** — no DOM, no listener, no `location`. It takes a hash string and returns an object, or takes an object and returns a string.
- **Colour is never the sole carrier of meaning.** Existing carriers (dashed rule, hollow ring, the word "leading") stay; the parenthetical's presence becomes a fourth.
- **Every `doesNotMatch` assertion carries a positive `assert.match` anchor on the same value.** Three reviews on the previous branch found absence-only tests that passed on an empty render.
- **`PENALTY` is 20 and `LAST_WEEK` is 18, both from `config.js`.** Never inline either.
- Comment idiom explains *why* a choice was made, not what the code does.
- Commit after every task. Never `--no-verify`.

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `router.js` (create) | Pure hash ↔ `{tab, week, matchup}`. No DOM. | 1 |
| `test/router.test.js` (create) | Exhaustive parse/format/round-trip coverage. | 1 |
| `app.js` (modify) | Owns `state.route`, listens for `hashchange`, applies the route to tabs and mounts. | 2 |
| `results-view.js` (modify) | Reads week/matchup from `state.route`; navigation becomes links; `view`/`weekChosen` deleted. | 3 |
| `results-view.js` + `style.css` (modify) | Compact score line, hover/focus/tap tooltip, `scoreKey` deleted. | 4 |
| `leaderboard-view.js` (modify) | Opens on the newest season that has rows. | 5 |
| `.github/workflows/snapshot.yml`, `README.md` (modify) | Wed–Sat cron; docs. | 6 |

**Survives untouched, despite appearances:** `ladder`, `SCORE_ROWS` and `cell` in `results-view.js`. `renderMatchupDetail` still calls `ladder` at `results-view.js:554`, and the spec keeps the drill-down's three-row layout. Only `playedCard` stops using them. Do not delete them.

---

### Task 1: `router.js` — the URL is the view

**Files:**
- Create: `router.js`
- Test: `test/router.test.js` (create)

**Interfaces:**
- Consumes: `LAST_WEEK` from `config.js`.
- Produces:
  - `parseHash(hash) -> { tab: string, week: number|null, matchup: number|null }`
  - `formatHash({ tab, week, matchup }) -> string`

- [ ] **Step 1: Write the failing tests**

Create `test/router.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, formatHash } from '../router.js';

test('an empty hash is the default view', () => {
  for (const empty of ['', '#', '#/', undefined, null]) {
    assert.deepEqual(parseHash(empty), { tab: 'results', week: null, matchup: null });
  }
});

test('each tab parses', () => {
  for (const tab of ['results', 'standings', 'players', 'rules']) {
    assert.deepEqual(parseHash(`#/${tab}`), { tab, week: null, matchup: null });
  }
});

test('a week parses, and a matchup under it', () => {
  assert.deepEqual(parseHash('#/results/week/3'), { tab: 'results', week: 3, matchup: null });
  assert.deepEqual(parseHash('#/results/week/3/matchup/1'), { tab: 'results', week: 3, matchup: 1 });
  assert.deepEqual(parseHash('#/results/week/18/matchup/0'), { tab: 'results', week: 18, matchup: 0 });
});

test('a week outside 1..LAST_WEEK is refused, not clamped', () => {
  // Clamping would silently show week 18 to someone who asked for week 40 —
  // better to fall back to the default week than to invent an answer.
  for (const bad of ['#/results/week/0', '#/results/week/19', '#/results/week/-2']) {
    assert.deepEqual(parseHash(bad), { tab: 'results', week: null, matchup: null }, bad);
  }
});

test('a non-numeric week or matchup is refused', () => {
  assert.equal(parseHash('#/results/week/abc').week, null);
  assert.equal(parseHash('#/results/week/3/matchup/abc').matchup, null);
  assert.equal(parseHash('#/results/week/3.5').week, null);
});

test('a matchup without a week is not addressable', () => {
  assert.deepEqual(parseHash('#/results/matchup/1'), { tab: 'results', week: null, matchup: null });
});

test('an unknown tab falls back to the default view', () => {
  assert.deepEqual(parseHash('#/nonsense'), { tab: 'results', week: null, matchup: null });
  assert.deepEqual(parseHash('#/results/../../etc'), { tab: 'results', week: null, matchup: null });
});

test('a non-results tab carries no week or matchup', () => {
  assert.deepEqual(parseHash('#/standings/week/3'), { tab: 'standings', week: null, matchup: null });
});

test('formatHash writes the shortest URL that says it', () => {
  assert.equal(formatHash({ tab: 'results' }), '#/results');
  assert.equal(formatHash({ tab: 'standings' }), '#/standings');
  assert.equal(formatHash({ tab: 'results', week: 3 }), '#/results/week/3');
  assert.equal(formatHash({ tab: 'results', week: 3, matchup: 1 }), '#/results/week/3/matchup/1');
});

test('formatHash drops a matchup it cannot address', () => {
  assert.equal(formatHash({ tab: 'results', matchup: 1 }), '#/results');
  assert.equal(formatHash({ tab: 'players', week: 3, matchup: 1 }), '#/players');
});

test('formatHash defaults and refuses an unknown tab', () => {
  assert.equal(formatHash({}), '#/results');
  assert.equal(formatHash(), '#/results');
  assert.equal(formatHash({ tab: 'nonsense' }), '#/results');
});

test('every addressable view round-trips', () => {
  const views = [
    { tab: 'results', week: null, matchup: null },
    { tab: 'standings', week: null, matchup: null },
    { tab: 'players', week: null, matchup: null },
    { tab: 'rules', week: null, matchup: null },
    { tab: 'results', week: 1, matchup: null },
    { tab: 'results', week: 18, matchup: 0 },
    { tab: 'results', week: 7, matchup: 2 },
  ];
  for (const v of views) {
    assert.deepEqual(parseHash(formatHash(v)), v, JSON.stringify(v));
  }
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `node --test test/router.test.js`
Expected: FAIL — cannot find module `../router.js`.

- [ ] **Step 3: Create `router.js`**

```js
// The URL is the view.
//
// Pure: a hash string in, an object out, or the reverse. No DOM, no listener,
// no reading of `location` — the caller owns all of that, which is what makes
// every route below testable without a browser.
//
// Hash rather than paths because the site is static on GitHub Pages, where a
// direct request for /results/week/3 is a 404 unless a redirect shim is
// committed alongside. A hash never reaches the server at all.

import { LAST_WEEK } from './config.js';

const TABS = ['results', 'standings', 'players', 'rules'];

/** The view an empty, unknown or malformed hash resolves to. */
const DEFAULT_ROUTE = { tab: 'results', week: null, matchup: null };

const isIndex = (s) => /^\d+$/.test(s);

/**
 * Parse a location hash into the view it names.
 *
 * Anything unreadable resolves to the default view rather than throwing: a
 * hand-edited or truncated URL must never blank the page. Out-of-range weeks
 * are REFUSED, not clamped — clamping would silently show week 18 to someone
 * who asked for week 40, which is a confidently wrong answer where falling
 * back to the default week is merely an unhelpful one.
 *
 * @param {string} hash - e.g. '#/results/week/3/matchup/1'
 * @returns {{tab:string, week:number|null, matchup:number|null}}
 */
export function parseHash(hash) {
  const parts = String(hash ?? '').replace(/^#\/?/, '').split('/').filter(Boolean);

  const tab = parts[0];
  if (!TABS.includes(tab)) return { ...DEFAULT_ROUTE };
  if (tab !== 'results') return { tab, week: null, matchup: null };

  let week = null;
  if (parts[1] === 'week' && isIndex(parts[2])) {
    const n = Number(parts[2]);
    if (n >= 1 && n <= LAST_WEEK) week = n;
  }

  // A matchup is an index into a specific week's matchups, so it cannot be
  // addressed without one. `#/results/matchup/1` names nothing.
  let matchup = null;
  if (week !== null && parts[3] === 'matchup' && isIndex(parts[4])) {
    matchup = Number(parts[4]);
  }

  return { tab, week, matchup };
}

/**
 * Format a view as the shortest hash that names it.
 *
 * Shortest matters: `#/results` and `#/results/week/1` would be different
 * history entries for what may be the same screen, so the default week is
 * expressed by its ABSENCE rather than by a number that could disagree with
 * whatever the season calendar computes.
 *
 * @param {{tab?:string, week?:number|null, matchup?:number|null}} view
 * @returns {string}
 */
export function formatHash(view = {}) {
  const { tab, week = null, matchup = null } = view;
  const t = TABS.includes(tab) ? tab : 'results';

  if (t !== 'results' || week === null) return `#/${t}`;
  const base = `#/results/week/${week}`;
  return matchup === null ? base : `${base}/matchup/${matchup}`;
}
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, 270 + 11 = 281 tests.

- [ ] **Step 5: Commit**

```bash
git add router.js test/router.test.js
git commit -m "Add router.js: the URL is the view"
```

---

### Task 2: `app.js` drives the page from the URL

**Files:**
- Modify: `app.js` — imports, new `state.route`, new `applyRoute`, `wireNav`'s click handler, the startup chain
- Test: `test/app.test.js` (append)

**Interfaces:**
- Consumes: `parseHash`, `formatHash` from Task 1.
- Produces:
  - `state.route` — `{ tab, week, matchup }`, re-read fresh by `results-view.js` on every paint (Task 3).
  - `applyRoute(route) -> Promise<void>` — module-scoped in `app.js`.

- [ ] **Step 1: Write the failing test**

Append to `test/app.test.js`:

```js
import { readFileSync } from 'node:fs';

test('every tab button carries the view it routes to', () => {
  // The tab bar keeps role="tab" rather than becoming links — a tablist is not
  // a set of document links — so its click handler writes the URL instead.
  // This pins the data-view values the handler formats a hash from.
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const tabs = [...html.matchAll(/data-view="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(tabs, ['results', 'standings', 'players', 'rules']);
  assert.match(html, /id="tab-results"[^>]*aria-selected="true"/);
});
```

- [ ] **Step 2: Run the test, verify it passes already**

Run: `node --test test/app.test.js`
Expected: PASS. This one is a guard on markup Task 5 of the previous branch already established, not new behaviour — it exists so that a later change to `data-view` cannot silently break the routing this task builds on top of it. Say so in your report rather than claiming a RED phase you did not have.

- [ ] **Step 3: Add the router import and `state.route`**

At the top of `app.js`, alongside the existing imports:

```js
import { parseHash, formatHash } from './router.js';
```

Add `route` to the `state` object literal (currently at `app.js:10-14`), so every reader has a defined shape before the first parse:

```js
const state = {
  weeks: [], teams: {}, ghostRosterId: null, generatedAt: null, live: false,
  livePayloads: {}, seasonStart: null, rosterPositions: [], schedule: null,
  route: { tab: 'results', week: null, matchup: null },
};
```

- [ ] **Step 4: Hoist the Players mount and add `applyRoute`**

`playersMounted` currently lives inside `wireNav` (`app.js:165`). Move it to module scope beside `mountResultsTab`, as its own idempotent helper, so `applyRoute` can call it:

```js
// Mounted lazily like Results, and idempotent for the same reason: applyRoute
// calls it on every route change, not just the first.
let playersMounted = false;
function mountPlayersTab() {
  if (playersMounted) return Promise.resolve();
  playersMounted = true;
  return mountLeaderboard($('players'), { teams: state.teams }).catch((e) => {
    console.error(e);
    $('players').innerHTML = '<p class="empty">Could not load the leaderboard.</p>';
  });
}

/**
 * Show the view the URL names.
 *
 * The only thing that paints. Clicks never call this — they write the hash and
 * let the hashchange it fires arrive here, which is what keeps the URL and the
 * screen from ever disagreeing. Render must never write the hash back, or the
 * cycle closes.
 */
function applyRoute(route) {
  for (const b of document.querySelectorAll('nav button')) {
    const on = b.dataset.view === route.tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  }
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== route.tab;

  if (route.tab === 'players') return mountPlayersTab();
  if (route.tab === 'results') {
    // mountResultsTab is a no-op after the first call, so this is the repaint
    // path on every subsequent route change.
    return mountResultsTab().then(() => { resultsRepaint?.(); });
  }
  return Promise.resolve();
}
```

- [ ] **Step 5: Make tab clicks write the URL**

Replace the whole `for (const btn of buttons)` click block in `wireNav` (`app.js:186-208`) with:

```js
  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      // Writes the URL and stops. The hashchange listener does the painting —
      // so a click and a back button take exactly the same path.
      location.hash = formatHash({ tab: btn.dataset.view });
    });
  }
```

Delete the now-unused `let playersMounted = false;` line from inside `wireNav`. The arrow-key `keydown` block above it stays exactly as it is.

- [ ] **Step 6: Wire the startup chain and `hashchange`**

Replace the block at the foot of `app.js`:

```js
if (typeof document !== 'undefined') {
  wireNav();

  // Parsed before the snapshot so a cold load of a deep link knows where it is
  // going, and applied after so it paints against loaded data rather than
  // painting an empty state and correcting itself.
  state.route = parseHash(location.hash);

  window.addEventListener('hashchange', () => {
    state.route = parseHash(location.hash);
    applyRoute(state.route);
  });

  let snapshotLoaded = true;
  loadSnapshot()
    .catch((e) => {
      snapshotLoaded = false;
      console.error(e);
      $('freshness').hidden = false;
      $('freshness').textContent = 'Could not load the snapshot.';
    })
    .then(() => {
      if (snapshotLoaded) return applyRoute(state.route);
    })
    .then(() => {
      if (snapshotLoaded) return refreshLive();
    })
    .catch((e) => console.warn('live refresh failed, snapshot still shown', e));
}
```

Note the hash is deliberately NOT written on load. An empty hash already parses to the default view, and writing one would push a history entry before the visitor has navigated anywhere.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS, 282 tests.

- [ ] **Step 8: Commit**

```bash
git add app.js test/app.test.js
git commit -m "Drive the page from the URL, not from click handlers"
```

---

### Task 3: Results reads the route; navigation becomes links

**Files:**
- Modify: `results-view.js` — imports; delete `weekChosen` and the `view` object; `picker`; `paint`; `wire`; `renderWeek`'s back control and matchup hooks
- Test: `test/results-view.test.js` (modify the mount tests, append new ones)

**Interfaces:**
- Consumes: `formatHash` (Task 1), `state.route` (Task 2).
- Produces: `renderWeek` and `renderMatchupDetail` emit `<a href>` navigation rather than `data-*` click hooks.

- [ ] **Step 1: Write the failing tests**

Append to `test/results-view.test.js`:

```js
test('the week picker is links, not buttons', () => {
  const html = renderWeek({ week: 3, resolved: LIVE_WEEK, teams: NAMES, settled: true });
  assert.match(html, /<a href="#\/results\/week\/1"/, 'week 1 is addressable');
  assert.match(html, /<a href="#\/results\/week\/18"/, 'and so is week 18');
  assert.match(html, /aria-current="page"/, 'the current week says so');
  assert.doesNotMatch(html, /data-week="\d+"[^>]*onclick/, 'no click handlers remain');
});

test('a matchup card is a link to its own URL', () => {
  const html = renderWeek({
    week: 3, resolved: LIVE_WEEK, teams: NAMES, detailAvailable: true, settled: true,
  });
  assert.match(html, /<a class="card-open" href="#\/results\/week\/3\/matchup\/0"/);
  assert.match(html, /href="#\/results\/week\/3\/matchup\/2"/, 'every matchup, not just the first');
  assert.doesNotMatch(html, /role="button"/, 'the card is no longer a fake button');
});

test('a week with no archived payload has no card link', () => {
  const on = renderWeek({ week: 3, resolved: LIVE_WEEK, teams: NAMES, detailAvailable: true });
  const off = renderWeek({ week: 3, resolved: LIVE_WEEK, teams: NAMES, detailAvailable: false });
  assert.match(on, /class="card-open"/);
  assert.match(off, /class="card /, 'the card still renders');
  assert.doesNotMatch(off, /class="card-open"/, 'it just cannot be opened');
});

test('the drill-down back control is a link to the week', () => {
  const html = renderMatchupDetail({
    week: 3, matchup: LIVE_WEEK.matchups[0], resolved: LIVE_WEEK,
    payload: [{ roster_id: 1, starters: [], starters_points: [], players: [], players_points: {} }],
    teams: NAMES, rosterPositions: [], players: PLAYERS, settled: true,
  });
  assert.match(html, /<a class="back" href="#\/results\/week\/3">/);
  assert.doesNotMatch(html, /data-back/, 'no click hook remains');
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `node --test test/results-view.test.js`
Expected: FAIL — the picker still renders `<button data-week=...>`.

- [ ] **Step 3: Import `formatHash`**

Extend the existing import block at the top of `results-view.js` — do NOT add a second declaration from a module already imported:

```js
import { formatHash } from './router.js';
```

`./season.js` and `./rules.js` imports stay exactly as they are.

- [ ] **Step 4: Delete the closure state**

Remove these three from `mountResults`:

- `let weekChosen = false;` (`results-view.js:622`)
- `const view = { week: displayWeek(...), matchup: null };` (`results-view.js:638`)
- the whole `if (!weekChosen) { ... }` block at the top of `paint()` (`results-view.js:715-723`)

Replace the two lines that read them in `paint()` with a read of the route:

```js
    // The URL is the source of truth. A route with no week means "whichever
    // week it is now", recomputed on every paint so a snapshot that lands late
    // corrects the default instead of leaving it stuck on week 1 for the
    // session. That is what `weekChosen` used to stand in for; the URL's own
    // shape says it now, so the flag is gone.
    const route = state.route || {};
    const week = route.week ?? displayWeek(now(), state.seasonStart ?? null);
    const matchupIndex = route.matchup ?? null;
```

- [ ] **Step 5: Make the picker links**

Replace `picker` (`results-view.js:691-704`) with:

```js
  // Takes the week rather than reading a closure, so the picker cannot
  // disagree with the results drawn beside it in the same paint.
  function picker(current) {
    const btns = weekOptions(state.weeks)
      .map(({ week, played }) => {
        const cls = `${week === current ? 'on' : ''}${played ? ' played' : ''}`.trim();
        return `<a href="${formatHash({ tab: 'results', week })}"` +
          `${week === current ? ' aria-current="page"' : ''}` +
          `${cls ? ` class="${cls}"` : ''}>${week}</a>`;
      })
      .join('');

    // The steppers are links too, except at the ends, where there is no URL to
    // point at — a disabled span rather than a link to nowhere.
    const step = (delta, label, at) => {
      const target = current + delta;
      return at
        ? `<span class="step-off" aria-hidden="true">${label}</span>`
        : `<a href="${formatHash({ tab: 'results', week: target })}" aria-label="${delta < 0 ? 'Previous' : 'Next'} week">${label}</a>`;
    };

    return `<div class="controls">
      ${step(-1, '&larr;', current <= 1)}
      <div class="tabs weeks" role="group" aria-label="Week">${btns}</div>
      ${step(1, '&rarr;', current >= LAST_WEEK)}
    </div>`;
  }
```

- [ ] **Step 6: Make the card and the back control links**

In `playedCard`, replace the `hook` and `chev` lines and both `<div class="${cls}">` openings. The card keeps its classes; what changes is that the click target becomes a stretched link instead of `role="button"`:

```js
function playedCard(m, index, wk, teams, detailAvailable, settled, week) {
  const name = (id) => teams[String(id)] || `Roster ${id}`;
  const cls = `card ${settled ? 'settled' : 'live'}${detailAvailable ? ' clickable' : ''}`;
  const decides = settled ? 'adjusted' : 'inPlay';
  const leader = leaderOf(m, wk, settled);

  // A stretched link rather than a click handler on the card: the drill-down
  // is a real URL now, so it earns keyboard access, open-in-new-tab and
  // middle-click for free. It also stops being an interactive element that
  // WRAPS the scores, which is what lets each score be its own button.
  const label = m.type === 'h2h'
    ? `${name(m.rosterIds[0])} versus ${name(m.rosterIds[1])}`
    : `${name(m.rosterId)} versus the league median`;
  const open = detailAvailable
    ? `<a class="card-open" href="${formatHash({ tab: 'results', week, matchup: index })}">` +
      `<span class="sr-only">Open ${esc(label)}</span></a>` +
      '<span class="chev" aria-hidden="true">&rsaquo;</span>'
    : '';
  // ... the rest of the function body is unchanged except that `${hook}` is
  // removed from the opening div and `${open}` replaces `${chev}`.
```

`renderWeek` must pass `week` through: change its `playedCard` call to
`playedCard(m, i, resolved, teams, detailAvailable, settled, week)`.

In `renderMatchupDetail`, replace the back button:

```js
    <a class="back" href="${formatHash({ tab: 'results', week })}">&larr; Week ${week}</a>
```

- [ ] **Step 7: Empty out `wire()`**

Every handler in `wire()` (`results-view.js:778-807`) except the score-key one is now a link. Delete the `[data-week]`, `[data-step]`, `[data-matchup]` and `[data-back]` blocks. Keep only the `.score-key` toggle for now — Task 4 removes that too and replaces it with the tooltip wiring:

```js
  function wire() {
    // Records the toggle, deliberately without repainting: a repaint would
    // rebuild the very element the visitor just clicked.
    const key = el.querySelector('.score-key');
    if (key) key.ontoggle = () => { keyOpen = key.open; };
  }
```

- [ ] **Step 8: Update the mount tests**

`test/results-view.test.js`'s `makeStubEl` scrapes `data-week`/`data-matchup` and assigns `.onclick`. Those hooks are gone, so the mount tests that clicked them must drive navigation the way the app now does: set `state.route` and call the returned `repaint`.

Rework only the tests that clicked a scraped element. Every other existing test stays untouched. For each one you change, state in your report what it asserted before and after, and confirm the assertion was not weakened — a test that used to prove "clicking week 5 shows week 5" must still prove "routing to week 5 shows week 5", not merely that a repaint happened.

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add results-view.js test/results-view.test.js
git commit -m "Read the view from the URL and navigate with links"
```

---

### Task 4: The compact score line and its hover

**Files:**
- Modify: `results-view.js` — delete `scoreKey` and `keyOpen`; add `scoreLine`, `scoreTip`; rewrite `playedCard`'s score markup; `wire` gains the tap toggle
- Modify: `style.css` — the tooltip, the stretched link's stacking, the score button; delete the `.score-key` block
- Test: `test/results-view.test.js` (append)

**Interfaces:**
- Consumes: everything from Task 3.
- Produces: `scoreLine(side, settled, tipId)` and `scoreTip(side, settled, tipId)`, internal to `results-view.js`.

- [ ] **Step 1: Write the failing tests**

Append to `test/results-view.test.js`:

```js
test('an open week shows in play with adjusted parenthesised', () => {
  const html = renderWeek({ week: 3, resolved: LIVE_WEEK, teams: NAMES, settled: false });
  assert.match(html, /class="score"[^>]*>118\.40 <span class="alt">\(98\.40\)<\/span>/);
  assert.match(html, /133\.60 <span class="alt">\(113\.60\)<\/span>/);
});

test('a settled week drops the parenthetical entirely', () => {
  // in play IS adjusted once every game is final, so "118.40 (118.40)" would
  // be noise. Its ABSENCE is a fourth carrier of live-vs-settled.
  const html = renderWeek({ week: 3, resolved: LIVE_WEEK, teams: NAMES, settled: true });
  assert.match(html, /class="score"[^>]*>98\.40<\/button>/, 'the official score, alone');
  assert.doesNotMatch(html, /class="alt"/, 'no bracket on a settled card');
});

test('the score is a button that describes itself', () => {
  const html = renderWeek({ week: 3, resolved: LIVE_WEEK, teams: NAMES, settled: false });
  const m = html.match(/<button type="button" class="score" aria-describedby="([^"]+)"/);
  assert.ok(m, 'the score is a real button carrying aria-describedby');
  assert.match(html, new RegExp(`<span class="score-tip" id="${m[1]}" role="tooltip"`));
});

test('the tooltip carries all three readings on an open week', () => {
  const html = renderWeek({ week: 3, resolved: LIVE_WEEK, teams: NAMES, settled: false });
  const tip = html.slice(html.indexOf('score-tip'));
  assert.match(tip, /in play/);
  assert.match(tip, /if it ended now/);
  assert.match(tip, /adjusted/);
  assert.match(tip, /finished games only/);
  assert.match(tip, /raw/);
  assert.match(tip, /no \+20s at all/);
  assert.match(tip, /78\.40/, 'raw appears nowhere else on the card');
});

test('the tooltip omits in play on a settled week', () => {
  const html = renderWeek({ week: 3, resolved: LIVE_WEEK, teams: NAMES, settled: true });
  assert.match(html, /class="score-tip"/, 'the tooltip is still there');
  assert.match(html, /adjusted/);
  assert.doesNotMatch(html, /if it ended now/, 'but in play is redundant once settled');
});

test('every tooltip id on a week is unique', () => {
  const html = renderWeek({
    week: 3, resolved: LIVE_WEEK, teams: NAMES, detailAvailable: true, settled: false,
  });
  const ids = [...html.matchAll(/class="score-tip" id="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 6, `expected at least six tooltips, saw ${ids.length}`);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids would misdirect aria-describedby');
});

test('the score key panel is gone', () => {
  const html = renderWeek({ week: 3, resolved: LIVE_WEEK, teams: NAMES, settled: false });
  assert.match(html, /class="card /, 'the week still renders');
  assert.doesNotMatch(html, /score-key/);
  assert.doesNotMatch(html, /What these three numbers mean/);
});

test('a missing score renders a dash, not NaN', () => {
  const thin = { ...LIVE_WEEK, teams: { ...LIVE_WEEK.teams, 2: { raw: 1, adjusted: 2 } } };
  const html = renderWeek({ week: 3, resolved: thin, teams: NAMES, settled: false });
  assert.match(html, /&mdash;/);
  assert.doesNotMatch(html, /NaN/);
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `node --test test/results-view.test.js`
Expected: FAIL — no `class="score"` in the output.

- [ ] **Step 3: Add `scoreLine` and `scoreTip`**

In `results-view.js`, immediately after `sideHead`:

```js
/**
 * One team's score, as the single line the card shows.
 *
 * `in play` leads because it is what decides the matchup while games are still
 * running; `adjusted` follows in brackets because it is what will count. On a
 * settled week the two are equal by construction, so the bracket is dropped —
 * which means its PRESENCE tells you the week is still moving, a fourth carrier
 * of live-vs-settled alongside the dashed rule, the ring and the word
 * "leading".
 *
 * A button, not a span: it is the hover target, and it must answer to keyboard
 * focus and to a tap on a phone, where hover does not exist at all.
 */
function scoreLine(side, settled, tipId) {
  const lead = settled ? side?.adjusted : side?.inPlay;
  const shown = typeof lead === 'number' ? money(lead) : '&mdash;';
  const alt = !settled && typeof side?.adjusted === 'number'
    ? ` <span class="alt">(${money(side.adjusted)})</span>`
    : '';
  return `<button type="button" class="score" aria-describedby="${tipId}">${shown}${alt}</button>`;
}

/**
 * What the score means, in the only place that says so now the key panel is
 * gone.
 *
 * Present in the DOM at all times rather than injected on hover, so a screen
 * reader following aria-describedby finds it whether or not a pointer ever
 * touched the page. CSS is what hides it until it is wanted.
 */
function scoreTip(side, settled, tipId) {
  const row = (label, key, note) =>
    typeof side?.[key] === 'number'
      ? `<span class="tip-row"><b>${label}</b><span class="tip-v">${money(side[key])}</span>` +
        `<em>${esc(note)}</em></span>`
      : '';
  return `<span class="score-tip" id="${tipId}" role="tooltip">` +
    (settled ? '' : row('in play', 'inPlay', 'if it ended now')) +
    row('adjusted', 'adjusted', 'finished games only') +
    row('raw', 'raw', 'no +20s at all') +
    '</span>';
}

/** Both halves of one score cell. `key` makes the tooltip id unique per card. */
function scoreCell(side, settled, key, align) {
  const id = `tip-${key}`;
  return `<span class="score-cell ${align}">${scoreLine(side, settled, id)}${scoreTip(side, settled, id)}</span>`;
}
```

- [ ] **Step 4: Rewrite `playedCard`'s score markup**

Replace the `<div class="ladder">…</div>` in both branches of `playedCard` with a scores row. The h2h branch:

```js
    <div class="scores">
      ${scoreCell(wk.teams[a], settled, `${week}-${index}-l`, 'l')}
      ${scoreCell(wk.teams[b], settled, `${week}-${index}-r`, 'r')}
    </div>
```

The median branch, where the right-hand side is the line and has no raw:

```js
    <div class="scores">
      ${scoreCell(wk.teams[m.rosterId], settled, `${week}-${index}-l`, 'l')}
      ${scoreCell(line, settled, `${week}-${index}-r`, 'r')}
    </div>
    <div class="pool-row"><span class="pool-cap">avg of 2nd &amp; 3rd &mdash; adjusted</span><span class="pool">${poolHtml(wk.medianPool)}</span></div>
```

`decides` is now unused in `playedCard` — delete that line from it. **Do not delete the `decides` parameter from `ladder`**, which `renderMatchupDetail` still uses.

- [ ] **Step 5: Delete `scoreKey` and `keyOpen`**

- Delete the whole `scoreKey` function (`results-view.js:279-311`).
- In `renderWeek`, drop `keyOpen` from the destructured parameter list and change the played branch's return to `weekStatus(week, settled) + note + cards`.
- In `mountResults`, delete `let keyOpen = true;` and the `keyOpen` argument from the `renderWeek` call.

- [ ] **Step 6: Wire the tap toggle**

Replace `wire()` entirely:

```js
  function wire() {
    // Hover and focus are pure CSS. This is the third input mode: a tap, which
    // fires no hover at all. The button sits above the stretched card link in
    // stacking order, so a tap here toggles the explanation instead of opening
    // the matchup — and a tap anywhere else on the card still opens it.
    for (const b of el.querySelectorAll('.score')) {
      b.onclick = (e) => {
        e.preventDefault();
        const wasOpen = b.dataset.open === 'true';
        for (const o of el.querySelectorAll('.score')) delete o.dataset.open;
        if (!wasOpen) b.dataset.open = 'true';
      };
    }
  }
```

- [ ] **Step 7: Replace the CSS**

In `style.css`, delete the entire `.score-key` block (its `summary`, `dl`, `dt`, `dd` rules and the `@media` override that reflows `.score-key dl > div`). Then replace the `.lrow` rules that only the card used — **keep `.lrow`, `.lrow .n`, `.lrow .lbl` and `.lrow .lbl .cap`, which `renderMatchupDetail`'s ladder still needs** — and add:

```css
/* The card's click target: a real link stretched over the whole slip, so the
 * scores can sit above it as siblings rather than inside it as descendants. */
.card { position: relative; }
.card-open {
  position: absolute;
  inset: 0;
  z-index: 1;
  border-radius: inherit;
}
.card-open:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; }

.scores {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
  align-items: start;
}
.score-cell { position: relative; z-index: 2; }
.score-cell.l { text-align: right; }
.score-cell.r { text-align: left; }

.score {
  font: 500 var(--t-lg) / 1.15 var(--font-data);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
  color: var(--ink);
  background: none;
  border: 0;
  padding: var(--space-xs) var(--space-sm);
  margin: 0;
  cursor: help;
}
.score:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
/* The bracket is quieter than the number it qualifies, and it only exists
 * while the week is still moving. */
.score .alt { font-size: var(--t-2xs); color: var(--muted); }

.score-tip {
  position: absolute;
  z-index: 3;
  left: 50%;
  transform: translateX(-50%);
  top: calc(100% + var(--space-xs));
  display: none;
  min-width: 15rem;
  text-align: left;
  background: var(--card);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  padding: var(--space-md);
  font-size: var(--t-2xs);
}
.score:hover + .score-tip,
.score:focus-visible + .score-tip,
.score[data-open="true"] + .score-tip { display: block; }

.tip-row {
  display: grid;
  grid-template-columns: 4.5rem auto 1fr;
  gap: var(--space-md);
  align-items: baseline;
  white-space: nowrap;
}
.tip-row b { font: 600 var(--t-2xs) / 1.5 var(--font-data); color: var(--ink); }
.tip-v {
  font-family: var(--font-data);
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: var(--ink);
}
.tip-row em { font-style: normal; color: var(--muted); }

/* Links in the week picker, which were buttons until routing arrived. */
.controls .weeks a {
  display: inline-block;
  text-decoration: none;
  min-width: 2rem;
  text-align: center;
  padding: var(--space-sm);
}
.controls .weeks a[aria-current="page"] {
  color: var(--card);
  background: var(--primary);
  border-radius: var(--radius);
}
.step-off { opacity: 0.35; padding: var(--space-sm); }
```

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add results-view.js style.css test/results-view.test.js
git commit -m "Collapse the card to one score line with a hover explanation"
```

---

### Task 5: The Players tab opens on a season that has data

**Files:**
- Modify: `leaderboard-view.js` — `mountLeaderboard`'s `view.season` initialisation (`leaderboard-view.js:242`)
- Test: `test/leaderboard-view.test.js` (append)

**Interfaces:**
- Consumes: the existing `rowsFor(season)`, which returns an array or `null` on fetch failure.
- Produces: nothing new; behaviour change only.

- [ ] **Step 1: Write the failing test**

Append to `test/leaderboard-view.test.js`:

```js
test('the board opens on the newest season that actually has rows', async () => {
  // Early in a season the newest board is empty, and "No games played yet in
  // 2026" with 709 players one unobvious click away reads as broken.
  const fetched = [];
  const json = async (url) => {
    fetched.push(url);
    if (url.includes('leaderboard-2026')) return { rows: [] };
    if (url.includes('leaderboard-2025')) {
      return { rows: [{ id: '1', name: 'Someone', pos: 'QB', team: 'CIN', gp: 1, total: 10, weeks: [10] }] };
    }
    return { players: [] };
  };
  const el = makeStubEl();
  await mountLeaderboard(el, { teams: {}, json, client: { rosters: async () => [] } });

  assert.match(el.innerHTML, /2025/, 'the 2025 board is what rendered');
  assert.doesNotMatch(el.innerHTML, /No games played yet/, 'and it is not the empty state');
  assert.ok(
    fetched.some((u) => u.includes('leaderboard-2026')),
    'it still tried the newest season first',
  );
});

test('an all-empty set of seasons still renders the newest, not nothing', async () => {
  const json = async (url) =>
    url.includes('leaderboard-') ? { rows: [] } : { players: [] };
  const el = makeStubEl();
  await mountLeaderboard(el, { teams: {}, json, client: { rosters: async () => [] } });
  assert.match(el.innerHTML, /No games played yet in 2026/, 'falls back to the newest season');
});
```

If `test/leaderboard-view.test.js` has no `makeStubEl`, copy the minimal one from `test/results-view.test.js` rather than importing across test files, and say so in your report.

- [ ] **Step 2: Run the tests, verify they fail**

Run: `node --test test/leaderboard-view.test.js`
Expected: FAIL — the 2026 empty state renders.

- [ ] **Step 3: Implement**

In `mountLeaderboard`, replace `season: seasons[0],` in the `view` object literal. Because `rowsFor` is defined below `view`, compute the season first, immediately before the `const view = {` block:

```js
  // Open on the newest season that has rows, not simply the newest. Early in a
  // season the current board is empty while last year's is one unobvious click
  // away, and an empty table reads as a broken page rather than as a season
  // that has not started. rowsFor caches, so the season we settle on is
  // already loaded by the time the first render asks for it.
  let opening = seasons[0];
  for (const s of seasons) {
    const rows = await rowsFor(s);
    if (rows && rows.length) { opening = s; break; }
  }
```

and use `season: opening,` in the literal.

**You do not need to move `rowsFor`, and you should not.** It is declared at
`leaderboard-view.js:255`, below the `view` literal at `:242`, but it is a
`function` declaration and therefore hoisted to the top of `mountLeaderboard`'s
scope — so calling it from a loop placed above `view` resolves fine. Verified
before this plan was written. Moving it would produce diff noise in a function
this task otherwise does not touch.

The `await` inside that loop is the one thing to be careful about: it is inside
`mountLeaderboard`, which is already `async`, so it is legal — but it means the
mount now waits on up to one fetch per season before its first render. That is
the intended cost (§7.2 of the spec: "one extra fetch, and only when the newest
season is empty"), and `rowsFor` caches, so the season you settle on is already
loaded when the first render asks for it.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add leaderboard-view.js test/leaderboard-view.test.js
git commit -m "Open the Players tab on a season that has data"
```

---

### Task 6: Cron coverage and docs

**Files:**
- Modify: `.github/workflows/snapshot.yml` (the `schedule:` block)
- Modify: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Add the cron**

The ladder currently runs Sunday, Monday and Tuesday only. Verified against the committed schedule on 2026-09-10: the season holds 20 Thursday games across **17 of 18 weeks**, plus 2 Wednesday, 4 Friday and 2 Saturday games — and none of them are ever snapshotted, so Thursday Night Football sits invisible in the archive until Sunday afternoon.

Add, after the existing Tuesday entries:

```yaml
    - cron: '0 6 * * 3,4,5,6'   # Wed-Sat 06:00 UTC — the morning after Thursday
                                # Night Football and any midweek game. TNF kicks
                                # 20:15 ET (00:15 UTC Fri on EDT, 01:15 on EST)
                                # and ends ~03:35-04:40 UTC, so 06:00 clears it
                                # in either regime. With the Sun/Mon/Tue entries
                                # this is daily coverage.
                                # Results never needed this — it re-fetches the
                                # current week live. The Players leaderboard did:
                                # it is aggregated across weeks by this Action
                                # and never computed in the browser.
```

- [ ] **Step 2: Verify the YAML still parses and all entries survive**

Run: `python -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/snapshot.yml')); c=d['on']['schedule']; print(len(c),'entries'); [print(' ',e['cron']) for e in c]"`
Expected: 5 entries — `0 17-23 * * 0`, `0 0-4 * * 1`, `0 6 * * 2`, `0 13 * * 2`, `0 6 * * 3,4,5,6`.

If Python is unavailable, assert the same by reading the file and say which method you used.

- [ ] **Step 3: Update the README**

The "How it works" section describes the page painting from the snapshot and refetching live. Add, after that paragraph:

```markdown
Every view has its own URL. The tabs, the week you are looking at and an open
matchup are all in the address bar — `#/results/week/3/matchup/1` — so the back
button steps through them and any view can be linked to. Hash routing rather
than paths because the site is static on GitHub Pages, where a direct request
for a path that is not a file returns 404; a hash never reaches the server.

A team's card shows one number per side: `118.40 (98.40)`, the score that decides
the matchup right now with the official score in brackets. Once every game in the
week is final those two are the same number, so the brackets disappear — which
means a card with brackets is a week still in progress. Hovering a score, or
focusing it, or tapping it on a phone, explains all three readings including the
raw score.
```

Also correct the archive paragraph to mention daily coverage rather than the Sunday-to-Tuesday ladder.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/snapshot.yml README.md
git commit -m "Snapshot Wed-Sat so Thursday night is not invisible until Sunday"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
|---|---|
| §2 the card becomes one line | 4 |
| §3 router, hash not paths | 1 |
| §3.1 URL as single source of truth, `weekChosen` deleted | 2, 3 |
| §3.2 navigation addressable, filters not | 1 (routes), 5 (season stays a filter) |
| §3.3 no loops | 2 |
| §4 navigation becomes links | 3 |
| §5 the hover, and why routing came first | 3 (link), 4 (buttons + tooltip) |
| §5.1 the explanation content | 4 |
| §5.2 tab-stop cost accepted | 4 |
| §6 deep links and first load | 2 |
| §7.1 cron | 6 |
| §7.2 season with data | 5 |
| §8 testing | every task |

No gaps.

**2. Placeholder scan** — clean. Every code step carries real code; no "similar to Task N"; no "add error handling".

**3. Type consistency**

- `{ tab, week, matchup }` is the route shape in Tasks 1, 2 and 3, with `week`/`matchup` as `number|null` throughout — never `undefined`.
- `state.route` is written only in `app.js` (Task 2) and read only in `results-view.js` (Task 3).
- `formatHash({ tab: 'results', week, matchup })` is called with that exact key set in Tasks 3 and 4.
- `scoreCell(side, settled, key, align)` in Task 4 is the only caller of `scoreLine` and `scoreTip`, and its `key` is what makes tooltip ids unique.

**Three things found and fixed inline while writing this:**

1. **`ladder`, `SCORE_ROWS` and `cell` must NOT be deleted.** My first draft of Task 4 removed them along with the card's ladder. `renderMatchupDetail:554` still calls `ladder`, and the spec keeps the drill-down's three-row layout — deleting them would have broken the drill-down and the four tests covering it. Task 4 now says so explicitly, twice.
2. **`playedCard` needs `week` passed in.** It builds the matchup URL, and it had no access to the week number; `renderWeek` has it. Task 3 Step 6 adds the parameter and updates the call site.
3. **Task 2's test cannot have a RED phase.** The markup it pins already exists from the previous branch. Rather than dress it up as TDD, Step 2 says to expect a pass and to report it honestly as a regression guard on the contract routing depends on.
