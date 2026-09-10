import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderStandings, renderRules } from '../render.js';

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

test('win% renders three real decimals, not a rounded 2-decimal value', () => {
  const html = renderStandings(
    [{
      rosterId: 1, w: 2, l: 1, t: 0, gp: 3, winPct: 2 / 3,
      adjPF: 300, rawPF: 300, median: { w: 0, l: 0, t: 0 }, unresolvedTie: false,
    }],
    { 1: 'Alpha' },
  );
  assert.match(html, /\.667/);
  assert.doesNotMatch(html, /\.670/);
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
