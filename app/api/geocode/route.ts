import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const address = body?.address ?? null;
    const location_code = body?.location_code ?? null;

    const code = (location_code || "").trim();
    const addr = (address || "").trim();

    if (!code && !addr) {
      return NextResponse.json(
        { error: "No address or location_code provided." },
        { status: 400 },
      );
    }

    async function tryGeocode(q: string) {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("q", q);
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

    // 1) Try plus code first
    if (code) {
      result = await tryGeocode(code);
      if (result.lat !== null && result.lng !== null) {
        queryUsed = code;
      }
    }

    // 2) Fallback to address
    if ((result.lat === null || result.lng === null) && addr) {
      const fallback = await tryGeocode(addr);
      if (fallback.lat !== null && fallback.lng !== null) {
        result = fallback;
        queryUsed = addr;
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
