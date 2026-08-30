import { NextResponse } from "next/server";

import {
  buildGoogleNearbyProviderRequests,
  type FetchLike,
  geocodeEventLocationViaGoogle,
  normalizeRadiusMiles,
  runGoogleNearbyFanOut,
} from "@/lib/googleNearby";
import {
  adminCanManageEvent,
  adminHasPermission,
  resolveAdminActorFromBearer,
} from "@/lib/server/adminAuthz";
import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";

// The Nearby curated-list builder's discovery endpoint. One visible admin
// "Search" fans out server-side into several Google Places requests (one
// per requested EpicentraX category, plus an optional free-text request),
// merged by exact place_id.
//
// Authority (metered-API gate). Verified here, before any Google
// credential is read or any provider request is made:
//   1. resolveAdminActorFromBearer -- an authenticated, active admin;
//   2. adminHasPermission(actor, "can_manage_nearby") -- the
//      privilege-group Nearby permission;
//   3. adminCanManageEvent(actor, eventId) -- has_event_admin_authority
//      for the Event (Platform admin / Tenant admin / an admin_event_access
//      row for this Event).
//
// This is deliberately NOT a proof of the granular per-Event
// `event.nearby.manage` task grant: resolve_task_authority fails closed
// unless auth.uid() matches its actor argument and is not executable by
// the service-role client, so a route cannot check it. The granular grant
// is still enforced where it matters -- by event_nearby_places RLS
// (WITH CHECK has_event_task_authority('event.nearby.manage', event_id))
// and by every governed Nearby RPC. This gate only decides who may spend
// the Google Places budget. AdminRouteGuard in the browser is not, and
// was never, sufficient for that.

const fetchImpl: FetchLike = (input) => fetch(input);

type RequestBody = {
  eventId?: unknown;
  categoryCodes?: unknown;
  radiusMiles?: unknown;
  freeText?: unknown;
};

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

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
  if (!eventId) {
    return NextResponse.json(
      { error: "An eventId is required for a Nearby search." },
      { status: 400 },
    );
  }

  const categoryCodes = toStringArray(body.categoryCodes);
  const freeText =
    typeof body.freeText === "string" ? body.freeText.trim() : "";

  if (categoryCodes.length === 0 && !freeText) {
    return NextResponse.json(
      { error: "Select at least one place type, or enter a search term." },
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
          "Google nearby search is unavailable because its server credential is not configured.",
        code: "missing_google_maps_api_key",
      },
      { status: 500 },
    );
  }

  const supabaseAdmin = getSupabaseAdminClient();
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Nearby search service is not configured." },
      { status: 500 },
    );
  }

  const { data: event, error: eventError } = await supabaseAdmin
    .from("events")
    .select("id,location,lat,lng")
    .eq("id", eventId)
    .maybeSingle<{
      id: string;
      location: string | null;
      lat: number | null;
      lng: number | null;
    }>();

  if (eventError) {
    return NextResponse.json({ error: eventError.message }, { status: 500 });
  }
  if (!event) {
    return NextResponse.json({ error: "Event not found." }, { status: 404 });
  }

  const radiusMiles = normalizeRadiusMiles(body.radiusMiles);

  // Prefer the Event's stored, canonical coordinates. Only geocode the
  // location text when coordinates are genuinely missing.
  let lat = typeof event.lat === "number" ? event.lat : null;
  let lng = typeof event.lng === "number" ? event.lng : null;
  let originResolvedVia: "event_coordinates" | "geocoded_location" =
    "event_coordinates";

  if (lat === null || lng === null) {
    const locationText = event.location?.trim() || "";
    if (!locationText) {
      return NextResponse.json(
        {
          error:
            "This event has no stored coordinates and no location text to geocode.",
          code: "event_location_unavailable",
        },
        { status: 422 },
      );
    }

    const geocoded = await geocodeEventLocationViaGoogle(
      fetchImpl,
      apiKey,
      locationText,
    );

    if (!geocoded.ok) {
      const code = `google_geocoding_${geocoded.status.toLowerCase()}`;
      return NextResponse.json(
        {
          error:
            geocoded.status === "REQUEST_DENIED"
              ? "Google geocoding request was denied. Check the server Google Maps API configuration."
              : `Google could not resolve coordinates for the event location (${geocoded.status}).`,
          code,
        },
        { status: geocoded.httpStatus === 422 ? 422 : 502 },
      );
    }

    lat = geocoded.lat;
    lng = geocoded.lng;
    originResolvedVia = "geocoded_location";
  }

  // The selectable catalog is `place_categories`, never a list hard-coded
  // here. We only resolve the requested codes to their labels so the
  // type/keyword mapping has a label to fall back to.
  let categories: Array<{ code: string; label: string | null }> = [];
  if (categoryCodes.length > 0) {
    const { data: categoryRows, error: categoryError } = await supabaseAdmin
      .from("place_categories")
      .select("code,label")
      .eq("is_active", true)
      .in("code", categoryCodes);

    if (categoryError) {
      return NextResponse.json(
        { error: categoryError.message },
        { status: 500 },
      );
    }

    categories = (categoryRows || []) as Array<{
      code: string;
      label: string | null;
    }>;
  }

  const providerRequests = buildGoogleNearbyProviderRequests(
    categories,
    freeText || null,
  );

  if (providerRequests.length === 0) {
    return NextResponse.json(
      {
        error:
          "None of the selected place types could be resolved to a search.",
        code: "no_resolvable_categories",
      },
      { status: 400 },
    );
  }

  const fanOut = await runGoogleNearbyFanOut({
    fetchImpl,
    apiKey,
    lat,
    lng,
    radiusMiles,
    requests: providerRequests,
  });

  if (!fanOut.hadAnySuccess) {
    const firstFailure = fanOut.perRequest[0];
    return NextResponse.json(
      {
        error: `Google nearby search failed (${firstFailure?.status || "UNKNOWN_ERROR"}).`,
        code: `google_nearby_search_${(firstFailure?.status || "unknown_error").toLowerCase()}`,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    candidates: fanOut.candidates,
    debug: {
      eventId,
      categoryCodes,
      freeText: freeText || null,
      radiusMiles,
      originResolvedVia,
      lat,
      lng,
      perRequest: fanOut.perRequest,
    },
  });
}
