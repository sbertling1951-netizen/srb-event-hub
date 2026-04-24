"use client";

import { useEffect, useMemo, useState } from "react";

import { getCurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import { supabase } from "@/lib/supabase";

type MemberEvent = {
  id: string;
  name?: string | null;
  venue_name?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

type AnnouncementRow = {
  id: string;
  event_id: string;
  title: string | null;
  body: string | null;
  priority: string | null;
  is_pinned: boolean | null;
  is_published: boolean | null;
  created_at: string | null;
  expire_at: string | null;
};

type Announcement = {
  id: string;
  event_id: string;
  title: string;
  message: string;
  priority: string;
  is_pinned: boolean;
  created_at: string | null;
  expires_at: string | null;
};

function isNotExpired(expiresAt?: string | null) {
  if (!expiresAt) {return true;}
  const time = new Date(expiresAt).getTime();
  if (Number.isNaN(time)) {return true;}
  return time > Date.now();
}

function formatDateTime(value?: string | null) {
  if (!value) {return "";}
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {return "";}
  return date.toLocaleString();
}

function priorityRank(priority?: string | null) {
  switch ((priority || "").toLowerCase()) {
    case "urgent":
      return 0;
    case "high":
      return 1;
    case "normal":
      return 2;
    case "low":
      return 3;
    default:
      return 2;
  }
}

function badgeStyle(priority?: string | null) {
  const value = (priority || "normal").toLowerCase();

  if (value === "urgent") {
    return {
      background: "#fff1f2",
      color: "#991b1b",
      border: "1px solid #fecdd3",
    };
  }

  if (value === "high") {
    return {
      background: "#fff7ed",
      color: "#9a3412",
      border: "1px solid #fed7aa",
    };
  }

  if (value === "low") {
    return {
      background: "#f8fafc",
      color: "#334155",
      border: "1px solid #cbd5e1",
    };
  }

  return {
    background: "#eff6ff",
    color: "#1d4ed8",
    border: "1px solid #bfdbfe",
  };
}

export default function Page() {
  const [event, setEvent] = useState<MemberEvent | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Loading announcements...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadPage() {
      setLoading(true);
      setError(null);
      setStatus("Loading announcements...");

      try {
        const currentEvent = await getCurrentMemberEvent();

        if (!mounted) {return;}

        if (!currentEvent?.id) {
          setEvent(null);
          setAnnouncements([]);
          setStatus("No active event selected.");
          setLoading(false);
          return;
        }

        if (!currentEvent?.id) {return;}

        setEvent({
          id: currentEvent.id,
          name: currentEvent.name ?? null,
        });

        const { data, error } = await supabase
          .from("announcements")
          .select(
            "id, event_id, title, body, priority, is_pinned, is_published, created_at, expire_at",
          )
          .eq("event_id", currentEvent.id)
          .eq("is_published", true)
          .order("created_at", { ascending: false });

        if (!mounted) {return;}

        if (error) {
          setError(error.message);
          setAnnouncements([]);
          setStatus("Could not load announcements.");
          setLoading(false);
          return;
        }

        const normalized: Announcement[] = ((data || []) as AnnouncementRow[])
          .map((item) => ({
            id: item.id,
            event_id: item.event_id,
            title: item.title ?? "Untitled",
            message: item.body ?? "",
            priority: (item.priority ?? "normal").toLowerCase(),
            is_pinned: !!item.is_pinned,
            created_at: item.created_at ?? null,
            expires_at: item.expire_at ?? null,
          }))
          .filter((item) => isNotExpired(item.expires_at));

        setAnnouncements(normalized);
        setStatus("");
        setLoading(false);
      } catch (err) {
        if (!mounted) {return;}
        setError(err instanceof Error ? err.message : "Unknown error");
        setAnnouncements([]);
        setStatus("Could not load announcements.");
        setLoading(false);
      }
    }

    loadPage();

    return () => {
      mounted = false;
    };
  }, []);

  const sortedAnnouncements = useMemo(() => {
    return [...announcements].sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) {return a.is_pinned ? -1 : 1;}

      const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority);
      if (priorityDiff !== 0) {return priorityDiff;}

      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bTime - aTime;
    });
  }, [announcements]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Announcements</h1>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          {event?.name || "Current Event"}
          {event?.location ? ` • ${event.location}` : ""}
        </div>
      </div>

      {status ? (
        <div className="card" style={{ padding: 18 }}>
          {status}
        </div>
      ) : null}

      {error ? (
        <div
          className="card"
          style={{
            padding: 18,
            border: "1px solid #f5c2c7",
            background: "#fff5f5",
            color: "#842029",
          }}
        >
          {error}
        </div>
      ) : null}

      {!loading && !error && sortedAnnouncements.length === 0 ? (
        <div className="card" style={{ padding: 18 }}>
          No announcements have been posted for this event yet.
        </div>
      ) : null}

      {!loading && sortedAnnouncements.length > 0 ? (
        <div style={{ display: "grid", gap: 12 }}>
          {sortedAnnouncements.map((announcement) => (
            <div
              key={announcement.id}
              className="card"
              style={{
                padding: 18,
                background: announcement.is_pinned ? "#fffdf3" : undefined,
                border: announcement.is_pinned
                  ? "1px solid #f5e6a8"
                  : "1px solid transparent",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  marginBottom: 10,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 18 }}>
                  {announcement.title}
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span
                    style={{
                      padding: "4px 8px",
                      borderRadius: 999,
                      fontSize: 12,
                      ...badgeStyle(announcement.priority),
                    }}
                  >
                    {announcement.priority || "normal"}
                  </span>

                  {announcement.is_pinned ? (
                    <span
                      style={{
                        padding: "4px 8px",
                        borderRadius: 999,
                        fontSize: 12,
                        background: "#fff8db",
                        color: "#7c5e10",
                        border: "1px solid #f2d675",
                      }}
                    >
                      Pinned
                    </span>
                  ) : null}
                </div>
              </div>

              <div
                style={{
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.5,
                  marginBottom: 10,
                }}
              >
                {announcement.message}
              </div>

              <div style={{ fontSize: 13, opacity: 0.7 }}>
                {announcement.created_at
                  ? `Posted ${formatDateTime(announcement.created_at)}`
                  : "Posted recently"}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
