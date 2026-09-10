import "server-only";

import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";

export type PresentationSlot = "current" | "next";

export function isPresentationSlot(value: unknown): value is PresentationSlot {
  return value === "current" || value === "next";
}

type SlotPathRow = {
  content_ref_id: string | null;
  storage_path: string | null;
};

/**
 * Re-validates a presentation session's liveness and resolves the real
 * storage path for its "current" or "next" slot, fresh on every call. This
 * is the ONLY place a raw event-photos storage path is ever produced for an
 * anonymous-origin request, and it is deliberately not itself an HTTP
 * surface: it is importable only by server-only route code
 * (app/api/slideshow/presentation-image), and the underlying database
 * function it calls (`_resolve_live_presentation_slot_path`) grants EXECUTE
 * to `service_role` only -- neither `anon` nor `authenticated` may reach it.
 *
 * A browser never supplies a storage path, photo id, or Event id here --
 * only the opaque session id already visible in its own admitted slideshow
 * URL, and a fixed "current"/"next" slot label. Every other identifier is
 * re-derived here, server-side, from the live session state itself.
 */
export async function resolveLivePresentationSlotPath(
  sessionId: string,
  slot: PresentationSlot,
): Promise<{ contentRefId: string; storagePath: string } | null> {
  const admin = getSupabaseAdminClient();

  if (!admin) {
    return null;
  }

  const { data, error } = await admin
    .rpc("_resolve_live_presentation_slot_path", {
      p_session_id: sessionId,
      p_slot: slot,
    })
    .maybeSingle();

  const row = data as SlotPathRow | null;

  if (error || !row?.storage_path || !row?.content_ref_id) {
    return null;
  }

  return { contentRefId: row.content_ref_id, storagePath: row.storage_path };
}
