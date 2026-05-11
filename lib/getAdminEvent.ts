import { APP_EVENT_NAMES, STORAGE_KEYS } from "@/lib/storageKeys";

export type AdminEventContext = {
  id: string;
  name: string | null;
  location: string | null;
  venue_name: string | null;
  start_date: string | null;
  end_date: string | null;
};

type StoredAdminEventContext = Partial<
  AdminEventContext & { eventName?: string | null }
>;

export function getAdminEvent(): AdminEventContext | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEYS.adminEventContext);
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored) as StoredAdminEventContext;

    if (!parsed.id) {
      return null;
    }

    return {
      id: parsed.id,
      name: parsed.name || parsed.eventName || null,
      location: parsed.location || null,
      venue_name: parsed.venue_name || null,
      start_date: parsed.start_date || null,
      end_date: parsed.end_date || null,
    };
  } catch (err) {
    console.error("getAdminEvent error:", err);
    return null;
  }
}

export function setAdminEvent(event: AdminEventContext | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (!event) {
    localStorage.removeItem(STORAGE_KEYS.adminEventContext);
    localStorage.setItem(STORAGE_KEYS.adminEventChanged, String(Date.now()));
    window.dispatchEvent(new CustomEvent(APP_EVENT_NAMES.adminEventUpdated));
    return;
  }

  const payload: AdminEventContext = {
    id: event.id,
    name: event.name || null,
    location: event.location || null,
    venue_name: event.venue_name || null,
    start_date: event.start_date || null,
    end_date: event.end_date || null,
  };

  localStorage.setItem(STORAGE_KEYS.adminEventContext, JSON.stringify(payload));
  localStorage.setItem(STORAGE_KEYS.adminEventChanged, String(Date.now()));
  window.dispatchEvent(new CustomEvent(APP_EVENT_NAMES.adminEventUpdated));
}
