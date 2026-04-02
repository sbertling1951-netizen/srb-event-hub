import { buildAppleMapsUrl, buildGoogleMapsUrl } from "@/lib/maps";
import { getBestLocationQuery } from "@/lib/location";

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

export default function LocationCard(props: Props) {
  const mapQuery = getBestLocationQuery({
    location_code: props.locationCode,
    address: props.address,
  });

  const appleMaps = buildAppleMapsUrl(
    mapQuery || props.address,
    props.latitude,
    props.longitude,
  );

  const googleMaps = buildGoogleMapsUrl(
    mapQuery || props.address,
    props.latitude,
    props.longitude,
  );

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

        {props.phone ? (
          <a className="button-secondary" href={`tel:${props.phone}`}>
            Call
          </a>
        ) : null}

        {props.website ? (
          <a
            className="button-secondary"
            href={props.website}
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
