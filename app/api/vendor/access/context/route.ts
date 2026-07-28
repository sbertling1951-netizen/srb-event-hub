import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { resolveVendorAccessFromCookies } from "@/lib/server/vendorAccess";

export async function GET() {
  const cookieStore = await cookies();
  const resolved = await resolveVendorAccessFromCookies(cookieStore);

  if (!resolved.ok) {
    return NextResponse.json(
      {
        ok: false,
        reason: resolved.reason,
        message: resolved.message,
      },
      { status: resolved.status },
    );
  }

  return NextResponse.json({ ok: true, context: resolved.context });
}
