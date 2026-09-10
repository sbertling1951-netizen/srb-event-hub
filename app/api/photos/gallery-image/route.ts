import { NextResponse } from "next/server";

import { createAuthenticatedUserClient } from "@/lib/server/authenticatedUserClient";
import { resolveAuthenticatedRequest } from "@/lib/server/authenticationBoundary";
import { fetchPhotoRendition } from "@/lib/server/eventPhotoRendition";

// P0 Event-Photo Read-Surface Repair: the governed delivery path for
// ordinary gallery viewing of an APPROVED event photo.
//
// This is not a general file proxy. The only inputs are a photoId (a
// database id, never a storage path) and a controlled `variant` label; every
// other fact -- whether the caller may see this photo at all, what its real
// storage path is, and what transform dimensions apply -- is resolved
// entirely server-side, never accepted as a caller-supplied width, height,
// resize mode, or raw parameter. Authorization is decided by the caller's
// own real, RLS-scoped session (createAuthenticatedUserClient forwards the
// caller's own bearer token -- this is never a service-role client making
// the authorization decision): the repaired event_photos SELECT policy
// (event_photos_event_scoped_approved_select_policy /
// event_photos_owner_or_admin_select_policy, 20261010000000) is the actual
// boundary, not this route's own logic. Only once that lookup has already
// succeeded does this route call a size-capped, re-encoded rendition helper
// that internally uses elevated storage access strictly to fetch the one
// object already proven authorized -- it never returns a storage signed URL
// or the untransformed original to the browser.
//
// Non-approved (pending/rejected) photos are deliberately out of this
// route's scope -- a contributor's own pending/rejected preview keeps using
// the existing, unchanged, is_own_attendee-gated direct signed-URL path in
// app/member/photos/page.tsx.

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// The only two presentation variants this route knows how to serve. The
// caller names an intent ("grid" or "full"); the route -- never the
// browser -- owns the actual transform dimensions. 240px matches the
// existing grid tile size (app/member/photos/page.tsx's own 140px CSS grid
// cell plus normal device-pixel-ratio headroom); 1600px is the P0
// remediation specification's §3.2 full-view cap.
const GALLERY_VARIANT_MAX_DIMENSION = {
  grid: 240,
  full: 1600,
} as const;

type GalleryVariant = keyof typeof GALLERY_VARIANT_MAX_DIMENSION;

function isGalleryVariant(value: unknown): value is GalleryVariant {
  return value === "grid" || value === "full";
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function deniedResponse() {
  // Deliberately identical for "not found," "not approved," and "not
  // authorized" -- this route must not let a caller distinguish those
  // cases, exactly as the underlying RLS policy itself is non-enumerating.
  return NextResponse.json({ error: "photo_unavailable" }, { status: 404 });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const photoId = url.searchParams.get("photoId");
  const variant = url.searchParams.get("variant");

  // Explicit route-owned rule: a missing or unrecognized variant is
  // rejected outright, never silently defaulted to either size -- an
  // absent/unknown intent must not resolve to the larger (1600px) rendition
  // by accident, and this route accepts no other way to express intent.
  if (!isUuid(photoId) || !isGalleryVariant(variant)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const authResolution = await resolveAuthenticatedRequest(request.headers);

  if (authResolution.state === "internal_error") {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  if (authResolution.state === "unauthenticated") {
    return deniedResponse();
  }

  const supabase = createAuthenticatedUserClient(authResolution.credential);

  if (!supabase) {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  const { data: photo, error } = await supabase
    .from("event_photos")
    .select("id, storage_path, photo_status")
    .eq("id", photoId)
    .eq("photo_status", "approved")
    .maybeSingle();

  if (error) {
    console.error("gallery-image: event_photos lookup failed:", {
      code: error.code,
      message: error.message,
    });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  if (!photo?.storage_path) {
    return deniedResponse();
  }

  const rendition = await fetchPhotoRendition(
    photo.storage_path,
    GALLERY_VARIANT_MAX_DIMENSION[variant],
  );

  if (!rendition) {
    return NextResponse.json({ error: "rendition_unavailable" }, { status: 502 });
  }

  return new Response(rendition.bytes, {
    status: 200,
    headers: {
      "Content-Type": rendition.contentType,
      // Short, private cache only -- this is not a stable, reusable URL by
      // design (it re-authorizes on every request).
      "Cache-Control": "private, max-age=60",
    },
  });
}
