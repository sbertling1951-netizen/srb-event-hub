"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getAdminEvent } from "@/lib/getAdminEvent";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import {
  getCurrentAdminAccess,
  canAccessEvent,
  hasPermission,
} from "@/lib/getCurrentAdminAccess";

type AdminEventContext = {
  id: string | null;
  name: string | null;
};

type ActiveEvent = {
  id: string;
  name: string;
  location: string | null;
  map_image_url: string | null;
  locations_map_open_scale: number | null;
};

type EventMapSettingsRow = {
  event_id: string;
  selected_master_map_id: string | null;
};

type MasterMapRow = {
  id: string;
  map_image_url: string | null;
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

type DragState = {
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
};

type PinchState = {
  startDistance: number;
  startZoom: number;
  contentX: number;
  contentY: number;
};

function clampZoom(next: number) {
  return Math.min(Math.max(next, 0.25), 3);
}

function getTouchDistance(touches: TouchList) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function getTouchMidpoint(touches: TouchList) {
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  };
}

function AdminLocationsPageInner() {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pinchRef = useRef<PinchState | null>(null);
  const zoomRef = useRef(0.6);

  const [event, setEvent] = useState<ActiveEvent | null>(null);
  const [locations, setLocations] = useState<EventLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Loading...");
  const [naturalSize, setNaturalSize] = useState({ width: 1200, height: 800 });
  const [isNarrow, setIsNarrow] = useState(false);
  const [defaultZoom, setDefaultZoom] = useState(0.6);
  const [zoom, setZoom] = useState(0.6);

  const [formId, setFormId] = useState("");
  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formPriority, setFormPriority] = useState("100");
  const [formX, setFormX] = useState("");
  const [formY, setFormY] = useState("");
  const [isPlacing, setIsPlacing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

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
    if (!el) return;

    const container = el;

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 2) return;

      const rect = container.getBoundingClientRect();
      const midpoint = getTouchMidpoint(e.touches);
      const startZoom = zoomRef.current;

      const viewportX = midpoint.x - rect.left;
      const viewportY = midpoint.y - rect.top;

      const contentX = (container.scrollLeft + viewportX) / startZoom;
      const contentY = (container.scrollTop + viewportY) / startZoom;

      pinchRef.current = {
        startDistance: getTouchDistance(e.touches),
        startZoom,
        contentX,
        contentY,
      };

      e.preventDefault();
    }

    function onTouchMove(e: TouchEvent) {
      const pinch = pinchRef.current;
      if (e.touches.length !== 2 || !pinch) return;

      const rect = container.getBoundingClientRect();
      const midpoint = getTouchMidpoint(e.touches);
      const currentDistance = getTouchDistance(e.touches);

      const nextZoom = clampZoom(
        pinch.startZoom * (currentDistance / pinch.startDistance),
      );

      const viewportX = midpoint.x - rect.left;
      const viewportY = midpoint.y - rect.top;

      setZoom(nextZoom);
      zoomRef.current = nextZoom;

      const nextLeft = pinch.contentX * nextZoom - viewportX;
      const nextTop = pinch.contentY * nextZoom - viewportY;

      requestAnimationFrame(() => {
        container.scrollLeft = Math.max(0, nextLeft);
        container.scrollTop = Math.max(0, nextTop);
      });

      e.preventDefault();
    }

    function onTouchEnd() {
      pinchRef.current = null;
    }

    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: false });
    container.addEventListener("touchcancel", onTouchEnd, { passive: false });

    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;

    const container = el;

    function onWheel(e: WheelEvent) {
      if (isNarrow) return;

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
    return () => {
      container.removeEventListener("wheel", onWheel);
    };
  }, [isNarrow]);

  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;

    const container = el;
    container.style.cursor = isNarrow ? "auto" : "grab";

    function onMouseDown(e: MouseEvent) {
      if (isNarrow) return;
      if (e.button !== 0) return;

      const target = e.target as HTMLElement;
      if (target.closest("button")) return;

      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startLeft: container.scrollLeft,
        startTop: container.scrollTop,
      };

      container.style.cursor = "grabbing";
      e.preventDefault();
    }

    function onMouseMove(e: MouseEvent) {
      if (isNarrow) return;
      if (!dragRef.current) return;

      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;

      container.scrollLeft = dragRef.current.startLeft - dx;
      container.scrollTop = dragRef.current.startTop - dy;
    }

    function onMouseUp() {
      dragRef.current = null;
      container.style.cursor = isNarrow ? "auto" : "grab";
    }

    container.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      container.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isNarrow]);

  useEffect(() => {
    async function init() {
      setLoading(true);
      setError(null);
      setStatus("Checking admin access...");
      setAccessDenied(false);

      const admin = await getCurrentAdminAccess();

      if (!admin) {
        setEvent(null);
        setLocations([]);
        setError("No admin access.");
        setStatus("Access denied.");
        setLoading(false);
        setAccessDenied(true);
        return;
      }

      if (!hasPermission(admin, "can_manage_master_maps")) {
        setEvent(null);
        setLocations([]);
        setError("You do not have permission to manage map locations.");
        setStatus("Access denied.");
        setLoading(false);
        setAccessDenied(true);
        return;
      }

      const adminEvent = getAdminEvent() as AdminEventContext | null;

      if (!adminEvent?.id) {
        setEvent(null);
        setLocations([]);
        setStatus(
          "No admin working event selected. Choose one on the Admin Dashboard.",
        );
        setLoading(false);
        return;
      }

      if (!canAccessEvent(admin, adminEvent.id)) {
        setEvent(null);
        setLocations([]);
        setError("You do not have access to this event.");
        setStatus("Access denied.");
        setLoading(false);
        setAccessDenied(true);
        return;
      }

      await loadPage();
    }

    void init();

    function handleStorage(e: StorageEvent) {
      if (e.key === "fcoc-admin-event-changed") {
        void init();
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  async function loadPage() {
    setLoading(true);
    setError(null);
    setStatus("Loading...");

    const adminEvent = getAdminEvent() as AdminEventContext | null;

    if (!adminEvent?.id) {
      setEvent(null);
      setLocations([]);
      setStatus(
        "No admin working event selected. Choose one on the Admin Dashboard.",
      );
      setLoading(false);
      return;
    }

    const { data: eventRow, error: eventError } = await supabase
      .from("events")
      .select("id,name,location,locations_map_open_scale")
      .eq("id", adminEvent.id)
      .single();

    if (eventError || !eventRow) {
      setEvent(null);
      setLocations([]);
      setStatus(
        `Could not load admin event: ${eventError?.message || "Selected event not found."}`,
      );
      setLoading(false);
      return;
    }

    const { data: mapSettingsRows, error: mapSettingsError } = await supabase
      .from("event_map_settings")
      .select("event_id,selected_master_map_id")
      .eq("event_id", adminEvent.id)
      .limit(1);

    if (mapSettingsError) {
      setStatus(
        `Could not load event map settings: ${mapSettingsError.message}`,
      );
      setLoading(false);
      return;
    }

    const mapSettings = (mapSettingsRows?.[0] ||
      null) as EventMapSettingsRow | null;

    let mapImageUrl: string | null = null;

    if (mapSettings?.selected_master_map_id) {
      const { data: masterMapRows, error: masterMapError } = await supabase
        .from("master_maps")
        .select("id,map_image_url")
        .eq("id", mapSettings.selected_master_map_id)
        .limit(1);

      if (masterMapError) {
        setStatus(
          `Could not load selected master map: ${masterMapError.message}`,
        );
        setLoading(false);
        return;
      }

      const selectedMasterMap = (masterMapRows?.[0] ||
        null) as MasterMapRow | null;
      mapImageUrl = selectedMasterMap?.map_image_url || null;
    }

    const typedEvent: ActiveEvent = {
      id: String(eventRow.id),
      name: String(eventRow.name || adminEvent.name || "Selected Event"),
      location: eventRow.location || null,
      map_image_url: mapImageUrl,
      locations_map_open_scale:
        typeof eventRow.locations_map_open_scale === "number"
          ? eventRow.locations_map_open_scale
          : null,
    };

    setEvent(typedEvent);

    const openingScale = Number(typedEvent.locations_map_open_scale ?? 0.6);
    const safeOpeningScale = Number.isNaN(openingScale)
      ? 0.6
      : clampZoom(openingScale);

    setDefaultZoom(safeOpeningScale);
    setZoom(safeOpeningScale);
    zoomRef.current = safeOpeningScale;

    const { data: locationData, error: locationError } = await supabase
      .from("event_locations")
      .select("id,event_id,name,category,description,map_x,map_y,priority")
      .eq("event_id", typedEvent.id)
      .order("priority", { ascending: true })
      .order("name", { ascending: true });

    if (locationError) {
      setStatus(`Could not load event locations: ${locationError.message}`);
      setLoading(false);
      return;
    }

    setLocations((locationData || []) as EventLocation[]);
    setStatus(`Loaded ${(locationData || []).length} locations.`);
    setLoading(false);
  }

  const filteredLocations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return locations;

    return locations.filter((loc) => {
      const text = [loc.name || "", loc.category || "", loc.description || ""]
        .join(" ")
        .toLowerCase();

      return text.includes(q);
    });
  }, [locations, search]);

  const selectedLocation =
    locations.find((loc) => loc.id === selectedLocationId) || null;

  function focusLocation(
    location: EventLocation,
    targetZoom = zoomRef.current,
  ) {
    if (!mapRef.current || location.map_x === null || location.map_y === null)
      return;

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
    setIsPlacing(false);
    focusLocation(location);
    loadLocationIntoForm(location);
    setStatus(`Focused map on ${location.name}.`);
  }

  function getMarkerColor(location: EventLocation) {
    if (location.id === selectedLocationId) return "gold";

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
    if (location.id === selectedLocationId) return isNarrow ? 44 : 36;
    return isNarrow ? 22 : 16;
  }

  function resetForm() {
    setFormId("");
    setFormName("");
    setFormCategory("");
    setFormDescription("");
    setFormPriority("100");
    setFormX("");
    setFormY("");
    setIsPlacing(false);
  }

  function loadLocationIntoForm(location: EventLocation) {
    setFormId(location.id);
    setFormName(location.name || "");
    setFormCategory(location.category || "");
    setFormDescription(location.description || "");
    setFormPriority(String(location.priority ?? 100));
    setFormX(location.map_x != null ? String(location.map_x) : "");
    setFormY(location.map_y != null ? String(location.map_y) : "");
    setSelectedLocationId(location.id);
    setIsPlacing(false);
  }

  function handleMapClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!isPlacing || !mapRef.current) return;

    const container = mapRef.current;
    const rect = container.getBoundingClientRect();

    const viewportX = e.clientX - rect.left;
    const viewportY = e.clientY - rect.top;

    const contentX = (container.scrollLeft + viewportX) / zoomRef.current;
    const contentY = (container.scrollTop + viewportY) / zoomRef.current;

    const xPercent = (contentX / naturalSize.width) * 100;
    const yPercent = (contentY / naturalSize.height) * 100;

    const safeX = Math.max(0, Math.min(100, Number(xPercent.toFixed(2))));
    const safeY = Math.max(0, Math.min(100, Number(yPercent.toFixed(2))));

    setFormX(String(safeX));
    setFormY(String(safeY));
    setStatus(`Placed marker at X ${safeX}, Y ${safeY}. Save to keep it.`);
  }

  async function saveLocation() {
    if (!event?.id) {
      setStatus("No admin event selected.");
      return;
    }

    if (!formName.trim()) {
      setStatus("Enter a location name.");
      return;
    }

    if (formX === "" || formY === "") {
      setStatus("Click Place on Map, then click the map to choose a position.");
      return;
    }

    const payload = {
      event_id: event.id,
      name: formName.trim(),
      category: formCategory.trim() || null,
      description: formDescription.trim() || null,
      priority: Number(formPriority || 100),
      map_x: Number(formX),
      map_y: Number(formY),
    };

    if (
      Number.isNaN(payload.priority) ||
      Number.isNaN(payload.map_x) ||
      Number.isNaN(payload.map_y)
    ) {
      setStatus("Priority or map coordinates are invalid.");
      return;
    }

    if (formId) {
      const { error } = await supabase
        .from("event_locations")
        .update(payload)
        .eq("id", formId);

      if (error) {
        setStatus(`Could not update location: ${error.message}`);
        return;
      }

      setStatus(`Updated ${payload.name}.`);
    } else {
      const { error } = await supabase.from("event_locations").insert(payload);

      if (error) {
        setStatus(`Could not create location: ${error.message}`);
        return;
      }

      setStatus(`Created ${payload.name}.`);
    }

    await loadPage();
    resetForm();
  }

  async function deleteLocation() {
    if (!formId) {
      setStatus("No location selected to delete.");
      return;
    }

    const confirmed = window.confirm(`Delete "${formName}"?`);
    if (!confirmed) return;

    const { error } = await supabase
      .from("event_locations")
      .delete()
      .eq("id", formId);

    if (error) {
      setStatus(`Could not delete location: ${error.message}`);
      return;
    }

    setStatus(`Deleted ${formName}.`);
    if (selectedLocationId === formId) {
      setSelectedLocationId("");
    }
    await loadPage();
    resetForm();
  }

  // Access denied return
  if (!loading && accessDenied) {
    return (
      <div style={{ padding: 24 }}>
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 18,
          }}
        >
          <h1 style={{ marginTop: 0, marginBottom: 8 }}>Map Locations</h1>
          <div style={{ fontSize: 14, opacity: 0.8 }}>
            You do not have access to this page.
          </div>
        </div>
      </div>
    );
  }

  // Main page return
  return (
    <div style={{ padding: isNarrow ? 12 : 24 }}>
      <h1 style={{ marginTop: 0, fontSize: isNarrow ? 30 : 40 }}>
        Map Locations
      </h1>

      {error ? (
        <div
          style={{
            border: "1px solid #e2b4b4",
            borderRadius: 10,
            background: "#fff3f3",
            color: "#8a1f1f",
            padding: 12,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      ) : null}

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
          {event?.name || "No admin working event selected"}
        </div>
        <div style={{ color: "#555" }}>{event?.location || ""}</div>
        <div style={{ fontSize: 13, marginTop: 6 }}>
          Status: {loading ? "Loading..." : status}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isNarrow ? "1fr" : "360px minmax(0, 1fr)",
          gap: 20,
          alignItems: "start",
        }}
      >
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
          <div style={{ fontWeight: 700 }}>Location Editor</div>

          <input
            type="text"
            placeholder="Search existing locations"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: 8 }}
          />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={resetForm}>
              New
            </button>
            <button
              type="button"
              onClick={() => setIsPlacing((v) => !v)}
              style={{
                background: isPlacing ? "#0b5cff" : undefined,
                color: isPlacing ? "white" : undefined,
              }}
            >
              {isPlacing ? "Placing..." : "Place on Map"}
            </button>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <input
              type="text"
              placeholder="Location name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              style={{ padding: 8 }}
            />
            <input
              type="text"
              placeholder="Category"
              value={formCategory}
              onChange={(e) => setFormCategory(e.target.value)}
              style={{ padding: 8 }}
            />
            <textarea
              placeholder="Description"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              rows={4}
              style={{ padding: 8, resize: "vertical" }}
            />
            <input
              type="number"
              placeholder="Priority"
              value={formPriority}
              onChange={(e) => setFormPriority(e.target.value)}
              style={{ padding: 8 }}
            />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              <input
                type="number"
                placeholder="X"
                value={formX}
                onChange={(e) => setFormX(e.target.value)}
                style={{ padding: 8 }}
              />
              <input
                type="number"
                placeholder="Y"
                value={formY}
                onChange={(e) => setFormY(e.target.value)}
                style={{ padding: 8 }}
              />
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => void saveLocation()}>
                {formId ? "Update Location" : "Save Location"}
              </button>
              <button
                type="button"
                onClick={() => void deleteLocation()}
                disabled={!formId}
              >
                Delete
              </button>
            </div>
          </div>

          <div style={{ fontWeight: 700, marginTop: 8 }}>
            Existing Locations
          </div>

          <div
            style={{
              display: "grid",
              gap: 8,
              maxHeight: isNarrow ? "none" : "45vh",
              overflow: "auto",
            }}
          >
            {filteredLocations.length === 0 ? (
              <div style={{ fontSize: 13, color: "#666" }}>
                No locations found.
              </div>
            ) : (
              filteredLocations.map((location) => {
                const selected = location.id === selectedLocationId;

                return (
                  <button
                    key={location.id}
                    type="button"
                    onClick={() => handleLocationClick(location)}
                    style={{
                      textAlign: "left",
                      padding: 10,
                      borderRadius: 8,
                      border: selected ? "1px solid #f0c36d" : "1px solid #eee",
                      background: selected ? "#fff7d6" : "white",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{location.name}</div>
                    <div style={{ fontSize: 13, color: "#555" }}>
                      {location.category || "Uncategorized"}
                    </div>
                    <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                      X: {location.map_x ?? "—"} · Y: {location.map_y ?? "—"}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 12,
          }}
        >
          <div
            ref={mapRef}
            onClick={handleMapClick}
            style={{
              overflow: "auto",
              maxHeight: isNarrow ? "60vh" : "82vh",
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

                {locations.map((location) => {
                  if (location.map_x === null || location.map_y === null)
                    return null;

                  return (
                    <div
                      key={location.id}
                      style={{
                        position: "absolute",
                        left: `${location.map_x}%`,
                        top: `${location.map_y}%`,
                        transform: "translate(-50%, -50%)",
                        pointerEvents: "none",
                      }}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleLocationClick(location);
                        }}
                        title={location.name}
                        style={{
                          width: getMarkerSize(location),
                          height: getMarkerSize(location),
                          borderRadius: "50%",
                          background: getMarkerColor(location),
                          border: isNarrow
                            ? "3px solid white"
                            : "2px solid white",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
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
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "1px 4px",
                          color: "#111",
                          whiteSpace: "nowrap",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                          display: "table",
                          pointerEvents: "none",
                        }}
                      >
                        {location.name}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div
            style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}
          >
            <button
              type="button"
              onClick={() => {
                const next = clampZoom(zoomRef.current - 0.1);
                setZoom(next);
                zoomRef.current = next;
              }}
            >
              −
            </button>
            <button
              type="button"
              onClick={() => {
                const next = clampZoom(zoomRef.current + 0.1);
                setZoom(next);
                zoomRef.current = next;
              }}
            >
              +
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(defaultZoom);
                zoomRef.current = defaultZoom;
              }}
            >
              Reset Zoom
            </button>
          </div>

          {selectedLocation && (
            <div
              style={{
                marginTop: 12,
                padding: 10,
                border: "1px solid #eee",
                borderRadius: 8,
                background: "#fafafa",
              }}
            >
              <div style={{ fontWeight: 700 }}>{selectedLocation.name}</div>
              <div style={{ fontSize: 13, color: "#555" }}>
                {selectedLocation.category || "Uncategorized"}
              </div>
              <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
                {selectedLocation.description || ""}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminLocationsPage() {
  return (
    <AdminRouteGuard>
      <AdminLocationsPageInner />
    </AdminRouteGuard>
  );
}
