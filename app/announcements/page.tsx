"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import MemberRouteGuard from "@/components/auth/MemberRouteGuard";

type MemberEventContext = {
  id?: string | null;
  name?: string | null;
  eventName?: string | null;
};

type Announcement = {
  id: string;
  event_id: string;
  title: string;
  body: string | null;
  category: string | null;
  priority: string;
  is_published: boolean;
  publish_at: string | null;
  expire_at: string | null;
  created_at: string;
  updated_at: string;
};

export default function AnnouncementsPage() {
  return (
    <MemberRouteGuard>
      <AnnouncementsPageInner />
    </MemberRouteGuard>
  );
}

function AnnouncementsPageInner() {
  const [eventName, setEventName] = useState("Current Event");
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [status, setStatus] = useState("Loading announcements...");
  const [filter, setFilter] = useState<"all" | "urgent" | "general">("all");

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
    setStatus("Loading announcements...");

    const memberEvent = getCurrentMemberEvent() as MemberEventContext | null;

    if (!memberEvent?.id) {
      setAnnouncements([]);
      setEventName("No current event");
      setStatus("No current event selected.");
      return;
    }

    setEventName(memberEvent.name || memberEvent.eventName || "Current Event");

    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("announcements")
      .select(
        "id,event_id,title,body,category,priority,is_published,publish_at,expire_at,created_at,updated_at",
      )
      .eq("event_id", memberEvent.id)
      .eq("is_published", true)
      .or(`publish_at.is.null,publish_at.lte.${now}`)
      .order("priority", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) {
      setAnnouncements([]);
      setStatus(`Could not load announcements: ${error.message}`);
      return;
    }

    const active = ((data || []) as Announcement[]).filter((item) => {
      if (!item.expire_at) return true;
      return item.expire_at > now;
    });

    setAnnouncements(active);
    setStatus(
      active.length === 0
        ? "No announcements at this time."
        : `Loaded ${active.length} announcements.`,
    );
  }

  const visibleAnnouncements = useMemo(() => {
    if (filter === "urgent") {
      return announcements.filter(
        (a) => a.priority === "urgent" || a.priority === "high",
      );
    }

    if (filter === "general") {
      return announcements.filter(
        (a) => a.priority !== "urgent" && a.priority !== "high",
      );
    }

    return announcements;
  }, [announcements, filter]);

  function priorityColor(priority: string) {
    if (priority === "urgent") return "#b91c1c";
    if (priority === "high") return "#c2410c";
    if (priority === "low") return "#4b5563";
    return "#2563eb";
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
        <div style={{ fontWeight: 700 }}>{eventName}</div>
        <div style={{ marginTop: 8, fontSize: 13, color: "#666" }}>
          {status}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => setFilter("all")}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: filter === "all" ? "#e5eefc" : "#fff",
            cursor: "pointer",
          }}
        >
          All
        </button>

        <button
          type="button"
          onClick={() => setFilter("urgent")}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: filter === "urgent" ? "#fee2e2" : "#fff",
            cursor: "pointer",
          }}
        >
          Urgent / High
        </button>

        <button
          type="button"
          onClick={() => setFilter("general")}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: filter === "general" ? "#f3f4f6" : "#fff",
            cursor: "pointer",
          }}
        >
          General
        </button>
      </div>

      {visibleAnnouncements.length === 0 ? (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 16,
            color: "#666",
          }}
        >
          No announcements to display.
        </div>
      ) : (
        visibleAnnouncements.map((item) => (
          <div
            key={item.id}
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              background: "white",
              padding: 16,
              display: "grid",
              gap: 8,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 18 }}>{item.title}</div>

            <div
              style={{
                fontSize: 12,
                color: priorityColor(item.priority),
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              {item.priority}
              {item.category ? ` · ${item.category}` : ""}
            </div>

            {item.body ? (
              <div style={{ whiteSpace: "pre-wrap", color: "#222" }}>
                {item.body}
              </div>
            ) : null}

            <div style={{ fontSize: 12, color: "#666" }}>
              Posted: {new Date(item.created_at).toLocaleString()}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
