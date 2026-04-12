"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getAdminEvent } from "@/lib/getAdminEvent";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import {
  getCurrentAdminAccess,
  canAccessEvent,
} from "@/lib/getCurrentAdminAccess";

type MasterMapRow = {
  id: string;
  name: string;
  park_name: string | null;
  location: string | null;
  map_image_url: string | null;
  status: "draft" | "published" | "archived";
  is_read_only: boolean;
  site_count: number;
  map_group: string | null;
};

type AdminEventSettings = {
  id: string;
  name: string;
  coach_map_open_scale: number | null;
  parking_map_open_scale: number | null;
  locations_map_open_scale: number | null;
};

type MasterMapSiteCopyRow = {
  site_number: string;
  display_label: string | null;
  map_x: number | null;
  map_y: number | null;
};

function normalizeMapGroup(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stripDraftSuffix(value: string | null | undefined) {
  return String(value || "")
    .replace(/\s+Draft$/i, "")
    .trim();
}

function MasterMapsPageInner() {
  const [maps, setMaps] = useState<MasterMapRow[]>([]);
  const [status, setStatus] = useState("Loading master maps...");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedEventName, setSelectedEventName] = useState("");
  const [openingMapId, setOpeningMapId] = useState<string | null>(null);

  const [coachMapOpenScale, setCoachMapOpenScale] = useState("0.6");
  const [parkingMapOpenScale, setParkingMapOpenScale] = useState("0.6");
  const [locationsMapOpenScale, setLocationsMapOpenScale] = useState("0.6");

  const [showArchived, setShowArchived] = useState(false);
  const [restoringMapId, setRestoringMapId] = useState<string | null>(null);
  const [deletingMapId, setDeletingMapId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [savingScales, setSavingScales] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [canManageMaps, setCanManageMaps] = useState(false);

  const currentMaps = useMemo(() => {
    return maps.filter((map) => map.status !== "archived");
  }, [maps]);

  const archivedMaps = useMemo(() => {
    return maps.filter((map) => map.status === "archived");
  }, [maps]);

  const visibleMaps = showArchived ? archivedMaps : currentMaps;

  async function loadMasterMaps(viewArchived = showArchived) {
    const { data, error } = await supabase
      .from("master_maps")
      .select(
        "id,name,park_name,location,map_image_url,status,is_read_only,site_count,map_group",
      )
      .in("status", ["published", "draft", "archived"])
      .order("park_name", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      setStatus(`Could not load master maps: ${error.message}`);
      return;
    }

    const loaded = (data || []) as MasterMapRow[];
    setMaps(loaded);

    const activeCount = loaded.filter(
      (map) => map.status !== "archived",
    ).length;
    const archivedCount = loaded.filter(
      (map) => map.status === "archived",
    ).length;

    setStatus(
      viewArchived
        ? `Viewing ${archivedCount} archived map(s).`
        : `Viewing ${activeCount} active map(s).`,
    );
  }

  async function loadSelectedEventSettings() {
    const currentEvent = getAdminEvent();

    if (!currentEvent?.id) {
      setSelectedEventId("");
      setSelectedEventName("");
      setCoachMapOpenScale("0.6");
      setParkingMapOpenScale("0.6");
      setLocationsMapOpenScale("0.6");
      return;
    }

    const admin = await getCurrentAdminAccess();

    if (!admin || !canAccessEvent(admin, String(currentEvent.id))) {
      setSelectedEventId("");
      setSelectedEventName("");
      setCoachMapOpenScale("0.6");
      setParkingMapOpenScale("0.6");
      setLocationsMapOpenScale("0.6");
      return;
    }

    const { data: eventRow, error: eventError } = await supabase
      .from("events")
      .select(
        "id,name,coach_map_open_scale,parking_map_open_scale,locations_map_open_scale",
      )
      .eq("id", currentEvent.id)
      .single();

    if (eventError || !eventRow) {
      setSelectedEventId("");
      setSelectedEventName("");
      setCoachMapOpenScale("0.6");
      setParkingMapOpenScale("0.6");
      setLocationsMapOpenScale("0.6");
      setStatus(
        `No selected event settings loaded: ${eventError?.message || "No selected event found."}`,
      );
      return;
    }

    const event = eventRow as AdminEventSettings;
    setSelectedEventId(event.id);
    setSelectedEventName(event.name || "");
    setCoachMapOpenScale(String(event.coach_map_open_scale ?? 0.6));
    setParkingMapOpenScale(String(event.parking_map_open_scale ?? 0.6));
    setLocationsMapOpenScale(String(event.locations_map_open_scale ?? 0.6));
  }

  async function saveMapScales() {
    if (!selectedEventId) {
      setStatus(
        "No selected admin event found. Cannot save map scale settings.",
      );
      return;
    }

    const admin = await getCurrentAdminAccess();
    if (!admin) {
      setError("No admin access.");
      setStatus("Access denied.");
      return;
    }

    if (!canAccessEvent(admin, selectedEventId)) {
      setError("You do not have access to this event.");
      setStatus("Access denied.");
      return;
    }

    const coach = Number(coachMapOpenScale || 0.6);
    const parking = Number(parkingMapOpenScale || 0.6);
    const locations = Number(locationsMapOpenScale || 0.6);

    if (
      Number.isNaN(coach) ||
      Number.isNaN(parking) ||
      Number.isNaN(locations)
    ) {
      setStatus("One or more map opening scales are invalid.");
      return;
    }

    try {
      setSavingScales(true);

      const { error } = await supabase
        .from("events")
        .update({
          coach_map_open_scale: coach,
          parking_map_open_scale: parking,
          locations_map_open_scale: locations,
        })
        .eq("id", selectedEventId);

      if (error) {
        setStatus(`Could not save map scale settings: ${error.message}`);
        return;
      }

      setStatus("Map opening scale settings saved.");
      await loadSelectedEventSettings();
    } finally {
      setSavingScales(false);
    }
  }

  async function handleEditMap(map: MasterMapRow) {
    try {
      const admin = await getCurrentAdminAccess();
      if (!admin) {
        setError("No admin access.");
        setStatus("Access denied.");
        return;
      }

      setOpeningMapId(map.id);
      setStatus(`Opening ${map.name}...`);

      if (map.status === "draft") {
        window.location.href = `/admin/master-maps/${map.id}`;
        return;
      }

      const mapGroup =
        normalizeMapGroup(map.map_group) ||
        normalizeMapGroup(map.park_name) ||
        normalizeMapGroup(stripDraftSuffix(map.name));

      const draftLookup = await supabase
        .from("master_maps")
        .select("id,name,status,map_group,park_name");

      if (draftLookup.error) {
        setStatus(
          `Could not look for existing draft: ${draftLookup.error.message}`,
        );
        return;
      }

      const existingDraft = ((draftLookup.data || []) as MasterMapRow[]).find(
        (row) =>
          row.status === "draft" &&
          (normalizeMapGroup(row.map_group) ||
            normalizeMapGroup(row.park_name) ||
            normalizeMapGroup(stripDraftSuffix(row.name))) === mapGroup,
      );

      if (existingDraft?.id) {
        window.location.href = `/admin/master-maps/${existingDraft.id}`;
        return;
      }

      const draftName = `${stripDraftSuffix(map.name)} Draft`;

      const { data: newMap, error: newMapError } = await supabase
        .from("master_maps")
        .insert({
          name: draftName,
          map_group: mapGroup,
          park_name: map.park_name,
          location: map.location,
          map_image_path: null,
          map_image_url: map.map_image_url,
          status: "draft",
          is_read_only: false,
          site_count: map.site_count,
        })
        .select("id")
        .single();

      if (newMapError || !newMap) {
        setStatus(
          `Could not create editable draft: ${newMapError?.message || "Unknown error"}`,
        );
        return;
      }

      const { data: sourceSites, error: sourceSitesError } = await supabase
        .from("master_map_sites")
        .select("site_number,display_label,map_x,map_y")
        .eq("master_map_id", map.id);

      if (sourceSitesError) {
        setStatus(
          `Draft created, but could not load source markers: ${sourceSitesError.message}`,
        );
        return;
      }

      const sourceRows = (sourceSites || []) as MasterMapSiteCopyRow[];

      if (sourceRows.length > 0) {
        const newSites = sourceRows.map((site) => ({
          master_map_id: newMap.id,
          site_number: site.site_number,
          display_label: site.display_label,
          map_x: site.map_x,
          map_y: site.map_y,
        }));

        const { error: copyError } = await supabase
          .from("master_map_sites")
          .insert(newSites);

        if (copyError) {
          setStatus(
            `Draft created, but marker copy failed: ${copyError.message}`,
          );
          return;
        }
      }

      window.location.href = `/admin/master-maps/${newMap.id}`;
    } catch (err) {
      console.error("handleEditMap error:", err);
      setStatus(
        err instanceof Error ? err.message : "Could not open editable map.",
      );
    } finally {
      setOpeningMapId(null);
    }
  }

  async function handleRestoreMap(map: MasterMapRow) {
    try {
      const admin = await getCurrentAdminAccess();
      if (!admin) {
        setError("No admin access.");
        setStatus("Access denied.");
        return;
      }

      setRestoringMapId(map.id);
      setStatus(`Restoring ${map.name}...`);

      const mapGroup =
        normalizeMapGroup(map.map_group) ||
        normalizeMapGroup(map.park_name) ||
        normalizeMapGroup(stripDraftSuffix(map.name));

      if (!mapGroup) {
        setStatus("Map group is missing. Cannot restore map.");
        return;
      }

      const { data: allMaps, error: allMapsError } = await supabase
        .from("master_maps")
        .select("id,name,status,map_group,park_name");

      if (allMapsError) {
        setStatus(`Could not inspect existing maps: ${allMapsError.message}`);
        return;
      }

      const publishedIds = ((allMaps || []) as MasterMapRow[])
        .filter((row) => {
          const rowGroup =
            normalizeMapGroup(row.map_group) ||
            normalizeMapGroup(row.park_name) ||
            normalizeMapGroup(stripDraftSuffix(row.name));
          return row.status === "published" && rowGroup === mapGroup;
        })
        .map((row) => row.id);

      if (publishedIds.length > 0) {
        const { error: archiveError } = await supabase
          .from("master_maps")
          .update({
            status: "archived",
            is_read_only: true,
            updated_at: new Date().toISOString(),
          })
          .in("id", publishedIds);

        if (archiveError) {
          setStatus(
            `Could not archive current published map: ${archiveError.message}`,
          );
          return;
        }

        const { error: reassignError } = await supabase
          .from("event_map_settings")
          .update({
            selected_master_map_id: map.id,
          })
          .in("selected_master_map_id", publishedIds);

        if (reassignError) {
          setStatus(
            `Map restored, but event reassignment failed: ${reassignError.message}`,
          );
          return;
        }
      }

      const { error: restoreError } = await supabase
        .from("master_maps")
        .update({
          status: "published",
          is_read_only: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", map.id);

      if (restoreError) {
        setStatus(`Could not restore map: ${restoreError.message}`);
        return;
      }

      await loadMasterMaps(showArchived);
      setStatus(`Restored ${map.name} as the current map.`);
    } catch (err: any) {
      console.error("handleRestoreMap error:", err);
      setStatus(err?.message || "Failed to restore map.");
    } finally {
      setRestoringMapId(null);
    }
  }

  async function handleDeleteArchivedMap(map: MasterMapRow) {
    const confirmed = window.confirm(
      `Delete this archived map permanently?\n\n${map.name}\n\nThis will also delete its stored site markers.`,
    );

    if (!confirmed) return;

    try {
      const admin = await getCurrentAdminAccess();
      if (!admin) {
        setError("No admin access.");
        setStatus("Access denied.");
        return;
      }

      setDeletingMapId(map.id);
      setStatus(`Deleting ${map.name}...`);

      const { error: siteDeleteError } = await supabase
        .from("master_map_sites")
        .delete()
        .eq("master_map_id", map.id);

      if (siteDeleteError) {
        setStatus(`Could not delete map markers: ${siteDeleteError.message}`);
        return;
      }

      const { error: mapDeleteError } = await supabase
        .from("master_maps")
        .delete()
        .eq("id", map.id);

      if (mapDeleteError) {
        setStatus(`Could not delete archived map: ${mapDeleteError.message}`);
        return;
      }

      await loadMasterMaps(showArchived);
      setStatus(`Deleted archived map: ${map.name}`);
    } catch (err: any) {
      console.error("handleDeleteArchivedMap error:", err);
      setStatus(err?.message || "Failed to delete archived map.");
    } finally {
      setDeletingMapId(null);
    }
  }

  useEffect(() => {
    async function init() {
      setLoading(true);
      setError(null);
      setAccessDenied(false);
      setStatus("Checking admin access...");

      const admin = await getCurrentAdminAccess();

      if (!admin) {
        setMaps([]);
        setSelectedEventId("");
        setSelectedEventName("");
        setError("No admin access.");
        setStatus("Access denied.");
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      setCanManageMaps(true);

      await Promise.all([
        loadMasterMaps(showArchived),
        loadSelectedEventSettings(),
      ]);
      setLoading(false);
    }

    void init();

    function handleStorage(e: StorageEvent) {
      if (
        e.key === "fcoc-admin-event-changed" ||
        e.key === "fcoc-admin-event-context" ||
        e.key === "fcoc-user-mode" ||
        e.key === "fcoc-user-mode-changed"
      ) {
        void loadSelectedEventSettings();
      }
    }

    function handleAdminEventUpdated() {
      void loadSelectedEventSettings();
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener(
      "fcoc-admin-event-updated",
      handleAdminEventUpdated as EventListener,
    );

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        "fcoc-admin-event-updated",
        handleAdminEventUpdated as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    void loadMasterMaps(showArchived);
  }, [showArchived]);

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
          <h1 style={{ marginTop: 0, marginBottom: 8 }}>Master Maps</h1>
          <div style={{ fontSize: 14, opacity: 0.8 }}>
            You do not have access to this page.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => {
            window.location.href = "/admin/dashboard";
          }}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          ← Return to Dashboard
        </button>
      </div>

      <h1>Master Maps</h1>
      <p>Create and maintain protected campground map templates.</p>

      {error ? (
        <div
          style={{
            border: "1px solid #e2b4b4",
            borderRadius: 10,
            background: "#fff3f3",
            color: "#8a1f1f",
            padding: 12,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      ) : null}

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
          padding: 14,
          display: "grid",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 18 }}>
          Map Opening Scale Settings
        </div>

        <div style={{ fontSize: 14, color: "#555" }}>
          Selected admin event: <strong>{selectedEventName || "None"}</strong>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          <label style={{ display: "grid", gap: 6 }}>
            <span>Coach Map</span>
            <input
              type="number"
              step="0.05"
              min="0.25"
              max="3"
              value={coachMapOpenScale}
              onChange={(e) => setCoachMapOpenScale(e.target.value)}
              style={{ padding: 8 }}
              disabled={!canManageMaps}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>Parking Admin Map</span>
            <input
              type="number"
              step="0.05"
              min="0.25"
              max="3"
              value={parkingMapOpenScale}
              onChange={(e) => setParkingMapOpenScale(e.target.value)}
              style={{ padding: 8 }}
              disabled={!canManageMaps}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>Locations Map</span>
            <input
              type="number"
              step="0.05"
              min="0.25"
              max="3"
              value={locationsMapOpenScale}
              onChange={(e) => setLocationsMapOpenScale(e.target.value)}
              style={{ padding: 8 }}
              disabled={!canManageMaps}
            />
          </label>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => void saveMapScales()}
            disabled={!canManageMaps || loading || savingScales}
          >
            {savingScales ? "Saving..." : "Save Map Scale Settings"}
          </button>
        </div>

        <div style={{ fontSize: 12, color: "#666" }}>
          Suggested starting values are usually between <strong>0.45</strong>{" "}
          and <strong>0.75</strong>. Reset Zoom on each map can be tied to these
          saved values.
        </div>
      </div>

      <div
        style={{ marginBottom: 16, display: "flex", gap: 10, flexWrap: "wrap" }}
      >
        {!showArchived && (
          <Link href="/admin/master-maps/new">
            <button disabled={!canManageMaps}>Create New Master Map</button>
          </Link>
        )}

        <button type="button" onClick={() => setShowArchived((prev) => !prev)}>
          {showArchived
            ? "← Back to Active Maps"
            : `View Archived Maps (${archivedMaps.length})`}
        </button>
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: 12,
            fontWeight: 700,
            borderBottom: "1px solid #eee",
            background: "#fafafa",
          }}
        >
          {showArchived ? "Archived Maps" : "Active Maps"}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: showArchived
              ? "2fr 1.5fr 1.2fr 0.9fr 0.9fr 1.4fr"
              : "2fr 1.5fr 1.2fr 0.9fr 0.9fr 1fr",
            gap: 12,
            padding: 12,
            fontWeight: 700,
            borderBottom: "1px solid #eee",
          }}
        >
          <div>Name</div>
          <div>Park</div>
          <div>Location</div>
          <div>Status</div>
          <div>Sites</div>
          <div>Actions</div>
        </div>

        {visibleMaps.map((map) => (
          <div
            key={map.id}
            style={{
              display: "grid",
              gridTemplateColumns: showArchived
                ? "2fr 1.5fr 1.2fr 0.9fr 0.9fr 1.4fr"
                : "2fr 1.5fr 1.2fr 0.9fr 0.9fr 1fr",
              gap: 12,
              padding: 12,
              borderBottom: "1px solid #eee",
              alignItems: "center",
            }}
          >
            <div style={{ fontWeight: 600 }}>{map.name}</div>
            <div>{map.park_name || "—"}</div>
            <div>{map.location || "—"}</div>
            <div>{map.status}</div>
            <div>{map.site_count}</div>

            {showArchived ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => void handleRestoreMap(map)}
                  disabled={restoringMapId === map.id || !canManageMaps}
                >
                  {restoringMapId === map.id ? "Restoring..." : "Restore"}
                </button>

                <button
                  type="button"
                  onClick={() => void handleDeleteArchivedMap(map)}
                  disabled={deletingMapId === map.id || !canManageMaps}
                  style={{
                    background: "#fff1f2",
                    color: "#991b1b",
                    border: "1px solid #dc2626",
                    borderRadius: 8,
                    padding: "8px 10px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {deletingMapId === map.id ? "Deleting..." : "Delete"}
                </button>
              </div>
            ) : (
              <div>
                <button
                  type="button"
                  onClick={() => void handleEditMap(map)}
                  disabled={openingMapId === map.id || !canManageMaps}
                >
                  {openingMapId === map.id ? "Opening..." : "Edit Map"}
                </button>
              </div>
            )}
          </div>
        ))}

        {visibleMaps.length === 0 && (
          <div style={{ padding: 14, color: "#666" }}>
            {showArchived ? "No archived maps found." : "No active maps found."}
          </div>
        )}
      </div>

      <p style={{ marginTop: 20 }}>
        <strong>Status:</strong> {loading ? "Loading..." : status}
      </p>
    </div>
  );
}

export default function MasterMapsPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_master_maps">
      <MasterMapsPageInner />
    </AdminRouteGuard>
  );
}
