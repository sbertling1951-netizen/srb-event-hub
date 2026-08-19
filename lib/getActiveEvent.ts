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

  // A missing Member context is an explicit selection state. Public pages
  // use host-scoped public discovery; this helper must never invent a global
  // active Event.
  if (!memberEvent?.id) {
    return null;
  }

  // Authenticated Members resolve Event context through canonical
  // Person/Participation continuity. Temporary Event Access (Event code +
  // registration email/phone) sets this same local memberEvent context but
  // never creates a Supabase session and holds no Participation link, so
  // it is not eligible for that RPC -- it resolves the same known Event id
  // through the public known-ID continuity path instead
  // (get_event_continuity_context), already anon+authenticated
  // EXECUTE-granted and gated by the identical visible_to_members/
  // is_active/status predicate Temporary Event Access admission itself
  // already requires (verify_member_event_login). Same pattern as the
  // Nearby (d36ad11) and Locations (5fc355e) reconciliations.
  const { data: sessionData } = await supabase.auth.getSession();
  const continuityRpc = sessionData?.session
    ? "get_my_member_event_continuity_context"
    : "get_event_continuity_context";

  const { data, error } = await supabase
    .rpc(continuityRpc, { p_event_id: memberEvent.id })
    .maybeSingle();

  if (error) {
    console.error("Could not load active event:", error.message);
    return null;
  }

  return data as ActiveEvent | null;
}
