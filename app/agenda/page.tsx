"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import { getAgendaColor } from "@/lib/agendaColors";

type MemberEvent = {
  id?: string | null;
  name?: string | null;
  eventName?: string | null;
  venue_name?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

type AgendaItem = {
  id: string;
  event_id: string;
  title: string | null;
  description: string | null;
  location: string | null;
  agenda_date: string | null;
  start_time: string | null;
  end_time: string | null;
  category: string | null;
  color: string | null;
  is_published: boolean | null;
  sort_order: number | null;
};

type GroupedAgenda = {
  key: string;
  label: string;
  items: AgendaItem[];
};

function formatDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
) {
  if (!startDate && !endDate) return "";
  if (startDate && endDate) {
    return `${formatDateOnly(startDate)} – ${formatDateOnly(endDate)}`;
  }
  return startDate
    ? formatDateOnly(startDate)
    : endDate
      ? formatDateOnly(endDate)
      : "";
}

function formatDateOnly(value: string) {
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value;

  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatGroupLabel(dateValue: string) {
  const d = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateValue;

  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function toDateTime(item: AgendaItem, which: "start" | "end") {
  const datePart = item.agenda_date || null;
  const timePart =
    which === "start" ? item.start_time || null : item.end_time || null;

  if (datePart && timePart) {
    const d = new Date(`${datePart}T${timePart}`);
    if (!Number.isNaN(d.getTime())) return d;
  }

  return null;
}

function formatItemTime(item: AgendaItem) {
  const start = toDateTime(item, "start");
  const end = toDateTime(item, "end");

  const fmt = (d: Date) =>
    d.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });

  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return fmt(start);
  if (end) return fmt(end);
  return "Time TBD";
}

function itemSortValue(item: AgendaItem) {
  const start = toDateTime(item, "start");
  if (start) return start.getTime();

  if (item.agenda_date) {
    const d = new Date(`${item.agenda_date}T23:59:59`);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }

  return Number.MAX_SAFE_INTEGER;
}

function getItemStatus(item: AgendaItem, now: Date) {
  const start = toDateTime(item, "start");
  const end = toDateTime(item, "end");

  if (start && end) {
    if (now >= start && now <= end) return "now";
    if (now < start) return "upcoming";
    return "past";
  }

  if (start) {
    if (now < start) return "upcoming";
    return "past";
  }

  return "unknown";
}

function groupAgenda(items: AgendaItem[]): GroupedAgenda[] {
  const map = new Map<string, AgendaItem[]>();

  items.forEach((item) => {
    const key = item.agenda_date || "unscheduled";
    const existing = map.get(key) || [];
    existing.push(item);
    map.set(key, existing);
  });

  return Array.from(map.entries())
    .sort(([a], [b]) => {
      if (a === "unscheduled") return 1;
      if (b === "unscheduled") return -1;
      return a.localeCompare(b);
    })
    .map(([key, groupedItems]) => ({
      key,
      label: key === "unscheduled" ? "Schedule TBD" : formatGroupLabel(key),
      items: groupedItems.sort((a, b) => {
        const timeDiff = itemSortValue(a) - itemSortValue(b);
        if (timeDiff !== 0) return timeDiff;
        return (a.sort_order || 0) - (b.sort_order || 0);
      }),
    }));
}

function categoryStyle(
  category: string | null | undefined,
  color: string | null | undefined,
) {
  return {
    display: "inline-block",
    padding: "3px 8px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    background: getAgendaColor(category, color),
    color: "#111827",
    border: "1px solid rgba(0,0,0,0.08)",
  } as const;
}

function normalizeCategory(value: string | null | undefined) {
  return (value || "").trim();
}

function highlightStyle(status: "now" | "upcoming" | "past" | "unknown") {
  if (status === "now") {
    return {
      border: "1px solid #86efac",
      background: "#f0fdf4",
      boxShadow: "0 2px 10px rgba(34,197,94,0.08)",
    };
  }

  if (status === "upcoming") {
    return {
      border: "1px solid #bfdbfe",
      background: "#eff6ff",
      boxShadow: "0 2px 10px rgba(59,130,246,0.06)",
    };
  }

  return {
    border: "1px solid #e5e7eb",
    background: "white",
    boxShadow: "none",
  };
}

function MemberAgendaPageInner() {
  const [event, setEvent] = useState<MemberEvent | null>(null);
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [status, setStatus] = useState("Loading agenda...");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    void loadAgenda();

    function handleStorage(e: StorageEvent) {
      if (e.key === "fcoc-member-event-changed") {
        void loadAgenda();
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTick(Date.now());
    }, 60_000);

    return () => window.clearInterval(timer);
  }, []);

  async function loadAgenda() {
    try {
      setStatus("Loading agenda...");

      const memberEvent = getCurrentMemberEvent();
      if (!memberEvent?.id) {
        setEvent(null);
        setItems([]);
        setStatus("No current event selected.");
        return;
      }

      setEvent(memberEvent);

      const { data, error } = await supabase
        .from("agenda_items")
        .select(
          "id,event_id,title,description,location,agenda_date,start_time,end_time,category,color,is_published,sort_order",
        )
        .eq("event_id", memberEvent.id)
        .eq("is_published", true)
        .order("agenda_date", { ascending: true, nullsFirst: false });

      if (error) throw error;

      const loaded = (data || []) as AgendaItem[];
      setItems(loaded);
      setStatus(
        loaded.length > 0
          ? `Loaded ${loaded.length} published agenda items.`
          : "No published agenda items yet.",
      );
    } catch (err: any) {
      console.error("loadAgenda error:", err);
      setItems([]);
      setStatus(err?.message || "Failed to load agenda.");
    }
  }

  const categories = useMemo(() => {
    const values = Array.from(
      new Set(
        items.map((item) => normalizeCategory(item.category)).filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b));

    return ["All", ...values];
  }, [items]);

  const filteredItems = useMemo(() => {
    if (selectedCategory === "All") return items;
    return items.filter(
      (item) => normalizeCategory(item.category) === selectedCategory,
    );
  }, [items, selectedCategory]);

  const groupedAgenda = useMemo(() => {
    return groupAgenda(filteredItems);
  }, [filteredItems]);

  const now = new Date(nowTick);

  const currentItem = useMemo(() => {
    return (
      filteredItems.find((item) => getItemStatus(item, now) === "now") || null
    );
  }, [filteredItems, now]);

  const nextItem = useMemo(() => {
    return (
      filteredItems
        .filter((item) => getItemStatus(item, now) === "upcoming")
        .sort((a, b) => itemSortValue(a) - itemSortValue(b))[0] || null
    );
  }, [filteredItems, now]);

  const dateRange = formatDateRange(event?.start_date, event?.end_date);

  return (
    <div style={{ padding: 24, display: "grid", gap: 16, maxWidth: 960 }}>
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "#f8f9fb",
          padding: 14,
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Agenda</h1>

        <div style={{ fontWeight: 700 }}>
          Current event: {event?.name || event?.eventName || "No current event"}
        </div>

        {event?.venue_name ? (
          <div style={{ color: "#555", marginTop: 4 }}>{event.venue_name}</div>
        ) : null}

        {event?.location ? (
          <div style={{ color: "#555", marginTop: 4 }}>{event.location}</div>
        ) : null}

        {dateRange ? (
          <div style={{ color: "#666", marginTop: 4, fontSize: 13 }}>
            {dateRange}
          </div>
        ) : null}

        <div style={{ marginTop: 10, fontSize: 13, color: "#666" }}>
          {status}
        </div>
      </div>

      {currentItem ? (
        <div
          style={{
            border: "1px solid #86efac",
            background: "#f0fdf4",
            borderRadius: 10,
            padding: 14,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 800, color: "#166534" }}>
            HAPPENING NOW
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>
            {currentItem.title || "Untitled item"}
          </div>
          <div style={{ color: "#374151", marginTop: 4 }}>
            {formatItemTime(currentItem)}
          </div>
          {currentItem.location ? (
            <div
              style={{
                fontSize: 12,
                color: "#475569",
                marginTop: 4,
                fontWeight: 500,
                letterSpacing: 0.2,
              }}
            >
              📍 {currentItem.location}
            </div>
          ) : null}
        </div>
      ) : nextItem ? (
        <div
          style={{
            border: "1px solid #bfdbfe",
            background: "#eff6ff",
            borderRadius: 10,
            padding: 14,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 800, color: "#1d4ed8" }}>
            UP NEXT
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>
            {nextItem.title || "Untitled item"}
          </div>
          <div style={{ color: "#374151", marginTop: 4 }}>
            {formatItemTime(nextItem)}
          </div>
          {nextItem.location ? (
            <div
              style={{
                fontSize: 12,
                color: "#475569",
                marginTop: 4,
                fontWeight: 500,
                letterSpacing: 0.2,
              }}
            >
              📍 {nextItem.location}
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
          padding: 12,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8 }}>
          Filter by category
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {categories.map((category) => {
            const active = selectedCategory === category;
            return (
              <button
                key={category}
                type="button"
                onClick={() => setSelectedCategory(category)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 999,
                  border: active ? "1px solid #2563eb" : "1px solid #d1d5db",
                  background: active ? "#dbeafe" : "#fff",
                  color: "#111827",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                {category}
              </button>
            );
          })}
        </div>
      </div>

      {groupedAgenda.length === 0 ? (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 16,
            color: "#666",
          }}
        >
          No agenda items available.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 18 }}>
          {groupedAgenda.map((group) => (
            <section key={group.key} style={{ display: "grid", gap: 10 }}>
              <div
                style={{
                  fontWeight: 800,
                  fontSize: 18,
                  color: "#111827",
                }}
              >
                {group.label}
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                {group.items.map((item) => {
                  const itemStatus = getItemStatus(item, now);
                  const cardStyle = highlightStyle(itemStatus);

                  return (
                    <div
                      key={item.id}
                      style={{
                        ...cardStyle,
                        borderRadius: 10,
                        padding: 14,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          alignItems: "start",
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 800, fontSize: 17 }}>
                            {item.title || "Untitled item"}
                          </div>

                          {item.location ? (
                            <div
                              style={{
                                fontSize: 12,
                                color: "#475569",
                                marginTop: 2,
                                fontWeight: 500,
                                letterSpacing: 0.2,
                              }}
                            >
                              📍 {item.location}
                            </div>
                          ) : null}

                          {item.description ? (
                            <div
                              style={{
                                marginTop: 8,
                                color: "#374151",
                                lineHeight: 1.45,
                                whiteSpace: "pre-wrap",
                              }}
                            >
                              {item.description}
                            </div>
                          ) : null}
                        </div>

                        <div
                          style={{
                            textAlign: "right",
                            minWidth: 110,
                            color: "#111827",
                            fontWeight: 700,
                          }}
                        >
                          {formatItemTime(item)}
                        </div>
                      </div>

                      <div
                        style={{
                          marginTop: 10,
                          display: "flex",
                          gap: 8,
                          flexWrap: "wrap",
                          alignItems: "center",
                        }}
                      >
                        {item.category ? (
                          <span
                            style={categoryStyle(item.category, item.color)}
                          >
                            {item.category}
                          </span>
                        ) : null}

                        {itemStatus === "now" ? (
                          <span
                            style={{
                              display: "inline-block",
                              padding: "3px 8px",
                              borderRadius: 999,
                              fontSize: 12,
                              fontWeight: 800,
                              background: "#dcfce7",
                              color: "#166534",
                            }}
                          >
                            Happening now
                          </span>
                        ) : null}

                        {itemStatus === "upcoming" ? (
                          <span
                            style={{
                              display: "inline-block",
                              padding: "3px 8px",
                              borderRadius: 999,
                              fontSize: 12,
                              fontWeight: 800,
                              background: "#dbeafe",
                              color: "#1d4ed8",
                            }}
                          >
                            Up next
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MemberAgendaPage() {
  return (
    <MemberRouteGuard>
      <MemberAgendaPageInner />
    </MemberRouteGuard>
  );
}
