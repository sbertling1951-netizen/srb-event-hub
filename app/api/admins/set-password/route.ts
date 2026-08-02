import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import {
  adminHasPermission,
  resolveAdminActorFromBearer,
} from "@/lib/server/adminAuthz";

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

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

    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return NextResponse.json(
        { error: "Administrative password service is unavailable." },
        { status: 500 },
      );
    }

    const { userId, password } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }

    if (!password) {
      return NextResponse.json({ error: "Password required" }, { status: 400 });
    }

    const {
      data: { user: targetUser },
      error: targetUserError,
    } = await supabase.auth.admin.getUserById(userId);

    if (targetUserError || !targetUser) {
      return NextResponse.json(
        { error: "Administrative password could not be updated." },
        { status: 400 },
      );
    }

    const { data: targetAdminRows, error: targetAdminError } = await supabase
      .from("admin_users")
      .select("is_super_admin,privilege_group")
      .eq("user_id", userId);

    if (targetAdminError) {
      return NextResponse.json(
        { error: "Administrative password could not be updated." },
        { status: 500 },
      );
    }

    const { data: emailAdminRows, error: emailAdminError } = targetUser.email
      ? await supabase
          .from("admin_users")
          .select("is_super_admin,privilege_group")
          .eq("email", targetUser.email.trim().toLowerCase())
      : { data: [], error: null };

    if (emailAdminError) {
      return NextResponse.json(
        { error: "Administrative password could not be updated." },
        { status: 500 },
      );
    }

    const targetIsSuperAdmin = [...(targetAdminRows || []), ...(emailAdminRows || [])].some(
      (adminUser) =>
        adminUser.is_super_admin === true ||
        adminUser.privilege_group === "super_admin",
    );

    if (targetIsSuperAdmin && !adminResolved.admin.isSuperAdmin) {
      return NextResponse.json(
        { error: "Super administrator capability is required." },
        { status: 403 },
      );
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(
      userId,
      {
        password,
      },
    );

    if (updateError) {
      return NextResponse.json(
        { error: "Administrative password could not be updated." },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Administrative password could not be updated." },
      { status: 500 },
    );
  }
}
