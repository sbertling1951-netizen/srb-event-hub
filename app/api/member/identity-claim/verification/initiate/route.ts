import { createHash, randomInt } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import { emailEnabled, resend } from "@/lib/email";

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

function getMaskedContact(channel: VerificationChannel, value: string) {
  if (channel === "email") {
    const [local, domain] = value.split("@");
    if (!local || !domain) {
      return "***";
    }

    const localMasked =
      local.length <= 2
        ? `${local[0] || "*"}*`
        : `${local[0]}${"*".repeat(Math.max(1, local.length - 2))}${local[local.length - 1]}`;

    return `${localMasked}@${domain}`;
  }

  const suffix = value.slice(-4);
  return `***-***-${suffix}`;
}

async function sendSmsCodeIfConfigured(phone: string, code: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    return false;
  }

  const params = new URLSearchParams();
  params.set("To", phone.startsWith("+") ? phone : `+1${phone}`);
  params.set("From", fromNumber);
  params.set(
    "Body",
    `Your EpicentraX verification code is ${code}. It expires in 10 minutes.`,
  );

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    },
  );

  return response.ok;
}

export async function POST(req: NextRequest) {
  const genericResponse = {
    result: "CONTINUE_VERIFICATION",
    message:
      "If the information can be verified, a code will be sent. For security reasons, we cannot confirm account details.",
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
    const rawChannel = String(payload.channel || "").trim().toLowerCase();
    const rawContact = String(payload.contact || "").trim();
    const channel: VerificationChannel | null =
      rawChannel === "email" || rawChannel === "sms"
        ? (rawChannel as VerificationChannel)
        : null;

    if (!attemptToken || !channel || !rawContact) {
      return NextResponse.json(genericResponse);
    }

    const normalizedContact =
      channel === "email" ? normalizeEmail(rawContact) : normalizePhone(rawContact);

    if (!normalizedContact) {
      return NextResponse.json(genericResponse);
    }

    const destinationHash = hashValue(normalizedContact);
    const code = String(randomInt(100000, 1000000));
    const codeHash = hashValue(code);
    const requestIpHash = hashValue(getRequestIp(req));
    const userAgentHash = hashValue(req.headers.get("user-agent"));

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin || !destinationHash || !codeHash) {
      return NextResponse.json(genericResponse);
    }

    const { data, error } = await supabaseAdmin.rpc(
      "begin_member_identity_claim_verification",
      {
        p_attempt_token: attemptToken,
        p_channel: channel,
        p_destination_hash: destinationHash,
        p_code_hash: codeHash,
        p_expires_in_seconds: 600,
        p_request_ip_hash: requestIpHash,
        p_user_agent_hash: userAgentHash,
        p_request_source: "member_activation_verification_initiate_api",
      },
    );

    if (error) {
      return NextResponse.json(genericResponse);
    }

    const row = Array.isArray(data) ? data[0] : null;
    const canSendCode = row?.can_send_code === true;
    let deliveryAttempted = false;

    if (canSendCode && channel === "email" && emailEnabled() && resend) {
      const fromEmail = process.env.RESEND_FROM_EMAIL?.trim();

      if (fromEmail) {
        deliveryAttempted = true;
        await resend.emails.send({
          from: fromEmail,
          to: [normalizedContact],
          subject: "EpicentraX verification code",
          text: `Your EpicentraX verification code is ${code}. It expires in 10 minutes.`,
        });
      }
    } else if (canSendCode && channel === "sms") {
      deliveryAttempted = await sendSmsCodeIfConfigured(normalizedContact, code);
    }

    return NextResponse.json({
      ...genericResponse,
      verificationRequested: true,
      channel,
      maskedDestination: getMaskedContact(channel, normalizedContact),
      expiresAt: typeof row?.expires_at === "string" ? row.expires_at : null,
      deliveryAttempted,
    });
  } catch {
    return NextResponse.json(genericResponse);
  }
}