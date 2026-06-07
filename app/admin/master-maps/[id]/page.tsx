"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { MapCanvas, type MapCanvasHandle } from "@/components/map/canvas";
import type {
  MapMarker,
  MapPercentPoint,
  MarkerPositionUpdate,
  Selection,
} from "@/components/map/canvas/types";
import { useAdmin } from "@/lib/adminContext";
import { getAdminEvent } from "@/lib/getAdminEvent";
import { canAccessEvent, hasPermission } from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

type MasterMapRow = {
  id: string;
  name: string;
  park_name: string | null;
  location: string | null;
  map_image_url: string | null;
  status: "draft" | "published" | "archived";
  is_read_only: boolean;
  site_count: number;
  map_group?: string | null;
};

type MasterMapSiteRow = {
  id: string;
  master_map_id: string;
  site_number: string;
  display_label: string | null;
  map_x: number | null;
  map_y: number | null;
};

type AdminEventContext = {
  id?: string | null;
  name?: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function stripDraftSuffix(value: string | null | undefined) {
  return String(value || "")
    .replace(/\s+Draft$/i, "")
    .trim();
}

function normalizeMapGroup(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─── Inner component ──────────────────────────────────────────────────────────

function MasterMapEditorPageInner() {
  const params = useParams();
  const router = useRouter();
  const masterMapId = params?.id as string;
  const { admin } = useAdmin();

  // ── Refs ────────────────────────────────────────────────────────────────────
  const mapRef = useRef<MapCanvasHandle | null>(null);
  const siteNumberRef = useRef<HTMLInputElement | null>(null);
  // Kept as refs so keyboard handler never has stale closure issues
  const primarySelectedSiteIdRef = useRef<string | null>(null);
  const readOnlyMarkersRef = useRef(false);
  const selectedSiteIdsRef = useRef<string[]>([]);

  // ── Page state ──────────────────────────────────────────────────────────────
  const [isMobile, setIsMobile] = useState(false);
  const [masterMap, setMasterMap] = useState<MasterMapRow | null>(null);
  const [sites, setSites] = useState<MasterMapSiteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading master map...");
  const [isSavingMarker, setIsSavingMarker] = useState(false);

  // ── Map details form ────────────────────────────────────────────────────────
  const [mapName, setMapName] = useState("");
  const [parkName, setParkName] = useState("");
  const [mapLocation, setMapLocation] = useState("");

  // ── Selection — page owns the string arrays; MapCanvas owns the visual box ──
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [primarySelectedSiteId, setPrimarySelectedSiteId] = useState<
    string | null
  >(null);

  // ── Marker placement ────────────────────────────────────────────────────────
  // pendingMarker is the yellow ghost before the user types a site number.
  // MapCanvas renders it via the pendingMarker prop.
  const [pendingMarker, setPendingMarker] = useState<MapPercentPoint | null>(
    null,
  );
  const [siteNumber, setSiteNumber] = useState("");

  // ── Live coordinate preview while editing the selected marker ───────────────
  // editX/editY mirror the primary marker's current position in the property
  // panel. They update optimistically from onMarkersChange so the panel stays
  // in sync after nudge/align/undo without waiting for a DB round-trip.
  const [editX, setEditX] = useState<number | null>(null);
  const [editY, setEditY] = useState<number | null>(null);

  // ── Display options ─────────────────────────────────────────────────────────
  const [saveAndNextMode, setSaveAndNextMode] = useState(true);
  const [showLabels, setShowLabels] = useState(true);

  // ─── Derived ─────────────────────────────────────────────────────────────────

  const readOnlyMarkers =
    masterMap?.status === "published" || masterMap?.is_read_only === true;

  // Keep refs in sync so keyboard handler is never stale
  useEffect(() => {
    readOnlyMarkersRef.current = readOnlyMarkers;
  }, [readOnlyMarkers]);

  useEffect(() => {
    primarySelectedSiteIdRef.current = primarySelectedSiteId;
  }, [primarySelectedSiteId]);

  useEffect(() => {
    selectedSiteIdsRef.current = selectedSiteIds;
  }, [selectedSiteIds]);

  const primarySelectedSite = useMemo(
    () => sites.find((s) => s.id === primarySelectedSiteId) ?? null,
    [sites, primarySelectedSiteId],
  );

  const selectedSites = useMemo(() => {
    const idSet = new Set(selectedSiteIds);
    return sites.filter((s) => idSet.has(s.id));
  }, [sites, selectedSiteIds]);

  // For the property panel coordinate display: show editX/editY while the
  // primary marker has unsaved positional edits, otherwise show persisted coords.
  const displayX =
    editX !== null ? editX : (primarySelectedSite?.map_x ?? null);
  const displayY =
    editY !== null ? editY : (primarySelectedSite?.map_y ?? null);

  // markers array for MapCanvas — includes live editX/editY for the primary
  // marker so the dot moves on the map during nudging before persistence.
  const markers = useMemo<MapMarker[]>(() => {
    return sites
      .filter((s) => s.map_x !== null && s.map_y !== null)
      .map((s) => {
        const isPrimary = s.id === primarySelectedSiteId;
        return {
          id: s.id,
          xPct: isPrimary && editX !== null ? editX : (s.map_x as number),
          yPct: isPrimary && editY !== null ? editY : (s.map_y as number),
          label: s.display_label || s.site_number,
          data: s,
        };
      });
  }, [sites, primarySelectedSiteId, editX, editY]);

  // ── Workspace layout — removes max-width cap while this page is mounted ───

  useEffect(() => {
    document.body.classList.add("admin-map-workspace");
    return () => {
      document.body.classList.remove("admin-map-workspace");
    };
  }, []);

  // ── Resize ────────────────────────────────────────────────────────────────

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth < 900);
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // ─── Data loading ─────────────────────────────────────────────────────────

  const loadMasterMap = useCallback(async () => {
    const { data, error } = await supabase
      .from("master_maps")
      .select(
        "id,name,park_name,location,map_image_url,status,is_read_only,site_count,map_group",
      )
      .eq("id", masterMapId)
      .single();

    if (error) {
      throw new Error(`Could not load master map: ${error.message}`);
    }

    const row = data as MasterMapRow;
    setMasterMap(row);
    setMapName(row.name || "");
    setParkName(row.park_name || "");
    setMapLocation(row.location || "");
  }, [masterMapId]);

  const loadSites = useCallback(async () => {
    const { data, error } = await supabase
      .from("master_map_sites")
      .select("id,master_map_id,site_number,display_label,map_x,map_y")
      .eq("master_map_id", masterMapId)
      .order("site_number");

    if (error) {
      throw new Error(`Could not load master map sites: ${error.message}`);
    }

    setSites((data || []) as MasterMapSiteRow[]);
  }, [masterMapId]);

  const loadPage = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      if (!admin) {
        setMasterMap(null);
        setSites([]);
        setError("No admin access.");
        setStatus("Access denied.");
        return;
      }

      if (!hasPermission(admin, "can_manage_master_maps")) {
        setMasterMap(null);
        setSites([]);
        setError("You do not have permission to manage master maps.");
        setStatus("Access denied.");
        return;
      }

      const adminEvent = getAdminEvent() as AdminEventContext | null;
      if (adminEvent?.id && !canAccessEvent(admin, adminEvent.id)) {
        setMasterMap(null);
        setSites([]);
        setError("You do not have access to the current admin event.");
        setStatus("Access denied.");
        return;
      }

      setStatus("Loading master map...");
      await loadMasterMap();
      await loadSites();
      setStatus("Ready");
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to load master map.";
      console.error("loadPage error:", err);
      setMasterMap(null);
      setSites([]);
      setError(msg);
      setStatus("Load failed.");
    } finally {
      setLoading(false);
    }
  }, [admin, loadMasterMap, loadSites]);

  useEffect(() => {
    if (!masterMapId) {
      return;
    }
    void loadPage();
  }, [masterMapId, loadPage]);

  // ─── Utility ──────────────────────────────────────────────────────────────

  function focusSiteNumber() {
    requestAnimationFrame(() => {
      siteNumberRef.current?.focus();
      siteNumberRef.current?.select();
    });
  }

  function findDuplicateSite(trimmedSiteNumber: string) {
    const normalized = trimmedSiteNumber.toLowerCase();
    return sites.find((site) => {
      if (!site.site_number) {
        return false;
      }
      if (primarySelectedSiteId && site.id === primarySelectedSiteId) {
        return false;
      }
      return site.site_number.trim().toLowerCase() === normalized;
    });
  }

  function clearFormFields() {
    setSiteNumber("");
    setPrimarySelectedSiteId(null);
    setSelectedSiteIds([]);
    setEditX(null);
    setEditY(null);
  }

  // ─── MapCanvas callbacks ──────────────────────────────────────────────────

  // onMapTap: clean tap on empty map space → place pending marker.
  // Does NOT fire when a marker is tapped (onMarkerTap handles that).
  async function handleMapTap(pt: MapPercentPoint) {
    if (readOnlyMarkersRef.current) {
      return;
    }

    // Old workflow:
    // click map -> type site -> click map again
    // automatically save previous marker and start next one.
    if (pendingMarker && siteNumber.trim()) {
      await saveNewMarkerInternal(true);
    }

    setPendingMarker({ xPct: pt.xPct, yPct: pt.yPct });
    setSelectedSiteIds([]);
    setPrimarySelectedSiteId(null);
    setEditX(null);
    setEditY(null);
    setSiteNumber("");
    setStatus("Position selected. Type site number and press Enter to save.");
    focusSiteNumber();
  }

  // onMarkerTap: fired by MapCanvas after every marker activation — single tap,
  // shift-click toggle, and pointer-up on a marker after a rectangle drag.
  //
  // IMPORTANT: do NOT set selectedSiteIds or primarySelectedSiteId here.
  // onSelectionChange owns all selection state. If handleMarkerTap also sets
  // selectedSiteIds([id]), it collapses any multi-selection that onSelectionChange
  // just delivered (rectangle drag, shift-click) back to a single marker.
  //
  // handleMarkerTap handles side effects only:
  //   - cancel pending marker placement
  //   - populate the property panel (editX/editY/siteNumber) for the tapped marker
  //   - set status
  //   - NO centering (Lesson 3: marker is already visible if user can tap it)
  //
  // onSelectionChange handles all selectedIds/primaryId updates, including the
  // single-tap case where MapCanvas emits selectSingle before calling onMarkerTap.
  function handleMarkerTap(id: string) {
    console.log("MARKER TAP", id);
    console.log("SELECTED BEFORE TAP", selectedSiteIdsRef.current);
    const site = sites.find((s) => s.id === id);
    if (!site) {
      return;
    }

    // Cancel any in-progress placement
    setPendingMarker(null);

    // Populate property panel for the tapped marker.
    // Selection state (selectedSiteIds, primarySelectedSiteId) is set by
    // onSelectionChange — do not override it here.
    setEditX(site.map_x);
    setEditY(site.map_y);
    setSiteNumber(site.site_number);
    setStatus(`Selected site ${site.display_label || site.site_number}.`);
    // NO centerOnMarker call here — this is the no-auto-center contract.
  }

  // onSelectionChange: MapCanvas reports rectangle-drag or shift-click results.
  function handleSelectionChange(sel: Selection) {
    setSelectedSiteIds(sel.selectedIds);
    setPrimarySelectedSiteId(sel.primaryId);

    if (sel.primaryId) {
      const site = sites.find((s) => s.id === sel.primaryId);
      if (site) {
        setEditX(site.map_x);
        setEditY(site.map_y);
        setSiteNumber(site.site_number);
      }
    } else {
      setEditX(null);
      setEditY(null);
    }

    if (sel.selectedIds.length > 0) {
      setStatus(
        `Selected ${sel.selectedIds.length} marker${sel.selectedIds.length === 1 ? "" : "s"}.`,
      );
    }

    // Cancel any pending placement when a drag-select completes
    setPendingMarker(null);
  }

  // onMarkersChange: fires after nudge / align / distribute / undo from the engine.
  // This is the single persistence path for all geometry mutations that originate
  // inside MapCanvas. Page mutations (saveNewMarkerInternal, saveSelectedPosition)
  // write directly to Supabase and then call loadSites.
  const handleMarkersChange = useCallback(
    async (updates: MarkerPositionUpdate[]) => {
      if (updates.length === 0) {
        return;
      }

      // 1. Optimistic local state update
      setSites((prev) =>
        prev.map((site) => {
          const u = updates.find((u) => u.id === site.id);
          return u ? { ...site, map_x: u.xPct, map_y: u.yPct } : site;
        }),
      );

      // 2. Sync editX/editY for the property panel
      const primaryUpdate = updates.find(
        (u) => u.id === primarySelectedSiteIdRef.current,
      );
      if (primaryUpdate) {
        setEditX(primaryUpdate.xPct);
        setEditY(primaryUpdate.yPct);
      }

      // 3. Persist — serial writes preserve audit semantics
      for (const u of updates) {
        const { error } = await supabase
          .from("master_map_sites")
          .update({ map_x: u.xPct, map_y: u.yPct })
          .eq("id", u.id);

        if (error) {
          setStatus(`Could not save position: ${error.message}`);
          // Reload to recover consistent state
          await loadSites();
          return;
        }
      }

      if (updates.length === 1) {
        const u = updates[0];
        setStatus(
          `Position saved at X ${u.xPct.toFixed(2)}, Y ${u.yPct.toFixed(2)}.`,
        );
      } else {
        setStatus(`Saved ${updates.length} marker positions.`);
      }
    },
    [loadSites],
  );

  // ─── Marker creation ───────────────────────────────────────────────────────

  async function saveNewMarkerInternal(nextMode: boolean) {
    if (readOnlyMarkers) {
      setStatus(
        "Published master maps are read-only. Create a draft copy to edit markers.",
      );
      return;
    }
    if (isSavingMarker) {
      return;
    }

    if (!pendingMarker) {
      setStatus("Click on the map first.");
      return;
    }

    const trimmedSiteNumber = siteNumber.trim();
    if (!trimmedSiteNumber) {
      setStatus("Enter a site number.");
      focusSiteNumber();
      return;
    }

    const duplicate = findDuplicateSite(trimmedSiteNumber);
    if (duplicate) {
      setStatus(
        `Site ${trimmedSiteNumber} already exists. Rename the new marker before saving.`,
      );
      focusSiteNumber();
      return;
    }

    try {
      setIsSavingMarker(true);
      setStatus("Saving marker...");

      const { data: insertedSite, error } = await supabase
        .from("master_map_sites")
        .insert({
          master_map_id: masterMapId,
          site_number: trimmedSiteNumber,
          display_label: trimmedSiteNumber,
          map_x: pendingMarker.xPct,
          map_y: pendingMarker.yPct,
        })
        .select("id,master_map_id,site_number,display_label,map_x,map_y")
        .single();

      if (error) {
        throw error;
      }

      const savedSite = insertedSite as MasterMapSiteRow;

      setSites((prev) => {
        if (prev.some((s) => s.id === savedSite.id)) {
          return prev;
        }
        return [...prev, savedSite].sort((a, b) =>
          a.site_number.localeCompare(b.site_number, undefined, {
            numeric: true,
            sensitivity: "base",
          }),
        );
      });

      if (nextMode) {
        setPendingMarker(null);
        clearFormFields();
        setStatus("Marker saved. Click the map to place the next marker.");
      } else {
        setPendingMarker(null);
        setSiteNumber("");
        setPrimarySelectedSiteId(savedSite.id);
        setSelectedSiteIds([savedSite.id]);
        setEditX(savedSite.map_x);
        setEditY(savedSite.map_y);
        setStatus(`Marker ${trimmedSiteNumber} saved.`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not save marker.";
      setStatus(`Could not save marker: ${msg}`);
    } finally {
      setIsSavingMarker(false);
    }
  }

  async function saveNewMarker() {
    await saveNewMarkerInternal(false);
  }
  async function saveAndNextMarker() {
    await saveNewMarkerInternal(true);
  }

  // ─── Marker editing ───────────────────────────────────────────────────────

  async function updateSelectedMarker() {
    if (readOnlyMarkers) {
      setStatus(
        "Published master maps are read-only. Create a draft copy to edit markers.",
      );
      return;
    }
    if (!primarySelectedSiteId) {
      setStatus("Select a marker first.");
      return;
    }

    const trimmedSiteNumber = siteNumber.trim();
    if (!trimmedSiteNumber) {
      setStatus("Enter a site number.");
      focusSiteNumber();
      return;
    }

    const duplicate = findDuplicateSite(trimmedSiteNumber);
    if (duplicate) {
      setStatus(
        `Site ${trimmedSiteNumber} already exists. Rename this marker before saving.`,
      );
      focusSiteNumber();
      return;
    }

    const { error } = await supabase
      .from("master_map_sites")
      .update({
        site_number: trimmedSiteNumber,
        display_label: trimmedSiteNumber,
      })
      .eq("id", primarySelectedSiteId);

    if (error) {
      setStatus(`Could not update marker: ${error.message}`);
      return;
    }

    await loadSites();
    setStatus("Marker updated.");
    focusSiteNumber();
  }

  // Explicit "Save Position" — persists editX/editY for the selected marker.
  // Distinct from onMarkersChange which handles engine-driven nudge/align/undo.
  async function saveSelectedPosition() {
    if (readOnlyMarkers) {
      setStatus(
        "Published master maps are read-only. Create a draft copy to edit markers.",
      );
      return;
    }
    if (!primarySelectedSiteId) {
      setStatus("Select a marker first.");
      return;
    }
    if (editX === null || editY === null) {
      setStatus("No changed position to save.");
      return;
    }

    const { error } = await supabase
      .from("master_map_sites")
      .update({ map_x: editX, map_y: editY })
      .eq("id", primarySelectedSiteId);

    if (error) {
      setStatus(`Could not save position: ${error.message}`);
      return;
    }

    await loadSites();
    setStatus("Position saved.");
    focusSiteNumber();
  }

  const deleteSelectedMarker = useCallback(async () => {
    if (readOnlyMarkersRef.current) {
      setStatus(
        "Published master maps are read-only. Create a draft copy to edit markers.",
      );
      return;
    }

    const ids = selectedSiteIdsRef.current;

    if (ids.length === 0) {
      setStatus("Select one or more markers first.");
      return;
    }

    const confirmed = window.confirm(
      `Delete ${ids.length} selected marker${ids.length === 1 ? "" : "s"}?`,
    );
    if (!confirmed) {
      return;
    }
    console.log("DELETE IDS", ids);

    const { error } = await supabase
      .from("master_map_sites")
      .delete()
      .in("id", ids);
    console.log("DELETE RESULT", error);

    if (error) {
      setStatus(`Could not delete marker: ${error.message}`);
      return;
    }

    clearFormFields();
    mapRef.current?.clearSelection();
    await loadSites();
    setStatus(`${ids.length} marker${ids.length === 1 ? "" : "s"} deleted.`);
    focusSiteNumber();
  }, [loadSites]);

  // Enter key on the site number input dispatches to the right save action
  async function saveFromKeyboard() {
    if (primarySelectedSiteId) {
      await updateSelectedMarker();
    } else if (saveAndNextMode) {
      await saveAndNextMarker();
    } else {
      await saveNewMarker();
    }
  }

  // ─── Map details / map management ─────────────────────────────────────────

  async function saveMapDetails() {
    if (!masterMap) {
      setStatus("No master map loaded.");
      return;
    }
    const trimmedName = mapName.trim();
    if (!trimmedName) {
      setStatus("Map name is required.");
      return;
    }

    const { error } = await supabase
      .from("master_maps")
      .update({
        name: trimmedName,
        park_name: parkName.trim() || null,
        location: mapLocation.trim() || null,
        map_group:
          normalizeMapGroup(masterMap.map_group) ||
          normalizeMapGroup(parkName) ||
          normalizeMapGroup(stripDraftSuffix(trimmedName)) ||
          null,
      })
      .eq("id", masterMap.id);

    if (error) {
      setStatus(`Could not save map details: ${error.message}`);
      return;
    }

    await loadMasterMap();
    setStatus("Map details saved.");
  }

  async function saveUpdatedMap() {
    if (!masterMap) {
      setStatus("No master map loaded.");
      return;
    }
    const trimmedName = mapName.trim();
    if (!trimmedName) {
      setStatus("Map name is required.");
      return;
    }
    if (masterMap.status !== "draft") {
      setStatus("Only draft maps can be saved as the updated current map.");
      return;
    }

    setStatus("Saving updated map...");

    try {
      const baseName = stripDraftSuffix(trimmedName);
      const nextMapGroup =
        normalizeMapGroup(masterMap.map_group) ||
        normalizeMapGroup(parkName) ||
        normalizeMapGroup(baseName);

      const { data: currentPublishedMaps, error: currentPublishedError } =
        await supabase
          .from("master_maps")
          .select("id,name,status,map_group,park_name")
          .eq("status", "published");

      if (currentPublishedError) {
        setStatus(
          `Could not find current published map: ${currentPublishedError.message}`,
        );
        return;
      }

      const matchingPublished = (
        (currentPublishedMaps || []) as MasterMapRow[]
      ).find((row) => {
        if (row.id === masterMap.id) {
          return false;
        }
        const rowGroup =
          normalizeMapGroup(row.map_group) ||
          normalizeMapGroup(row.park_name) ||
          normalizeMapGroup(stripDraftSuffix(row.name));
        if (nextMapGroup && rowGroup === nextMapGroup) {
          return true;
        }
        return stripDraftSuffix(row.name) === baseName;
      });

      if (matchingPublished?.id) {
        const { error: archiveError } = await supabase
          .from("master_maps")
          .update({
            status: "archived",
            is_read_only: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", matchingPublished.id);

        if (archiveError) {
          setStatus(
            `Could not archive existing published map: ${archiveError.message}`,
          );
          return;
        }
      }

      const { error: promoteError } = await supabase
        .from("master_maps")
        .update({
          name: baseName,
          park_name: parkName.trim() || null,
          location: mapLocation.trim() || null,
          map_group: nextMapGroup || null,
          status: "published",
          is_read_only: true,
          site_count: sites.length,
          updated_at: new Date().toISOString(),
        })
        .eq("id", masterMap.id);

      if (promoteError) {
        setStatus(`Could not publish updated map: ${promoteError.message}`);
        return;
      }

      if (matchingPublished?.id) {
        const { error: reassignError } = await supabase
          .from("event_map_settings")
          .update({ selected_master_map_id: masterMap.id })
          .eq("selected_master_map_id", matchingPublished.id);

        if (reassignError) {
          setStatus(
            `Map published, but event reassignment failed: ${reassignError.message}`,
          );
          return;
        }
      }

      await loadMasterMap();
      setStatus("Updated map saved. Previous published version archived.");
      router.replace(`/admin/master-maps/${masterMap.id}`);
      router.refresh();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Could not save updated map.";
      console.error("saveUpdatedMap error:", err);
      setStatus(msg);
    }
  }

  async function publishToSelectedEvent() {
    if (!masterMap) {
      setStatus("No master map loaded.");
      return;
    }
    const currentEvent = getAdminEvent() as AdminEventContext | null;
    if (!currentEvent?.id) {
      setStatus("No admin working event selected.");
      return;
    }

    const confirmed = window.confirm(
      `This will replace all parking sites for the selected event "${currentEvent.name}" with the sites from this master map. Continue?`,
    );
    if (!confirmed) {
      return;
    }

    const { error: deleteError } = await supabase
      .from("parking_sites")
      .delete()
      .eq("event_id", currentEvent.id);

    if (deleteError) {
      setStatus(
        `Could not clear existing parking sites: ${deleteError.message}`,
      );
      return;
    }

    const rowsToInsert = sites.map((site) => ({
      event_id: currentEvent.id,
      site_number: site.site_number,
      notes: null,
      map_x: site.map_x,
      map_y: site.map_y,
      assigned_attendee_id: null,
      display_label: site.display_label || site.site_number,
      map_image_url: masterMap.map_image_url,
    }));

    if (rowsToInsert.length === 0) {
      setStatus("No master map sites found to publish.");
      return;
    }

    const { error: insertError } = await supabase
      .from("parking_sites")
      .insert(rowsToInsert);

    if (insertError) {
      setStatus(`Could not publish to selected event: ${insertError.message}`);
      return;
    }

    setStatus(
      `Published ${rowsToInsert.length} parking sites to selected event "${currentEvent.name}".`,
    );
  }

  async function safeSyncToSelectedEvent() {
    if (!masterMap) {
      setStatus("No master map loaded.");
      return;
    }
    const currentEvent = getAdminEvent() as AdminEventContext | null;
    if (!currentEvent?.id) {
      setStatus("No admin working event selected.");
      return;
    }

    const confirmed = window.confirm(
      `Safe Sync will update matching parking sites for "${currentEvent.name}" by site number, preserve assignments and notes, and add any new sites from this master map. Continue?`,
    );
    if (!confirmed) {
      return;
    }

    const { data: existingSites, error: existingError } = await supabase
      .from("parking_sites")
      .select("id, site_number")
      .eq("event_id", currentEvent.id);

    if (existingError) {
      setStatus(
        `Could not load existing event parking sites: ${existingError.message}`,
      );
      return;
    }

    const existingBySiteNumber = new Map<
      string,
      { id: string; site_number: string | null }
    >();
    (existingSites || []).forEach((site) => {
      const key = (site.site_number || "").trim().toLowerCase();
      if (key) {
        existingBySiteNumber.set(key, site);
      }
    });

    let updatedCount = 0;
    let insertedCount = 0;

    for (const site of sites) {
      const normalizedSiteNumber = (site.site_number || "")
        .trim()
        .toLowerCase();
      if (!normalizedSiteNumber) {
        continue;
      }

      const existing = existingBySiteNumber.get(normalizedSiteNumber);
      if (existing) {
        const { error: updateError } = await supabase
          .from("parking_sites")
          .update({
            display_label: site.display_label || site.site_number,
            map_x: site.map_x,
            map_y: site.map_y,
            map_image_url: masterMap.map_image_url,
          })
          .eq("id", existing.id);

        if (updateError) {
          setStatus(
            `Could not safe sync site ${site.site_number}: ${updateError.message}`,
          );
          return;
        }
        updatedCount += 1;
      } else {
        const { error: insertError } = await supabase
          .from("parking_sites")
          .insert({
            event_id: currentEvent.id,
            site_number: site.site_number,
            notes: null,
            map_x: site.map_x,
            map_y: site.map_y,
            assigned_attendee_id: null,
            display_label: site.display_label || site.site_number,
            map_image_url: masterMap.map_image_url,
          });

        if (insertError) {
          setStatus(
            `Could not insert new site ${site.site_number}: ${insertError.message}`,
          );
          return;
        }
        insertedCount += 1;
      }
    }

    setStatus(
      `Safe Sync complete for "${currentEvent.name}". Updated ${updatedCount} site(s), inserted ${insertedCount} new site(s), preserved assignments and notes on existing sites.`,
    );
  }

  async function createDraftCopy() {
    if (!masterMap) {
      return;
    }

    const mapGroup =
      normalizeMapGroup(masterMap.map_group) ||
      normalizeMapGroup(masterMap.park_name) ||
      normalizeMapGroup(stripDraftSuffix(masterMap.name));

    const { data: newMap, error: newMapError } = await supabase
      .from("master_maps")
      .insert({
        name: `${stripDraftSuffix(masterMap.name)} Draft`,
        park_name: masterMap.park_name,
        location: masterMap.location,
        map_group: mapGroup || null,
        map_image_path: null,
        map_image_url: masterMap.map_image_url,
        status: "draft",
        is_read_only: false,
        site_count: masterMap.site_count,
      })
      .select("id")
      .single();

    if (newMapError || !newMap) {
      setStatus(
        `Could not create draft copy: ${newMapError?.message || "Unknown error"}`,
      );
      return;
    }

    const newSites = sites.map((site) => ({
      master_map_id: newMap.id,
      site_number: site.site_number,
      display_label: site.display_label,
      map_x: site.map_x,
      map_y: site.map_y,
    }));

    if (newSites.length > 0) {
      const { error: copyError } = await supabase
        .from("master_map_sites")
        .insert(newSites);

      if (copyError) {
        setStatus(
          `Draft copy created, but site copy failed: ${copyError.message}`,
        );
        return;
      }
    }

    router.push(`/admin/master-maps/${newMap.id}`);
  }

  // ─── Keyboard handler ─────────────────────────────────────────────────────
  // Uses refs for readOnlyMarkers and primarySelectedSiteId to avoid stale
  // closures. All geometry operations delegate to mapRef (engine) which then
  // fires onMarkersChange → handleMarkersChange → persist.

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (readOnlyMarkersRef.current) {
        return;
      }

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
        return;
      }

      // Undo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          mapRef.current?.undoAll();
        } else {
          mapRef.current?.undo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        mapRef.current?.undoAll();
        return;
      }

      // Cancel pending marker
      if (e.key === "Escape") {
        if (pendingMarker) {
          e.preventDefault();
          setPendingMarker(null);
          setSiteNumber("");
          setStatus("Pending marker canceled.");
        }
        return;
      }

      // Delete selected marker(s)
      if (e.key === "Delete" || e.key === "Backspace") {
        console.log("DELETE KEY PRESSED");
        console.log("SELECTED IDS", selectedSiteIdsRef.current);

        if (selectedSiteIdsRef.current.length > 0) {
          e.preventDefault();
          void deleteSelectedMarker();
        }
        return;
      }

      // Arrow nudge
      const step = e.altKey ? 0.01 : e.shiftKey ? 0.25 : 0.05;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        mapRef.current?.nudgeSelected(-step, 0);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        mapRef.current?.nudgeSelected(step, 0);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        mapRef.current?.nudgeSelected(0, -step);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        mapRef.current?.nudgeSelected(0, step);
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [deleteSelectedMarker, pendingMarker]);

  // ─── renderMarker ─────────────────────────────────────────────────────────
  // MapCanvas calls this for every visible marker. Receives the marker and
  // clean {selected, primary} flags — no manual selectedSiteIds lookup needed.

  const renderMarker = useCallback(
    (marker: MapMarker, state: { selected: boolean; primary: boolean }) => {
      const site = marker.data as MasterMapSiteRow;
      const { selected, primary } = state;
      if (selected || primary) {
        console.log(
          "MARKER STATE",
          marker.id,
          "selected=",
          selected,
          "primary=",
          primary,
        );
      }

      return (
        <>
          {/* Dot — shown only when labels are OFF. Color cues: yellow=primary,
              blue=selected, green=normal. When labels are ON the label chip
              carries the color cue instead and the dot is hidden to avoid
              double-rendering at the same position. */}
          {!showLabels && (
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                border:
                  primary || selected
                    ? "2px solid white"
                    : "1px solid rgba(255,255,255,0.85)",

                background: primary || selected ? "#f4b400" : "#1f9d55",
                boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
                cursor: "pointer",
                display: "block",
                margin: "0 auto",
              }}
            />
          )}

          {/* Delete button — only on the primary marker in edit mode.
              Rendered regardless of showLabels so it's always reachable. */}
          {primary && !readOnlyMarkers && (
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void deleteSelectedMarker();
              }}
              title="Delete marker"
              style={{
                position: "absolute",
                top: -8,
                right: -8,
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: "#dc2626",
                color: "white",
                border: "1px solid white",
                fontSize: 10,
                lineHeight: "14px",
                textAlign: "center",
                cursor: "pointer",
                boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
                padding: 0,
              }}
            >
              ×
            </button>
          )}

          {/* Label chip — shown only when labels are ON. Background color carries
              the state cue: yellow=primary, blue=selected, white=normal. */}
          {showLabels && (
            <div
              style={{
                marginTop: 0,
                marginLeft: "auto",
                marginRight: "auto",
                border:
                  primary || selected
                    ? "2px solid white"
                    : "1px solid rgba(255,255,255,0.85)",

                background: primary || selected ? "#f4b400" : "#1f9d55",

                fontSize: 11,
                fontWeight: 700,
                padding: "1px 5px",
                color: "#111",
                whiteSpace: "nowrap",
                boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                display: "table",
                pointerEvents: "none",
              }}
            >
              {site.display_label || site.site_number}
            </div>
          )}
        </>
      );
    },
    [showLabels, readOnlyMarkers, deleteSelectedMarker],
  );

  // ─── Viewport helpers ─────────────────────────────────────────────────────

  function zoomIn() {
    mapRef.current?.zoomIn();
  }
  function zoomOut() {
    mapRef.current?.zoomOut();
  }
  function resetZoom() {
    mapRef.current?.reset();
  }

  // Explicit "locate" — the ONLY place we center on a marker.
  // Lesson 3: marker tap must never auto-center. Only explicit user action does.
  function locateSelectedMarker() {
    if (!primarySelectedSiteId) {
      return;
    }
    mapRef.current?.centerOnMarker(primarySelectedSiteId);
  }

  // ─── Undo depth for button label ──────────────────────────────────────────
  // MapCanvas tracks the undo stack internally. We read depth each render via
  // the imperative handle. This is safe because renders are driven by state
  // changes that already account for stack mutations.
  const undoDepth = mapRef.current?.undoDepth() ?? 0;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: 24 }}>
      <h1>Master Map Editor</h1>

      {error && (
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
      )}

      {/* Status bar */}
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "#f8f9fb",
          padding: 14,
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 700 }}>{masterMap?.name || "Loading..."}</div>
        <div style={{ color: "#555" }}>{masterMap?.park_name || "—"}</div>
        <div style={{ color: "#555" }}>{masterMap?.location || "—"}</div>
        <div style={{ fontSize: 13, marginTop: 4 }}>
          Status: {masterMap?.status || "—"}
        </div>
        <div style={{ fontSize: 13 }}>
          Read only markers: {readOnlyMarkers ? "Yes" : "No"}
        </div>
        <div style={{ fontSize: 13 }}>Site count: {sites.length}</div>
        <div style={{ fontSize: 13 }}>Selected: {selectedSiteIds.length}</div>
        <div style={{ fontSize: 13, marginTop: 4 }}>
          Editor status: {loading ? "Loading..." : status}
        </div>
      </div>

      {/* Two-column layout: sidebar + map */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "340px minmax(0, 1fr)",
          gap: 24,
          alignItems: "start",
          width: "100%",
          overflow: "hidden",
        }}
      >
        {/* ── LEFT SIDEBAR ────────────────────────────────────────────────── */}
        <div
          style={{
            position: isMobile ? "relative" : "sticky",
            top: isMobile ? 0 : 16,
            display: "grid",
            gap: 12,
          }}
        >
          {/* Map details */}
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              background: "white",
              padding: 12,
              display: "grid",
              gap: 10,
            }}
          >
            <div style={{ fontWeight: 700 }}>Map Details</div>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 13 }}>Map Name</span>
              <input
                value={mapName}
                onChange={(e) => setMapName(e.target.value)}
                style={{ padding: 8 }}
                disabled={loading}
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 13 }}>Park Name</span>
              <input
                value={parkName}
                onChange={(e) => setParkName(e.target.value)}
                style={{ padding: 8 }}
                disabled={loading}
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 13 }}>Location</span>
              <input
                value={mapLocation}
                onChange={(e) => setMapLocation(e.target.value)}
                style={{ padding: 8 }}
                disabled={loading}
              />
            </label>
            <button
              type="button"
              onClick={() => void saveMapDetails()}
              disabled={loading}
            >
              Save Map Details
            </button>
          </div>

          {/* Marker tools */}
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              background: "white",
              padding: 12,
              display: "grid",
              gap: 12,
            }}
          >
            <div style={{ fontWeight: 700 }}>Marker Tools</div>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 14,
              }}
            >
              <input
                type="checkbox"
                checked={saveAndNextMode}
                onChange={(e) => setSaveAndNextMode(e.target.checked)}
                disabled={readOnlyMarkers || loading}
                style={{ width: 16, height: 16, flex: "0 0 auto" }}
              />
              <span>Save + Next Marker mode</span>
            </label>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 14,
              }}
            >
              <input
                type="checkbox"
                checked={showLabels}
                onChange={(e) => setShowLabels(e.target.checked)}
                disabled={loading}
                style={{ width: 16, height: 16, flex: "0 0 auto" }}
              />
              <span>Show labels on map</span>
            </label>

            {/* Site number input — create new or rename selected */}
            <input
              ref={siteNumberRef}
              value={siteNumber}
              onChange={(e) => setSiteNumber(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void saveFromKeyboard();
                }
              }}
              placeholder="Site number"
              disabled={readOnlyMarkers || loading || isSavingMarker}
              style={{ padding: 8 }}
            />

            <div style={{ fontSize: 12, color: "#666" }}>
              Tap the map to place a marker. Type the site number and press
              Enter to save. Rectangle-drag to multi-select.
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                disabled={
                  readOnlyMarkers || loading || isSavingMarker || !pendingMarker
                }
                onClick={() => void saveNewMarker()}
                style={{ flex: 1 }}
              >
                Save New
              </button>
              <button
                disabled={
                  readOnlyMarkers || loading || isSavingMarker || !pendingMarker
                }
                onClick={() => void saveAndNextMarker()}
                style={{ flex: 1 }}
              >
                Save + Next
              </button>
              <button
                disabled={
                  readOnlyMarkers ||
                  loading ||
                  isSavingMarker ||
                  !primarySelectedSiteId
                }
                onClick={() => void updateSelectedMarker()}
                style={{ flex: 1 }}
              >
                Update
              </button>
            </div>

            {/* Property panel — shown when a marker is selected */}
            {primarySelectedSite && (
              <div
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: 10,
                  background: "#f8faff",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 8 }}>
                  Selected Marker
                </div>
                <div style={{ fontSize: 13, marginBottom: 4 }}>
                  Site: {primarySelectedSite.site_number}
                </div>
                {primarySelectedSite.display_label &&
                  primarySelectedSite.display_label !==
                    primarySelectedSite.site_number && (
                    <div style={{ fontSize: 13, marginBottom: 4 }}>
                      Label: {primarySelectedSite.display_label}
                    </div>
                  )}
                <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
                  X: {displayX !== null ? displayX.toFixed(2) : "—"} | Y:{" "}
                  {displayY !== null ? displayY.toFixed(2) : "—"}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={locateSelectedMarker}
                    title="Center the map on this marker"
                  >
                    Locate
                  </button>
                  <button
                    type="button"
                    disabled={readOnlyMarkers || loading}
                    onClick={() => void saveSelectedPosition()}
                  >
                    Save Position
                  </button>
                  <button
                    type="button"
                    disabled={readOnlyMarkers || loading}
                    onClick={() => void deleteSelectedMarker()}
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
                    Delete
                  </button>
                </div>
              </div>
            )}

            {/* Row / alignment tools */}
            <div
              style={{
                border: "1px solid #eee",
                borderRadius: 8,
                padding: 10,
                background: "#fafafa",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Row Tools</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  disabled={
                    readOnlyMarkers || loading || selectedSiteIds.length < 2
                  }
                  onClick={() => mapRef.current?.alignSelected("horizontal")}
                  style={{ flex: 1 }}
                >
                  Align Horizontal
                </button>
                <button
                  disabled={
                    readOnlyMarkers || loading || selectedSiteIds.length < 3
                  }
                  onClick={() =>
                    mapRef.current?.distributeSelected("horizontal")
                  }
                  style={{ flex: 1 }}
                >
                  Distribute H
                </button>
                <button
                  disabled={
                    readOnlyMarkers || loading || selectedSiteIds.length < 2
                  }
                  onClick={() => mapRef.current?.alignSelected("vertical")}
                  style={{ flex: 1 }}
                >
                  Align Vertical
                </button>
                <button
                  disabled={
                    readOnlyMarkers || loading || selectedSiteIds.length < 3
                  }
                  onClick={() => mapRef.current?.distributeSelected("vertical")}
                  style={{ flex: 1 }}
                >
                  Distribute V
                </button>
              </div>
              <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                <button
                  disabled={readOnlyMarkers || loading || undoDepth === 0}
                  onClick={() => mapRef.current?.undo()}
                  style={{ width: "100%" }}
                >
                  Undo Last Move ({undoDepth})
                </button>
                <button
                  disabled={readOnlyMarkers || loading || undoDepth === 0}
                  onClick={() => mapRef.current?.undoAll()}
                  style={{ width: "100%" }}
                >
                  Undo All Moves
                </button>
                <button
                  disabled={loading || selectedSiteIds.length === 0}
                  onClick={() => {
                    setSelectedSiteIds([]);
                    setPrimarySelectedSiteId(null);
                    setEditX(null);
                    setEditY(null);
                    mapRef.current?.clearSelection();
                    setStatus("Selection cleared.");
                  }}
                  style={{ width: "100%" }}
                >
                  Clear Selection
                </button>
              </div>
            </div>

            {/* Position nudge pad */}
            <div
              style={{
                border: "1px solid #eee",
                borderRadius: 8,
                padding: 10,
                background: "#fafafa",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Position</div>
              <div style={{ fontSize: 12, marginBottom: 8 }}>
                X: {displayX !== null ? displayX.toFixed(2) : "—"} | Y:{" "}
                {displayY !== null ? displayY.toFixed(2) : "—"}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 6,
                }}
              >
                <div />
                <button
                  disabled={
                    readOnlyMarkers || loading || !primarySelectedSiteId
                  }
                  onClick={() => mapRef.current?.nudgeSelected(0, -0.05)}
                >
                  ↑
                </button>
                <div />
                <button
                  disabled={
                    readOnlyMarkers || loading || !primarySelectedSiteId
                  }
                  onClick={() => mapRef.current?.nudgeSelected(-0.05, 0)}
                >
                  ←
                </button>
                <button
                  disabled={
                    readOnlyMarkers || loading || !primarySelectedSiteId
                  }
                  onClick={() => void saveSelectedPosition()}
                >
                  Save Pos
                </button>
                <button
                  disabled={
                    readOnlyMarkers || loading || !primarySelectedSiteId
                  }
                  onClick={() => mapRef.current?.nudgeSelected(0.05, 0)}
                >
                  →
                </button>
                <div />
                <button
                  disabled={
                    readOnlyMarkers || loading || !primarySelectedSiteId
                  }
                  onClick={() => mapRef.current?.nudgeSelected(0, 0.05)}
                >
                  ↓
                </button>
                <div />
              </div>
            </div>

            {/* Map publish / sync actions */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!readOnlyMarkers && (
                <>
                  <button
                    onClick={() => void saveUpdatedMap()}
                    style={{ flex: 1 }}
                    disabled={loading}
                  >
                    Save Updated Map
                  </button>
                  <button
                    onClick={() => void publishToSelectedEvent()}
                    style={{ flex: 1 }}
                    disabled={loading}
                  >
                    Replace Selected Event Sites From Map
                  </button>
                </>
              )}
              <button
                onClick={() => void safeSyncToSelectedEvent()}
                style={{ flex: 1 }}
                disabled={loading}
              >
                {readOnlyMarkers
                  ? "Sync Published Map to Selected Event"
                  : "Update Selected Event From Map"}
              </button>
              {readOnlyMarkers && (
                <button
                  onClick={() => void createDraftCopy()}
                  style={{ flex: 1 }}
                  disabled={loading}
                >
                  Create Editable Draft
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── MAP CANVAS ──────────────────────────────────────────────────── */}
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 8,
            overflow: "hidden",
          }}
        >
          <MapCanvas
            ref={mapRef}
            imageUrl={masterMap?.map_image_url ?? null}
            markers={markers}
            viewportHeight={isMobile ? "60vh" : "78vh"}
            initialScale={0.6}
            minScale={0.1}
            maxScale={3}
            editable={!readOnlyMarkers}
            selectionMode="rectangle"
            showLabels={showLabels}
            pendingMarker={pendingMarker}
            selectedIds={selectedSiteIds}
            primaryId={primarySelectedSiteId}
            onMapTap={handleMapTap}
            onMarkerTap={handleMarkerTap}
            onSelectionChange={handleSelectionChange}
            onMarkersChange={handleMarkersChange}
            renderMarker={renderMarker}
          />

          {/* Zoom controls */}
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginTop: 10,
            }}
          >
            <button type="button" onClick={zoomOut}>
              −
            </button>
            <button type="button" onClick={zoomIn}>
              +
            </button>
            <button type="button" onClick={resetZoom}>
              Reset Zoom
            </button>
            {primarySelectedSiteId && (
              <button type="button" onClick={locateSelectedMarker}>
                Locate Selected
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page wrapper ─────────────────────────────────────────────────────────────

export default function MasterMapEditorPage() {
  return (
    <AdminRouteGuard>
      <MasterMapEditorPageInner />
    </AdminRouteGuard>
  );
}
