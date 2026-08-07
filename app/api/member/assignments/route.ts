import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { createAuthenticatedUserClient } from "@/lib/server/authenticatedUserClient";
import { resolveAuthenticatedRequest } from "@/lib/server/authenticationBoundary";

// Governed read for "my active Assignments" (per
// docs/architecture/EPICENTRAX_MEMBER_ASSIGNMENT_READ_BOUNDARY_ARCHITECTURE.md).
//
// This route performs no Person resolution and no Assignment
// authorization itself. It only selects the Supabase client -- the
// caller's bearer token when present, a fresh anon-key client otherwise,
// mirroring app/api/member/vendor-requests/route.ts's GET -- and calls
// the governed RPC, which independently re-derives identity, Event-scoped
// Participation, Tenant, and Assignment ownership
// (20260807140000_create_governed_member_assignment_read.sql). The RPC's
// four possible outcomes (resolved / identity_unavailable /
// invalid_session / transient_error) are surfaced as an explicit
// `status` field on every response, never collapsed into a bare array
// that could make "identity unavailable" indistinguishable from a
// confirmed zero.

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function nullableQueryString(value: string | null): string | null {
  return value && value.trim() !== "" ? value : null;
}

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

type AssignmentRpcRow = {
  status: string;
  id: string | null;
  responsibility_label: string | null;
  attributed_at: string | null;
};

type AssignmentSummary = {
  id: string;
  responsibilityLabel: string;
  attributedAt: string;
};

function transientErrorResponse() {
  return NextResponse.json({ status: "transient_error" as const }, { status: 500 });
}

function invalidSessionResponse() {
  return NextResponse.json({ status: "invalid_session" as const }, { status: 400 });
}

// Every row in one result set must carry the same, recognized status --
// the RPC's own contract only ever produces a uniform result (a single
// identity_unavailable row, a single resolved sentinel row, or one or
// more resolved rows; see
// 20260807140000_create_governed_member_assignment_read.sql). An
// unrecognized status, or a mix of different statuses in one result, is
// a protocol violation and must fail closed rather than being guessed at
// -- in particular, it must never be treated as "resolved" merely
// because it isn't "identity_unavailable".
function resolveUniformAssignmentStatus(
  rows: AssignmentRpcRow[],
): "resolved" | "identity_unavailable" | null {
  const firstStatus = rows[0]?.status;

  if (firstStatus !== "resolved" && firstStatus !== "identity_unavailable") {
    return null;
  }

  if (!rows.every((row) => row.status === firstStatus)) {
    return null;
  }

  return firstStatus;
}

function toAssignmentSummaries(rows: AssignmentRpcRow[]): AssignmentSummary[] {
  const summaries: AssignmentSummary[] = [];

  for (const row of rows) {
    if (row.status !== "resolved") {
      continue;
    }
    if (!row.id || !row.responsibility_label || !row.attributed_at) {
      continue;
    }

    summaries.push({
      id: row.id,
      responsibilityLabel: row.responsibility_label,
      attributedAt: row.attributed_at,
    });
  }

  return summaries;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const eventId = url.searchParams.get("eventId");
  const eventCode = url.searchParams.get("eventCode");
  const registrationIdentifier = url.searchParams.get(
    "registrationIdentifier",
  );

  if (!isUuid(eventId)) {
    return invalidSessionResponse();
  }

  const authResolution = await resolveAuthenticatedRequest(request.headers);

  if (authResolution.state === "internal_error") {
    return transientErrorResponse();
  }

  const supabase =
    authResolution.state === "authenticated"
      ? createAuthenticatedUserClient(authResolution.credential)
      : createAnonMemberClient();

  if (!supabase) {
    return transientErrorResponse();
  }

  const rpcArgs = {
    p_event_id: eventId,
    p_event_code: nullableQueryString(eventCode),
    p_registration_identifier: nullableQueryString(registrationIdentifier),
  };

  const { data, error } = await supabase.rpc("get_my_active_assignments", rpcArgs);

  if (error) {
    console.error("get_my_active_assignments failed:", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return transientErrorResponse();
  }

  const rows = (data ?? []) as AssignmentRpcRow[];

  if (rows.length === 0) {
    // get_my_active_assignments always emits at least one row for both
    // resolved outcomes -- including a sentinel row (status "resolved",
    // id null) for a confirmed zero -- and for identity_unavailable (see
    // 20260807140000_create_governed_member_assignment_read.sql). Zero
    // rows here can therefore only mean
    // resolve_temporary_or_authenticated_attendee could not verify this
    // caller for this Event. This route does not re-verify identity
    // itself -- that would duplicate resolution the RPC already owns.
    return invalidSessionResponse();
  }

  const uniformStatus = resolveUniformAssignmentStatus(rows);

  if (uniformStatus === null) {
    // Fail closed: an unrecognized or mixed status set is a protocol
    // violation between this route and the RPC, not an ordinary outcome.
    // Never expose the raw status value(s) or any database detail to the
    // caller.
    console.error(
      "get_my_active_assignments returned an unrecognized or mixed status set:",
      { statuses: rows.map((row) => row.status) },
    );
    return transientErrorResponse();
  }

  if (uniformStatus === "identity_unavailable") {
    return NextResponse.json({ status: "identity_unavailable" as const });
  }

  return NextResponse.json({
    status: "resolved" as const,
    assignments: toAssignmentSummaries(rows),
  });
}
