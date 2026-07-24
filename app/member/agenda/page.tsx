"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import { getAgendaColor } from "@/lib/agendaColors";
import { logEngagement } from "@/lib/engagement";
import { useMemberWorkspace } from "@/lib/memberWorkspace";
import { supabase } from "@/lib/supabase";

type MemberEvent = {
  id: string;
  name: string | null;
  venue_name: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
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
  if (!startDate && !endDate) {
    return "";
  }
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
  if (Number.isNaN(d.getTime())) {
    return value;
  }

  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatGroupLabel(dateValue: string) {
  const d = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(d.getTime())) {
    return dateValue;
  }

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
    if (!Number.isNaN(d.getTime())) {
      return d;
    }
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

  if (start && end) {
    return `${fmt(start)} – ${fmt(end)}`;
  }
  if (start) {
    return fmt(start);
  }
  if (end) {
    return fmt(end);
  }
  return "Time TBD";
}

function itemSortValue(item: AgendaItem) {
  const start = toDateTime(item, "start");
  if (start) {
    return start.getTime();
  }

  if (item.agenda_date) {
    const d = new Date(`${item.agenda_date}T23:59:59`);
    if (!Number.isNaN(d.getTime())) {
      return d.getTime();
    }
  }

  return Number.MAX_SAFE_INTEGER;
}

function getItemStatus(item: AgendaItem, now: Date) {
  const start = toDateTime(item, "start");
  const end = toDateTime(item, "end");

  if (start && end) {
    if (now >= start && now <= end) {
      return "now";
    }
    if (now < start) {
      return "upcoming";
    }
    return "past";
  }

  if (start) {
    if (now < start) {
      return "upcoming";
    }
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
      if (a === "unscheduled") {
        return 1;
      }
      if (b === "unscheduled") {
        return -1;
      }
      return a.localeCompare(b);
    })
    .map(([key, groupedItems]) => ({
      key,
      label: key === "unscheduled" ? "Schedule TBD" : formatGroupLabel(key),
      items: groupedItems.sort((a, b) => {
        const timeDiff = itemSortValue(a) - itemSortValue(b);
        if (timeDiff !== 0) {
          return timeDiff;
        }
        return (a.sort_order || 0) - (b.sort_order || 0);
      }),
    }));
}

function categoryStyle(resolvedColor: string | null | undefined) {
  const background = sanitizeAgendaCardColor(resolvedColor);

  return {
    display: "inline-block",
    padding: "3px 8px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    background,
    color: "#111827",
    border: "1px solid rgba(0,0,0,0.12)",
  } as const;
}

function normalizeCategory(value: string | null | undefined) {
  return (value || "").trim();
}

function sanitizeAgendaCardColor(color: string | null | undefined) {
  const fallback = "#f8fafc";
  const value = (color || "").trim().toLowerCase();

  if (!value) {
    return fallback;
  }

  const reservedGreens = new Set([
    "green",
    "#f0fdf4",
    "#dcfce7",
    "#bbf7d0",
    "#86efac",
    "#4ade80",
    "#22c55e",
    "#16a34a",
    "#15803d",
    "#166534",
    "rgb(240, 253, 244)",
    "rgb(220, 252, 231)",
    "rgb(187, 247, 208)",
    "rgb(134, 239, 172)",
    "rgb(74, 222, 128)",
    "rgb(34, 197, 94)",
    "rgb(22, 163, 74)",
  ]);

  if (reservedGreens.has(value)) {
    return fallback;
  }

  if (value.startsWith("#") && value.length === 7) {
    return `${value}20`; // ~12% opacity
  }

  return color || fallback;
}

function agendaCardStyle(
  item: AgendaItem,
  status: "now" | "upcoming" | "past" | "unknown",
  resolvedColor: string | null | undefined,
) {
  if (status === "now") {
    return {
      border: "2px solid #16a34a",
      background: "#dcfce7",
      boxShadow: "0 3px 12px rgba(34,197,94,0.18)",
      color: "#064e3b",
    };
  }

  if (status === "past") {
    return {
      border: "1px solid #d1d5db",
      background: "#f3f4f6",
      boxShadow: "none",
      color: "#4b5563",
    };
  }

  return {
    border: "1px solid #dbe4ef",
    borderLeft: "5px solid #93c5fd",
    background: sanitizeAgendaCardColor(resolvedColor),
    boxShadow: "0 1px 4px rgba(15,23,42,0.05)",
    color: "#111827",
  };
}

function MemberAgendaPageInner() {
  const {
    event: workspaceEvent,
    attendeeId,
    isReady,
  } = useMemberWorkspace();
  const [event, setEvent] = useState<MemberEvent | null>(null);
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [status, setStatus] = useState("Loading agenda...");
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [expandedPastItems, setExpandedPastItems] = useState<
    Record<string, boolean>
  >({});
  const [expandedDescriptions, setExpandedDescriptions] = useState<
    Record<string, boolean>
  >({});

  const loadAgenda = useCallback(async () => {
    try {
      setError(null);
      setStatus("Loading agenda...");

      setItems([]);

      if (!workspaceEvent?.id) {
        setEvent(null);
        setItems([]);
        setError(null);
        setStatus("No current event selected.");
        return;
      }

      setEvent({
        id: workspaceEvent.id,
        name: workspaceEvent.name ?? null,
        venue_name: workspaceEvent.venue_name ?? null,
        location: workspaceEvent.location ?? null,
        start_date: workspaceEvent.start_date ?? null,
        end_date: workspaceEvent.end_date ?? null,
      });

      const { data, error } = await supabase
        .from("agenda_items")
        .select(
          "id,event_id,title,description,location,agenda_date,start_time,end_time,category,color,is_published,sort_order",
        )
        .eq("event_id", workspaceEvent.id)
        .eq("is_published", true)
        .order("agenda_date", { ascending: true, nullsFirst: false });

      if (error) {
        throw error;
      }

      const loaded = (data || []) as AgendaItem[];

      setItems(loaded);
      setError(null);
      setStatus(
        loaded.length > 0
          ? `Loaded ${loaded.length} published agenda items.`
          : "No published agenda items yet.",
      );
    } catch (err) {
      console.error("loadAgenda error:", err);
      setEvent(null);
      setItems([]);
      setError(err instanceof Error ? err.message : "Failed to load agenda.");
      setStatus("");
    }
  }, [workspaceEvent]);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    void loadAgenda();
  }, [isReady, loadAgenda]);

  useEffect(() => {
    if (!event?.id || !attendeeId) {
      return;
    }

    void logEngagement({
      eventId: event.id,
      attendeeId,
      activityType: "agenda_view",
    });
  }, [attendeeId, event?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTick(Date.now());
    }, 60_000);

    return () => window.clearInterval(timer);
  }, []);

  function togglePastItem(itemId: string) {
    setExpandedPastItems((prev) => ({
      ...prev,
      [itemId]: !prev[itemId],
    }));
  }
  function toggleDescription(itemId: string) {
    setExpandedDescriptions((prev) => ({
      ...prev,
      [itemId]: !prev[itemId],
    }));
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
    if (selectedCategory === "All") {
      return items;
    }
    return items.filter(
      (item) => normalizeCategory(item.category) === selectedCategory,
    );
  }, [items, selectedCategory]);

  const groupedAgenda = useMemo(() => {
    return groupAgenda(filteredItems);
  }, [filteredItems]);

  const now = useMemo(() => new Date(nowTick), [nowTick]);

  const currentItem = useMemo(() => {
    return items.find((item) => getItemStatus(item, now) === "now") || null;
  }, [items, now]);

  const nextItem = useMemo(() => {
    return (
      items
        .filter((item) => getItemStatus(item, now) === "upcoming")
        .sort((a, b) => itemSortValue(a) - itemSortValue(b))[0] || null
    );
  }, [items, now]);

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
          Current event: {event?.name || "No current event"}
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

        {status ? (
          <div style={{ marginTop: 10, fontSize: 13, color: "#666" }}>
            {status}
          </div>
        ) : null}
      </div>

      {error ? (
        <div
          style={{
            border: "1px solid #f5c2c7",
            background: "#fff5f5",
            color: "#842029",
            borderRadius: 10,
            padding: 14,
          }}
        >
          {error}
        </div>
      ) : null}

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
            border: "1px solid #dbe4ef",
            background: "#f8fbff",
            borderRadius: 10,
            padding: 14,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 800, color: "#475569" }}>
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
          {groupedAgenda.map((group) => {
            // Partition items into Morton, Pioneer, Other
            const mortonItems = group.items.filter((item) =>
              (item.location || "").toLowerCase().includes("morton"),
            );
            const pioneerOnly = group.items.filter(
              (item) =>
                (item.location || "").toLowerCase().includes("pioneer") &&
                !(item.location || "").toLowerCase().includes("morton"),
            );
            const otherItems = group.items.filter(
              (item) =>
                !(item.location || "").toLowerCase().includes("morton") &&
                !(item.location || "").toLowerCase().includes("pioneer"),
            );
            const pioneerItems = [...pioneerOnly, ...otherItems];
            const timeSlotKeys = Array.from(
              new Set(
                [...mortonItems, ...pioneerItems].map(
                  (item) => item.start_time || "unscheduled",
                ),
              ),
            ).sort((a, b) => {
              if (a === "unscheduled") return 1;
              if (b === "unscheduled") return -1;
              return a.localeCompare(b);
            });

            // Helper to render agenda cards
            function renderAgendaCards(items: AgendaItem[]) {
              if (items.length === 0) {
                return (
                  <div
                    style={{
                      color: "#888",
                      fontSize: 13,
                      padding: "8px 0",
                      textAlign: "center",
                    }}
                  >
                    No scheduled items.
                  </div>
                );
              }
              return items.map((item) => {
                const itemStatus = getItemStatus(item, now);
                const resolvedAgendaColor = getAgendaColor(
                  item.category,
                  item.color,
                );
                const cardStyle = agendaCardStyle(
                  item,
                  itemStatus,
                  resolvedAgendaColor,
                );
                const descriptionExpanded = !!expandedDescriptions[item.id];
                const hasLongDescription =
                  (item.description?.length || 0) > 220;
                const isPast = itemStatus === "past";
                const isExpanded = !isPast || !!expandedPastItems[item.id];

                if (!isPast) {
                  return (
                    <div
                      key={item.id}
                      style={{
                        ...cardStyle,
                        borderRadius: 10,
                        padding: 14,
                        cursor: "default",
                        marginBottom: 10,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: itemStatus === "now" ? "#166534" : "#475569",
                          marginBottom: 6,
                          letterSpacing: 0.2,
                        }}
                      >
                        {formatItemTime(item)}
                      </div>
                      <div
                        style={{
                          fontWeight: 800,
                          fontSize: 17,
                          color: itemStatus === "now" ? "#064e3b" : "#111827",
                        }}
                      >
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
                        <>
                          <div
                            style={{
                              marginTop: 8,
                              color: "#374151",
                              lineHeight: 1.45,
                              overflow: "hidden",
                              display: descriptionExpanded
                                ? "block"
                                : "-webkit-box",
                              WebkitBoxOrient: "vertical",
                              WebkitLineClamp: descriptionExpanded
                                ? undefined
                                : 3,
                              textAlign: "justify",
                              hyphens: "auto",
                              whiteSpace: descriptionExpanded
                                ? "pre-wrap"
                                : "normal",
                            }}
                          >
                            {item.description}
                          </div>

                          {hasLongDescription ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleDescription(item.id);
                              }}
                              style={{
                                marginTop: 8,
                                padding: 0,
                                border: "none",
                                background: "none",
                                color: "#2563eb",
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              {descriptionExpanded
                                ? "Read Less ▲"
                                : "Read More ▼"}
                            </button>
                          ) : null}
                        </>
                      ) : null}
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
                          <span style={categoryStyle(resolvedAgendaColor)}>
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
                              background: "#eef2f7",
                              color: "#475569",
                              border: "1px solid #cbd5e1",
                            }}
                          >
                            Upcoming
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                }

                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => togglePastItem(item.id)}
                    style={{
                      ...cardStyle,
                      width: "100%",
                      borderRadius: 10,
                      padding: isExpanded ? 14 : "10px 14px",
                      cursor: "pointer",
                      opacity: !isExpanded ? 0.88 : 1,
                      textAlign: "left",
                      font: "inherit",
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#475569",
                        marginBottom: 6,
                        letterSpacing: 0.2,
                      }}
                    >
                      {formatItemTime(item)}
                    </div>
                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: 17,
                        color: "#111827",
                      }}
                    >
                      {item.title || "Untitled item"}
                    </div>
                    {isExpanded && item.location ? (
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
                    {isExpanded && item.description ? (
                      <div
                        style={{
                          marginTop: 8,
                          color: "#374151",
                          lineHeight: 1.45,
                          whiteSpace: "pre-wrap",
                          textAlign: "justify",
                          hyphens: "auto",
                        }}
                      >
                        {item.description}
                      </div>
                    ) : null}

                    {isExpanded ? (
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
                          <span style={categoryStyle(resolvedAgendaColor)}>
                            {item.category}
                          </span>
                        ) : null}

                        {isPast ? (
                          <span style={{ fontSize: 12, color: "#6b7280" }}>
                            Collapse
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 12,
                          color: "#6b7280",
                        }}
                      >
                        Past item · expand
                      </div>
                    )}
                  </button>
                );
              });
            }

            return (
              <section key={group.key} style={{ display: "grid", gap: 10 }}>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: 18,
                    color: "#111827",
                    paddingBottom: 16,
                    borderBottom: "2px solid #e5e7eb",
                    marginBottom: 10,
                  }}
                >
                  {group.label}
                </div>
                <div style={{ display: "grid", gap: 0 }}>
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gap: 10,
      position: "sticky",
      top: 0,
      zIndex: 5,
      background: "white",
    }}
  >
    <div
      style={{
        fontWeight: 700,
        fontSize: 16,
        borderBottom: "1px solid #e5e7eb",
        marginBottom: 12,
        paddingBottom: 6,
        color: "#22223b",
        letterSpacing: 0.2,
        minWidth: 0,
      }}
    >
      Morton Building
    </div>

    <div
      style={{
        fontWeight: 700,
        fontSize: 16,
        borderBottom: "1px solid #e5e7eb",
        marginBottom: 12,
        paddingBottom: 6,
        color: "#22223b",
        letterSpacing: 0.2,
        minWidth: 0,
      }}
    >
      Pioneer Building
    </div>
  </div>

  {timeSlotKeys.map((timeSlot) => {
    const mortonSlotItems = mortonItems.filter(
      (item) => (item.start_time || "unscheduled") === timeSlot,
    );

    const pioneerSlotItems = pioneerItems.filter(
      (item) => (item.start_time || "unscheduled") === timeSlot,
    );

    return (
      <div
        key={timeSlot}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 10,
          alignItems: "start",
        }}
      >
        <div style={{ minWidth: 0 }}>
          {mortonSlotItems.length > 0
            ? renderAgendaCards(mortonSlotItems)
            : null}
        </div>

        <div style={{ minWidth: 0 }}>
          {pioneerSlotItems.length > 0
            ? renderAgendaCards(pioneerSlotItems)
            : null}
        </div>
      </div>
    );
  })}
  </div>
</section>
);
})}
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
