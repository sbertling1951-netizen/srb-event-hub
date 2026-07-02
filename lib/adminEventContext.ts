export const ADMIN_EVENT_KEY = "fcoc-admin-event-context";
export const ADMIN_EVENT_CHANGED_KEY = "fcoc-admin-event-changed";
export const ADMIN_EVENT_UPDATED = "fcoc-admin-event-updated";

export interface AdminWorkspaceContext {
  id: string;
  name?: string | null;
  eventName?: string | null;
  location?: string | null;
  venue_name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  updatedAt?: number;
  version?: 1;
}

export function getCurrentAdminEvent(): AdminWorkspaceContext | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = localStorage.getItem(ADMIN_EVENT_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error("Invalid admin event context", err);
    return null;
  }
}

export function setCurrentAdminEvent(event: AdminWorkspaceContext | null): void {
  if (typeof window === "undefined") {
    return;
  }

  if (!event) {
    localStorage.removeItem(ADMIN_EVENT_KEY);
  } else {
    localStorage.setItem(
      ADMIN_EVENT_KEY,
      JSON.stringify({
        ...event,
        updatedAt: Date.now(),
        version: 1,
      }),
    );
  }

  localStorage.setItem(ADMIN_EVENT_CHANGED_KEY, String(Date.now()));

  window.dispatchEvent(new CustomEvent(ADMIN_EVENT_UPDATED));
}

export function clearCurrentAdminEvent(): void {
  setCurrentAdminEvent(null);
}
