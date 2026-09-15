import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameStates, allGamesFinal , weekIsPlaying } from '../rules.js';
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

// Week 6 of the committed data/raw/schedule.json, verbatim. DAL v SEA was
// cancelled and BOTH teams were re-placed into replacement fixtures — SEA at
// DEN on the very same date, DAL at GB three days later. Two rows sharing one
// date sit in Sleeper's array in arbitrary order, so both orders are tested.
const WK6_REPLACED = [
  { status: 'canceled', date: '2026-10-15', home: 'DAL', week: 6, away: 'SEA' },
  { status: 'pre_game', date: '2026-10-15', home: 'DEN', week: 6, away: 'SEA' },
  { status: 'pre_game', date: '2026-10-18', home: 'GB', week: 6, away: 'DAL' },
];

test('a team playing twice takes its least-settled game, in either array order', () => {
  // Last-write-wins gave DAL and SEA 'final' whenever the reversed order won,
  // which is a +20 on every zeroed DAL/SEA starter from Wednesday of week 6 —
  // four days before either team kicks off.
  for (const [order, rows] of [
    ['as committed', WK6_REPLACED],
    ['array reversed', [...WK6_REPLACED].reverse()],
  ]) {
    const s = gameStates(rows, 6);
    assert.equal(s.get('DAL'), 'upcoming', `DAL, ${order}`);
    assert.equal(s.get('SEA'), 'upcoming', `SEA, ${order}`);
    // The teams with only one row are untouched by the merge.
    assert.equal(s.get('DEN'), 'upcoming', `DEN, ${order}`);
    assert.equal(s.get('GB'), 'upcoming', `GB, ${order}`);
  }
});

test('live beats final, and upcoming beats live, whichever row is scanned first', () => {
  const liveAndDone = [
    { week: 1, home: 'KC', away: 'MIN', status: 'complete' },
    { week: 1, home: 'KC', away: 'BUF', status: 'in_game' },
  ];
  assert.equal(gameStates(liveAndDone, 1).get('KC'), 'live');
  assert.equal(gameStates([...liveAndDone].reverse(), 1).get('KC'), 'live');
  assert.equal(gameStates(liveAndDone, 1).get('MIN'), 'final', 'one row each: unchanged');

  // A team with one game underway and another not yet started still has
  // football left to play, and 'upcoming' is the only phase that counts toward
  // neither reading. 'live' would already be adding 20 to in play.
  const liveAndPending = [
    { week: 1, home: 'KC', away: 'MIN', status: 'in_game' },
    { week: 1, home: 'KC', away: 'BUF', status: 'pre_game' },
  ];
  assert.equal(gameStates(liveAndPending, 1).get('KC'), 'upcoming');
  assert.equal(gameStates([...liveAndPending].reverse(), 1).get('KC'), 'upcoming');
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

/*
 * When an open page should keep asking Sleeper.
 *
 * Not "the week is not final" — that is true all week for a week that has not
 * kicked off yet, and a page polling every minute from Tuesday to Sunday for
 * scores that cannot move is a battery drain and a lie about what it is
 * watching. Two things justify a poll: a game actually in progress, or a game
 * scheduled TODAY that has not finished, so a page left open before kickoff
 * still notices the kickoff.
 */
const SUNDAY = new Date('2026-09-13T18:00:00Z');
const WEDNESDAY = new Date('2026-09-16T12:00:00Z');

const sched = (rows) => rows.map((r) => ({ week: 1, ...r }));

test('a game in progress justifies polling', () => {
  const s = sched([{ home: 'KC', away: 'DEN', status: 'in_game', date: '2026-09-13' }]);
  assert.equal(weekIsPlaying(s, 1, SUNDAY), true);
});

test('a week that has not kicked off does not, even though it is not final', () => {
  // The bug this exists to prevent: pre_game is not final, so a "not final"
  // test polls every minute from Tuesday to Sunday.
  const s = sched([{ week: 2, home: 'KC', away: 'DEN', status: 'pre_game', date: '2026-09-20' }]);
  assert.equal(weekIsPlaying(s, 2, WEDNESDAY), false);
});

test('a game scheduled today but not yet kicked off does justify polling', () => {
  // A page opened five minutes before kickoff has to notice the kickoff.
  const s = sched([{ home: 'KC', away: 'DEN', status: 'pre_game', date: '2026-09-13' }]);
  assert.equal(weekIsPlaying(s, 1, SUNDAY), true);
});

test('a finished week stops polling even on the day it was played', () => {
  const s = sched([{ home: 'KC', away: 'DEN', status: 'complete', date: '2026-09-13' }]);
  assert.equal(weekIsPlaying(s, 1, SUNDAY), false);
});

test('a cancelled game is settled, not something to wait for', () => {
  const s = sched([{ home: 'KC', away: 'DEN', status: 'canceled', date: '2026-09-13' }]);
  assert.equal(weekIsPlaying(s, 1, SUNDAY), false);
});

test('no schedule means nothing to poll for', () => {
  assert.equal(weekIsPlaying(null, 1, SUNDAY), false);
  assert.equal(weekIsPlaying([], 1, SUNDAY), false);
});

test('only the named week counts', () => {
  const s = sched([{ week: 2, home: 'KC', away: 'DEN', status: 'in_game', date: '2026-09-13' }]);
  assert.equal(weekIsPlaying(s, 1, SUNDAY), false, 'week 2 is live, week 1 was asked about');
});
