import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leagueWarning, showTables, weeksToRefresh } from '../app.js';

test('no warning when the league is the expected shape', () => {
  assert.equal(leagueWarning(5, 6), null);
});

test('warns when every roster slot is owned', () => {
  assert.match(leagueWarning(6, null), /no median matchup/i);
});

test('warns when the league is not yet full', () => {
  assert.match(leagueWarning(3, 6), /3 of 5/);
});

test('no warning when no league data has loaded (empty teams, no ghost)', () => {
  assert.equal(leagueWarning(0, null), null);
});

test('no warning when no league data has loaded (empty teams, ghost set)', () => {
  assert.equal(leagueWarning(0, 4), null);
});

// paint() suppression predicate. Below 5 owned rosters there is no honest
// table to draw, so the banner is shown alone.
test('tables are suppressed while the league is short of five managers', () => {
  assert.equal(showTables(1), false);
  assert.equal(showTables(3), false);
  assert.equal(showTables(4), false);
});

test('tables render for the normal shape and for a fully owned league', () => {
  assert.equal(showTables(5), true);
  assert.equal(showTables(6), true);
});

test('tables are not suppressed when nothing loaded — that path owns its own error', () => {
  assert.equal(showTables(0), true);
});

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

/*
 * Which weeks the live refresh asks Sleeper about.
 *
 * This is the bug that stranded a Monday night game on the page for half a
 * day. Sleeper rolls `week` to the NEXT week once the current one's games are
 * done, so on a Tuesday it reads 2 while `display_week` still reads 1. The
 * refresh followed `week` alone: it fetched week 2, found nothing played,
 * returned early, and never touched week 1 — the week actually on screen. The
 * moment week 1's last game ended was the moment week 1 stopped being
 * refreshable, which is precisely backwards.
 */
const nfl = (over) => ({ season: '2026', season_type: 'regular', ...over });

test('the Tuesday split refreshes the week shown AND the week coming', () => {
  // The exact state observed on 2026-09-15, the morning the game went missing.
  assert.deepEqual(weeksToRefresh(nfl({ week: 2, display_week: 1 })), [1, 2]);
});

test('mid-week, when both agree, it is one week and one fetch', () => {
  assert.deepEqual(weeksToRefresh(nfl({ week: 3, display_week: 3 })), [3]);
});

test('a missing display_week falls back to week alone', () => {
  assert.deepEqual(weeksToRefresh(nfl({ week: 4 })), [4]);
});

test('the preseason asks for nothing', () => {
  assert.deepEqual(weeksToRefresh({ season_type: 'pre', week: 1, display_week: 1 }), []);
  assert.deepEqual(weeksToRefresh(nfl({ week: 0, display_week: 0 })), []);
});

test('week 0 alongside a real display_week still refreshes the real one', () => {
  assert.deepEqual(weeksToRefresh(nfl({ week: 0, display_week: 1 })), [1]);
});
