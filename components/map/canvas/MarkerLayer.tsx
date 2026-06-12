// components/map/canvas/MarkerLayer.tsx
//
// Marker rendering engine. Positions every marker by PERCENTAGE (the canonical
// convention) inside the transformed content layer, so all consumers render
// identically regardless of zoom/pan. Each marker element carries
// data-marker-id for hit-testing and for the parity harness measurement core.
//
// Selection-state visuals are owned here (requirement #1 lists "selection
// rendering"); semantic/category color is page-supplied via marker.color.

"use client";

import { memo } from "react";

import type { MapMarker, MapPercentPoint } from "./types";

type Props = {
  markers: MapMarker[];
  selectedSet: Set<string>;
  primaryId: string | null;
  showLabels: boolean;
  pendingMarker?: MapPercentPoint | null;
  pendingLabel?: string;
  onMarkerActivate: (id: string, additive: boolean) => void;
  renderMarker?: (
    marker: MapMarker,
    state: { selected: boolean; primary: boolean },
  ) => React.ReactNode;
};

const SELECTED_COLOR = "#60a5fa";
const PRIMARY_COLOR = "#f4b400";
const DEFAULT_COLOR = "#1f9d55";

function MarkerLayerImpl({
  markers,
  selectedSet,
  primaryId,
  showLabels,
  pendingMarker,
  pendingLabel,
  onMarkerActivate,
  renderMarker,
}: Props) {
  return (
    <>
      {markers.map((m) => {
        if (!Number.isFinite(m.xPct) || !Number.isFinite(m.yPct)) {
          return null;
        }
        const selected = selectedSet.has(m.id);
        const primary = m.id === primaryId;
        const size = m.size ?? 14;

        return (
          <div
            key={m.id}
            data-marker-id={m.id}
            data-layer={m.layer || "default"}
            style={{
              position: "absolute",
              left: `${m.xPct}%`,
              top: `${m.yPct}%`,
              transform: "translate(-50%, -50%)",
              pointerEvents: "none",
              zIndex: primary ? 4 : selected ? 3 : 2,
            }}
          >
            {renderMarker ? (
              <div
                onClick={(e) => {
                  console.log("CUSTOM MARKER CLICK", m.id);
                  e.stopPropagation();
                  onMarkerActivate(m.id, e.shiftKey);
                }}
                style={{
                  pointerEvents: m.selectable === false ? "none" : "auto",
                  cursor: "pointer",
                }}
              >
                {renderMarker(m, { selected, primary })}
              </div>
            ) : (
              <button
                type="button"
                tabIndex={-1}
                title={m.label || m.id}
                onClick={(e) => {
                  console.log("MARKER BUTTON CLICK", m.id);
                  e.preventDefault();
                  e.stopPropagation();
                  onMarkerActivate(m.id, e.shiftKey);
                }}
                style={{
                  width: size,
                  height: size,
                  borderRadius: "50%",
                  background: primary
                    ? PRIMARY_COLOR
                    : selected
                      ? SELECTED_COLOR
                      : m.color || DEFAULT_COLOR,
                  border: primary
                    ? "2px solid #fff"
                    : selected
                      ? "2px solid #0b5cff"
                      : "1px solid rgba(255,255,255,0.85)",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
                  padding: 0,
                  margin: "0 auto",
                  display: "block",
                  cursor: m.selectable === false ? "default" : "pointer",
                  pointerEvents: m.selectable === false ? "none" : "auto",
                }}
              />
            )}
            {!renderMarker && showLabels && m.label && (
              <div
                style={{
                  marginTop: 4,
                  marginLeft: "auto",
                  marginRight: "auto",
                  background: "rgba(255,255,255,0.92)",
                  border: "1px solid rgba(0,0,0,0.2)",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "1px 4px",
                  color: "#111",
                  whiteSpace: "nowrap",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                  display: "table",
                  pointerEvents: "none",
                }}
              >
                {m.label}
              </div>
            )}
          </div>
        );
      })}

      {pendingMarker &&
        Number.isFinite(pendingMarker.xPct) &&
        Number.isFinite(pendingMarker.yPct) && (
          <div
            data-pending-marker="true"
            style={{
              position: "absolute",
              left: `${pendingMarker.xPct}%`,
              top: `${pendingMarker.yPct}%`,
              transform: "translate(-50%, -50%)",
              pointerEvents: "none",
              zIndex: 5,
            }}
          >
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: PRIMARY_COLOR,
                border: "2px solid #fff",
                boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
                margin: "0 auto",
              }}
            />
            {showLabels && pendingLabel && (
              <div
                style={{
                  marginTop: 4,
                  background: "rgba(255,255,255,0.96)",
                  border: "1px solid rgba(0,0,0,0.2)",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "1px 4px",
                  color: "#111",
                  whiteSpace: "nowrap",
                  display: "table",
                  marginLeft: "auto",
                  marginRight: "auto",
                }}
              >
                {pendingLabel}
              </div>
            )}
          </div>
        )}
    </>
  );
}

export const MarkerLayer = memo(MarkerLayerImpl);
