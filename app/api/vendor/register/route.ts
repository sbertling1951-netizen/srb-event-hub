import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";

type RegisterBody = {
  accessToken?: string;
  businessName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  website?: string;
  businessDescription?: string;
  preferredContactMethod?: "email" | "phone" | "text";
};

type RegisterVendorSelfRow = {
  outcome?: unknown;
  vendor_id?: unknown;
  vendor_name?: unknown;
  access_id?: unknown;
};

function normalizeEmail(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function splitName(value: string) {
  const text = value.trim();
  if (!text) {
    return { firstName: null, lastName: null };
  }

  const parts = text.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: null };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

export async function POST(req: Request) {
  let body: RegisterBody;

  try {
    body = (await req.json()) as RegisterBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const accessToken = String(body.accessToken || "").trim();
  const businessName = String(body.businessName || "").trim();
  const contactName = String(body.contactName || "").trim();
  const website = String(body.website || "").trim();
  const phone = String(body.phone || "").trim();
  const businessDescription = String(body.businessDescription || "").trim();
  const preferredContactMethod =
    body.preferredContactMethod === "phone" || body.preferredContactMethod === "text"
      ? body.preferredContactMethod
      : "email";

  if (!accessToken) {
    return NextResponse.json(
      { ok: false, error: "accessToken is required." },
      { status: 400 },
    );
  }

  if (!businessName) {
    return NextResponse.json(
      { ok: false, error: "Business name is required." },
      { status: 400 },
    );
  }

  const supabaseAdmin = getSupabaseAdminClient();
  if (!supabaseAdmin) {
    return NextResponse.json(
      { ok: false, error: "Vendor registration service is not configured." },
      { status: 500 },
    );
  }

  const {
    data: { user },
    error: authError,
  } = await supabaseAdmin.auth.getUser(accessToken);

  if (authError || !user?.id) {
    return NextResponse.json(
      { ok: false, error: "Authentication is required." },
      { status: 401 },
    );
  }

  // Verified identity evidence comes only from the Auth user record itself,
  // never from the submitted registration body. The submitted contact
  // email/phone below are vendor-contact data only and are kept separate.
  const verifiedAuthEmail =
    user.email_confirmed_at && user.email ? user.email : null;
  const verifiedAuthPhone =
    user.phone_confirmed_at && user.phone ? user.phone : null;

  const contactEmail = normalizeEmail(body.email || user.email || "");
  if (!contactEmail) {
    return NextResponse.json(
      { ok: false, error: "A valid email address is required." },
      { status: 400 },
    );
  }

  const nameParts = splitName(contactName);

  const { data, error } = await supabaseAdmin.rpc("register_vendor_self", {
    p_auth_user_id: user.id,
    p_business_name: businessName,
    p_verified_auth_email: verifiedAuthEmail,
    p_verified_auth_phone: verifiedAuthPhone,
    p_display_first_name: nameParts.firstName,
    p_display_last_name: nameParts.lastName,
    p_contact_name: contactName || null,
    p_contact_email: contactEmail,
    p_contact_phone: phone || null,
    p_website: website || null,
    p_business_description: businessDescription || null,
    p_preferred_contact_method: preferredContactMethod,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, error: "Vendor registration could not complete." },
      { status: 500 },
    );
  }

  const row = (Array.isArray(data) ? data[0] : null) as
    | RegisterVendorSelfRow
    | null;

  if (!row || typeof row.outcome !== "string") {
    return NextResponse.json(
      { ok: false, error: "Vendor registration could not complete." },
      { status: 500 },
    );
  }

  if (row.outcome === "registered") {
    return NextResponse.json({
      ok: true,
      vendorId: row.vendor_id,
      vendorName: row.vendor_name,
      accessId: row.access_id,
    });
  }

  if (row.outcome === "already_registered") {
    return NextResponse.json(
      {
        ok: false,
        error: "This account already has active vendor access.",
        reason: "vendor_access_exists",
        vendorId: row.vendor_id,
      },
      { status: 409 },
    );
  }

  if (
    row.outcome === "needs_confirmation" ||
    row.outcome === "ambiguous" ||
    row.outcome === "invalid_existing_link"
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "We could not automatically complete your vendor registration. Please contact support.",
        reason: row.outcome,
      },
      { status: 409 },
    );
  }

  return NextResponse.json(
    { ok: false, error: "Vendor registration could not complete." },
    { status: 500 },
  );
}
