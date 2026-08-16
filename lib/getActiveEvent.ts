import { getCurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import { supabase } from "@/lib/supabase";

export type ActiveEvent = {
  id: string;
  name: string;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  map_image_url: string | null;
  master_map_id: string | null;
};

export async function getActiveEvent(): Promise<ActiveEvent | null> {
  const memberEvent = getCurrentMemberEvent();

  // An established Member Event is read through the authenticated Person's
  // canonical Participation, preserving historical context without using
  // anonymous public continuity.
  if (memberEvent?.id) {
    const { data, error } = await supabase
      .rpc("get_my_member_event_continuity_context", { p_event_id: memberEvent.id })
      .maybeSingle();

    if (error) {
      console.error("Could not load active event:", error.message);
      return null;
    }

    return data as ActiveEvent | null;
  }

  // Active-event fallback branch (ADR-006 §3.2): no known Event id exists
  // here, so get_current_active_event applies the same is_active-only
  // predicate this direct read used, unchanged. That predicate still
  // differs from the canonical public-discovery rule (visible_to_members +
  // is_active + status) and whether to reconcile the two is an
  // unresolved, separate product decision -- not made here.
  const { data, error } = await supabase
    .rpc("get_current_active_event")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Could not load active event:", error.message);
    return null;
  }

  return data as ActiveEvent | null;
}
