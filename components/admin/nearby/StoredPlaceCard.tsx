"use client";

type StoredPlace = {
  id: string;
  name: string;
  category: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  location_code: string | null;
  lat: number | null;
  lng: number | null;
};

function getCoordinateStatus(
  lat: number | null | undefined,
  lng: number | null | undefined,
  locationCode?: string | null,
) {
  const hasCoordinates =
    lat !== null && lat !== undefined && lng !== null && lng !== undefined;

  if (!hasCoordinates) {
    return {
      label: "🟡 Needs Geocode",
      background: "#fff7d6",
      border: "1px solid #f0c36d",
      color: "#7a5200",
    };
  }

  if (locationCode?.trim()) {
    return {
      label: "🟢 Plus Code",
      background: "#ecfdf3",
      border: "1px solid #86efac",
      color: "#166534",
    };
  }

  return {
    label: "🔵 GPS Ready",
    background: "#e8f1ff",
    border: "1px solid #93c5fd",
    color: "#1d4ed8",
  };
}

export default function StoredPlaceCard(props: {
  place: StoredPlace;
  selected: boolean;
  isDuplicate: boolean;
  onSelect: () => void;
}) {
  const { place, selected, isDuplicate, onSelect } = props;

  const coordinateStatus = getCoordinateStatus(
    place.lat,
    place.lng,
    place.location_code,
  );

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        textAlign: "left",
        padding: 10,
        borderRadius: 10,
        border: selected ? "2px solid #2563eb" : "1px solid #dbe3ee",
        background: selected ? "#eff6ff" : "#ffffff",
        cursor: "pointer",
        display: "grid",
        gap: 6,
      }}
    >
      <div style={{ fontWeight: 700 }}>{place.name}</div>

      {isDuplicate ? (
        <div
          style={{
            marginTop: 6,
            display: "inline-block",
            padding: "2px 8px",
            borderRadius: 999,
            background: "#fee2e2",
            color: "#991b1b",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          Possible Duplicate
        </div>
      ) : null}

      <div style={{ fontSize: 13, color: "#555" }}>
        {place.category || "Uncategorized"}
      </div>

      <div
        style={{
          fontSize: 11,
          background: coordinateStatus.background,
          border: coordinateStatus.border,
          color: coordinateStatus.color,
          borderRadius: 999,
          padding: "3px 8px",
          display: "inline-flex",
          width: "fit-content",
          marginTop: 6,
          fontWeight: 600,
        }}
      >
        {coordinateStatus.label}
      </div>

      {place.address ? (
        <div
          style={{
            fontSize: 12,
            color: "#666",
            marginTop: 4,
          }}
        >
          {place.address}
        </div>
      ) : null}
    </button>
  );
}
