import { createHash, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import { isMemberVisibleEventStatus } from "@/lib/eventStatus";
import {
  getIdentityClaimPublicMessage,
  type IdentityClaimPublicResult,
  parseIdentityClaimInput,
  takeIdentityClaimRateLimitSlot,
} from "@/lib/identityClaim";

// TEMPORARY DIAGNOSTIC INSTRUMENTATION (activation "already activated" not
// surfacing in the production browser). Every response from this route
// carries a `_diag` object with NON-PII signal only -- which stage was
// reached, evidence-category presence (booleans/counts, never values), the
// RPC's result string, and any RPC/route error message. Also emitted to
// the server log as `[activate-eval-diag]`. Remove once the HTTP-boundary
// mismatch is located.
type EvalDiag = {
  cid: string;
  stage:
    | "rate_limited"
    | "bad_json"
    | "invalid_input"
    | "no_admin_client"
    | "event_allowlist_reject"
    | "rpc_error"
    | "rpc_ok"
    | "route_exception";
  httpStatus: number;
  evidence: {
    firstName: boolean;
    lastName: boolean;
    email: boolean;
    phone: boolean;
    membership: boolean;
    state: boolean;
    eventCount: number;
  } | null;
  rpcResult: string | null;
  rpcRowPresent: boolean;
  sentResult: IdentityClaimPublicResult;
  error: string | null;
};

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function hashValue(value: string | null) {
  if (!value) {
    return null;
  }

  return createHash("sha256").update(value).digest("hex");
}

function getRequestIp(req: NextRequest) {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || null;
  }

  return req.headers.get("x-real-ip")?.trim() || null;
}

export async function POST(req: NextRequest) {
  const genericResult: IdentityClaimPublicResult = "UNABLE_TO_VERIFY";
  const genericMessage = getIdentityClaimPublicMessage(genericResult);
  const cid = randomUUID();

  const finish = (
    responseBody: {
      result: IdentityClaimPublicResult;
      message: string;
      attemptToken?: string | null;
      expiresAt?: string | null;
    },
    init: { status: number; headers?: Record<string, string> },
    diagPartial: Omit<EvalDiag, "cid" | "httpStatus" | "sentResult">,
  ) => {
    const diag: EvalDiag = {
      cid,
      httpStatus: init.status,
      sentResult: responseBody.result,
      ...diagPartial,
    };
    try {
      console.error("[activate-eval-diag]", JSON.stringify(diag));
    } catch {
      // logging must never break the response
    }
    return NextResponse.json({ ...responseBody, _diag: diag }, init);
  };

  try {
    const ipHash = hashValue(getRequestIp(req));
    const userAgentHash = hashValue(req.headers.get("user-agent"));
    const rateLimitKey = ipHash || userAgentHash || "anonymous";
    const rateLimit = takeIdentityClaimRateLimitSlot(rateLimitKey);

    if (!rateLimit.allowed) {
      return finish(
        { result: genericResult, message: genericMessage },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
        {
          stage: "rate_limited",
          evidence: null,
          rpcResult: null,
          rpcRowPresent: false,
          error: null,
        },
      );
    }

    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return finish(
        { result: genericResult, message: genericMessage },
        { status: 400 },
        {
          stage: "bad_json",
          evidence: null,
          rpcResult: null,
          rpcRowPresent: false,
          error: null,
        },
      );
    }

    const parsed = parseIdentityClaimInput(body);

    if (!parsed.ok) {
      return finish(
        { result: genericResult, message: genericMessage },
        { status: 400 },
        {
          stage: "invalid_input",
          evidence: null,
          rpcResult: null,
          rpcRowPresent: false,
          error: parsed.error,
        },
      );
    }

    const normalizedInput = parsed.value;
    const evidence = {
      firstName: !!normalizedInput.firstName,
      lastName: !!normalizedInput.lastName,
      email: !!normalizedInput.email,
      phone: !!normalizedInput.mobilePhone,
      membership: !!normalizedInput.membershipNumber,
      state: !!normalizedInput.homeState,
      eventCount: normalizedInput.eventIds.length,
    };

    const supabaseAdmin = getSupabaseAdmin();

    if (!supabaseAdmin) {
      return finish(
        { result: genericResult, message: genericMessage },
        { status: 500 },
        {
          stage: "no_admin_client",
          evidence,
          rpcResult: null,
          rpcRowPresent: false,
          error: null,
        },
      );
    }

    if (normalizedInput.eventIds.length > 0) {
      const { data: allowedEvents, error: eventError } = await supabaseAdmin
        .from("events")
        .select("id,status,is_active,visible_to_members")
        .in("id", normalizedInput.eventIds);

      if (eventError) {
        throw eventError;
      }

      const allowedEventIds = new Set(
        (allowedEvents || [])
          .filter(
            (event) =>
              event.visible_to_members === true &&
              event.is_active !== false &&
              isMemberVisibleEventStatus(event.status),
          )
          .map((event) => event.id),
      );

      if (allowedEventIds.size !== normalizedInput.eventIds.length) {
        return finish(
          { result: genericResult, message: genericMessage },
          { status: 400 },
          {
            stage: "event_allowlist_reject",
            evidence,
            rpcResult: null,
            rpcRowPresent: false,
            error: null,
          },
        );
      }
    }

    const { data, error } = await supabaseAdmin.rpc(
      "evaluate_member_identity_claim",
      {
        p_first_name: normalizedInput.firstName,
        p_last_name: normalizedInput.lastName,
        p_home_state: normalizedInput.homeState,
        p_email: normalizedInput.email,
        p_phone: normalizedInput.mobilePhone,
        p_membership_number: normalizedInput.membershipNumber,
        p_event_ids: normalizedInput.eventIds,
        p_request_ip_hash: ipHash,
        p_user_agent_hash: userAgentHash,
        p_request_source: "member_activation_api",
      },
    );

    if (error) {
      return finish(
        { result: genericResult, message: genericMessage },
        { status: 502 },
        {
          stage: "rpc_error",
          evidence,
          rpcResult: null,
          rpcRowPresent: false,
          error: String(error.message || error.code || "rpc_error"),
        },
      );
    }

    const attempt = Array.isArray(data) ? data[0] : null;

    // The RPC's public_result_classification is already constrained to the
    // valid set by a CHECK constraint on identity_claim_attempts, so pass
    // any non-empty string straight through. The previous hard-coded
    // allowlist here had to be updated in lockstep with every new
    // classification (CONTINUE_VERIFICATION, ALREADY_ACTIVATED, ...); a
    // version skew between this route and the database silently coerced an
    // unrecognized-but-valid result (e.g. ALREADY_ACTIVATED) to
    // UNABLE_TO_VERIFY, stranding the caller with a misleading message.
    // getIdentityClaimPublicMessage() still falls back to the generic
    // message for anything it does not recognize.
    const rawClassification = attempt?.public_result_classification;
    const publicResult: IdentityClaimPublicResult =
      typeof rawClassification === "string" && rawClassification.length > 0
        ? (rawClassification as IdentityClaimPublicResult)
        : genericResult;

    return finish(
      {
        result: publicResult,
        message: getIdentityClaimPublicMessage(publicResult),
        attemptToken:
          typeof attempt?.public_attempt_token === "string"
            ? attempt.public_attempt_token
            : null,
        expiresAt:
          typeof attempt?.expires_at === "string" ? attempt.expires_at : null,
      },
      { status: 200 },
      {
        stage: "rpc_ok",
        evidence,
        rpcResult:
          typeof rawClassification === "string" ? rawClassification : null,
        rpcRowPresent: !!attempt,
        error: null,
      },
    );
  } catch (err) {
    return finish(
      { result: genericResult, message: genericMessage },
      { status: 500 },
      {
        stage: "route_exception",
        evidence: null,
        rpcResult: null,
        rpcRowPresent: false,
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }
}
