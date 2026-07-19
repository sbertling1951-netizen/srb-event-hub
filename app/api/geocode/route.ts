import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const address = body?.address ?? null;
    const location_code = body?.location_code ?? null;
    const latInput = body?.lat ?? null;
    const lngInput = body?.lng ?? null;
    const previousAddress = body?.previousAddress ?? null;
    const previousLocationCode = body?.previousLocationCode ?? null;

    const code = (location_code || "").trim();
    const addr = (address || "").trim();
    const previousCode = String(previousLocationCode || "").trim();
    const previousAddr = String(previousAddress || "").trim();

    function toCoordinate(value: unknown) {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }

      if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }

      return null;
    }

    const existingLat = toCoordinate(latInput);
    const existingLng = toCoordinate(lngInput);
    const hasExistingCoordinates = existingLat !== null && existingLng !== null;
    const addressChanged =
      previousAddress !== null && previousAddress !== undefined
        ? previousAddr !== addr
        : false;
    const codeChanged =
      previousLocationCode !== null && previousLocationCode !== undefined
        ? previousCode !== code
        : false;

    if (!code && !addr) {
      return NextResponse.json(
        { error: "No address or location_code provided." },
        { status: 400 },
      );
    }

    async function tryGeocode(q: string, options?: { appendUsa?: boolean }) {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      const query =
        options?.appendUsa === false ? q : `${q}, USA`;
      url.searchParams.set("q", query);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "1");

      const response = await fetch(url.toString(), {
        headers: {
          "User-Agent": "FCOC-Event-Hub/1.0",
          "Accept-Language": "en-US,en;q=0.9",
        },
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Geocode request failed with ${response.status}`);
      }

      const results = await response.json();

      if (!Array.isArray(results) || results.length === 0) {
        return { lat: null, lng: null, display_name: null };
      }

      const first = results[0];

      return {
        lat: first?.lat ? Number(first.lat) : null,
        lng: first?.lon ? Number(first.lon) : null,
        display_name: first?.display_name || null,
      };
    }

    // Lookup flow:
    // Existing Coordinates
    //     ↓
    // Street Address
    //     ↓
    // Plus Code
    //     ↓
    // Failure
    let result: {
      lat: number | null;
      lng: number | null;
      display_name: string | null;
    } = {
      lat: null,
      lng: null,
      display_name: null,
    };
    let queryUsed: string | null = null;

    if (hasExistingCoordinates && !addressChanged && !codeChanged) {
      result = {
        lat: existingLat,
        lng: existingLng,
        display_name: null,
      };
    }

    if ((result.lat === null || result.lng === null) && addr) {
      const addressResult = await tryGeocode(addr, { appendUsa: true });
      if (addressResult.lat !== null && addressResult.lng !== null) {
        result = addressResult;
        queryUsed = addr;
      }
    }

    if ((result.lat === null || result.lng === null) && code) {
      const plusCodeResult = await tryGeocode(code, { appendUsa: false });
      if (plusCodeResult.lat !== null && plusCodeResult.lng !== null) {
        result = plusCodeResult;
        queryUsed = code;
      }
    }

    return NextResponse.json({
      lat: result.lat,
      lng: result.lng,
      queryUsed,
      found: result.lat !== null && result.lng !== null,
      display_name: result.display_name,
    });
  } catch (err: any) {
    console.error("Geocode route error:", err);
    return NextResponse.json(
      { error: err?.message || "Geocode failed." },
      { status: 500 },
    );
  }
}
