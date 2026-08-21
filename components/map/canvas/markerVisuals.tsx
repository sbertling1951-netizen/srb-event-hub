// components/map/canvas/markerVisuals.tsx
//
// Shared presentational primitives for map markers. Every current
// consumer of MapCanvas's renderMarker seam (Parking, admin Locations,
// public Locations, Coach Map public, Master Maps authoring) hand-rolls
// its own colored dot + floating label chip with independently chosen
// sizes, fonts, and padding. This is the one shared place for that
// visual shape -- pages keep owning their own business-state-to-tone
// mapping (assignment/arrival status, occupied/vacant, category), but
// the actual rendered pixels come from here.
//
// Deliberately has NO knowledge of selection/business state beyond the
// `emphasis` prop -- that keeps it reusable by pages with very
// different semantics (Parking's assigned/arrived, Coach Map's
// occupied/viewer-assigned, Locations' category) without forcing a
// shared vocabulary onto things that aren't actually the same concept.
//
// Hit-target independence: MarkerLayer's own click wrapper (see
// ../canvas/MarkerLayer.tsx) has no explicit width/height of its own --
// it simply takes on whatever bounding box renderMarker returns. So
// MarkerDot renders an outer, invisible, centered wrapper sized to
// hitAreaSize (defaulting to a comfortable touch target regardless of
// how small the visible dot is), with zero changes needed to
// MarkerLayer itself.

import type { StatusBadgeTone } from "@/components/ui/StatusBadge";

export type MarkerTone = StatusBadgeTone;

const TONE_COLOR: Record<MarkerTone, string> = {
  neutral: "var(--color-text-secondary)",
  info: "var(--color-status-info)",
  warning: "var(--color-status-warning)",
  danger: "var(--color-status-error)",
  success: "var(--color-status-success)",
};

/** `color` (an exact page-chosen value) always wins over `tone` -- this
 * is what lets an existing page preserve its exact current marker
 * colors while still adopting the shared rendering. */
function resolveMarkerColor(tone?: MarkerTone, color?: string): string {
  if (color) {
    return color;
  }
  return TONE_COLOR[tone ?? "neutral"];
}

/** Public so consumers/documentation can refer to the real value instead
 * of a duplicated guess (see /admin/ui-reference's Map Marker Standard
 * section). */
export const MARKER_MIN_HIT_AREA_PX = 32;

export function MarkerDot({
  size,
  tone,
  color,
  shape = "circle",
  emphasis,
  hitAreaSize,
  borderWidth = 2,
  title,
}: {
  /** visible diameter, native image px (see markerSizing.ts) */
  size: number;
  tone?: MarkerTone;
  /** exact color override -- wins over `tone` when both are given */
  color?: string;
  shape?: "circle" | "square";
  /** additive selection/primary ring, layered on top of the base color */
  emphasis?: "selected" | "primary";
  /** invisible tap-target diameter; defaults to max(size, 32) so a small
   * visible dot never shrinks the actual touch target */
  hitAreaSize?: number;
  borderWidth?: number;
  title?: string;
}) {
  const resolvedColor = resolveMarkerColor(tone, color);
  const hitSize = Math.max(hitAreaSize ?? 0, size, MARKER_MIN_HIT_AREA_PX);

  return (
    <div
      style={{
        width: hitSize,
        height: hitSize,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        margin: "0 auto",
      }}
    >
      <div
        title={title}
        style={{
          width: size,
          height: size,
          borderRadius: shape === "circle" ? "50%" : 4,
          background: resolvedColor,
          border: `${borderWidth}px solid white`,
          boxShadow:
            emphasis === "selected"
              ? "0 0 0 8px rgba(245, 158, 11, 0.45), 0 2px 8px rgba(0,0,0,0.45)"
              : emphasis === "primary"
                ? "0 0 0 4px rgba(37, 99, 235, 0.4), 0 2px 8px rgba(0,0,0,0.45)"
                : "0 1px 4px rgba(0,0,0,0.35)",
          animation: emphasis === "selected" ? "parkingSelectedPulse 2.2s ease-in-out infinite" : undefined,
          flexShrink: 0,
        }}
      />
    </div>
  );
}

export function MarkerLabelChip({
  text,
  /** most consumers (Locations) use fixed black label text; Parking is
   * the one existing page whose labels are colored by status -- pass
   * the same resolved marker color as textColor to preserve that. */
  textColor = "#111",
  emphasized = false,
}: {
  text: string;
  textColor?: string;
  emphasized?: boolean;
}) {
  return (
    <div
      style={{
        marginTop: 4,
        marginLeft: "auto",
        marginRight: "auto",
        background: "rgba(255,255,255,0.92)",
        border: "1px solid rgba(0,0,0,0.2)",
        borderRadius: 4,
        fontSize: emphasized ? 12 : 10,
        fontWeight: 700,
        padding: emphasized ? "2px 6px" : "1px 4px",
        color: textColor,
        whiteSpace: "nowrap",
        boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
        display: "table",
        pointerEvents: "none",
      }}
    >
      {text}
    </div>
  );
}

/** Exposed so a page (e.g. Parking) that colors its label text by the
 * same tone/color as its dot can resolve that one value once and pass
 * it to both MarkerDot and MarkerLabelChip's textColor. */
export function resolveMarkerTone(tone?: MarkerTone, color?: string): string {
  return resolveMarkerColor(tone, color);
}
