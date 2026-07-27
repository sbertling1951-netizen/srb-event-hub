import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

type VerificationChannel = "email" | "sms";

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

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizePhone(value: string) {
  let digits = value.replace(/\D+/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }

  return digits;
}

function normalizeComparablePhone(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  let digits = value.replace(/\D+/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }

  return digits;
}

function getRequestIp(req: NextRequest) {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || null;
  }

  return req.headers.get("x-real-ip")?.trim() || null;
}

async function findExistingUserByEmail(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  email: string,
) {
  if (!supabaseAdmin) {
    return null;
  }

  let page = 1;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (error) {
      return null;
    }

    const users = data?.users || [];
    const existing = users.find(
      (user) => user.email?.toLowerCase() === email.toLowerCase(),
    );

    if (existing) {
      return existing;
    }

    if (users.length < 200) {
      break;
    }

    page += 1;
  }

  return null;
}

async function findExistingUserByPhone(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  phone: string,
) {
  if (!supabaseAdmin) {
    return null;
  }

  const normalizedTarget = normalizeComparablePhone(phone);
  if (!normalizedTarget) {
    return null;
  }

  let page = 1;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (error) {
      return null;
    }

    const users = data?.users || [];
    const existing = users.find((user) => {
      const normalizedExisting = normalizeComparablePhone(user.phone);
      return normalizedExisting !== "" && normalizedExisting === normalizedTarget;
    });

    if (existing) {
      return existing;
    }

    if (users.length < 200) {
      break;
    }

    page += 1;
  }

  return null;
}

export async function POST(req: NextRequest) {
  const genericFailure = {
    result: "UNABLE_TO_VERIFY",
    message:
      "We could not complete verification safely. Please request a new code or contact support.",
  };

  try {
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json(genericFailure);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(genericFailure);
    }

    const payload = body as Record<string, unknown>;
    const attemptToken = String(payload.attemptToken || "").trim();
    const rawChannel = String(payload.channel || "").trim().toLowerCase();
    const rawContact = String(payload.contact || "").trim();
    const code = String(payload.code || "").trim();

    const channel: VerificationChannel | null =
      rawChannel === "email" || rawChannel === "sms"
        ? (rawChannel as VerificationChannel)
        : null;

    if (!attemptToken || !channel || !rawContact || !code) {
      return NextResponse.json(genericFailure);
    }

    const normalizedContact =
      channel === "email" ? normalizeEmail(rawContact) : normalizePhone(rawContact);

    if (!normalizedContact) {
      return NextResponse.json(genericFailure);
    }

    const destinationHash = hashValue(normalizedContact);
    const codeHash = hashValue(code);

    if (!destinationHash || !codeHash) {
      return NextResponse.json(genericFailure);
    }

    const requestIpHash = hashValue(getRequestIp(req));
    const userAgentHash = hashValue(req.headers.get("user-agent"));

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json(genericFailure);
    }

    const { data: consumeData, error: consumeError } = await supabaseAdmin.rpc(
      "consume_member_identity_claim_verification",
      {
        p_attempt_token: attemptToken,
        p_channel: channel,
        p_destination_hash: destinationHash,
        p_code_hash: codeHash,
        p_request_ip_hash: requestIpHash,
        p_user_agent_hash: userAgentHash,
      },
    );

    if (consumeError) {
      return NextResponse.json(genericFailure);
    }

    const consumeRow = Array.isArray(consumeData) ? consumeData[0] : null;
    if (consumeRow?.verification_status !== "VERIFIED") {
      return NextResponse.json(genericFailure);
    }

    let authUserId: string | null = null;

    if (channel === "email") {
      const existing = await findExistingUserByEmail(supabaseAdmin, normalizedContact);

      if (existing) {
        authUserId = existing.id;
      } else {
        const { data: created, error: createError } =
          await supabaseAdmin.auth.admin.createUser({
            email: normalizedContact,
            email_confirm: true,
          });

        if (createError || !created?.user) {
          const fallback = await findExistingUserByEmail(
            supabaseAdmin,
            normalizedContact,
          );
          authUserId = fallback?.id || null;
        } else {
          authUserId = created.user.id;
        }
      }
    } else {
      const existing = await findExistingUserByPhone(
        supabaseAdmin,
        normalizedContact,
      );

      if (existing) {
        authUserId = existing.id;
      } else {
        const { data: created, error: createError } =
          await supabaseAdmin.auth.admin.createUser({
            phone: normalizedContact.startsWith("+")
              ? normalizedContact
              : `+1${normalizedContact}`,
            phone_confirm: true,
          });

        if (createError || !created?.user) {
          const fallback = await findExistingUserByPhone(
            supabaseAdmin,
            normalizedContact,
          );
          authUserId = fallback?.id || null;
        } else {
          authUserId = created.user.id;
        }
      }
    }

    if (!authUserId) {
      return NextResponse.json(genericFailure);
    }

    const { data: finalizeData, error: finalizeError } = await supabaseAdmin.rpc(
      "finalize_member_identity_activation",
      {
        p_attempt_token: attemptToken,
        p_auth_user_id: authUserId,
        p_verified_channel: channel,
        p_verified_destination_hash: destinationHash,
        p_request_ip_hash: requestIpHash,
        p_user_agent_hash: userAgentHash,
        p_request_source: "member_activation_verification_complete_api",
      },
    );

    if (finalizeError) {
      return NextResponse.json(genericFailure);
    }

    const finalizeRow = Array.isArray(finalizeData) ? finalizeData[0] : null;
    if (finalizeRow?.activation_status !== "ACTIVATED") {
      return NextResponse.json(genericFailure);
    }

    return NextResponse.json({
      result: "CONTINUE_VERIFICATION",
      message:
        "Verification completed. Your identity activation has been safely processed.",
      activationComplete: true,
    });
  } catch {
    return NextResponse.json(genericFailure);
  }
}