import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type InviteAdminRequest = {
  email: string;
  display_name?: string | null;
  is_super_admin?: boolean;
  event_ids?: string[];
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const appUrl = process.env.NEXT_PUBLIC_APP_URL;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase environment variables.");
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as InviteAdminRequest;

    const email = normalizeEmail(body.email || "");
    const displayName = (body.display_name || "").trim() || null;
    const isSuperAdmin = !!body.is_super_admin;
    const eventIds = Array.isArray(body.event_ids)
      ? body.event_ids.filter(Boolean)
      : [];

    if (!email) {
      return NextResponse.json(
        { error: "Email is required." },
        { status: 400 },
      );
    }

    const redirectTo = appUrl ? `${appUrl}/admin/login` : undefined;

    const { data: inviteData, error: inviteError } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
      });

    if (inviteError) {
      return NextResponse.json(
        { error: `Invite failed: ${inviteError.message}` },
        { status: 400 },
      );
    }

    let invitedUserId: string | null = null;

    // fetch user from auth by email
    const { data: usersData, error: usersError } =
      await supabaseAdmin.auth.admin.listUsers();

    if (!usersError && usersData?.users) {
      const match = usersData.users.find(
        (u) => u.email?.toLowerCase() === email,
      );
      invitedUserId = match?.id || null;
    }
    const privilegeGroup = isSuperAdmin ? "super_admin" : "event_admin";

    const { data: adminRow, error: adminUpsertError } = await supabaseAdmin
      .from("admin_users")
      .upsert(
        {
          email,
          display_name: displayName,
          is_active: true,
          privilege_group: privilegeGroup,
          is_super_admin: isSuperAdmin,
          user_id: invitedUserId,
        },
        { onConflict: "email" },
      )
      .select("id,email")
      .single();

    if (adminUpsertError || !adminRow) {
      return NextResponse.json(
        {
          error: `Invite sent, but admin record failed: ${adminUpsertError?.message || "Unknown error"}`,
        },
        { status: 400 },
      );
    }

    if (!isSuperAdmin) {
      await supabaseAdmin
        .from("admin_event_access")
        .delete()
        .eq("admin_user_id", adminRow.id);
      if (eventIds.length > 0) {
        const rows = eventIds.map((eventId) => ({
          admin_user_id: adminRow.id,
          event_id: eventId,
        }));

        const { error: accessInsertError } = await supabaseAdmin
          .from("admin_event_access")
          .insert(rows);

        if (accessInsertError) {
          return NextResponse.json(
            {
              error: `Admin created, but could not assign event access: ${accessInsertError.message}`,
            },
            { status: 400 },
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Invite sent to ${email}.`,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Unexpected error.",
      },
      { status: 500 },
    );
  }
}
