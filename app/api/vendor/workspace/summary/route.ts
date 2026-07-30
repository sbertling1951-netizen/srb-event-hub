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

  const eventIds = participationRows.map((row) => row.event_id).filter(Boolean);
  let noticeByEventId: Record<string, unknown> = {};

  if (eventIds.length > 0) {
    const { data: noticeRows, error: noticeError } = await supabaseAdmin
      .from("vendor_event_status")
      .select("event_id,status_type,message,expires_at,is_active,updated_at")
      .eq("vendor_id", selectedVendor.vendorId)
      .in("event_id", eventIds);

    if (noticeError) {
      return NextResponse.json(
        { ok: false, error: noticeError.message },
        { status: 500 },
      );
    }

    noticeByEventId = Object.fromEntries(
      (noticeRows || []).map((row) => [row.event_id, row]),
    );
  }

  const participationWithNotice = participationRows.map((row) => ({
    ...row,
    currentNotice: noticeByEventId[row.event_id] || null,
  }));

  const { data: serviceRequests, error: serviceRequestError } = await supabaseAdmin
    .from("vendor_service_requests")
    .select("request_status")
    .eq("vendor_id", selectedVendor.vendorId);

  if (serviceRequestError) {
    return NextResponse.json(
      { ok: false, error: serviceRequestError.message },
      { status: 500 },
    );
  }

  const openRequestStatuses = new Set(["new", "contacted", "confirmed"]);
  const openRequestsCount = (serviceRequests || []).filter((row) =>
    openRequestStatuses.has(String(row.request_status || "new")),
  ).length;

  const participationCounts: Record<string, number> = {};
  for (const row of participationRows) {
    const key = String(row.status || "assigned");
    participationCounts[key] = (participationCounts[key] || 0) + 1;
  }

  return NextResponse.json({
    ok: true,
    vendor: vendor || null,
    participationRows: participationWithNotice,
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
    openRequestsCount,
  });
}
