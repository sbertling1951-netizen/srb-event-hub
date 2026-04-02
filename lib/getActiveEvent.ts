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

type MemberEventContext = {
  id?: string | null;
  name?: string | null;
  eventName?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

function getMemberEventFromStorage(): ActiveEvent | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem("fcoc-member-event-context");
    if (!raw) return null;

    const parsed = JSON.parse(raw) as MemberEventContext;

    if (!parsed?.id) return null;

    return {
      id: parsed.id,
      name: parsed.name || parsed.eventName || "Selected Event",
      location: parsed.location || null,
      start_date: parsed.start_date || null,
      end_date: parsed.end_date || null,
      map_image_url: null,
      master_map_id: null,
    };
  } catch (err) {
    console.error("Could not read member event context:", err);
    return null;
  }
}

export async function getActiveEvent(): Promise<ActiveEvent | null> {
  const memberEvent = getMemberEventFromStorage();
  if (memberEvent) {
    return memberEvent;
  }

  const { data, error } = await supabase
    .from("events")
    .select("id,name,location,start_date,end_date,map_image_url,master_map_id")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Could not load active event:", error.message);
    return null;
  }

  return data;
}
