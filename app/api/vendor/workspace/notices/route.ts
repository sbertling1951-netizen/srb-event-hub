import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";
import { resolveVendorAccessFromCookies } from "@/lib/server/vendorAccess";
import { recordVendorNoticesAuthorityShadow } from "@/lib/server/vendorNoticesAuthorityShadow";
import { isVendorNoticeType } from "@/lib/vendorNotice";

const MESSAGE_MAX_LENGTH = 140;

type NoticePatchBody = {
  eventId?: string;
  noticeType?: string;
  message?: string;
  expiresAt?: string | null;
  isActive?: boolean;
};

async function resolveSelectedVendor() {
  const cookieStore = await cookies();
  const resolved = await resolveVendorAccessFromCookies(cookieStore);

  if (!resolved.ok) {
    return {
      error: NextResponse.json(
        { ok: false, error: resolved.message, reason: resolved.reason },
        { status: resolved.status },
      ),
    };
  }

  const selectedVendor = resolved.context.selectedVendor;
  if (!selectedVendor) {
    return {
      error: NextResponse.json(
        {
          ok: false,
          error: "Select a vendor organization first.",
          reason: "vendor_selection_required",
        },
        { status: 409 },
      ),
    };
  }

  return { resolved, selectedVendor };
}

export async function PATCH(req: Request) {
  let body: NoticePatchBody;

  try {
    body = (await req.json()) as NoticePatchBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const access = await resolveSelectedVendor();
  if (access.error) {
    return access.error;
  }
  const { resolved, selectedVendor } = access;

  const eventId = String(body.eventId || "").trim();
  if (!eventId) {
    return NextResponse.json(
      { ok: false, error: "eventId is required." },
      { status: 400 },
    );
  }

  if (!isVendorNoticeType(body.noticeType)) {
    return NextResponse.json(
      { ok: false, error: "noticeType is not a recognized notice type." },
      { status: 400 },
    );
  }

  let expiresAt: string | null = null;
  if (body.expiresAt) {
    const parsed = new Date(body.expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        { ok: false, error: "expiresAt is not a valid date/time." },
        { status: 400 },
      );
    }
    expiresAt = parsed.toISOString();
  }

  const message = String(body.message || "").trim().slice(0, MESSAGE_MAX_LENGTH) || null;
  const isActive = body.isActive !== false;

  const supabaseAdmin = getSupabaseAdminClient();
  if (!supabaseAdmin) {
    return NextResponse.json(
      { ok: false, error: "Vendor workspace service is not configured." },
      { status: 500 },
    );
  }

  // A notice is scoped to events the vendor actually participates in; event
  // participation itself remains administrator-controlled and is not
  // created or modified here.
  const { data: participation, error: participationError } = await supabaseAdmin
    .from("event_vendors")
    .select("id")
    .eq("vendor_id", selectedVendor.vendorId)
    .eq("event_id", eventId)
    .maybeSingle();

  if (participationError) {
    return NextResponse.json(
      { ok: false, error: participationError.message },
      { status: 500 },
    );
  }

  if (!participation) {
    // WR-19 Stage 2A: diagnostic only -- computes and records whether the
    // future Assignment-based policy would allow this action too, purely
    // for later comparison. Its own return value is never inspected here,
    // and the helper swallows every internal failure, so it can never
    // change the response below.
    await recordVendorNoticesAuthorityShadow({
      cookies: await cookies(),
      vendorId: selectedVendor.vendorId,
      eventId,
      operation: "update",
      currentAuthorizationResult: "denied",
    });

    return NextResponse.json(
      {
        ok: false,
        error: "This vendor is not associated with the given event.",
      },
      { status: 400 },
    );
  }

  const { data: notice, error } = await supabaseAdmin
    .from("vendor_event_status")
    .upsert(
      {
        vendor_id: selectedVendor.vendorId,
        event_id: eventId,
        status_type: body.noticeType,
        message,
        expires_at: expiresAt,
        is_active: isActive,
        updated_by_auth_user_id: resolved.context.authenticatedUserId,
      },
      { onConflict: "vendor_id,event_id" },
    )
    .select("id,event_id,status_type,message,expires_at,is_active,updated_at")
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  // WR-19 Stage 2A: diagnostic only, see above -- recorded after the real
  // mutation has already succeeded. Awaited only so the diagnostic write
  // reliably completes before the serverless function exits; the helper
  // swallows every failure internally and can never change this response.
  await recordVendorNoticesAuthorityShadow({
    cookies: await cookies(),
    vendorId: selectedVendor.vendorId,
    eventId,
    operation: "update",
    currentAuthorizationResult: "allowed",
  });

  return NextResponse.json({ ok: true, notice });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const eventId = (url.searchParams.get("eventId") || "").trim();

  if (!eventId) {
    return NextResponse.json(
      { ok: false, error: "eventId is required." },
      { status: 400 },
    );
  }

  const access = await resolveSelectedVendor();
  if (access.error) {
    return access.error;
  }
  const { selectedVendor } = access;

  const supabaseAdmin = getSupabaseAdminClient();
  if (!supabaseAdmin) {
    return NextResponse.json(
      { ok: false, error: "Vendor workspace service is not configured." },
      { status: 500 },
    );
  }

  const { error } = await supabaseAdmin
    .from("vendor_event_status")
    .delete()
    .eq("vendor_id", selectedVendor.vendorId)
    .eq("event_id", eventId);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  // WR-19 Stage 2A: diagnostic only, see PATCH above. DELETE has no
  // event_vendors participation check of its own today (unchanged existing
  // behavior), so unlike PATCH there is no reachable "denied" branch here
  // to compare -- only the allowed outcome is recorded for this operation.
  await recordVendorNoticesAuthorityShadow({
    cookies: await cookies(),
    vendorId: selectedVendor.vendorId,
    eventId,
    operation: "delete",
    currentAuthorizationResult: "allowed",
  });

  return NextResponse.json({ ok: true, eventId });
}
