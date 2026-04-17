"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getAdminEvent } from "@/lib/getAdminEvent";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import {
  getCurrentAdminAccess,
  canAccessEvent,
  hasPermission,
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

type Point = {
  x: number;
  y: number;
};

type AdminEventContext = {
  id?: string | null;
  name?: string | null;
};

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

function MasterMapEditorPageInner() {
  const params = useParams();
  const router = useRouter();
  const masterMapId = params?.id as string;

  const siteNumberRef = useRef<HTMLInputElement | null>(null);
  const mapCanvasRef = useRef<HTMLDivElement | null>(null);
  const ignoreCanvasClickUntilRef = useRef(0);
  const suppressNextClickRef = useRef(false);
  const suppressCanvasMouseUpUntilRef = useRef(0);
  const readOnlyMarkersRef = useRef(false);
  const primarySelectedSiteIdRef = useRef<string | null>(null);
  const pendingPointRef = useRef<{ x: number | null; y: number | null }>({
    x: null,
    y: null,
  });
  const undoStackRef = useRef<
    Array<Array<{ id: string; map_x: number | null; map_y: number | null }>>
  >([]);

  const [masterMap, setMasterMap] = useState<MasterMapRow | null>(null);
  const [sites, setSites] = useState<MasterMapSiteRow[]>([]);
  const [primarySelectedSiteId, setPrimarySelectedSiteId] = useState<
    string | null
  >(null);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [siteNumber, setSiteNumber] = useState("");
  const [pendingX, setPendingX] = useState<number | null>(null);
  const [pendingY, setPendingY] = useState<number | null>(null);
  const [editX, setEditX] = useState<number | null>(null);
  const [editY, setEditY] = useState<number | null>(null);
  const [status, setStatus] = useState("Loading master map...");
  const [zoom, setZoom] = useState(1);
  const [naturalSize, setNaturalSize] = useState({ width: 1200, height: 800 });
  const [saveAndNextMode, setSaveAndNextMode] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [suppressNextClick, setSuppressNextClick] = useState(false);
  const [isPointerDown, setIsPointerDown] = useState(false);
  const [isDraggingSelect, setIsDraggingSelect] = useState(false);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragCurrent, setDragCurrent] = useState<Point | null>(null);
  const [replaceImageFile, setReplaceImageFile] = useState<File | null>(null);
  const [replacingImage, setReplacingImage] = useState(false);
  const [undoStack, setUndoStack] = useState<
    Array<Array<{ id: string; map_x: number | null; map_y: number | null }>>
  >([]);

  const [mapName, setMapName] = useState("");
  const [parkName, setParkName] = useState("");
  const [mapLocation, setMapLocation] = useState("");

  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readOnlyMarkers =
    masterMap?.status === "published" || masterMap?.is_read_only === true;
  useEffect(() => {
    readOnlyMarkersRef.current = !!readOnlyMarkers;
  }, [readOnlyMarkers]);

  useEffect(() => {
    primarySelectedSiteIdRef.current = primarySelectedSiteId;
  }, [primarySelectedSiteId]);

  useEffect(() => {
    pendingPointRef.current = { x: pendingX, y: pendingY };
  }, [pendingX, pendingY]);

  useEffect(() => {
    undoStackRef.current = undoStack;
  }, [undoStack]);

  async function loadMasterMap() {
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
  }

  async function loadSites() {
    const { data, error } = await supabase
      .from("master_map_sites")
      .select("id,master_map_id,site_number,display_label,map_x,map_y")
      .eq("master_map_id", masterMapId)
      .order("site_number");

    if (error) {
      throw new Error(`Could not load master map sites: ${error.message}`);
    }

    setSites((data || []) as MasterMapSiteRow[]);
  }

  async function loadPage() {
    try {
      setLoading(true);
      setError(null);
      setStatus("Checking admin access...");
      setAccessDenied(false);

      const admin = await getCurrentAdminAccess();

      if (!admin) {
        setMasterMap(null);
        setSites([]);
        setError("No admin access.");
        setStatus("Access denied.");
        setAccessDenied(true);
        return;
      }

      if (!hasPermission(admin, "can_manage_master_maps")) {
        setMasterMap(null);
        setSites([]);
        setError("You do not have permission to manage master maps.");
        setStatus("Access denied.");
        setAccessDenied(true);
        return;
      }

      const adminEvent = getAdminEvent() as AdminEventContext | null;

      if (adminEvent?.id && !canAccessEvent(admin, adminEvent.id)) {
        setMasterMap(null);
        setSites([]);
        setError("You do not have access to the current admin event.");
        setStatus("Access denied.");
        setAccessDenied(true);
        return;
      }

      setStatus("Loading master map...");
      await loadMasterMap();
      await loadSites();
      setStatus("Ready");
    } catch (err: any) {
      console.error("loadPage error:", err);
      setMasterMap(null);
      setSites([]);
      setError(err?.message || "Failed to load master map.");
      setStatus("Load failed.");
    } finally {
      setLoading(false);
    }
  }
  async function replaceMasterMapImage() {
    if (!masterMap) {
      setStatus("No master map loaded.");
      return;
    }

    if (!replaceImageFile) {
      setStatus("Choose a new image first.");
      return;
    }

    try {
      setReplacingImage(true);
      setStatus("Uploading replacement image...");

      const safeName = replaceImageFile.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
      const filePath = `master-maps/${masterMap.id}-${Date.now()}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("master-maps")
        .upload(filePath, replaceImageFile, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        setStatus(`Could not upload image: ${uploadError.message}`);
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

      const { error: updateError } = await supabase
        .from("master_maps")
        .update({
          map_image_url: publicUrl,
        })
        .eq("id", masterMap.id);

      if (updateError) {
        setStatus(`Could not update master map image: ${updateError.message}`);
        return;
      }

      setReplaceImageFile(null);
      await loadMasterMap();
      setStatus("Master map image replaced successfully.");
    } catch (err: any) {
      console.error("replaceMasterMapImage error:", err);
      setStatus(err?.message || "Failed to replace master map image.");
    } finally {
      setReplacingImage(false);
    }
  }

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
        if (row.id === masterMap.id) return false;

        const rowGroup =
          normalizeMapGroup(row.map_group) ||
          normalizeMapGroup(row.park_name) ||
          normalizeMapGroup(stripDraftSuffix(row.name));

        if (nextMapGroup && rowGroup === nextMapGroup) return true;

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
          .update({
            selected_master_map_id: masterMap.id,
          })
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
    } catch (err: any) {
      console.error("saveUpdatedMap error:", err);
      setStatus(err?.message || "Could not save updated map.");
    }
  }

  useEffect(() => {
    if (!masterMapId) return;
    void loadPage();
  }, [masterMapId]);
  useEffect(() => {
    if (!loading && !accessDenied) {
      focusMapCanvasNow();
      focusMapCanvas();
      setTimeout(() => {
        focusMapCanvasNow();
      }, 0);
    }
  }, [loading, accessDenied]);

  const primarySelectedSite = useMemo(() => {
    return sites.find((s) => s.id === primarySelectedSiteId) || null;
  }, [sites, primarySelectedSiteId]);

  const selectedSites = useMemo(() => {
    const idSet = new Set(selectedSiteIds);
    return sites.filter((s) => idSet.has(s.id));
  }, [sites, selectedSiteIds]);

  const renderedSites = useMemo(() => {
    return sites.map((site) => {
      const isPrimary = site.id === primarySelectedSiteId;
      const useEditCoords = isPrimary && editX !== null && editY !== null;

      return {
        ...site,
        map_x: useEditCoords ? editX : site.map_x,
        map_y: useEditCoords ? editY : site.map_y,
      };
    });
  }, [sites, primarySelectedSiteId, editX, editY]);

  const selectionBox = useMemo(() => {
    if (!dragStart || !dragCurrent || !isDraggingSelect) return null;

    return {
      left: Math.min(dragStart.x, dragCurrent.x),
      top: Math.min(dragStart.y, dragCurrent.y),
      width: Math.abs(dragStart.x - dragCurrent.x),
      height: Math.abs(dragStart.y - dragCurrent.y),
    };
  }, [dragStart, dragCurrent, isDraggingSelect]);

  function focusSiteNumber() {
    requestAnimationFrame(() => {
      siteNumberRef.current?.focus();
      siteNumberRef.current?.select();
    });
  }

  function focusMapCanvas() {
    requestAnimationFrame(() => {
      mapCanvasRef.current?.focus({ preventScroll: true });
    });
  }
  function focusMapCanvasNow() {
    mapCanvasRef.current?.focus({ preventScroll: true });
  }

  function capturePositionSnapshot(siteIds: string[]) {
    const idSet = new Set(siteIds);
    const snapshot = sites
      .filter((site) => idSet.has(site.id))
      .map((site) => ({
        id: site.id,
        map_x: site.map_x,
        map_y: site.map_y,
      }));

    if (snapshot.length === 0) return;

    setUndoStack((prev) => [...prev, snapshot]);
  }

  function clearNativeSelection() {
    if (typeof window !== "undefined") {
      window.getSelection()?.removeAllRanges();
    }
  }

  function clearFormFieldsOnly() {
    setSiteNumber("");
    setPrimarySelectedSiteId(null);
    setSelectedSiteIds([]);
    setEditX(null);
    setEditY(null);
  }

  function resetForNextMarker() {
    clearFormFieldsOnly();
    setPendingX(null);
    setPendingY(null);
  }

  function findDuplicateSite(trimmedSiteNumber: string) {
    const normalized = trimmedSiteNumber.toLowerCase();
    return sites.find((site) => {
      if (!site.site_number) return false;
      if (primarySelectedSiteId && site.id === primarySelectedSiteId)
        return false;
      return site.site_number.trim().toLowerCase() === normalized;
    });
  }

  function getRelativePoint(e: React.MouseEvent<HTMLDivElement>): Point {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = clampPercent(((e.clientX - rect.left) / rect.width) * 100);
    const y = clampPercent(((e.clientY - rect.top) / rect.height) * 100);
    return {
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
    };
  }

  function handleMapMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (readOnlyMarkers) return;
    if (e.button !== 0) return;
    if (e.target !== e.currentTarget) return;

    e.preventDefault();
    clearNativeSelection();

    const point = getRelativePoint(e);
    setIsPointerDown(true);
    setIsDraggingSelect(false);
    setDragStart(point);
    setDragCurrent(point);
  }

  function handleMapMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!isPointerDown || !dragStart) return;

    e.preventDefault();

    const point = getRelativePoint(e);
    const dx = Math.abs(point.x - dragStart.x);
    const dy = Math.abs(point.y - dragStart.y);

    if (!isDraggingSelect && (dx > 0.4 || dy > 0.4)) {
      setIsDraggingSelect(true);
    }

    if (isDraggingSelect || dx > 0.4 || dy > 0.4) {
      setDragCurrent(point);
    }
  }
  function placePendingMarkerFromPoint(point: Point) {
    setPendingX(point.x);
    setPendingY(point.y);
    setSelectedSiteIds([]);
    setPrimarySelectedSiteId(null);
    setEditX(null);
    setEditY(null);
    setSiteNumber("");
    setStatus(
      "Marker position selected. Type site number and press Enter to save.",
    );
    focusSiteNumber();
  }
  function handleMapMouseUp(e: React.MouseEvent<HTMLDivElement>) {
    const now = Date.now();

    if (now < suppressCanvasMouseUpUntilRef.current) {
      setIsPointerDown(false);
      setIsDraggingSelect(false);
      setDragStart(null);
      setDragCurrent(null);
      return;
    }

    if (!isPointerDown) return;

    e.preventDefault();
    clearNativeSelection();

    if (isDraggingSelect && dragStart && dragCurrent) {
      const minX = Math.min(dragStart.x, dragCurrent.x);
      const maxX = Math.max(dragStart.x, dragCurrent.x);
      const minY = Math.min(dragStart.y, dragCurrent.y);
      const maxY = Math.max(dragStart.y, dragCurrent.y);

      const selected = sites
        .filter(
          (site) =>
            site.map_x !== null &&
            site.map_y !== null &&
            site.map_x >= minX &&
            site.map_x <= maxX &&
            site.map_y >= minY &&
            site.map_y <= maxY,
        )
        .map((site) => site.id);

      setSelectedSiteIds(selected);
      setPrimarySelectedSiteId(selected[0] || null);

      if (selected.length > 0) {
        const first = sites.find((s) => s.id === selected[0]);
        if (first) {
          setSiteNumber(first.site_number);
          setEditX(first.map_x);
          setEditY(first.map_y);
        }
      } else {
        setSiteNumber("");
        setEditX(null);
        setEditY(null);
      }

      setPendingX(null);
      setPendingY(null);
      setStatus(
        `Selected ${selected.length} marker${selected.length === 1 ? "" : "s"}.`,
      );
      suppressNextClickRef.current = true;
      setSuppressNextClick(true);
    } else if (
      !readOnlyMarkers &&
      e.target === e.currentTarget &&
      !(suppressNextClickRef.current || suppressNextClick)
    ) {
      const point = getRelativePoint(e);
      placePendingMarkerFromPoint(point);
    } else if (suppressNextClickRef.current || suppressNextClick) {
      suppressNextClickRef.current = false;
      setSuppressNextClick(false);
    }

    setIsPointerDown(false);
    setIsDraggingSelect(false);
    setDragStart(null);
    setDragCurrent(null);
  }

  function handleMarkerSelect(
    site: MasterMapSiteRow,
    e: React.MouseEvent<HTMLButtonElement>,
  ) {
    e.preventDefault();
    e.stopPropagation();
    ignoreCanvasClickUntilRef.current = Date.now() + 500;
    suppressCanvasMouseUpUntilRef.current = Date.now() + 500;
    suppressNextClickRef.current = true;
    setSuppressNextClick(true);
    setPendingX(null);
    setPendingY(null);

    if (e.shiftKey) {
      setSelectedSiteIds((prev) => {
        const exists = prev.includes(site.id);
        return exists
          ? prev.filter((id) => id !== site.id)
          : [...prev, site.id];
      });
      setPrimarySelectedSiteId(site.id);
    } else {
      setSelectedSiteIds([site.id]);
      setPrimarySelectedSiteId(site.id);
    }

    setSiteNumber(site.site_number);
    setEditX(site.map_x);
    setEditY(site.map_y);
    setPendingX(null);
    setPendingY(null);
    focusMapCanvasNow();
    focusMapCanvas();
  }

  async function saveNewMarkerInternal(nextMode: boolean) {
    if (readOnlyMarkers) {
      setStatus(
        "Published master maps are read-only. Create a draft copy to edit markers.",
      );
      return;
    }

    if (pendingX === null || pendingY === null) {
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

    const { error } = await supabase.from("master_map_sites").insert({
      master_map_id: masterMapId,
      site_number: trimmedSiteNumber,
      display_label: trimmedSiteNumber,
      map_x: pendingX,
      map_y: pendingY,
    });

    if (error) {
      setStatus(`Could not save marker: ${error.message}`);
      return;
    }

    await loadSites();

    if (nextMode) {
      resetForNextMarker();
      setStatus("Marker saved. Click the map to place the next marker.");
      return;
    }

    setPendingX(null);
    setPendingY(null);
    setSiteNumber("");
    setStatus("Marker saved.");
    focusSiteNumber();
  }

  async function saveNewMarker() {
    await saveNewMarkerInternal(false);
  }

  async function saveAndNextMarker() {
    await saveNewMarkerInternal(true);
  }

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

  async function saveFromKeyboard() {
    if (primarySelectedSiteId) {
      await updateSelectedMarker();
    } else if (saveAndNextMode) {
      await saveAndNextMarker();
    } else {
      await saveNewMarker();
    }
  }

  function getNudgeStep(e: KeyboardEvent) {
    if (e.altKey) return 0.01;
    if (e.shiftKey) return 0.25;
    return 0.05;
  }

  function nudgePending(dx: number, dy: number) {
    if (pendingX === null || pendingY === null) {
      setStatus("Click the map first to place a pending marker.");
      return;
    }

    const nextX = clampPercent(Number((pendingX + dx).toFixed(2)));
    const nextY = clampPercent(Number((pendingY + dy).toFixed(2)));

    setPendingX(nextX);
    setPendingY(nextY);
    setStatus(
      `Pending marker moved to X ${nextX.toFixed(2)}, Y ${nextY.toFixed(2)}.`,
    );
  }

  async function nudgeSelected(dx: number, dy: number) {
    if (readOnlyMarkers) {
      setStatus(
        "Published master maps are read-only. Create a draft copy to edit markers.",
      );
      return;
    }

    if (!primarySelectedSiteId || !primarySelectedSite) {
      setStatus("Select a marker first.");
      return;
    }

    const baseX = editX ?? primarySelectedSite.map_x ?? 0;
    const baseY = editY ?? primarySelectedSite.map_y ?? 0;
    capturePositionSnapshot([primarySelectedSiteId]);

    const nextX = clampPercent(Number((baseX + dx).toFixed(2)));
    const nextY = clampPercent(Number((baseY + dy).toFixed(2)));

    setEditX(nextX);
    setEditY(nextY);

    const { error } = await supabase
      .from("master_map_sites")
      .update({
        map_x: nextX,
        map_y: nextY,
      })
      .eq("id", primarySelectedSiteId);

    if (error) {
      setStatus(`Could not save nudged position: ${error.message}`);
      return;
    }

    setSites((prev) =>
      prev.map((site) =>
        site.id === primarySelectedSiteId
          ? { ...site, map_x: nextX, map_y: nextY }
          : site,
      ),
    );

    setStatus(
      `Marker position saved at X ${nextX.toFixed(2)}, Y ${nextY.toFixed(2)}.`,
    );
  }

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
    capturePositionSnapshot([primarySelectedSiteId]);

    const { error } = await supabase
      .from("master_map_sites")
      .update({
        map_x: editX,
        map_y: editY,
      })
      .eq("id", primarySelectedSiteId);

    if (error) {
      setStatus(`Could not save position: ${error.message}`);
      return;
    }

    await loadSites();
    setStatus("Position saved.");
    focusSiteNumber();
  }

  async function deleteSelectedMarker() {
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

    const confirmed = window.confirm("Delete the selected marker?");
    if (!confirmed) return;

    const { error } = await supabase
      .from("master_map_sites")
      .delete()
      .eq("id", primarySelectedSiteId);

    if (error) {
      setStatus(`Could not delete marker: ${error.message}`);
      return;
    }

    clearFormFieldsOnly();
    await loadSites();
    setStatus("Marker deleted.");
    focusSiteNumber();
  }

  async function applyBulkPositions(
    updates: Array<{ id: string; map_x: number; map_y: number }>,
  ) {
    if (updates.length === 0) return false;

    capturePositionSnapshot(updates.map((update) => update.id));

    for (const update of updates) {
      const { error } = await supabase
        .from("master_map_sites")
        .update({
          map_x: update.map_x,
          map_y: update.map_y,
        })
        .eq("id", update.id);

      if (error) {
        setStatus(`Could not save alignment: ${error.message}`);
        return false;
      }
    }

    setSites((prev) =>
      prev.map((site) => {
        const match = updates.find((u) => u.id === site.id);
        return match
          ? { ...site, map_x: match.map_x, map_y: match.map_y }
          : site;
      }),
    );

    if (primarySelectedSiteId) {
      const primaryUpdate = updates.find((u) => u.id === primarySelectedSiteId);
      if (primaryUpdate) {
        setEditX(primaryUpdate.map_x);
        setEditY(primaryUpdate.map_y);
      }
    }

    return true;
  }

  async function undoLastPositionChange() {
    if (readOnlyMarkers) {
      setStatus(
        "Published master maps are read-only. Create a draft copy to edit markers.",
      );
      return;
    }

    const snapshot = undoStack[undoStack.length - 1] || [];

    if (snapshot.length === 0) {
      setStatus("No position change to undo.");
      return;
    }

    for (const item of snapshot) {
      const { error } = await supabase
        .from("master_map_sites")
        .update({
          map_x: item.map_x,
          map_y: item.map_y,
        })
        .eq("id", item.id);

      if (error) {
        setStatus(`Could not undo position change: ${error.message}`);
        return;
      }
    }

    setSites((prev) =>
      prev.map((site) => {
        const prior = snapshot.find((p) => p.id === site.id);
        return prior
          ? { ...site, map_x: prior.map_x, map_y: prior.map_y }
          : site;
      }),
    );

    if (primarySelectedSiteId) {
      const primary = snapshot.find((p) => p.id === primarySelectedSiteId);
      if (primary) {
        setEditX(primary.map_x);
        setEditY(primary.map_y);
      }
    }

    setStatus(`Undid position change for ${snapshot.length} marker(s).`);
    setUndoStack((prev) => prev.slice(0, -1));
  }

  async function undoAllPositionChanges() {
    if (readOnlyMarkers) {
      setStatus(
        "Published master maps are read-only. Create a draft copy to edit markers.",
      );
      return;
    }

    if (undoStack.length === 0) {
      setStatus("No position changes to undo.");
      return;
    }

    const latestById = new Map<
      string,
      { id: string; map_x: number | null; map_y: number | null }
    >();

    for (const snapshot of undoStack) {
      for (const item of snapshot) {
        if (!latestById.has(item.id)) {
          latestById.set(item.id, item);
        }
      }
    }

    const restoreItems = Array.from(latestById.values());

    for (const item of restoreItems) {
      const { error } = await supabase
        .from("master_map_sites")
        .update({
          map_x: item.map_x,
          map_y: item.map_y,
        })
        .eq("id", item.id);

      if (error) {
        setStatus(`Could not undo all position changes: ${error.message}`);
        return;
      }
    }

    setSites((prev) =>
      prev.map((site) => {
        const prior = latestById.get(site.id);
        return prior
          ? { ...site, map_x: prior.map_x, map_y: prior.map_y }
          : site;
      }),
    );

    if (primarySelectedSiteId) {
      const primary = latestById.get(primarySelectedSiteId);
      if (primary) {
        setEditX(primary.map_x);
        setEditY(primary.map_y);
      }
    }

    setStatus(
      `Undid all position changes for ${restoreItems.length} marker(s).`,
    );
    setUndoStack([]);
  }

  async function alignHorizontalSelected() {
    if (readOnlyMarkers) {
      setStatus(
        "Published master maps are read-only. Create a draft copy to edit markers.",
      );
      return;
    }

    if (selectedSites.length < 2) {
      setStatus("Select at least 2 markers to align horizontally.");
      return;
    }

    const validSites = selectedSites.filter(
      (s) => typeof s.map_x === "number" && typeof s.map_y === "number",
    );

    if (validSites.length < 2) {
      setStatus("Selected markers must have valid coordinates.");
      return;
    }

    const averageY =
      validSites.reduce((sum, site) => sum + Number(site.map_y), 0) /
      validSites.length;

    const updates = validSites.map((site) => ({
      id: site.id,
      map_x: Number(site.map_x),
      map_y: Number(averageY.toFixed(2)),
    }));

    const ok = await applyBulkPositions(updates);
    if (ok) {
      setStatus(`Aligned ${updates.length} markers horizontally.`);
    }
  }

  async function distributeHorizontallySelected() {
    if (readOnlyMarkers) {
      setStatus(
        "Published master maps are read-only. Create a draft copy to edit markers.",
      );
      return;
    }

    if (selectedSites.length < 3) {
      setStatus("Select at least 3 markers to distribute horizontally.");
      return;
    }

    const validSites = selectedSites
      .filter((s) => typeof s.map_x === "number" && typeof s.map_y === "number")
      .sort((a, b) => Number(a.map_x) - Number(b.map_x));

    if (validSites.length < 3) {
      setStatus("Selected markers must have valid coordinates.");
      return;
    }

    const first = validSites[0];
    const last = validSites[validSites.length - 1];
    const startX = Number(first.map_x);
    const endX = Number(last.map_x);
    const step = (endX - startX) / (validSites.length - 1);

    const updates = validSites.map((site, index) => ({
      id: site.id,
      map_x: Number((startX + step * index).toFixed(2)),
      map_y: Number(site.map_y),
    }));

    const ok = await applyBulkPositions(updates);
    if (ok) {
      setStatus(`Distributed ${updates.length} markers horizontally.`);
    }
  }

  async function alignVerticalSelected() {
    if (readOnlyMarkers) {
      setStatus(
        "Published master maps are read-only. Create a draft copy to edit markers.",
      );
      return;
    }

    if (selectedSites.length < 2) {
      setStatus("Select at least 2 markers to align vertically.");
      return;
    }

    const validSites = selectedSites.filter(
      (s) => typeof s.map_x === "number" && typeof s.map_y === "number",
    );

    if (validSites.length < 2) {
      setStatus("Selected markers must have valid coordinates.");
      return;
    }

    const averageX =
      validSites.reduce((sum, site) => sum + Number(site.map_x), 0) /
      validSites.length;

    const updates = validSites.map((site) => ({
      id: site.id,
      map_x: Number(averageX.toFixed(2)),
      map_y: Number(site.map_y),
    }));

    const ok = await applyBulkPositions(updates);
    if (ok) {
      setStatus(`Aligned ${updates.length} markers vertically.`);
    }
  }

  async function distributeVerticallySelected() {
    if (readOnlyMarkers) {
      setStatus(
        "Published master maps are read-only. Create a draft copy to edit markers.",
      );
      return;
    }

    if (selectedSites.length < 3) {
      setStatus("Select at least 3 markers to distribute vertically.");
      return;
    }

    const validSites = selectedSites
      .filter((s) => typeof s.map_x === "number" && typeof s.map_y === "number")
      .sort((a, b) => Number(a.map_y) - Number(b.map_y));

    if (validSites.length < 3) {
      setStatus("Selected markers must have valid coordinates.");
      return;
    }

    const first = validSites[0];
    const last = validSites[validSites.length - 1];
    const startY = Number(first.map_y);
    const endY = Number(last.map_y);
    const step = (endY - startY) / (validSites.length - 1);

    const updates = validSites.map((site, index) => ({
      id: site.id,
      map_x: Number(site.map_x),
      map_y: Number((startY + step * index).toFixed(2)),
    }));

    const ok = await applyBulkPositions(updates);
    if (ok) {
      setStatus(`Distributed ${updates.length} markers vertically.`);
    }
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (readOnlyMarkersRef.current) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();

      if (tag === "input" || tag === "textarea" || target?.isContentEditable)
        return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          void undoAllPositionChanges();
        } else {
          void undoLastPositionChange();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        void undoAllPositionChanges();
        return;
      }

      if (e.key === "Escape") {
        if (
          pendingPointRef.current.x !== null ||
          pendingPointRef.current.y !== null
        ) {
          e.preventDefault();
          setPendingX(null);
          setPendingY(null);
          setSiteNumber("");
          setStatus("Pending marker canceled.");
          focusMapCanvasNow();
          return;
        }
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (primarySelectedSiteIdRef.current) {
          e.preventDefault();
          void deleteSelectedMarker();
          return;
        }
      }

      const step = getNudgeStep(e);

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (primarySelectedSiteIdRef.current) {
          void nudgeSelected(-step, 0);
        } else {
          nudgePending(-step, 0);
        }
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (primarySelectedSiteIdRef.current) {
          void nudgeSelected(step, 0);
        } else {
          nudgePending(step, 0);
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (primarySelectedSiteIdRef.current) {
          void nudgeSelected(0, -step);
        } else {
          nudgePending(0, -step);
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (primarySelectedSiteIdRef.current) {
          void nudgeSelected(0, step);
        } else {
          nudgePending(0, step);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

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

    if (!confirmed) return;

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

    if (!confirmed) return;

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

      if (!normalizedSiteNumber) continue;

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
    if (!masterMap) return;

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
          <h1 style={{ marginTop: 0, marginBottom: 8 }}>Master Map Editor</h1>
          <div style={{ fontSize: 14, opacity: 0.8 }}>
            You do not have access to this page.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>Master Map Editor</h1>

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

      <div style={{ fontSize: 14, color: "#555", marginBottom: 12 }}>
        Editing: <strong>{masterMap?.name || "Loading..."}</strong>
      </div>

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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "340px minmax(0, 1fr)",
          gap: 24,
          alignItems: "start",
        }}
      >
        <div
          style={{
            position: "sticky",
            top: 16,
            display: "grid",
            gap: 12,
          }}
        >
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
              disabled={readOnlyMarkers || loading}
              style={{ padding: 8 }}
            />

            <div style={{ fontSize: 12, color: "#666" }}>
              Click to place a marker. Type the site number and press Enter to
              save. Shift-click to add/remove markers from selection.
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                disabled={readOnlyMarkers || loading}
                onClick={() => void saveNewMarker()}
                style={{ flex: 1 }}
              >
                Save New
              </button>
              <button
                disabled={readOnlyMarkers || loading}
                onClick={() => void saveAndNextMarker()}
                style={{ flex: 1 }}
              >
                Save + Next
              </button>
              <button
                disabled={readOnlyMarkers || loading}
                onClick={() => void updateSelectedMarker()}
                style={{ flex: 1 }}
              >
                Update
              </button>
            </div>

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
                  onClick={() => void alignHorizontalSelected()}
                  style={{ flex: 1 }}
                >
                  Align Horizontal
                </button>

                <button
                  disabled={
                    readOnlyMarkers || loading || selectedSiteIds.length < 3
                  }
                  onClick={() => void distributeHorizontallySelected()}
                  style={{ flex: 1 }}
                >
                  Distribute Horizontally
                </button>

                <button
                  disabled={
                    readOnlyMarkers || loading || selectedSiteIds.length < 2
                  }
                  onClick={() => void alignVerticalSelected()}
                  style={{ flex: 1 }}
                >
                  Align Vertical
                </button>

                <button
                  disabled={
                    readOnlyMarkers || loading || selectedSiteIds.length < 3
                  }
                  onClick={() => void distributeVerticallySelected()}
                  style={{ flex: 1 }}
                >
                  Distribute Vertically
                </button>
              </div>

              <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                <button
                  disabled={
                    readOnlyMarkers || loading || undoStack.length === 0
                  }
                  onClick={() => void undoLastPositionChange()}
                  style={{ width: "100%" }}
                >
                  Undo Last Move ({undoStack.length})
                </button>

                <button
                  disabled={
                    readOnlyMarkers || loading || undoStack.length === 0
                  }
                  onClick={() => void undoAllPositionChanges()}
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
                    setStatus("Selection cleared.");
                  }}
                  style={{ width: "100%" }}
                >
                  Clear Selection
                </button>
              </div>
            </div>

            <div
              style={{
                border: "1px solid #eee",
                borderRadius: 8,
                padding: 10,
                background: "#fafafa",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                Position + Zoom
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button
                  onClick={() =>
                    setZoom((z) => Math.max(0.5, Number((z - 0.1).toFixed(2))))
                  }
                  disabled={loading}
                >
                  -
                </button>
                <button onClick={() => setZoom(1)} disabled={loading}>
                  Reset
                </button>
                <button
                  onClick={() =>
                    setZoom((z) => Math.min(3, Number((z + 0.1).toFixed(2))))
                  }
                  disabled={loading}
                >
                  +
                </button>
                <div style={{ alignSelf: "center", fontSize: 13 }}>
                  Zoom: {Math.round(zoom * 100)}%
                </div>
              </div>

              <div style={{ fontSize: 12, marginBottom: 8 }}>
                X: {editX ?? primarySelectedSite?.map_x ?? pendingX ?? "—"} | Y:{" "}
                {editY ?? primarySelectedSite?.map_y ?? pendingY ?? "—"}
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
                  disabled={readOnlyMarkers || loading}
                  onClick={() =>
                    primarySelectedSiteId
                      ? void nudgeSelected(0, -0.05)
                      : nudgePending(0, -0.05)
                  }
                >
                  ↑
                </button>
                <div />
                <button
                  disabled={readOnlyMarkers || loading}
                  onClick={() =>
                    primarySelectedSiteId
                      ? void nudgeSelected(-0.05, 0)
                      : nudgePending(-0.05, 0)
                  }
                >
                  ←
                </button>
                <button
                  disabled={readOnlyMarkers || loading}
                  onClick={() => void saveSelectedPosition()}
                >
                  Save Pos
                </button>
                <button
                  disabled={readOnlyMarkers || loading}
                  onClick={() =>
                    primarySelectedSiteId
                      ? void nudgeSelected(0.05, 0)
                      : nudgePending(0.05, 0)
                  }
                >
                  →
                </button>
                <div />
                <button
                  disabled={readOnlyMarkers || loading}
                  onClick={() =>
                    primarySelectedSiteId
                      ? void nudgeSelected(0, 0.05)
                      : nudgePending(0, 0.05)
                  }
                >
                  ↓
                </button>
                <div />
              </div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                disabled={readOnlyMarkers || loading || !primarySelectedSiteId}
                onClick={() => void deleteSelectedMarker()}
                style={{ flex: 1 }}
              >
                Delete Selected Marker
              </button>
            </div>

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
              height: "78vh",
              overflow: "auto",
              border: "1px solid #ddd",
              background: "#f2f2f2",
            }}
          >
            <div
              ref={mapCanvasRef}
              tabIndex={0}
              style={{
                position: "relative",
                width: naturalSize.width * zoom,
                height: naturalSize.height * zoom,
                cursor: readOnlyMarkers ? "default" : "crosshair",
                userSelect: "none",
                WebkitUserSelect: "none",
                outline: "none",
              }}
            >
              {masterMap?.map_image_url && (
                <img
                  draggable={false}
                  src={masterMap.map_image_url}
                  alt="Master map"
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setNaturalSize({
                      width: img.naturalWidth || 1200,
                      height: img.naturalHeight || 800,
                    });
                  }}
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "block",
                    userSelect: "none",
                    pointerEvents: "none",
                  }}
                />
              )}
              {!readOnlyMarkers && (
                <div
                  onMouseDown={(e) => {
                    focusMapCanvasNow();
                    handleMapMouseDown(e as React.MouseEvent<HTMLDivElement>);
                  }}
                  onMouseMove={handleMapMouseMove}
                  onMouseUp={handleMapMouseUp}
                  onMouseLeave={handleMapMouseUp}
                  style={{
                    position: "absolute",
                    inset: 0,
                    zIndex: 1,
                    background: "transparent",
                  }}
                />
              )}

              {selectionBox && (
                <div
                  style={{
                    position: "absolute",
                    left: `${selectionBox.left}%`,
                    top: `${selectionBox.top}%`,
                    width: `${selectionBox.width}%`,
                    height: `${selectionBox.height}%`,
                    border: "2px dashed #0b5cff",
                    background: "rgba(11,92,255,0.14)",
                    pointerEvents: "none",
                  }}
                />
              )}

              {renderedSites.map((site) => {
                const isSelected = selectedSiteIds.includes(site.id);
                const isPrimary = site.id === primarySelectedSiteId;

                return (
                  <div
                    key={site.id}
                    style={{
                      position: "absolute",
                      left: `${site.map_x}%`,
                      top: `${site.map_y}%`,
                      transform: "translate(-50%, -50%)",
                      pointerEvents: "auto",
                      zIndex: 2,
                    }}
                  >
                    <button
                      type="button"
                      tabIndex={-1}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        ignoreCanvasClickUntilRef.current = Date.now() + 500;
                        suppressCanvasMouseUpUntilRef.current =
                          Date.now() + 500;
                        focusMapCanvasNow();
                        handleMarkerSelect(site, e);
                      }}
                      onMouseUp={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      title={site.site_number}
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        border: isPrimary
                          ? "2px solid white"
                          : isSelected
                            ? "2px solid #0b5cff"
                            : "1px solid rgba(255,255,255,0.85)",
                        background: isPrimary
                          ? "#f4b400"
                          : isSelected
                            ? "#60a5fa"
                            : "#1f9d55",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
                        cursor: "pointer",
                        padding: 0,
                        display: "block",
                        margin: "0 auto",
                        pointerEvents: "auto",
                      }}
                    />

                    {showLabels && (
                      <button
                        type="button"
                        tabIndex={-1}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          ignoreCanvasClickUntilRef.current = Date.now() + 500;
                          suppressCanvasMouseUpUntilRef.current =
                            Date.now() + 500;
                          focusMapCanvasNow();
                          handleMarkerSelect(site, e);
                        }}
                        onMouseUp={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        title={`Site ${site.site_number}`}
                        style={{
                          marginTop: 4,
                          marginLeft: "auto",
                          marginRight: "auto",
                          background: isPrimary
                            ? "rgba(255,255,255,0.98)"
                            : isSelected
                              ? "rgba(219,234,254,0.98)"
                              : "rgba(255,255,255,0.92)",
                          border: isSelected
                            ? "1px solid rgba(11,92,255,0.45)"
                            : "1px solid rgba(0,0,0,0.2)",
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "1px 5px",
                          color: "#111",
                          whiteSpace: "nowrap",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                          cursor: "pointer",
                          pointerEvents: "auto",
                          display: "table",
                        }}
                      >
                        {site.display_label || site.site_number}
                      </button>
                    )}
                  </div>
                );
              })}

              {pendingX !== null && pendingY !== null && (
                <div
                  style={{
                    position: "absolute",
                    left: `${pendingX}%`,
                    top: `${pendingY}%`,
                    transform: "translate(-50%, -50%)",
                    pointerEvents: "none",
                  }}
                >
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      background: "#f4b400",
                      border: "2px solid white",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
                      margin: "0 auto",
                    }}
                  />

                  {showLabels && siteNumber.trim() && (
                    <div
                      style={{
                        marginTop: 4,
                        marginLeft: "auto",
                        marginRight: "auto",
                        background: "rgba(255,255,255,0.96)",
                        border: "1px solid rgba(0,0,0,0.2)",
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "1px 5px",
                        color: "#111",
                        whiteSpace: "nowrap",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                        display: "table",
                      }}
                    >
                      {siteNumber.trim()}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MasterMapEditorPage() {
  return (
    <AdminRouteGuard>
      <MasterMapEditorPageInner />
    </AdminRouteGuard>
  );
}
