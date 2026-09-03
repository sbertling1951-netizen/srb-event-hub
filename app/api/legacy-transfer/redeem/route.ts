import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";
import { CANONICAL_VENDOR_AUTH_COOKIE } from "@/lib/server/vendorAccess";

// Legacy Login Transfer -- canonical redemption boundary (Stage 3B).
//
// Destination-authority invariant: destination_path returned by
// redeem_legacy_login_transfer was already made canonical, exactly once,
// by validateTransferDestination() inside /api/legacy-transfer/initiate.
// This handler copies it into the response byte-for-byte -- no decode,
// no normalization, no re-validation.

function secureCookieEnabled() {
  return process.env.NODE_ENV === "production";
}

function anonClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return null;
  }

  return createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

type RedeemRow = {
  outcome: string;
  auth_user_id: string | null;
  person_id: string | null;
  role_class: string | null;
  supabase_hashed_token: string | null;
  destination_path: string | null;
};

function jsonNoStore(body: object) {
  return NextResponse.json(body, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request) {
  const fail = () => jsonNoStore({ ok: false });

  try {
    let body: { token?: unknown } = {};
    try {
      body = await req.json();
    } catch {
      return fail();
    }

    // Only the raw transfer token is ever accepted from the client --
    // never destination, user id, role, email, or session credentials.
    const token = typeof body.token === "string" ? body.token : "";
    if (!token) {
      return fail();
    }

    const supabaseAdmin = getSupabaseAdminClient();
    if (!supabaseAdmin) {
      return fail();
    }

    const { data, error } = await supabaseAdmin.rpc(
      "redeem_legacy_login_transfer",
      { p_presented_token: token },
    );

    if (error || !Array.isArray(data) || data.length !== 1) {
      return fail();
    }

    const row = data[0] as RedeemRow;

    // Unknown, malformed, expired, and already-consumed tokens all
    // produce the identical generic outcome from Stage 1 -- never
    // distinguished here either.
    if (
      row.outcome !== "ok" ||
      !row.supabase_hashed_token ||
      !row.role_class
    ) {
      return fail();
    }

    const anon = anonClient();
    if (!anon) {
      return fail();
    }

    const { data: verifyData, error: verifyError } = await anon.auth.verifyOtp({
      token_hash: row.supabase_hashed_token,
      type: "magiclink",
    });

    if (verifyError || !verifyData?.session) {
      // The transfer row is already consumed (Stage 1's atomic UPDATE
      // already ran); it is never "unconsumed" on a downstream failure.
      return fail();
    }

    // Type-safety only: the column is NOT NULL for every 'ok' row, so this
    // branch is unreachable in practice, not a second safety fallback.
    const destination = row.destination_path ?? "/";

    if (row.role_class === "vendor") {
      const response = jsonNoStore({ ok: true, destination });
      // Stage B: a transferred vendor session lands on the canonical
      // epicentrax.com origin (the transfer URL is built with CANONICAL_HOST),
      // and this response's Set-Cookie is scoped host-only to that origin.
      // Downstream vendor reads are canonical-first with legacy fallback, so
      // only the canonical cookie is minted here -- no new fcoc-vendor-*
      // cookie. Legacy cookies already in browsers still resolve via the
      // fallback, and logout still expires both name sets.
      response.cookies.set({
        name: CANONICAL_VENDOR_AUTH_COOKIE,
        value: verifyData.session.access_token,
        httpOnly: true,
        secure: secureCookieEnabled(),
        sameSite: "lax",
        path: "/",
      });
      return response;
    }

    return jsonNoStore({
      ok: true,
      access_token: verifyData.session.access_token,
      refresh_token: verifyData.session.refresh_token,
      destination,
    });
  } catch (err) {
    console.error(
      "legacy-transfer redeem failed:",
      err instanceof Error ? err.message : "unknown error",
    );
    return fail();
  }
}
