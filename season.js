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
