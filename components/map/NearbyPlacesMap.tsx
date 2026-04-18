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
  phone?: string | null;
  website?: string | null;
  notes?: string | null;
  category?: string | null;
  location_code?: string | null;
  lat?: number | null;
  lng?: number | null;
};

function cleanPhone(phone?: string | null) {
  if (!phone) return "";
  return phone.replace(/[^\d+]/g, "");
}

function normalizeWebsite(url?: string | null) {
  if (!url) return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function appleMapsUrl(place: Place) {
  const safeLabel = encodeURIComponent(place.name || "Destination");

  if (
    typeof place.lat === "number" &&
    Number.isFinite(place.lat) &&
    typeof place.lng === "number" &&
    Number.isFinite(place.lng)
  ) {
    return `https://maps.apple.com/?daddr=${place.lat},${place.lng}&dirflg=d&q=${safeLabel}`;
  }

  const safeAddress = encodeURIComponent(
    place.address || place.name || "Destination",
  );
  return `https://maps.apple.com/?daddr=${safeAddress}&dirflg=d`;
}

function googleMapsUrl(place: Place) {
  if (
    typeof place.lat === "number" &&
    Number.isFinite(place.lat) &&
    typeof place.lng === "number" &&
    Number.isFinite(place.lng)
  ) {
    return `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`;
  }

  const safeAddress = encodeURIComponent(
    place.address || place.name || "Destination",
  );
  return `https://www.google.com/maps/dir/?api=1&destination=${safeAddress}`;
}

const popupButtonStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid #d1d5db",
  background: "#f8fafc",
  color: "#111827",
  textDecoration: "none",
  fontSize: 12,
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
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

        {validPlaces.map((place) => {
          const phoneHref = cleanPhone(place.phone);
          const websiteHref = normalizeWebsite(place.website);

          return (
            <Marker
              key={place.id}
              position={[place.lat as number, place.lng as number]}
              icon={markerIcon}
              eventHandlers={{
                click: (e) => {
                  e.target.openPopup();
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -10]} opacity={1}>
                {place.name}
              </Tooltip>

              <Popup>
                <div style={{ minWidth: 240 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>
                    {place.name}
                  </div>
                  {place.category ? (
                    <div
                      style={{ fontSize: 12, color: "#666", marginBottom: 4 }}
                    >
                      {place.category}
                    </div>
                  ) : null}
                  {place.address ? (
                    <div style={{ fontSize: 13, marginBottom: 4 }}>
                      {place.address}
                    </div>
                  ) : null}
                  {place.location_code ? (
                    <div
                      style={{ fontSize: 12, color: "#666", marginBottom: 4 }}
                    >
                      📍 {place.location_code}
                    </div>
                  ) : null}
                  {place.notes ? (
                    <div
                      style={{ fontSize: 12, color: "#555", marginBottom: 8 }}
                    >
                      <strong>RV note:</strong> {place.notes}
                    </div>
                  ) : null}
                  <div
                    style={{
                      marginTop: 12,
                      display: "flex",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    <a
                      href={appleMapsUrl(place)}
                      target="_blank"
                      rel="noreferrer"
                      style={popupButtonStyle}
                    >
                      Apple Maps
                    </a>

                    <a
                      href={googleMapsUrl(place)}
                      target="_blank"
                      rel="noreferrer"
                      style={popupButtonStyle}
                    >
                      Google Maps
                    </a>

                    {phoneHref ? (
                      <a href={`tel:${phoneHref}`} style={popupButtonStyle}>
                        Call
                      </a>
                    ) : null}

                    {websiteHref ? (
                      <a
                        href={websiteHref}
                        target="_blank"
                        rel="noreferrer"
                        style={popupButtonStyle}
                      >
                        Website
                      </a>
                    ) : null}
                  </div>
                  {typeof place.lat === "number" &&
                  Number.isFinite(place.lat) &&
                  typeof place.lng === "number" &&
                  Number.isFinite(place.lng) ? (
                    <div
                      style={{
                        width: "100%",
                        fontSize: 12,
                        color: "#4b5563",
                        marginTop: 8,
                      }}
                    >
                      Coordinates: {place.lat}, {place.lng}
                    </div>
                  ) : null}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
