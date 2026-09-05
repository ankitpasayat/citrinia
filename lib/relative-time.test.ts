// Spec: timestamps read as "now" under a minute, then Nm / Nh / Nd, and past a
// week as a month-day date ("Sep 3"), with the year appended when it is not the
// current one ("Sep 3, 2025"). Clock skew (a future timestamp) reads as "now".
import test from "node:test";
import assert from "node:assert/strict";
import { formatRelative, fullTime } from "./relative-time.ts";

// Dates render in the runtime's zone. Pin it so "Aug 29" is not "Aug 30" on a
// machine east of UTC. Safe after the import because the module builds its
// Intl formatters lazily, per call.
process.env.TZ = "UTC";

const NOW = new Date("2026-09-05T12:00:00.000Z");
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** An ISO string for a moment `ms` before NOW. */
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

test("under a minute reads as now", () => {
  assert.equal(formatRelative(ago(0), NOW), "now");
  assert.equal(formatRelative(ago(1 * SECOND), NOW), "now");
  assert.equal(formatRelative(ago(59 * SECOND), NOW), "now");
  assert.equal(formatRelative(ago(59.999 * SECOND), NOW), "now");
});

test("the minute band starts at exactly 60 seconds", () => {
  assert.equal(formatRelative(ago(60 * SECOND), NOW), "1m");
  assert.equal(formatRelative(ago(90 * SECOND), NOW), "1m");
  assert.equal(formatRelative(ago(59 * MINUTE), NOW), "59m");
  assert.equal(formatRelative(ago(59 * MINUTE + 59 * SECOND), NOW), "59m");
});

test("the hour band starts at exactly 60 minutes", () => {
  assert.equal(formatRelative(ago(60 * MINUTE), NOW), "1h");
  assert.equal(formatRelative(ago(23 * HOUR), NOW), "23h");
  assert.equal(formatRelative(ago(23 * HOUR + 59 * MINUTE), NOW), "23h");
});

test("the day band starts at exactly 24 hours", () => {
  assert.equal(formatRelative(ago(24 * HOUR), NOW), "1d");
  assert.equal(formatRelative(ago(6 * DAY), NOW), "6d");
  assert.equal(formatRelative(ago(6 * DAY + 23 * HOUR), NOW), "6d");
});

test("at exactly seven days it becomes a date", () => {
  assert.equal(formatRelative(ago(7 * DAY), NOW), "Aug 29");
  assert.equal(formatRelative(ago(30 * DAY), NOW), "Aug 6");
});

test("dates in the current year omit the year", () => {
  assert.equal(formatRelative("2026-01-03T09:00:00.000Z", NOW), "Jan 3");
  assert.equal(formatRelative("2026-09-05T00:00:00.000Z", new Date("2026-12-31T23:00:00.000Z")), "Sep 5");
});

test("dates in another year carry the year", () => {
  assert.equal(formatRelative("2025-09-03T09:00:00.000Z", NOW), "Sep 3, 2025");
  assert.equal(formatRelative("2024-02-29T09:00:00.000Z", NOW), "Feb 29, 2024");
});

test("the year is compared against now, not against today's date", () => {
  // 13 days before 2 Jan 2026: past the week band, and last year.
  const newYear = new Date("2026-01-02T12:00:00.000Z");
  assert.equal(formatRelative("2025-12-20T12:00:00.000Z", newYear), "Dec 20, 2025");
  // Six days before the same moment is still inside the day band, year or not.
  assert.equal(formatRelative("2025-12-27T12:00:00.000Z", newYear), "6d");
});

test("future timestamps from clock skew read as now", () => {
  assert.equal(formatRelative(new Date(NOW.getTime() + 30 * SECOND).toISOString(), NOW), "now");
  assert.equal(formatRelative(new Date(NOW.getTime() + 5 * DAY).toISOString(), NOW), "now");
});

test("an unparseable timestamp renders as nothing rather than NaN", () => {
  assert.equal(formatRelative("not a date", NOW), "");
  assert.equal(fullTime("not a date"), "");
});

test("fullTime spells the date and time out for the title attribute", () => {
  const full = fullTime("2025-09-03T14:05:00.000Z");
  assert.match(full, /September/);
  assert.match(full, /\b3\b/);
  assert.match(full, /2025/);
  assert.match(full, /2:05/);
  // It is the long form, not the terse relative one.
  assert.notEqual(full, formatRelative("2025-09-03T14:05:00.000Z", NOW));
});
