// lib/map/parity.ts — MapCanvas coordinate parity harness.

export interface Marker { site: string; mapX: number; mapY: number; }

export interface ViewportState {
  label: string;
  contentWidth: number;
  contentHeight: number;
  scale: number;
  translateX: number;
  translateY: number;
}

export interface ScreenPoint { x: number; y: number; }

export type MarkerPositioner = (marker: Marker, vp: ViewportState) => ScreenPoint;

// Ground truth: the real current GestureMapViewportV2 + page math.
export function currentPositioner(marker: Marker, vp: ViewportState): ScreenPoint {
  const contentX = (marker.mapX / 100) * vp.contentWidth;
  const contentY = (marker.mapY / 100) * vp.contentHeight;
  return { x: contentX * vp.scale + vp.translateX, y: contentY * vp.scale + vp.translateY };
}

// Negative control: wrong (contain/letterbox) math, to prove the gate turns red.
export function containDivergencePositioner(marker: Marker, vp: ViewportState): ScreenPoint {
  const CW = 1024, CH = 768;
  const ca = CW / CH, ia = vp.contentWidth / vp.contentHeight;
  let bw: number, bh: number;
  if (ia > ca) { bw = CW; bh = CW / ia; } else { bh = CH; bw = CH * ia; }
  const ox = (CW - bw) / 2, oy = (CH - bh) / 2;
  const contentX = ox + (marker.mapX / 100) * bw;
  const contentY = oy + (marker.mapY / 100) * bh;
  return { x: contentX * vp.scale + vp.translateX, y: contentY * vp.scale + vp.translateY };
}

export interface ParityRow {
  scenario: string; site: string;
  oldX: number; oldY: number; newX: number; newY: number;
  deltaX: number; deltaY: number; pass: boolean;
}

export interface ParityResult {
  rows: ParityRow[]; maxDelta: number; allPass: boolean; threshold: number;
}

// Start threshold at 0. Never round mid-calculation.
export function runParity(
  oldPositioner: MarkerPositioner,
  newPositioner: MarkerPositioner,
  markers: Marker[],
  viewports: ViewportState[],
  threshold = 0,
): ParityResult {
  const rows: ParityRow[] = [];
  let maxDelta = 0;
  for (const vp of viewports) {
    for (const m of markers) {
      const o = oldPositioner(m, vp);
      const n = newPositioner(m, vp);
      const deltaX = n.x - o.x;
      const deltaY = n.y - o.y;
      const worst = Math.max(Math.abs(deltaX), Math.abs(deltaY));
      if (worst > maxDelta) maxDelta = worst;
      rows.push({ scenario: vp.label, site: m.site, oldX: o.x, oldY: o.y, newX: n.x, newY: n.y, deltaX, deltaY, pass: worst <= threshold });
    }
  }
  return { rows, maxDelta, allPass: rows.every((r) => r.pass), threshold };
}

export const edgeCaseMarkers: Marker[] = [
  { site: "top-left", mapX: 0, mapY: 0 },
  { site: "top-right", mapX: 100, mapY: 0 },
  { site: "bottom-left", mapX: 0, mapY: 100 },
  { site: "bottom-right", mapX: 100, mapY: 100 },
  { site: "center", mapX: 50, mapY: 50 },
];

export const edgeCaseViewports: ViewportState[] = [
  { label: "neutral", contentWidth: 2000, contentHeight: 1500, scale: 1, translateX: 0, translateY: 0 },
  { label: "min-zoom", contentWidth: 2000, contentHeight: 1500, scale: 0.5, translateX: 0, translateY: 0 },
  { label: "max-zoom", contentWidth: 2000, contentHeight: 1500, scale: 4, translateX: -800, translateY: -600 },
  { label: "very-wide-image", contentWidth: 4000, contentHeight: 800, scale: 1, translateX: 0, translateY: 0 },
  { label: "very-tall-image", contentWidth: 800, contentHeight: 4000, scale: 1, translateX: 0, translateY: 0 },
];
