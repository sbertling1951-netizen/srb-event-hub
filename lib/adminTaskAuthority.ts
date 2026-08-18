import { supabase } from "@/lib/supabase";

// Canonical Admin Event Task-Authority client wrapper -- Task-Authority
// Guard Design, section C-D. This is the one shared client entry point
// for the question "does the current admin hold this canonical Event
// task for this Event," reusing the already-governed, already
// fail-closed database function public.has_event_task_authority
// verbatim (COALESCE(...,false) at the SQL layer -- see
// 20260811170000_create_scoped_task_authority_foundation.sql). This
// module adds no authority logic of its own: it does not resolve,
// cache, retry, or reinterpret the RPC's answer, and it never widens a
// "false" or an error into "allowed."
//
// It replaces, for future callers, the inline call to the same RPC
// independently duplicated today in app/admin/agenda/page.tsx and
// app/admin/slideshow/page.tsx -- this module does not migrate either
// page; that remains a separate, explicitly authorized workstream per
// the guard design's own scope exclusions.

export type AdminTaskAuthorityResult =
  | { status: "no_event" }
  | { status: "allowed" }
  | { status: "denied" }
  | { status: "check_failed"; message: string };

/**
 * Asks the governed database resolver whether the current admin holds
 * `taskKey` for `eventId`. Never fetches or infers the current Event
 * itself -- callers supply an already-resolved Event ID (typically from
 * `getCurrentAdminEvent()`); this function establishes, changes, or
 * validates no Event context of its own.
 */
export async function checkAdminEventTaskAuthority(
  taskKey: string,
  eventId: string | null | undefined,
): Promise<AdminTaskAuthorityResult> {
  if (!eventId) {
    return { status: "no_event" };
  }

  const { data, error } = await supabase.rpc("has_event_task_authority", {
    p_task_key: taskKey,
    p_event_id: eventId,
  });

  // Fail closed: a check that could not be completed is never treated
  // as granted, mirroring the RPC's own COALESCE(...,false) discipline
  // at the client boundary too.
  if (error) {
    return { status: "check_failed", message: error.message };
  }

  return data ? { status: "allowed" } : { status: "denied" };
}
