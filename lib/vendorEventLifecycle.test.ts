import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deriveVendorEventDisplayStatus,
  getAvailableVendorEventActions,
} from "@/lib/vendorEventLifecycle";

// Focused tests for the Stage 4 Admin Vendor workflow's shared display
// logic. Run with:
//   npx tsx --test lib/vendorEventLifecycle.test.ts

// --- deriveVendorEventDisplayStatus: the admitted-vs-revoked invariant ---

test("no candidacy row at all renders as not_considered", () => {
  assert.equal(deriveVendorEventDisplayStatus(null, null), "not_considered");
});

test("a pending candidacy with no participation state renders as pending", () => {
  assert.equal(deriveVendorEventDisplayStatus("pending", null), "pending");
});

test("an admitted candidacy that is still currently admitted renders as admitted", () => {
  assert.equal(deriveVendorEventDisplayStatus("admitted", "admitted"), "admitted");
});

test("a rejected candidacy renders as rejected regardless of participation state", () => {
  assert.equal(deriveVendorEventDisplayStatus("rejected", null), "rejected");
});

test("a withdrawn candidacy renders as withdrawn", () => {
  assert.equal(deriveVendorEventDisplayStatus("withdrawn", null), "withdrawn");
});

test("an admitted-then-revoked candidacy renders as revoked, not admitted -- current participation wins", () => {
  assert.equal(deriveVendorEventDisplayStatus("admitted", "revoked"), "revoked");
});

test("current participation state can never resurrect a rejected/withdrawn candidacy into admitted", () => {
  // Defensive case: even if a caller somehow passed a non-admitted
  // historical status alongside a stale "admitted" participation flag,
  // only an explicit "revoked" participation state overrides the
  // historical outcome -- the function never invents an "admitted"
  // display state that the candidacy's own history doesn't support.
  assert.equal(deriveVendorEventDisplayStatus("rejected", "admitted"), "rejected");
});

// --- getAvailableVendorEventActions: catalog reuse + reconsideration ---

test("not_considered offers both catalog-reuse paths: register a candidacy, or admit outright", () => {
  assert.deepEqual(getAvailableVendorEventActions("not_considered"), ["consider", "admit"]);
});

test("pending offers admit and reject only -- no revoke, nothing is currently admitted yet", () => {
  assert.deepEqual(getAvailableVendorEventActions("pending"), ["admit", "reject"]);
});

test("admitted offers revoke only -- no re-admit, no reject of an active admission", () => {
  assert.deepEqual(getAvailableVendorEventActions("admitted"), ["revoke"]);
});

test("rejected, revoked, and withdrawn all offer reconsideration via admit, and nothing else", () => {
  assert.deepEqual(getAvailableVendorEventActions("rejected"), ["reconsider"]);
  assert.deepEqual(getAvailableVendorEventActions("revoked"), ["reconsider"]);
  assert.deepEqual(getAvailableVendorEventActions("withdrawn"), ["reconsider"]);
});
