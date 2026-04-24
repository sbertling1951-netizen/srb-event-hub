"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { getCurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import { supabase } from "@/lib/supabase";

type BannerAnnouncement = {
  id: string;
  title: string;
  message: string;
  is_pinned: boolean;
  priority: string | null;
  is_published: boolean;
  created_at: string | null;
  expire_at: string | null;
};

function isNotExpired(expireAt?: string | null) {
  if (!expireAt) {return true;}
  return new Date(expireAt).getTime() > Date.now();
}

function isRecent(value: string | null) {
  if (!value) {return false;}
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) {return false;}
  return Date.now() - ts <= 24 * 60 * 60 * 1000;
}

function isImportant(priority: string | null) {
  const value = (priority || "").toLowerCase();
  return value === "high" || value === "urgent";
}

function getPriorityRank(item: {
  priority: string | null;
  is_pinned: boolean;
  created_at: string | null;
}) {
  const priority = (item.priority || "normal").toLowerCase();

  if (item.is_pinned && priority === "urgent") {return 100;}
  if (priority === "urgent") {return 90;}
  if (item.is_pinned && priority === "high") {return 80;}
  if (priority === "high") {return 70;}
  if (item.is_pinned && priority === "normal") {return 60;}
  if (priority === "normal") {return 50;}
  if (item.is_pinned && priority === "low") {return 40;}
  return 30;
}

export default function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<BannerAnnouncement | null>(
    null,
  );
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [showPopup, setShowPopup] = useState(false);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      const memberEvent = (await getCurrentMemberEvent()) as {
        id?: string | null;
      } | null;

      const eventId = memberEvent?.id || null;
      setActiveEventId(eventId);

      if (eventId) {
        await loadBanner(eventId);
      } else {
        setAnnouncement(null);
        setShowPopup(false);
      }
    }

    void init();
  }, []);

  useEffect(() => {
    if (!activeEventId) {return;}

    const channel = supabase
      .channel(`announcements-realtime-${activeEventId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "announcements",
          filter: `event_id=eq.${activeEventId}`,
        },
        async () => {
          await loadBanner(activeEventId);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeEventId]);

  useEffect(() => {
    if (!announcement) {return;}
    if (!isImportant(announcement.priority)) {return;}

    const popupKey = `announcement-popup-seen-${announcement.id}`;
    const alreadySeen =
      typeof window !== "undefined" &&
      localStorage.getItem(popupKey) === "true";

    if (!alreadySeen) {
      setShowPopup(true);

      if (typeof window !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(50);
      }

      localStorage.setItem(popupKey, "true");
    }
  }, [announcement]);

  async function loadBanner(eventId: string) {
    const { data, error } = await supabase
      .from("announcements")
      .select(
        "id,title,body,is_pinned,priority,is_published,created_at,expire_at",
      )
      .eq("event_id", eventId)
      .eq("is_published", true)
      .or(`expire_at.is.null,expire_at.gt.${new Date().toISOString()}`);

    if (error) {
      console.error("Error loading banner:", error);
      setAnnouncement(null);
      setShowPopup(false);
      return;
    }

    const active =
      (
        (data || []).map(
          (item: any): BannerAnnouncement => ({
            id: item.id,
            title: item.title ?? "",
            message: item.body ?? "",
            is_pinned: !!item.is_pinned,
            priority: item.priority ?? null,
            is_published: !!item.is_published,
            created_at: item.created_at ?? null,
            expire_at: item.expire_at ?? null,
          }),
        ) as BannerAnnouncement[]
      )
        .filter((item) => isNotExpired(item.expire_at))
        .sort((a, b) => {
          const rankDiff = getPriorityRank(b) - getPriorityRank(a);
          if (rankDiff !== 0) {return rankDiff;}

          const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
          return bTime - aTime;
        })[0] || null;

    if (active) {
      setAnnouncement(active);
    } else {
      setAnnouncement(null);
      setShowPopup(false);
    }
  }

  const hidden = useMemo(() => {
    if (!announcement) {return true;}
    if (announcement.is_pinned && isImportant(announcement.priority))
      {return false;}
    return dismissedIds.includes(announcement.id);
  }, [announcement, dismissedIds]);

  if (!announcement) {return null;}

  const recent = isRecent(announcement.created_at);
  const important = isImportant(announcement.priority);
  const canDismissPopup = !(important && announcement.is_pinned);
  const canDismissBanner = !(important && announcement.is_pinned);

  return (
    <>
      {!hidden && (
        <div
          style={{
            background:
              announcement.priority?.toLowerCase() === "urgent"
                ? "#fff1f2"
                : important
                  ? "#fff7e6"
                  : "#eef5ff",
            borderBottom:
              announcement.priority?.toLowerCase() === "urgent"
                ? "2px solid #dc2626"
                : important
                  ? "1px solid #f59e0b"
                  : "1px solid #d6d6d6",
            padding: "10px 16px",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontWeight: 700 }}>
                {important ? "⚠️ Alert" : "📢 Announcement"}
              </span>

              {announcement.is_pinned && (
                <span
                  style={{
                    background: "#111827",
                    color: "white",
                    borderRadius: 999,
                    padding: "2px 8px",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  PINNED
                </span>
              )}

              {recent && (
                <span
                  style={{
                    background: "#dc2626",
                    color: "white",
                    borderRadius: 999,
                    padding: "2px 8px",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  NEW
                </span>
              )}

              <span style={{ fontWeight: 700 }}>{announcement.title}</span>

              <Link
                href="/member/announcements"
                style={{
                  color: "#0b5cff",
                  textDecoration: "underline",
                  fontWeight: 600,
                }}
              >
                Open
              </Link>
            </div>

            {canDismissBanner && (
              <button
                type="button"
                onClick={() =>
                  setDismissedIds((prev) =>
                    prev.includes(announcement.id)
                      ? prev
                      : [...prev, announcement.id],
                  )
                }
                style={{
                  border: "1px solid #bbb",
                  background: "white",
                  borderRadius: 6,
                  padding: "4px 8px",
                  cursor: "pointer",
                }}
              >
                Dismiss
              </button>
            )}
          </div>

          <div
            style={{
              marginTop: 6,
              fontSize: 14,
              color: "#374151",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {announcement.message || ""}
          </div>
        </div>
      )}

      {showPopup && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 5000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              width: "min(560px, 100%)",
              background: "white",
              borderRadius: 14,
              boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                background: important ? "#fff4d6" : "#eef5ff",
                padding: "14px 16px",
                borderBottom: "1px solid #e5e7eb",
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 18 }}>
                {important ? "⚠️ Important Announcement" : "📢 Announcement"}
              </div>

              {announcement.is_pinned && (
                <span
                  style={{
                    background: "#111827",
                    color: "white",
                    borderRadius: 999,
                    padding: "2px 8px",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  PINNED
                </span>
              )}

              {recent && (
                <span
                  style={{
                    background: "#dc2626",
                    color: "white",
                    borderRadius: 999,
                    padding: "2px 8px",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  NEW
                </span>
              )}
            </div>

            <div style={{ padding: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 10 }}>
                {announcement.title}
              </div>

              {announcement.created_at && (
                <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>
                  {new Date(announcement.created_at).toLocaleString()}
                </div>
              )}

              <div
                style={{
                  whiteSpace: "pre-wrap",
                  color: "#333",
                  marginBottom: 16,
                }}
              >
                {announcement.message || ""}
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Link
                  href="/member/announcements"
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    background: "#0b5cff",
                    color: "white",
                    textDecoration: "none",
                    fontWeight: 600,
                  }}
                  onClick={() => setShowPopup(false)}
                >
                  View All Announcements
                </Link>

                {canDismissPopup && (
                  <button
                    type="button"
                    onClick={() => setShowPopup(false)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid #ccc",
                      background: "white",
                      cursor: "pointer",
                    }}
                  >
                    Dismiss
                  </button>
                )}
              </div>

              {!canDismissPopup && (
                <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
                  This alert is pinned and cannot be dismissed.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
