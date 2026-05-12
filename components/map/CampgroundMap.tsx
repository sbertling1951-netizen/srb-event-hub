"use client";

import React from "react";

type SiteMarker = {
  id: string;
  site_number: string | null;
  display_label: string | null;
  map_x: number | null;
  map_y: number | null;
  assigned_attendee_id?: string | null;
  popupText?: string | null;
};

type CampgroundMapProps = {
  mapRef?: React.RefObject<HTMLDivElement | null>;
  mapImageUrl: string;
  height?: number;
  sites?: SiteMarker[];
  pendingX?: number | null;
  pendingY?: number | null;
  onMapClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMarkerClick?: (site: SiteMarker) => void;
  selectedSiteId?: string | null;
  siteLabel?: string;
};

const MIN_SCALE = 0.35;
const MAX_SCALE = 4;
const TAP_MOVE_THRESHOLD = 8;
const DOUBLE_TAP_MS = 320;
const DEFAULT_MAP_WIDTH = 1800;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function markerColor(site: SiteMarker, isSelected: boolean) {
  if (isSelected) {
    return "#f4b400";
  }
  if (site.assigned_attendee_id) {
    return "#0a63ff";
  }
  return "#1f9d55";
}

function CampgroundMapInner({
  mapRef,
  mapImageUrl,
  height = 700,
  sites = [],
  pendingX = null,
  pendingY = null,
  onMapClick,
  onMarkerClick,
  selectedSiteId = null,
  siteLabel = "Site",
}: CampgroundMapProps) {
  const selectedSite = sites.find((s) => s.id === selectedSiteId) || null;

  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const transformRef = React.useRef({ tx: 0, ty: 0, scale: 1 });
  const [transform, setTransform] = React.useState({ tx: 0, ty: 0, scale: 1 });
  const [mapSize, setMapSize] = React.useState({
    width: DEFAULT_MAP_WIDTH,
    height,
  });
  const [hasFitInitialView, setHasFitInitialView] = React.useState(false);
  const [isPanning, setIsPanning] = React.useState(false);
  const didPanRef = React.useRef(false);
  const lastTapRef = React.useRef({ time: 0, x: 0, y: 0 });

  const mousePanRef = React.useRef({
    active: false,
    startX: 0,
    startY: 0,
    startTx: 0,
    startTy: 0,
  });

  const touchStateRef = React.useRef({
    active: false,
    startX: 0,
    startY: 0,
    startTx: 0,
    startTy: 0,
    pinchActive: false,
    pinchStartDistance: 0,
    pinchStartScale: 1,
    pinchStartTx: 0,
    pinchStartTy: 0,
    pinchMidpointX: 0,
    pinchMidpointY: 0,
  });

  function applyTransform(tx: number, ty: number, scale: number) {
    const nextTransform = { tx, ty, scale };
    transformRef.current = nextTransform;
    setTransform(nextTransform);
  }

  function clampPan(tx: number, ty: number, scale: number) {
    const viewport = viewportRef.current;
    if (!viewport) {
      return { tx, ty };
    }

    const viewportWidth = viewport.clientWidth;
    const viewportHeight = viewport.clientHeight;
    const scaledMapWidth = mapSize.width * scale;
    const scaledMapHeight = mapSize.height * scale;

    const minTx = Math.min(0, viewportWidth - scaledMapWidth);
    const minTy = Math.min(0, viewportHeight - scaledMapHeight);

    return {
      tx:
        scaledMapWidth < viewportWidth
          ? (viewportWidth - scaledMapWidth) / 2
          : clamp(tx, minTx, 0),
      ty:
        scaledMapHeight < viewportHeight
          ? (viewportHeight - scaledMapHeight) / 2
          : clamp(ty, minTy, 0),
    };
  }

  function getViewportPoint(clientX: number, clientY: number) {
    const viewport = viewportRef.current;
    if (!viewport) {
      return { x: clientX, y: clientY };
    }

    const rect = viewport.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  function getTouchDistance(touches: React.TouchList) {
    if (touches.length < 2) {
      return 0;
    }

    const dx = touches[1].clientX - touches[0].clientX;
    const dy = touches[1].clientY - touches[0].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function getTouchMidpoint(touches: React.TouchList) {
    if (touches.length < 2) {
      return { x: 0, y: 0 };
    }

    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    };
  }

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || hasFitInitialView) {
      return;
    }

    const fitScale = clamp(
      Math.min(
        viewport.clientWidth / mapSize.width,
        viewport.clientHeight / mapSize.height,
      ),
      MIN_SCALE,
      1,
    );

    const clamped = clampPan(0, 0, fitScale);
    applyTransform(clamped.tx, clamped.ty, fitScale);
    setHasFitInitialView(true);
  }, [hasFitInitialView, mapSize.height, mapSize.width]);

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const blockNativeScroll = (event: TouchEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("button")) {
        return;
      }
      event.preventDefault();
    };

    viewport.addEventListener("touchmove", blockNativeScroll, {
      passive: false,
    });

    return () => {
      viewport.removeEventListener("touchmove", blockNativeScroll);
    };
  }, []);

  function beginMousePan(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement | null;
    if (target?.closest("button")) {
      return;
    }

    e.preventDefault();
    didPanRef.current = false;
    mousePanRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startTx: transformRef.current.tx,
      startTy: transformRef.current.ty,
    };
    setIsPanning(true);
  }

  function moveMousePan(e: React.MouseEvent<HTMLDivElement>) {
    if (!mousePanRef.current.active) {
      return;
    }

    e.preventDefault();
    const dx = e.clientX - mousePanRef.current.startX;
    const dy = e.clientY - mousePanRef.current.startY;

    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      didPanRef.current = true;
    }

    const clamped = clampPan(
      mousePanRef.current.startTx + dx,
      mousePanRef.current.startTy + dy,
      transformRef.current.scale,
    );
    applyTransform(clamped.tx, clamped.ty, transformRef.current.scale);
  }

  function endMousePan() {
    mousePanRef.current.active = false;
    setIsPanning(false);
  }

  function beginTouchPan(e: React.TouchEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement | null;
    if (target?.closest("button")) {
      return;
    }

    e.preventDefault();

    if (e.touches.length === 2) {
      const midpoint = getTouchMidpoint(e.touches);
      const viewportMidpoint = getViewportPoint(midpoint.x, midpoint.y);

      touchStateRef.current = {
        ...touchStateRef.current,
        active: false,
        pinchActive: true,
        pinchStartDistance: getTouchDistance(e.touches),
        pinchStartScale: transformRef.current.scale,
        pinchStartTx: transformRef.current.tx,
        pinchStartTy: transformRef.current.ty,
        pinchMidpointX: viewportMidpoint.x,
        pinchMidpointY: viewportMidpoint.y,
      };
      didPanRef.current = true;
      setIsPanning(true);
      return;
    }

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      touchStateRef.current = {
        ...touchStateRef.current,
        active: true,
        startX: touch.clientX,
        startY: touch.clientY,
        startTx: transformRef.current.tx,
        startTy: transformRef.current.ty,
        pinchActive: false,
      };
      didPanRef.current = false;
      setIsPanning(true);
    }
  }

  function moveTouchPan(e: React.TouchEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement | null;
    if (target?.closest("button") && !touchStateRef.current.active) {
      return;
    }

    e.preventDefault();

    if (touchStateRef.current.pinchActive && e.touches.length === 2) {
      const distance = getTouchDistance(e.touches);
      if (!distance || !touchStateRef.current.pinchStartDistance) {
        return;
      }

      const nextScale = clamp(
        touchStateRef.current.pinchStartScale *
          (distance / touchStateRef.current.pinchStartDistance),
        MIN_SCALE,
        MAX_SCALE,
      );

      const scaleRatio = nextScale / touchStateRef.current.pinchStartScale;
      const nextTx =
        touchStateRef.current.pinchMidpointX -
        scaleRatio *
          (touchStateRef.current.pinchMidpointX -
            touchStateRef.current.pinchStartTx);
      const nextTy =
        touchStateRef.current.pinchMidpointY -
        scaleRatio *
          (touchStateRef.current.pinchMidpointY -
            touchStateRef.current.pinchStartTy);

      const clamped = clampPan(nextTx, nextTy, nextScale);
      applyTransform(clamped.tx, clamped.ty, nextScale);
      didPanRef.current = true;
      return;
    }

    if (!touchStateRef.current.active || e.touches.length !== 1) {
      return;
    }

    const touch = e.touches[0];
    const dx = touch.clientX - touchStateRef.current.startX;
    const dy = touch.clientY - touchStateRef.current.startY;

    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      didPanRef.current = true;
    }

    const clamped = clampPan(
      touchStateRef.current.startTx + dx,
      touchStateRef.current.startTy + dy,
      transformRef.current.scale,
    );
    applyTransform(clamped.tx, clamped.ty, transformRef.current.scale);
  }

  function endTouchPan() {
    touchStateRef.current.active = false;
    touchStateRef.current.pinchActive = false;
    setIsPanning(false);
  }

  function handleMapCanvasClick(e: React.MouseEvent<HTMLDivElement>) {
    if (didPanRef.current) {
      e.preventDefault();
      e.stopPropagation();
      didPanRef.current = false;
      return;
    }

    const now = Date.now();
    const previousTap = lastTapRef.current;
    const distanceFromLastTap = Math.sqrt(
      Math.pow(e.clientX - previousTap.x, 2) +
        Math.pow(e.clientY - previousTap.y, 2),
    );

    if (
      now - previousTap.time < DOUBLE_TAP_MS &&
      distanceFromLastTap < TAP_MOVE_THRESHOLD * 5
    ) {
      e.preventDefault();
      e.stopPropagation();
      lastTapRef.current = { time: 0, x: 0, y: 0 };

      const point = getViewportPoint(e.clientX, e.clientY);
      const { tx, ty, scale } = transformRef.current;
      const nextScale =
        scale > 1.5 ? 1 : clamp(scale * 2, MIN_SCALE, MAX_SCALE);
      const scaleRatio = nextScale / scale;
      const nextTx = point.x - scaleRatio * (point.x - tx);
      const nextTy = point.y - scaleRatio * (point.y - ty);
      const clamped = clampPan(nextTx, nextTy, nextScale);
      applyTransform(clamped.tx, clamped.ty, nextScale);
      return;
    }

    lastTapRef.current = { time: now, x: e.clientX, y: e.clientY };
    onMapClick?.(e);
  }

  return (
    <div
      ref={viewportRef}
      onMouseDown={beginMousePan}
      onMouseMove={moveMousePan}
      onMouseUp={endMousePan}
      onMouseLeave={endMousePan}
      onTouchStart={beginTouchPan}
      onTouchMove={moveTouchPan}
      onTouchEnd={endTouchPan}
      onTouchCancel={endTouchPan}
      style={{
        width: "100%",
        height,
        border: "1px solid #ccc",
        overflow: "hidden",
        marginBottom: 20,
        backgroundColor: "#f2f2f2",
        overscrollBehavior: "none",
        touchAction: "none",
        position: "relative",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
        cursor: isPanning ? "grabbing" : "grab",
        isolation: "isolate",
      }}
    >
      <div
        ref={mapRef}
        onClick={handleMapCanvasClick}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: mapSize.width,
          height: mapSize.height,
          transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`,
          transformOrigin: "0 0",
          transition: isPanning ? "none" : "transform 120ms ease-out",
          willChange: "transform",
          backgroundColor: "#f2f2f2",
          cursor: "inherit",
        }}
      >
        <img
          src={mapImageUrl}
          alt="Event map"
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (!img.naturalWidth || !img.naturalHeight) {
              return;
            }

            const nextWidth = Math.max(
              DEFAULT_MAP_WIDTH,
              Math.round((height * img.naturalWidth) / img.naturalHeight),
            );

            setMapSize({ width: nextWidth, height });
            setHasFitInitialView(false);
          }}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            pointerEvents: "none",
            userSelect: "none",
          }}
        />

        {sites.map((site) => {
          const isSelected = selectedSiteId === site.id;

          return (
            <button
              key={site.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMarkerClick?.(site);
              }}
              title={`${siteLabel} ${site.site_number || ""}`}
              style={{
                position: "absolute",
                left: `${site.map_x}%`,
                top: `${site.map_y}%`,
                transform: "translate(-50%, -50%)",
                width: 22,
                height: 22,
                minWidth: 22,
                minHeight: 22,
                padding: 0,
                borderRadius: "50%",
                background: markerColor(site, isSelected),
                border: isSelected
                  ? "3px solid white"
                  : "2px solid rgba(255,255,255,0.85)",
                boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
                zIndex: 2,
                cursor: "pointer",
                transition: "transform 0.12s ease, box-shadow 0.12s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform =
                  "translate(-50%, -50%) scale(1.7)";
                e.currentTarget.style.zIndex = "5";
                e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.45)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform =
                  "translate(-50%, -50%) scale(1)";
                e.currentTarget.style.zIndex = "2";
                e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.35)";
              }}
              onFocus={(e) => {
                e.currentTarget.style.transform =
                  "translate(-50%, -50%) scale(1.7)";
                e.currentTarget.style.zIndex = "5";
                e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.45)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.transform =
                  "translate(-50%, -50%) scale(1)";
                e.currentTarget.style.zIndex = "2";
                e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.35)";
              }}
            />
          );
        })}

        {pendingX !== null && pendingY !== null && (
          <div
            style={{
              position: "absolute",
              left: `${pendingX}%`,
              top: `${pendingY}%`,
              transform: "translate(-50%, -50%)",
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: "#f4b400",
              border: "2px solid white",
              boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
              zIndex: 3,
            }}
          />
        )}

        <div
          style={{
            position: "absolute",
            right: 12,
            bottom: 12,
            background: "rgba(255,255,255,0.92)",
            border: "1px solid #ddd",
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: 12,
            zIndex: 4,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Legend</div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "#1f9d55",
                display: "inline-block",
              }}
            />
            Empty
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "#0a63ff",
                display: "inline-block",
              }}
            />
            Occupied
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "#f4b400",
                display: "inline-block",
              }}
            />
            Selected / New
          </div>
        </div>
      </div>

      {selectedSite && (
        <div
          style={{
            position: "absolute",
            right: 12,
            bottom: 96,
            background: "white",
            border: "1px solid #ccc",
            borderRadius: 10,
            padding: "10px 12px",
            minWidth: 180,
            maxWidth: "min(280px, calc(100% - 24px))",
            boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
            zIndex: 10,
            pointerEvents: "auto",
          }}
        >
          <div style={{ fontWeight: 700 }}>
            {siteLabel} {selectedSite.site_number || "(no number)"}
          </div>

          {selectedSite.display_label &&
            selectedSite.display_label !== selectedSite.site_number && (
              <div style={{ fontSize: 13 }}>{selectedSite.display_label}</div>
            )}

          {selectedSite.popupText && (
            <div style={{ fontSize: 13, color: "#444" }}>
              {selectedSite.popupText}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default React.memo(CampgroundMapInner);
