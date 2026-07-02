import {
  ADMIN_EVENT_UPDATED,
  clearCurrentAdminEvent,
  getCurrentAdminEvent,
  setCurrentAdminEvent,
} from "@/lib/adminEventContext";

export { clearCurrentAdminEvent, getCurrentAdminEvent, setCurrentAdminEvent };

export function subscribeToAdminWorkspace(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener(ADMIN_EVENT_UPDATED, callback);

  return () => {
    window.removeEventListener(ADMIN_EVENT_UPDATED, callback);
  };
}

