import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";
import { resolveVendorAccessFromCookies } from "@/lib/server/vendorAccess";

// Read-only view over the existing member -> admin request workflow
// (public.vendor_service_requests). No new statuses, tables, or write path
// are introduced here -- vendors can see requests directed at them; the
// admin request queue (app/admin/vendor-requests) remains the sole place
// requests are actioned, unchanged.
const OPEN_STATUSES = new Set(["new", "contacted", "confirmed"]);

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

  const { data, error } = await supabaseAdmin
    .from("vendor_service_requests")
    .select(
      "id,event_id,requester_name,requester_email,requester_phone,site_number,requested_service,guest_count,request_notes,preferred_response_method,request_status,created_at,events(name)",
    )
    .eq("vendor_id", selectedVendor.vendorId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  const requests = data || [];
  const openCount = requests.filter((row) =>
    OPEN_STATUSES.has(String(row.request_status || "new")),
  ).length;

  return NextResponse.json({
    ok: true,
    requests,
    openCount,
  });
}
