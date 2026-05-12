export function buildAppleMapsUrl(
  address: string,
  lat?: number,
  lng?: number,
  label?: string,
) {
  const safeAddress = address.trim();
  const safeLabel = (label || safeAddress).trim();

  if (lat !== undefined && lng !== undefined) {
    return `https://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent(safeLabel)}`;
  }

  return `https://maps.apple.com/?q=${encodeURIComponent(safeLabel || safeAddress)}`;
}

export function buildGoogleMapsUrl(
  address: string,
  lat?: number,
  lng?: number,
) {
  const destination =
    lat !== undefined && lng !== undefined ? `${lat},${lng}` : address;

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
