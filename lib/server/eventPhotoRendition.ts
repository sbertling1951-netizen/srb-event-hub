import "server-only";

import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";

const EVENT_PHOTOS_BUCKET = "event-photos";

// The internal signed URL this module mints is fetched by this same server
// process immediately and never returned to a caller -- 60 seconds is
// generous headroom for that one internal round trip, not a caller-facing
// access window.
const INTERNAL_SIGNING_TTL_SECONDS = 60;

export type PhotoRendition = {
  bytes: ArrayBuffer;
  contentType: string;
};

/**
 * Fetches a size-capped, re-encoded rendition of an already-authorized
 * `event-photos` object and returns its bytes directly to the caller's own
 * process memory.
 *
 * This function performs NO authorization decision of its own -- the caller
 * (a Route Handler) must have already established, through the requester's
 * own real session or a governed session/slot resolver, that this exact
 * `storagePath` is the one object this specific request is entitled to. The
 * elevated (service-role) storage client used here exists solely to reach a
 * `storage.objects` row this repair intentionally leaves with no anon or
 * broad-authenticated RLS grant; it is never used to make or skip the
 * authorization decision itself, matching the "no service-role bypass"
 * boundary the P0 specification requires. It never returns the intermediate
 * signed URL to any caller, and it never omits the `transform` option -- an
 * untransformed, byte-identical-to-original fetch is never performed by this
 * helper, by construction.
 */
export async function fetchPhotoRendition(
  storagePath: string,
  maxDimension: number,
): Promise<PhotoRendition | null> {
  const admin = getSupabaseAdminClient();

  if (!admin) {
    return null;
  }

  const { data, error } = await admin.storage
    .from(EVENT_PHOTOS_BUCKET)
    .createSignedUrl(storagePath, INTERNAL_SIGNING_TTL_SECONDS, {
      transform: {
        width: maxDimension,
        height: maxDimension,
        resize: "contain",
      },
    });

  if (error || !data?.signedUrl) {
    return null;
  }

  let response: Response;
  try {
    response = await fetch(data.signedUrl);
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const bytes = await response.arrayBuffer();

  return { bytes, contentType };
}
