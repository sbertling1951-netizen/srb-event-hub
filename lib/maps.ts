export function buildAppleMapsUrl(address: string, lat?: number, lng?: number) {
  if (lat && lng) {
    return `https://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent(address)}`;
  }
  return `https://maps.apple.com/?q=${encodeURIComponent(address)}`;
}

export function buildGoogleMapsUrl(address: string, lat?: number, lng?: number) {
  const destination = lat && lng ? `${lat},${lng}` : address;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
