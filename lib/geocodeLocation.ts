export async function geocodeLocation(input: {
  address?: string | null;
  location_code?: string | null;
}): Promise<{ lat: number | null; lng: number | null }> {
  try {
    const response = await fetch("/api/geocode", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        address: input.address ?? null,
        location_code: input.location_code ?? null,
      }),
    });

    if (!response.ok) {
      return { lat: null, lng: null };
    }

    const data = await response.json();

    return {
      lat: typeof data?.lat === "number" ? data.lat : null,
      lng: typeof data?.lng === "number" ? data.lng : null,
    };
  } catch {
    return { lat: null, lng: null };
  }
}
