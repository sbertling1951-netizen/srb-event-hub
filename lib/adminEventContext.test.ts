import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveAdminWorkingEvent } from "@/lib/adminEventContext";

// Focused tests for the Event Context Invariant
// (docs/architecture/ADR-006 Event Context Architecture.md), written
// against the Amana -> Branson production defect: an established Admin
// working Event (Amana, lifecycle status "inactive") was silently
// replaced by a different, active Event (Branson) during ordinary
// navigation. Run with:
//   npx tsx --test lib/adminEventContext.test.ts

type Candidate = {
  id: string;
  name?: string | null;
  status?: string | null;
};

const AMANA: Candidate = { id: "amana", name: "Amana", status: "inactive" };
const BRANSON: Candidate = { id: "branson", name: "Branson", status: "active" };
const CASTLE: Candidate = { id: "castle", name: "Castle", status: "completed" };

const ACCESSIBLE = [AMANA, BRANSON, CASTLE];

test("an active stored Event survives resolution unchanged", () => {
  const { event, invalidStoredContext } = resolveAdminWorkingEvent(
    ACCESSIBLE,
    { id: BRANSON.id },
    null,
  );

  assert.equal(event?.id, BRANSON.id);
  assert.equal(invalidStoredContext, false);
});

test("an inactive stored Event survives resolution unchanged -- inactive is not invalid", () => {
  const { event, invalidStoredContext } = resolveAdminWorkingEvent(
    ACCESSIBLE,
    { id: AMANA.id },
    null,
  );

  assert.equal(event?.id, AMANA.id);
  assert.equal(event?.status, "inactive");
  assert.equal(invalidStoredContext, false);
});

test("a completed/historical stored Event survives resolution unchanged", () => {
  const { event, invalidStoredContext } = resolveAdminWorkingEvent(
    ACCESSIBLE,
    { id: CASTLE.id },
    null,
  );

  assert.equal(event?.id, CASTLE.id);
  assert.equal(invalidStoredContext, false);
});

test("resolution never depends on lifecycle-status-filtered candidate lists -- passing only active events for an inactive stored id reports invalid, it does not fall through to another event", () => {
  const activeOnly = ACCESSIBLE.filter((e) => e.status === "active");

  const { event, invalidStoredContext } = resolveAdminWorkingEvent(
    activeOnly,
    { id: AMANA.id },
    null,
  );

  // This documents *why* callers must pass the full accessible set, not
  // a status-filtered list (ADR-006 §4): if a caller mistakenly filters
  // first, the resolver correctly reports the context as invalid rather
  // than substituting -- but the caller-side contract is what prevents
  // this from ever happening to a real Admin session.
  assert.equal(event, null);
  assert.equal(invalidStoredContext, true);
});

test("a deleted (no longer accessible) stored Event enters the invalid-context state, not a substitute", () => {
  const { event, invalidStoredContext } = resolveAdminWorkingEvent(
    [BRANSON, CASTLE],
    { id: AMANA.id },
    null,
  );

  assert.equal(event, null);
  assert.equal(invalidStoredContext, true);
});

test("invalid context never auto-selects accessibleEvents[0]", () => {
  const { event } = resolveAdminWorkingEvent(
    [BRANSON, CASTLE],
    { id: AMANA.id },
    null,
  );

  assert.notEqual(event, BRANSON);
  assert.equal(event, null);
});

test("invalid context never auto-selects the first active event", () => {
  const withMultipleActive = [
    { id: "zzz-active", name: "Z Active", status: "active" },
    BRANSON,
    CASTLE,
  ];

  const { event } = resolveAdminWorkingEvent(
    withMultipleActive,
    { id: AMANA.id },
    null,
  );

  assert.equal(event, null);
});

test("restoration preserves the exact stored Event ID, never a different Event with the same status", () => {
  const twoInactive = [
    AMANA,
    { id: "other-inactive", name: "Other", status: "inactive" },
  ];

  const { event } = resolveAdminWorkingEvent(
    twoInactive,
    { id: AMANA.id },
    null,
  );

  assert.equal(event?.id, AMANA.id);
});

test("initial no-context establishment is explicit and distinct from restoration: only used when nothing was ever stored", () => {
  const initialDefault = BRANSON;

  const noPriorContext = resolveAdminWorkingEvent(
    ACCESSIBLE,
    null,
    initialDefault,
  );
  assert.equal(noPriorContext.event?.id, BRANSON.id);
  assert.equal(noPriorContext.invalidStoredContext, false);

  // The same default must NOT be applied once a context has been
  // established, even if that stored id no longer resolves -- that is
  // the invalid-context case, not initial establishment, and must not
  // silently fall back to the caller's initial-establishment default.
  const priorContextNowInvalid = resolveAdminWorkingEvent(
    [BRANSON, CASTLE],
    { id: "deleted-event" },
    initialDefault,
  );
  assert.equal(priorContextNowInvalid.event, null);
  assert.equal(priorContextNowInvalid.invalidStoredContext, true);
});

test("an empty stored id (falsy) is treated as no prior context, not as an invalid stored context", () => {
  const { event, invalidStoredContext } = resolveAdminWorkingEvent(
    ACCESSIBLE,
    { id: "" },
    CASTLE,
  );

  assert.equal(event?.id, CASTLE.id);
  assert.equal(invalidStoredContext, false);
});

test("lib/adminWorkspaceContext.ts (the duplicate re-export module) has been removed -- one authoritative module resolves @/lib/adminWorkspaceContext", () => {
  const duplicatePath = fileURLToPath(
    new URL("./adminWorkspaceContext.ts", import.meta.url),
  );
  assert.equal(
    existsSync(duplicatePath),
    false,
    "lib/adminWorkspaceContext.ts duplicated lib/adminWorkspaceContext.tsx's exports and made module resolution ambiguous; only the .tsx module should remain",
  );
});

test("lib/getAdminEvent.ts (a fourth, independently-parsed Admin Event-context implementation) has been removed", () => {
  const retiredPath = fileURLToPath(new URL("./getAdminEvent.ts", import.meta.url));
  assert.equal(
    existsSync(retiredPath),
    false,
    "lib/getAdminEvent.ts read/wrote the same canonical storage key via its own duplicate parsing and an unused, independently-shaped setter; it must be retired now that Announcements consumes the canonical module",
  );
});
