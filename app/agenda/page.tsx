"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import MemberRouteGuard from "@/components/auth/MemberRouteGuard";

type AgendaItem = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  speaker: string | null;
  category: string | null;
  agenda_date: string | null;
  start_time: string | null;
  end_time: string | null;
  sort_order: number | null;
  is_published: boolean | null;
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

type GroupedAgenda = {
  day: string;
  items: AgendaItem[];
};

function formatDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
) {
  if (!startDate && !endDate) return "";

  const format = (d: string) =>
    new Date(d).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  if (startDate && endDate) return `${format(startDate)} – ${format(endDate)}`;
  return startDate ? format(startDate) : format(endDate!);
}

function formatDayHeading(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatItemTime(item: AgendaItem) {
  const format = (t?: string | null) => {
    if (!t) return null;

    const parsed = new Date(`1970-01-01T${t}`);
    if (Number.isNaN(parsed.getTime())) return t;

    return parsed.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const start = format(item.start_time);
  const end = format(item.end_time);

  if (!start && !end) return "Time TBD";
  if (start && end) return `${start} – ${end}`;
  return start || end || "Time TBD";
}

function groupAgenda(items: AgendaItem[]): GroupedAgenda[] {
  const map = new Map<string, AgendaItem[]>();

  items.forEach((item) => {
    const day = item.agenda_date || "Schedule";

    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(item);
  });

  return Array.from(map.entries()).map(([day, groupedItems]) => ({
    day,
    items: groupedItems.sort((a, b) => {
      const aSort = a.sort_order ?? 0;
      const bSort = b.sort_order ?? 0;
      if (aSort !== bSort) return aSort - bSort;

      const aTime = a.start_time || "";
      const bTime = b.start_time || "";
      return aTime.localeCompare(bTime);
    }),
  }));
}

function toTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toMinutes(timeValue: string | null | undefined) {
  if (!timeValue) return null;
  const [hh, mm] = timeValue.split(":");
  const hours = Number(hh);
  const minutes = Number(mm);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

function getCurrentMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function isHappeningNow(
  item: AgendaItem,
  todayKey: string,
  nowMinutes: number,
) {
  if (!item.agenda_date || item.agenda_date !== todayKey) return false;

  const start = toMinutes(item.start_time);
  const end = toMinutes(item.end_time);

  if (start === null) return false;
  if (end === null) return nowMinutes >= start;

  return nowMinutes >= start && nowMinutes <= end;
}

function isNextUp(
  item: AgendaItem,
  todayKey: string,
  nowMinutes: number,
  allItems: AgendaItem[],
) {
  if (!item.agenda_date || item.agenda_date !== todayKey) return false;

  const start = toMinutes(item.start_time);
  if (start === null || start <= nowMinutes) return false;

  const futureItems = allItems
    .filter((x) => x.agenda_date === todayKey)
    .filter((x) => {
      const m = toMinutes(x.start_time);
      return m !== null && m > nowMinutes;
    })
    .sort((a, b) => {
      const aMin = toMinutes(a.start_time) ?? 9999;
      const bMin = toMinutes(b.start_time) ?? 9999;
      return aMin - bMin;
    });

  if (futureItems.length === 0) return false;
  return futureItems[0].id === item.id;
}

function AgendaPageInner() {
  const [event, setEvent] = useState<EventRow | null>(null);
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [status, setStatus] = useState("Loading agenda...");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [nowTick, setNowTick] = useState(Date.now());

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
    const interval = window.setInterval(() => {
      setNowTick(Date.now());
    }, 60000);

    return () => window.clearInterval(interval);
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
          "id,title,description,location,speaker,category,agenda_date,start_time,end_time,sort_order,is_published",
        )
        .eq("event_id", memberEvent.id)
        .eq("is_published", true)
        .order("agenda_date", { ascending: true, nullsFirst: false })
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("start_time", { ascending: true, nullsFirst: false });

      if (error) throw error;

      setItems((data || []) as AgendaItem[]);
      setStatus(
        `Loaded ${(data || []).length} agenda item${(data || []).length === 1 ? "" : "s"}.`,
      );
    } catch (err: any) {
      console.error("loadAgenda error:", err);
      setItems([]);
      setStatus(err?.message || "Failed to load agenda.");
    }
  }

  const categories = useMemo(() => {
    const values = Array.from(
      new Set(items.map((item) => item.category).filter(Boolean)),
    ) as string[];

    return ["All", ...values.sort((a, b) => a.localeCompare(b))];
  }, [items]);

  const filteredItems = useMemo(() => {
    if (selectedCategory === "All") return items;

    return items.filter(
      (item) =>
        (item.category || "").toLowerCase() === selectedCategory.toLowerCase(),
    );
  }, [items, selectedCategory]);

  const grouped = useMemo(() => groupAgenda(filteredItems), [filteredItems]);
  const dateRange = formatDateRange(event?.start_date, event?.end_date);

  const todayKey = useMemo(() => toTodayKey(), [nowTick]);
  const nowMinutes = useMemo(() => getCurrentMinutes(), [nowTick]);

  const todaysItems = useMemo(
    () => filteredItems.filter((item) => item.agenda_date === todayKey),
    [filteredItems, todayKey],
  );

  const nowItem = useMemo(
    () =>
      todaysItems.find((item) => isHappeningNow(item, todayKey, nowMinutes)) ||
      null,
    [todaysItems, todayKey, nowMinutes],
  );

  const nextItem = useMemo(
    () =>
      todaysItems.find((item) =>
        isNextUp(item, todayKey, nowMinutes, todaysItems),
      ) || null,
    [todaysItems, todayKey, nowMinutes],
  );

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
          <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
            {dateRange}
          </div>
        ) : null}

        <div
          style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}
        >
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setSelectedCategory(category)}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid #d1d5db",
                background: selectedCategory === category ? "#e5eefc" : "white",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              {category}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 12, fontSize: 13, color: "#666" }}>
          {status}
        </div>
      </div>

      {(nowItem || nextItem) && (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 14,
            display: "grid",
            gap: 12,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 18 }}>Now / Next</div>

          {nowItem ? (
            <div
              style={{
                border: "1px solid #dbeafe",
                background: "#eff6ff",
                borderRadius: 10,
                padding: 12,
              }}
            >
              <div
                style={{
                  display: "inline-block",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#1d4ed8",
                  background: "#dbeafe",
                  padding: "4px 8px",
                  borderRadius: 999,
                  marginBottom: 8,
                }}
              >
                Happening Now
              </div>
              <div style={{ fontWeight: 700 }}>{nowItem.title}</div>
              <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>
                {formatItemTime(nowItem)}
                {nowItem.location ? ` · ${nowItem.location}` : ""}
              </div>
            </div>
          ) : null}

          {nextItem ? (
            <div
              style={{
                border: "1px solid #e5e7eb",
                background: "#f9fafb",
                borderRadius: 10,
                padding: 12,
              }}
            >
              <div
                style={{
                  display: "inline-block",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#374151",
                  background: "#e5e7eb",
                  padding: "4px 8px",
                  borderRadius: 999,
                  marginBottom: 8,
                }}
              >
                Up Next
              </div>
              <div style={{ fontWeight: 700 }}>{nextItem.title}</div>
              <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>
                {formatItemTime(nextItem)}
                {nextItem.location ? ` · ${nextItem.location}` : ""}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {grouped.length === 0 ? (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 16,
            color: "#666",
          }}
        >
          No agenda items found.
        </div>
      ) : (
        grouped.map((group) => (
          <div key={group.day} style={{ display: "grid", gap: 10 }}>
            <h2 style={{ margin: 0 }}>{formatDayHeading(group.day)}</h2>

            {group.items.map((item) => {
              const now = isHappeningNow(item, todayKey, nowMinutes);
              const next = isNextUp(item, todayKey, nowMinutes, todaysItems);

              return (
                <div
                  key={item.id}
                  style={{
                    border: now
                      ? "2px solid #60a5fa"
                      : next
                        ? "2px solid #d1d5db"
                        : "1px solid #ddd",
                    borderRadius: 10,
                    background: now ? "#eff6ff" : next ? "#f9fafb" : "white",
                    padding: 14,
                  }}
                >
                  {(now || next) && (
                    <div style={{ marginBottom: 8 }}>
                      <span
                        style={{
                          display: "inline-block",
                          fontSize: 12,
                          fontWeight: 700,
                          color: now ? "#1d4ed8" : "#374151",
                          background: now ? "#dbeafe" : "#e5e7eb",
                          padding: "4px 8px",
                          borderRadius: 999,
                        }}
                      >
                        {now ? "Happening Now" : "Up Next"}
                      </span>
                    </div>
                  )}

                  <div style={{ fontWeight: 700, fontSize: 17 }}>
                    {item.title}
                  </div>

                  <div style={{ marginTop: 6, fontSize: 13, color: "#555" }}>
                    {formatItemTime(item)}
                    {item.category ? ` · ${item.category}` : ""}
                  </div>

                  {item.location ? (
                    <div style={{ marginTop: 6, color: "#555" }}>
                      {item.location}
                    </div>
                  ) : null}

                  {item.speaker ? (
                    <div style={{ marginTop: 6, color: "#555" }}>
                      Speaker: {item.speaker}
                    </div>
                  ) : null}

                  {item.description ? (
                    <div style={{ marginTop: 8 }}>{item.description}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}

export default function AgendaPage() {
  return (
    <MemberRouteGuard>
      <AgendaPageInner />
    </MemberRouteGuard>
  );
}
