"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import {
  getCurrentAdminAccess,
  canAccessEvent,
  hasPermission,
} from "@/lib/getCurrentAdminAccess";

type EventContext = {
  id?: string | null;
  name?: string | null;
  eventName?: string | null;
  venue_name?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

const ADMIN_EVENT_STORAGE_KEY = "fcoc-admin-event-context";

function getStoredAdminEvent(): EventContext | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(ADMIN_EVENT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as EventContext;
  } catch {
    return null;
  }
}

function formatDateRange(
  startDate?: string | null,
  endDate?: string | null,
): string {
  if (!startDate && !endDate) return "";
  if (startDate && endDate) return `${startDate} – ${endDate}`;
  return startDate || endDate || "";
}

function AdminDataReviewPageInner() {
  const router = useRouter();
  const [currentEvent, setCurrentEvent] = useState<EventContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Checking admin access...");

  useEffect(() => {
    async function init() {
      setLoading(true);
      setAccessDenied(false);
      setError(null);
      setStatus("Checking admin access...");

      const admin = await getCurrentAdminAccess();

      if (!admin) {
        setCurrentEvent(null);
        setAccessDenied(true);
        setError("No admin access.");
        setStatus("Access denied.");
        setLoading(false);
        return;
      }

      if (
        !hasPermission(admin, "can_edit_attendees") &&
        !hasPermission(admin, "can_manage_imports")
      ) {
        setCurrentEvent(null);
        setAccessDenied(true);
        setError("You do not have permission to use Data Review.");
        setStatus("Access denied.");
        setLoading(false);
        return;
      }

      const event = getStoredAdminEvent();

      if (!event?.id) {
        setCurrentEvent(null);
        setStatus("No admin event selected.");
        setLoading(false);
        return;
      }

      if (!canAccessEvent(admin, event.id)) {
        setCurrentEvent(null);
        setAccessDenied(true);
        setError("You do not have access to this event.");
        setStatus("Access denied.");
        setLoading(false);
        return;
      }

      setCurrentEvent(event);
      setStatus("Data Review now lives inside Attendee Management.");
      setLoading(false);
    }

    void init();

    function handleStorage(e: StorageEvent) {
      if (
        e.key === "fcoc-admin-event-context" ||
        e.key === "fcoc-admin-event-changed" ||
        e.key === "fcoc-user-mode" ||
        e.key === "fcoc-user-mode-changed"
      ) {
        void init();
      }
    }

    function handleAdminEventUpdated() {
      void init();
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener(
      "fcoc-admin-event-updated",
      handleAdminEventUpdated,
    );

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        "fcoc-admin-event-updated",
        handleAdminEventUpdated,
      );
    };
  }, []);

  if (!loading && accessDenied) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Data Review</h1>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          You do not have access to this page.
        </div>
      </div>
    );
  }

  const eventName =
    currentEvent?.name || currentEvent?.eventName || "No event selected";
  const eventLocation = currentEvent?.location || "";
  const eventDates = formatDateRange(
    currentEvent?.start_date,
    currentEvent?.end_date,
  );

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Data Review</h1>

        <div style={{ fontSize: 14, opacity: 0.8 }}>
          {eventName}
          {eventLocation ? ` • ${eventLocation}` : ""}
          {eventDates ? ` • ${eventDates}` : ""}
        </div>

        <div style={{ marginTop: 12, fontSize: 14 }}>{status}</div>
        {error ? <div style={errorBoxStyle}>{error}</div> : null}
      </div>

      <div className="card" style={{ padding: 18, display: "grid", gap: 14 }}>
        <div>
          <h2 style={{ marginTop: 0, marginBottom: 6 }}>
            Data Review has moved
          </h2>
          <div style={{ fontSize: 14, opacity: 0.85 }}>
            Review metrics, flagged records, and attendee correction tools now
            live inside <strong>Attendee Management</strong> so everything stays
            together on one page.
          </div>
        </div>

        <div style={infoBoxStyle}>
          Open <strong>Attendee Management</strong> to review flagged records,
          update statuses, and edit attendee details without switching pages.
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => router.push("/admin/attendees")}
            style={primaryButtonStyle}
          >
            Open Attendee Management
          </button>
        </div>
      </div>
    </div>
  );
}

const primaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const errorBoxStyle: CSSProperties = {
  marginTop: 12,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #e2b4b4",
  background: "#fff3f3",
  color: "#8a1f1f",
};

const infoBoxStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #bfdbfe",
  background: "#eff6ff",
  color: "#1d4ed8",
  fontSize: 14,
};

export default function AdminDataReviewPage() {
  return (
    <AdminRouteGuard requiredPermission="can_edit_attendees">
      <AdminDataReviewPageInner />
    </AdminRouteGuard>
  );
}
