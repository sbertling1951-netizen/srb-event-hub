import { NextResponse } from "next/server";

import {
  adminHasPermission,
  resolveAdminActorFromBearer,
} from "@/lib/server/adminAuthz";
import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";

const appUrl = process.env.NEXT_PUBLIC_APP_URL;

const PRIVILEGE_GROUPS = new Set([
  "super_admin",
  "event_admin",
  "checkin",
  "parking",
  "content_admin",
  "read_only",
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PrivilegeGroup =
  | "super_admin"
  | "event_admin"
  | "checkin"
  | "parking"
  | "content_admin"
  | "read_only";

type AdminManagementRequest = {
  adminUserId?: unknown;
  email?: unknown;
  displayName?: unknown;
  isActive?: unknown;
  privilegeGroup?: unknown;
};

type ManagedAdminRow = {
  id: string;
  email: string;
  user_id: string | null;
  is_active: boolean;
  is_super_admin: boolean;
  privilege_group: PrivilegeGroup;
};

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const email = value.trim().toLowerCase();
  return email ? email : null;
}

function normalizeDisplayName(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isSuperAdmin(row: Pick<ManagedAdminRow, "is_super_admin" | "privilege_group">) {
  return row.is_super_admin || row.privilege_group === "super_admin";
}

export async function POST(req: Request) {
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

  try {
    const body = (await req.json()) as AdminManagementRequest;
    const adminUserId =
      typeof body.adminUserId === "string" && UUID_PATTERN.test(body.adminUserId)
        ? body.adminUserId
        : null;
    const email = normalizeEmail(body.email);
    const privilegeGroup = body.privilegeGroup;

    if (!email || typeof privilegeGroup !== "string" || !PRIVILEGE_GROUPS.has(privilegeGroup)) {
      return NextResponse.json(
        { error: "Valid administrative user details are required." },
        { status: 400 },
      );
    }

    if (body.adminUserId !== undefined && !adminUserId) {
      return NextResponse.json(
        { error: "Valid administrative user details are required." },
        { status: 400 },
      );
    }

    const supabaseAdmin = getSupabaseAdminClient();

    if (!supabaseAdmin) {
      return NextResponse.json(
        { error: "Administrative management service is unavailable." },
        { status: 500 },
      );
    }

    let existingAdmin: ManagedAdminRow | null = null;

    if (adminUserId) {
      const { data, error } = await supabaseAdmin
        .from("admin_users")
        .select("id,email,user_id,is_active,is_super_admin,privilege_group")
        .eq("id", adminUserId)
        .maybeSingle<ManagedAdminRow>();

      if (error) {
        return NextResponse.json(
          { error: "Administrative user could not be saved." },
          { status: 500 },
        );
      }

      if (!data) {
        return NextResponse.json(
          { error: "Administrative user is not available." },
          { status: 404 },
        );
      }

      existingAdmin = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from("admin_users")
        .select("id,email,user_id,is_active,is_super_admin,privilege_group")
        .eq("email", email)
        .maybeSingle<ManagedAdminRow>();

      if (error) {
        return NextResponse.json(
          { error: "Administrative user could not be saved." },
          { status: 500 },
        );
      }

      if (data) {
        return NextResponse.json(
          { error: "An administrative user with that email already exists." },
          { status: 409 },
        );
      }
    }

    const requestedSuperAdmin = privilegeGroup === "super_admin";
    const existingSuperAdmin = existingAdmin ? isSuperAdmin(existingAdmin) : false;

    if (
      (requestedSuperAdmin || existingSuperAdmin) &&
      !adminResolved.admin.isSuperAdmin
    ) {
      return NextResponse.json(
        { error: "Super administrator capability is required." },
        { status: 403 },
      );
    }

    let linkedAuthUserId = existingAdmin?.user_id || null;
    let invitationSent = false;

    if (!linkedAuthUserId) {
      const { data: users, error: usersError } =
        await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });

      if (usersError) {
        return NextResponse.json(
          { error: "Administrative user could not be saved." },
          { status: 500 },
        );
      }

      const existingAuthUser = users.users.find(
        (user) => user.email?.toLowerCase() === email,
      );

      if (existingAuthUser) {
        linkedAuthUserId = existingAuthUser.id;
      } else {
        const redirectTo = appUrl ? `${appUrl}/admin/login` : undefined;
        const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
          email,
          { redirectTo },
        );

        if (error || !data.user?.id) {
          return NextResponse.json(
            { error: "Administrative user could not be saved." },
            { status: 500 },
          );
        }

        linkedAuthUserId = data.user.id;
        invitationSent = true;
      }
    }

    const values = {
      email,
      display_name: normalizeDisplayName(body.displayName),
      is_active:
        typeof body.isActive === "boolean"
          ? body.isActive
          : (existingAdmin?.is_active ?? true),
      privilege_group: privilegeGroup as PrivilegeGroup,
      is_super_admin: requestedSuperAdmin,
      user_id: linkedAuthUserId,
    };

    const mutation = existingAdmin
      ? supabaseAdmin
          .from("admin_users")
          .update(values)
          .eq("id", existingAdmin.id)
      : supabaseAdmin.from("admin_users").insert(values);

    const { data: savedAdmin, error: saveError } = await mutation
      .select("id,user_id")
      .single();

    if (saveError || !savedAdmin) {
      return NextResponse.json(
        { error: "Administrative user could not be saved." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      adminUserId: savedAdmin.id,
      authUserId: savedAdmin.user_id,
      invitationSent,
    });
  } catch {
    return NextResponse.json(
      { error: "Administrative user could not be saved." },
      { status: 500 },
    );
  }
}
