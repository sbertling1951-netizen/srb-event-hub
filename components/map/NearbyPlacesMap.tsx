"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { useEffect, useMemo } from "react";
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from "react-leaflet";

export type Place = {
  id: string;
  name: string;
  address: string | null;
  phone?: string | null;
  website?: string | null;
  notes?: string | null;
  category?: string | null;
  location_code?: string | null;
  lat?: number | null;
  lng?: number | null;
};

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

function MapResizer({
  eventLat,
  eventLng,
}: {
  eventLat: number | null;
  eventLng: number | null;
}) {
  const map = useMap();

  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();

      if (typeof eventLat === "number" && typeof eventLng === "number") {
        map.setView([eventLat, eventLng], 12);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [map, eventLat, eventLng]);

  return null;
}

export default function NearbyPlacesMap({
  places = [],
  eventLat = null,
  eventLng = null,
  onSelectPlace,
}: {
  places: Place[];
  eventLat?: number | null;
  eventLng?: number | null;
  /** Called when a marker is activated (click, tap, or keyboard Enter/Space
   * -- Leaflet fires its "click" event for all three). The consuming page
   * is responsible for what happens next (e.g. opening an ObjectPanel);
   * this component has no opinion about it. Selecting a marker never moves
   * or zooms the map on its own -- the current center/zoom is left exactly
   * as the user set it. */
  onSelectPlace?: (place: Place) => void;
}) {
  const validPlaces = useMemo(
    () =>
      places.filter(
        (p) =>
          typeof p.lat === "number" &&
          !Number.isNaN(p.lat) &&
          typeof p.lng === "number" &&
          !Number.isNaN(p.lng),
      ),
    [places],
  );

  const initialCenter: [number, number] =
    typeof eventLat === "number" &&
    !Number.isNaN(eventLat) &&
    typeof eventLng === "number" &&
    !Number.isNaN(eventLng)
      ? [eventLat, eventLng]
      : validPlaces.length > 0
        ? [validPlaces[0].lat as number, validPlaces[0].lng as number]
        : [39.8283, -98.5795];

  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 10,
        overflow: "hidden",
        background: "white",
      }}
    >
      <MapContainer
        center={initialCenter}
        zoom={12}
        style={{ height: "520px", width: "100%" }}
        scrollWheelZoom
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />

        <MapResizer eventLat={eventLat} eventLng={eventLng} />

        {validPlaces.map((place) => (
          <Marker
            key={place.id}
            position={[place.lat as number, place.lng as number]}
            icon={markerIcon}
            title={place.name}
            eventHandlers={{
              click: () => {
                onSelectPlace?.(place);
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
              // goes straight to onSelectPlace above, never to the
              // tooltip, so this never adds a step before opening the
              // panel.
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
            <Tooltip
              direction="top"
              offset={[0, -10]}
              opacity={1}
              interactive={false}
            >
              <span>{place.name}</span>

              {place.category ? (
                <>
                  <br />
                  <span style={{ opacity: 0.7, fontSize: 11 }}>
                    {place.category}
                  </span>
                </>
              ) : null}
            </Tooltip>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
