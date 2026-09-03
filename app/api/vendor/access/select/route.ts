import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  CANONICAL_VENDOR_SELECTED_COOKIE,
  resolveVendorAccessFromCookies,
} from "@/lib/server/vendorAccess";

type SelectBody = {
  vendorId?: string;
};

function secureCookieEnabled() {
  return process.env.NODE_ENV === "production";
}

export async function POST(req: Request) {
  let body: SelectBody;

  try {
    body = (await req.json()) as SelectBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const vendorId = String(body.vendorId || "").trim();
  if (!vendorId) {
    return NextResponse.json(
      { ok: false, error: "vendorId is required." },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const resolved = await resolveVendorAccessFromCookies(cookieStore);
  if (!resolved.ok) {
    return NextResponse.json(
      { ok: false, error: resolved.message, reason: resolved.reason },
      { status: resolved.status },
    );
  }

  const hasVendor = resolved.context.permittedVendors.some(
    (entry) => entry.vendorId === vendorId,
  );

  if (!hasVendor) {
    return NextResponse.json(
      { ok: false, error: "You do not have access to the selected vendor." },
      { status: 403 },
    );
  }

  const response = NextResponse.json({ ok: true, vendorId });
  // Stage B: issue the canonical (neutral) selected-vendor cookie only. The
  // resolver still reads canonical-first with legacy fallback and logout/DELETE
  // still clears both name sets, so no new legacy-named vendor cookie is minted.
  response.cookies.set({
    name: CANONICAL_VENDOR_SELECTED_COOKIE,
    value: vendorId,
    httpOnly: true,
    secure: secureCookieEnabled(),
    sameSite: "lax",
    path: "/",
  });

  return response;
}
