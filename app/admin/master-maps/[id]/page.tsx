"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import {
  MapCanvas,
  type MapCanvasHandle,
  type MapGeometry,
} from "@/components/map/canvas";
import type {
  MapMarker,
  MapPercentPoint,
  MarkerPositionUpdate,
  Selection,
} from "@/components/map/canvas/types";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { useAdmin } from "@/lib/adminContext";
import { getCurrentAdminEvent } from "@/lib/adminWorkspaceContext";
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
  revision: number;
};

type MasterMapSiteRow = {
  id: string;
  master_map_id: string;
  site_number: string;
  display_label: string | null;
  map_x: number | null;
  map_y: number | null;
};

// Stage 6C: one row returned by sync_master_map_parking_inventory_to_event.
type SyncResultRow = {
  outcome: "previewed" | "applied" | "rejected";
  rejection_code: string | null;
  added: number;
  reconciled: number;
  relinked: number;
  orphaned_vacant: number;
  manual_rows: number;
  conflicts: Array<{
    kind: string;
    site_number: string | null;
    detail: string;
  }>;
};


// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

// Stage 6B: map the governed-RPC sentinel errors to admin-readable text.
function describeMapMutationError(message: string, fallback: string): string {
  switch (message) {
    case "stale_master_map":
      return "This map changed since you loaded it. Refresh and try again.";
    case "master_map_not_draft":
      return "This map is published and read-only. Create a draft copy to edit it.";
    case "master_map_not_archived":
      return "Only an archived map can be restored.";
    case "master_map_draft_exists":
      return "An editable draft already exists for this map's group.";
    case "Platform map management requires System Administrator authority.":
      return "Master map changes require System Administrator authority.";
    default:
      return `${fallback}: ${message}`;
  }
}

// ─── Inner component ──────────────────────────────────────────────────────────

function MasterMapEditorPageInner() {
  const params = useParams();
  const router = useRouter();
  const masterMapId = params?.id as string;
  const { admin } = useAdmin();

  // ── Refs ────────────────────────────────────────────────────────────────────
// ── Marker sizing ────────────────────────────────────────────────────────────
// Markers live in the map image's NATURAL-pixel space (MapCanvas sizes its
// content surface to the image's natural dimensions and the viewport transform
// scales that whole surface). A size expressed in CSS px there is therefore a
// size in native image px, and what reaches the screen is `native x scale`.
// Fixed native sizes are why a high-resolution map rendered 5px markers: at
// fit, scale = min(viewportW / naturalW, viewportH / naturalH), so a constant
// native size shrinks in direct proportion to image resolution.
//
// The fix expresses the base size as the native size that RESOLVES to a target
// CSS size at the fit view: base = targetCss / fitScale. That is resolution-
// aware and viewport-aware (fit uses both dimensions, so a tall portrait map is
// driven by its height, not its width), while remaining a plain native size --
// so markers still grow and shrink proportionally as the operator zooms. There
// is no counter-scaling anywhere.
const MARKER_DOT_CSS_AT_FIT = 18;
const MARKER_HIT_CSS_AT_FIT = 32;
const MARKER_LABEL_RATIO = 0.62;
const MARKER_SIZE_MIN_PCT = 60;
const MARKER_SIZE_MAX_PCT = 250;
const MARKER_SIZE_DEFAULT_PCT = 100;
const MARKER_SIZE_STEP_PCT = 10;
/** A crowded marker still has to be visible; below this it is a smudge. */
const MARKER_DOT_FLOOR_PX = 6;
/** Share of a marker's own territory (half the gap to its nearest neighbour)
 *  each part may occupy. Keeping every part within territory is what makes
 *  overlap -- and therefore stolen clicks -- geometrically impossible. */
const MARKER_DOT_TERRITORY_FRACTION = 0.9;
const MARKER_DELETE_TERRITORY_FRACTION = 0.8;
const MARKER_DELETE_MIN_PX = 12;
/** A label below this rendered size is not worth drawing; the dot carries the
 *  marker instead. Expressed in CSS px so it tracks the current fit. */
const MARKER_LABEL_MIN_CSS = 9;
/** Live zoom is bucketed before it reaches state, so a gesture cannot drive a
 *  render per animation frame or chatter across the legibility threshold. */
const MARKER_SCALE_QUANTUM = 0.05;
/** Share of the sideways clearance a label box may occupy. */
const MARKER_LABEL_WIDTH_FRACTION = 0.9;
/** A label box is at least its horizontal padding (font * 0.42 each side) plus
 *  border plus one glyph; below roughly this multiple of the font size the
 *  browser ignores maxWidth and the box spills. */
const MARKER_LABEL_MIN_BOX_RATIO = 1.5;

  const mapRef = useRef<MapCanvasHandle | null>(null);
  const siteNumberRef = useRef<HTMLInputElement | null>(null);
  // Kept as refs so keyboard handler never has stale closure issues
  const primarySelectedSiteIdRef = useRef<string | null>(null);
  const readOnlyMarkersRef = useRef(false);
  const selectedSiteIdsRef = useRef<string[]>([]);
  const pendingMarkerRef = useRef<MapPercentPoint | null>(null);
  const isSavingMarkerRef = useRef(false);

  // ── Page state ──────────────────────────────────────────────────────────────
  const [isMobile, setIsMobile] = useState(false);
  // Editor-local display state only: never persisted, never sent to the
  // database, and deliberately not part of the markers array, so changing it
  // cannot mark placement data dirty or trigger a save.
  const [markerSizePct, setMarkerSizePct] = useState(MARKER_SIZE_DEFAULT_PCT);
  // The engine's own geometry, reported by MapCanvas. Never estimated here:
  // fitScale is the scale the engine actually uses, so no safety factor and no
  // second fit calculation are needed. Null until the first report arrives.
  const [mapGeometry, setMapGeometry] = useState<MapGeometry | null>(null);
  // Live applied zoom, used ONLY to decide whether a label is legible on
  // screen. Marker sizes stay derived from the fit scale, so nothing is
  // counter-scaled: zooming still grows and shrinks markers proportionally.
  // Quantised to MARKER_SCALE_QUANTUM buckets so a pinch cannot re-render per
  // animation frame or oscillate around the legibility threshold.
  const [liveScale, setLiveScale] = useState<number | null>(null);
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

  // Stage 6B: the current map row (incl. its revision) is kept in a ref so
  // the geometry-engine callback and keyboard handlers always compare-and-
  // swap against the latest revision, never a stale closure value.
  const masterMapRef = useRef<MasterMapRow | null>(null);
  useEffect(() => {
    masterMapRef.current = masterMap;
  }, [masterMap]);

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

  useEffect(() => {
    pendingMarkerRef.current = pendingMarker;
  }, [pendingMarker]);

  useEffect(() => {
    isSavingMarkerRef.current = isSavingMarker;
  }, [isSavingMarker]);

  // One nudge route for the pad and the arrow keys. A pending (unsaved)
  // marker moves LOCALLY only -- clamped, never persisted until Save New /
  // Save + Next, and never added to the saved-marker undo stack. Otherwise
  // the engine nudges the saved selection, which persists through
  // onMarkersChange exactly as before.
  const nudgeTarget = useCallback((dxPct: number, dyPct: number) => {
    if (pendingMarkerRef.current) {
      if (isSavingMarkerRef.current) {
        return;
      }
      // Same 0-100 clamp and 2-decimal rounding as the engine's saved nudge.
      const clampPct = (v: number) => Math.round(clampPercent(v) * 100) / 100;
      setPendingMarker((p) =>
        p
          ? { xPct: clampPct(p.xPct + dxPct), yPct: clampPct(p.yPct + dyPct) }
          : p,
      );
      return;
    }
    mapRef.current?.nudgeSelected(dxPct, dyPct);
  }, []);

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
  // A pending marker, when present, is the nudge target, so its local
  // coordinates are what the Position pad shows.
  const displayX = pendingMarker
    ? pendingMarker.xPct
    : editX !== null
      ? editX
      : (primarySelectedSite?.map_x ?? null);
  const displayY = pendingMarker
    ? pendingMarker.yPct
    : editY !== null
      ? editY
      : (primarySelectedSite?.map_y ?? null);

  const nudgePadDisabled =
    readOnlyMarkers ||
    loading ||
    (pendingMarker ? isSavingMarker : !primarySelectedSiteId);

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

  // Geometry arrives from MapCanvas (engine-measured viewport, natural image
  // size and the engine's own fit scale). Held in a stable callback so the map
  // never re-renders because of an inline identity.
  const handleScaleChange = useCallback((scale: number) => {
    const bucket =
      Math.round(scale / MARKER_SCALE_QUANTUM) * MARKER_SCALE_QUANTUM;
    setLiveScale((prev) => (prev !== null && prev === bucket ? prev : bucket));
  }, []);

  const handleGeometryChange = useCallback((geometry: MapGeometry) => {
    setMapGeometry((prev) =>
      prev &&
      prev.naturalWidth === geometry.naturalWidth &&
      prev.naturalHeight === geometry.naturalHeight &&
      prev.viewportWidth === geometry.viewportWidth &&
      prev.viewportHeight === geometry.viewportHeight &&
      prev.fitScale === geometry.fitScale
        ? prev
        : geometry,
    );
  }, []);

  // ─── Data loading ─────────────────────────────────────────────────────────

  const loadMasterMap = useCallback(async () => {
    const { data, error } = await supabase
      .from("master_maps")
      .select(
        "id,name,park_name,location,map_image_url,status,is_read_only,site_count,map_group,revision",
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

  const loadSites = useCallback(async (): Promise<MasterMapSiteRow[]> => {
    const { data, error } = await supabase
      .from("master_map_sites")
      .select("id,master_map_id,site_number,display_label,map_x,map_y")
      .eq("master_map_id", masterMapId)
      .order("site_number");

    if (error) {
      throw new Error(`Could not load master map sites: ${error.message}`);
    }

    const rows = (data || []) as MasterMapSiteRow[];
    setSites(rows);
    return rows;
  }, [masterMapId]);

  // Stage 6B: the single atomic governed marker-set mutation. adds +
  // updates + deletes are applied in one server transaction; a failure
  // cannot leave a half-written marker set. On success the map row (with
  // its new revision) and the site list are refreshed. Returns false and
  // sets a status message on failure.
  const applyMarkerChanges = useCallback(
    async (delta: {
      adds?: Array<Record<string, unknown>>;
      updates?: Array<Record<string, unknown>>;
      deleteIds?: string[];
    }): Promise<{ ok: boolean; sites: MasterMapSiteRow[] }> => {
      const current = masterMapRef.current;
      if (!current) {
        setStatus("No master map loaded.");
        return { ok: false, sites: [] };
      }
      const { data, error } = await supabase.rpc(
        "apply_master_map_marker_changes",
        {
          p_map_id: masterMapId,
          p_expected_revision: current.revision,
          p_adds: delta.adds ?? [],
          p_updates: delta.updates ?? [],
          p_delete_ids: delta.deleteIds ?? [],
        },
      );
      if (error) {
        if (error.message === "stale_master_map") {
          setStatus("This map changed elsewhere. Reloading the latest version...");
        } else if (error.message === "master_map_not_draft") {
          setStatus("Published master maps are read-only. Create a draft copy to edit markers.");
        } else {
          setStatus(`Could not save markers: ${error.message}`);
        }
        await loadMasterMap();
        const recovered = await loadSites();
        return { ok: false, sites: recovered };
      }
      const updatedRow = data as MasterMapRow | null;
      if (updatedRow?.id) {
        setMasterMap(updatedRow);
      }
      const nextSites = await loadSites();
      return { ok: true, sites: nextSites };
    },
    [masterMapId, loadSites, loadMasterMap],
  );

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

      const adminEvent = getCurrentAdminEvent();
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
    // Selection was refused by handleSelectionChange while a marker is
    // pending; leave the pending coordinates and entered number untouched.
    if (pendingMarker) {
      return;
    }
    const site = sites.find((s) => s.id === id);
    if (!site) {
      return;
    }

    // Selecting on the map moves keyboard work to the map: a site-number
    // input left focused from earlier typing would otherwise swallow the
    // arrow-key nudges for the marker just selected.
    if (document.activeElement === siteNumberRef.current) {
      siteNumberRef.current?.blur();
    }

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
    // A pending marker blocks selecting saved markers: it is never silently
    // saved or discarded by a selection attempt. Save or Cancel resolves it.
    if (pendingMarker) {
      if (sel.selectedIds.length > 0) {
        setStatus(
          "Save or Cancel the pending marker before selecting a saved marker.",
        );
      }
      return;
    }

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

      // 3. Persist — one atomic governed marker-set update.
      const { ok } = await applyMarkerChanges({
        updates: updates.map((u) => ({ id: u.id, map_x: u.xPct, map_y: u.yPct })),
      });
      if (!ok) {
        return;
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
    [applyMarkerChanges],
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

      const { ok, sites: nextSites } = await applyMarkerChanges({
        adds: [
          {
            site_number: trimmedSiteNumber,
            display_label: trimmedSiteNumber,
            map_x: pendingMarker.xPct,
            map_y: pendingMarker.yPct,
          },
        ],
      });
      if (!ok) {
        return;
      }

      const savedSite = nextSites.find(
        (s) => s.site_number === trimmedSiteNumber,
      );

      if (nextMode) {
        setPendingMarker(null);
        clearFormFields();
        setStatus("Marker saved. Click the map to place the next marker.");
      } else {
        setPendingMarker(null);
        setSiteNumber("");
        if (savedSite) {
          setPrimarySelectedSiteId(savedSite.id);
          setSelectedSiteIds([savedSite.id]);
          setEditX(savedSite.map_x);
          setEditY(savedSite.map_y);
        }
        setStatus(`Marker ${trimmedSiteNumber} saved.`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not save marker.";
      setStatus(`Could not save marker: ${msg}`);
    } finally {
      setIsSavingMarker(false);
    }
  }

  // The one explicit way to abandon a pending marker (Cancel button and
  // Escape). It never touches saved markers.
  const cancelPendingMarker = useCallback(() => {
    setPendingMarker(null);
    setSiteNumber("");
    setStatus("Pending marker canceled.");
  }, []);

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

    const { ok } = await applyMarkerChanges({
      updates: [
        {
          id: primarySelectedSiteId,
          site_number: trimmedSiteNumber,
          display_label: trimmedSiteNumber,
        },
      ],
    });
    if (!ok) {
      return;
    }

    // No focus return on success: the input would swallow the next
    // arrow-key nudge (validation failures above still focus it to fix).
    setStatus("Marker updated.");
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

    const { ok } = await applyMarkerChanges({
      updates: [{ id: primarySelectedSiteId, map_x: editX, map_y: editY }],
    });
    if (!ok) {
      return;
    }

    // No focus return: a positional action keeps arrow-key nudging live.
    setStatus("Position saved.");
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

    const { ok } = await applyMarkerChanges({ deleteIds: ids });
    if (!ok) {
      return;
    }

    clearFormFields();
    mapRef.current?.clearSelection();
    setStatus(`${ids.length} marker${ids.length === 1 ? "" : "s"} deleted.`);
    focusSiteNumber();
  }, [applyMarkerChanges]);

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

    // Stage 6B: draft metadata is saved through the governed RPC with a
    // revision compare-and-swap. Only a draft is editable.
    const { data, error } = await supabase.rpc("update_master_map_details", {
      p_map_id: masterMap.id,
      p_expected_revision: masterMap.revision,
      p_name: trimmedName,
      p_park_name: parkName.trim() || null,
      p_location: mapLocation.trim() || null,
    });

    if (error) {
      setStatus(describeMapMutationError(error.message, "Could not save map details"));
      await loadMasterMap();
      return;
    }

    const updated = data as MasterMapRow | null;
    if (updated?.id) {
      setMasterMap(updated);
    } else {
      await loadMasterMap();
    }
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
      // 1. Persist the draft's current form fields through the governed RPC
      //    so name/park/location and the derived map_group are current
      //    before promotion.
      const { data: detailsData, error: detailsError } = await supabase.rpc(
        "update_master_map_details",
        {
          p_map_id: masterMap.id,
          p_expected_revision: masterMap.revision,
          p_name: trimmedName,
          p_park_name: parkName.trim() || null,
          p_location: mapLocation.trim() || null,
        },
      );
      if (detailsError) {
        setStatus(
          describeMapMutationError(detailsError.message, "Could not save the draft before publishing"),
        );
        await loadMasterMap();
        return;
      }
      const savedDraft = (detailsData as MasterMapRow | null) ?? masterMap;

      // 2. Resolve the map this group currently publishes (the supersede
      //    expectation the RPC verifies), then publish/promote + migrate
      //    Events in ONE atomic governed operation.
      const { data: currentPublished, error: currentPublishedError } =
        await supabase
          .from("master_maps")
          .select("id")
          .eq("status", "published")
          .eq("map_group", savedDraft.map_group ?? "")
          .maybeSingle();

      if (currentPublishedError) {
        setStatus(`Could not find current published map: ${currentPublishedError.message}`);
        return;
      }

      const supersededId =
        (currentPublished as { id: string } | null)?.id &&
        (currentPublished as { id: string }).id !== masterMap.id
          ? (currentPublished as { id: string }).id
          : null;

      const { data: publishData, error: publishError } = await supabase.rpc(
        "publish_master_map",
        {
          p_draft_map_id: masterMap.id,
          p_expected_draft_revision: savedDraft.revision,
          p_expected_superseded_map_id: supersededId,
          p_expected_superseded_revision: null,
        },
      );

      if (publishError) {
        setStatus(
          publishError.message === "stale_master_map_publish_target"
            ? "The currently published map for this group changed. Refresh and try again."
            : describeMapMutationError(publishError.message, "Could not publish updated map"),
        );
        await loadMasterMap();
        return;
      }

      const result = Array.isArray(publishData) ? publishData[0] : publishData;
      const reassigned = (result as { events_reassigned?: number } | null)?.events_reassigned ?? 0;

      await loadMasterMap();
      setStatus(
        supersededId
          ? `Updated map saved. Previous published version archived${
              reassigned > 0
                ? `; ${reassigned} event${reassigned === 1 ? "" : "s"} reassigned`
                : ""
            }.`
          : "Updated map published.",
      );
      router.replace(`/admin/master-maps/${masterMap.id}`);
      router.refresh();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Could not save updated map.";
      console.error("saveUpdatedMap error:", err);
      setStatus(msg);
    }
  }

  // Stage 6C: Event parking inventory is synchronized through ONE governed,
  // Event-scoped RPC -- there are no direct browser parking_sites writes in
  // this editor any more. The RPC reads the Event's OWN currently-selected
  // master map as the source of truth (not whatever map is open here),
  // adds missing vacant inventory, refreshes only template display
  // metadata, migrates master_site_id across map versions when identity is
  // unambiguous, and REPORTS a conflict -- never deletes, never renumbers
  // an occupied row -- for an occupied orphan, an ambiguous successor
  // match, or an occupied renumber. It never touches assigned_attendee_id,
  // attendees.assigned_site, or site_placement_history. The old
  // destructive "replace all sites" browser path is retired.
  async function syncInventoryToSelectedEvent() {
    const currentEvent = getCurrentAdminEvent();
    if (!currentEvent?.id) {
      setStatus("No admin working event selected.");
      return;
    }

    const { data: settings, error: settingsError } = await supabase
      .from("event_map_settings")
      .select("selected_master_map_id")
      .eq("event_id", currentEvent.id)
      .maybeSingle();

    if (settingsError) {
      setStatus(
        `Could not read the event's map selection: ${settingsError.message}`,
      );
      return;
    }

    const selectedMapId = settings?.selected_master_map_id as
      | string
      | null
      | undefined;
    if (!selectedMapId) {
      setStatus(
        `"${currentEvent.name}" has no master map selected. Assign one in the event's map settings first.`,
      );
      return;
    }

    const { data: mapRow, error: mapError } = await supabase
      .from("master_maps")
      .select("revision")
      .eq("id", selectedMapId)
      .single();

    if (mapError || typeof mapRow?.revision !== "number") {
      setStatus(
        `Could not read the selected map revision: ${mapError?.message ?? "unknown error"}`,
      );
      return;
    }

    const readRow = (data: unknown): SyncResultRow | null =>
      Array.isArray(data)
        ? ((data[0] as SyncResultRow) ?? null)
        : ((data as SyncResultRow) ?? null);

    const describeSyncRow = (row: SyncResultRow) => {
      const parts = [
        `${row.added} to add`,
        `${row.reconciled} to update`,
        `${row.relinked} to relink`,
      ];
      if (row.orphaned_vacant > 0) {
        parts.push(`${row.orphaned_vacant} vacant orphan(s) reported`);
      }
      if (row.manual_rows > 0) {
        parts.push(`${row.manual_rows} manual row(s) left untouched`);
      }
      const conflicts = Array.isArray(row.conflicts) ? row.conflicts : [];
      if (conflicts.length > 0) {
        parts.push(
          `${conflicts.length} CONFLICT(s): ${conflicts
            .map((c) => c.kind)
            .join(", ")}`,
        );
      }
      return parts.join("; ");
    };

    const rpcArgs = {
      p_event_id: currentEvent.id,
      p_expected_selected_master_map_id: selectedMapId,
      p_expected_map_revision: mapRow.revision,
    };

    const { data: previewData, error: previewError } = await supabase.rpc(
      "sync_master_map_parking_inventory_to_event",
      { ...rpcArgs, p_apply: false },
    );

    if (previewError) {
      setStatus(`Could not preview the inventory sync: ${previewError.message}`);
      return;
    }

    const preview = readRow(previewData);
    if (!preview) {
      setStatus("The inventory sync preview returned nothing.");
      return;
    }
    if (preview.outcome === "rejected") {
      setStatus(
        `Inventory sync unavailable (${preview.rejection_code}). Refresh and try again.`,
      );
      return;
    }

    const conflictCount = Array.isArray(preview.conflicts)
      ? preview.conflicts.length
      : 0;

    const confirmed = window.confirm(
      `Sync parking inventory for "${currentEvent.name}" from its selected master map?\n\n` +
        `${describeSyncRow(preview)}\n\n` +
        (conflictCount > 0
          ? "Conflicts must be resolved in Parking Admin before apply can succeed. Continue to see the full result?"
          : "Assignments, notes, and placement history are never changed. Continue?"),
    );
    if (!confirmed) {
      return;
    }

    const { data: applyData, error: applyError } = await supabase.rpc(
      "sync_master_map_parking_inventory_to_event",
      { ...rpcArgs, p_apply: true },
    );

    if (applyError) {
      setStatus(`Could not sync parking inventory: ${applyError.message}`);
      return;
    }

    const applied = readRow(applyData);
    if (!applied) {
      setStatus("The inventory sync returned nothing.");
      return;
    }
    if (applied.outcome === "rejected") {
      const n = Array.isArray(applied.conflicts) ? applied.conflicts.length : 0;
      setStatus(
        applied.rejection_code === "unresolved_conflicts"
          ? `Inventory sync blocked: ${n} conflict(s) need resolution in Parking Admin. Nothing was changed.`
          : `Inventory sync rejected (${applied.rejection_code}). Nothing was changed.`,
      );
      return;
    }

    setStatus(
      `Parking inventory synced for "${currentEvent.name}": ${applied.added} added, ${applied.reconciled} updated, ${applied.relinked} relinked. Assignments and notes preserved.`,
    );
  }

  async function createDraftCopy() {
    if (!masterMap) {
      return;
    }

    // Stage 6B: one governed operation creates the editable draft AND copies
    // the marker set atomically -- platform authority, no direct INSERT.
    const { data: newMap, error: newMapError } = await supabase.rpc(
      "create_master_map_draft_from",
      { p_source_map_id: masterMap.id },
    );

    const newMapRow = newMap as { id: string } | null;

    if (newMapError || !newMapRow?.id) {
      setStatus(
        newMapError
          ? describeMapMutationError(newMapError.message, "Could not create draft copy")
          : "Could not create draft copy.",
      );
      return;
    }

    router.push(`/admin/master-maps/${newMapRow.id}`);
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
          cancelPendingMarker();
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

      // Arrow nudge (outside editable fields -- guarded above): the pending
      // marker if one exists, otherwise the saved selection.
      const step = e.altKey ? 0.01 : e.shiftKey ? 0.25 : 0.05;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        nudgeTarget(-step, 0);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        nudgeTarget(step, 0);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        nudgeTarget(0, -step);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        nudgeTarget(0, step);
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [cancelPendingMarker, deleteSelectedMarker, nudgeTarget, pendingMarker]);

  // ─── renderMarker ─────────────────────────────────────────────────────────
  // MapCanvas calls this for every visible marker. Receives the marker and
  // clean {selected, primary} flags — no manual selectedSiteIds lookup needed.

  // Per-marker nearest-neighbour distance, in native image px. The shared
  // helper reports MAP-WIDE statistics (median/p10/min), which is the right
  // input for one global size but the wrong one here: a single tight cluster
  // would drag every isolated marker down with it. This is the same distance
  // measure applied per marker, so density constrains only the markers that
  // are actually crowded.


  // Base geometry, in native image px, from the ENGINE's own fit scale.
  const markerGeometry = useMemo(() => {
    // Before the first geometry report, fall back to 1 (native == CSS), which
    // is the historical behaviour.
    const fitScale =
      mapGeometry && mapGeometry.fitScale > 0 ? mapGeometry.fitScale : 1;
    const factor = markerSizePct / 100;

    // The native size that resolves to the target CSS size at the engine's fit
    // view. No safety factor: this is the engine's actual scale, not an
    // estimate from this page's own container.
    const dot = Math.max(6, (MARKER_DOT_CSS_AT_FIT * factor) / fitScale);
    const label = Math.max(6, dot * MARKER_LABEL_RATIO);
    const hit = Math.max(dot, MARKER_HIT_CSS_AT_FIT / fitScale);

    return { fitScale, dot, label, hit };
  }, [mapGeometry, markerSizePct]);

  // Per-marker clearance to its neighbours, in native image px. The shared
  // helper reports MAP-WIDE statistics, which is the right input for one global
  // size but the wrong one here: a single tight cluster would drag every
  // isolated marker down with it.
  //
  // Clearance is DIRECTIONAL. A marker's dot is radial, but its label hangs
  // below and spreads sideways, so a neighbour to the side constrains the
  // label's width while a neighbour below constrains its height. Using one
  // scalar distance for both hides labels that had ample room in the direction
  // that actually mattered.
  const neighborClearance = useMemo(() => {
    const baseDot = markerGeometry.dot;
    const baseLabel = markerGeometry.label;
    const placed = sites.filter((x) => x.map_x !== null && x.map_y !== null);
    const nw = mapGeometry?.naturalWidth || 1200;
    const nh = mapGeometry?.naturalHeight || 800;
    const pts = placed.map((x) => ({
      id: x.id,
      x: ((x.map_x as number) / 100) * nw,
      y: ((x.map_y as number) / 100) * nh,
    }));

    // Pass 1 -- radial gap, and vertical clearance to the nearest neighbour
    // roughly BELOW (the direction the label hangs).
    const base = pts.map((pi, i) => {
      let gap = Infinity;
      let clearYBelow = Infinity;
      for (let j = 0; j < pts.length; j++) {
        if (i === j) {
          continue;
        }
        const dx = pts[j]!.x - pi.x;
        const dy = pts[j]!.y - pi.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < gap) {
          gap = d;
        }
        if (dy > 0 && Math.abs(dx) < baseDot && dy < clearYBelow) {
          clearYBelow = dy;
        }
      }
      return { gap, clearYBelow };
    });

    // Pass 2 -- horizontal clearance, computed only AFTER this marker's label
    // height is known. A neighbour constrains label WIDTH only if it actually
    // sits alongside the label; one directly below has dx = 0 and would
    // otherwise zero the width budget even though it constrains height, which
    // is what kept a crowded label hidden at every zoom level.
    const out = new Map<
      string,
      { gap: number; clearX: number; clearYBelow: number }
    >();
    pts.forEach((pi, i) => {
      const { gap, clearYBelow } = base[i]!;
      const half = Number.isFinite(gap) ? gap * 0.5 : Infinity;
      const dot = Math.max(
        MARKER_DOT_FLOOR_PX,
        Math.min(baseDot, half * MARKER_DOT_TERRITORY_FRACTION),
      );
      let labelSize = baseLabel;
      const roomBelow = clearYBelow * 0.5 - dot / 2;
      if (Number.isFinite(roomBelow)) {
        labelSize = Math.min(labelSize, (roomBelow - 2) / 1.6);
      }
      const labelTop = dot / 2;
      const labelBottom = labelTop + Math.max(0, labelSize) * 1.6 + 2;

      let clearX = Infinity;
      for (let j = 0; j < pts.length; j++) {
        if (i === j) {
          continue;
        }
        const dx = pts[j]!.x - pi.x;
        const dy = pts[j]!.y - pi.y;
        // Does the neighbour's own dot band overlap this label's vertical band?
        const nTop = dy - baseDot / 2;
        const nBottom = dy + baseDot / 2;
        if (nBottom > labelTop && nTop < labelBottom && Math.abs(dx) < clearX) {
          clearX = Math.abs(dx);
        }
      }
      out.set(pi.id, { gap, clearX, clearYBelow });
    });
    return out;
  }, [
    sites,
    mapGeometry?.naturalWidth,
    mapGeometry?.naturalHeight,
    markerGeometry.dot,
    markerGeometry.label,
  ]);

  // Per-marker geometry: the base size, narrowed only where this marker's own
  // closest neighbour is near enough that the full size would overlap it.
  // Visible size and selection geometry are bounded separately -- the pad may
  // never overlap, while the dot keeps a readable floor.
  // Per-marker geometry. Every interactive part of a marker -- dot, tap pad,
  // label and the primary delete control -- is kept inside that marker's own
  // TERRITORY: the half-distance to its nearest neighbour. Two parts each
  // reaching at most half the gap between their centres can never overlap, so
  // no marker can cover or capture another's. Bounding only the pad (the
  // previous rule) left labels and the delete control free to overlap, which
  // is how a neighbour stole an unambiguous click.
  const geometryForMarker = useCallback(
    (id: string) => {
      const { dot, label, hit, fitScale } = markerGeometry;
      const clearance = neighborClearance.get(id);
      const gap = clearance?.gap ?? Infinity;
      const clearX = clearance?.clearX ?? Infinity;
      const clearYBelow = clearance?.clearYBelow ?? Infinity;
      const half = Number.isFinite(gap) ? gap * 0.5 : Infinity;

      const boundedDot = Math.max(
        MARKER_DOT_FLOOR_PX,
        Math.min(dot, half * MARKER_DOT_TERRITORY_FRACTION),
      );
      // Never larger than territory, but never smaller than the dot either:
      // with `half` last in the chain, two coincident markers (territory 0)
      // collapsed to a zero-size pad and became entirely unclickable.
      const boundedHit = Math.max(boundedDot, Math.min(hit, half));
      const boundedDelete = Math.min(
        Math.max(MARKER_DELETE_MIN_PX, boundedDot * 0.55),
        half * MARKER_DELETE_TERRITORY_FRACTION,
      );

      // The label hangs below the dot, so the room it may occupy is what is
      // left of the territory beneath the dot. Shrink it to fit; if it cannot
      // be drawn legibly in that room, draw no label at all rather than one
      // that covers a neighbour. The dot and pad still carry the marker.
      // Legibility is an ON-SCREEN test at the CURRENT zoom, not at fit: the
      // label's native size is fixed, so zooming in genuinely makes it larger
      // on screen and a label that was too small to read becomes readable.
      // Before the first scale report, fall back to the fit scale.
      const renderScale = liveScale ?? (fitScale > 0 ? fitScale : 1);
      const legibleNative = MARKER_LABEL_MIN_CSS / renderScale;
      // The label's FONT follows the base size, not the territory-bounded dot:
      // horizontal crowding is handled by clipping the box (maxWidth below), so
      // shrinking the text as well would hide labels that had ample room in the
      // direction that actually mattered.
      let boundedLabel = label;
      // Vertical room is what is left beneath the dot before the nearest
      // neighbour BELOW. Height ~= font * 1.15 (line) + font * 0.2 (padding)
      // + font * 0.25 (offset from the dot) + 2 (border).
      const roomBelow = clearYBelow * 0.5 - boundedDot / 2;
      if (Number.isFinite(roomBelow)) {
        boundedLabel = Math.min(boundedLabel, (roomBelow - 2) / 1.6);
      }
      // A label box cannot be narrower than its own padding and border, so a
      // maxWidth below that is silently ignored by the browser and the box
      // spills into the neighbour. Where the sideways room cannot hold even a
      // minimal box, draw no label -- the dot and pad still carry the marker.
      const minBoxWidth = boundedLabel * MARKER_LABEL_MIN_BOX_RATIO;
      const widthAvailable = Number.isFinite(clearX)
        ? clearX * MARKER_LABEL_WIDTH_FRACTION
        : Infinity;
      const labelVisible =
        boundedLabel >= legibleNative && widthAvailable >= minBoxWidth;

      return {
        dot: boundedDot,
        label: boundedLabel,
        labelVisible,
        labelMaxWidth: Number.isFinite(clearX) ? widthAvailable : undefined,
        hit: boundedHit,
        del: boundedDelete,
      };
    },
    [markerGeometry, neighborClearance, liveScale],
  );

  const renderMarker = useCallback(
    (marker: MapMarker, state: { selected: boolean; primary: boolean }) => {
      const site = marker.data as MasterMapSiteRow;
      const { selected, primary } = state;
      const { dot, label, labelVisible, labelMaxWidth, hit, del } =
        geometryForMarker(marker.id);

      // A zero-size anchor: MarkerLayer already translates this node by
      // (-50%, -50%), so a 0x0 root puts the origin exactly on the marker's
      // stored percentage coordinate. Every visual is then absolutely centred
      // on that origin, which keeps the dot centre -- the marker centre --
      // pinned to the saved coordinate no matter how the label is sized.
      return (
        <div style={{ position: "relative", width: 0, height: 0 }}>
          {/* Invisible tap target. Sized in native px to resolve to a usable
              CSS target at the working views, and capped by real neighbour
              spacing so it can never overlap the next marker's pad. */}
          <div
            data-marker-hit="true"
            style={{
              position: "absolute",
              left: -hit / 2,
              top: -hit / 2,
              width: hit,
              height: hit,
              borderRadius: "50%",
              background: "transparent",
              pointerEvents: "auto",
              cursor: "pointer",
            }}
          />

          {/* Dot. Always rendered -- including with labels on -- so the
              normal / selected / primary state cue is never lost. */}
          <div
            data-marker-dot="true"
            style={{
              position: "absolute",
              left: -dot / 2,
              top: -dot / 2,
              width: dot,
              height: dot,
              borderRadius: "50%",
              border:
                primary || selected
                  ? `${Math.max(1, dot * 0.12)}px solid white`
                  : `${Math.max(1, dot * 0.07)}px solid rgba(255,255,255,0.85)`,
              background: primary
                ? "#f4b400"
                : selected
                  ? "#60a5fa"
                  : "#1f9d55",
              boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
              pointerEvents: "none",
            }}
          />

          {/* Delete button — only on the primary marker in edit mode. */}
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
                left: dot / 2 - del * 0.2,
                top: -dot / 2 - del * 0.8,
                width: del,
                height: del,
                borderRadius: "50%",
                background: "#dc2626",
                color: "white",
                border: `${Math.max(1, del * 0.08)}px solid white`,
                fontSize: del * 0.66,
                lineHeight: 1,
                textAlign: "center",
                cursor: "pointer",
                boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
                padding: 0,
                pointerEvents: "auto",
              }}
            >
              ×
            </button>
          )}

          {/* Label chip — below the dot so it never displaces the centre. */}
          {showLabels && labelVisible && (
            <div
              data-marker-label="true"
              style={{
                position: "absolute",
                left: "50%",
                top: dot / 2 + label * 0.25,
                transform: "translateX(-50%)",
                border:
                  primary || selected
                    ? `${Math.max(1, label * 0.14)}px solid white`
                    : `${Math.max(1, label * 0.08)}px solid rgba(255,255,255,0.85)`,
                background: primary || selected ? "#f4b400" : "#1f9d55",
                fontSize: label,
                fontWeight: 700,
                lineHeight: 1.15,
                padding: `${label * 0.1}px ${label * 0.42}px`,
                color: "#111",
                whiteSpace: "nowrap",
                // A long name may not reach into a neighbour's territory; clip
                // it instead of letting the box grow without bound.
                maxWidth: labelMaxWidth,
                overflow: "hidden",
                textOverflow: "ellipsis",
                boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                // Clickable: a click on a marker's own label must select that
                // marker, not fall through to the map and place a new one.
                pointerEvents: "auto",
                cursor: "pointer",
              }}
            >
              {site.display_label || site.site_number}
            </div>
          )}
        </div>
      );
    },
    [showLabels, readOnlyMarkers, deleteSelectedMarker, geometryForMarker],
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
    <div style={{ padding: 12 }}>
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
          gap: 16,
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

            {/* Marker size — editor display state only. It changes no marker
                coordinate, writes nothing, and is deliberately not persisted. */}
            <div style={{ display: "grid", gap: 4 }}>
              <label
                htmlFor="marker-size"
                style={{ fontSize: 14, display: "flex", justifyContent: "space-between" }}
              >
                <span>Marker size</span>
                <span style={{ color: "#666" }}>{markerSizePct}%</span>
              </label>
              <input
                id="marker-size"
                type="range"
                min={MARKER_SIZE_MIN_PCT}
                max={MARKER_SIZE_MAX_PCT}
                step={MARKER_SIZE_STEP_PCT}
                value={markerSizePct}
                onChange={(e) => setMarkerSizePct(Number(e.target.value))}
                disabled={loading}
                aria-label="Marker size"
                aria-valuetext={`${markerSizePct} percent`}
                style={{ width: "100%" }}
              />
              <div style={{ fontSize: 12, color: "#666" }}>
                Display only — does not move markers or change saved positions.
              </div>
            </div>

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
                type="button"
                disabled={
                  readOnlyMarkers || loading || isSavingMarker || !pendingMarker
                }
                onClick={cancelPendingMarker}
                style={{ flex: 1 }}
              >
                Cancel
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

            {/* Position nudge pad: moves the pending marker locally when one
                exists, otherwise the saved selection. Save Pos stays
                saved-marker only. */}
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
                  disabled={nudgePadDisabled}
                  onClick={() => nudgeTarget(0, -0.05)}
                >
                  ↑
                </button>
                <div />
                <button
                  disabled={nudgePadDisabled}
                  onClick={() => nudgeTarget(-0.05, 0)}
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
                  disabled={nudgePadDisabled}
                  onClick={() => nudgeTarget(0.05, 0)}
                >
                  →
                </button>
                <div />
                <button
                  disabled={nudgePadDisabled}
                  onClick={() => nudgeTarget(0, 0.05)}
                >
                  ↓
                </button>
                <div />
              </div>
            </div>

            {/* Map save / Event inventory sync actions */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!readOnlyMarkers && (
                <button
                  onClick={() => void saveUpdatedMap()}
                  style={{ flex: 1 }}
                  disabled={loading}
                >
                  Save Updated Map
                </button>
              )}
              <button
                onClick={() => void syncInventoryToSelectedEvent()}
                style={{ flex: 1 }}
                disabled={loading}
              >
                Sync Selected Event Parking Inventory
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
            onGeometryChange={handleGeometryChange}
            onScaleChange={handleScaleChange}
            pendingMarkerSize={markerGeometry.dot}
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
    <AdminRouteGuard requiredPermission="can_manage_master_maps">
      <AdminShellAdapter
        pageTitle="Master Map Editor"
        backTarget={{ href: "/admin/master-maps", label: "Master Maps" }}
        contentMode="full-bleed"
      >
        <MasterMapEditorPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}
