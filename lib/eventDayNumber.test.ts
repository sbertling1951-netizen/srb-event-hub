import assert from "node:assert/strict";
import { test } from "node:test";

import { computeEventDayNumber } from "@/lib/eventDayNumber";

// Focused tests for the shared event-day calculation now consolidated out
// of lib/experienceContext/defaults.ts and components/
// MemberDashboardHeader.tsx. Run with:
//   npx tsx --test lib/eventDayNumber.test.ts

// computeEventDayNumber parses startDate/endDate as date-only strings
// (always UTC, per the ECMAScript spec), then extracts LOCAL calendar
// components from that instant, and compares those against `now`'s own
// (already local) calendar components. In a timezone behind UTC, a
// UTC-midnight instant can read back as the previous local calendar day
// -- so hardcoding both a date string and an expected day number would be
// runner-timezone-dependent. This derives `now` from the exact same
// local-calendar-date extraction the function itself performs on
// `startDate`, so the intended day-offset holds regardless of the
// runner's timezone. (Same technique already used in
// components/MemberDashboardHeader.test.tsx.)
function localCalendarDateOf(dateOnly: string): Date {
  const parsed = new Date(dateOnly);
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

const START_DATE = "2026-08-06";
const END_DATE = "2026-08-09";

function nowAtDaysAfterStart(daysAfterStart: number): Date {
  const now = localCalendarDateOf(START_DATE);
  now.setDate(now.getDate() + daysAfterStart);
  now.setHours(12, 0, 0, 0);
  return now;
}

test("before the start date: no positive Day number", () => {
  assert.equal(
    computeEventDayNumber(START_DATE, END_DATE, nowAtDaysAfterStart(-1)),
    null,
  );
});

test("on the start date: Day 1", () => {
  assert.equal(
    computeEventDayNumber(START_DATE, END_DATE, nowAtDaysAfterStart(0)),
    1,
  );
});

test("mid-event: the correct Day N", () => {
  assert.equal(
    computeEventDayNumber(START_DATE, END_DATE, nowAtDaysAfterStart(1)),
    2,
  );
});

test("on the end date: still the correct in-event Day N, not null", () => {
  // START_DATE to END_DATE is a 4-day span (Aug 6-9 inclusive) -> Day 4
  // on the end date itself.
  assert.equal(
    computeEventDayNumber(START_DATE, END_DATE, nowAtDaysAfterStart(3)),
    4,
  );
});

test("after the end date: no positive Day number, never fabricated", () => {
  assert.equal(
    computeEventDayNumber(START_DATE, END_DATE, nowAtDaysAfterStart(30)),
    null,
  );
});

test("missing start date: no Day number", () => {
  assert.equal(computeEventDayNumber(null, END_DATE, nowAtDaysAfterStart(1)), null);
});

test("missing end date: still computes a mid-event Day number (open-ended event)", () => {
  assert.equal(computeEventDayNumber(START_DATE, null, nowAtDaysAfterStart(1)), 2);
});

test("missing end date: does not fabricate a cutoff -- an open-ended event keeps counting", () => {
  assert.equal(computeEventDayNumber(START_DATE, null, nowAtDaysAfterStart(30)), 31);
});

test("unparseable start date: no Day number", () => {
  assert.equal(
    computeEventDayNumber("not-a-date", END_DATE, nowAtDaysAfterStart(1)),
    null,
  );
});

test("deterministic: identical inputs always produce identical output", () => {
  const now = nowAtDaysAfterStart(1);
  const first = computeEventDayNumber(START_DATE, END_DATE, now);
  const second = computeEventDayNumber(START_DATE, END_DATE, now);

  assert.equal(first, second);
});
