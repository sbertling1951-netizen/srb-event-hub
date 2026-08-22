"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { MapCanvas, type MapCanvasHandle, MarkerDot, MarkerLabelChip } from "@/components/map/canvas";
import type { MapMarker } from "@/components/map/canvas/types";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { useShellInterfaceCapabilities } from "@/components/shell/useShellViewport";
import { Alert, type AlertTone } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageSection } from "@/components/ui/PageSection";
import { useAdmin } from "@/lib/adminContext";
import {
  getCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";
import { canAccessEvent } from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";

// Pure, presentation-only classification of this page's own existing
// `status` confirmation/guidance text into an Alert tone -- never a second
// source of any message itself (every setStatus call site is unchanged).
// Mirrors the same heuristic already established for Announcements
// (announcementStatusTone) and Admin Users (adminUserStatusTone).
export function locationStatusTone(message: string): AlertTone {
  const lower = message.toLowerCase();

  if (
    lower.startsWith("could not") ||
    lower.includes("invalid") ||
    lower.includes("enter a location name") ||
    lower.includes("click place on map") ||
    lower.includes("no location selected") ||
    lower.includes("no admin event selected")
  ) {
    return "danger";
  }

  if (lower.endsWith("...")) {
    return "info";
  }

  if (
    lower.startsWith("updated") ||
    lower.startsWith("created") ||
    lower.startsWith("deleted") ||
    lower.startsWith("placed") ||
    lower.startsWith("loaded")
  ) {
    return "success";
  }

  return "neutral";
}

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
  const { isCompact: isNarrow } = useShellInterfaceCapabilities();

  const [formId, setFormId] = useState("");
  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formPriority, setFormPriority] = useState("100");
  const [formX, setFormX] = useState("");
  const [formY, setFormY] = useState("");
  const [isPlacing, setIsPlacing] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mapRef = useRef<MapCanvasHandle | null>(null);

  const { admin } = useAdmin();

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
          <MarkerDot
            size={60}
            color={getMarkerColor(loc)}
            borderWidth={isNarrow ? 3 : 2}
            title={loc.name}
          />
          <MarkerLabelChip text={loc.name} />
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

  function requestDeleteLocation() {
    if (!formId) {
      setStatus("No location selected to delete.");
      return;
    }

    setConfirmDeleteOpen(true);
  }

  async function deleteLocation() {
    setConfirmDeleteOpen(false);

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
    <div style={{ padding: isNarrow ? "var(--space-3)" : "var(--space-6)", display: "grid", gap: "var(--space-4)" }}>
      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Delete Location"
        message={`Delete "${formName}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        busy={deleting}
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={() => void deleteLocation()}
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {/* Event name/location is already owned by the canonical Admin shell
          header (Central UI Standard, matching Announcements' own precedent)
          -- this only shows what the shell cannot: loading, no selection,
          or this page's own save/placement status. */}
      {loading ? (
        <LoadingState message="Loading..." />
      ) : !event ? (
        <EmptyState message={status || "No admin working event selected. Choose one on the Admin Dashboard."} />
      ) : status ? (
        <Alert tone={locationStatusTone(status)}>{status}</Alert>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isNarrow ? "1fr" : "360px minmax(0, 1fr)",
          gap: "var(--space-5)",
          alignItems: "start",
        }}
      >
        <PageSection variant="card" title="Location Editor">
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            <Field label="Search Locations">
              {(controlProps) => (
                <Input
                  {...controlProps}
                  type="text"
                  placeholder="Search existing locations"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              )}
            </Field>

            <div className="app-flex-wrap-12">
              <AppButton onClick={resetForm}>New</AppButton>
              <AppButton
                variant={isPlacing ? "primary" : "tertiary"}
                aria-pressed={isPlacing}
                onClick={() => setIsPlacing((prev) => !prev)}
              >
                {isPlacing ? "Placing..." : "Place on Map"}
              </AppButton>
            </div>

            <Field label="Location Name">
              {(controlProps) => (
                <Input
                  {...controlProps}
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              )}
            </Field>

            <Field label="Category">
              {(controlProps) => (
                <Input
                  {...controlProps}
                  type="text"
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                />
              )}
            </Field>

            <Field label="Description">
              {(controlProps) => (
                <Textarea
                  {...controlProps}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={4}
                />
              )}
            </Field>

            <Field label="Priority">
              {(controlProps) => (
                <Input
                  {...controlProps}
                  type="number"
                  value={formPriority}
                  onChange={(e) => setFormPriority(e.target.value)}
                />
              )}
            </Field>

            <div className="app-form-grid-2">
              <Field label="X">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    type="number"
                    value={formX}
                    onChange={(e) => setFormX(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Y">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    type="number"
                    value={formY}
                    onChange={(e) => setFormY(e.target.value)}
                  />
                )}
              </Field>
            </div>

            <FormActions>
              <AppButton
                variant="primary"
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
              </AppButton>
              <AppButton
                variant="danger"
                onClick={requestDeleteLocation}
                disabled={!formId || deleting}
              >
                {deleting ? "Deleting..." : "Delete"}
              </AppButton>
            </FormActions>

            <strong>Existing Locations</strong>

            <div
              style={{
                display: "grid",
                gap: "var(--space-2)",
                maxHeight: isNarrow ? "none" : "45vh",
                overflow: "auto",
              }}
            >
              {filteredLocations.length === 0 ? (
                <EmptyState message="No locations found." />
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
                        padding: "var(--space-3)",
                        borderRadius: "var(--radius-medium)",
                        border: `var(--border-width-default) solid ${selected ? "var(--color-text-primary)" : "var(--color-border-default)"}`,
                        background: selected ? "var(--color-bg-muted)" : "var(--color-bg-panel)",
                        cursor: "pointer",
                      }}
                    >
                      <div className="data-table-cell-primary">{location.name}</div>
                      <div className="data-table-cell-meta">
                        {location.category || "Uncategorized"}
                      </div>
                      <div className="data-table-cell-meta" style={{ marginTop: "var(--space-1)" }}>
                        X: {location.map_x ?? "—"} · Y: {location.map_y ?? "—"}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </PageSection>

        <PageSection variant="card">
          <div
            style={{
              height: isNarrow ? "60vh" : "82vh",
              minHeight: isNarrow ? 320 : 420,
              border: "var(--border-width-default) solid var(--color-border-default)",
              background: "var(--color-bg-muted)",
              overflow: "hidden",
              touchAction: "none",
              position: "relative",
              width: "100%",
              borderRadius: "var(--radius-medium)",
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
                marginTop: "var(--space-3)",
                padding: "var(--space-3)",
                border: "var(--border-width-default) solid var(--color-border-default)",
                borderRadius: "var(--radius-medium)",
                background: "var(--color-bg-muted)",
              }}
            >
              <div className="data-table-cell-primary">{selectedLocation.name}</div>
              <div className="data-table-cell-meta">
                {selectedLocation.category || "Uncategorized"}
              </div>
              <div className="data-table-cell-meta" style={{ marginTop: "var(--space-1)" }}>
                {selectedLocation.description || ""}
              </div>
            </div>
          )}
        </PageSection>
      </div>
    </div>
  );
}

export default function AdminLocationsPage() {
  return (
    <AdminRouteGuard requiredTask="event.locations.manage">
      <AdminShellAdapter
        pageTitle="Map Locations"
        backTarget={{ href: "/admin/map-admin", label: "Map Admin" }}
        contentMode="full-bleed"
      >
        <AdminLocationsPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}
