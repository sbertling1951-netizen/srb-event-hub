import { NextResponse } from "next/server";

import { resolveOrCreatePersonForAuthUser } from "@/lib/server/personIdentity";
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

  // Match the authenticated user to any invitation(s) waiting for them.
  // auth_user_id is the sole match key -- it is only ever set by this
  // server (invite binding or self-registration), never supplied by the
  // client, so an activation link cannot be redirected to activate a
  // different vendor's invitation.
  const { data: pendingRows, error: pendingLookupError } = await supabaseAdmin
    .from("vendor_org_access")
    .select("id,vendor_contact_id")
    .eq("auth_user_id", user.id)
    .eq("status", "pending");

  if (pendingLookupError) {
    return NextResponse.json(
      { ok: false, error: pendingLookupError.message },
      { status: 500 },
    );
  }

  if (pendingRows && pendingRows.length > 0) {
    let nameHint: { firstName?: string | null; lastName?: string | null } = {};
    const firstContactId = pendingRows[0]?.vendor_contact_id;

    if (firstContactId) {
      const { data: contactRow } = await supabaseAdmin
        .from("vendor_contacts")
        .select("first_name,last_name")
        .eq("id", firstContactId)
        .maybeSingle();

      if (contactRow) {
        nameHint = { firstName: contactRow.first_name, lastName: contactRow.last_name };
      }
    }

    // Reuses this auth user's existing person record when one already
    // exists (e.g. an existing member who is also being granted vendor
    // access) instead of creating a second, duplicate identity.
    const personResolution = await resolveOrCreatePersonForAuthUser(
      supabaseAdmin,
      user.id,
      nameHint,
    );

    if ("error" in personResolution) {
      return NextResponse.json(
        { ok: false, error: personResolution.error },
        { status: 500 },
      );
    }

    const personId = personResolution.personId;
    const now = new Date().toISOString();

    const { error: activatePendingError } = await supabaseAdmin
      .from("vendor_org_access")
      .update({
        status: "active",
        accepted_at: now,
        person_id: personId,
      })
      .eq("auth_user_id", user.id)
      .eq("status", "pending");

    if (activatePendingError) {
      return NextResponse.json(
        { ok: false, error: activatePendingError.message },
        { status: 500 },
      );
    }

    const contactIds = Array.from(
      new Set(pendingRows.map((row) => row.vendor_contact_id).filter(Boolean)),
    );

    if (contactIds.length > 0) {
      const { error: linkContactError } = await supabaseAdmin
        .from("vendor_contacts")
        .update({ person_id: personId })
        .in("id", contactIds)
        .is("person_id", null);

      if (linkContactError) {
        return NextResponse.json(
          { ok: false, error: linkContactError.message },
          { status: 500 },
        );
      }
    }
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
