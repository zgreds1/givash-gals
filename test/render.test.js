import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderStandings, renderRules, STANDINGS_COLUMNS } from '../render.js';
import { PENALTY } from '../config.js';

/**
 * One `<h2>` section of the rules page, heading excluded.
 *
 * The page repeats phrases like "on bye" and "empty slot" across sections, so
 * a match against the whole render would be satisfied by copy that was already
 * there before the section under test existed.
 */
const section = (html, heading) => {
  const start = html.indexOf(heading);
  assert.notEqual(start, -1, `the rules page has no "${heading}" heading`);
  const rest = html.slice(start + heading.length);
  const end = rest.indexOf('<h2>');
  return end === -1 ? rest : rest.slice(0, end);
};

const LANDS = `When the +${PENALTY} lands</h2>`;

// Shared by the meta/gate-note tests below, which don't care about the row
// shape itself — only about what renderStandings does around it.
const ROWS = [{
  rosterId: 1, w: 2, l: 1, t: 0, gp: 3, winPct: 2 / 3,
  adjPF: 300, rawPF: 300, median: { w: 0, l: 0, t: 0 }, unresolvedTie: false,
}];
const TEAMS = { 1: 'Alpha' };

test('team names are escaped', () => {
  const html = renderStandings(
    [{ rosterId: 1, w: 1, l: 0, t: 0, gp: 1, winPct: 1, adjPF: 100, rawPF: 100, median: { w: 0, l: 0, t: 0 }, unresolvedTie: false }],
    { 1: '<script>x</script>' },
  );
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

/*
 * No Win% column, and no tie digit in a record.
 *
 * The league settles ties by hand, so the third number read "0" in every row
 * all season and the percentage derived from it carried nothing the W-L did
 * not. Both are display-only removals: standings() still ranks on winPct and
 * still counts ties, so the ORDER of this table is untouched.
 */
test('the standings carry no Win% column', () => {
  const html = renderStandings(
    [{
      rosterId: 1, w: 2, l: 1, t: 0, gp: 3, winPct: 2 / 3,
      adjPF: 300, rawPF: 300, median: { w: 0, l: 0, t: 0 }, unresolvedTie: false,
    }],
    { 1: 'Alpha' },
  );
  assert.doesNotMatch(html, /Win%|data-k="winPct"/);
  assert.doesNotMatch(html, /\.667/, 'nor the number it used to print');
});

test('a record prints W-L, with no tie digit', () => {
  const html = renderStandings(
    [{
      rosterId: 1, w: 2, l: 1, t: 0, gp: 3, winPct: 2 / 3,
      adjPF: 300, rawPF: 300, median: { w: 1, l: 0, t: 0 }, unresolvedTie: false,
    }],
    { 1: 'Alpha' },
  );
  assert.match(html, /<td class="record">2-1<\/td>/);
  assert.match(html, /<td class="num med">1-0<\/td>/);
  assert.doesNotMatch(html, /2-1-0|1-0-0/, 'no three-part record survives');
});

test('the rules page states there are no playoffs and that 18 weeks decide it', () => {
  const html = renderRules();
  assert.match(html, /No playoffs/i);
  assert.match(html, /18/);
  assert.match(html, /final rankings/i);
});

test('the rules page states the opportunity exemption', () => {
  const html = renderRules();
  assert.match(html, /catch, pass\s+completion/i);
  assert.match(html, /rush attempt/i);
  assert.match(html, /extra-point attempt/i);
  assert.match(html, /empty starter slot is never exempt/i);
});

test('the rules page says a target and a pass attempt do NOT exempt', () => {
  // The copy has to carry the negative half of the rule; stating only what
  // exempts would leave a reader to assume a target still counts.
  const html = renderRules();
  assert.match(html, /completed action, not an intention/i);
  assert.match(html, /targeted eight times/i);
  assert.match(html, /0-for-5/);
});

test('the rules page states when a +20 actually lands', () => {
  // The one surface in the product whose job is stating the rules still said
  // "each starter that scores exactly 0 adds 20" while Results was tagging
  // zeros "not started". A visitor clicking through found neither concept.
  const lands = section(renderRules(), LANDS);
  assert.match(lands, /own NFL game is\s+complete/i);
  assert.match(lands, /half-time/i);
  assert.match(lands, /empty slot/i);
  assert.match(lands, /on bye/i);
  assert.match(lands, /cancelled/i);
});

test('the rules page names the three readings, in that order', () => {
  const lands = section(renderRules(), LANDS);
  assert.match(
    lands,
    /<strong>adjusted<\/strong>[\s\S]*<strong>in play<\/strong>[\s\S]*<strong>raw<\/strong>/,
    'adjusted, in play, raw — the labels and the order the Results tab uses',
  );
  assert.match(lands, /not kicked\s+off is charged by neither/i);
  // The distinction the three captions kept losing: the readings share their
  // POINTS and differ only in how many +20s they charge.
  assert.match(lands, /every point every starter has\s+scored so far/i);
  assert.match(lands, /only how many \+20s they add/i);
});

test('the rules page says the standings absorb a week on the Tuesday gate', () => {
  const lands = section(renderRules(), LANDS);
  assert.match(lands, /standings themselves do not move mid-week/i);
  assert.match(lands, /Tuesday at 10:00 Israel time/);
});

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

test('a nextWeek with no nextGate renders no note', () => {
  // Happens in production: with no seasonStart, gateLabel returns null while
  // nextWeek is still 1 (truthy). The note must stay suppressed on an
  // explicit null check, not just on the && short-circuit it replaced.
  const html = renderStandings(ROWS, TEAMS, { nextWeek: 1, nextGate: null });
  // Anchor first: two doesNotMatch calls alone would also pass on an empty
  // string, which is the one failure this test would never notice.
  assert.match(html, /<table class="standings">/);
  assert.doesNotMatch(html, /<p class="gate-note">/);
  assert.doesNotMatch(html, /joins/);
});

test('an explicit through: null omits the through-week clause', () => {
  const html = renderStandings(ROWS, TEAMS, { through: null });
  assert.match(html, /lowest adjusted points wins<\/caption>/);
  assert.doesNotMatch(html, /through week/);
});

/*
 * The season +20 column.
 *
 * Its own column rather than a number folded into Adj PF, because the two
 * answer different questions: Adj PF is how the team is doing, +20 is how
 * much of that was self-inflicted. The column sits beside the two PF numbers
 * it reconciles - adjPF minus rawPF is exactly PENALTY x this cell.
 */
const P20 = (settledPenalties) => ({
  rosterId: 1, w: 2, l: 1, t: 0, gp: 3, winPct: 2 / 3,
  adjPF: 300 + settledPenalties * PENALTY, rawPF: 300,
  settledPenalties, median: { w: 0, l: 0, t: 0 }, unresolvedTie: false,
});

test('the standings carry a season +20 column', () => {
  const html = renderStandings([P20(7)], TEAMS, {});
  assert.ok(html.includes(`<span class="lbl-full">+${PENALTY}s</span>`));
  assert.ok(html.includes('data-k="settledPenalties"'));
  assert.match(html, /<td class="num pen20">7<\/td>/);
});

/*
 * No card collapse, at any width.
 *
 * The standings used to become one labelled card per team under 34rem - four
 * captioned rows each and five screens of scrolling to compare two numbers,
 * which is the opposite of what a standings table is for. Measured at
 * --t-2xs, all eight columns fit from 360px up, so the table stays a table
 * and only a 320px phone falls back to scrolling .table-wrap. Nothing is
 * named by data-label any more because nothing is ever read as a card.
 */
test('no cell carries a data-label, because the table never becomes cards', () => {
  const html = renderStandings([P20(3)], TEAMS, {});
  assert.doesNotMatch(html, /data-label=/);
});

test('a phone gets every column, not a subset', () => {
  // `.muted` was the class the old 34rem collapse hid. Nothing carries it now:
  // Raw PF and vs Median are readable on a phone like every other column.
  const html = renderStandings([P20(4)], TEAMS, {});
  assert.doesNotMatch(html, /class="[^"]*\bmuted\b/);
  for (const [k] of STANDINGS_COLUMNS) assert.match(html, new RegExp(`data-k="${k}"`));
});

test('every header ships both a full and a short label', () => {
  // CSS picks one by width, so the phone header is not a second render path
  // that can drift from the desktop one.
  const html = renderStandings([P20(1)], TEAMS, {});
  assert.equal((html.match(/class="lbl-full"/g) || []).length, STANDINGS_COLUMNS.length);
  assert.equal((html.match(/class="lbl-short"/g) || []).length, STANDINGS_COLUMNS.length);
  assert.ok(html.includes('<span class="lbl-short">Med</span>'));
});

test('a clean season prints 0 rather than a blank cell', () => {
  const html = renderStandings([P20(0)], TEAMS, {});
  assert.match(html, /<td class="num pen20">0<\/td>/);
});

test('a row from the archive with no +20 count still renders', () => {
  const html = renderStandings(ROWS, TEAMS, {});
  assert.match(html, /<td class="num pen20">0<\/td>/);
});

test('the sorted column is marked on every body cell, for the eye', () => {
  const html = renderStandings([P20(4)], TEAMS, { sortKey: 'adjPF', sortDir: 1 });
  assert.match(html, /<td class="num adjpf sorted">/);
  assert.doesNotMatch(html, /<td class="num pen20 sorted">/);
});

/*
 * Why the standings have stopped moving.
 *
 * A table that sits still on a Tuesday afternoon reads as broken unless it
 * says why. There are two different reasons and they need different words:
 * waiting for the clock ("joins Tuesday 10:00") and waiting for a game that
 * is still being played. The second used to be impossible — the gate was the
 * clock alone — so only the first sentence existed.
 */
test('the gate note names the clock when the week is waiting on the clock', () => {
  const html = renderStandings(ROWS, TEAMS, { nextWeek: 2, nextGate: 'Tuesday 22 September, 10:00' });
  assert.match(html, /Week 2 joins Tuesday 22 September, 10:00\./);
});

test('the gate note names the games when the week is waiting on a game', () => {
  const html = renderStandings(ROWS, TEAMS, {
    nextWeek: 2, nextGate: 'Tuesday 22 September, 10:00', waitingOnGames: true,
  });
  assert.match(html, /Week 2 joins once its last game is final\./);
  assert.doesNotMatch(html, /Tuesday 22 September/, 'the clock has already passed; naming it would mislead');
});

test('waitingOnGames needs no gate label to say something useful', () => {
  const html = renderStandings(ROWS, TEAMS, { nextWeek: 2, nextGate: null, waitingOnGames: true });
  assert.match(html, /Week 2 joins once its last game is final\./);
});
