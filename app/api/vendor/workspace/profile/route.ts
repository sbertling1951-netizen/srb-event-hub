import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";
import { resolveVendorAccessFromCookies } from "@/lib/server/vendorAccess";

type ProfilePatchBody = {
  business_name?: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  website?: string;
  business_description?: string;
  preferred_contact_method?: string;
  logo_url?: string | null;
};

function normalizeOptional(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

export async function GET() {
  const cookieStore = await cookies();
  const resolved = await resolveVendorAccessFromCookies(cookieStore);

  if (!resolved.ok) {
    return NextResponse.json(
      { ok: false, error: resolved.message, reason: resolved.reason },
      { status: resolved.status },
    );
  }

  const selectedVendor = resolved.context.selectedVendor;
  if (!selectedVendor) {
    return NextResponse.json(
      {
        ok: false,
        error: "Select a vendor organization first.",
        reason: "vendor_selection_required",
      },
      { status: 409 },
    );
  }

  const supabaseAdmin = getSupabaseAdminClient();
  if (!supabaseAdmin) {
    return NextResponse.json(
      { ok: false, error: "Vendor workspace service is not configured." },
      { status: 500 },
    );
  }

  const { data: vendor, error } = await supabaseAdmin
    .from("vendors")
    .select(
      "id,business_name,contact_name,email,phone,website,logo_url,business_description,preferred_contact_method,is_active",
    )
    .eq("id", selectedVendor.vendorId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    canEdit: selectedVendor.role === "vendor_admin",
    vendor: vendor || null,
  });
}

export async function PATCH(req: Request) {
  let body: ProfilePatchBody;

  try {
    body = (await req.json()) as ProfilePatchBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const resolved = await resolveVendorAccessFromCookies(cookieStore);

  if (!resolved.ok) {
    return NextResponse.json(
      { ok: false, error: resolved.message, reason: resolved.reason },
      { status: resolved.status },
    );
  }

  const selectedVendor = resolved.context.selectedVendor;
  if (!selectedVendor) {
    return NextResponse.json(
      {
        ok: false,
        error: "Select a vendor organization first.",
        reason: "vendor_selection_required",
      },
      { status: 409 },
    );
  }

  if (selectedVendor.role !== "vendor_admin") {
    return NextResponse.json(
      { ok: false, error: "Only vendor_admin can update organization profile." },
      { status: 403 },
    );
  }

  const businessName = String(body.business_name || "").trim();
  if (!businessName) {
    return NextResponse.json(
      { ok: false, error: "Business name is required." },
      { status: 400 },
    );
  }

  const preferredContactMethod = ["email", "phone", "text"].includes(
    String(body.preferred_contact_method || "").trim().toLowerCase(),
  )
    ? String(body.preferred_contact_method).trim().toLowerCase()
    : "email";

  const updatePayload = {
    business_name: businessName,
    name: businessName,
    contact_name: normalizeOptional(body.contact_name),
    email: normalizeOptional(body.email),
    phone: normalizeOptional(body.phone),
    website: normalizeOptional(body.website),
    logo_url: normalizeOptional(body.logo_url),
    business_description: normalizeOptional(body.business_description),
    preferred_contact_method: preferredContactMethod,
  };

  const supabaseAdmin = getSupabaseAdminClient();
  if (!supabaseAdmin) {
    return NextResponse.json(
      { ok: false, error: "Vendor workspace service is not configured." },
      { status: 500 },
    );
  }

  const { data: vendor, error } = await supabaseAdmin
    .from("vendors")
    .update(updatePayload)
    .eq("id", selectedVendor.vendorId)
    .select(
      "id,business_name,contact_name,email,phone,website,logo_url,business_description,preferred_contact_method,is_active",
    )
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, vendor });
}
