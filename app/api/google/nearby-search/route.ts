import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const query = String(body?.query || "").trim();
    const city = String(body?.city || "").trim();
    const state = String(body?.state || "").trim();
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
        { error: "Missing GOOGLE_MAPS_API_KEY." },
        { status: 500 },
      );
    }

    const locationQuery = [city, state].filter(Boolean).join(", ");

    if (!locationQuery) {
      return NextResponse.json(
        { error: "Missing city/state for nearby search." },
        { status: 400 },
      );
    }

    // STEP 1: Geocode city/state
    const geocodeUrl = new URL(
      "https://maps.googleapis.com/maps/api/geocode/json",
    );

    geocodeUrl.searchParams.set("address", locationQuery);
    geocodeUrl.searchParams.set("key", apiKey);

    const geocodeResponse = await fetch(geocodeUrl.toString());
    const geocodeData = await geocodeResponse.json();

    const firstResult = geocodeData?.results?.[0];

    if (!firstResult) {
      return NextResponse.json(
        { error: "Could not geocode location." },
        { status: 400 },
      );
    }

    const lat = firstResult.geometry.location.lat;
    const lng = firstResult.geometry.location.lng;

    // STEP 2: Google Nearby Search
    const nearbyUrl = new URL(
      "https://maps.googleapis.com/maps/api/place/nearbysearch/json",
    );

    nearbyUrl.searchParams.set("keyword", query);
    nearbyUrl.searchParams.set("location", `${lat},${lng}`);
    nearbyUrl.searchParams.set("radius", String(radiusMiles * 1609));
    nearbyUrl.searchParams.set("key", apiKey);

    const nearbyResponse = await fetch(nearbyUrl.toString());
    const nearbyData = await nearbyResponse.json();

    const places = (nearbyData?.results || []).map((place: any) => ({
      id: place.place_id,
      name: place.name,
      address: place.vicinity || place.formatted_address || "",
      rating: place.rating,
      category: place.types?.[0] || null,
    }));

    return NextResponse.json({
      places,
      debug: {
        query,
        locationQuery,
        radiusMiles,
        lat,
        lng,
      },
    });
  } catch (err: any) {
    console.error("nearby-search route error:", err);

    return NextResponse.json(
      {
        error: err?.message || "Google nearby search failed.",
      },
      { status: 500 },
    );
  }
}
