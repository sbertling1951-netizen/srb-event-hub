import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { createAuthenticatedUserClient } from "@/lib/server/authenticatedUserClient";
import { resolveAuthenticatedRequest } from "@/lib/server/authenticationBoundary";
import { resolveTenantFromHeaders } from "@/lib/server/tenantResolver";

// WR-02 Stage 2: the governed Tenant boundary for member self-check-in.
// The browser can no longer call submit_member_checkin directly (its old
// signature was dropped in
// supabase/migrations/20260804130000_require_tenant_verification_in_member_checkin.sql).
// This route resolves the trusted Tenant from the request's real Host
// header -- never from anything the browser asserts -- and passes it to
// the RPC, which independently re-verifies Event -> Tenant ownership
// itself. Every other verification (Person/Attendee ownership, temporary
// event-code matching) is unchanged and still enforced entirely inside the
// database function.

type CheckinRequestBody = {
  eventId?: unknown;
  expectedAttendeeId?: unknown;
  hasArrived?: unknown;
  shareWithAttendees?: unknown;
  assignedSite?: unknown;
  eventCode?: unknown;
  registrationIdentifier?: unknown;
  capabilityHash?: unknown;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// A fresh, anon-key client for the unauthenticated ("temporary" event-code)
// check-in path -- the same privilege level as the browser's own client
// when it has no session. Never persisted, never reused across requests.
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

export async function POST(request: Request) {
  let body: CheckinRequestBody = {};

  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as CheckinRequestBody;
    }
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if (
    !isUuid(body.eventId) ||
    !isUuid(body.expectedAttendeeId) ||
    typeof body.hasArrived !== "boolean" ||
    typeof body.shareWithAttendees !== "boolean"
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const assignedSite =
    typeof body.assignedSite === "string" ? body.assignedSite : "";

  const tenantResolution = await resolveTenantFromHeaders(request.headers);

  if (tenantResolution.state === "unresolved") {
    return NextResponse.json({ error: "tenant_unresolved" }, { status: 409 });
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

  const { data, error } = await supabase.rpc("submit_member_checkin", {
    p_event_id: body.eventId,
    p_expected_attendee_id: body.expectedAttendeeId,
    p_has_arrived: body.hasArrived,
    p_share_with_attendees: body.shareWithAttendees,
    p_assigned_site: assignedSite,
    p_tenant_id: tenantResolution.tenant.id,
    p_event_code: nullableString(body.eventCode),
    p_registration_identifier:
      typeof body.capabilityHash === "string" && body.capabilityHash
        ? `__TEA_CAPABILITY__:${body.capabilityHash}`
        : nullableString(body.registrationIdentifier),
  });

  if (error) {
    return NextResponse.json({ error: "checkin_failed" }, { status: 400 });
  }

  return NextResponse.json({ data });
}
