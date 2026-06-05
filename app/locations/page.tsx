"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { MapCanvas } from "@/components/map/canvas";
import type { MapMarker } from "@/components/map/canvas/types";
import { supabase } from "@/lib/supabase";

type ActiveEvent = {
  id: string;
  name: string;
  location: string | null;
  map_image_url: string | null;
  master_map_id: string | null;
  locations_map_open_scale: number | null;
};

type EventLocation = {
  id: string;
  event_id: string;
  name: string;
  category: string | null;
  description: string | null;
  map_x: number | null;
  map_y: number | null;
  priority: number | null;
};

type StatusMessage = {
  type: "loading" | "info" | "error";
  text: string;
};

const MARKER_LEGEND_ITEMS = [
  { label: "Trash / Dumpster", color: "#dc2626" },
  { label: "Building / Office", color: "#2563eb" },
  { label: "Restroom / Bathroom", color: "#16a34a" },
  { label: "Registration", color: "#d97706" },
  { label: "Other", color: "#7c3aed" },
  { label: "Selected", color: "gold" },
];

function getMarkerColor(location: EventLocation, selectedId: string): string {
  if (location.id === selectedId) {
    return "gold";
  }

  switch ((location.category || "").toLowerCase()) {
    case "trash":
    case "dumpster":
      return "#dc2626";
    case "building":
    case "office":
      return "#2563eb";
    case "restroom":
    case "bathroom":
      return "#16a34a";
    case "registration":
      return "#d97706";
    default:
      return "#7c3aed";
  }
}

function getMarkerSize(
  location: EventLocation,
  selectedId: string,
  isNarrow: boolean,
): number {
  if (location.id === selectedId) {
    return isNarrow ? 44 : 36;
  }

  return isNarrow ? 22 : 16;
}

export default function PublicLocationsPage() {
  const [event, setEvent] = useState<ActiveEvent | null>(null);
  const [locations, setLocations] = useState<EventLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [status, setStatus] = useState<StatusMessage>({
    type: "loading",
    text: "Loading...",
  });
  const [isNarrow, setIsNarrow] = useState(false);
  // NOTE: naturalSize state removed — the MapCanvas engine measures the image's
  // intrinsic dimensions itself (we intentionally do NOT pass naturalWidth/Height).
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    function handleResize() {
      setIsNarrow(window.innerWidth < 900);
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const loadPage = useCallback(async () => {
    setStatus({ type: "loading", text: "Loading..." });

    const { data: activeEvent, error: eventError } = await supabase
      .from("events")
      .select(
        "id,name,location,map_image_url,master_map_id,locations_map_open_scale",
      )
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (eventError || !activeEvent) {
      setStatus({
        type: "error",
        text: `Could not load active event: ${eventError?.message || "No active event found."}`,
      });
      return;
    }

    const typedEvent = activeEvent as ActiveEvent;
    setImageLoaded(false);

    let resolvedMapId: string | null = null;
    let resolvedMapImageUrl: string | null = typedEvent.map_image_url;

    const { data: mapSettingsRow } = await supabase
      .from("event_map_settings")
      .select("event_id,selected_master_map_id")
      .eq("event_id", typedEvent.id)
      .maybeSingle();

    resolvedMapId =
      (mapSettingsRow as { selected_master_map_id?: string | null } | null)
        ?.selected_master_map_id || null;

    if (!resolvedMapId) {
      resolvedMapId = typedEvent.master_map_id || null;
    }

    if (resolvedMapId) {
      const { data: masterMapRow } = await supabase
        .from("master_maps")
        .select("id,name,map_image_url")
        .eq("id", resolvedMapId)
        .maybeSingle();

      resolvedMapImageUrl =
        (masterMapRow as { map_image_url?: string | null } | null)
          ?.map_image_url || resolvedMapImageUrl;
    }

    setEvent({
      ...typedEvent,
      map_image_url: resolvedMapImageUrl,
    });

    const { data: locationData, error: locationError } = await supabase
      .from("event_locations")
      .select("id,event_id,name,category,description,map_x,map_y,priority")
      .eq("event_id", typedEvent.id)
      .order("priority", { ascending: true })
      .order("name", { ascending: true });

    if (locationError) {
      setStatus({
        type: "error",
        text: `Could not load map locations: ${locationError.message}`,
      });
      return;
    }

    setLocations((locationData || []) as EventLocation[]);
    setStatus({
      type: "info",
      text: `Loaded ${(locationData || []).length} locations.`,
    });
  }, []);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  // Preload the map image purely to drive the "Loading map markers..." overlay.
  // The engine owns the rendered <img> now, so we no longer learn about load
  // completion from an onLoad handler we own — this preloader restores that hook
  // without coupling to the engine internals.
  useEffect(() => {
    setImageLoaded(false);
    const url = event?.map_image_url;
    if (!url) {
      return;
    }
    const img = new Image();
    img.onload = () => setImageLoaded(true);
    img.onerror = () => setImageLoaded(true); // never trap the overlay on a bad URL
    img.src = url;
  }, [event?.map_image_url]);

  const filteredLocations = useMemo(() => {
    const q = search.trim().toLowerCase();

    return locations.filter((loc) => {
      const matchesCategory =
        categoryFilter === "all"
          ? true
          : (loc.category || "").trim().toLowerCase() ===
            categoryFilter.toLowerCase();

      if (!matchesCategory) {
        return false;
      }

      if (!q) {
        return true;
      }

      const text = [loc.name || "", loc.category || "", loc.description || ""]
        .join(" ")
        .toLowerCase();

      return text.includes(q);
    });
  }, [locations, search, categoryFilter]);

  const selectedLocation = useMemo(
    () => locations.find((loc) => loc.id === selectedLocationId) || null,
    [locations, selectedLocationId],
  );

  const availableCategories = useMemo(() => {
    const values = Array.from(
      new Set(
        locations.map((loc) => (loc.category || "").trim()).filter(Boolean),
      ),
    );

    return values.sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [locations]);

  // Fast id -> location lookup for marker rendering + tap routing.
  const locationById = useMemo(() => {
    const map = new Map<string, EventLocation>();
    for (const loc of locations) {
      map.set(loc.id, loc);
    }
    return map;
  }, [locations]);

  // Engine markers: PERCENT coordinates only. map_x/map_y are already 0..100.
  // We deliberately omit color/size/label here — presentation is supplied by
  // renderMarker below so the existing look is reproduced exactly.
  const markers = useMemo<MapMarker[]>(
    () =>
      locations
        .filter((loc) => loc.map_x !== null && loc.map_y !== null)
        .map((loc) => ({
          id: loc.id,
          xPct: loc.map_x as number,
          yPct: loc.map_y as number,
          data: loc,
        })),
    [locations],
  );

  function handleLocationClick(location: EventLocation) {
    setSelectedLocationId(location.id);
    setStatus({ type: "info", text: `Focused map on ${location.name}.` });
  }

  // Marker tap comes back from the engine as an id; route it through the same
  // selection handler the list uses. (Phase 1: highlight only — no auto-pan/zoom.)
  const handleMarkerTap = useCallback(
    (id: string) => {
      const loc = locationById.get(id);
      if (loc) {
        handleLocationClick(loc);
      }
    },
    [locationById],
  );

  // Page-supplied marker visual. MarkerLayer owns positioning, the click target,
  // and z-index layering; this returns only the dot + name chip, reading the
  // current selection from closure so colors/sizes match the previous page 1:1.
  const renderMarker = useCallback(
    (m: MapMarker) => {
      const loc = locationById.get(m.id);
      if (!loc) {
        return null;
      }

      const selected = loc.id === selectedLocationId;
      const size = getMarkerSize(loc, selectedLocationId, isNarrow);
      const color = getMarkerColor(loc, selectedLocationId);

      return (
        <>
          <div
            title={loc.name}
            style={{
              width: size,
              height: size,
              borderRadius: "50%",
              background: color,
              border: isNarrow ? "3px solid white" : "2px solid white",
              boxShadow: selected
                ? "0 0 0 4px rgba(255,215,0,0.35), 0 1px 4px rgba(0,0,0,0.35)"
                : "0 1px 4px rgba(0,0,0,0.35)",
              padding: 0,
              display: "block",
              margin: "0 auto",
            }}
          />

          <div
            style={{
              marginTop: 4,
              marginLeft: "auto",
              marginRight: "auto",
              background: "rgba(255,255,255,0.92)",
              border: "1px solid rgba(0,0,0,0.2)",
              borderRadius: 4,
              fontSize: selected ? 12 : 10,
              fontWeight: 700,
              padding: selected ? "2px 6px" : "1px 4px",
              color: "#111",
              whiteSpace: "nowrap",
              boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
              display: "table",
              pointerEvents: "none",
            }}
          >
            {loc.name}
          </div>
        </>
      );
    },
    [locationById, selectedLocationId, isNarrow],
  );

  return (
    <div style={{ padding: isNarrow ? 12 : 24 }}>
      <h1 style={{ marginTop: 0 }}>Map Locations</h1>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "#f8f9fb",
          padding: 14,
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 700 }}>
          {event?.name || "No active event"}
        </div>
        <div style={{ color: "#555" }}>{event?.location || ""}</div>
        <div
          role={status.type === "error" ? "alert" : "status"}
          style={{
            fontSize: 13,
            marginTop: 6,
            color:
              status.type === "error"
                ? "#b91c1c"
                : status.type === "loading"
                  ? "#475569"
                  : "#555",
            fontWeight: status.type === "error" ? 700 : 400,
          }}
        >
          {status.text}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isNarrow ? "1fr" : "360px minmax(0, 1fr)",
          gridTemplateAreas: isNarrow ? "'map' 'list'" : "'list map'",
          gap: 20,
          alignItems: "start",
        }}
      >
        <div
          style={{
            gridArea: "list",
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 14,
            display: "grid",
            gap: 12,
            maxHeight: isNarrow ? "none" : "82vh",
            overflow: isNarrow ? "visible" : "auto",
          }}
        >
          <div style={{ fontWeight: 700 }}>Locations</div>

          <input
            type="text"
            placeholder="Search locations"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: 8 }}
          />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setCategoryFilter("all")}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border:
                  categoryFilter === "all"
                    ? "1px solid #111827"
                    : "1px solid #ddd",
                background: categoryFilter === "all" ? "#111827" : "white",
                color: categoryFilter === "all" ? "white" : "#111",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              All
            </button>

            {availableCategories.map((category) => {
              const active =
                categoryFilter.toLowerCase() === category.toLowerCase();

              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setCategoryFilter(category)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: active ? "1px solid #111827" : "1px solid #ddd",
                    background: active ? "#111827" : "white",
                    color: active ? "white" : "#111",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 700,
                    textTransform: "capitalize",
                  }}
                >
                  {category}
                </button>
              );
            })}
          </div>

          <div style={{ fontSize: 13, color: "#666" }}>
            Showing {filteredLocations.length} of {locations.length}
            {categoryFilter !== "all" ? ` • Category: ${categoryFilter}` : ""}
          </div>

          {filteredLocations.map((loc) => {
            const selected = loc.id === selectedLocationId;

            return (
              <button
                key={loc.id}
                type="button"
                onClick={() => handleLocationClick(loc)}
                style={{
                  textAlign: "left",
                  width: "100%",
                  padding: 12,
                  borderRadius: 8,
                  border: selected ? "1px solid #f0c36d" : "1px solid #eee",
                  background: selected ? "#fff7d6" : "white",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 700 }}>{loc.name}</div>

                {loc.category && (
                  <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>
                    {loc.category}
                  </div>
                )}

                {loc.description && (
                  <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                    {loc.description}
                  </div>
                )}

                <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>
                  Priority {loc.priority ?? 100} · Tap to center map
                </div>
              </button>
            );
          })}

          {selectedLocation && (
            <div
              style={{
                border: "1px solid #eee",
                borderRadius: 8,
                padding: 10,
                background: "#fafafa",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                Selected Location
              </div>

              <div>{selectedLocation.name}</div>

              {selectedLocation.category && (
                <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>
                  {selectedLocation.category}
                </div>
              )}

              {selectedLocation.description && (
                <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>
                  {selectedLocation.description}
                </div>
              )}

              <div style={{ fontSize: 12, color: "#777", marginTop: 6 }}>
                Priority: {selectedLocation.priority ?? 100}
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            gridArea: "map",
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 12,
            height: isNarrow ? "65vh" : "82vh",
            minHeight: 420,
          }}
        >
          <div style={{ position: "relative", width: "100%", height: "100%" }}>
            <MapCanvas
              imageUrl={event?.map_image_url ?? null}
              markers={markers}
              viewportHeight="100%"
              selectionMode="none"
              showLabels={false}
              selectedIds={selectedLocationId ? [selectedLocationId] : []}
              primaryId={selectedLocationId || null}
              onMarkerTap={handleMarkerTap}
              renderMarker={renderMarker}
            />

            {event?.map_image_url && !imageLoaded && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#475569",
                  fontWeight: 700,
                  background: "rgba(255,255,255,0.72)",
                  pointerEvents: "none",
                }}
              >
                Loading map markers...
              </div>
            )}
          </div>

          <div
            style={{
              display: "grid",
              gap: 8,
              marginTop: 10,
              padding: 10,
              border: "1px solid #eee",
              borderRadius: 8,
              background: "#fafafa",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13 }}>Map Legend</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {MARKER_LEGEND_ITEMS.map((item) => (
                <div
                  key={item.label}
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      background: item.color,
                      border: "1px solid rgba(0,0,0,0.2)",
                      display: "inline-block",
                    }}
                  />
                  <span style={{ fontSize: 12, color: "#555" }}>
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
