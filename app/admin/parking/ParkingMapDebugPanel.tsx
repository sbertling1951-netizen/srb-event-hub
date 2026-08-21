"use client";

// Stage 2D diagnostic only. Instruments the ACTUAL live Parking map DOM
// in place, from outside -- zero changes to GestureMapViewportV2,
// MapCanvas, or MarkerLayer. Development-only: app/admin/parking/page.tsx
// only mounts this when process.env.NODE_ENV !== "production" AND the
// ?mapDebug=1 query param is present, so it is dead code (and its
// computation never runs) in a production build, matching this repo's
// own precedent for env-gated dev-only surfaces (app/dev/shell-preview's
// server-side NODE_ENV check) as closely as a purely client-side page
// (Parking itself is a normal, real production route) allows.
//
// Deliberately does NOT approximate Parking's chrome the way
// /dev/map-geometry-test does -- it reads the REAL, currently-rendered
// Parking DOM directly, because that diagnostic route already reads
// correctly on the same physical iPhone where the real Parking page does
// not, and the gap between "replica" and "the real thing" is exactly
// what remains unexplained.

import { useEffect, useRef, useState } from "react";

type ParkingSiteForDebug = {
  id: string | null;
  master_site_id: string;
  site_number: string;
  display_label: string | null;
  map_x: number | null;
  map_y: number | null;
};

function rectOf(el: Element | null | undefined) {
  if (!el) {
    return null;
  }
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, left: r.left };
}

function pick(cs: CSSStyleDeclaration, keys: string[]) {
  const out: Record<string, string> = {};
  for (const k of keys) {
    out[k] = cs.getPropertyValue(k);
  }
  return out;
}

/** Finds the real, currently-rendered map engine elements by the same
 * structural signatures used throughout Stage 2's diagnostics -- no
 * instrumentation added to the shared components themselves. Both
 * .map-engine-surface elements (Stage 2C's fix) are present: the OUTER
 * one is GestureMapViewportV2's own contentRef (identified by its
 * transform-origin: 0 0, unique to it); the INNER one is MapCanvas's own
 * wrapper div, nested directly inside it. */
function findLiveMapElements() {
  const allDivs = Array.from(document.querySelectorAll("div"));
  const viewportEl = allDivs.find((d) => {
    const cs = getComputedStyle(d);
    return cs.touchAction === "none" && cs.overflow === "hidden";
  });
  const surfaces = Array.from(document.querySelectorAll<HTMLElement>(".map-engine-surface"));
  const contentEl = surfaces.find(
    (d) => d.style.transformOrigin === "0px 0px" || d.style.transformOrigin === "0 0",
  );
  const mapCanvasWrapperEl = surfaces.find((d) => d !== contentEl) ?? null;
  const imgEl = document.querySelector<HTMLImageElement>("img") ?? null;

  return { viewportEl, contentEl, mapCanvasWrapperEl, imgEl };
}

function buildFullSnapshot(sampleSites: ParkingSiteForDebug[]) {
  const { viewportEl, contentEl, mapCanvasWrapperEl, imgEl } = findLiveMapElements();

  const viewportCs = viewportEl ? getComputedStyle(viewportEl) : null;
  const wrapperCs = mapCanvasWrapperEl ? getComputedStyle(mapCanvasWrapperEl) : null;
  const contentCs = contentEl ? getComputedStyle(contentEl) : null;
  const imgCs = imgEl ? getComputedStyle(imgEl) : null;

  const vv = window.visualViewport;

  const naturalWidth = imgEl?.naturalWidth || null;
  const naturalHeight = imgEl?.naturalHeight || null;

  let tx: number | null = null;
  let ty: number | null = null;
  let scaleX: number | null = null;
  let scaleY: number | null = null;
  if (contentEl) {
    const computedTransform = getComputedStyle(contentEl).transform;
    try {
      const m = new DOMMatrix(
        computedTransform && computedTransform !== "none" ? computedTransform : contentEl.style.transform,
      );
      tx = m.m41;
      ty = m.m42;
      scaleX = m.a;
      scaleY = m.d;
    } catch {
      /* leave null if unparsable */
    }
  }

  const viewportRect = rectOf(viewportEl);

  const markerRows = sampleSites.map((s) => {
    const markerId = s.id || s.master_site_id;
    const markerEl = document.querySelector<HTMLElement>(`[data-marker-id="${markerId}"]`);
    const mr = rectOf(markerEl);
    const xPct = Number(s.map_x ?? 0);
    const yPct = Number(s.map_y ?? 0);

    let sourcePixel: { x: number; y: number } | null = null;
    let expected: { x: number; y: number } | null = null;
    if (naturalWidth && naturalHeight) {
      sourcePixel = { x: (xPct / 100) * naturalWidth, y: (yPct / 100) * naturalHeight };
      if (viewportRect && tx !== null && ty !== null && scaleX !== null && scaleY !== null) {
        expected = {
          x: viewportRect.x + tx + sourcePixel.x * scaleX,
          y: viewportRect.y + ty + sourcePixel.y * scaleY,
        };
      }
    }

    const rendered = mr ? { x: mr.x + mr.width / 2, y: mr.y + mr.height / 2 } : null;

    return {
      siteNumber: s.site_number,
      markerId,
      xPct,
      yPct,
      sourcePixel,
      expected,
      rendered,
      errorX: expected && rendered ? rendered.x - expected.x : null,
      errorY: expected && rendered ? rendered.y - expected.y : null,
    };
  });

  return {
    capturedAt: new Date().toISOString(),
    browser: {
      windowInnerWidth: window.innerWidth,
      windowInnerHeight: window.innerHeight,
      documentClientWidth: document.documentElement.clientWidth,
      documentClientHeight: document.documentElement.clientHeight,
      devicePixelRatio: window.devicePixelRatio,
      visualViewport: vv
        ? { width: vv.width, height: vv.height, scale: vv.scale, offsetLeft: vv.offsetLeft, offsetTop: vv.offsetTop }
        : null,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      orientation:
        (screen as any).orientation?.type ??
        (window.innerWidth > window.innerHeight ? "landscape (inferred)" : "portrait (inferred)"),
    },
    outerViewport: viewportEl
      ? {
          found: true,
          rect: viewportRect,
          computed: viewportCs ? pick(viewportCs, ["width", "height", "overflow", "position"]) : null,
          scrollTop: viewportEl.scrollTop,
          scrollLeft: viewportEl.scrollLeft,
        }
      : { found: false },
    mapCanvasWrapper: mapCanvasWrapperEl
      ? {
          found: true,
          rect: rectOf(mapCanvasWrapperEl),
          inlineWidth: mapCanvasWrapperEl.style.width || null,
          inlineHeight: mapCanvasWrapperEl.style.height || null,
          computed: wrapperCs
            ? pick(wrapperCs, [
                "width",
                "height",
                "max-width",
                "min-width",
                "position",
                "overflow",
                "flex-grow",
                "flex-shrink",
                "flex-basis",
              ])
            : null,
        }
      : { found: false },
    contentRef: contentEl
      ? {
          found: true,
          rect: rectOf(contentEl),
          inlineWidth: contentEl.style.width || null,
          inlineHeight: contentEl.style.height || null,
          computed: contentCs
            ? pick(contentCs, [
                "width",
                "height",
                "max-width",
                "transform",
                "transform-origin",
                "position",
                "contain",
              ])
            : null,
          decomposedTransform: { tx, ty, scaleX, scaleY },
        }
      : { found: false },
    image: imgEl
      ? {
          found: true,
          naturalWidth,
          naturalHeight,
          widthAttribute: imgEl.getAttribute("width"),
          heightAttribute: imgEl.getAttribute("height"),
          rect: rectOf(imgEl),
          computed: imgCs
            ? pick(imgCs, ["width", "height", "object-fit", "max-width", "display"])
            : null,
        }
      : { found: false },
    markerLayer: {
      note:
        "MarkerLayer has no single distinct wrapping element in the current DOM -- each marker's own [data-marker-id] div is a direct sibling of <img> inside the MapCanvas wrapper captured above, which is therefore also the marker layer's containing block.",
      containingBlockRect: rectOf(mapCanvasWrapperEl),
    },
    sampleMarkers: markerRows,
  };
}

function pickSampleSites(sites: ParkingSiteForDebug[]): ParkingSiteForDebug[] {
  const withY = sites
    .filter((s) => s.map_x !== null && s.map_y !== null)
    .sort((a, b) => (a.map_y ?? 0) - (b.map_y ?? 0));
  if (withY.length === 0) {
    return [];
  }
  const positions = [0, 0.5, 1].map((f) => Math.min(withY.length - 1, Math.round(f * (withY.length - 1))));
  const seen = new Set<number>();
  const picked: ParkingSiteForDebug[] = [];
  for (const p of positions) {
    if (!seen.has(p)) {
      seen.add(p);
      picked.push(withY[p]!);
    }
  }
  return picked;
}

const OUTLINE_COLORS = {
  viewport: "4px solid red",
  mapCanvasWrapper: "4px solid orange",
  contentRef: "4px solid #0b5cff",
  image: "4px dashed magenta",
  marker: "3px solid lime",
};

export function ParkingMapDebugPanel({ sites }: { sites: ParkingSiteForDebug[] }) {
  const [snapshot, setSnapshot] = useState<ReturnType<typeof buildFullSnapshot> | null>(null);
  const [outlinesOn, setOutlinesOn] = useState(true);
  const appliedOutlinesRef = useRef<{ el: HTMLElement; prevOutline: string }[]>([]);

  const sampleSites = pickSampleSites(sites);

  function clearOutlines() {
    for (const { el, prevOutline } of appliedOutlinesRef.current) {
      el.style.outline = prevOutline;
    }
    appliedOutlinesRef.current = [];
  }

  function applyOutlines() {
    clearOutlines();
    const { viewportEl, contentEl, mapCanvasWrapperEl, imgEl } = findLiveMapElements();
    const apply = (el: HTMLElement | null | undefined, outline: string) => {
      if (!el) {
        return;
      }
      appliedOutlinesRef.current.push({ el, prevOutline: el.style.outline });
      el.style.outline = outline;
    };
    apply(viewportEl, OUTLINE_COLORS.viewport);
    apply(mapCanvasWrapperEl, OUTLINE_COLORS.mapCanvasWrapper);
    apply(contentEl, OUTLINE_COLORS.contentRef);
    apply(imgEl, OUTLINE_COLORS.image);
    for (const s of sampleSites) {
      const markerId = s.id || s.master_site_id;
      const markerEl = document.querySelector<HTMLElement>(`[data-marker-id="${markerId}"]`);
      apply(markerEl, OUTLINE_COLORS.marker);
    }
  }

  function recompute() {
    const next = buildFullSnapshot(sampleSites);
    setSnapshot(next);
    (window as any).__parkingMapDebugSnapshot = next;
    if (outlinesOn) {
      applyOutlines();
    }
  }

  useEffect(() => {
    if (outlinesOn) {
      applyOutlines();
    } else {
      clearOutlines();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlinesOn]);

  useEffect(() => {
    return () => clearOutlines();
  }, []);

  useEffect(() => {
    // Give the map's own image/layout a moment to settle after the sites
    // list first becomes available, matching Stage 2B's lesson that a
    // fixed short delay can catch a transient placeholder-dimension
    // layout pass rather than the real, final one.
    const t = window.setTimeout(recompute, 800);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites.length]);

  return (
    <div
      style={{
        marginTop: "var(--space-4)",
        border: "3px solid #ef4444",
        borderRadius: 8,
        padding: 12,
        fontFamily: "monospace",
        fontSize: 11,
        background: "#fff",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 8 }}>
        Stage 2D map geometry debug (?mapDebug=1, dev-only)
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" onClick={recompute} style={{ fontWeight: 700 }}>
          Capture / Recompute
        </button>
        <label>
          <input
            type="checkbox"
            checked={outlinesOn}
            onChange={(e) => setOutlinesOn(e.target.checked)}
          />{" "}
          Show geometry outlines
        </label>
      </div>
      <div style={{ marginBottom: 8 }}>
        outlines: viewport=red, MapCanvas wrapper=orange, contentRef=blue,
        image=magenta dashed, sample markers=lime
      </div>
      {snapshot && (
        <>
          <table style={{ borderCollapse: "collapse", marginBottom: 8, width: "100%" }}>
            <thead>
              <tr>
                {["site", "x%", "y%", "expected x,y", "rendered x,y", "err x", "err y"].map((h) => (
                  <th key={h} style={{ border: "1px solid #ccc", padding: 3, textAlign: "left" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshot.sampleMarkers.map((r) => (
                <tr key={r.markerId}>
                  <td style={{ border: "1px solid #ccc", padding: 3 }}>{r.siteNumber}</td>
                  <td style={{ border: "1px solid #ccc", padding: 3 }}>{r.xPct.toFixed(2)}</td>
                  <td style={{ border: "1px solid #ccc", padding: 3 }}>{r.yPct.toFixed(2)}</td>
                  <td style={{ border: "1px solid #ccc", padding: 3 }}>
                    {r.expected ? `${r.expected.x.toFixed(1)}, ${r.expected.y.toFixed(1)}` : "-"}
                  </td>
                  <td style={{ border: "1px solid #ccc", padding: 3 }}>
                    {r.rendered ? `${r.rendered.x.toFixed(1)}, ${r.rendered.y.toFixed(1)}` : "-"}
                  </td>
                  <td style={{ border: "1px solid #ccc", padding: 3, fontWeight: 700 }}>
                    {r.errorX !== null ? r.errorX.toFixed(1) : "-"}
                  </td>
                  <td style={{ border: "1px solid #ccc", padding: 3, fontWeight: 700 }}>
                    {r.errorY !== null ? r.errorY.toFixed(1) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <pre style={{ whiteSpace: "pre-wrap", maxHeight: 400, overflow: "auto" }}>
            {JSON.stringify(snapshot, null, 2)}
          </pre>
        </>
      )}
    </div>
  );
}
