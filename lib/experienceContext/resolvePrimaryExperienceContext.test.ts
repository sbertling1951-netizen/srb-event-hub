import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { resolvePrimaryExperienceContext } from "@/lib/experienceContext/resolvePrimaryExperienceContext";
import type {
  NormalizedAgendaItem,
  SharedExperienceContext,
} from "@/lib/experienceContext/types";

// Focused tests for the first bounded Experience Resolver consumer of the
// Intelligence Collector. See
// docs/architecture/EPICENTRAX_EXPERIENCE_INTELLIGENCE_ARCHITECTURE.md and
// docs/architecture/EPICENTRAX_EXPERIENCE_ARCHITECTURE.md. Run with:
//   npx tsx --test lib/experienceContext/resolvePrimaryExperienceContext.test.ts

const AGENDA_ITEM: NormalizedAgendaItem = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Opening Ceremony",
  agendaDate: "2026-08-07",
  startTime: "09:00:00",
  endTime: "10:00:00",
};

// Every slice starts at the canonical "unavailable" default
// (buildCanonicalBaseSharedExperienceContext's own shape), so a test only
// has to override the specific fact it's exercising -- matching how the
// real Collector composes the Pool.
function baseContext(
  overrides: Partial<SharedExperienceContext> = {},
): SharedExperienceContext {
  return {
    generatedAt: "2026-08-07T12:00:00.000Z",
    event: {
      id: "22222222-2222-2222-2222-222222222222",
      name: "Test Event",
      location: null,
      startDate: "2026-08-07",
      endDate: "2026-08-09",
      dayNumber: 1,
      phase: null,
    },
    member: {
      attendeeId: "33333333-3333-3333-3333-333333333333",
      participantCapacity: null,
      participantCount: 0,
      checkedIn: null,
    },
    agenda: {
      currentItem: null,
      nextItem: null,
      evidenceQuality: "unavailable",
      observedAt: null,
    },
    announcements: {
      activeCount: null,
      evidenceQuality: "unavailable",
      observedAt: null,
    },
    assignments: {
      activeCount: null,
      evidenceQuality: "unavailable",
      observedAt: null,
    },
    vendorRequests: {
      openCount: null,
      evidenceQuality: "unavailable",
      observedAt: null,
    },
    ...overrides,
  };
}

test("fallback: no eligible signal exists", () => {
  const signal = resolvePrimaryExperienceContext(baseContext());

  assert.equal(signal.title, "Open today's agenda");
  assert.equal(signal.kind, "information");
  assert.equal(signal.destination, "/member/agenda");
  assert.equal(signal.sourceSlice, null);
});

test("current agenda item wins when it is the only eligible signal", () => {
  const context = baseContext({
    agenda: {
      currentItem: AGENDA_ITEM,
      nextItem: null,
      evidenceQuality: "governed",
      observedAt: "2026-08-07T12:00:00.000Z",
    },
  });

  const signal = resolvePrimaryExperienceContext(context);

  assert.equal(signal.kind, "information");
  assert.equal(signal.title, "Now: Opening Ceremony");
  assert.equal(signal.destination, "/member/agenda");
  assert.equal(signal.sourceSlice, "agenda");
});

test("next agenda item wins when there is no current item", () => {
  const context = baseContext({
    agenda: {
      currentItem: null,
      nextItem: AGENDA_ITEM,
      evidenceQuality: "governed",
      observedAt: "2026-08-07T12:00:00.000Z",
    },
  });

  const signal = resolvePrimaryExperienceContext(context);

  assert.equal(signal.kind, "reminder");
  assert.equal(signal.title, "Next: Opening Ceremony");
  assert.equal(signal.sourceSlice, "agenda");
});

test("unavailable agenda never masquerades as empty or produces a signal", () => {
  // The canonical unavailable default: currentItem/nextItem are already
  // null, so no agenda signal can fire -- falls through to fallback.
  const signal = resolvePrimaryExperienceContext(baseContext());

  assert.notEqual(signal.sourceSlice, "agenda");
});

test("a truthy agenda item under non-'governed' evidence quality is never trusted (defense-in-depth gate, not merely the null coincidence)", () => {
  // No current Provider can actually produce this combination (agenda's
  // Provider only ever sets evidenceQuality "governed" alongside a real
  // item, or the base "unavailable" default alongside null items) -- this
  // exercises the explicit evidenceQuality guard itself, independent of
  // whichever Provider behavior happens to hold true today.
  const context = baseContext({
    agenda: {
      currentItem: AGENDA_ITEM,
      nextItem: null,
      evidenceQuality: "partial",
      observedAt: "2026-08-07T12:00:00.000Z",
    },
  });

  const signal = resolvePrimaryExperienceContext(context);

  assert.notEqual(signal.sourceSlice, "agenda");
  assert.equal(signal.title, "Open today's agenda");
});

test("governed zero active assignments produces no assignment signal, distinguishable from unavailable", () => {
  const governedZero = resolvePrimaryExperienceContext(
    baseContext({
      assignments: {
        activeCount: 0,
        evidenceQuality: "governed",
        observedAt: "2026-08-07T12:00:00.000Z",
      },
    }),
  );
  const unavailable = resolvePrimaryExperienceContext(baseContext());

  assert.notEqual(governedZero.sourceSlice, "assignments");
  assert.notEqual(unavailable.sourceSlice, "assignments");
  // Both correctly produce no signal for this rule, but for two distinct
  // underlying facts (a confirmed zero vs. nothing observed) -- neither
  // is fabricated into a false positive.
  assert.deepEqual(governedZero, unavailable);
});

test("'partial' assignment evidence (identity_unavailable) never creates an authoritative assignment conclusion", () => {
  const context = baseContext({
    assignments: {
      activeCount: null,
      evidenceQuality: "partial",
      observedAt: "2026-08-07T12:00:00.000Z",
    },
  });

  const signal = resolvePrimaryExperienceContext(context);

  assert.notEqual(signal.sourceSlice, "assignments");
});

test("active assignments produce a reminder, never framed as Authority", () => {
  const context = baseContext({
    assignments: {
      activeCount: 2,
      evidenceQuality: "governed",
      observedAt: "2026-08-07T12:00:00.000Z",
    },
  });

  const signal = resolvePrimaryExperienceContext(context);

  assert.equal(signal.kind, "reminder");
  assert.equal(signal.title, "You have 2 active event duties");
  assert.equal(signal.destination, "/member/my-assignments");
  assert.equal(signal.sourceSlice, "assignments");
});

test("priority order is preserved: over-capacity beats every lower-priority signal", () => {
  const context = baseContext({
    member: {
      attendeeId: "33333333-3333-3333-3333-333333333333",
      participantCapacity: 2,
      participantCount: 3,
      checkedIn: null,
    },
    assignments: {
      activeCount: 5,
      evidenceQuality: "governed",
      observedAt: "2026-08-07T12:00:00.000Z",
    },
    agenda: {
      currentItem: AGENDA_ITEM,
      nextItem: null,
      evidenceQuality: "governed",
      observedAt: "2026-08-07T12:00:00.000Z",
    },
  });

  const signal = resolvePrimaryExperienceContext(context);

  assert.equal(signal.kind, "attention");
  assert.equal(signal.sourceSlice, "member");
});

test("priority order is preserved: active assignments beat open vendor requests", () => {
  const context = baseContext({
    assignments: {
      activeCount: 1,
      evidenceQuality: "governed",
      observedAt: "2026-08-07T12:00:00.000Z",
    },
    vendorRequests: {
      openCount: 3,
      evidenceQuality: "governed",
      observedAt: "2026-08-07T12:00:00.000Z",
    },
  });

  const signal = resolvePrimaryExperienceContext(context);

  assert.equal(signal.sourceSlice, "assignments");
});

test("deterministic: identical input always produces identical output", () => {
  const context = baseContext({
    agenda: {
      currentItem: AGENDA_ITEM,
      nextItem: null,
      evidenceQuality: "governed",
      observedAt: "2026-08-07T12:00:00.000Z",
    },
  });

  const first = resolvePrimaryExperienceContext(context);
  const second = resolvePrimaryExperienceContext(baseContext({
    agenda: {
      currentItem: AGENDA_ITEM,
      nextItem: null,
      evidenceQuality: "governed",
      observedAt: "2026-08-07T12:00:00.000Z",
    },
  }));

  assert.deepEqual(first, second);
});

test("resolver does not mutate its input SharedExperienceContext", () => {
  const context = baseContext({
    agenda: {
      currentItem: AGENDA_ITEM,
      nextItem: null,
      evidenceQuality: "governed",
      observedAt: "2026-08-07T12:00:00.000Z",
    },
  });
  const snapshot = JSON.parse(JSON.stringify(context));

  resolvePrimaryExperienceContext(context);

  assert.deepEqual(context, snapshot);
});

test("resolver performs no I/O: synchronous, and the source issues no fetch/Supabase/storage call", () => {
  const context = baseContext();
  const result = resolvePrimaryExperienceContext(context);

  // A Promise would indicate hidden async work; this resolver must return
  // a plain object synchronously.
  assert.equal(typeof (result as unknown as { then?: unknown }).then, "undefined");

  const sourcePath = fileURLToPath(
    new URL("./resolvePrimaryExperienceContext.ts", import.meta.url),
  );
  const source = readFileSync(sourcePath, "utf8");

  for (const forbidden of [
    "fetch(",
    "supabase.",
    "localStorage",
    "sessionStorage",
    ".rpc(",
    "async function",
    "await ",
  ]) {
    assert.ok(
      !source.includes(forbidden),
      `resolvePrimaryExperienceContext.ts must not contain "${forbidden}" -- the Resolver performs no I/O`,
    );
  }
});
