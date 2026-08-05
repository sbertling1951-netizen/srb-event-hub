import { NextResponse } from "next/server";

import { createAuthenticatedUserClient } from "@/lib/server/authenticatedUserClient";
import { resolveAuthenticatedRequest } from "@/lib/server/authenticationBoundary";
import { resolveTenantFromHeaders } from "@/lib/server/tenantResolver";

// Vendor Requests Stage 1: the governed boundary for member-submitted
// Vendor Requests. The browser can no longer INSERT or UPDATE
// public.vendor_service_requests directly; it now supplies only
// operational selections here, and the server resolves the trusted Tenant
// (never a browser claim) before calling the governed RPC, which
// independently re-derives Person, Event/Tenant consistency, Participation
// eligibility, Vendor Organization participation, and request ownership
// itself. This mirrors the pattern already accepted for member check-in
// (WR-02 Stage 2, app/api/member/checkin/route.ts).
//
// Unlike check-in, there is no unauthenticated ("temporary") path here:
// both member pages that reach this route are already gated behind
// MemberRouteGuard, so an authenticated session is always required.

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  return null;
}

type SubmitRequestBody = {
  eventId?: unknown;
  vendorId?: unknown;
  serviceId?: unknown;
  requestedService?: unknown;
  requestNotes?: unknown;
  guestCount?: unknown;
  siteNumber?: unknown;
  preferredResponseMethod?: unknown;
  requesterName?: unknown;
  requesterEmail?: unknown;
  requesterPhone?: unknown;
};

type StatusChangeBody = {
  requestId?: unknown;
  nextStatus?: unknown;
};

async function resolveAuthenticatedClient(request: Request) {
  const tenantResolution = await resolveTenantFromHeaders(request.headers);

  if (tenantResolution.state === "unresolved") {
    return {
      errorResponse: NextResponse.json(
        { error: "tenant_unresolved" },
        { status: 409 },
      ),
    };
  }

  const authResolution = await resolveAuthenticatedRequest(request.headers);

  if (authResolution.state === "internal_error") {
    return {
      errorResponse: NextResponse.json(
        { error: "internal_error" },
        { status: 500 },
      ),
    };
  }

  if (authResolution.state === "unauthenticated") {
    return {
      errorResponse: NextResponse.json(
        { error: "unauthenticated" },
        { status: 401 },
      ),
    };
  }

  const supabase = createAuthenticatedUserClient(authResolution.credential);

  if (!supabase) {
    return {
      errorResponse: NextResponse.json(
        { error: "internal_error" },
        { status: 500 },
      ),
    };
  }

  return { supabase, tenantId: tenantResolution.tenant.id };
}

export async function POST(request: Request) {
  let body: SubmitRequestBody = {};

  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as SubmitRequestBody;
    }
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if (!isUuid(body.eventId) || !isUuid(body.vendorId)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const serviceId = isUuid(body.serviceId) ? body.serviceId : null;

  const resolved = await resolveAuthenticatedClient(request);
  if (resolved.errorResponse) {
    return resolved.errorResponse;
  }
  const { supabase, tenantId } = resolved;

  const { data, error } = await supabase.rpc(
    "submit_my_vendor_service_request",
    {
      p_tenant_id: tenantId,
      p_event_id: body.eventId,
      p_vendor_id: body.vendorId,
      p_service_id: serviceId,
      p_requested_service: nullableString(body.requestedService),
      p_request_notes: nullableString(body.requestNotes),
      p_guest_count: nullableInteger(body.guestCount),
      p_site_number: nullableString(body.siteNumber),
      p_preferred_response_method: nullableString(body.preferredResponseMethod),
      p_requester_name: nullableString(body.requesterName),
      p_requester_email: nullableString(body.requesterEmail),
      p_requester_phone: nullableString(body.requesterPhone),
    },
  );

  if (error) {
    return NextResponse.json(
      { error: "vendor_request_submission_failed" },
      { status: 400 },
    );
  }

  return NextResponse.json({ data });
}

export async function PATCH(request: Request) {
  let body: StatusChangeBody = {};

  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as StatusChangeBody;
    }
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if (
    !isUuid(body.requestId) ||
    (body.nextStatus !== "cancelled" && body.nextStatus !== "new")
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const resolved = await resolveAuthenticatedClient(request);
  if (resolved.errorResponse) {
    return resolved.errorResponse;
  }
  const { supabase, tenantId } = resolved;

  const { data, error } = await supabase.rpc(
    "set_my_vendor_service_request_status",
    {
      p_tenant_id: tenantId,
      p_request_id: body.requestId,
      p_next_status: body.nextStatus,
    },
  );

  if (error) {
    return NextResponse.json(
      { error: "vendor_request_status_change_failed" },
      { status: 400 },
    );
  }

  return NextResponse.json({ data });
}
