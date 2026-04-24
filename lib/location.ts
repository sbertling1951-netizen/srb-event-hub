export function getBestLocationQuery(input: {
  location_code?: string | null;
  address?: string | null;
}): string | null {
  const code = input.location_code?.trim();
  if (code) {return code;}

  const address = input.address?.trim();
  if (address) {return address;}

  return null;
}

export function hasLatLng(input: {
  lat?: number | null;
  lng?: number | null;
}): boolean {
  return (
    typeof input.lat === "number" &&
    !Number.isNaN(input.lat) &&
    typeof input.lng === "number" &&
    !Number.isNaN(input.lng)
  );
}
