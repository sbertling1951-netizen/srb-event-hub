import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const address = String(body?.address || "").trim();

    if (!address) {
      return NextResponse.json(
        { error: "Address is required." },
        { status: 400 },
      );
    }

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", address);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");

    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "FCOC-Event-Hub/1.0",
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Geocoder failed: ${response.status}` },
        { status: 502 },
      );
    }

    const results = await response.json();

    const first = results?.[0];
    const lat = first?.lat ? Number(first.lat) : null;
    const lng = first?.lon ? Number(first.lon) : null;

    return NextResponse.json({
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
    });
  } catch (err) {
    console.error("geocode error:", err);
    return NextResponse.json(
      { error: "Failed to geocode address." },
      { status: 500 },
    );
  }
}
