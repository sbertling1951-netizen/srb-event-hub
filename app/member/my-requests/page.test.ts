import assert from "node:assert/strict";
import { test } from "node:test";

import { toRequestRow } from "@/app/member/my-requests/page";

// Focused test for the governed-boundary audit/refactor of
// app/member/my-requests/page.tsx: the page previously read
// public.vendor_service_requests directly, filtered by a client-supplied
// requester_email, bypassing GET /api/member/vendor-requests entirely.
// This exercises the pure mapping this refactor introduced --
// normalizing the governed API's flat row shape into this page's existing
// render-facing RequestRow shape -- so the JSX (which reads
// request.vendors?.business_name) required no change. Run with:
//   npx tsx --test app/member/my-requests/page.test.ts

test("toRequestRow maps the governed API's flat vendor_business_name into the render-facing nested vendors shape", () => {
  const row = toRequestRow({
    id: "11111111-1111-1111-1111-111111111111",
    vendor_business_name: "Acme Vendor",
    requested_service: "Site cleanup",
    guest_count: 2,
    request_notes: "Please arrive early",
    request_status: "new",
    created_at: "2026-08-07T12:00:00.000Z",
    site_number: "A12",
  });

  assert.equal(row.id, "11111111-1111-1111-1111-111111111111");
  assert.deepEqual(row.vendors, { business_name: "Acme Vendor" });
  assert.equal(row.requested_service, "Site cleanup");
  assert.equal(row.guest_count, 2);
  assert.equal(row.request_notes, "Please arrive early");
  assert.equal(row.request_status, "new");
  assert.equal(row.created_at, "2026-08-07T12:00:00.000Z");
  assert.equal(row.site_number, "A12");
});

test("toRequestRow preserves a null vendor_business_name rather than fabricating a fallback", () => {
  const row = toRequestRow({
    id: "22222222-2222-2222-2222-222222222222",
    vendor_business_name: null,
    requested_service: null,
    guest_count: null,
    request_notes: null,
    request_status: null,
    created_at: null,
    site_number: null,
  });

  assert.deepEqual(row.vendors, { business_name: null });
});
