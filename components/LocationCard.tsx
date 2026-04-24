import { getBestLocationQuery } from "@/lib/location";
import { buildAppleMapsUrl, buildGoogleMapsUrl } from "@/lib/maps";

interface Props {
  name: string;
  address: string;
  phone?: string;
  website?: string;
  latitude?: number;
  longitude?: number;
  category?: string;
  rvNote?: string;
  locationCode?: string;
}

function cleanPhone(phone?: string) {
  if (!phone) {return "";}
  return phone.replace(/[^\d+]/g, "");
}

function normalizeWebsite(url?: string) {
  if (!url) {return "";}
  const trimmed = url.trim();
  if (!trimmed) {return "";}
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

export default function LocationCard(props: Props) {
  const mapQuery = getBestLocationQuery({
    location_code: props.locationCode,
    address: props.address,
  });

  const appleMaps = buildAppleMapsUrl(
    mapQuery || props.address || props.name,
    props.latitude,
    props.longitude,
  );

  const googleMaps = buildGoogleMapsUrl(
    mapQuery || props.address || props.name,
    props.latitude,
    props.longitude,
  );

  const phoneHref = cleanPhone(props.phone);
  const websiteHref = normalizeWebsite(props.website);

  return (
    <div className="card">
      <div className="spread">
        <div>
          <h3>{props.name}</h3>
          {props.category ? (
            <div className="muted small">{props.category}</div>
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
        <a
          className="button-secondary"
          href={appleMaps}
          target="_blank"
          rel="noreferrer"
        >
          Apple Maps
        </a>

        <a
          className="button-secondary"
          href={googleMaps}
          target="_blank"
          rel="noreferrer"
        >
          Google Maps
        </a>

        {phoneHref ? (
          <a className="button-secondary" href={`tel:${phoneHref}`}>
            Call
          </a>
        ) : null}

        {websiteHref ? (
          <a
            className="button-secondary"
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
