export function getAdminEvent() {
  if (typeof window === "undefined") return null;

  try {
    const stored = localStorage.getItem("fcoc-admin-event-context");
    if (!stored) return null;

    const parsed = JSON.parse(stored);

    return {
      id: parsed?.id || null,
      name: parsed?.name || parsed?.eventName || null,
      eventName: parsed?.eventName || parsed?.name || null,
      location: parsed?.location || null,
      venue_name: parsed?.venue_name || null,
      start_date: parsed?.start_date || null,
      end_date: parsed?.end_date || null,
    };
  } catch (err) {
    console.error("getAdminEvent error:", err);
    return null;
  }
}
