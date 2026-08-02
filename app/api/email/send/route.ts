import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import { emailEnabled, resend } from "@/lib/email";
import { resolveTenantFromHeaders } from "@/lib/server/tenantResolver";

type VendorRequest = {
  event_id: string;
  requester_name: string | null;
  requester_email: string | null;
  requester_phone: string | null;
  site_number: string | null;
  requested_service: string | null;
  guest_count: number | null;
  request_notes: string | null;
  preferred_response_method: string | null;
  attendees:
    | { assigned_site: string | null }
    | { assigned_site: string | null }[]
    | null;
  vendors:
    | { business_name: string | null; email: string | null }
    | { business_name: string | null; email: string | null }[]
    | null;
};

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

function getSupabaseAuthClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return null;
  }

  return createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function firstRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] || null : value;
}

export async function POST(req: NextRequest) {
  try {
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body.",
        },
        { status: 400 },
      );
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(body, "requestId")
    ) {
      return NextResponse.json(
        { success: false, error: "Invalid request body." },
        { status: 400 },
      );
    }

    const requestBody = body as { requestId?: unknown };
    const requestId =
      typeof requestBody.requestId === "string"
        ? requestBody.requestId.trim()
        : "";

    if (!requestId) {
      return NextResponse.json(
        {
          success: false,
          error: "A valid request ID is required.",
        },
        { status: 400 },
      );
    }

    const accessToken = req.headers
      .get("authorization")
      ?.match(/^Bearer\s+(.+)$/i)?.[1];
    const supabaseAuth = getSupabaseAuthClient();

    if (!accessToken || !supabaseAuth) {
      return NextResponse.json(
        { success: false, error: "Authentication is required." },
        { status: 401 },
      );
    }

    const { data: authData, error: authError } =
      await supabaseAuth.auth.getUser(accessToken);

    if (authError || !authData.user) {
      return NextResponse.json(
        { success: false, error: "Authentication is required." },
        { status: 401 },
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    if (!supabaseAdmin) {
      return NextResponse.json(
        { success: false, error: "Email service is not configured." },
        { status: 500 },
      );
    }

    let { data: adminUser, error: adminError } = await supabaseAdmin
      .from("admin_users")
      .select("id, privilege_group")
      .eq("user_id", authData.user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!adminUser && !adminError && authData.user.email) {
      const fallback = await supabaseAdmin
        .from("admin_users")
        .select("id, privilege_group")
        .eq("email", authData.user.email)
        .eq("is_active", true)
        .maybeSingle();
      adminUser = fallback.data;
      adminError = fallback.error;
    }

    if (adminError) {
      throw adminError;
    }

    if (!adminUser) {
      return NextResponse.json(
        { success: false, error: "Admin access is required." },
        { status: 403 },
      );
    }

    const { data: vendorRequest, error: requestError } = await supabaseAdmin
      .from("vendor_service_requests")
      .select(
        `
          event_id,
          requester_name,
          requester_email,
          requester_phone,
          site_number,
          requested_service,
          guest_count,
          request_notes,
          preferred_response_method,
          attendees ( assigned_site ),
          vendors ( business_name, email )
        `,
      )
      .eq("id", requestId)
      .maybeSingle();

    if (requestError) {
      throw requestError;
    }

    if (!vendorRequest) {
      return NextResponse.json(
        { success: false, error: "Vendor request not found." },
        { status: 404 },
      );
    }

    const request = vendorRequest as VendorRequest;

    if (adminUser.privilege_group !== "super_admin") {
      const { data: eventAccess, error: eventAccessError } = await supabaseAdmin
        .from("admin_event_access")
        .select("id")
        .eq("admin_user_id", adminUser.id)
        .eq("event_id", request.event_id)
        .maybeSingle();

      if (eventAccessError) {
        throw eventAccessError;
      }

      if (!eventAccess) {
        return NextResponse.json(
          { success: false, error: "You do not have access to this event." },
          { status: 403 },
        );
      }
    }

    const vendor = firstRelation(request.vendors);

    if (!vendor) {
      return NextResponse.json(
        { success: false, error: "Vendor not found." },
        { status: 404 },
      );
    }

    const vendorEmail = vendor.email?.trim();

    if (!vendorEmail) {
      return NextResponse.json(
        {
          success: false,
          error: "This vendor does not have an email address.",
        },
        { status: 422 },
      );
    }

    if (!emailEnabled() || !resend) {
      return NextResponse.json(
        { success: false, error: "Email service is not configured." },
        { status: 500 },
      );
    }

    const attendee = firstRelation(request.attendees);
    const site =
      attendee?.assigned_site || request.site_number || "Not provided";
    const vendorName = vendor.business_name || "Vendor";
    const fromEmail = process.env.RESEND_FROM_EMAIL?.trim();

    if (!fromEmail) {
      return NextResponse.json(
        { success: false, error: "Email service is not configured." },
        { status: 500 },
      );
    }

    const tenantResolution = await resolveTenantFromHeaders(req.headers);
    const tenant =
      tenantResolution.state === "resolved"
        ? tenantResolution.tenant
        : null;
    const tenantDisplayName = tenant?.displayName || "Event";
    const tenantAppTitle = tenant?.appTitle || "Event Hub";

    const subject = `Vendor Service Request - ${request.requester_name || `${tenantDisplayName} Member`}`;
    const text = [
      `Hello ${vendorName},`,
      "",
      `A vendor service request was submitted through the ${tenantDisplayName} ${tenantAppTitle}.`,
      "",
      `Name: ${request.requester_name || ""}`,
      `Site: ${site}`,
      `Phone: ${request.requester_phone || ""}`,
      `Email: ${request.requester_email || ""}`,
      `Service: ${request.requested_service || ""}`,
      `Party Count: ${request.guest_count || 0}`,
      `Preferred response: ${request.preferred_response_method || ""}`,
      "",
      "Notes:",
      request.request_notes || "",
      "",
      "Please contact the member directly to follow up.",
    ].join("\n");

    const result = await resend.emails.send({
      from: fromEmail,
      to: [vendorEmail],
      subject,
      text,
    });

    if (result.error) {
      console.error("Resend email send failed:", result.error);

      return NextResponse.json(
        {
          success: false,
          error: "Unable to send email.",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      id: result.data?.id,
    });
  } catch (error) {
    console.error("Email send failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Unable to send email.",
      },
      { status: 500 },
    );
  }
}
