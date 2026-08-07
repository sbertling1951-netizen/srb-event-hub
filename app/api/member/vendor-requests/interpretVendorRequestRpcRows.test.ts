import assert from "node:assert/strict";
import { test } from "node:test";

import {
  interpretVendorRequestRpcRows,
  type VendorRequestRpcRow,
} from "@/app/api/member/vendor-requests/interpretVendorRequestRpcRows";

// Focused tests for the governed member Vendor Requests read-boundary
// repair (20260807150000_repair_governed_member_vendor_request_read_
// boundary.sql). See docs/architecture/EPICENTRAX_MEMBER_ASSIGNMENT_READ_
// BOUNDARY_ARCHITECTURE.md and docs/architecture/EPICENTRAX_INTELLIGENCE_
// COLLECTOR_ARCHITECTURE.md.
//
// These exercise interpretVendorRequestRpcRows directly -- the pure,
// I/O-free interpretation of the RPC's raw row output -- rather than
// route.ts's exported GET handler, which transitively imports
// "server-only" (via lib/server/authenticatedUserClient.ts) and requires
// a live Supabase/fetch call. Run with:
//   npx tsx --test app/api/member/vendor-requests/interpretVendorRequestRpcRows.test.ts

function resolvedRow(overrides: Partial<VendorRequestRpcRow> = {}): VendorRequestRpcRow {
  return {
    status: "resolved",
    id: "11111111-1111-1111-1111-111111111111",
    vendor_business_name: "Acme Vendor",
    requested_service: "Site cleanup",
    guest_count: 2,
    request_notes: null,
    request_status: "new",
    created_at: "2026-08-07T12:00:00.000Z",
    site_number: "A12",
    ...overrides,
  };
}

function sentinelRow(): VendorRequestRpcRow {
  return {
    status: "resolved",
    id: null,
    vendor_business_name: null,
    requested_service: null,
    guest_count: null,
    request_notes: null,
    request_status: null,
    created_at: null,
    site_number: null,
  };
}

test("unresolved identity (zero raw rows) is invalid_session, never a confirmed zero", () => {
  const outcome = interpretVendorRequestRpcRows([]);

  assert.equal(outcome.kind, "invalid_session");
});

test("resolved attendee with zero vendor requests remains a successful confirmed-zero result", () => {
  const outcome = interpretVendorRequestRpcRows([sentinelRow()]);

  assert.equal(outcome.kind, "resolved");
  if (outcome.kind === "resolved") {
    assert.deepEqual(outcome.requests, []);
  }
});

test("resolved attendee with rows preserves those rows exactly", () => {
  const rowA = resolvedRow({ id: "11111111-1111-1111-1111-111111111111" });
  const rowB = resolvedRow({
    id: "22222222-2222-2222-2222-222222222222",
    request_status: "completed",
  });

  const outcome = interpretVendorRequestRpcRows([rowA, rowB]);

  assert.equal(outcome.kind, "resolved");
  if (outcome.kind === "resolved") {
    assert.equal(outcome.requests.length, 2);
    assert.deepEqual(outcome.requests, [rowA, rowB]);
  }
});

test("a mixed status set fails closed as a protocol violation, never guessed at", () => {
  const outcome = interpretVendorRequestRpcRows([
    resolvedRow(),
    { ...resolvedRow(), status: "identity_unavailable" },
  ]);

  assert.equal(outcome.kind, "protocol_violation");
});

test("an unrecognized status fails closed as a protocol violation", () => {
  const outcome = interpretVendorRequestRpcRows([
    { ...resolvedRow(), status: "something_unexpected" },
  ]);

  assert.equal(outcome.kind, "protocol_violation");
});

test("no authorization broadening: interpretation never inspects or widens ownership -- it only classifies rows the RPC already scoped to the caller", () => {
  // This is a structural guarantee, not a behavioral one to assert at
  // runtime: interpretVendorRequestRpcRows takes only the RPC's own
  // output and returns a classification of it. It has no access to any
  // identifier that could be used to broaden a query (no eventId,
  // personId, or tenantId parameter exists on its signature), so it
  // cannot introduce a cross-Person or cross-Event leak regardless of its
  // input.
  const outcome = interpretVendorRequestRpcRows([resolvedRow()]);
  assert.equal(outcome.kind, "resolved");
});
