"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import MemberRouteGuard from "@/components/auth/MemberRouteGuard";

type Announcement = {
  id: string;
  title: string;
  message: string | null;
  category: string | null;
  priority: string | null;
  is_published?: boolean | null;
  created_at?: string | null;
  expires_at?: string | null;
};

type EventRow = {
  id?: string | null;
  name?: string | null;
  eventName?: string | null;
  venue_name?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;

  return d.toLocaleString();
}

function AnnouncementsPageInner() {
  const [event, setEvent] = useState<EventRow | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [status, setStatus] = useState("Loading announcements...");

  useEffect(() => {
    void loadAnnouncements();

    function handleStorage(e: StorageEvent) {
      if (e.key === "fcoc-member-event-changed") {
        void loadAnnouncements();
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  async function loadAnnouncements() {
    try {
      setStatus("Loading announcements...");

      const memberEvent = getCurrentMemberEvent();

      if (!memberEvent?.id) {
        setEvent(null);
        setAnnouncements([]);
        setStatus("No current event selected.");
        return;
      }

      setEvent(memberEvent);

      const { data, error } = await supabase
        .from("announcements")
        .select(
          "id,title,message,category,priority,is_published,created_at,expires_at",
        )
        .eq("event_id", memberEvent.id)
        .eq("is_published", true)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const now = Date.now();

      const activeAnnouncements = ((data || []) as Announcement[]).filter(
        (item) => {
          if (!item.expires_at) return true;

          const expires = new Date(item.expires_at).getTime();
          if (Number.isNaN(expires)) return true;

          return expires > now;
        },
      );

      setAnnouncements(activeAnnouncements);
      setStatus(
        `Loaded ${activeAnnouncements.length} announcement${activeAnnouncements.length === 1 ? "" : "s"}.`,
      );
    } catch (err: any) {
      console.error("loadAnnouncements error:", err);
      setAnnouncements([]);
      setStatus(err?.message || "Failed to load announcements.");
    }
  }

  const sortedAnnouncements = useMemo(() => {
    return [...announcements].sort((a, b) => {
      const aCreated = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bCreated = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bCreated - aCreated;
    });
  }, [announcements]);

  function priorityBadge(priority: string | null) {
    const value = (priority || "normal").toLowerCase();

    const styles: Record<string, React.CSSProperties> = {
      low: { background: "#eef2ff", color: "#3730a3" },
      normal: { background: "#f3f4f6", color: "#374151" },
      high: { background: "#fff7ed", color: "#c2410c" },
      urgent: { background: "#fef2f2", color: "#b91c1c" },
    };

    return (
      <span
        style={{
          padding: "4px 8px",
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 700,
          ...styles[value],
        }}
      >
        {priority || "normal"}
      </span>
    );
  }

  return (
    <div style={{ padding: 24, display: "grid", gap: 16 }}>
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "#f8f9fb",
          padding: 14,
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Announcements</h1>
        <div style={{ fontWeight: 700 }}>
          Current event: {event?.name || event?.eventName || "No current event"}
        </div>
        <div style={{ marginTop: 10, fontSize: 13, color: "#666" }}>
          {status}
        </div>
      </div>

      {sortedAnnouncements.length === 0 ? (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 16,
            color: "#666",
          }}
        >
          No announcements found.
        </div>
      ) : (
        sortedAnnouncements.map((item) => (
          <div
            key={item.id}
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              background: "white",
              padding: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 18 }}>{item.title}</div>
              {priorityBadge(item.priority)}
            </div>

            {item.category ? (
              <div style={{ marginTop: 6, fontSize: 13, color: "#555" }}>
                {item.category}
              </div>
            ) : null}

            {item.message ? (
              <div style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>
                {item.message}
              </div>
            ) : null}

            <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
              {item.created_at
                ? `Posted: ${formatDateTime(item.created_at)}`
                : ""}
              {item.created_at && item.expires_at ? " · " : ""}
              {item.expires_at
                ? `Expires: ${formatDateTime(item.expires_at)}`
                : ""}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default function AnnouncementsPage() {
  return (
    <MemberRouteGuard>
      <AnnouncementsPageInner />
    </MemberRouteGuard>
  );
}
