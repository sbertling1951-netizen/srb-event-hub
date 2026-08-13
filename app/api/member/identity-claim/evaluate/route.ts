import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import { isMemberVisibleEventStatus } from "@/lib/eventStatus";
import {
  getIdentityClaimPublicMessage,
  type IdentityClaimPublicResult,
  parseIdentityClaimInput,
  takeIdentityClaimRateLimitSlot,
} from "@/lib/identityClaim";

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

  try {
    const ipHash = hashValue(getRequestIp(req));
    const userAgentHash = hashValue(req.headers.get("user-agent"));
    const rateLimitKey = ipHash || userAgentHash || "anonymous";
    const rateLimit = takeIdentityClaimRateLimitSlot(rateLimitKey);

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          result: genericResult,
          message: genericMessage,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfterSeconds),
          },
        },
      );
    }

    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        {
          result: genericResult,
          message: genericMessage,
        },
        { status: 400 },
      );
    }

    const parsed = parseIdentityClaimInput(body);

    if (!parsed.ok) {
      return NextResponse.json(
        {
          result: genericResult,
          message: genericMessage,
        },
        { status: 400 },
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    if (!supabaseAdmin) {
      return NextResponse.json(
        {
          result: genericResult,
          message: genericMessage,
        },
        { status: 500 },
      );
    }

    const normalizedInput = parsed.value;

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
        return NextResponse.json(
          {
            result: genericResult,
            message: genericMessage,
          },
          { status: 400 },
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
      throw error;
    }

    const attempt = Array.isArray(data) ? data[0] : null;
    const publicResult =
      attempt?.public_result_classification === "CONTINUE_VERIFICATION" ||
      attempt?.public_result_classification === "REVIEW_REQUIRED" ||
      attempt?.public_result_classification ===
        "CREATE_NEW_ACCOUNT_AVAILABLE" ||
      attempt?.public_result_classification === "UNABLE_TO_VERIFY"
        ? (attempt.public_result_classification as IdentityClaimPublicResult)
        : genericResult;

    return NextResponse.json({
      result: publicResult,
      message: getIdentityClaimPublicMessage(publicResult),
      attemptToken:
        typeof attempt?.public_attempt_token === "string"
          ? attempt.public_attempt_token
          : null,
      expiresAt:
        typeof attempt?.expires_at === "string" ? attempt.expires_at : null,
    });
  } catch {
    return NextResponse.json(
      {
        result: genericResult,
        message: genericMessage,
      },
      { status: 500 },
    );
  }
}
