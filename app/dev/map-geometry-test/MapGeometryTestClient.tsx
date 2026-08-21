"use client";

// Stage 2B diagnostic harness only (production-gated by page.tsx).
// Two modes:
//
// - No ?mapId=: the original Stage 2 synthetic-image harness, replicating
//   the canonical map engine (components/map/canvas) and Parking's exact
//   isNarrow-driven card-height wrapper, unchanged from Stage 2.
// - ?mapId=<master_map id>: loads the REAL map image and REAL
//   master_map_sites rows for that map (anon SELECT already granted on
//   both tables -- see 20260819150000_harden_master_map_anon_grants.sql
//   -- the same read app/coach-map/public/page.tsx already performs
//   unauthenticated), renders them through the same real engine, and
//   shows a live, on-screen error-function readout for five sites spread
//   across the map's Y range (upper/upper-mid/center/lower-mid/lower):
//   stored percent, expected pixel position (independently computed from
//   the live transform + natural image size), actual rendered marker
//   center, and the X/Y error between them. This is the exact
//   measurement Stage 2B's diagnosis needs, computed live so it can be
//   read directly off a physical iPhone's screen (no devtools required),
//   and also exposed via window.__mapGeometrySnapshot() for Playwright.
//
// Not linked from any nav.

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { MapCanvas, type MapCanvasHandle } from "@/components/map/canvas";
import type { MapMarker } from "@/components/map/canvas/types";
import { supabase } from "@/lib/supabase";

const SHELL_BREAKPOINT_COMPACT = 900;

const SYNTHETIC_MARKERS: MapMarker[] = [
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

type MasterMapRow = { id: string; name: string; park_name: string | null; map_image_url: string | null };
type MasterMapSiteRow = { id: string; site_number: string; display_label: string | null; map_x: number | null; map_y: number | null };

export function pickSampleSites(sites: MasterMapSiteRow[]): MasterMapSiteRow[] {
  const withY = sites.filter((s) => s.map_y !== null).sort((a, b) => (a.map_y ?? 0) - (b.map_y ?? 0));
  if (withY.length === 0) {
    return [];
  }
  const positions = [0, 0.25, 0.5, 0.75, 1].map((f) =>
    Math.min(withY.length - 1, Math.round(f * (withY.length - 1))),
  );
  const seen = new Set<number>();
  const picked: MasterMapSiteRow[] = [];
  for (const p of positions) {
    if (!seen.has(p)) {
      seen.add(p);
      picked.push(withY[p]);
    }
  }
  return picked;
}

/** Reads the transformed content layer's LIVE computed matrix (not the
 * inline style string) so a Safari-applied difference between what was
 * SET and what actually renders would be visible here too. Falls back to
 * parsing the inline transform if computed style is unavailable. */
function readContentTransform(contentEl: HTMLElement | undefined): { tx: number; ty: number; scaleX: number; scaleY: number } | null {
  if (!contentEl) {
    return null;
  }
  const computed = getComputedStyle(contentEl).transform;
  if (computed && computed !== "none") {
    try {
      const m = new DOMMatrix(computed);
      return { tx: m.m41, ty: m.m42, scaleX: m.a, scaleY: m.d };
    } catch {
      /* fall through to inline-style parse */
    }
  }
  const inline = contentEl.style.transform;
  const m = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px,.*scale3d\(([-\d.]+),\s*([-\d.]+),/.exec(inline || "");
  if (!m) {
    return null;
  }
  return { tx: parseFloat(m[1]), ty: parseFloat(m[2]), scaleX: parseFloat(m[3]), scaleY: parseFloat(m[4]) };
}

function findEngineElements() {
  const allDivs = Array.from(document.querySelectorAll("div"));
  const viewportEl = allDivs.find((d) => {
    const cs = getComputedStyle(d);
    return cs.touchAction === "none" && cs.overflow === "hidden";
  }) as HTMLElement | undefined;
  const contentEl = allDivs.find(
    (d) => d.style.transformOrigin === "0px 0px" || d.style.transformOrigin === "0 0",
  ) as HTMLElement | undefined;
  const imgEl = document.querySelector<HTMLImageElement>("img") || undefined;
  return { viewportEl, contentEl, imgEl };
}

type SiteErrorRow = {
  siteNumber: string;
  xPct: number;
  yPct: number;
  expected: { x: number; y: number } | null;
  rendered: { x: number; y: number } | null;
  errorX: number | null;
  errorY: number | null;
};

function computeSiteErrors(sites: MasterMapSiteRow[]): SiteErrorRow[] {
  const { viewportEl, contentEl, imgEl } = findEngineElements();
  const viewportRect = viewportEl?.getBoundingClientRect();
  const t = readContentTransform(contentEl);
  const naturalWidth = imgEl?.naturalWidth;
  const naturalHeight = imgEl?.naturalHeight;

  return sites.map((s) => {
    const xPct = Number(s.map_x ?? 0);
    const yPct = Number(s.map_y ?? 0);

    let expected: { x: number; y: number } | null = null;
    if (viewportRect && t && naturalWidth && naturalHeight) {
      const cx = (xPct / 100) * naturalWidth;
      const cy = (yPct / 100) * naturalHeight;
      expected = {
        x: viewportRect.x + t.tx + cx * t.scaleX,
        y: viewportRect.y + t.ty + cy * t.scaleY,
      };
    }

    const markerEl = document.querySelector<HTMLElement>(`[data-marker-id="${s.id}"]`);
    const r = markerEl?.getBoundingClientRect();
    const rendered = r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;

    return {
      siteNumber: s.site_number,
      xPct,
      yPct,
      expected,
      rendered,
      errorX: expected && rendered ? rendered.x - expected.x : null,
      errorY: expected && rendered ? rendered.y - expected.y : null,
    };
  });
}

export function MapGeometryTestClient() {
  const searchParams = useSearchParams();
  const mapId = searchParams.get("mapId");
  // "full" (default) replicates Parking's ACTUAL page chrome around the
  // map -- the sticky shell header, the sticky map card with its
  // safe-area-inset top offset and z-index, the grid+order swap, and
  // enough filler content above it to force real scrolling on a phone --
  // since the simple, non-sticky harness measured zero error on the same
  // real map on the same real iPhone where Parking itself showed clear
  // misalignment. "simple" restores the original, already-tested flat
  // layout for direct comparison / further bisection.
  const chromeMode = searchParams.get("chrome") === "simple" ? "simple" : "full";

  const [isNarrow, setIsNarrow] = useState(false);
  const mapRef = useRef<MapCanvasHandle | null>(null);

  const [availableMaps, setAvailableMaps] = useState<MasterMapRow[] | null>(null);
  const [mapRow, setMapRow] = useState<MasterMapRow | null>(null);
  const [siteRows, setSiteRows] = useState<MasterMapSiteRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errorRows, setErrorRows] = useState<SiteErrorRow[]>([]);
  const [rawSnapshot, setRawSnapshot] = useState<unknown>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const update = () => setIsNarrow(window.innerWidth < SHELL_BREAKPOINT_COMPACT);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (mapId) {
      return;
    }
    let cancelled = false;
    void supabase
      .from("master_maps")
      .select("id,name,park_name,map_image_url")
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data, error }) => {
        if (cancelled) {
          return;
        }
        if (error) {
          setLoadError(error.message);
          return;
        }
        setAvailableMaps((data || []) as MasterMapRow[]);
      });
    return () => {
      cancelled = true;
    };
  }, [mapId]);

  useEffect(() => {
    if (!mapId) {
      return;
    }
    let cancelled = false;
    setLoadError(null);
    void (async () => {
      const [mapResult, sitesResult] = await Promise.all([
        supabase
          .from("master_maps")
          .select("id,name,park_name,map_image_url")
          .eq("id", mapId)
          .maybeSingle(),
        supabase
          .from("master_map_sites")
          .select("id,site_number,display_label,map_x,map_y")
          .eq("master_map_id", mapId)
          .order("site_number"),
      ]);
      if (cancelled) {
        return;
      }
      if (mapResult.error) {
        setLoadError(mapResult.error.message);
        return;
      }
      if (sitesResult.error) {
        setLoadError(sitesResult.error.message);
        return;
      }
      setMapRow(mapResult.data as MasterMapRow | null);
      setSiteRows((sitesResult.data || []) as MasterMapSiteRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [mapId]);

  const realMarkers = useMemo<MapMarker[]>(
    () =>
      siteRows
        .filter((s) => s.map_x !== null && s.map_y !== null)
        .map((s) => ({
          id: s.id,
          xPct: Number(s.map_x),
          yPct: Number(s.map_y),
          label: s.display_label || s.site_number,
        })),
    [siteRows],
  );

  const sampleSites = useMemo(() => pickSampleSites(siteRows), [siteRows]);

  function buildSnapshot() {
    const { viewportEl, contentEl, imgEl } = findEngineElements();
    const viewportRect = viewportEl?.getBoundingClientRect() ?? null;
    const contentRect = contentEl?.getBoundingClientRect() ?? null;
    const imgRect = imgEl?.getBoundingClientRect() ?? null;
    const t = readContentTransform(contentEl);
    const vv = (window as any).visualViewport;

    return {
      mode: mapId ? "real" : "synthetic",
      mapId,
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
      contentTransform: t,
      contentRect: contentRect
        ? { x: contentRect.x, y: contentRect.y, width: contentRect.width, height: contentRect.height }
        : null,
      imgRect: imgRect
        ? { x: imgRect.x, y: imgRect.y, width: imgRect.width, height: imgRect.height }
        : null,
      imgNaturalWidth: imgEl?.naturalWidth ?? null,
      imgNaturalHeight: imgEl?.naturalHeight ?? null,
      siteErrors: mapId ? computeSiteErrors(sampleSites) : null,
    };
  }

  useEffect(() => {
    // window is only ever touched inside effects/handlers here, never
    // directly in the render body -- calling window.__mapGeometrySnapshot()
    // (or referencing window at all) during render also runs during SSR,
    // where window does not exist, and 500s the route entirely.
    (window as any).__mapGeometrySnapshot = buildSnapshot;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNarrow, mapId, sampleSites]);

  function recompute() {
    setErrorRows(computeSiteErrors(sampleSites));
    setRawSnapshot(buildSnapshot());
    setRefreshTick((n) => n + 1);
  }

  useEffect(() => {
    if (!mapId || sampleSites.length === 0) {
      return;
    }
    // A real map image can be 1-3MB+ and take a while to decode; recompute
    // only once the <img> has actually finished loading with real (non-
    // placeholder) dimensions, not on a fixed delay -- an earlier fixed
    // 400ms delay captured GestureMapViewportV2's own transient initial
    // layout pass (measured against its 1200x800 placeholder default,
    // before the real image's onLoad had fired), which looked exactly
    // like a scale/coordinate bug but was purely a harness timing
    // artifact, not the app's real, final, settled geometry.
    let cancelled = false;
    let attempts = 0;
    const poll = () => {
      if (cancelled) {
        return;
      }
      const { imgEl } = findEngineElements();
      attempts += 1;
      if (imgEl?.complete && imgEl.naturalWidth > 0) {
        // One more tick so the onLoad-triggered React state update (which
        // feeds GestureMapViewportV2's real width/height and its own
        // recentering layout effect) has actually flushed and painted.
        window.setTimeout(() => {
          if (!cancelled) {
            recompute();
          }
        }, 100);
        return;
      }
      if (attempts < 100) {
        window.setTimeout(poll, 100);
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapId, sampleSites, mapRow?.map_image_url]);

  if (!mapId) {
    return (
      <div style={{ padding: 16, fontFamily: "monospace", fontSize: 13 }}>
        <p>
          Add <code>?mapId=&lt;master_map id&gt;</code> to load a real map and
          get a live per-site error readout, or use this page with no
          parameter for the original synthetic-image harness below.
        </p>
        {loadError && <p style={{ color: "red" }}>Error: {loadError}</p>}
        {availableMaps && (
          <ul>
            {availableMaps.map((m) => (
              <li key={m.id}>
                <a href={`?mapId=${m.id}`}>
                  {m.name} ({m.park_name || "no park name"}) -- {m.id}
                </a>
              </li>
            ))}
          </ul>
        )}
        <hr />
        <SyntheticHarness isNarrow={isNarrow} mapRef={mapRef} />
      </div>
    );
  }

  const mapCard = (
    <div
      data-geometry-role="card"
      className={chromeMode === "full" ? "card" : undefined}
      style={{
        border: chromeMode === "simple" ? "1px solid #ddd" : undefined,
        display: "flex",
        flexDirection: "column",
        height: isNarrow ? "60vh" : "78vh",
        minHeight: 0,
        // Byte-for-byte the same values app/admin/parking/page.tsx applies
        // to its own map card -- the one piece of real chrome the prior
        // "simple" harness never replicated, and the leading suspect now
        // that "simple" measured zero error on the real device where
        // Parking itself did not.
        position: chromeMode === "full" ? (isNarrow ? "sticky" : "static") : undefined,
        top:
          chromeMode === "full" && isNarrow
            ? "calc(env(safe-area-inset-top, 0px) + 8px)"
            : undefined,
        zIndex: chromeMode === "full" && isNarrow ? 40 : undefined,
        order: chromeMode === "full" ? (isNarrow ? 1 : 0) : undefined,
      }}
    >
      <div style={{ position: "relative", flex: "1 1 auto", minHeight: 0 }}>
        {mapRow?.map_image_url && (
          <MapCanvas
            ref={mapRef}
            imageUrl={mapRow.map_image_url}
            markers={realMarkers}
            viewportHeight="100%"
            initialScale={0.6}
            minScale={0.1}
            maxScale={3}
            selectionMode="none"
            showLabels={false}
            renderMarker={(m) => (
              <div
                data-geometry-role="marker-visual"
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: sampleSites.some((s) => s.id === m.id) ? "#ef4444" : "#0b5cff",
                  border: "2px solid white",
                }}
                title={m.label}
              />
            )}
          />
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => mapRef.current?.zoomIn()}>+</button>
        <button type="button" onClick={() => mapRef.current?.zoomOut()}>-</button>
        <button type="button" onClick={() => mapRef.current?.reset()}>Reset</button>
        <button type="button" onClick={recompute} style={{ fontWeight: 700 }}>
          Recompute readout ({refreshTick})
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ fontFamily: "monospace", fontSize: 12 }}>
      {chromeMode === "full" && (
        <>
          {/* Sticky shell header stand-in -- app/admin/parking/page.tsx is
              always rendered inside AdminShellAdapter's .shell-header,
              which is itself position:sticky; top:0; z-index:30. A second,
              lower-z-index sticky ancestor stacked against the map card's
              OWN sticky positioning is exactly the kind of nested-sticky
              situation WebKit has documented compositing quirks for, and
              the "simple" harness never had an ancestor sticky element at
              all. */}
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 30,
              background: "#fff",
              borderBottom: "1px solid #ddd",
              padding: 16,
            }}
          >
            Sticky header stand-in (mimics .shell-header)
          </div>
          <div style={{ padding: 16 }}>
            {/* Filler matching the real page's own pre-grid content
                (status alerts, mobile queue toggle) so there is enough
                height to actually SCROLL past the sticky header on a
                phone screen before reaching the map -- the real scroll
                situation Parking's page always has and this harness
                otherwise would not. */}
            <div style={{ height: 220, background: "#eef", marginBottom: 16, padding: 8 }}>
              Filler (mimics status alerts / mobile queue toggle) -- scroll
              past this to reach the sticky map card below.
            </div>
          </div>
        </>
      )}

      <div style={{ padding: chromeMode === "full" ? "0 16px 16px" : 16 }}>
        <div>
          mapId: {mapId} {mapRow ? `(${mapRow.name})` : "(loading...)"} -- chrome:{" "}
          {chromeMode}{" "}
          <a href={`?mapId=${mapId}&chrome=${chromeMode === "full" ? "simple" : "full"}`}>
            (switch to {chromeMode === "full" ? "simple" : "full"})
          </a>
        </div>
        {loadError && <p style={{ color: "red" }}>Error: {loadError}</p>}
        <div>isNarrow: {String(isNarrow)}</div>

        {chromeMode === "full" ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isNarrow ? "1fr" : "340px minmax(0, 1fr)",
              gap: isNarrow ? 12 : 10,
              alignItems: "start",
              width: "100%",
              marginTop: 8,
            }}
          >
            <div style={{ order: isNarrow ? 2 : 0, background: "#eef", padding: 8, minHeight: 120 }}>
              Filler (mimics the queue/attendee list panel)
            </div>
            {mapCard}
          </div>
        ) : (
          <div style={{ marginTop: 8 }}>{mapCard}</div>
        )}
      </div>

      <div style={{ padding: chromeMode === "full" ? "0 16px 16px" : 16 }}>
      <h3 style={{ marginTop: 16 }}>Live per-site error readout (red markers above)</h3>
      <p>
        Tap &quot;Recompute readout&quot; after zooming/panning/rotating to
        refresh these numbers for the CURRENT rendered state.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              {["site", "x%", "y%", "expected x,y", "rendered x,y", "error x", "error y"].map((h) => (
                <th key={h} style={{ border: "1px solid #ccc", padding: 4, textAlign: "left" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {errorRows.map((r) => (
              <tr key={r.siteNumber}>
                <td style={{ border: "1px solid #ccc", padding: 4 }}>{r.siteNumber}</td>
                <td style={{ border: "1px solid #ccc", padding: 4 }}>{r.xPct.toFixed(2)}</td>
                <td style={{ border: "1px solid #ccc", padding: 4 }}>{r.yPct.toFixed(2)}</td>
                <td style={{ border: "1px solid #ccc", padding: 4 }}>
                  {r.expected ? `${r.expected.x.toFixed(1)}, ${r.expected.y.toFixed(1)}` : "-"}
                </td>
                <td style={{ border: "1px solid #ccc", padding: 4 }}>
                  {r.rendered ? `${r.rendered.x.toFixed(1)}, ${r.rendered.y.toFixed(1)}` : "-"}
                </td>
                <td style={{ border: "1px solid #ccc", padding: 4, fontWeight: 700 }}>
                  {r.errorX !== null ? r.errorX.toFixed(1) : "-"}
                </td>
                <td style={{ border: "1px solid #ccc", padding: 4, fontWeight: 700 }}>
                  {r.errorY !== null ? r.errorY.toFixed(1) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginTop: 16 }}>Raw engine state</h3>
      <pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>
        {JSON.stringify(rawSnapshot, null, 2)}
      </pre>
      </div>
    </div>
  );
}

function SyntheticHarness({
  isNarrow,
  mapRef,
}: {
  isNarrow: boolean;
  mapRef: React.RefObject<MapCanvasHandle | null>;
}) {
  return (
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
          markers={SYNTHETIC_MARKERS}
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
  );
}
