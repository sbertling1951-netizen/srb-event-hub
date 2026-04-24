"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";

type ActiveEvent = {
  id: string;
  name: string;
  location: string | null;
  map_image_url: string | null;
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

type PinchState = {
  startDistance: number;
  startZoom: number;
  contentX: number;
  contentY: number;
};

export default function PublicLocationsPage() {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(0.6);
  const _pinchRef = useRef<PinchState | null>(null);

  const [event, setEvent] = useState<ActiveEvent | null>(null);
  const [locations, setLocations] = useState<EventLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [status, setStatus] = useState("Loading...");
  const [isNarrow, setIsNarrow] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ width: 1200, height: 800 });
  const [defaultZoom, setDefaultZoom] = useState(0.6);
  const [zoom, setZoom] = useState(0.6);

  function clampZoom(next: number) {
    return Math.min(Math.max(next, 0.25), 3);
  }

  function _getTouchDistance(touches: TouchList) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function _getTouchMidpoint(touches: TouchList) {
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    };
  }

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    function handleResize() {
      setIsNarrow(window.innerWidth < 900);
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const el = mapRef.current;
    if (!el) {
      return;
    }

    const container = el;

    function onWheel(e: WheelEvent) {
      if (isNarrow) {
        return;
      }

      e.preventDefault();

      const rect = container.getBoundingClientRect();
      const viewportX = e.clientX - rect.left;
      const viewportY = e.clientY - rect.top;

      const currentZoom = zoomRef.current;
      const nextZoom = clampZoom(currentZoom * (e.deltaY > 0 ? 0.92 : 1.08));

      const contentX = (container.scrollLeft + viewportX) / currentZoom;
      const contentY = (container.scrollTop + viewportY) / currentZoom;

      setZoom(nextZoom);
      zoomRef.current = nextZoom;

      requestAnimationFrame(() => {
        container.scrollLeft = Math.max(0, contentX * nextZoom - viewportX);
        container.scrollTop = Math.max(0, contentY * nextZoom - viewportY);
      });
    }

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [isNarrow]);

  const loadPage = useCallback(async () => {
    setStatus("Loading...");

    const { data: activeEvent, error: eventError } = await supabase
      .from("events")
      .select("id,name,location,map_image_url,locations_map_open_scale")
      .eq("is_active", true)
      .single();

    if (eventError || !activeEvent) {
      setStatus(
        `Could not load active event: ${eventError?.message || "No active event found."}`,
      );
      return;
    }

    const typedEvent = activeEvent as ActiveEvent;
    setEvent(typedEvent);

    const openingScale = Number(typedEvent.locations_map_open_scale ?? 0.6);
    const safeOpeningScale = Number.isNaN(openingScale)
      ? 0.6
      : clampZoom(openingScale);
    setDefaultZoom(safeOpeningScale);
    setZoom(safeOpeningScale);

    const { data: locationData, error: locationError } = await supabase
      .from("event_locations")
      .select("id,event_id,name,category,description,map_x,map_y,priority")
      .eq("event_id", typedEvent.id)
      .order("priority", { ascending: true })
      .order("name", { ascending: true });

    if (locationError) {
      setStatus(`Could not load map locations: ${locationError.message}`);
      return;
    }

    setLocations((locationData || []) as EventLocation[]);
    setStatus(`Loaded ${(locationData || []).length} locations.`);
  }, []);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

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

  const selectedLocation =
    locations.find((loc) => loc.id === selectedLocationId) || null;

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

  const markerLegendItems = useMemo(
    () => [
      { label: "Trash / Dumpster", color: "#dc2626" },
      { label: "Building / Office", color: "#2563eb" },
      { label: "Restroom / Bathroom", color: "#16a34a" },
      { label: "Registration", color: "#d97706" },
      { label: "Other", color: "#7c3aed" },
      { label: "Selected", color: "gold" },
    ],
    [],
  );

  function focusLocation(
    location: EventLocation,
    targetZoom = zoomRef.current,
  ) {
    if (!mapRef.current || location.map_x === null || location.map_y === null) {
      return;
    }

    const container = mapRef.current;
    const scaledWidth = naturalSize.width * targetZoom;
    const scaledHeight = naturalSize.height * targetZoom;

    const x = (location.map_x / 100) * scaledWidth;
    const y = (location.map_y / 100) * scaledHeight;

    requestAnimationFrame(() => {
      container.scrollTo({
        left: Math.max(0, x - container.clientWidth / 2),
        top: Math.max(0, y - container.clientHeight / 2),
        behavior: "smooth",
      });
    });
  }

  function handleLocationClick(location: EventLocation) {
    setSelectedLocationId(location.id);
    focusLocation(location);
    setStatus(`Focused map on ${location.name}.`);
  }

  function getMarkerColor(location: EventLocation) {
    if (location.id === selectedLocationId) {
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

  function getMarkerSize(location: EventLocation) {
    if (location.id === selectedLocationId) {
      return isNarrow ? 44 : 36;
    }
    return isNarrow ? 22 : 16;
  }

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
        <div style={{ fontSize: 13, marginTop: 6 }}>{status}</div>
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
          }}
        >
          <div
            ref={mapRef}
            style={{
              overflow: "auto",
              maxHeight: isNarrow ? "72vh" : "82vh",
              border: "1px solid #ddd",
              background: "#f2f2f2",
              WebkitOverflowScrolling: "touch",
              touchAction: "pan-x pan-y",
            }}
          >
            <div
              style={{
                position: "relative",
                width: naturalSize.width * zoom,
                height: naturalSize.height * zoom,
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: naturalSize.width,
                  height: naturalSize.height,
                  transform: `scale(${zoom})`,
                  transformOrigin: "top left",
                }}
              >
                {event?.map_image_url && (
                  <img
                    src={event.map_image_url}
                    alt="Event map"
                    draggable={false}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      setNaturalSize({
                        width: img.naturalWidth || 1200,
                        height: img.naturalHeight || 800,
                      });
                    }}
                    style={{
                      width: naturalSize.width,
                      height: naturalSize.height,
                      display: "block",
                      userSelect: "none",
                      pointerEvents: "none",
                    }}
                  />
                )}

                {locations.map((loc) => {
                  if (loc.map_x === null || loc.map_y === null) {
                    return null;
                  }

                  const markerSize = getMarkerSize(loc);

                  return (
                    <div
                      key={loc.id}
                      style={{
                        position: "absolute",
                        left: `${loc.map_x}%`,
                        top: `${loc.map_y}%`,
                        transform: "translate(-50%, -50%)",
                        pointerEvents: "none",
                        zIndex: loc.id === selectedLocationId ? 4 : 2,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => handleLocationClick(loc)}
                        title={loc.name}
                        style={{
                          width: markerSize,
                          height: markerSize,
                          borderRadius: "50%",
                          background: getMarkerColor(loc),
                          border: isNarrow
                            ? "3px solid white"
                            : "2px solid white",
                          boxShadow:
                            loc.id === selectedLocationId
                              ? "0 0 0 4px rgba(255,215,0,0.35), 0 1px 4px rgba(0,0,0,0.35)"
                              : "0 1px 4px rgba(0,0,0,0.35)",
                          cursor: "pointer",
                          padding: 0,
                          display: "block",
                          margin: "0 auto",
                          pointerEvents: "auto",
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
                          fontSize: loc.id === selectedLocationId ? 12 : 10,
                          fontWeight: 700,
                          padding:
                            loc.id === selectedLocationId
                              ? "2px 6px"
                              : "1px 4px",
                          color: "#111",
                          whiteSpace: "nowrap",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                          display: "table",
                          pointerEvents: "none",
                        }}
                      >
                        {loc.name}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
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
              {markerLegendItems.map((item) => (
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

          <div
            style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}
          >
            <button
              type="button"
              onClick={() => setZoom((z) => clampZoom(z - 0.2))}
            >
              −
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => clampZoom(z + 0.2))}
            >
              +
            </button>
            <button type="button" onClick={() => setZoom(defaultZoom)}>
              Reset Zoom
            </button>
            {selectedLocation && (
              <button
                type="button"
                onClick={() => focusLocation(selectedLocation)}
              >
                Recenter Selected
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
