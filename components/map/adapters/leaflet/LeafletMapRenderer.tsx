"use client";

/**
 * EpicentraX Leaflet renderer adapter (Stage 1).
 *
 * Implements `MapRendererProps` (lib/mapSurface/contract.ts) on top of
 * react-leaflet/Leaflet. This is the ONLY file in the mapping framework
 * allowed to import from "leaflet" or "react-leaflet", and the only place
 * that translates EpicentraX `MapObject`s into Leaflet markers.
 *
 * Behavior is intentionally a straight port of the last real-device
 * confirmed baseline (marker tap -> Leaflet Tooltip label appears,
 * marker replacement, map-background dismissal, pan/pinch/zoom
 * untouched) -- Stage 1 is a structural extraction, not a behavior
 * change, and does not attempt the marker-to-ObjectPanel handoff.
 */

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { useEffect, useMemo } from "react";
import { MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";

import type { MapObject, MapRendererCapabilities, MapRendererProps } from "@/lib/mapSurface/contract";

export const leafletRendererCapabilities: MapRendererCapabilities = {
  supportsVectorLayers: false,
  supportsClustering: false,
  supportsCustomMarkers: true,
  supportsUserLocation: false,
  supportsFeatureSelection: true,
  supportsRotation: false,
  supportsPitch: false,
};

const DEFAULT_ZOOM = 12;
const FALLBACK_CENTER: [number, number] = [39.8283, -98.5795];

// Today every object renders with this single icon regardless of
// `presentation.iconSemantic` -- no consumer has asked for per-category
// icons yet. When one does, this is the one place that changes: map
// `iconSemantic` to an icon here rather than teaching any domain
// consumer about Leaflet icon construction.
const markerIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [18, 30],
  iconAnchor: [9, 30],
  popupAnchor: [1, -25],
  shadowSize: [30, 30],
});

function ViewportResizer({
  centerLat,
  centerLng,
  zoom,
}: {
  centerLat: number | null;
  centerLng: number | null;
  zoom: number;
}) {
  const map = useMap();

  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();

      if (typeof centerLat === "number" && typeof centerLng === "number") {
        map.setView([centerLat, centerLng], zoom);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [map, centerLat, centerLng, zoom]);

  return null;
}

function BackgroundActivation({ onBackgroundActivate }: { onBackgroundActivate?: () => void }) {
  useMapEvents({
    click: () => onBackgroundActivate?.(),
  });

  return null;
}

// `selectedObjectId` is part of `MapRendererProps` for adapters that can
// give the selected marker its own visual treatment. This adapter is a
// faithful port of the current baseline, which has never done that --
// selection is surfaced entirely by the neutral SelectedObjectCard, not
// by anything Leaflet-specific -- so it isn't read here today.
export function LeafletMapRenderer({
  objects,
  viewportIntent,
  onObjectSelect,
  onBackgroundActivate,
}: MapRendererProps) {
  const centerLat = viewportIntent?.center?.latitude ?? null;
  const centerLng = viewportIntent?.center?.longitude ?? null;
  const zoom = viewportIntent?.zoom ?? DEFAULT_ZOOM;

  const initialCenter: [number, number] = useMemo(() => {
    if (typeof centerLat === "number" && typeof centerLng === "number") {
      return [centerLat, centerLng];
    }

    if (objects.length > 0) {
      return [objects[0].coordinate.latitude, objects[0].coordinate.longitude];
    }

    return FALLBACK_CENTER;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the initial mount value matters; ViewportResizer handles later recentering.
  }, []);

  return (
    <MapContainer
      center={initialCenter}
      zoom={zoom}
      style={{ height: "520px", width: "100%" }}
      scrollWheelZoom
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap contributors"
      />

      <ViewportResizer centerLat={centerLat} centerLng={centerLng} zoom={zoom} />
      <BackgroundActivation onBackgroundActivate={onBackgroundActivate} />

      {objects.map((object: MapObject) => (
        <Marker
          key={object.id}
          position={[object.coordinate.latitude, object.coordinate.longitude]}
          icon={markerIcon}
          title={object.title}
          eventHandlers={{
            click: () => {
              onObjectSelect?.(object.id);
            },
          }}
          ref={(marker) => {
            if (!marker) {
              return;
            }

            // Leaflet's default tooltip trigger is mouseover only; it
            // does not open on keyboard focus even though markers are
            // keyboard-focusable (`keyboard: true` by default). Wire
            // native focus/blur on the marker's own element so a
            // keyboard user sees the same lightweight tooltip a mouse
            // user gets on hover. Click/tap is untouched -- it always
            // goes straight to onObjectSelect above, never to the
            // tooltip.
            const el = marker.getElement();

            if (!el) {
              return;
            }

            function handleFocus() {
              marker?.openTooltip();
            }

            function handleBlur() {
              marker?.closeTooltip();
            }

            el.addEventListener("focus", handleFocus);
            el.addEventListener("blur", handleBlur);

            return () => {
              el.removeEventListener("focus", handleFocus);
              el.removeEventListener("blur", handleBlur);
            };
          }}
        >
          <Tooltip direction="top" offset={[0, -10]} opacity={1} interactive={false}>
            <span>{object.title}</span>

            {object.category ? (
              <>
                <br />
                <span style={{ opacity: 0.7, fontSize: 11 }}>{object.category}</span>
              </>
            ) : null}
          </Tooltip>
        </Marker>
      ))}
    </MapContainer>
  );
}
