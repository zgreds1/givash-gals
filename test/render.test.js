import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderStandings, renderRules } from '../render.js';

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
