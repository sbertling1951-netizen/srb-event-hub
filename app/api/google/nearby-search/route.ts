import { NextResponse } from "next/server";

type GoogleResponse = {
  status?: string;
};

type GoogleGeocodeResponse = GoogleResponse & {
  results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
};

type GoogleNearbyResponse = GoogleResponse & {
  results?: Array<{
    place_id?: string;
    name?: string;
    vicinity?: string;
    formatted_address?: string;
    rating?: number;
    types?: string[];
    geometry?: { location?: { lat?: number; lng?: number } };
  }>;
};

function googleFailure(
  service: "geocoding" | "nearby search",
  response: Response,
  data: GoogleResponse,
) {
  const googleStatus = data.status || "UNKNOWN_ERROR";
  const code = `google_${service.replace(/ /g, "_")}_${googleStatus.toLowerCase()}`;

  console.error(`Google ${service} request failed.`, {
    upstreamHttpStatus: response.status,
    googleStatus,
  });

  if (googleStatus === "REQUEST_DENIED") {
    return NextResponse.json(
      {
        error: `Google ${service} request was denied. Check the server Google Maps API configuration.`,
        code,
      },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      error: `Google ${service} request failed (${googleStatus}).`,
      code,
    },
    { status: 502 },
  );
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const query = String(body?.query || "").trim();
    const location = String(body?.location || "").trim();
    const radiusMiles = Number(body?.radiusMiles || 10);

    if (!query) {
      return NextResponse.json(
        { error: "Missing Google search query." },
        { status: 400 },
      );
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error: "Google nearby search is unavailable because its server credential is not configured.",
          code: "missing_google_maps_api_key",
        },
        { status: 500 },
      );
    }

    if (!location) {
      return NextResponse.json(
        { error: "Missing Event location for nearby search." },
        { status: 400 },
      );
    }

    const geocodeUrl = new URL(
      "https://maps.googleapis.com/maps/api/geocode/json",
    );

    geocodeUrl.searchParams.set("address", location);
    geocodeUrl.searchParams.set("key", apiKey);

    const geocodeResponse = await fetch(geocodeUrl.toString());
    const geocodeData = (await geocodeResponse.json()) as GoogleGeocodeResponse;

    if (!geocodeResponse.ok || geocodeData.status !== "OK") {
      return googleFailure("geocoding", geocodeResponse, geocodeData);
    }

    const firstResult = geocodeData?.results?.[0];

    if (
      !firstResult?.geometry?.location
      || typeof firstResult.geometry.location.lat !== "number"
      || typeof firstResult.geometry.location.lng !== "number"
    ) {
      return NextResponse.json(
        {
          error: "Google could not resolve coordinates for the Event location.",
          code: "google_geocoding_missing_coordinates",
        },
        { status: 422 },
      );
    }

    const lat = firstResult.geometry.location.lat;
    const lng = firstResult.geometry.location.lng;

    const nearbyUrl = new URL(
      "https://maps.googleapis.com/maps/api/place/nearbysearch/json",
    );

    nearbyUrl.searchParams.set("keyword", query);
    nearbyUrl.searchParams.set("location", `${lat},${lng}`);
    nearbyUrl.searchParams.set("radius", String(radiusMiles * 1609));
    nearbyUrl.searchParams.set("key", apiKey);

    const nearbyResponse = await fetch(nearbyUrl.toString());
    const nearbyData = (await nearbyResponse.json()) as GoogleNearbyResponse;

    if (
      !nearbyResponse.ok
      || (nearbyData.status !== "OK" && nearbyData.status !== "ZERO_RESULTS")
    ) {
      return googleFailure("nearby search", nearbyResponse, nearbyData);
    }

    const places = (nearbyData.results || []).map((place) => ({
      id: place.place_id,
      name: place.name,
      address: place.vicinity || place.formatted_address || "",
      rating: place.rating,
      category: place.types?.[0] || null,
      lat:
        typeof place.geometry?.location?.lat === "number"
          ? place.geometry.location.lat
          : null,
      lng:
        typeof place.geometry?.location?.lng === "number"
          ? place.geometry.location.lng
          : null,
    }));

    return NextResponse.json({
      places,
      debug: {
        query,
        location,
        radiusMiles,
        lat,
        lng,
      },
    });
  } catch (err: unknown) {
    console.error("nearby-search route error:", err);

    return NextResponse.json(
      {
        error: "Google nearby search could not be completed.",
        code: "google_nearby_search_unavailable",
      },
      { status: 500 },
    );
  }
}
