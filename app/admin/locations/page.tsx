"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import PageNavigation from "@/components/layout/PageNavigation";
import { MapCanvas, type MapCanvasHandle } from "@/components/map/canvas";
import type { MapMarker } from "@/components/map/canvas/types";
import { useAdmin } from "@/lib/adminContext";
import {
  getCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";
import { canAccessEvent } from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";

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

function AdminLocationsPageInner() {
  const [event, setEvent] = useState<ActiveEvent | null>(null);
  const [locations, setLocations] = useState<EventLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Loading...");
  const [isNarrow, setIsNarrow] = useState(false);

  const [formId, setFormId] = useState("");
  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formPriority, setFormPriority] = useState("100");
  const [formX, setFormX] = useState("");
  const [formY, setFormY] = useState("");
  const [isPlacing, setIsPlacing] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mapRef = useRef<MapCanvasHandle | null>(null);

  const { admin } = useAdmin();

  useEffect(() => {
    function handleResize() {
      setIsNarrow(window.innerWidth < 900);
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const loadLocationIntoForm = useCallback((location: EventLocation) => {
    setFormId(location.id);
    setFormName(location.name || "");
    setFormCategory(location.category || "");
    setFormDescription(location.description || "");
    setFormPriority(String(location.priority ?? 100));
    setFormX(location.map_x !== null ? String(location.map_x) : "");
    setFormY(location.map_y !== null ? String(location.map_y) : "");
    setSelectedLocationId(location.id);
    setIsPlacing(false);
  }, []);

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatus("Loading...");

    const adminEvent = getCurrentAdminEvent() as AdminEventContext | null;

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

    const nextLocations = (locationData || []) as EventLocation[];
    setLocations(nextLocations);
    setStatus(`Loaded ${nextLocations.length} locations.`);

    if (selectedLocationId) {
      const refreshed = nextLocations.find(
        (loc) => loc.id === selectedLocationId,
      );
      if (refreshed) {
        loadLocationIntoForm(refreshed);
      } else {
        setSelectedLocationId("");
      }
    }

    setLoading(false);
  }, [loadLocationIntoForm, selectedLocationId]);

  useEffect(() => {
    if (!admin) {
      return;
    }

    const adminEvent = getCurrentAdminEvent() as AdminEventContext | null;

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
      return;
    }

    void loadPage();
    const unsubscribe = subscribeToAdminWorkspace(() => {
      void loadPage();
    });
    return unsubscribe;
  }, [admin, loadPage]);
  // Workspace layout — removes max-width cap while this page is mounted
  useEffect(() => {
    document.body.classList.add("admin-map-workspace");

    return () => {
      document.body.classList.remove("admin-map-workspace");
    };
  }, []);
  const filteredLocations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return locations;
    }

    return locations.filter((loc) => {
      const text = [loc.name || "", loc.category || "", loc.description || ""]
        .join(" ")
        .toLowerCase();

      return text.includes(q);
    });
  }, [locations, search]);

  const selectedLocation =
    locations.find((loc) => loc.id === selectedLocationId) || null;

  const locationById = useMemo(() => {
    const map = new Map<string, EventLocation>();
    for (const loc of locations) {
      map.set(loc.id, loc);
    }
    return map;
  }, [locations]);

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
    setIsPlacing(false);
    loadLocationIntoForm(location);

    const vp = mapRef.current?.getViewport();
    mapRef.current?.centerOnMarker(location.id, vp?.scale);

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

  const handleMarkerTap = useCallback(
    (id: string) => {
      const loc = locationById.get(id);
      if (loc) {
        handleLocationClick(loc);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locationById],
  );

  const renderMarker = useCallback(
    (m: MapMarker) => {
      const loc = locationById.get(m.id);
      if (!loc) {
        return null;
      }

      return (
        <>
          <div
            title={loc.name}
            style={{
              width: 60,
              height: 60,
              borderRadius: "50%",
              background: getMarkerColor(loc),
              border: isNarrow ? "3px solid white" : "2px solid white",
              boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
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
            {loc.name}
          </div>
        </>
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locationById, selectedLocationId, isNarrow],
  );

  function resetForm() {
    setFormId("");
    setFormName("");
    setFormCategory("");
    setFormDescription("");
    setFormPriority("100");
    setFormX("");
    setFormY("");
    setIsPlacing(false);
    setSelectedLocationId("");
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

    try {
      setSaving(true);
      setError(null);

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
        const { error } = await supabase
          .from("event_locations")
          .insert(payload);

        if (error) {
          setStatus(`Could not create location: ${error.message}`);
          return;
        }

        setStatus(`Created ${payload.name}.`);
      }

      await loadPage();
      resetForm();
    } finally {
      setSaving(false);
    }
  }

  async function deleteLocation() {
    if (!formId) {
      setStatus("No location selected to delete.");
      return;
    }

    const confirmed = window.confirm(`Delete "${formName}"?`);
    if (!confirmed) {
      return;
    }

    try {
      setDeleting(true);
      const deletedName = formName;

      const { error } = await supabase
        .from("event_locations")
        .delete()
        .eq("id", formId);

      if (error) {
        setStatus(`Could not delete location: ${error.message}`);
        return;
      }

      if (selectedLocationId === formId) {
        setSelectedLocationId("");
      }

      await loadPage();
      resetForm();
      setStatus(`Deleted ${deletedName}.`);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div style={{ padding: isNarrow ? 12 : 24 }}>
      <PageNavigation
        homeHref="/admin/dashboard"
        homeLabel="Dashboard"
        parentHref="/admin/map-admin"
        parentLabel="Map Admin"
      />

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
              onClick={() => {
                const next = !isPlacing;
                setIsPlacing(next);
              }}
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
              <button
                type="button"
                onClick={() => void saveLocation()}
                disabled={saving}
              >
                {saving
                  ? formId
                    ? "Updating..."
                    : "Saving..."
                  : formId
                    ? "Update Location"
                    : "Save Location"}
              </button>
              <button
                type="button"
                onClick={() => void deleteLocation()}
                disabled={!formId || deleting}
              >
                {deleting ? "Deleting..." : "Delete"}
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
            style={{
              height: isNarrow ? "60vh" : "82vh",
              minHeight: isNarrow ? 320 : 420,
              border: "1px solid #ddd",
              background: "#f2f2f2",
              overflow: "hidden",
              touchAction: "none",
              position: "relative",
              width: "100%",
              borderRadius: 10,
            }}
          >
            <MapCanvas
              ref={mapRef}
              imageUrl={event?.map_image_url ?? null}
              markers={markers}
              viewportHeight={isNarrow ? "60vh" : "82vh"}
              initialScale={
                event ? (event.locations_map_open_scale ?? 0.6) : undefined
              }
              maxScale={8}
              editable={isPlacing}
              selectionMode="none"
              showLabels={false}
              onMapTap={({ xPct, yPct }) => {
                if (!isPlacing) {
                  return;
                }

                const safeX = Math.max(
                  0,
                  Math.min(100, Number(xPct.toFixed(2))),
                );
                const safeY = Math.max(
                  0,
                  Math.min(100, Number(yPct.toFixed(2))),
                );

                setFormX(String(safeX));
                setFormY(String(safeY));
                setIsPlacing(false);
                setStatus(
                  `Placed marker at X ${safeX}, Y ${safeY}. Save to keep it.`,
                );
              }}
              onMarkerTap={handleMarkerTap}
              renderMarker={renderMarker}
            />
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
    <AdminRouteGuard requiredPermission="can_manage_locations">
      <AdminShellAdapter pageTitle="Map Locations" contentMode="full-bleed">
        <AdminLocationsPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}
