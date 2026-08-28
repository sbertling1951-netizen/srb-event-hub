"use client";

/**
 * EpicentraX Map Surface (Stage 1).
 *
 * The only mapping import a domain consumer (Nearby today) should need.
 * Resolves a renderer adapter through the registry (lib/mapSurface/
 * registry.ts) and renders it with translated, renderer-neutral props.
 *
 * Interaction: by default a renderer object-select surfaces a neutral
 * "identity" card (SelectedObjectCard) whose own tap is the deliberate
 * activation -- the original real-device-verified two-step flow. A
 * consumer whose own selected-object treatment IS the deliberate action
 * (e.g. Nearby opening its ObjectPanel straight from a pin tap) passes
 * `selectActivatesObject`; the surface then treats a select as the
 * activation, fires `onObjectActivate`, and does not render the bridging
 * card. Either way the raw renderer gesture never reaches the domain --
 * the neutral surface owns which step counts as activation. This card has
 * zero renderer dependency (plain DOM), so it lives here rather than
 * being duplicated inside every adapter.
 *
 * This component, and everything it renders, must never import from
 * "leaflet", "react-leaflet", or any other renderer package. If it needs
 * to, that capability belongs in an adapter instead.
 */

import type { MapObject, MapSurfaceProps } from "@/lib/mapSurface/contract";
import { resolveMapRenderer } from "@/lib/mapSurface/registry";

function SelectedObjectCard({
  object,
  onActivate,
}: {
  object: MapObject;
  onActivate: () => void;
}) {
  return (
    <button
      type="button"
      className="nearby-map-selected-card"
      onClick={onActivate}
      aria-label={object.presentation?.accessibleLabel ?? `View details for ${object.title}`}
    >
      <strong>{object.title}</strong>
      {object.subtitle ? <span className="nearby-map-selected-card-meta">{object.subtitle}</span> : null}
      <span className="nearby-map-selected-card-cta">View details ›</span>
    </button>
  );
}

export function EpicentraxMapSurface({
  objects,
  selectedObjectId = null,
  viewportIntent,
  userLocation,
  onObjectSelect,
  onObjectActivate,
  onMapBackgroundActivate,
  onViewportChange,
  selectActivatesObject = false,
}: MapSurfaceProps) {
  const Renderer = resolveMapRenderer();
  const selectedObject = objects.find((object) => object.id === selectedObjectId) ?? null;

  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 10,
        overflow: "hidden",
        background: "white",
      }}
    >
      <Renderer
        objects={objects}
        selectedObjectId={selectedObjectId}
        viewportIntent={viewportIntent}
        userLocation={userLocation}
        onObjectSelect={(objectId) => {
          onObjectSelect?.(objectId);
          if (selectActivatesObject) {
            onObjectActivate?.(objectId);
          }
        }}
        onBackgroundActivate={onMapBackgroundActivate}
        onViewportChange={onViewportChange}
      />

      {selectedObject && !selectActivatesObject ? (
        <SelectedObjectCard
          object={selectedObject}
          onActivate={() => onObjectActivate?.(selectedObject.id)}
        />
      ) : null}
    </div>
  );
}

export default EpicentraxMapSurface;
