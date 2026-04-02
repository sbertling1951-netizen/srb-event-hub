"use client";

import { useEffect, useMemo } from "react";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

type Place = {
  id: string;
  name: string;
  address: string | null;
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
}: {
  places: Place[];
  eventLat?: number | null;
  eventLng?: number | null;
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
          >
            <Tooltip direction="top" offset={[0, -10]} opacity={1}>
              {place.name}
            </Tooltip>

            <Popup>
              <strong>{place.name}</strong>
              <br />
              {place.address}
              {place.location_code ? (
                <>
                  <br />
                  {place.location_code}
                </>
              ) : null}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
