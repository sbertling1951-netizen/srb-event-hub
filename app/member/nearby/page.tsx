"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import LocationCard from "@/components/LocationCard";
import { getCurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import { sanitizeCardColor } from "@/lib/sanitizeCardColor";
import { supabase } from "@/lib/supabase";

type Place = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  category: string | null;
  notes: string | null;
  distance_miles: number | null;
  location_code: string | null;
  is_hidden: boolean | null;
  lat: number | null;
  lng: number | null;
  sort_order?: number | null;
};

type EventRow = {
  id: string;
  name: string | null;
  venue_name: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  lat: number | null;
  lng: number | null;
};

function formatDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
) {
  if (!startDate && !endDate) {
    return "";
  }
  if (startDate && endDate) {
    return `${startDate} – ${endDate}`;
  }
  return startDate || endDate || "";
}

function getNearbyCardColor(category: string | null | undefined) {
  const normalized = (category || "").trim().toLowerCase();

  const colorMap: Record<string, string> = {
    food: "#fef3c7",
    restaurant: "#fef3c7",
    restaurants: "#fef3c7",
    dining: "#fef3c7",
    fuel: "#fee2e2",
    gas: "#fee2e2",
    diesel: "#fee2e2",
    grocery: "#e0f2fe",
    groceries: "#e0f2fe",
    shopping: "#ffedd5",
    pharmacy: "#ede9fe",
    medical: "#ffe4e6",
    "urgent care": "#ffe4e6",
    hospital: "#ffe4e6",
    attraction: "#f5e8ff",
    attractions: "#f5e8ff",
    park: "#e0f2fe",
    parks: "#e0f2fe",
    service: "#f1f5f9",
    services: "#f1f5f9",
    nearby: "#f8fafc",
  };

  return colorMap[normalized] || "#f8fafc";
}

function nearbyCardStyle(place: Place) {
  return {
    border: "1px solid rgba(17,24,39,0.14)",
    background: sanitizeCardColor(getNearbyCardColor(place.category)),
    borderRadius: 10,
    padding: 6,
    boxShadow: "0 1px 4px rgba(15,23,42,0.05)",
    color: "#111827",
  };
}

function nearbyCategoryIcon(category: string) {
  const normalized = category.trim().toLowerCase();

  if (normalized === "all") {
    return "•";
  }
  if (
    normalized.includes("fuel") ||
    normalized.includes("gas") ||
    normalized.includes("diesel")
  ) {
    return "⛽";
  }
  if (
    normalized.includes("food") ||
    normalized.includes("restaurant") ||
    normalized.includes("dining")
  ) {
    return "🍔";
  }
  if (
    normalized.includes("grocery") ||
    normalized.includes("groceries") ||
    normalized.includes("shopping")
  ) {
    return "🛒";
  }
  if (
    normalized.includes("pharmacy") ||
    normalized.includes("medical") ||
    normalized.includes("urgent") ||
    normalized.includes("hospital")
  ) {
    return "💊";
  }
  if (
    normalized.includes("rv") ||
    normalized.includes("service") ||
    normalized.includes("parts")
  ) {
    return "🔧";
  }
  if (
    normalized.includes("attraction") ||
    normalized.includes("entertainment") ||
    normalized.includes("park")
  ) {
    return "⭐";
  }

  return "📍";
}

function NearbyPageInner() {
  const [event, setEvent] = useState<EventRow | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [status, setStatus] = useState("Loading nearby places...");
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState("All");

  const loadNearby = useCallback(async () => {
    try {
      setStatus("Loading nearby places...");
      setError(null);
      setSelectedCategory("All");

      const memberEvent = getCurrentMemberEvent();

      if (!memberEvent?.id) {
        setEvent(null);
        setPlaces([]);
        setStatus("No current event selected.");
        return;
      }

      const eventId = memberEvent.id;

      const { data: eventRow, error: eventError } = await supabase
        .from("events")
        .select("id,name,venue_name,location,start_date,end_date,lat,lng")
        .eq("id", eventId)
        .maybeSingle();

      if (eventError) {
        throw eventError;
      }

      const eventInfo: EventRow = eventRow
        ? (eventRow as EventRow)
        : {
            id: memberEvent.id || "",
            name: memberEvent.name || null,
            venue_name: memberEvent.venue_name || null,
            location: memberEvent.location || null,
            start_date: memberEvent.start_date || null,
            end_date: memberEvent.end_date || null,
            lat: memberEvent.lat || null,
            lng: memberEvent.lng || null,
          };

      setEvent(eventInfo);

      const { data, error } = await supabase
        .from("event_nearby_places")
        .select(
          "id,name,address,phone,website,category,notes,distance_miles,location_code,is_hidden,lat,lng,sort_order",
        )
        .eq("event_id", eventId)
        .or("is_hidden.is.null,is_hidden.eq.false")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (error) {
        throw error;
      }

      const rows = (data || []) as Place[];
      setPlaces(rows);
      setStatus(
        `Loaded ${rows.length} nearby place${rows.length === 1 ? "" : "s"}.`,
      );
    } catch (err) {
      console.error("loadNearby error:", err);
      setEvent(null);
      setPlaces([]);
      setError(
        err instanceof Error ? err.message : "Failed to load nearby places.",
      );
      setStatus("");
    }
  }, []);

  useEffect(() => {
    void loadNearby();

    function handleStorage(e: StorageEvent) {
      if (
        e.key === "fcoc-member-event-context" ||
        e.key === "fcoc-member-event-changed" ||
        e.key === "fcoc-user-mode" ||
        e.key === "fcoc-user-mode-changed"
      ) {
        void loadNearby();
      }
    }

    function handleMemberEventUpdated() {
      void loadNearby();
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener(
      "fcoc-member-event-updated",
      handleMemberEventUpdated,
    );

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        "fcoc-member-event-updated",
        handleMemberEventUpdated,
      );
    };
  }, [loadNearby]);

  const categoryOptions = useMemo(() => {
    const categories = Array.from(
      new Set(places.map((p) => p.category).filter(Boolean)),
    ) as string[];

    const preferredOrder = ["Fuel", "Urgent Care", "Pharmacy", "Groceries"];
    const ordered = preferredOrder.filter((c) => categories.includes(c));
    const remaining = categories
      .filter((c) => !preferredOrder.includes(c))
      .sort((a, b) => a.localeCompare(b));

    return ["All", ...ordered, ...remaining];
  }, [places]);

  const filteredPlaces = useMemo(() => {
    if (selectedCategory === "All") {
      return places;
    }

    return places.filter(
      (place) =>
        (place.category || "").toLowerCase() === selectedCategory.toLowerCase(),
    );
  }, [places, selectedCategory]);

  const dateRange = formatDateRange(event?.start_date, event?.end_date);
  const listReady =
    !error && !!event && !status.toLowerCase().startsWith("loading");

  return (
    <div className="grid" style={{ gap: 6 }}>
      <div className="card" style={{ padding: 8 }}>
        {listReady ? (
          <span
            className="badge success"
            style={{ fontSize: 11, padding: "2px 6px" }}
          >
            Nearby List Ready
          </span>
        ) : null}
        <h1 style={{ margin: "4px 0 4px", fontSize: 22 }}>Nearby</h1>
        <p className="subtle" style={{ margin: "0 0 4px", fontSize: 13 }}>
          Fuel, urgent care, pharmacy, groceries, and local stops.
        </p>

        <div style={{ marginTop: 4, fontWeight: 700, fontSize: 14 }}>
          Current event: {event?.name || "No current event"}
        </div>

        {event?.venue_name ? (
          <div style={{ color: "#555", marginTop: 2 }}>{event.venue_name}</div>
        ) : null}

        {event?.location ? (
          <div style={{ color: "#555", marginTop: 2 }}>{event.location}</div>
        ) : null}

        {dateRange ? (
          <div style={{ fontSize: 13, color: "#666", marginTop: 2 }}>
            {dateRange}
          </div>
        ) : null}

        <div
          className="btn-row"
          style={{
            marginTop: 4,
            fontWeight: 700,
            fontSize: 14,
            flexWrap: "wrap",
            gap: 4,
          }}
        >
          {categoryOptions.map((category) => (
            <button
              key={category}
              type="button"
              className={`nearby-chip ${selectedCategory === category ? "active" : ""}`}
              onClick={() => setSelectedCategory(category)}
              style={
                {
                  "--chip-bg": sanitizeCardColor(
                    getNearbyCardColor(category === "All" ? null : category),
                  ),
                } as React.CSSProperties
              }
            >
              <span aria-hidden="true" style={{ marginRight: 4 }}>
                {nearbyCategoryIcon(category)}
              </span>
              {category}
            </button>
          ))}
        </div>

        {status ? (
          <div style={{ marginTop: 5, fontSize: 11, color: "#666" }}>
            {status}
          </div>
        ) : null}

        {error ? (
          <div
            role="alert"
            style={{
              marginTop: 8,
              padding: 10,
              borderRadius: 10,
              border: "1px solid #fecaca",
              background: "#fef2f2",
              color: "#991b1b",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {error}
          </div>
        ) : null}
      </div>

      <div className="grid grid-2" style={{ gap: 6 }}>
        {filteredPlaces.map((place) => (
          <div key={place.id} style={nearbyCardStyle(place)}>
            <LocationCard
              name={place.name}
              address={place.address || ""}
              phone={place.phone || undefined}
              website={place.website || undefined}
              latitude={place.lat || undefined}
              longitude={place.lng || undefined}
              category={place.category || "Nearby"}
              rvNote={place.notes || undefined}
              locationCode={place.location_code || undefined}
            />
            {place.distance_miles !== null &&
            place.distance_miles !== undefined ? (
              <div
                style={{
                  display: "inline-block",
                  marginTop: 3,
                  padding: "1px 6px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.82)",
                  border: "1px solid rgba(0,0,0,0.08)",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#111827",
                }}
              >
                {place.distance_miles} mi
              </div>
            ) : null}
          </div>
        ))}

        {filteredPlaces.length === 0 ? (
          <div className="card">No nearby places found.</div>
        ) : null}
      </div>
    </div>
  );
}

export default function NearbyPage() {
  return (
    <MemberRouteGuard>
      <NearbyPageInner />
    </MemberRouteGuard>
  );
}
