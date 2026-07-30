import { NextResponse } from "next/server";

import { emailEnabled, resend } from "@/lib/email";
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

// GoTrue returns this when inviteUserByEmail targets an email that already
// has a confirmed account. That is not a failure for our purposes -- it is
// exactly the "existing EpicentraX account" case the invitation flow must
// support -- so it is detected and handled, not just surfaced as an error.
function isAlreadyRegisteredError(
  error: { code?: string; message?: string } | null | undefined,
) {
  if (!error) {
    return false;
  }
  if (error.code === "email_exists" || error.code === "user_already_exists") {
    return true;
  }
  return /already.*(registered|exists)/i.test(error.message || "");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Renders a real HTML call-to-action button so the raw Supabase verification
// URL is never the only thing a recipient sees. The plain-text part still
// contains the literal link -- that is the correct, expected fallback for
// clients that don't render HTML, not a bug.
function buildVendorAccessEmail(params: { vendorName: string; actionLink: string }) {
  const safeVendorName = escapeHtml(params.vendorName);
  const safeLink = escapeHtml(params.actionLink);

  const text = [
    `You have been granted vendor access to ${params.vendorName} on EpicentraX.`,
    "",
    "This email address already has an EpicentraX account. Use the link below to activate vendor access:",
    params.actionLink,
    "",
    "If you did not expect this, you can ignore this email.",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #111;">
      <p>You have been granted vendor access to <strong>${safeVendorName}</strong> on EpicentraX.</p>
      <p>This email address already has an EpicentraX account. Activate vendor access below:</p>
      <p style="text-align: center; margin: 28px 0;">
        <a href="${safeLink}" style="background-color: #2563eb; color: #ffffff; text-decoration: none; font-weight: 700; padding: 12px 24px; border-radius: 8px; display: inline-block;">
          Activate Vendor Access
        </a>
      </p>
      <p style="font-size: 13px; color: #555;">
        If the button above does not work, copy and paste this link into your browser:<br />
        <a href="${safeLink}" style="color: #2563eb;">${safeLink}</a>
      </p>
      <p style="font-size: 13px; color: #777;">If you did not expect this, you can ignore this email.</p>
    </div>
  `.trim();

  return { text, html };
}

async function sendVendorAccessNotificationEmail(params: {
  to: string;
  vendorName: string;
  actionLink: string;
}): Promise<boolean> {
  if (!emailEnabled() || !resend) {
    return false;
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim();
  if (!fromEmail) {
    return false;
  }

  const { text, html } = buildVendorAccessEmail(params);

  const result = await resend.emails.send({
    from: fromEmail,
    to: [params.to],
    subject: `Vendor access granted: ${params.vendorName}`,
    text,
    html,
  });

  return !result.error;
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
  const wasAlreadyActive = existingAccess?.status === "active";

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

  // Access was already active (e.g. a stray "invite" resubmission, or a
  // role/contact update on an already-activated vendor): the vendor_org_access
  // row above is already updated with any changed fields, and this person is
  // already an authenticated, active vendor -- no invite/auth call or email
  // is needed or possible (their account is already confirmed).
  if (wasAlreadyActive) {
    return NextResponse.json({
      ok: true,
      action,
      vendorId,
      vendorName: vendorRow.business_name || "Vendor",
      contactEmail,
      vendorContactId,
      accessId,
      alreadyActive: true,
      emailSent: false,
    });
  }

  const redirectToBase = appUrl();
  const redirectTo = redirectToBase
    ? `${redirectToBase}/vendor/callback`
    : undefined;

  let boundAuthUserId: string | null = null;
  let emailSent = false;
  let existingAccountMatched = false;

  const {
    data: { user: invitedUser },
    error: inviteError,
  } = await supabaseAdmin.auth.admin.inviteUserByEmail(contactEmail, {
    redirectTo,
  });

  if (!inviteError && invitedUser?.id) {
    // Brand-new (or previously-invited-but-unconfirmed) account: Supabase
    // creates/reuses the auth user and sends its own invite email.
    boundAuthUserId = invitedUser.id;
    emailSent = true;
  } else if (inviteError && isAlreadyRegisteredError(inviteError)) {
    // Existing, already-confirmed EpicentraX account (a member, or a vendor
    // contact elsewhere). inviteUserByEmail cannot target a confirmed
    // account, so the existing identity is resolved via generateLink
    // instead -- this looks up (never creates a duplicate of) the auth user
    // for this email and returns a fresh, secure activation link for them.
    existingAccountMatched = true;

    const { data: linkData, error: linkError } =
      await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email: contactEmail,
        options: { redirectTo },
      });

    if (linkError || !linkData?.user?.id) {
      return NextResponse.json(
        {
          ok: false,
          error: `Could not resolve existing account for invite: ${
            linkError?.message || "unknown error"
          }`,
        },
        { status: 400 },
      );
    }

    boundAuthUserId = linkData.user.id;
    emailSent = await sendVendorAccessNotificationEmail({
      to: contactEmail,
      vendorName: vendorRow.business_name || "Vendor",
      actionLink: linkData.properties.action_link,
    });
  } else if (inviteError) {
    return NextResponse.json(
      { ok: false, error: `Invite failed: ${inviteError.message}` },
      { status: 400 },
    );
  }

  if (boundAuthUserId) {
    const { error: bindUserError } = await supabaseAdmin
      .from("vendor_org_access")
      .update({
        auth_user_id: boundAuthUserId,
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
    existingAccountMatched,
    emailSent,
  });
}
