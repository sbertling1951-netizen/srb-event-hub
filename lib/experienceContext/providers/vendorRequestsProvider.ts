import type { ExperienceContextProvider } from "@/lib/experienceContext/providers/types";
import type { SharedExperienceContext } from "@/lib/experienceContext/types";
import { supabase } from "@/lib/supabase";

// This Provider owns exactly the "vendorRequests" Shared Context Pool
// slice. See docs/architecture/EPICENTRAX_INTELLIGENCE_COLLECTOR_
// ARCHITECTURE.md ("Deduplication", "Evidence Quality Classification",
// "Freshness").
//
// Complete authoritative read path: this Provider calls
// GET /api/member/vendor-requests (app/api/member/vendor-requests/route.ts),
// which calls the governed RPC public.get_my_vendor_service_requests
// (supabase/migrations/20260807120000_create_governed_member_vendor_
// request_read.sql, repaired by
// 20260807150000_repair_governed_member_vendor_request_read_boundary.sql).
// That RPC is the governed read boundary: it independently re-derives the
// caller's verified attendee identity via the shared resolver
// resolve_temporary_or_authenticated_attendee, then selects only
// vendor_service_requests rows owned by that identity for the given event.
// This Provider already consumed that boundary correctly before this pass
// -- it calls the API route, never the RPC or the vendor_service_requests
// table directly. This pass only adds the governed slice metadata below;
// it does not change, improve, or bypass the boundary itself, and performs
// no Person, Tenant, Workspace, Relationship, Participation, Assignment,
// or Authority resolution, and no vendor-affiliation, ownership, or
// request-eligibility inference of its own -- it reports only the
// request_status value the authoritative source already returns,
// unmodified.
//
// Special governed-incomplete state: none is needed, and none is added.
// Unlike assignments' identity_unavailable (a second-stage gap: a verified
// attendee whose bridged person_id is null), vendor requests are owned
// directly by attendee_id -- the exact identity
// resolve_temporary_or_authenticated_attendee itself verifies. There is no
// second, separately-nullable identity fact here for a "partial" case to
// describe. Following the boundary repair, the route now distinguishes a
// resolver failure (`invalid_session`, non-2xx -- this Provider's fetch
// throws, so the Collector's existing generic per-provider isolation
// reports the canonical "unavailable" default, exactly as any other
// Provider failure) from a resolved result, `status: "resolved"` with a
// `data` array (empty for a governed-confirmed zero, populated otherwise)
// -- always reported "governed" here, since reaching this branch already
// means the read succeeded.
//
// Deduplication: not applicable, and not implemented.
// public.vendor_service_requests has `id uuid PRIMARY KEY` (see
// 20260617000000_create_pre_20260618_public_baseline.sql), so the
// authoritative array this Provider receives can never contain two rows
// representing the same request fact under different identities. This
// Provider performs no grouping or merging of its own -- openCount is a
// direct filter-and-count over the array the governed boundary already
// returned.

type VendorRequestRow = {
  request_status: string | null;
};

const CLOSED_VENDOR_REQUEST_STATUSES = new Set(["completed", "cancelled"]);

function countOpenVendorRequests(rows: VendorRequestRow[]): number {
  return rows.filter(
    (row) => !CLOSED_VENDOR_REQUEST_STATUSES.has(row.request_status || "new"),
  ).length;
}

// Pure: no I/O. Normalizes an already-fetched, already-governed API
// response into the Pool's slice shape.
export function buildVendorRequestsSlice(
  rows: VendorRequestRow[],
  now: Date,
): SharedExperienceContext["vendorRequests"] {
  return {
    // Preserves the authoritative result exactly -- a straight filter and
    // count over rows the governed boundary already returned, using only
    // the request_status value it already provides. No inference of
    // which requests count beyond that.
    openCount: countOpenVendorRequests(rows),
    // Reaching this point means the read succeeded (including a
    // legitimately empty array -- see the module comment on why this
    // boundary cannot separately signal an unresolved identity).
    evidenceQuality: "governed",
    // See Freshness: the moment this result was actually observed.
    // Always sourced from the caller-supplied `now`, never a fresh
    // wall-clock read here. No staleness threshold is computed from it.
    observedAt: now.toISOString(),
  };
}

async function collectVendorRequestsSlice(
  eventId: string,
  eventCode: string | null,
  registrationIdentifier: string | null,
  now: Date,
): Promise<SharedExperienceContext["vendorRequests"]> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  const params = new URLSearchParams({ eventId });
  if (eventCode) {
    params.set("eventCode", eventCode);
  }
  if (registrationIdentifier) {
    params.set("registrationIdentifier", registrationIdentifier);
  }

  const response = await fetch(
    `/api/member/vendor-requests?${params.toString()}`,
    accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : undefined,
  );

  if (!response.ok) {
    // Covers both invalid_session (resolver failure) and transient_error
    // -- the route's non-2xx status already distinguishes both from a
    // resolved result; this Provider does not need to inspect the body to
    // know collection did not succeed. Throwing here lets the Collector's
    // existing generic per-provider isolation apply the canonical
    // unavailable default, exactly as for any other Provider failure.
    throw new Error(`vendor requests read failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    status?: string;
    data?: VendorRequestRow[];
  };

  if (payload.status !== "resolved") {
    // Fail closed: a 2xx response that isn't the recognized "resolved"
    // shape is a protocol violation between this Provider and the route,
    // not an ordinary outcome -- never guessed at or treated as a
    // confirmed zero.
    throw new Error(
      `vendor requests read returned unexpected status: ${payload.status}`,
    );
  }

  return buildVendorRequestsSlice(payload.data ?? [], now);
}

export const vendorRequestsExperienceContextProvider: ExperienceContextProvider<"vendorRequests"> =
  {
    name: "vendorRequests",
    key: "vendorRequests",
    async collect(input) {
      return {
        vendorRequests: await collectVendorRequestsSlice(
          input.event.id,
          input.eventCode,
          input.registrationIdentifier,
          input.now,
        ),
      };
    },
  };
