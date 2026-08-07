import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCanonicalBaseSharedExperienceContext } from "@/lib/experienceContext/defaults";
import type { CurrentMemberEvent } from "@/lib/getCurrentMemberEvent";

// Covers "unavailable source" for the agenda and announcements slices:
// this is the exact object collectSharedExperienceContext's per-provider
// failure isolation leaves in the Pool when a Provider throws (network or
// database error -- see agendaProvider.test.ts,
// announcementsProvider.test.ts). Run with:
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
