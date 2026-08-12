import { NextResponse } from "next/server";

import { resolveAndLinkAdminIdentity } from "@/lib/server/adminIdentityLinkage";
import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";

// Bearer-authenticated, self-only identity-linkage check. Operates only
// on the authenticated caller -- there is no target-admin parameter, so
// this endpoint can never link another administrator. Idempotent: safe
// to call on every admin workspace session bootstrap.
export async function POST(req: Request) {
  try {
    const bearerToken = req.headers
      .get("authorization")
      ?.match(/^Bearer\s+(.+)$/i)?.[1];

    if (!bearerToken) {
      return NextResponse.json(
        { error: "Authentication is required." },
        { status: 401 },
      );
    }

    const supabaseAdmin = getSupabaseAdminClient();

    if (!supabaseAdmin) {
      return NextResponse.json(
        { error: "Identity linkage service is unavailable." },
        { status: 500 },
      );
    }

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(bearerToken);

    if (authError || !user?.id) {
      return NextResponse.json(
        { error: "Authentication is required." },
        { status: 401 },
      );
    }

    const result = await resolveAndLinkAdminIdentity(supabaseAdmin, {
      id: user.id,
      email: user.email,
    });

    if (result.status === "linked" || result.status === "already_linked") {
      return NextResponse.json({ status: result.status });
    }

    if (result.status === "ambiguous" || result.status === "conflict") {
      return NextResponse.json({ status: result.status, error: result.reason });
    }

    return NextResponse.json({ status: "no_admin_found" });
  } catch {
    return NextResponse.json(
      { error: "Identity linkage could not be completed." },
      { status: 500 },
    );
  }
}
