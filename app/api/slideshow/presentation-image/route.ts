import { NextResponse } from "next/server";

import { fetchPhotoRendition } from "@/lib/server/eventPhotoRendition";
import {
  isPresentationSlot,
  resolveLivePresentationSlotPath,
} from "@/lib/server/presentationAssetResolver";

// P0 Event-Photo Read-Surface Repair: the sole delivery path for the
// anonymous audience slideshow's current/next display image.
//
// The browser supplies only a presentation session id (already visible in
// its own admitted slideshow URL) and a fixed "current"/"next" slot label --
// never a storage path, photo id, or Event id. Every request re-validates
// the session's liveness and re-derives the real object to serve, fresh,
// through resolveLivePresentationSlotPath (which itself is backed by a
// database function reachable only via the service-role grant, never by
// anon or authenticated directly). The response is always a size-capped,
// re-encoded rendition -- never the stored original, and never a reusable
// Supabase storage signed URL. Because the session/slot check happens again
// on every single request, a captured/replayed URL stops working the
// instant the session ends or the slide advances past that slot -- there is
// no multi-hour bearer token in play anywhere in this path.

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 2048px on the long edge per the accepted P0 remediation specification §3.3.
const PRESENTATION_RENDITION_MAX_DIMENSION = 2048;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session");
  const slot = url.searchParams.get("slot");

  if (!isUuid(sessionId) || !isPresentationSlot(slot)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const resolved = await resolveLivePresentationSlotPath(sessionId, slot);

  if (!resolved) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }

  const rendition = await fetchPhotoRendition(
    resolved.storagePath,
    PRESENTATION_RENDITION_MAX_DIMENSION,
  );

  if (!rendition) {
    return NextResponse.json({ error: "rendition_unavailable" }, { status: 502 });
  }

  return new Response(rendition.bytes, {
    status: 200,
    headers: {
      "Content-Type": rendition.contentType,
      // Never cached beyond the immediate request -- the slide can advance
      // at any moment and this URL must not remain visually "correct" after
      // it does.
      "Cache-Control": "no-store",
    },
  });
}
