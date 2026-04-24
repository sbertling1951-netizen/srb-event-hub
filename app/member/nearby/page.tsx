"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
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

function NearbyPageInner() {
  const searchParams = useSearchParams();
  const urlEventId = searchParams.get("event");

  const [event, setEvent] = useState<EventRow | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [status, setStatus] = useState("Loading nearby places...");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  const loadNearby = useCallback(async () => {
    try {
      setStatus("Loading nearby places...");

      let eventId = urlEventId || null;
      let eventInfo: EventRow | null = null;

      if (eventId) {
        const { data: eventRow, error: eventError } = await supabase
          .from("events")
          .select("id,name,venue_name,location,start_date,end_date,lat,lng")
          .eq("id", eventId)
          .maybeSingle();

        if (eventError) {
          throw eventError;
        }
        eventInfo = (eventRow as EventRow | null) || null;
      } else {
        const memberEvent = getCurrentMemberEvent();

        if (!memberEvent?.id) {
          setEvent(null);
          setPlaces([]);
          setStatus("No current event selected.");
          return;
        }

        eventId = memberEvent.id;
        eventInfo = {
          id: memberEvent.id || "",
          name: memberEvent.name || memberEvent.eventName || null,
          venue_name: memberEvent.venue_name || null,
          location: memberEvent.location || null,
          start_date: memberEvent.start_date || null,
          end_date: memberEvent.end_date || null,
          lat: memberEvent.lat || null,
          lng: memberEvent.lng || null,
        };
      }

      if (!eventId) {
        setEvent(null);
        setPlaces([]);
        setStatus("No current event selected.");
        return;
      }

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

      setPlaces((data || []) as Place[]);
      setStatus(
        `Loaded ${(data || []).length} nearby place${(data || []).length === 1 ? "" : "s"}.`,
      );
    } catch (err: any) {
      console.error("loadNearby error:", err);
      setPlaces([]);
      setStatus(err?.message || "Failed to load nearby places.");
    }
  }, [urlEventId]);

  useEffect(() => {
    void loadNearby();
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
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <span className="badge success">Nearby List Ready</span>
        <h1>Nearby</h1>
        <p className="subtle">
          This screen is where members can quickly find useful places around the
          event such as fuel, urgent care, pharmacy, groceries, and other local
          stops.
        </p>

        <div style={{ marginTop: 10, fontWeight: 700 }}>
          Current event: {event?.name || "No current event"}
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
          className="btn-row"
          style={{ marginTop: 12, flexWrap: "wrap", gap: 8 }}
        >
          {categoryOptions.map((category) => (
            <button
              key={category}
              type="button"
              className="badge"
              onClick={() => setSelectedCategory(category)}
              style={{
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
          style={{ marginTop: 12, flexWrap: "wrap", gap: 8 }}
        >
          <button
            type="button"
            className="badge"
            onClick={() => setViewMode("list")}
            style={{
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
              cursor: "pointer",
              background: viewMode === "map" ? "#e5eefc" : undefined,
            }}
          >
            Map
          </button>
        </div>

        <div style={{ marginTop: 12, fontSize: 13, color: "#666" }}>
          {status}
        </div>
      </div>

      {viewMode === "list" ? (
        <div className="grid grid-2">
          {filteredPlaces.map((place) => (
            <div key={place.id}>
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
                <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>
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
