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

  // A missing Member context is an explicit selection state. Public pages
  // use host-scoped public discovery; this helper must never invent a global
  // active Event.
  return null;
}
