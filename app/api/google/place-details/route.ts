import { NextResponse } from "next/server";

import type { FetchLike } from "@/lib/googleNearby";
import { fetchGooglePlaceDetails } from "@/lib/googlePlaceDetails";
import {
  adminCanManageEvent,
  adminHasPermission,
  resolveAdminActorFromBearer,
} from "@/lib/server/adminAuthz";

// Lazy provider-details lookup for one Google candidate the admin is
// pulling into the Working List. Same metered-API gate as
// /api/google/nearby-search, checked before any Google credential is
// touched: an authenticated active admin, `adminHasPermission(actor,
// "can_manage_nearby")`, and `adminCanManageEvent(actor, eventId)`
// (has_event_admin_authority). As on that route this is NOT a check of
// the granular `event.nearby.manage` task grant (a route cannot call
// resolve_task_authority) -- it only gates who may spend the Google
// Places budget. No canonical data is written here.
//
// A provider failure is reported as `ok: false` with HTTP 200 so the
// client can keep the search-derived entry and show a non-destructive
// warning rather than treating it as a request error.

const fetchImpl: FetchLike = (input) => fetch(input);

type RequestBody = {
  eventId?: unknown;
  googlePlaceId?: unknown;
};

export async function POST(req: Request) {
  const adminResolved = await resolveAdminActorFromBearer(
    req.headers.get("authorization"),
  );

  if (!adminResolved.admin) {
    return NextResponse.json(
      { error: adminResolved.error || "Authentication is required." },
      { status: adminResolved.status || 401 },
    );
  }

  if (!adminHasPermission(adminResolved.admin, "can_manage_nearby")) {
    return NextResponse.json(
      { error: "Nearby management permission is required." },
      { status: 403 },
    );
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
  const googlePlaceId =
    typeof body.googlePlaceId === "string" ? body.googlePlaceId.trim() : "";

  if (!eventId) {
    return NextResponse.json(
      { error: "An eventId is required." },
      { status: 400 },
    );
  }
  if (!googlePlaceId) {
    return NextResponse.json(
      { error: "A googlePlaceId is required." },
      { status: 400 },
    );
  }

  const canManage = await adminCanManageEvent(adminResolved.admin, eventId);
  if (!canManage) {
    return NextResponse.json(
      { error: "You do not have Nearby authority for this event." },
      { status: 403 },
    );
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Google place details are unavailable because the server credential is not configured.",
        code: "missing_google_maps_api_key",
      },
      { status: 500 },
    );
  }

  const result = await fetchGooglePlaceDetails(fetchImpl, apiKey, googlePlaceId);

  if (!result.ok) {
    // Non-fatal: 200 with ok:false so the Working List entry survives.
    return NextResponse.json({
      ok: false,
      googlePlaceId,
      status: result.status,
    });
  }

  return NextResponse.json({
    ok: true,
    googlePlaceId,
    details: result.details,
  });
}
