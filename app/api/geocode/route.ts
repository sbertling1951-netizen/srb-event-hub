import { NextRequest, NextResponse } from "next/server";

function buildQuery(address?: string | null, location_code?: string | null) {
  const code = (location_code || "").trim();
  if (code) return code;

  const addr = (address || "").trim();
  if (addr) return addr;

  return "";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const address = body?.address ?? null;
    const location_code = body?.location_code ?? null;

    const query = buildQuery(address, location_code);

    if (!query) {
      return NextResponse.json(
        { error: "No address or location_code provided." },
        { status: 400 },
      );
    }

    const url = new URL("https://nominatim.openstreetmap.org/search");
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
      return NextResponse.json(
        { error: `Geocode request failed with ${response.status}` },
        { status: 502 },
      );
    }

    const results = await response.json();

    if (!Array.isArray(results) || results.length === 0) {
      return NextResponse.json(
        {
          lat: null,
          lng: null,
          queryUsed: query,
          found: false,
        },
        { status: 200 },
      );
    }

    const first = results[0];

    return NextResponse.json({
      lat: first?.lat ? Number(first.lat) : null,
      lng: first?.lon ? Number(first.lon) : null,
      queryUsed: query,
      found: true,
      display_name: first?.display_name || null,
    });
  } catch (err: any) {
    console.error("Geocode route error:", err);
    return NextResponse.json(
      { error: err?.message || "Geocode failed." },
      { status: 500 },
    );
  }
}
