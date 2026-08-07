import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { createAuthenticatedUserClient } from "@/lib/server/authenticatedUserClient";
import { resolveAuthenticatedRequest } from "@/lib/server/authenticationBoundary";
import { resolveTenantFromHeaders } from "@/lib/server/tenantResolver";

// Vendor Requests Stage 1: the governed boundary for member-submitted
// Vendor Requests. The browser can no longer INSERT or UPDATE
// public.vendor_service_requests directly; it now supplies only
// operational selections here, and the server resolves the trusted Tenant
// (never a browser claim) before calling the governed RPC, which
// independently re-derives Person or attendee identity, Event/Tenant
// consistency, Participation eligibility, Vendor Organization
// participation, and request ownership itself. This mirrors the pattern
// already accepted for member check-in (WR-02 Stage 2,
// app/api/member/checkin/route.ts).
//
// Stage 1 follow-up (20260807130000_extend_governed_member_vendor_request_write_boundary.sql):
// a Supabase Auth session is not required. MemberRouteGuard explicitly
// admits the supported event-code member path, which never establishes one
// -- POST and PATCH now use the same authenticated-or-anonymous client
// selection as GET, and the underlying RPCs independently re-verify the
// caller through the same shared resolver
// (resolve_temporary_or_authenticated_attendee) the read already uses.

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

function nullableQueryString(value: string | null): string | null {
  return value && value.trim() !== "" ? value : null;
}

// A fresh, anon-key client for the unauthenticated ("temporary" event-code)
// read path -- the same privilege level as the browser's own client when it
// has no session. Never persisted, never reused across requests. Mirrors
// app/api/member/checkin/route.ts's identical helper.
function createAnonMemberClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return null;
  }

  return createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
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
  eventCode?: unknown;
  registrationIdentifier?: unknown;
};

type StatusChangeBody = {
  requestId?: unknown;
  nextStatus?: unknown;
  eventId?: unknown;
  eventCode?: unknown;
  registrationIdentifier?: unknown;
};

// Resolves the trusted Tenant (never a browser claim) and picks the client
// the underlying RPC should run as. A Supabase Auth session is preferred
// when present (the RPC records Person attribution from it), but is never
// required: the supported event-code member path never establishes one, so
// an absent/invalid bearer token falls through to a fresh anon-key client,
// exactly as GET already does below.
async function resolveMemberClient(request: Request) {
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

  const supabase =
    authResolution.state === "authenticated"
      ? createAuthenticatedUserClient(authResolution.credential)
      : createAnonMemberClient();

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

  const resolved = await resolveMemberClient(request);
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
      p_event_code: nullableString(body.eventCode),
      p_registration_identifier: nullableString(body.registrationIdentifier),
    },
  );

  if (error) {
    console.error("submit_my_vendor_service_request failed:", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
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
    !isUuid(body.eventId) ||
    (body.nextStatus !== "cancelled" && body.nextStatus !== "new")
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const resolved = await resolveMemberClient(request);
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
      p_event_id: body.eventId,
      p_event_code: nullableString(body.eventCode),
      p_registration_identifier: nullableString(body.registrationIdentifier),
    },
  );

  if (error) {
    console.error("set_my_vendor_service_request_status failed:", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return NextResponse.json(
      { error: "vendor_request_status_change_failed" },
      { status: 400 },
    );
  }

  return NextResponse.json({ data });
}

// Governed read for "my vendor requests" (Vendor Requests Stage 1 follow-up:
// see 20260807120000_create_governed_member_vendor_request_read.sql).
//
// Unlike POST/PATCH above, this never assumes a Supabase Auth session
// exists: the supported member entry path is event-code/registration-
// identifier evidence, verified entirely inside the governed RPC via the
// same shared resolver get_my_attendee_record already uses. When a bearer
// token is present it is still forwarded, so a genuinely authenticated
// member resolves through auth.uid() exactly as the write RPCs do; when it
// is absent, the request falls through to the anon-key client and the
// event-code/registration-identifier branch, mirroring
// app/api/member/checkin/route.ts's dual-path pattern.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const eventId = url.searchParams.get("eventId");
  const eventCode = url.searchParams.get("eventCode");
  const registrationIdentifier = url.searchParams.get(
    "registrationIdentifier",
  );

  if (!isUuid(eventId)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const authResolution = await resolveAuthenticatedRequest(request.headers);

  if (authResolution.state === "internal_error") {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  const supabase =
    authResolution.state === "authenticated"
      ? createAuthenticatedUserClient(authResolution.credential)
      : createAnonMemberClient();

  if (!supabase) {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  const { data, error } = await supabase.rpc(
    "get_my_vendor_service_requests",
    {
      p_event_id: eventId,
      p_event_code: nullableQueryString(eventCode),
      p_registration_identifier: nullableQueryString(registrationIdentifier),
    },
  );

  if (error) {
    // Structured, not the bare error object -- a PostgrestError's message
    // is inherited via Error's constructor and is non-enumerable, so
    // logging the object alone can render as "{}" in some consoles/log
    // pipelines. Logging the fields explicitly keeps them visible.
    console.error("get_my_vendor_service_requests failed:", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return NextResponse.json(
      { error: "vendor_request_read_failed" },
      { status: 400 },
    );
  }

  return NextResponse.json({ data: data ?? [] });
}
