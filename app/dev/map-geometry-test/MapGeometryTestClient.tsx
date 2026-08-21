"use client";

// Stage 2 diagnostic harness only (production-gated by page.tsx).
// Replicates, without any auth/data dependency, the exact canonical map
// engine (components/map/canvas) and the exact isNarrow-driven card
// height wrapper Parking's page.tsx uses after its Stage 1 layout fix
// (height: isNarrow ? "60vh" : "78vh" on a flex-column card, MapCanvas
// viewportHeight="100%"), so real rendered geometry can be measured
// across orientation/viewport changes without needing an authenticated
// session or real event data. Exposes the raw numbers via
// window.__mapGeometrySnapshot() on demand for Playwright/manual
// instrumentation. Not linked from any nav.

import { useEffect, useRef, useState } from "react";

import { MapCanvas, type MapCanvasHandle } from "@/components/map/canvas";
import type { MapMarker } from "@/components/map/canvas/types";

const SHELL_BREAKPOINT_COMPACT = 900;

const MARKERS: MapMarker[] = [
  { id: "site-a1", xPct: 30, yPct: 40, label: "A1" },
  { id: "site-b2", xPct: 70, yPct: 65, label: "B2" },
];

function renderMarker(m: MapMarker) {
  return (
    <div
      data-geometry-role="marker-visual"
      style={{
        width: 20,
        height: 20,
        borderRadius: "50%",
        background: "#0b5cff",
        border: "2px solid white",
      }}
      title={m.label}
    />
  );
}

export function MapGeometryTestClient() {
  const [isNarrow, setIsNarrow] = useState(false);
  // A plain ref, exactly matching how every real consumer (e.g. Parking's
  // mapViewportRef) holds the MapCanvas handle -- deliberately NOT
  // useState, since re-rendering on every ref-callback invocation is what
  // was actually causing this harness's own infinite-update-depth crash.
  const mapRef = useRef<MapCanvasHandle | null>(null);

  useEffect(() => {
    const update = () => setIsNarrow(window.innerWidth < SHELL_BREAKPOINT_COMPACT);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    (window as any).__mapGeometrySnapshot = () => {
      // Structural selectors matching GestureMapViewportV2's own inline
      // styles exactly (no instrumentation added to the shared component
      // itself) -- the same approach used for Stage 1's real-engine
      // reproduction: the outer viewport is the element with computed
      // touch-action:none AND overflow:hidden; the transformed content
      // layer is the one with transform-origin "0px 0px".
      const allDivs = Array.from(document.querySelectorAll("div"));
      const viewportEl = allDivs.find((d) => {
        const cs = getComputedStyle(d);
        return cs.touchAction === "none" && cs.overflow === "hidden";
      }) as HTMLElement | undefined;
      const contentEl = allDivs.find(
        (d) => d.style.transformOrigin === "0px 0px" || d.style.transformOrigin === "0 0",
      ) as HTMLElement | undefined;
      const imgEl = document.querySelector<HTMLImageElement>("img");
      const markerEl = document.querySelector<HTMLElement>(
        '[data-marker-id="site-a1"]',
      );

      const viewportRect = viewportEl?.getBoundingClientRect() ?? null;
      const contentRect = contentEl?.getBoundingClientRect() ?? null;
      const imgRect = imgEl?.getBoundingClientRect() ?? null;
      const markerRect = markerEl?.getBoundingClientRect() ?? null;
      const transform = contentEl?.style.transform ?? null;

      const vv = (window as any).visualViewport;

      return {
        isNarrow,
        windowInnerWidth: window.innerWidth,
        windowInnerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        visualViewport: vv
          ? { width: vv.width, height: vv.height, scale: vv.scale, offsetLeft: vv.offsetLeft, offsetTop: vv.offsetTop }
          : null,
        viewportRect: viewportRect
          ? { x: viewportRect.x, y: viewportRect.y, width: viewportRect.width, height: viewportRect.height }
          : null,
        contentTransform: transform,
        contentRect: contentRect
          ? { x: contentRect.x, y: contentRect.y, width: contentRect.width, height: contentRect.height }
          : null,
        imgRect: imgRect
          ? { x: imgRect.x, y: imgRect.y, width: imgRect.width, height: imgRect.height }
          : null,
        imgNaturalWidth: imgEl?.naturalWidth ?? null,
        imgNaturalHeight: imgEl?.naturalHeight ?? null,
        markerStoredPercent: { xPct: 30, yPct: 40 },
        markerRect: markerRect
          ? { x: markerRect.x, y: markerRect.y, width: markerRect.width, height: markerRect.height }
          : null,
        // Expected screen position of the stored marker percentage,
        // computed independently from the raw transform + natural size,
        // for direct comparison against markerRect above.
        expectedMarkerScreen:
          contentRect && imgEl?.naturalWidth && imgEl?.naturalHeight
            ? (() => {
                const m = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px,.*scale3d\(([-\d.]+),/.exec(
                  transform || "",
                );
                if (!m || !viewportRect) {
                  return null;
                }
                const tx = parseFloat(m[1]);
                const ty = parseFloat(m[2]);
                const scale = parseFloat(m[3]);
                const cx = (30 / 100) * imgEl.naturalWidth;
                const cy = (40 / 100) * imgEl.naturalHeight;
                return {
                  x: viewportRect.x + tx + cx * scale,
                  y: viewportRect.y + ty + cy * scale,
                };
              })()
            : null,
      };
    };
  }, [isNarrow]);

  return (
    <div style={{ padding: 16, fontFamily: "monospace", fontSize: 12 }}>
      <div>isNarrow: {String(isNarrow)}</div>
      <div
        data-geometry-role="card"
        style={{
          border: "1px solid #ddd",
          display: "flex",
          flexDirection: "column",
          height: isNarrow ? "60vh" : "78vh",
          minHeight: 0,
          marginTop: 8,
        }}
      >
        <div style={{ position: "relative", flex: "1 1 auto", minHeight: 0 }}>
          <MapCanvas
            ref={mapRef}
            imageUrl="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='2000' height='1200'%3E%3Crect width='2000' height='1200' fill='%23e5e7eb'/%3E%3Cline x1='0' y1='600' x2='2000' y2='600' stroke='%23999' stroke-width='4'/%3E%3Cline x1='1000' y1='0' x2='1000' y2='1200' stroke='%23999' stroke-width='4'/%3E%3C/svg%3E"
            markers={MARKERS}
            viewportHeight="100%"
            initialScale={0.5}
            minScale={0.1}
            maxScale={3}
            selectionMode="none"
            showLabels
            renderMarker={renderMarker}
          />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="button" onClick={() => mapRef.current?.zoomIn()}>+</button>
          <button type="button" onClick={() => mapRef.current?.zoomOut()}>-</button>
          <button type="button" onClick={() => mapRef.current?.reset()}>Reset</button>
        </div>
      </div>
    </div>
  );
}
