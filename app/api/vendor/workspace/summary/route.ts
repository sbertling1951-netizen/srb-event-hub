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

  const { data: vendor, error: vendorError } = await supabaseAdmin
    .from("vendors")
    .select(
      "id,business_name,business_description,email,phone,website,is_active",
    )
    .eq("id", selectedVendor.vendorId)
    .maybeSingle();

  if (vendorError) {
    return NextResponse.json(
      { ok: false, error: vendorError.message },
      { status: 500 },
    );
  }

  const { data: eventVendors, error: eventVendorError } = await supabaseAdmin
    .from("event_vendors")
    .select(
      "id,event_id,status,allow_service_requests,is_visible_to_members,action_type,display_order,event_note,signup_url,events(id,name,location,start_date,end_date)",
    )
    .eq("vendor_id", selectedVendor.vendorId);

  if (eventVendorError) {
    return NextResponse.json(
      { ok: false, error: eventVendorError.message },
      { status: 500 },
    );
  }

  const participationRows = eventVendors || [];
  const participationCounts: Record<string, number> = {};
  for (const row of participationRows) {
    const key = String(row.status || "assigned");
    participationCounts[key] = (participationCounts[key] || 0) + 1;
  }

  return NextResponse.json({
    ok: true,
    vendor: vendor || null,
    participationRows,
    participation: {
      total: participationRows.length,
      byStatus: participationCounts,
      serviceEnabled: participationRows.filter(
        (row) => !!row.allow_service_requests,
      ).length,
      visibleToMembers: participationRows.filter(
        (row) => row.is_visible_to_members !== false,
      ).length,
    },
  });
}
