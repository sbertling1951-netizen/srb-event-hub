// components/map/canvas/coords.ts
//
// Coordinate engine — PURE, no React, no DOM. Single source of truth for every
// conversion between screen, viewport, content, and percentage space.
//
// Transform model (identical to GestureMapViewportV2):
//   content box is sized to the natural image (W x H), transformOrigin "0 0",
//   transform = translate3d(panX, panY, 0) scale3d(scale, scale, 1).
//   A content-space point (cx, cy) therefore renders, relative to the viewport
//   top-left, at screen (panX + cx*scale, panY + cy*scale).
//
// All public marker coordinates are PERCENT (0..100 of W/H). Pixels never leave
// this module.

import type { MapViewportState, ViewTransform } from "./types";

export type Size = { width: number; height: number };

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function clampPercent(v: number): number {
  return clamp(v, 0, 100);
}

export function round2(v: number): number {
  return Number(v.toFixed(2));
}

// ---- percent <-> content px ------------------------------------------------
export function percentToContent(
  xPct: number,
  yPct: number,
  natural: Size,
): { cx: number; cy: number } {
  return { cx: (xPct / 100) * natural.width, cy: (yPct / 100) * natural.height };
}

export function contentToPercent(
  cx: number,
  cy: number,
  natural: Size,
): { xPct: number; yPct: number } {
  return {
    xPct: natural.width ? (cx / natural.width) * 100 : 0,
    yPct: natural.height ? (cy / natural.height) * 100 : 0,
  };
}

// ---- content px <-> screen px (relative to the viewport top-left) ----------
export function contentToScreen(
  cx: number,
  cy: number,
  t: ViewTransform,
): { sx: number; sy: number } {
  return { sx: t.panX + cx * t.scale, sy: t.panY + cy * t.scale };
}

export function screenToContent(
  sx: number,
  sy: number,
  t: ViewTransform,
): { cx: number; cy: number } {
  return { cx: (sx - t.panX) / t.scale, cy: (sy - t.panY) / t.scale };
}

// ---- screen px <-> percent (the two conversions pages must never do) -------
export function screenToPercent(
  sx: number,
  sy: number,
  t: ViewTransform,
  natural: Size,
): { xPct: number; yPct: number } {
  const { cx, cy } = screenToContent(sx, sy, t);
  return contentToPercent(cx, cy, natural);
}

export function percentToScreen(
  xPct: number,
  yPct: number,
  t: ViewTransform,
  natural: Size,
): { sx: number; sy: number } {
  const { cx, cy } = percentToContent(xPct, yPct, natural);
  return contentToScreen(cx, cy, t);
}

// ---- fit / center ----------------------------------------------------------
export function fitScale(
  viewport: Size,
  natural: Size,
  minScale: number,
  maxScale: number,
): number {
  if (!natural.width || !natural.height) return clamp(1, minScale, maxScale);
  const fit = Math.min(viewport.width / natural.width, viewport.height / natural.height, 1);
  return clamp(fit, minScale, maxScale);
}

/** Pan that places the natural image centered in the viewport at the given scale. */
export function fitTransform(
  viewport: Size,
  natural: Size,
  minScale: number,
  maxScale: number,
): ViewTransform {
  const scale = fitScale(viewport, natural, minScale, maxScale);
  return {
    scale,
    panX: (viewport.width - natural.width * scale) / 2,
    panY: (viewport.height - natural.height * scale) / 2,
  };
}

/** Pan that puts a percent point at the viewport center, at the given scale. */
export function centerOnPercentTransform(
  xPct: number,
  yPct: number,
  scale: number,
  viewport: Size,
  natural: Size,
): ViewTransform {
  const { cx, cy } = percentToContent(xPct, yPct, natural);
  return {
    scale,
    panX: viewport.width / 2 - cx * scale,
    panY: viewport.height / 2 - cy * scale,
  };
}

/** Inverse of the above: which percent point is currently at the viewport center. */
export function viewportToState(t: ViewTransform, viewport: Size, natural: Size): MapViewportState {
  const { cx, cy } = screenToContent(viewport.width / 2, viewport.height / 2, t);
  const { xPct, yPct } = contentToPercent(cx, cy, natural);
  return { scale: t.scale, centerXPct: clampPercent(xPct), centerYPct: clampPercent(yPct) };
}

// ---- pan clamping (faithful port of GestureMapViewportV2.clampPan) ---------
export function clampPan(
  panX: number,
  panY: number,
  scale: number,
  viewport: Size,
  natural: Size,
): { panX: number; panY: number } {
  const scaledW = natural.width * scale;
  const scaledH = natural.height * scale;
  const overX = Math.min(60, viewport.width * 0.08);
  const overY = Math.min(40, viewport.height * 0.06);
  const minX = Math.min(0, viewport.width - scaledW) - overX;
  const minY = Math.min(0, viewport.height - scaledH) - overY;
  return {
    panX:
      scaledW <= viewport.width
        ? clamp(panX, -overX * 1.5, overX * 1.5)
        : clamp(panX, minX, overX),
    panY:
      scaledH <= viewport.height
        ? clamp(panY, -overY * 1.5, overY * 1.5)
        : clamp(panY, minY, overY),
  };
}

// ---- percent-space rectangle hit test (for marquee selection) --------------
export type RectPct = { minX: number; minY: number; maxX: number; maxY: number };

export function normalizeRectPct(a: { xPct: number; yPct: number }, b: { xPct: number; yPct: number }): RectPct {
  return {
    minX: Math.min(a.xPct, b.xPct),
    maxX: Math.max(a.xPct, b.xPct),
    minY: Math.min(a.yPct, b.yPct),
    maxY: Math.max(a.yPct, b.yPct),
  };
}

export function pointInRectPct(xPct: number, yPct: number, r: RectPct): boolean {
  return xPct >= r.minX && xPct <= r.maxX && yPct >= r.minY && yPct <= r.maxY;
}
