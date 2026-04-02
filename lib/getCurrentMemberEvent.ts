export type CurrentMemberEvent = {
  id?: string | null;
  name?: string | null;
  eventName?: string | null;
  venue_name?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  event_code?: string | null;
  lat?: number | null;
  lng?: number | null;
};

export function getCurrentMemberEvent(): CurrentMemberEvent | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem("fcoc-member-event-context");
    if (!raw) return null;
    return JSON.parse(raw) as CurrentMemberEvent;
  } catch (err) {
    console.error("Could not read current member event:", err);
    return null;
  }
}
