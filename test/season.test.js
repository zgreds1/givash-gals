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
