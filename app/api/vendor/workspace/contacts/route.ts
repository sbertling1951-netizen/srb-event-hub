import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";
import { resolveVendorAccessFromCookies } from "@/lib/server/vendorAccess";

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

  const { data: contacts, error } = await supabaseAdmin
    .from("vendor_contacts")
    .select(
      "id,vendor_id,first_name,last_name,email,mobile_phone,role_title,is_primary,status,created_at,updated_at",
    )
    .eq("vendor_id", selectedVendor.vendorId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, contacts: contacts || [] });
}
