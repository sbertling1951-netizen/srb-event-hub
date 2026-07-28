import { getBestLocationQuery } from "@/lib/location";
import { buildAppleMapsUrl, buildGoogleMapsUrl } from "@/lib/maps";

export type LocationCardProps = {
  name: string;
  address: string;
  phone?: string;
  website?: string;
  latitude?: number;
  longitude?: number;
  category?: string;
  rvNote?: string;
  locationCode?: string;
};

function cleanPhone(phone?: string) {
  if (!phone) {
    return "";
  }
  return phone.replace(/[^\d+]/g, "");
}

function normalizeWebsite(url?: string) {
  if (!url) {
    return "";
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

export default function LocationCard(props: LocationCardProps) {
  const mapQuery = getBestLocationQuery({
    location_code: props.locationCode,
    address: props.address,
  });

  const destinationQuery =
    mapQuery || props.address?.trim() || props.name?.trim() || "";

  const appleMaps = destinationQuery
    ? buildAppleMapsUrl(
        destinationQuery,
        props.latitude,
        props.longitude,
        props.name,
      )
    : "";

  const googleMaps = destinationQuery
    ? buildGoogleMapsUrl(destinationQuery, props.latitude, props.longitude)
    : "";

  const phoneHref = cleanPhone(props.phone);
  const websiteHref = normalizeWebsite(props.website);

  return (
    <div className="card">
      <div className="app-row-between-wrap">
        <div>
          <h3>{props.name}</h3>
          {props.category ? (
            <div className="app-muted-text small">{props.category}</div>
          ) : null}
        </div>
      </div>

      <p className="small">{props.address}</p>

      {props.locationCode ? (
        <p className="small">📍 {props.locationCode}</p>
      ) : null}

      {props.rvNote ? (
        <p className="small">
          <strong>RV note:</strong> {props.rvNote}
        </p>
      ) : null}

      <div className="location-actions">
        {appleMaps ? (
          <a
            className="app-button app-button-muted"
            href={appleMaps}
            target="_blank"
            rel="noreferrer"
          >
            Apple Maps
          </a>
        ) : null}

        {googleMaps ? (
          <a
            className="app-button app-button-muted"
            href={googleMaps}
            target="_blank"
            rel="noreferrer"
          >
            Google Maps
          </a>
        ) : null}

        {phoneHref ? (
          <a className="app-button app-button-muted" href={`tel:${phoneHref}`}>
            Call
          </a>
        ) : null}

        {websiteHref ? (
          <a
            className="app-button app-button-muted"
            href={websiteHref}
            target="_blank"
            rel="noreferrer"
          >
            Website
          </a>
        ) : null}
      </div>
    </div>
  );
}
