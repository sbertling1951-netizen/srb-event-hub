// components/map/canvas/MapCanvas.tsx
//
// The platform map engine. Composes the proven GestureMapViewportV2 (pan / zoom
// / pinch) and adds, in ONE place, the concerns every page used to reimplement:
// coordinate translation, marker rendering, selection, alignment/distribution,
// undo, and the touch-first authoring interaction layer.
//
// Pages provide percentages and callbacks only. See README.md for the two small
// GestureMapViewportV2 additions this relies on (getViewportTransform +
// setGestureLocked) and current integration status.

"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import GestureMapViewportV2, {
  type GestureMapViewportHandle,
} from "../GestureMapViewportV2";
import { alignMarkers, distributeMarkers, nudgeMarkers } from "./alignment";
import {
  contentToPercent,
  normalizeRectPct,
  percentToContent,
  type Size,
  viewportToState,
} from "./coords";
import { MarkerLayer } from "./MarkerLayer";
import type {
  MapCanvasHandle,
  MapCanvasProps,
  MarkerPositionUpdate,
  ViewTransform,
} from "./types";
import { useMapInteraction } from "./useMapInteraction";
import { useSelection } from "./useSelection";
import { useUndoStack } from "./useUndoStack";

// GestureMapViewportV2 additions required for the authoring layer (see README).
type V2Handle = GestureMapViewportHandle & {
  getViewportTransform?: () => { scale: number; x: number; y: number };
  setViewportTransform?: (x: number, y: number, scale: number) => void;
  setGestureLocked?: (locked: boolean) => void;
};

const LOCK_CLASS = "mapcanvas-lock"; // generalized coach-map-lock (see README)

const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(
  function MapCanvas(
    {
      imageUrl,
      markers = [],
      naturalWidth,
      naturalHeight,
      editable = false,
      selectionMode = "none",
      showLabels = true,
      pendingMarker = null,
      selectedIds,
      primaryId,
      viewportHeight = "100%",
      initialScale,
      minScale = 0.1,
      maxScale = 3,
      lockPageScroll = false,
      onMapTap,
      onMarkerTap,
      onSelectionChange,
      onMarkersChange,
      onViewportChange,
      renderMarker,
      children,
    },
    ref,
  ) {
    const viewportRef = useRef<V2Handle | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const appliedScaleRef = useRef(false);

    const [measuredNatural, setMeasuredNatural] = useState<Size>({
      width: naturalWidth || 1200,
      height: naturalHeight || 800,
    });

    const [imgReady, setImgReady] = useState(false);

    const natural: Size = {
      width: naturalWidth || measuredNatural.width,
      height: naturalHeight || measuredNatural.height,
    };

    const seedScale = initialScale ?? 0.6;

    const [marquee, setMarquee] = useState<{
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
    } | null>(null);

    // ---- selection + undo ----------------------------------------------------
    const {
      selection,
      selectedSet,
      selectSingle,
      toggle,
      setMany,
      clear,
      selectInRect,
      getSelection,
    } = useSelection({
      markers,
      controlledIds: selectedIds,
      controlledPrimary: primaryId,
      onSelectionChange,
    });

    const undo = useUndoStack();

    // Guard: suppress marker activate that fires as a click immediately after
    // a rectangle-drag marquee completes.
    const suppressActivateRef = useRef(false);

    // current positions for the given ids, for an undo snapshot
    const snapshotFor = useCallback(
      (ids: string[]): MarkerPositionUpdate[] => {
        const set = new Set(ids);
        return markers
          .filter((m) => set.has(m.id))
          .map((m) => ({ id: m.id, xPct: m.xPct, yPct: m.yPct }));
      },
      [markers],
    );

    const applyWithUndo = useCallback(
      (updates: MarkerPositionUpdate[]) => {
        if (updates.length === 0) {
          return;
        }
        undo.capture(snapshotFor(updates.map((u) => u.id)));
        onMarkersChange?.(updates);
      },
      [onMarkersChange, snapshotFor, undo],
    );

    // ---- transform access + viewport lock (V2 seam) --------------------------
    const getTransform = useCallback((): ViewTransform => {
      const t = viewportRef.current?.getViewportTransform?.();
      if (t) {
        return { scale: t.scale, panX: t.x, panY: t.y };
      }
      // Fallback until V2 exposes its transform; centered-fit-ish default.
      return { scale: seedScale, panX: 0, panY: 0 };
    }, [seedScale]);

    const viewportPixelSize = useCallback((): Size => {
      const el = rootRef.current;
      return { width: el?.clientWidth || 0, height: el?.clientHeight || 0 };
    }, []);

    // ---- authoring interaction (marquee / lasso) -----------------------------
    useMapInteraction({
      viewportRef: rootRef,
      getTransform,
      natural,
      selectionMode,
      enabled: selectionMode === "multi" || selectionMode === "rectangle",
      onMarqueeStart: (p) => setMarquee(normalizeRectPct(p, p)),
      onMarqueeUpdate: (a, b) => setMarquee(normalizeRectPct(a, b)),
      onMarqueeEnd: (a, b) => {
        suppressActivateRef.current = true;

        selectInRect(a, b);

        setMarquee(null);

        setTimeout(() => {
          suppressActivateRef.current = false;
        }, 500);
      },
      lockViewport: () => viewportRef.current?.setGestureLocked?.(true),
      unlockViewport: () => viewportRef.current?.setGestureLocked?.(false),
    });

    // ---- marker tap ----------------------------------------------------------
    const onMarkerActivate = useCallback(
      (id: string, additive: boolean) => {
        if (suppressActivateRef.current) {
          return;
        }

        if (selectionMode === "multi" || additive) {
          toggle(id);
        } else if (selectionMode !== "none") {
          selectSingle(id);
        }

        onMarkerTap?.(id);
      },
      [selectionMode, toggle, selectSingle, onMarkerTap],
    );

    // ---- empty-map tap (placement) routed through V2's tap path --------------
    const handleViewportTap = useCallback(
      (args: {
        screenX: number;
        screenY: number;
        mapX: number;
        mapY: number;
      }) => {
        const { xPct, yPct } = contentToPercent(args.mapX, args.mapY, natural);
        if (editable) {
          onMapTap?.({ xPct, yPct });
        }
      },
      [editable, natural, onMapTap],
    );

    // ---- page scroll lock (generalized coach-map-lock) -----------------------
    useEffect(() => {
      if (!lockPageScroll) {
        return;
      }
      document.body.classList.add(LOCK_CLASS);
      document.documentElement.classList.add(LOCK_CLASS);
      return () => {
        document.body.classList.remove(LOCK_CLASS);
        document.documentElement.classList.remove(LOCK_CLASS);
      };
    }, [lockPageScroll]);

    // ---- imperative handle ---------------------------------------------------
    useImperativeHandle(
      ref,
      (): MapCanvasHandle => ({
        zoomIn: () => viewportRef.current?.zoomIn(),
        zoomOut: () => viewportRef.current?.zoomOut(),
        reset: () => viewportRef.current?.reset(),

        getViewportTransform: () =>
          viewportRef.current?.getViewportTransform?.(),

        setViewportTransform: (x: number, y: number, scale: number) =>
          viewportRef.current?.setViewportTransform?.(x, y, scale),

        centerOnPercent: (xPct, yPct, scale) => {
          const { cx, cy } = percentToContent(xPct, yPct, natural);
          viewportRef.current?.centerOn(cx, cy, scale);
        },
        centerOnMarker: (id, scale) => {
          const m = markers.find((mm) => mm.id === id);
          if (!m) {
            return;
          }
          const { cx, cy } = percentToContent(m.xPct, m.yPct, natural);
          viewportRef.current?.centerOn(cx, cy, scale);
        },
        getViewport: () =>
          viewportToState(getTransform(), viewportPixelSize(), natural),

        getSelection: () => getSelection(),
        setSelection: (ids, p) => setMany(ids, p),
        clearSelection: () => clear(),

        alignSelected: (axis) =>
          applyWithUndo(
            alignMarkers(markers, getSelection().selectedIds, axis),
          ),
        distributeSelected: (axis) =>
          applyWithUndo(
            distributeMarkers(markers, getSelection().selectedIds, axis),
          ),
        nudgeSelected: (dxPct, dyPct) =>
          applyWithUndo(
            nudgeMarkers(markers, getSelection().selectedIds, dxPct, dyPct),
          ),

        undo: () => {
          const snap = undo.popLast();
          if (snap) {
            onMarkersChange?.(snap);
          }
        },
        undoAll: () => {
          const snap = undo.popAll();
          if (snap) {
            onMarkersChange?.(snap);
          }
        },
        undoDepth: () => undo.depth,
      }),
      [
        markers,
        natural,
        getTransform,
        viewportPixelSize,
        getSelection,
        setMany,
        clear,
        applyWithUndo,
        undo,
        onMarkersChange,
      ],
    );

    // ---- honor an explicitly-configured opening scale ------------------------

    useEffect(() => {
      appliedScaleRef.current = false;
      setImgReady(false);

      if (!imageUrl) {
        return;
      }

      const probe = new Image();

      const onReady = () => {
        if (!naturalWidth || !naturalHeight) {
          setMeasuredNatural({
            width: probe.naturalWidth || 1200,
            height: probe.naturalHeight || 800,
          });
        }

        setImgReady(true);
      };

      probe.onload = onReady;

      probe.onerror = () => {
        setImgReady(true);
      };

      probe.src = imageUrl;

      if (probe.complete && probe.naturalWidth > 0) {
        onReady();
      }

      return () => {
        probe.onload = null;
        probe.onerror = null;
      };
    }, [imageUrl, naturalWidth, naturalHeight]);

    useEffect(() => {
      if (initialScale == null || appliedScaleRef.current) {
        return;
      }

      const dimsReady = (!!naturalWidth && !!naturalHeight) || imgReady;

      if (!dimsReady) {
        return;
      }

      const w = natural.width;
      const h = natural.height;

      if (!w || !h) {
        return;
      }

      const target = Math.min(maxScale, Math.max(minScale, initialScale));

      viewportRef.current?.centerOn(w / 2, h / 2, target);

      appliedScaleRef.current = true;
    }, [
      initialScale,
      naturalWidth,
      naturalHeight,
      imgReady,
      natural.width,
      natural.height,
      minScale,
      maxScale,
    ]);

    // ---- viewport-change reporting (best effort) -----------------------------
    useEffect(() => {
      if (!onViewportChange) {
        return;
      }
      onViewportChange(
        viewportToState(getTransform(), viewportPixelSize(), natural),
      );
    }, [onViewportChange, getTransform, viewportPixelSize, natural]);

    const pendingLabel = useMemo(() => undefined, []); // page supplies via children if desired

    return (
      <div
        ref={rootRef}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          minHeight: 0,
        }}
      >
        <GestureMapViewportV2
          ref={viewportRef}
          width={natural.width}
          height={natural.height}
          viewportHeight={viewportHeight}
          initialScale={initialScale}
          minScale={minScale}
          maxScale={maxScale}
          onTap={handleViewportTap}
        >
          <div
            style={{
              position: "relative",
              width: natural.width,
              height: natural.height,
            }}
          >
            {imageUrl && (
              <img
                src={imageUrl}
                alt="Map"
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget;

                  if (!naturalWidth || !naturalHeight) {
                    setMeasuredNatural({
                      width: img.naturalWidth || 1200,
                      height: img.naturalHeight || 800,
                    });
                  }

                  setImgReady(true);
                }}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: natural.width,
                  height: natural.height,
                  display: "block",
                  objectFit: "fill",
                  userSelect: "none",
                  pointerEvents: "none",
                  touchAction: "none",
                }}
              />
            )}

            {/* marquee rectangle in percent (content) space */}
            {marquee && (
              <div
                style={{
                  position: "absolute",
                  left: `${marquee.minX}%`,
                  top: `${marquee.minY}%`,
                  width: `${marquee.maxX - marquee.minX}%`,
                  height: `${marquee.maxY - marquee.minY}%`,
                  border: "2px dashed #0b5cff",
                  background: "rgba(11,92,255,0.14)",
                  pointerEvents: "none",
                  zIndex: 6,
                }}
              />
            )}

            <MarkerLayer
              markers={markers}
              selectedSet={selectedSet}
              primaryId={selection.primaryId}
              showLabels={showLabels}
              pendingMarker={pendingMarker}
              pendingLabel={pendingLabel}
              onMarkerActivate={onMarkerActivate}
              renderMarker={renderMarker}
            />

            {/* page-supplied overlay layers (e.g. amenity locations) */}
            {children}
          </div>
        </GestureMapViewportV2>
      </div>
    );
  },
);

export default MapCanvas;
