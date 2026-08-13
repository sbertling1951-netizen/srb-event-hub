import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isActiveEventStatus,
  isMemberVisibleEvent,
  isMemberVisibleEventStatus,
  normalizeEventStatus,
} from "./eventStatus";

// Lifecycle Stage 2 helper consolidation (ADR-013 §12 stage 5). These
// helpers govern legacy status/is_active/visible_to_members presentation
// logic (ADR-006 §4) only -- not Event Lifecycle. Run with:
//   npx tsx --test lib/eventStatus.test.ts

test("normalizeEventStatus: trims, lowercases, and treats null/undefined/empty as an empty string", () => {
  assert.equal(normalizeEventStatus("  Active  "), "active");
  assert.equal(normalizeEventStatus("DRAFT"), "draft");
  assert.equal(normalizeEventStatus(null), "");
  assert.equal(normalizeEventStatus(undefined), "");
  assert.equal(normalizeEventStatus(""), "");
});

test("isActiveEventStatus: recognizes the positive allowlist, case/whitespace-insensitively", () => {
  assert.equal(isActiveEventStatus("Active"), true);
  assert.equal(isActiveEventStatus(" live "), true);
  assert.equal(isActiveEventStatus("Open"), true);
  assert.equal(isActiveEventStatus("current"), true);
  assert.equal(isActiveEventStatus("Registration Active"), true, "substring match on 'active'");
});

test("isActiveEventStatus: rejects the negative list and empty/null status", () => {
  for (const status of ["inactive", "complete", "completed", "closed", "archived"]) {
    assert.equal(isActiveEventStatus(status), false, `expected '${status}' to be inactive`);
  }
  assert.equal(isActiveEventStatus(null), false);
  assert.equal(isActiveEventStatus(undefined), false);
  assert.equal(isActiveEventStatus(""), false);
});

test("isActiveEventStatus: Draft is not active", () => {
  assert.equal(isActiveEventStatus("Draft"), false);
  assert.equal(isActiveEventStatus("draft"), false);
});

test("isActiveEventStatus: an unrecognized custom status is not active (positive allowlist, not a denylist)", () => {
  assert.equal(isActiveEventStatus("Pending Review"), false);
});

test("isMemberVisibleEventStatus: visible unless the status matches a known excluded keyword", () => {
  for (const status of ["inactive", "archived", "complete", "completed", "closed", "draft"]) {
    assert.equal(isMemberVisibleEventStatus(status), false, `expected '${status}' to be hidden`);
  }
  assert.equal(isMemberVisibleEventStatus("Active"), true);
  assert.equal(isMemberVisibleEventStatus(null), true, "empty/unknown status is visible by default (denylist, not allowlist)");
});

test("isMemberVisibleEvent: delegates to isMemberVisibleEventStatus for the status portion", () => {
  assert.equal(
    isMemberVisibleEvent({ status: "Active", is_active: true, visible_to_members: true }),
    true,
  );
  assert.equal(
    isMemberVisibleEvent({ status: "Draft", is_active: true, visible_to_members: true }),
    false,
    "Draft must be hidden via the shared status predicate",
  );
});

test("isMemberVisibleEvent: visible_to_members === false short-circuits to hidden regardless of status", () => {
  assert.equal(
    isMemberVisibleEvent({ status: "Active", is_active: true, visible_to_members: false }),
    false,
  );
});

test("isMemberVisibleEvent: is_active === false short-circuits to hidden regardless of status", () => {
  assert.equal(
    isMemberVisibleEvent({ status: "Active", is_active: false, visible_to_members: true }),
    false,
  );
});

test("isMemberVisibleEvent: undefined visible_to_members/is_active do not hide the Event (only strict false does)", () => {
  assert.equal(isMemberVisibleEvent({ status: "Active" }), true);
});

test("Admin and Member status predicates remain intentionally distinct -- an unrecognized custom status diverges by design", () => {
  const customStatus = "Pending Review";
  assert.equal(
    isActiveEventStatus(customStatus),
    false,
    "admin allowlist: unrecognized status is NOT active",
  );
  assert.equal(
    isMemberVisibleEventStatus(customStatus),
    true,
    "member denylist: unrecognized status IS visible",
  );
});
