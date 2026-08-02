import { NextResponse } from "next/server";

import {
  adminHasPermission,
  resolveAdminActorFromBearer,
} from "@/lib/server/adminAuthz";
import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";

const appUrl = process.env.NEXT_PUBLIC_APP_URL;

export async function POST(req: Request) {
  try {
    const adminResolved = await resolveAdminActorFromBearer(
      req.headers.get("authorization"),
    );

    if (!adminResolved.admin) {
      return NextResponse.json(
        { error: "Administrative authentication is required." },
        { status: adminResolved.status || 401 },
      );
    }

    if (!adminHasPermission(adminResolved.admin, "can_manage_admins")) {
      return NextResponse.json(
        { error: "Administrative management permission is required." },
        { status: 403 },
      );
    }

    const supabaseAdmin = getSupabaseAdminClient();

    if (!supabaseAdmin) {
      return NextResponse.json(
        { error: "Administrative user service is unavailable." },
        { status: 500 },
      );
    }

    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }

    const normalizedEmail = email.toString().trim().toLowerCase();

    // Check if user already exists
    const { data: users } = await supabaseAdmin.auth.admin.listUsers();

    const existing = users?.users?.find(
      (u) => u.email?.toLowerCase() === normalizedEmail,
    );

    if (existing) {
      return NextResponse.json({
        ok: true,
        userId: existing.id,
        invitationSent: false,
      });
    }

    const redirectTo = appUrl ? `${appUrl}/admin/login` : undefined;

    // A newly invited administrator establishes their own credential through
    // Supabase's governed invitation flow; this route never creates a shared
    // or server-generated password.
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      normalizedEmail,
      { redirectTo },
    );

    if (error || !data?.user) {
      return NextResponse.json(
        { error: "Administrative user could not be created." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      userId: data.user?.id || null,
      invitationSent: true,
    });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
