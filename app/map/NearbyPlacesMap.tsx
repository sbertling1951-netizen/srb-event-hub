"use client";

type Place = {
  id: string;
  name: string;
  address: string | null;
  lat?: number | null;
  lng?: number | null;
};

type NearbyPlacesMapProps = {
  places?: Place[];
};

export default function NearbyPlacesMap(_props: NearbyPlacesMapProps) {
  return null;
}
