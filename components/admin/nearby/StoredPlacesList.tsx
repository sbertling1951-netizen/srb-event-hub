"use client";

import StoredPlaceCard from "./StoredPlaceCard";

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

export default function StoredPlacesList(props: {
  loadingStoredPlaces: boolean;
  sortedStoredPlaces: StoredPlace[];
  selectedPlaceId: string;
  duplicateKeys: Map<string, number>;
  onSelectPlace: (place: StoredPlace) => void;
}) {
  const {
    loadingStoredPlaces,
    sortedStoredPlaces,
    selectedPlaceId,
    duplicateKeys,
    onSelectPlace,
  } = props;

  return (
    <div className="app-scroll-list">
      {loadingStoredPlaces ? (
        <div>Loading stored places...</div>
      ) : sortedStoredPlaces.length === 0 ? (
        <div>No places found in this stored area.</div>
      ) : (
        sortedStoredPlaces.map((place) => {
          const duplicateKey = `${String(place.name || "")
            .trim()
            .toLowerCase()}|${String(place.address || "")
            .trim()
            .toLowerCase()}`;

          const isDuplicate = (duplicateKeys.get(duplicateKey) || 0) > 1;

          return (
            <StoredPlaceCard
              key={place.id}
              place={place}
              selected={selectedPlaceId === place.id}
              isDuplicate={isDuplicate}
              onSelect={() => onSelectPlace(place)}
            />
          );
        })
      )}
    </div>
  );
}
