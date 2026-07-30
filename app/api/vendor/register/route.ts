import { NextResponse } from "next/server";

import { resolveOrCreatePersonForAuthUser } from "@/lib/server/personIdentity";
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

  const registrationEmail = normalizeEmail(body.email || user.email || "");
  if (!registrationEmail) {
    return NextResponse.json(
      { ok: false, error: "A valid email address is required." },
      { status: 400 },
    );
  }

  const { data: existingAccess, error: existingAccessError } = await supabaseAdmin
    .from("vendor_org_access")
    .select("id,vendor_id")
    .eq("auth_user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingAccessError) {
    return NextResponse.json(
      { ok: false, error: existingAccessError.message },
      { status: 500 },
    );
  }

  if (existingAccess?.id) {
    return NextResponse.json(
      {
        ok: false,
        error: "This account already has active vendor access.",
        reason: "vendor_access_exists",
        vendorId: existingAccess.vendor_id,
      },
      { status: 409 },
    );
  }

  const nameParts = splitName(contactName);
  const personResolution = await resolveOrCreatePersonForAuthUser(
    supabaseAdmin,
    user.id,
    { firstName: nameParts.firstName, lastName: nameParts.lastName },
  );

  if ("error" in personResolution) {
    return NextResponse.json(
      { ok: false, error: personResolution.error },
      { status: 500 },
    );
  }

  const personId = personResolution.personId;

  const { data: createdVendor, error: vendorError } = await supabaseAdmin
    .from("vendors")
    .insert({
      business_name: businessName,
      name: businessName,
      contact_name: contactName || null,
      email: registrationEmail,
      phone: phone || null,
      website: website || null,
      business_description: businessDescription || null,
      preferred_contact_method: preferredContactMethod,
      is_active: true,
    })
    .select("id,business_name")
    .single();

  if (vendorError || !createdVendor?.id) {
    return NextResponse.json(
      { ok: false, error: vendorError?.message || "Could not create vendor organization." },
      { status: 500 },
    );
  }

  const vendorId = createdVendor.id;

  const { data: createdContact, error: contactError } = await supabaseAdmin
    .from("vendor_contacts")
    .insert({
      vendor_id: vendorId,
      person_id: personId,
      first_name: nameParts.firstName,
      last_name: nameParts.lastName,
      email: registrationEmail,
      mobile_phone: phone || null,
      role_title: "Owner",
      is_primary: true,
      status: "active",
    })
    .select("id")
    .single();

  if (contactError || !createdContact?.id) {
    await supabaseAdmin.from("vendors").delete().eq("id", vendorId);

    return NextResponse.json(
      { ok: false, error: contactError?.message || "Could not create vendor contact." },
      { status: 500 },
    );
  }

  const now = new Date().toISOString();

  const { data: accessRow, error: accessError } = await supabaseAdmin
    .from("vendor_org_access")
    .insert({
      vendor_id: vendorId,
      vendor_contact_id: createdContact.id,
      person_id: personId,
      auth_user_id: user.id,
      invitation_email: registrationEmail,
      access_role: "vendor_admin",
      status: "active",
      invited_at: now,
      accepted_at: now,
    })
    .select("id")
    .single();

  if (accessError || !accessRow?.id) {
    await supabaseAdmin.from("vendor_contacts").delete().eq("id", createdContact.id);
    await supabaseAdmin.from("vendors").delete().eq("id", vendorId);

    return NextResponse.json(
      { ok: false, error: accessError?.message || "Could not grant vendor access." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    vendorId,
    vendorName: createdVendor.business_name || businessName,
    accessId: accessRow.id,
  });
}
