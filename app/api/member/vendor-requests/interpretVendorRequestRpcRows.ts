// Pure interpretation of public.get_my_vendor_service_requests's raw row
// output (supabase/migrations/20260807150000_repair_governed_member_
// vendor_request_read_boundary.sql). Kept in its own module, with no
// Next.js-server-only imports, so it is directly unit-testable outside a
// live route/server context -- route.ts (which does transitively import
// "server-only" via lib/server/authenticatedUserClient.ts) only consumes
// this module's exports; it does not duplicate this logic.

export type VendorRequestRpcRow = {
  status: string;
  id: string | null;
  vendor_business_name: string | null;
  requested_service: string | null;
  guest_count: number | null;
  request_notes: string | null;
  request_status: string | null;
  created_at: string | null;
  site_number: string | null;
};

export type VendorRequestRpcOutcome =
  | { kind: "invalid_session" }
  | { kind: "protocol_violation" }
  | { kind: "resolved"; requests: VendorRequestRpcRow[] };

// Every row in one result set must carry the same, recognized status --
// the RPC's own contract only ever produces a uniform result (a single
// confirmed-zero sentinel row, or one or more resolved rows). An
// unrecognized status, or a mix of different statuses in one result, is a
// protocol violation and must fail closed rather than being guessed at.
function resolveUniformVendorRequestStatus(
  rows: VendorRequestRpcRow[],
): "resolved" | null {
  const firstStatus = rows[0]?.status;

  if (firstStatus !== "resolved") {
    return null;
  }

  return rows.every((row) => row.status === firstStatus) ? firstStatus : null;
}

// Zero raw rows is a resolver failure (never a confirmed zero); a uniform
// "resolved" status set is a governed result, with the sentinel row (id
// null) filtered out so a confirmed-zero result and a populated result
// share one representation; anything else is a protocol violation, failed
// closed rather than guessed at.
export function interpretVendorRequestRpcRows(
  rows: VendorRequestRpcRow[],
): VendorRequestRpcOutcome {
  if (rows.length === 0) {
    // get_my_vendor_service_requests always emits at least one row for a
    // resolved outcome -- including a sentinel row (status "resolved", id
    // null) for a confirmed zero -- and returns no rows at all only when
    // resolve_temporary_or_authenticated_attendee could not verify this
    // caller for this Event.
    return { kind: "invalid_session" };
  }

  const uniformStatus = resolveUniformVendorRequestStatus(rows);

  if (uniformStatus === null) {
    return { kind: "protocol_violation" };
  }

  // The confirmed-zero sentinel row (id null) never represents a real
  // request; every other row does. Filtering on id alone reproduces the
  // pre-repair `data` shape exactly (an empty array for a confirmed zero,
  // the full row set otherwise), so resolved-case consumers are
  // unaffected by this repair.
  return { kind: "resolved", requests: rows.filter((row) => row.id !== null) };
}
