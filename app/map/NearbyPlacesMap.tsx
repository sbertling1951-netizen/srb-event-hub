"use client";

type Place = {
  id: string;
  name: string;
  address: string | null;
  lat?: number | null;
  lng?: number | null;
};

type Props = {
  places?: Place[];
};

export default function NearbyPlacesMap({ places = [] }: Props) {
  const mappablePlaces = places.filter(
    (p) =>
      typeof p.lat === "number" &&
      !Number.isNaN(p.lat) &&
      typeof p.lng === "number" &&
      !Number.isNaN(p.lng),
  );

  if (mappablePlaces.length === 0) {
    return <div>No map locations available.</div>;
  }

  return (
    <div style={{ padding: 16, border: "1px solid #ddd", borderRadius: 10 }}>
      Legacy map component not in use.
    </div>
  );
}
