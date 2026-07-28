import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";
import {
  VENDOR_AUTH_COOKIE,
  VENDOR_SELECTED_COOKIE,
} from "@/lib/server/vendorAccess";

type SessionBody = {
  accessToken?: string;
};

function secureCookieEnabled() {
  return process.env.NODE_ENV === "production";
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

  const now = new Date().toISOString();
  const { error: activatePendingError } = await supabaseAdmin
    .from("vendor_org_access")
    .update({
      status: "active",
      accepted_at: now,
    })
    .eq("auth_user_id", user.id)
    .eq("status", "pending");

  if (activatePendingError) {
    return NextResponse.json(
      { ok: false, error: activatePendingError.message },
      { status: 500 },
    );
  }

  const response = NextResponse.json({ ok: true, userId: user.id });
  response.cookies.set({
    name: VENDOR_AUTH_COOKIE,
    value: accessToken,
    httpOnly: true,
    secure: secureCookieEnabled(),
    sameSite: "lax",
    path: "/",
  });

  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });

  response.cookies.set({
    name: VENDOR_AUTH_COOKIE,
    value: "",
    maxAge: 0,
    httpOnly: true,
    secure: secureCookieEnabled(),
    sameSite: "lax",
    path: "/",
  });

  response.cookies.set({
    name: VENDOR_SELECTED_COOKIE,
    value: "",
    maxAge: 0,
    httpOnly: true,
    secure: secureCookieEnabled(),
    sameSite: "lax",
    path: "/",
  });

  return response;
}
