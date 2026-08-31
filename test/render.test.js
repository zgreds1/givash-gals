import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderResults, renderStandings, renderRules } from '../render.js';

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

test('renderResults escapes hostile team names and penalty player names', () => {
  const hostileWeek = {
    ...WEEK,
    teams: {
      ...WEEK.teams,
      1: {
        ...WEEK.teams[1],
        penalties: [{ ...WEEK.teams[1].penalties[0], name: '<img src=x onerror=alert(1)>' }],
      },
    },
  };
  const hostileTeams = { ...TEAMS, 1: '<script>alert(1)</script>' };

  const html = renderResults([hostileWeek], hostileTeams);

  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img /);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img /);
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

test('a degenerate week says so instead of rendering an empty shell', () => {
  const html = renderResults([{ ...WEEK, degenerate: true, matchups: [] }], TEAMS);
  assert.match(html, /Week 3/);
  assert.match(html, /do not fit the league format/i);
  assert.doesNotMatch(html, /winner/);
});

test('the rules page states there are no playoffs and that 18 weeks decide it', () => {
  const html = renderRules();
  assert.match(html, /No playoffs/i);
  assert.match(html, /18/);
  assert.match(html, /final rankings/i);
});

test('the rules page states the opportunity exemption', () => {
  const html = renderRules();
  assert.match(html, /rush attempt/i);
  assert.match(html, /extra-point attempt/i);
  assert.match(html, /empty starter slot is never exempt/i);
});
