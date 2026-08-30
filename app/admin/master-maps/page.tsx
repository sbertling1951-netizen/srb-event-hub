"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { useShellInterfaceCapabilities } from "@/components/shell/useShellViewport";
import { Alert, type AlertTone } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { DataTable, ResponsiveList } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageSection } from "@/components/ui/PageSection";
import { RowActions } from "@/components/ui/RowActions";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/StatusBadge";
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
// (announcementStatusTone) and Admin Users (adminUserStatusTone). A
// partial-failure message (e.g. "Draft created, but could not load source
// markers") is checked before any success-shaped prefix so it classifies
// as danger, not success.
export function masterMapStatusTone(message: string): AlertTone {
  const lower = message.toLowerCase();

  if (
    lower.startsWith("could not") ||
    lower.includes(", but ") ||
    lower.includes("failed") ||
    lower.includes("invalid") ||
    lower.includes("missing") ||
    lower.includes("access denied") ||
    lower.includes("no admin access") ||
    lower.includes("choose a replacement image first")
  ) {
    return "danger";
  }

  if (lower.endsWith("...")) {
    return "info";
  }

  if (
    lower.startsWith("archived map") ||
    lower.startsWith("restored") ||
    lower.startsWith("replaced") ||
    lower.startsWith("deleted archived map") ||
    lower.startsWith("map opening scale settings saved")
  ) {
    return "success";
  }

  return "neutral";
}

const MAP_STATUS_TONE: Record<MasterMapRow["status"], StatusBadgeTone> = {
  published: "success",
  draft: "warning",
  archived: "neutral",
};

function masterMapStatusLabel(status: MasterMapRow["status"]) {
  return status === "published" ? "Published" : status === "draft" ? "Draft" : "Archived";
}

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
  revision: number;
};

type AdminEventSettings = {
  id: string;
  name: string;
  coach_map_open_scale: number | null;
  parking_map_open_scale: number | null;
  locations_map_open_scale: number | null;
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
  const [replacingImageMapId, setReplacingImageMapId] = useState<string | null>(
    null,
  );
  const [replaceImageFiles, setReplaceImageFiles] = useState<
    Record<string, File | null>
  >({});
  const [archivingMapId, setArchivingMapId] = useState<string | null>(null);
  const [imageSizes, setImageSizes] = useState<
    Record<string, { width: number; height: number }>
  >({});

  const [loading, setLoading] = useState(true);
  const [savingScales, setSavingScales] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingArchiveMap, setPendingArchiveMap] = useState<MasterMapRow | null>(null);
  const { isCompact: isMobile } = useShellInterfaceCapabilities();

  const { admin } = useAdmin();
  const canManageMaps = !!admin;

  useEffect(() => {
    document.body.classList.add("admin-map-workspace");

    return () => {
      document.body.classList.remove("admin-map-workspace");
    };
  }, []);

  const currentMaps = useMemo(() => {
    return maps.filter((map) => map.status !== "archived");
  }, [maps]);

  const archivedMaps = useMemo(() => {
    return maps.filter((map) => map.status === "archived");
  }, [maps]);

  const visibleMaps = showArchived ? archivedMaps : currentMaps;

  const loadMasterMaps = useCallback(
    async (viewArchived = showArchived) => {
      const { data, error } = await supabase
        .from("master_maps")
        .select(
          "id,name,park_name,location,map_image_url,status,is_read_only,site_count,map_group,revision",
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
    },
    [showArchived],
  );

  const loadSelectedEventSettings = useCallback(async () => {
    const currentEvent = getCurrentAdminEvent();

    if (!currentEvent?.id) {
      setSelectedEventId("");
      setSelectedEventName("");
      setCoachMapOpenScale("0.6");
      setParkingMapOpenScale("0.6");
      setLocationsMapOpenScale("0.6");
      return;
    }

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
  }, [admin]);

  async function saveMapScales() {
    if (!selectedEventId) {
      setStatus(
        "No selected admin event found. Cannot save map scale settings.",
      );
      return;
    }

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

      // Stage 6B: one governed operation creates the editable draft AND
      // copies the marker set atomically -- platform authority, no direct
      // browser INSERT.
      const { data: newMap, error: newMapError } = await supabase.rpc(
        "create_master_map_draft_from",
        { p_source_map_id: map.id },
      );

      const newMapRow = newMap as { id: string } | null;

      if (newMapError || !newMapRow?.id) {
        const message =
          newMapError?.message === "master_map_draft_exists"
            ? "An editable draft already exists for this map. Refresh and open it."
            : newMapError?.message || "Unknown error";
        setStatus(`Could not create editable draft: ${message}`);
        return;
      }

      window.location.href = `/admin/master-maps/${newMapRow.id}`;
    } catch (err) {
      console.error("handleEditMap error:", err);
      setStatus(
        err instanceof Error ? err.message : "Could not open editable map.",
      );
    } finally {
      setOpeningMapId(null);
    }
  }

  async function handleArchiveMap(map: MasterMapRow) {
    setPendingArchiveMap(null);

    try {
      if (!admin) {
        setError("No admin access.");
        setStatus("Access denied.");
        return;
      }

      setArchivingMapId(map.id);
      setStatus(`Archiving ${map.name}...`);

      // Stage 6B: archive is a governed platform-asset lifecycle op. It does
      // NOT touch Event assignments (that is publish_master_map's job).
      const { error: archiveError } = await supabase.rpc("archive_master_map", {
        p_map_id: map.id,
        p_expected_revision: map.revision,
      });

      if (archiveError) {
        setStatus(
          archiveError.message === "stale_master_map"
            ? "This map changed since the list loaded. Refresh and try again."
            : `Could not archive map: ${archiveError.message}`,
        );
        return;
      }

      await loadMasterMaps(showArchived);
      setStatus(`Archived map: ${map.name}`);
    } catch (err: any) {
      console.error("handleArchiveMap error:", err);
      setStatus(err?.message || "Failed to archive map.");
    } finally {
      setArchivingMapId(null);
    }
  }

  async function handleRestoreMap(map: MasterMapRow) {
    try {
      if (!admin) {
        setError("No admin access.");
        setStatus("Access denied.");
        return;
      }

      setRestoringMapId(map.id);
      setStatus(`Restoring ${map.name}...`);

      // Stage 6B: restore is asset-lifecycle only -- it brings the retired
      // map back as an editable DRAFT. It deliberately does NOT republish it
      // or migrate Event assignments; to make a restored map live again,
      // open it and use "Save updated map" (publish/promote), which handles
      // the superseded version and every referencing Event in one governed,
      // atomic operation.
      const { error: restoreError } = await supabase.rpc("restore_master_map", {
        p_map_id: map.id,
        p_expected_revision: map.revision,
      });

      if (restoreError) {
        const message =
          restoreError.message === "stale_master_map"
            ? "This map changed since the list loaded. Refresh and try again."
            : restoreError.message === "master_map_draft_exists"
              ? "An editable draft already exists for this map's group. Open that draft instead."
              : restoreError.message === "master_map_not_archived"
                ? "Only an archived map can be restored."
                : restoreError.message;
        setStatus(`Could not restore map: ${message}`);
        return;
      }

      await loadMasterMaps(showArchived);
      setStatus(`Restored ${map.name} as an editable draft. Open it and use "Save updated map" to make it live.`);
    } catch (err: any) {
      console.error("handleRestoreMap error:", err);
      setStatus(err?.message || "Failed to restore map.");
    } finally {
      setRestoringMapId(null);
    }
  }

  async function handleReplaceMapImage(map: MasterMapRow) {
    const file = replaceImageFiles[map.id] || null;

    if (!file) {
      setStatus("Choose a replacement image first.");
      return;
    }

    // Stage 6B: a published / read-only canonical asset is not re-imaged in
    // place. The path is Edit -> draft -> replace image -> Save updated map.
    if (map.status !== "draft") {
      setStatus(
        `${map.name} is published and read-only. Use "Edit Map" to open a draft, replace the image there, then "Save updated map".`,
      );
      return;
    }

    try {
      if (!admin) {
        setError("No admin access.");
        setStatus("Access denied.");
        return;
      }

      setReplacingImageMapId(map.id);
      setStatus(`Uploading replacement image for ${map.name}...`);

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
      const filePath = `master-maps/${map.id}-${Date.now()}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("master-maps")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        setStatus(`Could not upload replacement image: ${uploadError.message}`);
        return;
      }

      const { data: publicData } = supabase.storage
        .from("master-maps")
        .getPublicUrl(filePath);

      const publicUrl = publicData?.publicUrl || null;

      if (!publicUrl) {
        setStatus("Upload succeeded, but no public URL was returned.");
        return;
      }

      // Stage 6B: image metadata is set through the governed RPC (draft
      // only), with revision compare-and-swap.
      const { error: updateError } = await supabase.rpc("set_master_map_image", {
        p_map_id: map.id,
        p_expected_revision: map.revision,
        p_map_image_path: filePath,
        p_map_image_url: publicUrl,
      });

      if (updateError) {
        setStatus(
          updateError.message === "stale_master_map"
            ? "This map changed since the list loaded. Refresh and try again."
            : updateError.message === "master_map_not_draft"
              ? `${map.name} is published and read-only. Open a draft to replace its image.`
              : `Could not update master map image: ${updateError.message}`,
        );
        return;
      }

      setReplaceImageFiles((prev) => ({
        ...prev,
        [map.id]: null,
      }));

      await loadMasterMaps(showArchived);
      setStatus(`Replaced map image for ${map.name}.`);
    } catch (err: any) {
      console.error("handleReplaceMapImage error:", err);
      setStatus(err?.message || "Failed to replace map image.");
    } finally {
      setReplacingImageMapId(null);
    }
  }

  // Stage 6B: the "Delete archived map" browser path is retired. Platform
  // map lifecycle is archive / retire / restore only -- never hard delete.
  // (A future physical purge, if ever needed, is a separate explicit
  // governance feature with reference/integrity checks.)

  useEffect(() => {
    if (!admin) {
      return;
    }

    setLoading(true);
    setError(null);

    async function load() {
      await Promise.all([loadMasterMaps(), loadSelectedEventSettings()]);
      setLoading(false);
    }
    void load();

    const unsubscribe = subscribeToAdminWorkspace(() => {
      void loadSelectedEventSettings();
    });

    return unsubscribe;
  }, [admin, loadMasterMaps, loadSelectedEventSettings]);

  useEffect(() => {
    if (loading) {
      return;
    }
    void loadMasterMaps();
  }, [loadMasterMaps, loading]);

  // Shared between the desktop DataTable's actions cell and the
  // narrow-viewport ResponsiveList card -- one render path, two layouts
  // (Central UI Standard, matching the pattern already established on
  // Announcements). Correctly branches on `showArchived` in both
  // presentations; the prior hand-duplicated mobile card markup always
  // rendered Edit Map/Archive regardless of `showArchived`, a real,
  // narrow pre-existing bug this shared render path incidentally fixes
  // by construction (see closeout finding).
  function renderRowActions(map: MasterMapRow) {
    return (
      <div style={{ display: "grid", gap: "var(--space-2)", minWidth: 0 }}>
        {showArchived ? (
          <RowActions>
            <AppButton
              onClick={() => void handleRestoreMap(map)}
              disabled={restoringMapId === map.id || !canManageMaps}
              aria-label={`Restore "${map.name}" as a draft`}
            >
              {restoringMapId === map.id ? "Restoring..." : "Restore as draft"}
            </AppButton>
          </RowActions>
        ) : (
          <RowActions>
            <AppButton
              onClick={() => void handleEditMap(map)}
              disabled={openingMapId === map.id || !canManageMaps}
              aria-label={`Edit "${map.name}"`}
            >
              {openingMapId === map.id ? "Opening..." : "Edit Map"}
            </AppButton>
            <AppButton
              onClick={() => setPendingArchiveMap(map)}
              disabled={archivingMapId === map.id || !canManageMaps}
              aria-label={`Archive "${map.name}"`}
            >
              {archivingMapId === map.id ? "Archiving..." : "Archive"}
            </AppButton>
          </RowActions>
        )}

        <Field
          label="Replace Image"
          help={
            replaceImageFiles[map.id]
              ? `Selected: ${replaceImageFiles[map.id]?.name}`
              : "Choose a new image file to enable Replace Image."
          }
        >
          {(controlProps) => (
            <Input
              {...controlProps}
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                setReplaceImageFiles((prev) => ({
                  ...prev,
                  [map.id]: file,
                }));
              }}
              disabled={replacingImageMapId === map.id || !canManageMaps}
            />
          )}
        </Field>

        <AppButton
          onClick={() => void handleReplaceMapImage(map)}
          disabled={
            replacingImageMapId === map.id ||
            !canManageMaps ||
            !replaceImageFiles[map.id]
          }
        >
          {replacingImageMapId === map.id ? "Replacing Image..." : "Replace Image"}
        </AppButton>
      </div>
    );
  }

  return (
    <div style={{ padding: "var(--space-6)", display: "grid", gap: "var(--space-5)" }}>
      <ConfirmDialog
        open={!!pendingArchiveMap}
        title="Archive Map"
        message={`Archive "${pendingArchiveMap?.name ?? ""}"? It will be moved out of the active list and can be restored later.`}
        confirmLabel="Archive"
        busy={archivingMapId === pendingArchiveMap?.id}
        onCancel={() => setPendingArchiveMap(null)}
        onConfirm={() => void handleArchiveMap(pendingArchiveMap!)}
      />

      <p className="app-subtle-text" style={{ margin: 0 }}>
        Create and maintain protected campground map templates.
      </p>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <PageSection variant="card" title="Map Opening Scale Settings">
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          <p className="app-subtle-text" style={{ margin: 0 }}>
            Selected admin event: <strong>{selectedEventName || "None"}</strong>
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "var(--space-4)",
            }}
          >
            <Field label="Coach Map">
              {(controlProps) => (
                <Input
                  {...controlProps}
                  type="number"
                  step="0.05"
                  min="0.25"
                  max="3"
                  value={coachMapOpenScale}
                  onChange={(e) => setCoachMapOpenScale(e.target.value)}
                  disabled={!canManageMaps}
                />
              )}
            </Field>

            <Field label="Parking Admin Map">
              {(controlProps) => (
                <Input
                  {...controlProps}
                  type="number"
                  step="0.05"
                  min="0.25"
                  max="3"
                  value={parkingMapOpenScale}
                  onChange={(e) => setParkingMapOpenScale(e.target.value)}
                  disabled={!canManageMaps}
                />
              )}
            </Field>

            <Field label="Locations Map">
              {(controlProps) => (
                <Input
                  {...controlProps}
                  type="number"
                  step="0.05"
                  min="0.25"
                  max="3"
                  value={locationsMapOpenScale}
                  onChange={(e) => setLocationsMapOpenScale(e.target.value)}
                  disabled={!canManageMaps}
                />
              )}
            </Field>
          </div>

          <FormActions>
            <AppButton
              variant="primary"
              onClick={() => void saveMapScales()}
              disabled={!canManageMaps || loading || savingScales}
            >
              {savingScales ? "Saving..." : "Save Map Scale Settings"}
            </AppButton>
          </FormActions>

          <p className="app-subtle-text" style={{ margin: 0, fontSize: "var(--font-size-caption)" }}>
            Suggested starting values are usually between <strong>0.45</strong>{" "}
            and <strong>0.75</strong>. Reset Zoom on each map can be tied to these
            saved values.
          </p>
        </div>
      </PageSection>

      <div className="app-flex-wrap-12">
        {!showArchived &&
          (canManageMaps ? (
            // A same-app route: kept as Next's <Link> (client-side
            // transition) with the canonical .app-button class applied
            // directly, matching the established Admin Users precedent --
            // AppLinkButton renders a bare <a>, which would silently drop
            // client-side navigation here.
            <Link href="/admin/master-maps/new" className="app-button">
              Create New Master Map
            </Link>
          ) : (
            <AppButton disabled>Create New Master Map</AppButton>
          ))}

        <AppButton onClick={() => setShowArchived((prev) => !prev)}>
          {showArchived
            ? "← Back to Active Maps"
            : `View Archived Maps (${archivedMaps.length})`}
        </AppButton>
      </div>

      <PageSection variant="card" title={showArchived ? "Archived Maps" : "Active Maps"}>
        {loading ? (
          <LoadingState message="Loading master maps..." />
        ) : visibleMaps.length === 0 ? (
          <EmptyState message={showArchived ? "No archived maps found." : "No active maps found."} />
        ) : isMobile ? (
          <ResponsiveList aria-label={showArchived ? "Archived master maps" : "Active master maps"}>
            {visibleMaps.map((map) => (
              <li key={map.id} className="responsive-list-item">
                <div className="responsive-list-item-header">
                  <div className="responsive-list-item-title">{map.name}</div>
                  <StatusBadge tone={MAP_STATUS_TONE[map.status]}>
                    {masterMapStatusLabel(map.status)}
                  </StatusBadge>
                </div>

                <div className="responsive-list-item-meta">
                  <span>Park: {map.park_name || "—"}</span>
                  <span>Location: {map.location || "—"}</span>
                  <span>Sites: {map.site_count}</span>
                </div>

                {renderRowActions(map)}
              </li>
            ))}
          </ResponsiveList>
        ) : (
          <DataTable caption={showArchived ? "Archived master maps" : "Active master maps"}>
            <thead>
              <tr>
                <th scope="col">Preview</th>
                <th scope="col">Name</th>
                <th scope="col">Park</th>
                <th scope="col">Location</th>
                <th scope="col">Status</th>
                <th scope="col">Sites</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleMaps.map((map) => (
                <tr key={map.id}>
                  <td>
                    {map.map_image_url ? (
                      <div style={{ display: "grid", gap: "var(--space-1)" }}>
                        <img
                          src={map.map_image_url}
                          alt={map.name}
                          width={220}
                          height={145}
                          onLoad={(e) => {
                            const img = e.currentTarget;
                            setImageSizes((prev) => ({
                              ...prev,
                              [map.id]: {
                                width: img.naturalWidth,
                                height: img.naturalHeight,
                              },
                            }));
                          }}
                          style={{
                            width: 220,
                            height: 145,
                            objectFit: "cover",
                            borderRadius: "var(--radius-medium)",
                            border: "var(--border-width-default) solid var(--color-border-default)",
                            display: "block",
                          }}
                        />
                        <div className="data-table-cell-meta" style={{ textAlign: "center" }}>
                          {imageSizes[map.id]
                            ? `${imageSizes[map.id].width} × ${imageSizes[map.id].height}`
                            : "Loading..."}
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: "var(--space-1)" }}>
                        <div
                          style={{
                            width: 220,
                            height: 145,
                            borderRadius: "var(--radius-medium)",
                            border: "var(--border-width-default) solid var(--color-border-default)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                          className="data-table-cell-meta"
                        >
                          No Image
                        </div>
                        <div className="data-table-cell-meta" style={{ textAlign: "center" }}>
                          No dimensions
                        </div>
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="data-table-cell-primary">{map.name}</div>
                  </td>
                  <td className="data-table-cell-meta">{map.park_name || "—"}</td>
                  <td className="data-table-cell-meta">{map.location || "—"}</td>
                  <td>
                    <StatusBadge tone={MAP_STATUS_TONE[map.status]}>
                      {masterMapStatusLabel(map.status)}
                    </StatusBadge>
                  </td>
                  <td>{map.site_count}</td>
                  <td>{renderRowActions(map)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}

        {status ? <Alert tone={masterMapStatusTone(status)}>{status}</Alert> : null}
      </PageSection>
    </div>
  );
}

export default function MasterMapsPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_master_maps">
      <AdminShellAdapter
        pageTitle="Master Maps"
        backTarget={{ href: "/admin/map-admin", label: "Map Admin" }}
        contentMode="full-bleed"
      >
        <MasterMapsPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}
