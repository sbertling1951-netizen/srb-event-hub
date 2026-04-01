export function getAdminEvent() {
  if (typeof window === "undefined") return null;

  try {
    const stored = localStorage.getItem("fcoc-admin-event-context");
    if (!stored) return null;

    const parsed = JSON.parse(stored);

    return {
      id: parsed?.id || null,
      name: parsed?.name || null,
    };
  } catch (err) {
    console.error("getAdminEvent error:", err);
    return null;
  }
}
