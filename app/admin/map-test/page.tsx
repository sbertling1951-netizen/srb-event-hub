// app/admin/map-test/page.tsx  (admin-gated parity test — not a production consumer)
//
// Phase 2 parity: render the CURRENT Master Map marker approach and the
// MapCanvas implementation over identical markers, drive both to identical
// viewport states via setViewportTransform, and compare marker centers using
// getBoundingClientRect. Gate: <= 0.5 px per marker, every state.
//
// Requires the GestureMapViewportV2 additions in
// components/map/GestureMapViewportV2.additions.md (getViewportTransform /
// setViewportTransform) and the MapCanvas handle's setViewportTransform.
//
// Place parity-test-map.png in /public so it serves at /parity-test-map.png.
//
// NOTE ON "CURRENT": <CurrentMmeMarkers> faithfully reproduces the Master Map
// Editor's marker-rendering CONTRACT (percentage positioning inside
// GestureMapViewportV2). It is not the literal MME page (which can't mount with
// synthetic data without its data/auth layer). To run TRUE page-level parity,
// add data-marker-id to the real page's marker elements and point measurePane()
// at it — the measurement core is renderer-agnostic.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { MapCanvas, type MapCanvasHandle } from "@/components/map/canvas";
import GestureMapViewportV2, {
  type GestureMapViewportHandle,
} from "@/components/map/GestureMapViewportV2";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";

type MapMarker = {
  id: string;
  xPct: number;
  yPct: number;
};

const IMAGE = "/parity-test-map.png"; // place parity-test-map.png in /public
const NW = 4000;
const NH = 3000;
const TOL = 0.5;

// synthetic seed (kept in sync with parity-seed-markers.json)
const MARKERS: MapMarker[] = [
  { id: "c-tl", xPct: 0, yPct: 0 },
  { id: "c-tr", xPct: 100, yPct: 0 },
  { id: "c-bl", xPct: 0, yPct: 100 },
  { id: "c-br", xPct: 100, yPct: 100 },
  { id: "e-top", xPct: 50, yPct: 0 },
  { id: "e-bot", xPct: 50, yPct: 100 },
  { id: "e-left", xPct: 0, yPct: 50 },
  { id: "e-right", xPct: 100, yPct: 50 },
  { id: "center", xPct: 50, yPct: 50 },
  { id: "q-tl", xPct: 25, yPct: 25 },
  { id: "q-tr", xPct: 75, yPct: 25 },
  { id: "q-bl", xPct: 25, yPct: 75 },
  { id: "q-br", xPct: 75, yPct: 75 },
  { id: "r-1", xPct: 62.27, yPct: 8.2 },
  { id: "r-2", xPct: 30.2, yPct: 25.64 },
  { id: "r-3", xPct: 70.81, yPct: 65.55 },
  { id: "r-4", xPct: 84.51, yPct: 13.65 },
  { id: "r-5", xPct: 43.13, yPct: 8.62 },
  { id: "r-6", xPct: 25.24, yPct: 50.47 },
];

const VW = 600;
const VH = 450;

type T = { x: number; y: number; scale: number };

function fitScale() {
  return Math.min(VW / NW, VH / NH, 1);
}
function scaleStates(): Record<string, number> {
  return {
    fit: fitScale(),
    "0.5x": 0.5,
    "1.0x": 1.0,
    "2.0x": 2.0,
    "max(3x)": 3.0,
  };
}
function panStates(s: number): Record<string, [number, number]> {
  const sw = NW * s,
    sh = NH * s;
  return {
    center: [(VW - sw) / 2, (VH - sh) / 2],
    "pan-TL": [0, 0],
    "pan-TR": [VW - sw, 0],
    "pan-BL": [0, VH - sh],
    "pan-BR": [VW - sw, VH - sh],
  };
}

// CURRENT: faithful reproduction of MME marker rendering (percentage positioning)
function CurrentMmeMarkers() {
  return (
    <div style={{ position: "relative", width: NW, height: NH }}>
      <img
        src={IMAGE}
        alt=""
        draggable={false}
        style={{
          position: "absolute",
          inset: 0,
          width: NW,
          height: NH,
          display: "block",
          pointerEvents: "none",
        }}
      />
      {MARKERS.map((m) => (
        <div
          key={m.id}
          data-marker-id={m.id}
          style={{
            position: "absolute",
            left: `${m.xPct}%`,
            top: `${m.yPct}%`,
            transform: "translate(-50%, -50%)",
          }}
        >
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: "#1f9d55",
              border: "1px solid #fff",
              margin: "0 auto",
            }}
          />
        </div>
      ))}
    </div>
  );
}

// renderer-agnostic measurement core
function measurePane(
  host: HTMLElement | null,
): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  if (!host) {
    return out;
  }
  const base = host.getBoundingClientRect();
  host.querySelectorAll<HTMLElement>("[data-marker-id]").forEach((el) => {
    const r = el.getBoundingClientRect();
    out[el.dataset.markerId!] = {
      x: r.left + r.width / 2 - base.left,
      y: r.top + r.height / 2 - base.top,
    };
  });
  return out;
}

const nextFrame = () =>
  new Promise<void>((res) =>
    requestAnimationFrame(() => requestAnimationFrame(() => res())),
  );

type Row = {
  scale: string;
  pan: string;
  id: string;
  drift: number;
  pass: boolean;
};

function MapTestInner() {
  const v2Ref = useRef<GestureMapViewportHandle | null>(null);
  const mcRef = useRef<MapCanvasHandle | null>(null);
  const paneAEl = useRef<HTMLDivElement | null>(null);
  const paneBEl = useRef<HTMLDivElement | null>(null);
  const [report, setReport] = useState<Row[]>([]);
  const [summary, setSummary] = useState<{
    max: number;
    fails: number;
    checks: number;
  } | null>(null);

  const setBoth = useCallback(async (t: T) => {
    v2Ref.current?.setViewportTransform(t);
    // MapCanvas forwards setViewportTransform to its inner V2 (see additions.md)
    const mapCanvasHandle = mcRef.current as any;

    console.log(
      "MAPCANVAS HANDLE KEYS",
      mapCanvasHandle ? Object.keys(mapCanvasHandle) : null,
    );

    mapCanvasHandle?.setViewportTransform?.(t);

    await nextFrame();
    console.log("V2 VIEWPORT", v2Ref.current?.getViewportTransform?.());

    console.log(
      "MAPCANVAS VIEWPORT",
      mapCanvasHandle?.getViewportTransform?.(),
    );

    console.log(
      "MAPCANVAS HAS SETTER",
      typeof mapCanvasHandle?.setViewportTransform,
    );

    console.log(
      "MAPCANVAS HAS GETTER",
      typeof mapCanvasHandle?.getViewportTransform,
    );

    console.log("PARITY SCALE CHECK", {
      requested: t.scale,
      actual: v2Ref.current?.getViewportTransform?.(),
    });
  }, []);

  const runMatrix = useCallback(async () => {
    const scales = scaleStates();
    const rows: Row[] = [];
    let max = 0,
      fails = 0;
    for (const sName of Object.keys(scales)) {
      const s = scales[sName];
      const pans = panStates(s);
      for (const pName of Object.keys(pans)) {
        const [x, y] = pans[pName];
        await setBoth({ x, y, scale: s });
        const A = measurePane(paneAEl.current);
        const B = measurePane(paneBEl.current);
        for (const id of Object.keys(A)) {
          if (!(id in B)) {
            continue;
          }
          const drift = Math.hypot(B[id].x - A[id].x, B[id].y - A[id].y);
          if (drift > max) {
            max = drift;
          }
          const pass = drift <= TOL;
          if (!pass) {
            fails++;
          }
          rows.push({ scale: sName, pan: pName, id, drift, pass });
        }
      }
    }
    setReport(rows);
    setSummary({ max, fails, checks: rows.length });
  }, [setBoth]);

  useEffect(() => {
    const s = fitScale();
    void setBoth({ x: (VW - NW * s) / 2, y: (VH - NH * s) / 2, scale: s });
  }, [setBoth]);

  const failed = useMemo(() => report.filter((r) => !r.pass), [report]);

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 18 }}>
        Map Parity Test — Current MME vs MapCanvas
      </h1>
      <div style={{ color: "#6b7280", fontSize: 13, marginBottom: 12 }}>
        Identical markers + viewport states. Gate ≤ {TOL}px per marker.
      </div>
      <button
        onClick={() => void runMatrix()}
        style={{
          padding: "8px 14px",
          borderRadius: 6,
          border: "1px solid #2563eb",
          background: "#2563eb",
          color: "#fff",
          fontWeight: 700,
          cursor: "pointer",
          marginBottom: 12,
        }}
      >
        Run full matrix
      </button>

      {summary && (
        <div
          style={{
            margin: "8px 0",
            fontWeight: 800,
            color: summary.fails === 0 ? "#166534" : "#991b1b",
          }}
        >
          {summary.fails === 0 ? "PASS" : "FAIL"} · {summary.checks} checks ·
          max drift {summary.max.toFixed(4)}px · {summary.fails} failure(s)
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
            Pane A — Current (MME marker contract)
          </div>
          <div
            ref={paneAEl}
            style={{
              width: VW,
              height: VH,
              overflow: "hidden",
              border: "1px solid #d1d5db",
              touchAction: "none",
            }}
          >
            <GestureMapViewportV2
              ref={v2Ref}
              width={NW}
              height={NH}
              viewportHeight="100%"
              initialScale={fitScale()}
              minScale={0.1}
              maxScale={3}
            >
              <CurrentMmeMarkers />
            </GestureMapViewportV2>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
            Pane B — MapCanvas
          </div>
          <div
            ref={paneBEl}
            style={{
              width: VW,
              height: VH,
              overflow: "hidden",
              border: "1px solid #d1d5db",
              touchAction: "none",
            }}
          >
            <MapCanvas
              ref={mcRef}
              imageUrl={IMAGE}
              naturalWidth={NW}
              naturalHeight={NH}
              markers={MARKERS}
              viewportHeight="100%"
              initialScale={fitScale()}
              minScale={0.1}
              maxScale={3}
              showLabels={false}
            />
          </div>
        </div>
      </div>

      {failed.length > 0 && (
        <table
          style={{ marginTop: 14, borderCollapse: "collapse", fontSize: 12 }}
        >
          <tbody>
            <tr>
              <th>scale</th>
              <th>pan</th>
              <th>marker</th>
              <th>drift</th>
            </tr>
            {failed.map((r, i) => (
              <tr key={i} style={{ background: "#fef2f2" }}>
                <td style={{ border: "1px solid #eee", padding: "2px 8px" }}>
                  {r.scale}
                </td>
                <td style={{ border: "1px solid #eee", padding: "2px 8px" }}>
                  {r.pan}
                </td>
                <td style={{ border: "1px solid #eee", padding: "2px 8px" }}>
                  {r.id}
                </td>
                <td style={{ border: "1px solid #eee", padding: "2px 8px" }}>
                  {r.drift.toFixed(4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function MapTestPage() {
  return (
    <AdminRouteGuard>
      <AdminShellAdapter pageTitle="Map Parity Test">
        <MapTestInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}
