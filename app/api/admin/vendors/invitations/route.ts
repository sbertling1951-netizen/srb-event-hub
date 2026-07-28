import { NextResponse } from "next/server";

import {
  adminCanManageEvent,
  adminHasPermission,
  resolveAdminActorFromBearer,
} from "@/lib/server/adminAuthz";
import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";

type InviteAction = "invite" | "resend" | "revoke";

type InviteBody = {
  action?: InviteAction;
  vendorId?: string;
  eventId?: string | null;
  contact?: {
    id?: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string;
    mobilePhone?: string | null;
    roleTitle?: string | null;
    isPrimary?: boolean;
  };
  accessRole?: "vendor_admin" | "vendor_member";
  accessId?: string;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || "";
}

export async function GET(req: Request) {
  const adminResolved = await resolveAdminActorFromBearer(
    req.headers.get("authorization"),
  );

  if (!adminResolved.admin) {
    return NextResponse.json(
      { ok: false, error: adminResolved.error },
      { status: adminResolved.status || 401 },
    );
  }

  if (!adminHasPermission(adminResolved.admin, "can_manage_vendors")) {
    return NextResponse.json(
      { ok: false, error: "Vendor management permission is required." },
      { status: 403 },
    );
  }

  const supabaseAdmin = getSupabaseAdminClient();
  if (!supabaseAdmin) {
    return NextResponse.json(
      { ok: false, error: "Vendor invitation service is not configured." },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  const vendorId = (url.searchParams.get("vendorId") || "").trim();

  const vendorQuery = supabaseAdmin
    .from("vendors")
    .select("id,business_name,is_active")
    .order("business_name", { ascending: true });

  if (vendorId) {
    vendorQuery.eq("id", vendorId);
  }

  const { data: vendors, error: vendorError } = await vendorQuery;
  if (vendorError) {
    return NextResponse.json(
      { ok: false, error: vendorError.message },
      { status: 500 },
    );
  }

  const { data: contacts, error: contactError } = await supabaseAdmin
    .from("vendor_contacts")
    .select(
      "id,vendor_id,first_name,last_name,email,mobile_phone,role_title,is_primary,status,created_at,updated_at",
    )
    .order("created_at", { ascending: true });

  if (contactError) {
    return NextResponse.json(
      { ok: false, error: contactError.message },
      { status: 500 },
    );
  }

  const { data: accessRows, error: accessError } = await supabaseAdmin
    .from("vendor_org_access")
    .select(
      "id,vendor_id,vendor_contact_id,person_id,auth_user_id,invitation_email,access_role,status,invited_for_event_id,invited_at,accepted_at,revoked_at,created_at,updated_at",
    )
    .order("created_at", { ascending: false });

  if (accessError) {
    return NextResponse.json(
      { ok: false, error: accessError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    vendors: vendors || [],
    contacts: contacts || [],
    access: accessRows || [],
  });
}

export async function POST(req: Request) {
  const adminResolved = await resolveAdminActorFromBearer(
    req.headers.get("authorization"),
  );

  if (!adminResolved.admin) {
    return NextResponse.json(
      { ok: false, error: adminResolved.error },
      { status: adminResolved.status || 401 },
    );
  }

  if (!adminHasPermission(adminResolved.admin, "can_manage_vendors")) {
    return NextResponse.json(
      { ok: false, error: "Vendor management permission is required." },
      { status: 403 },
    );
  }

  let body: InviteBody;
  try {
    body = (await req.json()) as InviteBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const action: InviteAction = body.action || "invite";

  const supabaseAdmin = getSupabaseAdminClient();
  if (!supabaseAdmin) {
    return NextResponse.json(
      { ok: false, error: "Vendor invitation service is not configured." },
      { status: 500 },
    );
  }

  if (action === "revoke") {
    const accessId = String(body.accessId || "").trim();
    if (!accessId) {
      return NextResponse.json(
        { ok: false, error: "accessId is required for revoke." },
        { status: 400 },
      );
    }

    const { data: existingAccess, error: accessLookupError } =
      await supabaseAdmin
        .from("vendor_org_access")
        .select("id,vendor_id,invited_for_event_id,status")
        .eq("id", accessId)
        .maybeSingle();

    if (accessLookupError) {
      return NextResponse.json(
        { ok: false, error: accessLookupError.message },
        { status: 500 },
      );
    }

    if (!existingAccess?.id) {
      return NextResponse.json(
        { ok: false, error: "Vendor access record not found." },
        { status: 404 },
      );
    }

    if (existingAccess.invited_for_event_id) {
      const canManage = await adminCanManageEvent(
        adminResolved.admin,
        existingAccess.invited_for_event_id,
      );
      if (!canManage) {
        return NextResponse.json(
          { ok: false, error: "You do not have access to this event." },
          { status: 403 },
        );
      }
    }

    const { error: revokeError } = await supabaseAdmin
      .from("vendor_org_access")
      .update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
        revoked_by_admin_user_id: adminResolved.admin.adminUserId,
      })
      .eq("id", accessId);

    if (revokeError) {
      return NextResponse.json(
        { ok: false, error: revokeError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, action: "revoke", accessId });
  }

  const vendorId = String(body.vendorId || "").trim();
  const eventId = body.eventId ? String(body.eventId).trim() : "";
  const accessRole = body.accessRole || "vendor_member";
  const contact = body.contact || {};
  const contactEmail = normalizeEmail(String(contact.email || ""));

  if (!vendorId) {
    return NextResponse.json(
      { ok: false, error: "vendorId is required." },
      { status: 400 },
    );
  }

  if (!contactEmail) {
    return NextResponse.json(
      { ok: false, error: "Contact email is required." },
      { status: 400 },
    );
  }

  if (eventId) {
    const canManageEvent = await adminCanManageEvent(
      adminResolved.admin,
      eventId,
    );
    if (!canManageEvent) {
      return NextResponse.json(
        { ok: false, error: "You do not have access to this event." },
        { status: 403 },
      );
    }
  }

  const { data: vendorRow, error: vendorError } = await supabaseAdmin
    .from("vendors")
    .select("id,business_name")
    .eq("id", vendorId)
    .maybeSingle();

  if (vendorError) {
    return NextResponse.json(
      { ok: false, error: vendorError.message },
      { status: 500 },
    );
  }

  if (!vendorRow?.id) {
    return NextResponse.json(
      { ok: false, error: "Vendor not found." },
      { status: 404 },
    );
  }

  let vendorContactId = String(contact.id || "").trim();

  if (vendorContactId) {
    const { data: existingContact, error: contactLookupError } =
      await supabaseAdmin
        .from("vendor_contacts")
        .select("id,vendor_id")
        .eq("id", vendorContactId)
        .maybeSingle();

    if (contactLookupError) {
      return NextResponse.json(
        { ok: false, error: contactLookupError.message },
        { status: 500 },
      );
    }

    if (!existingContact?.id || existingContact.vendor_id !== vendorId) {
      return NextResponse.json(
        { ok: false, error: "Vendor contact does not belong to vendor." },
        { status: 400 },
      );
    }
  } else {
    const { data: matchingContact } = await supabaseAdmin
      .from("vendor_contacts")
      .select("id")
      .eq("vendor_id", vendorId)
      .eq("email", contactEmail)
      .maybeSingle();

    if (matchingContact?.id) {
      vendorContactId = matchingContact.id;

      await supabaseAdmin
        .from("vendor_contacts")
        .update({
          first_name: contact.firstName?.trim() || null,
          last_name: contact.lastName?.trim() || null,
          mobile_phone: contact.mobilePhone?.trim() || null,
          role_title: contact.roleTitle?.trim() || null,
          is_primary: !!contact.isPrimary,
          status: "active",
        })
        .eq("id", vendorContactId);
    } else {
      const { data: createdContact, error: createContactError } =
        await supabaseAdmin
          .from("vendor_contacts")
          .insert({
            vendor_id: vendorId,
            first_name: contact.firstName?.trim() || null,
            last_name: contact.lastName?.trim() || null,
            email: contactEmail,
            mobile_phone: contact.mobilePhone?.trim() || null,
            role_title: contact.roleTitle?.trim() || null,
            is_primary: !!contact.isPrimary,
            status: "active",
            created_by_admin_user_id: adminResolved.admin.adminUserId,
          })
          .select("id")
          .single();

      if (createContactError || !createdContact?.id) {
        return NextResponse.json(
          {
            ok: false,
            error:
              createContactError?.message || "Could not create vendor contact.",
          },
          { status: 500 },
        );
      }

      vendorContactId = createdContact.id;
    }
  }

  const { data: existingAccess, error: existingAccessError } =
    await supabaseAdmin
      .from("vendor_org_access")
      .select(
        "id,status,auth_user_id,invitation_email,vendor_id,vendor_contact_id,access_role",
      )
      .eq("vendor_id", vendorId)
      .eq("invitation_email", contactEmail)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

  if (existingAccessError) {
    return NextResponse.json(
      { ok: false, error: existingAccessError.message },
      { status: 500 },
    );
  }

  const now = new Date().toISOString();
  let accessId = existingAccess?.id || "";

  if (!accessId) {
    const { data: inserted, error: insertAccessError } = await supabaseAdmin
      .from("vendor_org_access")
      .insert({
        vendor_id: vendorId,
        vendor_contact_id: vendorContactId,
        invitation_email: contactEmail,
        access_role: accessRole,
        status: "pending",
        invited_for_event_id: eventId || null,
        invited_at: now,
        created_by_admin_user_id: adminResolved.admin.adminUserId,
      })
      .select("id")
      .single();

    if (insertAccessError || !inserted?.id) {
      return NextResponse.json(
        {
          ok: false,
          error:
            insertAccessError?.message || "Could not create vendor access.",
        },
        { status: 500 },
      );
    }

    accessId = inserted.id;
  } else {
    const nextStatus =
      existingAccess?.status === "active" ? "active" : "pending";

    const { error: updateAccessError } = await supabaseAdmin
      .from("vendor_org_access")
      .update({
        vendor_contact_id: vendorContactId,
        access_role: accessRole,
        status: nextStatus,
        invited_for_event_id: eventId || null,
        invited_at: now,
        accepted_at: nextStatus === "pending" ? null : undefined,
        revoked_at: null,
        revoked_by_admin_user_id: null,
      })
      .eq("id", accessId);

    if (updateAccessError) {
      return NextResponse.json(
        { ok: false, error: updateAccessError.message },
        { status: 500 },
      );
    }
  }

  const redirectToBase = appUrl();
  const redirectTo = redirectToBase
    ? `${redirectToBase}/vendor/callback`
    : undefined;

  const {
    data: { user: invitedUser },
    error: inviteError,
  } = await supabaseAdmin.auth.admin.inviteUserByEmail(contactEmail, {
    redirectTo,
  });

  if (inviteError) {
    return NextResponse.json(
      { ok: false, error: `Invite failed: ${inviteError.message}` },
      { status: 400 },
    );
  }

  if (invitedUser?.id) {
    const { error: bindUserError } = await supabaseAdmin
      .from("vendor_org_access")
      .update({
        auth_user_id: invitedUser.id,
      })
      .eq("id", accessId)
      .eq("status", "pending");

    if (bindUserError) {
      return NextResponse.json(
        { ok: false, error: bindUserError.message },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    action,
    vendorId,
    vendorName: vendorRow.business_name || "Vendor",
    contactEmail,
    vendorContactId,
    accessId,
  });
}
