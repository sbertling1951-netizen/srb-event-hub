import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

// Sends the single activation magic link. Replaces the numeric-code
// email/SMS flow in app/api/member/identity-claim/verification/initiate/route.ts
// for the activation UI -- that route is left in place (unused by the
// activation page) rather than deleted, since it is not fully traced
// for other callers in this pass.
//
// Email only: magic links are inherently an email mechanism. Phone/SMS
// activation is out of scope for this change and continues to use the
// existing numeric-code route if invoked directly.

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

// A fresh, anon-key client used only to trigger Supabase's own magic
// link email via signInWithOtp. This is the same mechanism (and same
// privilege level) as calling signInWithOtp from the browser -- running
// it server-side here only lets us create the pending activation
// challenge and send the link atomically in one request.
function getSupabaseAnon() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return null;
  }

  return createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function hashValue(value: string | null) {
  if (!value) {
    return null;
  }

  return createHash("md5").update(value).digest("hex");
}

function getRequestIp(req: NextRequest) {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || null;
  }

  return req.headers.get("x-real-ip")?.trim() || null;
}

export async function POST(req: NextRequest) {
  // Deliberately generic and identical regardless of whether the
  // attempt/email is actually eligible, so this endpoint cannot be used
  // to enumerate accounts or activation eligibility.
  const genericResponse = {
    result: "CONTINUE_VERIFICATION",
    message:
      "If the information can be verified, an email will be sent. For security reasons, we cannot confirm account details.",
  };

  try {
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json(genericResponse);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(genericResponse);
    }

    const payload = body as Record<string, unknown>;
    const attemptToken = String(payload.attemptToken || "").trim();
    const rawEmail = String(payload.email || "").trim();

    if (!attemptToken || !rawEmail) {
      return NextResponse.json(genericResponse);
    }

    const normalizedEmail = normalizeEmail(rawEmail);
    if (!normalizedEmail) {
      return NextResponse.json(genericResponse);
    }

    const destinationHash = hashValue(normalizedEmail);
    const requestIpHash = hashValue(getRequestIp(req));
    const userAgentHash = hashValue(req.headers.get("user-agent"));

    const supabaseAdmin = getSupabaseAdmin();
    const supabaseAnon = getSupabaseAnon();

    if (!supabaseAdmin || !supabaseAnon || !destinationHash) {
      return NextResponse.json(genericResponse);
    }

    // Server-controlled pending activation record: reuses the existing,
    // already-audited identity-claim verification-challenge machinery
    // (see supabase/migrations/20260730120000_add_magic_link_activation_support.sql).
    // This step independently re-validates that the attempt is still
    // eligible and rate-limits repeated requests -- it does not trust
    // anything the browser asserts about eligibility.
    const { data, error } = await supabaseAdmin.rpc(
      "begin_member_identity_claim_magic_link",
      {
        p_attempt_token: attemptToken,
        p_destination_hash: destinationHash,
        p_request_ip_hash: requestIpHash,
        p_user_agent_hash: userAgentHash,
      },
    );

    if (error) {
      // External response stays generic (see genericResponse above) so
      // this endpoint cannot be used to enumerate accounts or
      // eligibility; the real reason is only ever visible server-side.
      console.error("begin_member_identity_claim_magic_link RPC failed:", error);
      return NextResponse.json(genericResponse);
    }

    const row = Array.isArray(data)
      ? (data[0] ?? null)
      : data && typeof data === "object"
        ? data
        : null;
    const canSendLink = row?.can_send_link === true;

    if (canSendLink) {
      const redirectTo = new URL("/auth/callback", req.nextUrl.origin);
      redirectTo.searchParams.set("purpose", "activation");
      redirectTo.searchParams.set("attempt_token", attemptToken);

      // shouldCreateUser is intentionally left at its default (true):
      // activation is the one path where a brand-new Supabase Auth user
      // is expected to be created, replacing the previous explicit
      // supabaseAdmin.auth.admin.createUser() call in
      // verification/complete/route.ts. This only runs after the
      // identity-evidence evaluation and the eligibility re-check above
      // have already approved this attempt.
      const { error: otpError } = await supabaseAnon.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          emailRedirectTo: redirectTo.toString(),
        },
      });

      if (otpError) {
        // Same reasoning as above: the external response never reveals
        // whether the send actually succeeded (e.g. an SMTP outage), so
        // this cannot be used to enumerate accounts. Server-side logging
        // is the only way to notice a real delivery failure.
        console.error("signInWithOtp (activation magic link) failed:", otpError);
      }
    }

    return NextResponse.json({
      ...genericResponse,
      verificationRequested: true,
      channel: "email",
      expiresAt: typeof row?.expires_at === "string" ? row.expires_at : null,
    });
  } catch (err) {
    console.error("initiate-magic-link route failed:", err);
    return NextResponse.json(genericResponse);
  }
}
