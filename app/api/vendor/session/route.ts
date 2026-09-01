import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";
import {
  CANONICAL_VENDOR_AUTH_COOKIE,
  CANONICAL_VENDOR_SELECTED_COOKIE,
  VENDOR_AUTH_COOKIE,
  VENDOR_SELECTED_COOKIE,
} from "@/lib/server/vendorAccess";

type SessionBody = {
  accessToken?: string;
};

function secureCookieEnabled() {
  return process.env.NODE_ENV === "production";
}

function authMetadataText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function POST(req: Request) {
  let body: SessionBody;

  try {
    body = (await req.json()) as SessionBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const accessToken = String(body.accessToken || "").trim();
  if (!accessToken) {
    return NextResponse.json(
      { ok: false, error: "accessToken is required." },
      { status: 400 },
    );
  }

  const supabaseAdmin = getSupabaseAdminClient();
  if (!supabaseAdmin) {
    return NextResponse.json(
      { ok: false, error: "Vendor auth service is not configured." },
      { status: 500 },
    );
  }

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(accessToken);

  if (error || !user?.id) {
    return NextResponse.json(
      { ok: false, error: "Authentication is required." },
      { status: 401 },
    );
  }

  // activate_vendor_invitation() runs only when a pending access row exists;
  // ordinary sign-in never has one and is handled below instead.
  const { data: pendingRows, error: pendingLookupError } = await supabaseAdmin
    .from("vendor_org_access")
    .select("id")
    .eq("auth_user_id", user.id)
    .eq("status", "pending")
    .limit(1);

  if (pendingLookupError) {
    return NextResponse.json(
      { ok: false, error: "We could not complete Vendor access. Please try again." },
      { status: 500 },
    );
  }

  if (pendingRows && pendingRows.length > 0) {
    const userMetadata = user.user_metadata as Record<string, unknown>;
    const { data: activationRows, error: activationError } = await supabaseAdmin.rpc(
      "activate_vendor_invitation",
      {
        p_auth_user_id: user.id,
        p_verified_auth_email: user.email_confirmed_at ? user.email || null : null,
        p_verified_auth_phone: user.phone_confirmed_at ? user.phone || null : null,
        p_display_first_name: authMetadataText(userMetadata.first_name),
        p_display_last_name: authMetadataText(userMetadata.last_name),
      },
    );

    if (activationError || !Array.isArray(activationRows) || activationRows.length !== 1) {
      return NextResponse.json(
        { ok: false, error: "We could not complete Vendor access. Please try again." },
        { status: 500 },
      );
    }

    const activation = activationRows[0] as { outcome?: unknown };
    if (
      activation.outcome === "needs_confirmation" ||
      activation.outcome === "ambiguous" ||
      activation.outcome === "invalid_existing_link" ||
      activation.outcome === "no_pending_invitation"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "We could not complete Vendor access automatically. Please contact the event administrator.",
        },
        { status: 409 },
      );
    }

    if (
      activation.outcome !== "activated_existing_person" &&
      activation.outcome !== "activated_new_person"
    ) {
      return NextResponse.json(
        { ok: false, error: "We could not complete Vendor access. Please try again." },
        { status: 500 },
      );
    }
  } else {
    // With no pending invitation, require at least one existing active access.
    // Vendor selection among multiple active organizations is handled downstream.
    const { data: activeRows, error: activeLookupError } = await supabaseAdmin
      .from("vendor_org_access")
      .select("id")
      .eq("auth_user_id", user.id)
      .eq("status", "active")
      .limit(1);

    if (activeLookupError) {
      return NextResponse.json(
        { ok: false, error: "We could not complete Vendor access. Please try again." },
        { status: 500 },
      );
    }

    if (!activeRows || activeRows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No Vendor access was found for this account." },
        { status: 409 },
      );
    }
  }

  const response = NextResponse.json({ ok: true, userId: user.id });
  for (const name of [CANONICAL_VENDOR_AUTH_COOKIE, VENDOR_AUTH_COOKIE]) {
    response.cookies.set({
      name,
      value: accessToken,
      httpOnly: true,
      secure: secureCookieEnabled(),
      sameSite: "lax",
      path: "/",
    });
  }

  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });

  // Stage A: clear BOTH the legacy and canonical cookie names so a logout
  // cannot leave a stale vendor session cookie behind under either name.
  const expiredCookieNames = [
    VENDOR_AUTH_COOKIE,
    VENDOR_SELECTED_COOKIE,
    CANONICAL_VENDOR_AUTH_COOKIE,
    CANONICAL_VENDOR_SELECTED_COOKIE,
  ];

  for (const name of expiredCookieNames) {
    response.cookies.set({
      name,
      value: "",
      maxAge: 0,
      httpOnly: true,
      secure: secureCookieEnabled(),
      sameSite: "lax",
      path: "/",
    });
  }

  return response;
}
