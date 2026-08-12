"use client";

/**
 * EpicentraX Map Surface (Stage 1).
 *
 * The only mapping import a domain consumer (Nearby today) should need.
 * Resolves a renderer adapter through the registry (lib/mapSurface/
 * registry.ts) and renders it with translated, renderer-neutral props.
 * Also owns the selected-object identity/action card -- it has zero
 * renderer dependency (plain DOM), so it lives here rather than being
 * duplicated inside every adapter.
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
        onObjectSelect={onObjectSelect}
        onBackgroundActivate={onMapBackgroundActivate}
        onViewportChange={onViewportChange}
      />

      {selectedObject ? (
        <SelectedObjectCard
          object={selectedObject}
          onActivate={() => onObjectActivate?.(selectedObject.id)}
        />
      ) : null}
    </div>
  );
}

export default EpicentraxMapSurface;
