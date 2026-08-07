import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildCanonicalBaseSharedExperienceContext,
  buildCanonicalEventSlice,
} from "@/lib/experienceContext/defaults";
import type { CurrentMemberEvent } from "@/lib/getCurrentMemberEvent";

// Covers "unavailable source" for the agenda, announcements,
// assignments, and vendorRequests slices: this is the exact object
// collectSharedExperienceContext's per-provider failure isolation leaves
// in the Pool when a Provider throws (network or database error -- see
// agendaProvider.test.ts, announcementsProvider.test.ts,
// assignmentsProvider.test.ts, vendorRequestsProvider.test.ts). This is
// distinct from assignments' `identity_unavailable` case, which is a
// governed, successful API outcome and therefore does carry a real
// observedAt -- see assignmentsProvider.test.ts. Unlike assignments,
// vendorRequests' governed boundary has no analogous distinct outcome (see
// vendorRequestsProvider.ts) -- its only "unavailable" case is this
// generic Provider-failure default. Run with:
//   npx tsx --test lib/experienceContext/defaults.test.ts

const EVENT: CurrentMemberEvent = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Test Event",
  eventName: "Test Event",
  venue_name: null,
  location: null,
  start_date: "2026-08-07",
  end_date: "2026-08-09",
  event_code: null,
  participant_capacity: null,
  lat: null,
  lng: null,
};

test("agenda default represents an unavailable source, never a fabricated empty agenda", () => {
  const context = buildCanonicalBaseSharedExperienceContext({
    event: EVENT,
    now: new Date("2026-08-07T12:00:00.000Z"),
    attendeeId: null,
    participantCapacity: null,
    participantCount: 0,
    checkedIn: null,
    eventCode: null,
    registrationIdentifier: null,
  });

  assert.equal(context.agenda.currentItem, null);
  assert.equal(context.agenda.nextItem, null);
  assert.equal(context.agenda.evidenceQuality, "unavailable");
  // Freshness and Evidence Quality are separate facts: nothing was
  // observed this pass, so observedAt is null -- never a fabricated
  // timestamp standing in for a real observation.
  assert.equal(context.agenda.observedAt, null);
});

test("announcements default represents an unavailable source, never a fabricated zero", () => {
  const context = buildCanonicalBaseSharedExperienceContext({
    event: EVENT,
    now: new Date("2026-08-07T12:00:00.000Z"),
    attendeeId: null,
    participantCapacity: null,
    participantCount: 0,
    checkedIn: null,
    eventCode: null,
    registrationIdentifier: null,
  });

  // null, not 0 -- unavailable must never be conflated with a
  // governed-confirmed zero.
  assert.equal(context.announcements.activeCount, null);
  assert.equal(context.announcements.evidenceQuality, "unavailable");
  assert.equal(context.announcements.observedAt, null);
});

test("assignments default represents an unavailable source, never a fabricated zero", () => {
  const context = buildCanonicalBaseSharedExperienceContext({
    event: EVENT,
    now: new Date("2026-08-07T12:00:00.000Z"),
    attendeeId: null,
    participantCapacity: null,
    participantCount: 0,
    checkedIn: null,
    eventCode: null,
    registrationIdentifier: null,
  });

  assert.equal(context.assignments.activeCount, null);
  assert.equal(context.assignments.evidenceQuality, "unavailable");
  assert.equal(context.assignments.observedAt, null);
});

test("vendorRequests default represents an unavailable source, never a fabricated zero", () => {
  const context = buildCanonicalBaseSharedExperienceContext({
    event: EVENT,
    now: new Date("2026-08-07T12:00:00.000Z"),
    attendeeId: null,
    participantCapacity: null,
    participantCount: 0,
    checkedIn: null,
    eventCode: null,
    registrationIdentifier: null,
  });

  assert.equal(context.vendorRequests.openCount, null);
  assert.equal(context.vendorRequests.evidenceQuality, "unavailable");
  assert.equal(context.vendorRequests.observedAt, null);
});

// event.dayNumber delegates to the shared computeEventDayNumber
// (lib/eventDayNumber.ts, also used by components/
// MemberDashboardHeader.tsx) -- these tests cover the Collector's own
// wiring of it, not the calculation itself (see lib/eventDayNumber.test.ts
// for the full pre/start/mid/end/post-event matrix). start_date/end_date
// are date-only strings, parsed as UTC per the ECMAScript spec, then
// compared via LOCAL calendar components -- so `now` is derived from the
// same local-calendar-date extraction the function itself performs on
// EVENT.start_date, keeping these tests deterministic regardless of the
// runner's timezone (the same technique already used in
// lib/eventDayNumber.test.ts and components/MemberDashboardHeader.test.tsx).
function localCalendarDateOf(dateOnly: string): Date {
  const parsed = new Date(dateOnly);
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function eventNowAtDaysAfterStart(daysAfterStart: number): Date {
  const now = localCalendarDateOf(EVENT.start_date as string);
  now.setDate(now.getDate() + daysAfterStart);
  now.setHours(12, 0, 0, 0);
  return now;
}

const EVENT_SLICE_INPUT_BASE = {
  event: EVENT,
  attendeeId: null,
  participantCapacity: null,
  participantCount: 0,
  checkedIn: null,
  eventCode: null,
  registrationIdentifier: null,
};

test("event.dayNumber: mid-event is the correct Day N", () => {
  const slice = buildCanonicalEventSlice({
    ...EVENT_SLICE_INPUT_BASE,
    now: eventNowAtDaysAfterStart(1),
  });

  assert.equal(slice.dayNumber, 2);
});

test("event.dayNumber: before the start date is null, never a fabricated Day number", () => {
  const slice = buildCanonicalEventSlice({
    ...EVENT_SLICE_INPUT_BASE,
    now: eventNowAtDaysAfterStart(-1),
  });

  assert.equal(slice.dayNumber, null);
});

test("event.dayNumber: after the end date is null, never a fabricated in-event Day number", () => {
  const slice = buildCanonicalEventSlice({
    ...EVENT_SLICE_INPUT_BASE,
    now: eventNowAtDaysAfterStart(30),
  });

  assert.equal(slice.dayNumber, null);
});
