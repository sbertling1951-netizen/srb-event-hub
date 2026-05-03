"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import LocationCard from "@/components/LocationCard";
import { getCurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import { supabase } from "@/lib/supabase";

const NearbyPlacesMap = dynamic(
  () => import("@/components/map/NearbyPlacesMap"),
  { ssr: false },
);

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

type ViewMode = "list" | "map";

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

function sanitizeNearbyCardColor(color: string | null | undefined) {
  const fallback = "#f8fafc";
  const value = (color || "").trim().toLowerCase();

  if (!value) {
    return fallback;
  }

  // Green is reserved for active/current items only, not regular nearby categories.
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

  return color || fallback;
}

function nearbyCardStyle(place: Place) {
  return {
    border: "1px solid rgba(17,24,39,0.14)",
    background: sanitizeNearbyCardColor(getNearbyCardColor(place.category)),
    borderRadius: 10,
    padding: 6,
    boxShadow: "0 1px 4px rgba(15,23,42,0.05)",
    color: "#111827",
  };
}

function NearbyPageInner() {
  const [event, setEvent] = useState<EventRow | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [status, setStatus] = useState("Loading nearby places...");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  const loadNearby = useCallback(async () => {
    try {
      setStatus("Loading nearby places...");
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
            name: memberEvent.name || memberEvent.eventName || null,
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
    } catch (err: any) {
      console.error("loadNearby error:", err);
      setEvent(null);
      setPlaces([]);
      setStatus(err?.message || "Failed to load nearby places.");
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

  return (
    <div className="grid" style={{ gap: 6 }}>
      <div className="card" style={{ padding: 8 }}>
        <span
          className="badge success"
          style={{ fontSize: 11, padding: "2px 6px" }}
        >
          Nearby List Ready
        </span>
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
          style={{ marginTop: 6, flexWrap: "wrap", gap: 4 }}
        >
          {categoryOptions.map((category) => (
            <button
              key={category}
              type="button"
              className="badge"
              onClick={() => setSelectedCategory(category)}
              style={{
                padding: "3px 7px",
                fontSize: 12,
                cursor: "pointer",
                background:
                  selectedCategory === category ? "#e5eefc" : undefined,
              }}
            >
              {category}
            </button>
          ))}
        </div>

        <div
          className="btn-row"
          style={{ marginTop: 6, flexWrap: "wrap", gap: 4 }}
        >
          <button
            type="button"
            className="badge"
            onClick={() => setViewMode("list")}
            style={{
              padding: "3px 7px",
              fontSize: 12,
              cursor: "pointer",
              background: viewMode === "list" ? "#e5eefc" : undefined,
            }}
          >
            List
          </button>
          <button
            type="button"
            className="badge"
            onClick={() => setViewMode("map")}
            style={{
              padding: "3px 7px",
              fontSize: 12,
              cursor: "pointer",
              background: viewMode === "map" ? "#e5eefc" : undefined,
            }}
          >
            Map
          </button>
        </div>

        <div style={{ marginTop: 5, fontSize: 11, color: "#666" }}>
          {status}
        </div>
      </div>

      {viewMode === "list" ? (
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
      ) : (
        <NearbyPlacesMap
          places={filteredPlaces}
          eventLat={typeof event?.lat === "number" ? event.lat : null}
          eventLng={typeof event?.lng === "number" ? event.lng : null}
        />
      )}
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
